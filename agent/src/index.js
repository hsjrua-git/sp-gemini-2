// The agent's entry point. Boot order:
//   1. capability report (what is installed: LLM? STT? TTS? mic?)
//   2. login as the kiosk machine user
//   3. bind tools + dialogue + transcripts, start the kiosk screen
//   4. run the input loop: voice (arecord→VAD→STT) when available, else a
//      text REPL; --file replays a wav through the exact same pipeline.

import { config } from './config.js';
import { Panel } from './panel.js';
import { makeToolHandlers } from './tools.js';
import { Dialogue } from './dialogue.js';
import { createLlmBrain } from './llm.js';
import { createTranscripts } from './transcripts.js';
import { createStt } from './speech/stt.js';
import { createTts } from './speech/tts.js';
import { hasBinary, startCapture, playBuffer, wrapWav } from './speech/audio.js';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { startKiosk } from './kiosk.js';
import { phrases } from './phrases.js';

const SESSION_ID = randomId();

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function isLocalEndpoint(value) {
  if (!value) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
    const match = host.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

function warnRemoteProviders() {
  const remote = [
    ['LLM', config.llmBaseUrl],
    ['STT', config.sttBaseUrl],
    ['TTS', config.ttsBaseUrl],
  ]
    .filter(([, url]) => url && !isLocalEndpoint(url))
    .map(([name]) => name);
  if (remote.length > 0) {
    console.warn(
      `[privacy] ${remote.join('/')} uses a non-local endpoint; dialogue text or audio may leave the LAN.`
    );
  }
}

const args = process.argv.slice(2);
const textMode = args.includes('--text');
const fileIdx = args.indexOf('--file');
const replayFile = fileIdx >= 0 ? (args[fileIdx + 1] ?? null) : null;

async function main() {
  console.log(`voice agent — stage ${config.stage}, session ${SESSION_ID}`);
  warnRemoteProviders();

  // 1. capability report
  const [stt, tts] = await Promise.all([createStt(), createTts()]);
  const brain = await createLlmBrain(config);
  const micOk = !textMode && !replayFile ? await hasBinary('arecord') : false;
  const capabilities = [
    `brain=${brain.available ? brain.label : 'rules (no model)'}`,
    `stt=${stt?.kind ?? 'off'}`,
    `tts=${tts?.kind ?? 'off'}`,
    `mic=${micOk ? 'arecord' : textMode ? 'text mode' : 'off'}`,
  ];
  console.log(capabilities.join(' · '));
  globalThis.__tts = textMode ? null : tts;
  if (!config.kioskUsername || !config.kioskPassword) {
    console.error('Set KIOSK_USERNAME / KIOSK_PASSWORD in agent/.env (see .env.example).');
    process.exit(1);
  }

  // 2. login as the machine user
  const panel = new Panel({
    baseUrl: config.panelBaseUrl,
    username: config.kioskUsername,
    password: config.kioskPassword,
  });
  try {
    const user = await panel.login();
    console.log(`logged in as ${user.username} (${user.role})`);
  } catch (err) {
    console.error(`login failed: ${err.message}`);
    console.error('Create the kiosk user with (from server/):');
    console.error('  npm run create-user -- cafe-kiosk "Cafe Kiosk (voice)" Kiosk');
    process.exit(1);
  }

  // 3. dialogue + kiosk + transcripts (the kiosk holds a ref to the
  //    dialogue, which needs the kiosk's sink — hence the indirection)
  const transcripts = await createTranscripts();
  const dialogueRef = { dialogue: null };
  const { sink } = await startKiosk({
    dialogueRef,
    port: config.kioskPort,
    host: config.kioskHost,
    label: 'starting',
  });
  const dialogue = new Dialogue({
    panel,
    brain,
    stage: config.stage,
    sessionId: SESSION_ID,
    defaultLanguage: config.defaultLanguage,
    sink: {
      say: (text, meta) => {
        sink.say(text, meta);
        transcripts.record({ sessionId: SESSION_ID, role: 'agent', text, meta }).catch(() => {});
        speak(text, meta?.lang);
      },
      event: (type, payload) => {
        sink.event(type, payload);
        if (type === 'turn' && payload?.role === 'user') {
          transcripts
            .record({
              sessionId: SESSION_ID,
              role: 'user',
              text: payload.text,
              meta: { lang: payload.lang },
            })
            .catch(() => {});
        }
      },
    },
  });
  dialogue.bindHandlers(makeToolHandlers({ panel, state: dialogue.state }));
  dialogueRef.dialogue = dialogue;

  const t = phrases(config.defaultLanguage);
  const greeting = t.greeting();
  sink.say(greeting, { lang: config.defaultLanguage });
  transcripts.record({ sessionId: SESSION_ID, role: 'agent', text: greeting }).catch(() => {});
  speak(greeting, config.defaultLanguage);

  // 4. the input loop
  if (replayFile) {
    await replayWav(replayFile, stt, dialogue);
  } else if (stt && micOk) {
    startVoiceLoop(stt, dialogue);
  } else if (!textMode && stt) {
    console.error('STT is configured but arecord is unavailable — falling back to text.');
  }
  if (!stt || textMode || replayFile || !micOk) {
    startRepl(dialogue);
  }
}

async function speak(text, lang) {
  // TTS runs only in voice deployments; text mode just prints (already done
  // by the REPL / kiosk log).
  if (!globalThis.__tts || textMode) return;
  try {
    const audio = await globalThis.__tts.synthesize(text);
    await playBuffer(audio);
  } catch (err) {
    console.error('[tts]', err.message);
  }
}

function startRepl(dialogue) {
  const rl = createInterface({ input: process.stdin, terminal: false });
  console.log('text mode — type a line, Ctrl-D to exit');
  rl.on('line', (line) => dialogue.turn(line.trim()).catch((err) => console.error(err.message)));
  rl.on('close', () => process.exit(0));
}

function startVoiceLoop(stt, dialogue) {
  console.log('voice mode — speak after the mic opens; Ctrl-C to exit');
  startCapture({
    onSegment: async (wav) => {
      try {
        const text = await stt.transcribe(wav);
        if (!text) return;
        console.log(`heard: ${text}`);
        dialogue.turn(text).catch((err) => console.error('[turn]', err.message));
      } catch (err) {
        console.error('[stt]', err.message);
      }
      // The segment buffer is dropped here — ephemeral by design.
    },
    onError: (err) => console.error('[mic]', err.message),
  });
}

async function replayWav(path, stt, dialogue) {
  if (!stt) {
    console.error('--file needs an STT provider (whisper.cpp or an API endpoint).');
    process.exit(1);
  }
  const wav = await readFile(path);
  const text = await stt.transcribe(wav);
  console.log(`transcript: ${text}`);
  await dialogue.turn(text);
  setTimeout(() => process.exit(0), 500);
}

// Text mode keeps the speakers silent; voice mode synthesizes.

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
