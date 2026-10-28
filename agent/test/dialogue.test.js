import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dialogue } from '../src/dialogue.js';
import { makeToolHandlers } from '../src/tools.js';

// A fake Panel: exercises the dialogue end-to-end with no network. Its sale
// recording mirrors the real invariant the server enforces — but the
// dialogue must never even CALL it unless the gate opened.
function fakePanel({ failSale = false } = {}) {
  const calls = [];
  const students = [
    { id: 's1', fullName: 'علی', code: 'AAAA-0001', balance: -5000 },
  ];
  return {
    calls,
    async listProducts() {
      calls.push('listProducts');
      return [
        { id: 'p1', name: 'پیتزا', price: 120000, avgCost: 70000 },
        { id: 'p2', name: 'قهوه', price: 25000, avgCost: 10000 },
      ];
    },
    async findStudents(search) {
      calls.push(`findStudents:${search}`);
      return students.filter((s) => s.fullName.includes(search.trim()));
    },
    async getBalance(id) {
      return { balance: students.find((s) => s.id === id)?.balance ?? 0 };
    },
    async recordSale(body) {
      calls.push(`recordSale:${JSON.stringify(body)}`);
      if (failSale) throw new Error('panel down');
      const total = body.items.reduce((sum, item) => {
        const product = { p1: 120000, p2: 25000 }[item.productId];
        return sum + product * item.qty;
      }, 0);
      return {
        id: 'sale-1',
        total,
        costTotal: 0,
        balanceAfter: body.customer === 'student' ? -5000 - total : null,
      };
    },
    async voidSale(id) {
      calls.push(`voidSale:${id}`);
      return { voided: true, balanceAfter: -5000 };
    },
    async rangeReport() {
      return {
        totals: { saleCount: 3, revenue: 100000, cost: 60000, profit: 40000 },
        outstandingDebt: -5000,
      };
    },
  };
}

// A sink that records what the agent said, for assertions.
function sinkSpy() {
  const spoken = [];
  const events = [];
  return {
    spoken,
    events,
    say(text, meta) {
      spoken.push({ text, ...meta });
    },
    event(type, payload) {
      events.push({ type, payload });
    },
    last() {
      return spoken[spoken.length - 1]?.text ?? '';
    },
  };
}

function makeDialogue({ stage, panel = fakePanel(), brain = { available: false } }) {
  const sink = sinkSpy();
  const dialogue = new Dialogue({
    panel,
    brain,
    stage,
    sink,
    sessionId: 'test',
    defaultLanguage: 'fa',
  });
  dialogue.bindHandlers(makeToolHandlers({ panel, state: dialogue.state }));
  return { dialogue, sink, panel };
}

test('menu and balance flows work with no model at all', async () => {
  const { dialogue, sink } = makeDialogue({ stage: 2 });
  await dialogue.turn('منو چی داری؟');
  assert.match(sink.last(), /پیتزا/);
  assert.match(sink.last(), /تومان/);

  await dialogue.turn('what do you have?');
  // English style ("120,000 toman"), Persian product names (they are data).
  assert.ok(sink.last().includes('120,000 toman'), sink.last());

  await dialogue.turn('مانده علی چقدره؟');
  assert.match(sink.last(), /علی/);
  assert.match(sink.last(), /بدهکار/); // negative balance read plainly as debt
});

test('stage 2: a spoken yes NEVER records — the screen must confirm', async () => {
  const { dialogue, panel } = makeDialogue({ stage: 2 });
  await dialogue.turn('دو تا پیتزا');
  await dialogue.turn('ثبت بشه');
  // The protocol asks for the screen; no sale call happened.
  assert.ok(!panel.calls.some((c) => c.startsWith('recordSale')), panel.calls);
  assert.equal(dialogue.state.phase, 'confirming');

  await dialogue.confirmScreen(); // the operator's screen action records it
  const saleCall = panel.calls.find((c) => c.startsWith('recordSale'));
  assert.ok(saleCall, 'the screen confirm recorded the sale');
  assert.ok(saleCall.includes('walk_in'), 'no student attached → walk-in');
});

test('stage 3: spoken yes AND screen confirm are both required', async () => {
  const { dialogue, panel, sink } = makeDialogue({ stage: 3 });
  await dialogue.turn('دو تا پیتزا');
  await dialogue.turn('ثبت بشه'); // read-back + ask
  await dialogue.turn('بله'); // spoken yes → still waits for the screen
  assert.ok(!panel.calls.some((c) => c.startsWith('recordSale')));
  await dialogue.confirmScreen();
  assert.ok(panel.calls.some((c) => c.startsWith('recordSale')));
  assert.match(sink.last(), /ثبت شد/);
});

test('stage 3: the screen alone is refused without the spoken yes', async () => {
  const { dialogue, panel } = makeDialogue({ stage: 3 });
  await dialogue.turn('دو تا پیتزا');
  await dialogue.turn('ثبت بشه');
  await dialogue.confirmScreen(); // no spoken yes yet
  assert.ok(!panel.calls.some((c) => c.startsWith('recordSale')));
});

test('stage 4: the spoken yes alone records', async () => {
  const { dialogue, panel } = makeDialogue({ stage: 4 });
  await dialogue.turn('دو تا پیتزا');
  await dialogue.turn('ثبت بشه');
  await dialogue.turn('بله');
  assert.ok(panel.calls.some((c) => c.startsWith('recordSale')));
});

test('a student charge flows to the API as a student sale with the balance read back', async () => {
  const { dialogue, panel, sink } = makeDialogue({ stage: 4 });
  await dialogue.turn('یه قهوه');
  await dialogue.turn('به حساب علی');
  await dialogue.turn('ثبت بشه');
  await dialogue.turn('بله');
  const saleCall = panel.calls.find((c) => c.startsWith('recordSale'));
  assert.ok(saleCall.includes('student'), saleCall);
  assert.ok(saleCall.includes('s1'), saleCall);
  assert.match(sink.last(), /مانده جدید/); // new balance spoken plainly
});

test('cart changes after confirmation restart the protocol', async () => {
  const { dialogue, panel } = makeDialogue({ stage: 3 });
  await dialogue.turn('یه قهوه');
  await dialogue.turn('ثبت بشه'); // read-back
  await dialogue.turn('بله'); // spoken yes recorded
  await dialogue.turn('یه پیتزا'); // cart changes → protocol must restart
  assert.equal(dialogue.state.phase, 'idle');
  await dialogue.confirmScreen(); // screen alone must NOT record
  assert.equal(panel.calls.filter((c) => c.startsWith('recordSale')).length, 0);
});

test('voiding returns the money and only touches the session’s last sale', async () => {
  const { dialogue, panel, sink } = makeDialogue({ stage: 4 });
  await dialogue.turn('برگردون');
  assert.match(sink.last(), /فروشی برای ابطال نیست/);

  await dialogue.turn('یه قهوه');
  await dialogue.turn('ثبت بشه');
  await dialogue.turn('بله');
  await dialogue.turn('پشیمونم، برگردون');
  const voidCall = panel.calls.find((c) => c.startsWith('voidSale'));
  assert.ok(voidCall, 'the void reached the API');
  assert.match(sink.last(), /ابطال/);
  assert.match(sink.last(), /مانده جدید/);
});

test('two missed turns hand over to a human', async () => {
  const { dialogue, sink } = makeDialogue({ stage: 2 });
  await dialogue.turn('هوا چطوره؟');
  assert.match(sink.last(), /متوجه نشدم/);
  await dialogue.turn('وغ وغور');
  assert.match(sink.last(), /اپراتور|کارشناس/);
});

test('English dialogue works end to end', async () => {
  const latinPanel = fakePanel();
  const originalList = latinPanel.listProducts.bind(latinPanel);
  latinPanel.listProducts = async () =>
    (await originalList()).map((p) => (p.name === 'قهوه' ? { ...p, name: 'Coffee' } : p));
  const { dialogue, sink, panel } = makeDialogue({ stage: 4, panel: latinPanel });
  await dialogue.turn('one coffee please');
  assert.ok(sink.last().includes('added') || sink.last().includes('Coffee'), sink.last());
  await dialogue.turn('confirm');
  await dialogue.turn('yes');
  assert.ok(panel.calls.some((c) => c.startsWith('recordSale')));
  assert.ok(sink.last().includes('Recorded'), sink.last());
});

test('an LLM brain gets tools but cannot bypass the confirmation gate', async () => {
  // A "model" that immediately tries record_sale — the handler must refuse.
  const brain = {
    available: true,
    label: 'fake-llm',
    async respond({ handlers }) {
      const result = await handlers.record_sale({});
      return { handled: true, spoken: result.ok ? 'recorded' : 'refused' };
    },
  };
  const { dialogue, panel, sink } = makeDialogue({ stage: 4, brain });
  await dialogue.turn('یه قهوه');
  await dialogue.turn('هر کاری لازمه بکن');
  assert.equal(sink.last(), 'refused');
  assert.ok(!panel.calls.some((c) => c.startsWith('recordSale')));
});
