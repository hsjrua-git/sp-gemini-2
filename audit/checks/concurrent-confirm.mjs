import assert from 'node:assert/strict';
import { Dialogue } from '../../agent/src/dialogue.js';
import { makeToolHandlers } from '../../agent/src/tools.js';

let release;
const delayed = new Promise(resolve => { release = resolve; });
const calls = [];
const panel = {
  async listProducts() { return [{ id: 'coffee', name: 'Coffee', price: 100 }]; },
  async recordSale(body) {
    calls.push(structuredClone(body));
    await delayed;
    return { id: `sale-${calls.length}`, total: 100, balanceAfter: null };
  },
};
const dialogue = new Dialogue({ panel, brain: { available: false }, stage: 2,
  sink: { say() {}, event() {} }, sessionId: 'audit', defaultLanguage: 'en' });
dialogue.bindHandlers(makeToolHandlers({ panel, state: dialogue.state }));
await dialogue.turn('one coffee');
await dialogue.turn('confirm');
const first = dialogue.confirmScreen();
const second = dialogue.confirmScreen();
release();
await Promise.all([first, second]);
console.log(`Concurrent confirmations produced ${calls.length} sale requests; expected 1.`);
assert.equal(calls.length, 1, 'one confirmed cart must create exactly one sale');
