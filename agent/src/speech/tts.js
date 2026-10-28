// Text-to-speech, two providers behind one interface:
//   piper  — local (PIPER_BIN + PIPER_VOICE fa_IR .onnx);
//   openai — any OpenAI-compatible /audio/speech endpoint
//            (TTS_BASE_URL + TTS_API_KEY + TTS_MODEL + TTS_VOICE).
// Returns the synthesized audio as a Buffer (audio.js plays it); nothing is
// cached — each sentence is spoken once.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

export async function createTts() {
  const kind =
    config.ttsProvider === 'openai' ? 'openai'
    : config.ttsProvider === 'piper' ? 'piper'
    : config.ttsProvider === 'none' ? null
    : (config.ttsBaseUrl ? 'openai' : config.piperBin && config.piperVoice ? 'piper' : null);

  if (!kind) return null;

  if (kind === 'openai') {
    return {
      kind: `openai:${config.ttsModel}`,
      async synthesize(text) {
        const response = await fetch(`${config.ttsBaseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.ttsApiKey ? { authorization: `Bearer ${config.ttsApiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.ttsModel,
            voice: config.ttsVoice,
            input: text,
          }),
        });
        if (!response.ok) {
          throw new Error(`TTS HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        return Buffer.from(await response.arrayBuffer());
      },
    };
  }

  return {
    kind: `piper:${config.piperVoice.split('/').pop()}`,
    async synthesize(text) {
      const dir = await mkdtemp(join(tmpdir(), 'piper-'));
      try {
        const outPath = join(dir, 'speech.wav');
        await runPiper(text, outPath);
        return readFile(outPath);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };

  function runPiper(text, outPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', config.piperVoice,
        '-f', outPath,
      ];
      if (config.piperConfig) args.push('-c', config.piperConfig);
      const child = spawn(config.piperBin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== 0) return reject(new Error(`piper exited ${code}: ${err.slice(0, 300)}`));
        resolve();
      });
      child.stdin.end(text);
    });
  }
}
