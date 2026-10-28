// Speech-to-text, two providers behind one interface:
//   whisper.cpp — the local path (WHISPER_BIN + WHISPER_MODEL);
//   openai      — any OpenAI-compatible /audio/transcriptions endpoint
//                 (STT_BASE_URL + STT_API_KEY + STT_MODEL; OpenAI, Groq…).
// The wav buffer lives in RAM and is dropped right after this call.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';

export async function createStt() {
  const kind =
    config.sttProvider === 'openai' ? 'openai'
    : config.sttProvider === 'whisper' ? 'whisper'
    : config.sttProvider === 'none' ? null
    : (config.sttBaseUrl ? 'openai' : config.whisperBin && config.whisperModel ? 'whisper' : null);

  if (!kind) return null;

  if (kind === 'openai') {
    return {
      kind: `openai:${config.sttModel}`,
      async transcribe(wav) {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
        form.append('model', config.sttModel);
        const response = await fetch(`${config.sttBaseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: config.sttApiKey ? { authorization: `Bearer ${config.sttApiKey}` } : {},
          body: form,
        });
        if (!response.ok) {
          throw new Error(`STT HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        const data = await response.json();
        return String(data.text ?? '').trim();
      },
    };
  }

  return {
    kind: `whisper.cpp:${config.whisperModel.split('/').pop()}`,
    async transcribe(wav) {
      // whisper.cpp reads from a file; the temp copy is deleted immediately
      // after the call (the RAM buffer was the only other copy).
      const dir = await mkdtemp(join(tmpdir(), 'voice-'));
      try {
        const wavPath = join(dir, 'speech.wav');
        await writeFile(wavPath, wav);
        const text = await runWhisper(wavPath);
        return text;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };

  function runWhisper(wavPath) {
    return new Promise((resolve, reject) => {
      const child = spawn(config.whisperBin, [
        '-m', config.whisperModel,
        '-f', wavPath,
        '-l', 'fa', // Persian primary; the model still code-switches to English
        '-nt', // no timestamps
        '-np', // no prints
      ]);
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== 0) return reject(new Error(`whisper exited ${code}: ${err.slice(0, 300)}`));
        resolve(out.replace(/\s+/g, ' ').trim());
      });
    });
  }
}

// A tiny helper for the file-replay mode: wav → text with the same providers.
export async function transcribeFile(stt, path) {
  const wav = await readFile(path);
  return stt.transcribe(wav);
}
