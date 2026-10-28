import { request } from './http.js';

// Cafe sales (the POS). Listing needs `cafe.view`; recording and voiding need
// `cafe.sell`. The student finder lives on the balances endpoints, which the
// server opens to `cafe.sell` OR `cafe.balance` — minimal identity only (name,
// code, balance), so the POS can charge a student without `students.view`.
// Money is whole-number Toman (bigint arrives as a string over JSON);
// quantities may carry up to three decimals (weight/portion goods).

export async function listCafeSales({ from, to, studentId, includeVoided } = {}) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (studentId) query.set('studentId', studentId);
  if (includeVoided) query.set('includeVoided', '1');
  const suffix = query.toString() !== '' ? `?${query.toString()}` : '';
  return request(`/api/cafe/sales${suffix}`);
}

// recordSale resolves to `{ sale }`; for a student charge the sale carries
// `balanceAfter` (prepaid with allowed overdraft — it may be negative).
export function recordSale({ customer, studentId, items, note }) {
  const body = { customer, items };
  if (studentId !== undefined) body.studentId = studentId;
  if (note !== undefined) body.note = note;
  return request('/api/cafe/sales', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// voidSale resolves to `{ voided: true, balanceAfter }`; balanceAfter is null
// for a walk-in sale (nothing to refund).
export function voidSale(id) {
  return request(`/api/cafe/sales/${encodeURIComponent(id)}/void`, {
    method: 'POST',
  });
}

// The POS student finder: returns [{ id, fullName, code, balance }].
export async function searchCafeStudents(search) {
  const query =
    search !== undefined && search !== '' ? `?search=${encodeURIComponent(search)}` : '';
  const data = await request(`/api/cafe/balances/students${query}`);
  return data.students;
}

// Full balance + transaction history for one student
// ({ balance, transactions, truncated }).
export function getStudentBalance(studentId) {
  return request(`/api/cafe/balances/${encodeURIComponent(studentId)}`);
}

// A manual balance event (top-up / refund / signed adjustment); resolves to
// `{ balanceAfter }`. Needs `cafe.balance`.
export function recordBalanceEvent({ studentId, kind, amount, note }) {
  const body = { studentId, kind, amount };
  if (note !== undefined) body.note = note;
  return request('/api/cafe/balances', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
