# Voice + Local-AI Agent Architecture

A design document for a Persian-speaking, fully-local voice agent that operates
the cafe (and later the accounting) through the existing Student Panel API.
**This is a design, not an implementation** — nothing here is wired into the
app yet. The document exists so that when the kiosk hardware arrives, the
integration decisions are already made and consistent with the system's
security model.

Status: proposed (Phase 5 of the roadmap, 2026-10-25). Owner: the project
maintainer. Review trigger: before any hardware purchase or any stage-2
rollout.

---

## 1. Goals and non-goals

**Goals**

1. A walk-up counter experience: a student or the cafe operator *speaks* an
   order in Persian; the system confirms and records it through the same
   API the web POS uses.
2. Fully local: every model runs on premises. No audio, transcript, or
   identifier ever leaves the LAN. The cafe works through a network outage;
   the voice agent is a convenience layer, not a dependency.
3. Least privilege end to end: the agent is a *user of the API*, with the
   same permission keys, audit trail, and session rules as a human cashier.
   It can never do more than the role it is granted.
4. Money-moving actions are always confirmed (spoken confirmation from the
   customer + on-screen confirmation for a human) until stage 4, and even
   then remain auditable and reversible (sale voids).
5. Persian-first dialogue: fa-IR speech recognition and synthesis; numbers
   and prices spoken in Persian; the UI texts it shows come from the same
   i18n catalogues the web app uses (`client/src/i18n/fa/*.json`).

**Non-goals**

- No cloud AI services at any stage (no OpenAI/Google/ Azure calls, no
  "hybrid" fallback). If the local model can't answer, it says so.
- No general-purpose chatbot. The agent's tool set is bounded: cafe menu
  questions, the student balance flow, and (stage 3+) the sale/top-up
  actions. Small talk is politely refused.
- No speech in the web SPA itself, no microphone in the browser, no new
  user-facing pages beyond the kiosk screen. The agent is a separate
  process with a kiosk UI, not a feature of the React app.
- No biometric identification. A customer states their student code; the
  agent looks it up exactly like the POS finder does. No face/voice
  identification, ever — that data is not collected anywhere in the system.
- No training or fine-tuning pipeline. Off-the-shelf local models, chosen
  per stage; revisit only when Persian STT quality on our hardware is
  measurably insufficient.

**Product decisions this design inherits** (see the roadmap memory):

- Dialogue language: **Persian only** (A8).
- Audio: **ephemeral by default** — raw audio is deleted immediately after
  transcription; transcripts and the audit trail are kept.
- Overdraft is allowed at the cafe, so the agent never *refuses* a sale for
  balance; it *reads out* the resulting debt plainly (the POS behaviour,
  spoken).

---

## 2. Hardware and placement

The reference deployment puts the voice stack on the same machine as the
PostgreSQL server (the "server box"), with a kiosk endpoint at the cafe
counter.

- **Kiosk endpoint (counter):** a small touch screen (or the existing
  monitor) + a USB microphone array + a small speaker. A Raspberry Pi 5 or
  a used mini-PC is enough at stages 0–2 because it only captures audio and
  renders a web view; stages 3–4 still fit if the LLM stays on the server
  box.
- **Server box (the DB host):** does VAD, STT, the LLM, and TTS. Sizing:

| Tier | Hardware | What fits | Stages |
|---|---|---|---|
| CPU-only floor | 8-core modern CPU, 16 GB RAM | whisper.cpp `small`/`medium` (int8), Piper TTS, Qwen2.5-7B/Llama-3.1-8B at Q4 via llama.cpp — workable Persian STT, acceptable tool-calling | 0–2 fine, 3–4 slower (2–5 s/tool-turn) |
| Mid | + 12 GB GPU (RTX 3060/4070) | faster-whisper `large-v3` (fp16), 7–8B LLM at Q5/Q6 — snappy turns, reliable JSON tool calls | all stages comfortable |
| Comfortable | + 24 GB GPU (RTX 3090/4090) | `large-v3` + 32B-class LLM (e.g. Qwen2.5-32B) — best Persian nuance, headroom for future accounting Q&A | all stages + analytics questions |

- Linux + PipeWire for capture/playback (ALSA directly is the fallback on
  minimal installs). The kiosk and server talk over the LAN with plain
  HTTP *to the kiosk's own tiny process*; the only authenticated
  conversations are agent↔Student Panel API (see §5).
- One microphone per counter. The kiosk shows a persistent "listening"
  state and a hard mute button that kills capture at the device.

---

## 3. Agent decomposition

Six cooperating components, each small and testable. All state lives in the
Student Panel database; the agents are stateless between turns apart from
the dialogue context window.

```
                        ┌────────────────────────────┐
  mic ──capture──▶ VoiceAgent ──text──▶ Dialogue supervisor (SupervisorAgent)
                        │        ▲                        │
                     VAD/STT     │ TTS              tools │ (REST, machine user)
                        │        │                        ▼
                     speaker ◀──┘            ┌───────────────────────────┐
                                             │ CustomerAgent  MenuAgent  │
                                             │ SalesAgent   Accounting-  │
                                             │              Agent        │
                                             └───────────────────────────┘
                                                  Student Panel API (Express)
```

- **VoiceAgent** — the audio loop only: 16 kHz mono capture → Silero VAD →
  chunked STT → text out; text in → streamed TTS → speaker; barge-in
  handling (TTS stops the moment VAD sees speech). Knows nothing about the
  business.
- **SupervisorAgent** — the dialogue brain: keeps the turn context, decides
  which specialist to call, composes the final spoken answer, and enforces
  the confirmation policy. The only component allowed to call money-moving
  tools, and only after the confirmation protocol (§6) is satisfied. Holds
  the kill switch.
- **CustomerAgent** — identity and balance: finds a student by stated code
  (`GET /api/cafe/balances/students?search=`), speaks the balance and any
  overdraft plainly, and refuses to pronounce more identity than the API
  returns (name, code, balance — the minimal-PII view; the agent never has
  `students.view`).
- **MenuAgent** — menu questions from the live product list
  (`GET /api/cafe/products`): what's available, prices, "what can I get for
  X toman". Pure reads.
- **SalesAgent** — the order tool: builds the cart, then records the sale
  (`POST /api/cafe/sales`) — walk-in or student-charged — and reports the
  resulting balance. Can void the sale it just made (`POST …/void`) when
  the customer or the operator retracts.
- **AccountingAgent** (stage 4+, last) — read-only accounting questions for
  the operator: today's revenue/profit, stock value, outstanding debt
  (`GET /api/cafe/reports`, later the accounting reports). Deliberately
  read-only forever in dialogue; journals are typed, not spoken.

Specialists are tool-schemas + prompts, not processes: one agent process
loads them all and the Supervisor routes. Separation is by *capability*
(the machine user's role grants only the keys below), not by sandboxing.

---

## 4. Local model stack

All open weights, all local, per stage:

| Role | Choice | Why | Notes |
|---|---|---|---|
| VAD | **Silero VAD** | tiny, fast, the standard | runs on CPU anywhere |
| STT | **faster-whisper `large-v3`** (GPU) / **whisper.cpp `medium` int8** (CPU) | best open Persian WER; `large-v3` handles colloquial orders well | whisper.cpp for the CPU floor; both expose word timestamps used for barge-in |
| TTS | **Piper `fa_IR-gyro- medium`** (or `fa_IR-amir`) | the only solid open Persian TTS; streams sentence-by-sentence | numbers pre-normalized to Persian words before synthesis |
| LLM | **Qwen2.5-7B/14B-Instruct** or **Llama-3.1-8B-Instruct** via **Ollama/llama.cpp** with JSON-schema tool calling | Persian-capable, reliable structured tool calls at small sizes | temperature 0–0.3; a system prompt locks the persona and the refusal rules |
| Numbers/text | `lib/numbers.js` conventions server-side; a small Persian number-to-words helper in the agent | prices must be *spoken* correctly («دویست و پنجاه هزار تومان») | same digit-normalization rules as the client |

Model files live under `/srv/student-panel/models/` (git-ignored, listed by
checksum in `docs/voice-models.md` when stage 1 lands). Ollama is the
runtime at stages 1–2 for convenience; llama.cpp directly at stage 3+ for
deterministic JSON-schema enforcement.

**Barge-in:** while TTS is playing, VAD keeps running; speech pauses TTS
within ~150 ms, keeps the recognized partial as the next user turn.

---

## 5. Integration: the agent is an API user, not a DB peer

The hard rule: **the voice agent talks to the Student Panel exactly like a
human cashier** — over HTTP, with a session, under permissions, audited.

- **Machine users.** One login per agent role, created with the existing
  script, e.g. `npm run create-user -- cafe-kiosk "Cafe Kiosk (voice)"` in
  a dedicated `Kiosk` role holding exactly:
  - `cafe.view`, `cafe.sell` (menu reads, student finder, sales, voids) —
    deliberately **not** `students.view` (the POS blind-entry precedent:
    name/code/balance only);
  - `cafe.balance` only for a separate top-up kiosk login, if one exists;
  - `accounting.view` only for the AccountingAgent's login, stage 4+.
  No `scores.*`, no `students.*`, no admin keys. The role editor's
  prerequisite enforcement keeps the keys coherent.
- **Sessions.** The agent process performs a normal login and keeps the
  session alive; every request is CSRF-protected and audited exactly like
  the SPA's. Speech-driven actions therefore appear in the audit log with
  the kiosk user as actor — the existing `cafe_sale.create`,
  `cafe_sale.void`, `cafe_balance.*` entries need no new plumbing.
- **Defense-in-depth (stage 3+):** a dedicated PostgreSQL role
  (`student_panel_kiosk`) with USAGE on the schema and
  SELECT/INSERT limited to the cafe tables, so even a compromised agent
  process cannot touch `evaluations`, `users`, or the journal. The agent's
  `DATABASE_URL` (its own, never the server's) points at this role. The
  Express server keeps its full-rights role.
- **The agent never speaks to Postgres directly** for business actions —
  all writes go through the API so triggers, transactional invariants
  (stock ledger, balance replay), auto-posting, and audit all apply
  uniformly.

---

## 6. Safety: confirmation protocol, handover, kill switch

- **Confirmation protocol (stages 0–3, mandatory):** no money-moving tool
  fires until, in one dialogue turn, (a) the customer heard the full order
  and the total spoken back, and (b) said an explicit affirmative
  («ثبت بشه», «بله» — matched literally, not inferred by the LLM). The
  kiosk screen mirrors every step: cart, total, and a big
  confirm/cancel. The screen confirm is *also* required at stage ≤2 — the
  spoken "yes" alone can never record a sale before stage 3.
- **Human handover:** any of — two consecutive misunderstood turns, the
  customer asks for a human, an API error, or the balance/overdraft
  read-back confuses the customer — parks the dialogue and shows «کارشناس
  بشینید» on screen; the POS remains usable throughout.
- **Kill switch:** a physical button (and a screen button) that ends audio
  capture, terminates the agent process (systemd `StopUnit`), and leaves
  the kiosk in stage-0 button mode. The cafe never depends on the agent.
- **Reversibility:** sales are voidable (`cafe_sale.void`), balances
  correctable (signed adjustments) — every voice-made mistake has the same
  correction path as a human-made one.

---

## 7. Voice stream flow

```
 mic (16 kHz mono s16le)
   │
   ▼
 Silero VAD ──speech segment──▶ whisper (chunked, VAD-aligned)
   ▲                                 │ partial + final text
   │ barge-in                        ▼
 speaker ◀── Piper (sentence-streamed) ── SupervisorAgent
                                     │  tool calls (JSON schema)
                                     ▼
                          Student Panel API (machine user, HTTPS/LAN)
                                     │
                                     ▼
                          PostgreSQL (triggers, ledger, audit)
```

Latency budget per turn (mid tier): VAD endpoint ~200 ms → STT
large-v3 ~400–800 ms → LLM tool turn ~500–1500 ms → TTS first sentence
~200 ms. Target: first audible response under 2.5 s; the confirmation
protocol's extra turn is acceptable because it overlaps with the customer
reaching for their card/wallet anyway.

---

## 8. Privacy

- **Audio is ephemeral by default:** ring buffer in RAM; each recognized
  segment is deleted the moment the final transcript is produced. No audio
  ever touches the disk. (A `VOICE_KEEP_AUDIO=0/1` env flag exists for
  debugging; when set, recordings go to a folder owned by root, rotated
  daily, and the kiosk shows a visible "recording kept for debugging"
  notice.)
- **Transcripts are kept** (per A8) in the agent's own Postgres schema:
  turn text, intent, tool calls, and the linked audit entries. They are
  PII-lite (order content + student code) and are treated like the audit
  log: retained, admin-readable, never exported with student identity.
- **Consent at the kiosk:** a permanent sign at the counter (fa/en) plus a
  first-visit screen explaining the microphone; the hard mute button is
  the opt-out and is always visible.
- **No cloud calls:** verified by an outbound firewall rule on the kiosk
  and server boxes (fail-closed: the agent logs and refuses to start if it
  can't confirm egress is blocked at boot).
- **Redaction:** transcripts store the student **code**, not names;
  spoken answers pronounce the name only after successful lookup, never
  store it in agent logs.

---

## 9. Staged rollout

Each stage is independently useful and independently revertible; the
stage below it keeps working.

| Stage | What exists | New hardware | New risk | Exit criteria |
|---|---|---|---|---|
| **0. Button kiosk** | touch screen runs a thin web view of the existing POS (product pad + balance lookup); no voice | screen, mic, speaker (mic unused) | none — it is the web app | a week of counter use without complaints |
| **1. STT display** | speech → text on screen; the operator taps; zero actions from speech | nothing new | audio handling only (ephemeral) | Persian order transcription ≥95% intelligible on the real counter noise |
| **2. Read-only Q&A** | spoken menu/balance answers via Menu/Customer agents; still no speech-driven writes | nothing new | mis-speak balance → mitigated by screen mirror | 2 weeks, <1% wrong-balance complaints |
| **3. Confirmed actions** | SalesAgent records sales/top-ups after spoken+screen confirmation; handover + kill switch live | GPU if latency demands | wrong-cart recording → mitigated by the double confirmation + voids | a month with zero uncorrected money errors |
| **4. Autonomous ordering** | spoken "yes" alone completes (screen still shows the receipt); AccountingAgent Q&A for the operator | — | conversational manipulation → bounded tools, per-turn audit review dashboard | explicit maintainer sign-off after stage-3 data review |

- **systemd units** (added at the stage that needs them):
  `student-panel-voice.service` (the agent; `After=student-panel.service`),
  `student-panel-voice-ui.service` (kiosk browser in kiosk mode),
  `ollama.service` or a `llama-server.service` per stage. All
  `Restart=on-failure`, all logging to journald, none with secrets on the
  command line (env files, mode 600).
- **Model ops:** models pinned by checksum; upgrades are a staged
  directory swap + a scripted regression set (20 recorded counter phrases
  with expected intents, kept out of the repo) run before promoting a new
  model; rollback is flipping a symlink.
- **Per-stage config lives in `agent/.env`** (the future agent repo
  layout): `PANEL_BASE_URL`, kiosk login credentials (machine user),
  `VOICE_KEEP_AUDIO`, `VOICE_STAGE`, model names.

---

## 10. What the app must provide (checklist for implementation)

Almost everything exists already; this is the delta:

- [x] Minimal-identity student finder without `students.view`
      (`GET /api/cafe/balances/students`) — done (P3).
- [x] Sale + void + balance endpoints with audit — done (P3).
- [x] Reports for the AccountingAgent — done (P3/P4).
- [x] Roles/permissions + machine-user creation script — done.
- [ ] A `Kiosk` role seed (one migration or `npm run create-user` docs).
- [ ] Optional: a rate limit on `POST /api/cafe/sales` for the kiosk user
      (the global login limiter exists; a per-route one may be worth it).
- [ ] The agent process + kiosk UI (out of scope for this repo; it gets its
      own repository `student-panel-voice` when stage 1 is funded).

---

*Decision record: this design was approved as Phase 5 of the 2026-10-24
roadmap (Persian-only dialogue, ephemeral audio, machine-user integration,
staged rollout with confirmation-first money movement). Any change to the
confirmation protocol or the privacy defaults is a product decision, not an
engineering one — escalate to the maintainer.*
