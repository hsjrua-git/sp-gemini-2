import assert from 'node:assert/strict';
import test from 'node:test';
import { Panel } from '../src/panel.js';

for (const [label, balance, expected] of [
  ['absent', undefined, null], ['null', null, null], ['zero', '0', 0],
  ['negative', '-15', -15], ['positive', '20', 20],
]) {
  test(`sale and void responses preserve ${label} balance semantics`, async () => {
    const panel = new Panel({ baseUrl: 'http://audit.invalid', fetch: async (url) => {
      const result = url.endsWith('/void') ? { balanceAfter: balance }
        : { sale: { id: 'sale', total: '15', costTotal: '5', balanceAfter: balance } };
      return new Response(JSON.stringify(result), { status: 201 });
    } });
    const sale = await panel.recordSale({ customer: 'walk_in', items: [] });
    assert.equal(sale.total, 15);
    assert.equal(sale.costTotal, 5);
    assert.equal(sale.balanceAfter, expected);
    assert.equal((await panel.voidSale(sale.id)).balanceAfter, expected);
  });
}
