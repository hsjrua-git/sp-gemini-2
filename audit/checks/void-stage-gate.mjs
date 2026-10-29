import assert from 'node:assert/strict';
import { Dialogue } from '../../agent/src/dialogue.js';
import { makeToolHandlers } from '../../agent/src/tools.js';

// Observe real Dialogue/handler boundary calls; no financial data is changed.
// Protocol changes need a maintainer decision (architecture document §10).
const results = [];
for (const scenario of ['stage-2-undo', 'stage-3-negated-undo', 'model-tool']) {
  let voidCalls = 0;
  const panel = {
    async listProducts() { return []; },
    async voidSale() { voidCalls += 1; return { balanceAfter: null }; },
  };
  const brain = scenario === 'model-tool'
    ? { available: true, async respond({ handlers }) { await handlers.void_last_sale(); return { handled: true, spoken: 'done' }; } }
    : { available: false };
  const dialogue = new Dialogue({ panel, brain, stage: scenario === 'stage-2-undo' ? 2 : 3,
    sink: { say() {}, event() {} }, sessionId: 'audit', defaultLanguage: 'en' });
  dialogue.bindHandlers(makeToolHandlers({ panel, state: dialogue.state }));
  dialogue.state.lastSale = { id: 'audit-last-sale', total: 100 };
  await dialogue.turn(scenario === 'stage-2-undo' ? 'undo' : scenario === 'model-tool' ? 'hello' : 'do not undo');
  results.push({ scenario, voidCalls });
}
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.voidCalls === 0), 'no stage-2/3 money change without the required operator confirmation');
