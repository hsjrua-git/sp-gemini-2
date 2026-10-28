# Voice + Local-AI Agent Architecture

A design record and implementation map for the Persian/English voice agent in
`agent/`. It operates the cafe through the existing Student Panel API; the
React administration pages expose its status and retained transcripts. The
deterministic text path and local model adapters are implemented. Real kiosk
hardware, microphone/model quality, and production rollout remain deployment
work.

Status: implemented software foundation (Phase 5, updated 2026-10-28). Owner:
the project maintainer. Review trigger: before hardware purchase, remote-provider
configuration, transcript retention changes, or stage-3/4 rollout.

---

## 1. Goals and non-goals

**Goals**

1. A walk-up counter experience: a student or the cafe operator *speaks* an
   order in Persian; the system confirms and records it through the same
   API the web POS uses.
2. Local-first: the deterministic brain and local Whisper/Piper/Ollama paths
   run on premises. Optional OpenAI-compatible endpoints are implemented, but a
   remote endpoint explicitly leaves the local-only privacy boundary. The cafe
   remains usable without the agent.
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

- No silent cloud fallback. Remote-compatible LLM/STT/TTS is used only when an
  operator configures its provider/URL/key and accepts that privacy trade-off.
- No general-purpose chatbot. The agent's tool set is bounded: cafe menu
  questions, the student balance flow, and (stage 3+) the sale/top-up
  actions. Small talk is politely refused.
- No speech capture in the web SPA. The agent remains a separate process with
  its kiosk UI; the SPA has read-only status/transcript administration pages.
- No biometric identification. A customer states their student code; the
  agent looks it up exactly like the POS finder does. No face/voice
  identification, ever — that data is not collected anywhere in the system.
- No training or fine-tuning pipeline. Off-the-shelf local models, chosen
  per stage; revisit only when Persian STT quality on our hardware is
  measurably insufficient.

**Product decisions this design inherits** (see the roadmap memory):

- Dialogue language: **Persian and English**, with Persian as the default.
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

Small cooperating components, each testable. Business state lives behind the
Student Panel API; dialogue state is per process/session. Transcript persistence
is a private JSONL file plus an optional least-privilege PostgreSQL sink.

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

- **Voice loop** — 16 kHz mono `arecord` capture with RMS/end-silence VAD,
  whisper.cpp or compatible STT, and Piper or compatible TTS. It knows nothing
  about business rules.
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

## 4. Model/provider stack

The local deployment uses open weights; compatible remote endpoints are an
explicit optional mode:

| Role | Choice | Why | Notes |
|---|---|---|---|
| VAD | Shipped RMS/start/end-silence detector; Silero is a future upgrade | zero dependency today | runs on CPU anywhere |
| STT | whisper.cpp locally or an OpenAI-compatible transcription endpoint | local Persian models or an explicitly configured service | provider chosen in `agent/.env` |
| TTS | Piper locally or an OpenAI-compatible speech endpoint | local Persian voice or configured service | numbers are normalized to Persian words before synthesis |
| LLM | Deterministic rule brain, Ollama, or OpenAI-compatible tool calling | the rule path needs no model | bounded tools and confirmation gate remain outside the model |
| Numbers/text | `lib/numbers.js` conventions server-side; a small Persian number-to-words helper in the agent | prices must be *spoken* correctly («دویست و پنجاه هزار تومان») | same digit-normalization rules as the client |

Model files should live outside the repository and be pinned operationally.
The shipped adapters support Ollama, whisper.cpp, Piper, and OpenAI-compatible
LLM/STT/TTS APIs; the deterministic intent brain is always available.

**Future barge-in:** the current playback call is not interruptible by VAD.
Stopping TTS on new speech remains hardware-stage work and must be measured on
the real counter before autonomous rollout.

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
- **Transcript sink only:** when `AGENT_DATABASE_URL` is configured, it should
  use a dedicated role with only the schema access and INSERT privilege needed
  for `voice_transcripts`. Business reads/writes never use that connection.
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
 RMS/end VAD ─speech segment─▶ whisper.cpp / STT API
                                     │ final text
                                     ▼
 speaker ◀── Piper / TTS API ── SupervisorAgent
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

- **Audio is ephemeral:** captured segments remain in memory and are dropped
  after transcription. The shipped code has no keep-audio mode.
- **Transcripts are kept** in mode-0600 daily JSONL files and optionally in the
  main app's `voice_transcripts` table through a restricted DB credential.
  Utterances may contain a name, code, order, or balance question and therefore
  must be treated as personal data.
- **Consent at the kiosk:** a permanent sign at the counter (fa/en) plus a
  first-visit screen explaining the microphone; the hard mute button is
  the opt-out and is always visible.
- **Local-only deployments:** configure loopback/LAN provider URLs (or `none`)
  and enforce egress policy outside the app. The shipped process does not claim
  to verify firewall state.

---

## 9. Staged rollout

Each stage is independently useful and independently revertible; the
stage below it keeps working.

| Stage | What exists | New hardware | New risk | Exit criteria |
|---|---|---|---|---|
| **0. Button kiosk** | touch screen runs a thin web view of the existing POS (product pad + balance lookup); no voice | screen, mic, speaker (mic unused) | none — it is the web app | a week of counter use without complaints |
| **1. STT display** | speech → text on screen; the operator taps; zero actions from speech | nothing new | audio handling only (ephemeral) | Persian order transcription ≥95% intelligible on the real counter noise |
| **2. Operator-confirmed** | speech may prepare/read a cart, but spoken yes never writes; the screen operator is the only write gate | nothing new | operator mistake → screen mirror + void | 2 weeks, no unreviewed writes |
| **3. Confirmed actions** | SalesAgent records sales/top-ups after spoken+screen confirmation; handover + kill switch live | GPU if latency demands | wrong-cart recording → mitigated by the double confirmation + voids | a month with zero uncorrected money errors |
| **4. Autonomous ordering** | spoken "yes" alone completes (screen still shows the receipt); AccountingAgent Q&A for the operator | — | conversational manipulation → bounded tools, per-turn audit review dashboard | explicit maintainer sign-off after stage-3 data review |

- **Planned deployment units** (not shipped yet; add at the hardware stage):
  `student-panel-voice.service` (the agent; `After=student-panel.service`),
  `student-panel-voice-ui.service` (kiosk browser in kiosk mode),
  `ollama.service` or a `llama-server.service` per stage. All
  `Restart=on-failure`, all logging to journald, none with secrets on the
  command line (env files, mode 600).
- **Model ops:** models pinned by checksum; upgrades are a staged
  directory swap + a scripted regression set (20 recorded counter phrases
  with expected intents, kept out of the repo) run before promoting a new
  model; rollback is flipping a symlink.
- **Per-stage config lives in `agent/.env`:** `PANEL_BASE_URL`, kiosk login
  credentials, `VOICE_STAGE`, language, model/provider URLs and names.

---

## 10. Implementation status

Almost everything exists already; this is the delta:

- [x] Minimal-identity student finder without `students.view`
      (`GET /api/cafe/balances/students`) — done (P3).
- [x] Sale + void + balance endpoints with audit — done (P3).
- [x] Reports for the AccountingAgent — done (P3/P4).
- [x] Roles/permissions + machine-user creation script — done.
- [x] A seeded least-privilege `Kiosk` role (migration 027).
- [ ] Optional: a rate limit on `POST /api/cafe/sales` for the kiosk user
      (the global login limiter exists; a per-route one may be worth it).
- [x] Agent process, rule brain, provider adapters, confirmation supervisor,
      kiosk UI, transcript sinks, and deterministic tests in `agent/`.

---

*Decision record: this design was approved as Phase 5 of the 2026-10-24
roadmap (Persian-only dialogue, ephemeral audio, machine-user integration,
staged rollout with confirmation-first money movement). Any change to the
confirmation protocol or the privacy defaults is a product decision, not an
engineering one — escalate to the maintainer.*
