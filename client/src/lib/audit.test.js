import { describe, expect, it } from 'vitest';
import { CATEGORY_OPTIONS, describeAudit } from './audit.js';

describe('audit presentation', () => {
  it('keeps only live schema-4 categories', () => {
    const categories = CATEGORY_OPTIONS.map((item) => item.value);
    expect(categories).not.toContain('parameter_change');
    expect(categories).not.toContain('settings');
    expect(categories).toContain('cafe_inventory');
    expect(categories).toContain('accounting');
  });

  it('adds useful details to cafe and accounting actions', () => {
    expect(describeAudit({
      action: 'cafe_sale.create',
      details: { itemCount: 2, total: 95000 },
    })).toEqual([{ key: 'cafe_sale.create', params: { count: 2, total: 95000 } }]);
    expect(describeAudit({
      action: 'accounting_entry.post',
      details: { entryNo: 1042 },
    })).toEqual([{ key: 'accounting_entry.post', params: { entryNo: 1042 } }]);
  });
});
