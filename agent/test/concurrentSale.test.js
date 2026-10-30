import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dialogue } from '../src/dialogue.js';
import { makeToolHandlers } from '../src/tools.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(stage = 4) {
  const pending = deferred();
  const started = deferred();
  const calls = [];
  const spoken = [];
  const panel = {
    async listProducts() { return [{ id: 'coffee', name: 'Coffee', price: 100 }]; },
    async findStudents() { return [{ id: 's1', fullName: 'Student', balance: 500 }]; },
    async recordSale(body) {
      calls.push(structuredClone(body));
      started.resolve();
      await pending.promise;
      return { id: 'sale-1', total: 100, balanceAfter: null };
    },
  };
  const dialogue = new Dialogue({ panel, stage, brain: { available: false },
    sink: { say(text) { spoken.push(text); }, event() {} }, defaultLanguage: 'en' });
  const handlers = makeToolHandlers({ panel, state: dialogue.state });
  dialogue.bindHandlers(handlers);
  await dialogue.turn('one coffee');
  await dialogue.turn('confirm');
  if (stage === 3) await dialogue.turn('yes');
  return { dialogue, handlers, panel, pending, started, calls, spoken };
}

for (const stage of [2, 3, 4]) {
  test(`stage ${stage}: overlapping screen/speech confirmations submit once`, async () => {
    const f = await fixture(stage);
    const first = stage === 4 ? f.dialogue.turn('yes') : f.dialogue.confirmScreen();
    await f.started.promise;
    const rest = [f.dialogue.confirmScreen(), f.dialogue.confirmScreen(), f.dialogue.turn('yes')];
    f.pending.resolve();
    await Promise.all([first, ...rest]);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].items, [{ productId: 'coffee', qty: 1 }]);
    assert.equal(f.spoken.filter(text => text.startsWith('Recorded')).length, 1);
    assert.equal(f.dialogue.state.cart.length, 0);
  });
}

test('pending sale rejects cart edits, cancellation and direct tool re-entry', async () => {
  const f = await fixture();
  const first = f.dialogue.confirmScreen();
  await f.started.promise;
  try {
    for (const operation of [
      () => f.handlers.add_to_cart({ productName: 'Coffee', qty: 2 }),
      () => f.handlers.remove_from_cart({ productName: 'Coffee' }),
      () => f.handlers.attach_student({ studentId: 's1' }),
      () => f.handlers.request_confirmation(),
      () => f.handlers.record_sale(),
    ]) {
      // Do not await a duplicate adapter call forever in a broken implementation.
      const result = operation();
      if (f.calls.length > 1) { f.pending.resolve(); }
      assert.equal((await result).ok, false);
    }
    await f.dialogue.cancelScreen();
    await f.dialogue.turn('cancel');
    await f.dialogue.turn('two coffee');
    assert.deepEqual(f.dialogue.state.cart.map(({ productId, qty }) => ({ productId, qty })),
      [{ productId: 'coffee', qty: 1 }]);
    assert.equal(f.dialogue.state.student, null);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].customer, 'walk_in');
  } finally {
    f.pending.resolve();
    await first;
  }
  await f.dialogue.turn('two coffee');
  assert.equal(f.dialogue.state.cart[0].qty, 2, 'next order is accepted after completion');
});

test('student lookup started before submission cannot attach to a later cart', async () => {
  const f = await fixture();
  const lookup = deferred();
  f.panel.findStudents = () => lookup.promise;
  const attachment = f.handlers.attach_student({ studentId: 's1' });
  const sale = f.dialogue.confirmScreen();
  await f.started.promise;
  f.pending.resolve();
  await sale;
  await f.dialogue.turn('two coffee');
  lookup.resolve([{ id: 's1', fullName: 'Student', balance: 500 }]);
  assert.equal((await attachment).ok, false);
  assert.equal(f.dialogue.state.student, null);
  assert.equal(f.dialogue.state.cart[0].qty, 2);
});

test('failed submission retains cart and needs fresh confirmation before retry', async () => {
  const f = await fixture(3);
  const sale = f.dialogue.confirmScreen();
  await f.started.promise;
  f.pending.reject(new Error('deliberate adapter failure'));
  await sale;
  await f.dialogue.confirmScreen();
  assert.equal(f.calls.length, 1);
  assert.equal(f.dialogue.state.cart[0].qty, 1);
  f.panel.recordSale = async body => {
    f.calls.push(body);
    return { id: 'sale-2', total: 100, balanceAfter: null };
  };
  await f.dialogue.turn('confirm');
  await f.dialogue.confirmScreen();
  assert.equal(f.calls.length, 1, 'stage 3 still needs spoken yes');
  await f.dialogue.turn('yes');
  await f.dialogue.confirmScreen();
  assert.equal(f.calls.length, 2);
});

test('a model cannot submit a nonempty, unconfirmed cart', async () => {
  const f = await fixture();
  await f.handlers.add_to_cart({ productName: 'Coffee', qty: 1 });
  f.dialogue.brain = { available: true, async respond({ handlers }) {
    const result = await handlers.record_sale();
    return { handled: true, spoken: result.ok ? 'recorded' : 'refused' };
  } };
  await f.dialogue.turn('hello');
  assert.equal(f.spoken.at(-1), 'refused');
  assert.equal(f.calls.length, 0);
  assert.equal(f.dialogue.state.cart[0].qty, 2);
});
