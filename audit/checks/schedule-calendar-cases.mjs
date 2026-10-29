export default [
  { name: 'weekly control', anchor: '2026-01-25', today: '2026-02-01', every: { days: 7 }, sqlInterval: '7 days', expected: '2026-02-01' },
  { name: 'mid-month control', anchor: '2026-01-15', today: '2026-02-01', every: { months: 1 }, sqlInterval: '1 month', expected: '2026-02-15' },
  { name: 'future anchor control', anchor: '2026-03-31', today: '2026-02-01', every: '1 mon', sqlInterval: '1 month', expected: '2026-03-31' },
  { name: 'month-end nonleap', anchor: '2026-01-31', today: '2026-02-01', every: { months: 1 }, sqlInterval: '1 month', expected: '2026-02-28' },
  { name: 'month-end leap', anchor: '2028-01-31', today: '2028-02-01', every: '1 mon', sqlInterval: '1 month', expected: '2028-02-29' },
];
