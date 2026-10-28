// The kiosk screen: a zero-dependency HTTP server (SSE + one static page).
// It mirrors the dialogue — transcript, cart, total, the big Confirm/Cancel
// buttons (the screen half of the confirmation protocol), and the mute/kill
// switches. The page is bilingual with a fa/en toggle; RTL by default.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

// clients: Set of SSE responses; broadcast(event, payload) fans out.
// `dialogueRef` is a mutable holder ({ dialogue }) — the kiosk starts before
// the Dialogue exists and its handlers read through the ref.
export function startKiosk({
  dialogueRef,
  port,
  host = config.kioskHost ?? '127.0.0.1',
  label,
}) {
  const clients = new Set();
  let muted = false;

  function broadcast(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of clients) response.write(frame);
  }

  const sink = {
    say(text, meta) {
      broadcast('say', { id: randomUUID(), text, ...meta });
    },
    event(type, payload) {
      broadcast(type, payload);
    },
  };

  function validOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ label, stage: config.stage })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && !validOrigin(req)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/confirm') {
      await dialogueRef.dialogue?.confirmScreen();
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/cancel') {
      await dialogueRef.dialogue?.cancelScreen();
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/mute') {
      muted = !muted;
      dialogueRef.dialogue?.setMuted(muted);
      broadcast('muted', { muted });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ muted }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/kill') {
      broadcast('killed', {});
      res.writeHead(204).end();
      // The kill switch: end capture, stop serving, die. The cafe keeps
      // working through the web POS; the agent is a convenience layer.
      setTimeout(() => process.exit(0), 150);
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, sink, broadcast }));
  });
}

// One self-contained page: no build step, no framework, inline CSS/JS.
const PAGE = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kiosk — Student Panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    font-family: Vazirmatn, system-ui, sans-serif; background: #141519; color: #eceef1;
  }
  header { display: flex; align-items: center; gap: .75rem; padding: .9rem 1.25rem; border-bottom: 1px solid #2a2d33; }
  header h1 { font-size: 1.05rem; margin: 0 auto 0 0; font-weight: 620; }
  html[dir=ltr] header h1 { margin: 0 0 0 auto; }
  .badge { font-size: .7rem; padding: .15rem .5rem; border: 1px solid #3a3e45; border-radius: 999px; color: #b0b5bd; }
  main { flex: 1; display: grid; grid-template-rows: 1fr auto; min-height: 0; }
  #log { overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .5rem; }
  .line { max-width: 70ch; padding: .5rem .85rem; border-radius: 12px; background: #1d2025; align-self: flex-start; white-space: pre-wrap; }
  .line.user { align-self: flex-end; background: #2b3a55; }
  #bar { border-top: 1px solid #2a2d33; padding: 1rem 1.25rem 1.25rem; display: grid; gap: .75rem; }
  #cart { min-height: 1.4rem; color: #b0b5bd; font-size: .95rem; }
  #cart b { color: #eceef1; }
  .buttons { display: flex; gap: .75rem; flex-wrap: wrap; }
  button { font: inherit; padding: .8rem 1.6rem; border-radius: 10px; border: 1px solid #3a3e45; background: #23262c; color: inherit; cursor: pointer; }
  #confirm { background: #cf4c0d; border-color: #cf4c0d; font-weight: 700; flex: 1; min-height: 3.4rem; font-size: 1.1rem; }
  #confirm:disabled { opacity: .35; cursor: default; }
  #cancel { flex: 1; min-height: 3.4rem; font-size: 1.1rem; }
  .tools { display: flex; gap: .5rem; }
  .tools button { padding: .45rem .9rem; font-size: .85rem; }
  .muted-note { color: #e5b567; font-size: .85rem; min-height: 1.2rem; }
</style>
</head>
<body>
<header>
  <h1 id="title">کافه — صفحهٔ کیوسک</h1>
  <span class="badge" id="stage"></span>
  <div class="tools">
    <button id="lang">English</button>
    <button id="mute">🔇</button>
    <button id="kill" title="خاموش کردن دستیار">⏻</button>
  </div>
</header>
<main>
  <div id="log"></div>
  <div id="bar">
    <div id="cart"></div>
    <div class="muted-note" id="mutedNote"></div>
    <div class="buttons">
      <button id="confirm">تأیید و ثبت</button>
      <button id="cancel">انصراف</button>
    </div>
  </div>
</main>
<script>
  const T = {
    fa: { title: 'کافه — صفحهٔ کیوسک', confirm: 'تأیید و ثبت', cancel: 'انصراف', empty: 'سبد خالی است.', confirmNeeded: 'اول تأیید گفتاری، بعد دکمه.', killed: 'دستیار خاموش شد.', muted: 'میکروفون خاموش است.', unmuted: '' },
    en: { title: 'Cafe — kiosk screen', confirm: 'Confirm & record', cancel: 'Cancel', empty: 'The cart is empty.', confirmNeeded: 'Spoken yes first, then this button.', killed: 'Assistant shut down.', muted: 'Microphone muted.', unmuted: '' },
  };
  let lang = 'fa';
  let spokenYes = false;
  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    $('title').textContent = T[lang].title;
    $('confirm').textContent = T[lang].confirm;
    $('cancel').textContent = T[lang].cancel;
    $('lang').textContent = lang === 'fa' ? 'English' : 'فارسی';
  }
  $('lang').onclick = () => { lang = lang === 'fa' ? 'en' : 'fa'; applyLang(); };
  function addLine(text, role) {
    const div = document.createElement('div');
    div.className = 'line' + (role === 'user' ? ' user' : '');
    div.textContent = text;
    $('log').appendChild(div);
    $('log').scrollTop = $('log').scrollHeight;
  }
  function renderCart(state) {
    if (!state.cart || state.cart.length === 0) { $('cart').textContent = T[lang].empty; $('confirm').disabled = true; return; }
    const lines = state.cart.map((l) => (Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(3)) + ' × ' + esc(l.productName)).join(' · ');
    const total = state.cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    $('cart').innerHTML = lines + ' — <b>' + esc(total.toLocaleString('en-US')) + '</b>';
    $('confirm').disabled = !state.awaitingScreen;
  }
  const source = new EventSource('/events');
  source.addEventListener('hello', (e) => { $('stage').textContent = 'stage ' + JSON.parse(e.data).stage; });
  source.addEventListener('say', (e) => { const d = JSON.parse(e.data); addLine(d.text, 'agent'); });
  source.addEventListener('turn', (e) => { const d = JSON.parse(e.data); if (d.role === 'user') addLine(d.text, 'user'); });
  source.addEventListener('state', (e) => { renderCart(JSON.parse(e.data)); spokenYes = false; });
  source.addEventListener('awaiting_screen', () => { spokenYes = true; });
  source.addEventListener('muted', (e) => { $('mutedNote').textContent = JSON.parse(e.data).muted ? T[lang].muted : ''; });
  source.addEventListener('killed', () => { addLine(T[lang].killed); $('confirm').disabled = true; });
  $('confirm').onclick = () => fetch('/confirm', { method: 'POST' });
  $('cancel').onclick = () => fetch('/cancel', { method: 'POST' });
  $('mute').onclick = () => fetch('/mute', { method: 'POST' });
  $('kill').onclick = () => fetch('/kill', { method: 'POST' }).then(() => { addLine(T[lang].killed); });
  applyLang();
</script>
</body>
</html>`;
