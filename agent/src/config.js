// Agent configuration from the environment (agent/.env). Everything is
// optional except the panel URL and the kiosk login; missing models simply
// disable the corresponding capability (see index.js's capability report).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  // Zero-dependency .env loader (agent/.env only; the server's own env is
  // its own business).
  try {
    const raw = readFileSync(join(here, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      if (process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // no .env — everything must come from the real environment
  }
}
loadDotEnv();

const integer = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) ? value : fallback;
};

export const config = {
  panelBaseUrl: (process.env.PANEL_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  kioskUsername: process.env.KIOSK_USERNAME ?? '',
  kioskPassword: process.env.KIOSK_PASSWORD ?? '',
  stage: Math.min(4, Math.max(0, integer('VOICE_STAGE', 2))),
  kioskPort: integer('KIOSK_PORT', 3100),
  kioskHost: process.env.KIOSK_HOST ?? '127.0.0.1',
  defaultLanguage: process.env.AGENT_LANGUAGE === 'en' ? 'en' : 'fa',

  // LLM: any OpenAI-compatible chat API wins when LLM_BASE_URL is set
  // (OpenAI, OpenRouter, Groq, local llama.cpp/LM Studio/vLLM); otherwise
  // Ollama native is used when OLLAMA_URL answers; otherwise the
  // deterministic intent brain runs the show.
  llmProvider: process.env.LLM_PROVIDER ?? 'auto', // auto | openai | ollama | none
  llmBaseUrl: (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, ''),
  llmApiKey: process.env.LLM_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'qwen2.5:7b',
  ollamaUrl: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',

  // STT: whisper.cpp binary locally, or any OpenAI-compatible
  // /audio/transcriptions endpoint (STT_BASE_URL + STT_API_KEY + STT_MODEL).
  sttProvider: process.env.STT_PROVIDER ?? 'auto', // auto | whisper | openai | none
  sttBaseUrl: (process.env.STT_BASE_URL ?? '').replace(/\/+$/, ''),
  sttApiKey: process.env.STT_API_KEY ?? '',
  sttModel: process.env.STT_MODEL ?? 'whisper-1',
  whisperBin: process.env.WHISPER_BIN ?? '',
  whisperModel: process.env.WHISPER_MODEL ?? '',

  // TTS: Piper locally, or an OpenAI-compatible /audio/speech endpoint
  // (TTS_BASE_URL + TTS_API_KEY + TTS_MODEL + TTS_VOICE).
  ttsProvider: process.env.TTS_PROVIDER ?? 'auto', // auto | piper | openai | none
  ttsBaseUrl: (process.env.TTS_BASE_URL ?? '').replace(/\/+$/, ''),
  ttsApiKey: process.env.TTS_API_KEY ?? '',
  ttsModel: process.env.TTS_MODEL ?? 'tts-1',
  ttsVoice: process.env.TTS_VOICE ?? 'onyx',
  piperBin: process.env.PIPER_BIN ?? '',
  piperVoice: process.env.PIPER_VOICE ?? '',
  piperConfig: process.env.PIPER_CONFIG ?? '',

  audioDevice: process.env.AUDIO_DEVICE ?? '',
  vadThreshold: integer('VAD_THRESHOLD', 500),
  vadStartMs: integer('VAD_START_MS', 150),
  vadEndMs: integer('VAD_END_MS', 700),

  databaseUrl: process.env.AGENT_DATABASE_URL ?? '',
};
