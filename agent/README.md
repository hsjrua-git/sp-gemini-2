# Voice Agent (کیوسک صوتی)

A local-first assistant that runs the **cafe counter by voice**, in Persian
and English, through the same Student Panel API a human cashier uses. The rule
brain, local Whisper/Piper, and Ollama paths can run without cloud services.
Optional OpenAI-compatible providers are also supported; configuring a remote
endpoint sends the corresponding text or audio off the LAN and therefore is
not a fully-local deployment. See `docs/voice-agent-architecture.md` for the
security model and staged rollout.

## What it is (in one paragraph)

A small Node process (`agent/`) that: listens for speech (or reads typed
text), understands what the customer wants, and acts on the Student Panel
API **as a machine user** — a login in the `Kiosk` role that can see the
menu, look up a student by name/code (name + code + balance only — never
full student records), and record or void sales. Every action goes through
the same API as the web POS, so permissions, the audit log, the stock
ledger, the balance history, and the accounting auto-posting all apply
unchanged. Money only moves after the **confirmation protocol**: the cart is
read back, the customer says an explicit yes, and (until stage 4) the
operator also presses the big Confirm button on the kiosk screen.

## Quick start (text mode — no models needed, works today)

```bash
# 1. the kiosk role exists (migration 027). Create its login:
cd server && npm run create-user -- cafe-kiosk "Cafe Kiosk (voice)" Kiosk

# 2. configure the agent
cd ../agent
cp .env.example .env          # then edit: PANEL_BASE_URL, KIOSK_USERNAME/PASSWORD

# 3. run it (text conversation in the terminal; kiosk screen at :3100)
npm start -- --text
```

Type things like:

| Persian | English |
|---|---|
| «منو چی داری؟» | what do you have? |
| «مانده علی چقدره؟» | what is Ali's balance? |
| «دو تا پیتزا» / «نیم کیلو گردو» | two pizzas / half a kilo of walnuts |
| «به حساب علی» | charge it to Ali |
| «ثبت بشه» → «بله» | confirm → yes |
| «برگردون» (voids the last sale) | undo |

The kiosk screen (`http://localhost:3100`) mirrors the dialogue and holds
the Confirm / Cancel / Mute / Kill buttons.

## The three brains (chosen automatically)

1. **LLM via API** — set `LLM_PROVIDER=openai`, `LLM_BASE_URL` (any
   OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq, a local
   llama.cpp/LM Studio/vLLM server) and optionally `LLM_API_KEY` +
   `LLM_MODEL`. The model gets the cafe tools (menu, students, cart, sale,
   void, report) and free-converses in either language.
2. **Ollama local** — if no OpenAI-style URL is set and Ollama answers on
   `OLLAMA_URL`, its native tool-calling chat is used (`OLLAMA_MODEL`).
3. **Rule brain (always available)** — a deterministic Persian/English
   intent engine. It handles the whole cafe flow (menu, balance, quantities
   like «دو تا»/«نیم»/two-and-a-half, confirmations, voids, reports) with
   **no model at all**. Limitation: an utterance must contain the product
   name (or a Latin name for a Latin-named product) — paraphrase is the
    LLM's job.

> **Privacy boundary:** a remote LLM may receive dialogue/tool context; remote
> STT receives microphone audio; remote TTS receives spoken response text. Use
> only loopback/LAN endpoints when the deployment must remain fully local. Keep
> all provider API keys in mode-600 `agent/.env`.

Whatever the brain, the **confirmation protocol never depends on the
model**: yes/no while confirming are matched literally, and the `record_sale`
tool refuses unless the supervisor opened the gate.

## Voice (when models are installed)

The agent detects what exists at boot and prints a capability line:

```
brain=ollama:qwen2.5:7b · stt=whisper.cpp:large-v3 · tts=piper:fa_IR · mic=arecord
```

- **STT** — whisper.cpp (`WHISPER_BIN` + `WHISPER_MODEL`, e.g. `large-v3`;
  `medium` for the CPU floor) **or** any OpenAI-compatible transcription API
  (`STT_PROVIDER=openai`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL` —
  OpenAI `whisper-1`, Groq `whisper-large-v3`, …).
- **TTS** — Piper (`PIPER_BIN` + `PIPER_VOICE` fa_IR .onnx) **or** an
  OpenAI-compatible `/audio/speech` endpoint (`TTS_PROVIDER=openai`, …).
- **Capture** — `arecord` (ALSA) at 16 kHz mono with a small RMS
  voice-activity detector that cuts utterances; playback via `aplay`
  (ffmpeg transcodes). A physical or on-screen Mute kills capture; raw
  audio lives in RAM only and is dropped the moment the transcript exists.
- **Test without a mic:** `npm start -- --file recording.wav` runs a wav
  through the exact same STT→dialogue→TTS pipeline.

## Stages (VOICE_STAGE 0–4)

| Stage | Spoken "yes" | Screen Confirm | Effect |
|---|---|---|---|
| 0–1 | — | — | voice off / transcription display only |
| 2 | read-only answers | records (operator action) | speech never records |
| 3 | required first | required after | both halves of the protocol |
| 4 | records alone | shows the receipt | autonomous ordering |

## Tests

```bash
npm test        # 21 unit tests: confirmation protocol, intents, Persian numbers
npm run smoke   # live smoke against the running server — seeds a kiosk user,
                # walks menu→balance→sale→void over REAL HTTP, cleans up after
```

The smoke loads the disposable server database URL from `server/.env` because
its cleanup needs database-owner privileges. Never point this command at a
production database. Normal agent business actions still use only the HTTP API.

## Transcript storage

Every turn is appended to `agent/logs/transcripts-YYYY-MM-DD.jsonl`; the agent
forces the directory/file to modes 0700/0600. If `AGENT_DATABASE_URL` is set,
it also inserts into `voice_transcripts`. Give that URL a dedicated PostgreSQL
role with INSERT on `voice_transcripts` only—do not reuse the server's full
database credential. Transcript retention/rotation is an operator policy; raw
audio remains ephemeral in the shipped implementation.

## Files

```
src/index.js      boot: capability report, login, kiosk + REPL/voice loop
src/dialogue.js   the SupervisorAgent — confirmation protocol, stage gating
src/tools.js      the agent's entire capability boundary (10 tools)
src/intents.js    the deterministic fa/en brain + the literal yes/no matcher
src/llm.js        Ollama + OpenAI-compatible providers (tool-calling loop)
src/phrases.js    every spoken sentence in Persian AND English
src/panel.js      the API client (cookie jar, CSRF echo, Origin)
src/speech/       arecord capture + VAD, whisper.cpp/API STT, Piper/API TTS
src/kiosk.js      the counter screen: SSE transcript, cart, confirm/cancel/kill
src/faWords.js    numbers → Persian words (prices are spoken, not read)
```
