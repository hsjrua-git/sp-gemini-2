// The audio layer: 16 kHz mono capture via arecord, a small RMS
// voice-activity detector that cuts the stream into utterance segments, and
// playback via aplay (ffmpeg transcodes whatever the TTS produced to raw
// PCM first). Raw audio is EPHEMERAL BY DESIGN: segments live in RAM only
// and are dropped the moment the transcript comes back.

import { spawn } from 'node:child_process';
import { config } from '../config.js';

export function hasBinary(name) {
  return new Promise((resolve) => {
    const child = spawn(name, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code !== null));
  });
}

// Wrap raw PCM in a minimal 44-byte WAV header.
export function wrapWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rms(chunk) {
  let sum = 0;
  for (let i = 0; i + 1 < chunk.length; i += 2) {
    sum += chunk.readInt16LE(i) ** 2;
  }
  return Math.sqrt(sum / (chunk.length / 2));
}

const BYTES_PER_MS = 32; // 16 kHz × 2 bytes × 1 ms

// One arecord process feeding PCM chunks; the RMS VAD slices it into
// utterance WAV segments (delivered to onSegment).
export function startCapture({ onSegment, onError }) {
  const args = ['-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw', '-q'];
  if (config.audioDevice) args.push('-D', config.audioDevice);
  const child = spawn('arecord', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let collected = []; // PCM of the open speech segment
  let speechMs = 0;
  let silenceMs = 0;
  let inSpeech = false;

  child.stdout.on('data', (chunk) => {
    for (let offset = 0; offset + BYTES_PER_MS <= chunk.length; offset += BYTES_PER_MS) {
      const ms = chunk.subarray(offset, offset + BYTES_PER_MS);
      const level = rms(ms);
      if (level >= config.vadThreshold) {
        speechMs += 1;
        silenceMs = 0;
        if (!inSpeech && speechMs >= config.vadStartMs) inSpeech = true;
        if (inSpeech) collected.push(ms);
      } else if (inSpeech) {
        silenceMs += 1;
        collected.push(ms); // keep the trailing audio until the close fires
        if (silenceMs >= config.vadEndMs) {
          const pcm = Buffer.concat(collected);
          collected = [];
          inSpeech = false;
          speechMs = 0;
          silenceMs = 0;
          if (pcm.length >= 8000) onSegment(wrapWav(pcm, 16000)); // ≥0.5 s
        }
      } else {
        speechMs = 0;
      }
    }
  });

  child.stderr.on('data', (data) => console.error('[arecord]', String(data).trim()));
  child.on('error', (err) => onError?.(err));
  child.on('exit', (code) => {
    if (code && code !== 0) onError?.(new Error(`arecord exited ${code}`));
  });

  return {
    stop() {
      child.kill('SIGTERM');
    },
  };
}

// Play any audio buffer: ffmpeg decodes to 16-bit mono PCM, aplay plays it.
export async function playBuffer(buffer) {
  const ffmpeg = spawn(
    'ffmpeg', ['-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  );
  const aplay = spawn('aplay', config.audioDevice ? ['-D', config.audioDevice, '-q'] : ['-q'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  ffmpeg.stdout.pipe(aplay.stdin);
  await new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    aplay.on('error', reject);
    aplay.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`aplay exited ${code}`))));
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(buffer);
  });
}
