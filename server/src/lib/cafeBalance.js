// One balance change, applied atomically: the balance row is upserted with
// the signed delta (the row lock the UPSERT takes serialises concurrent
// charges), and the transaction row snapshots balance_after so the history
// can always be replayed. OVERDRAFT IS ALLOWED by design — a charge may push
// the balance negative; nothing here refuses it.
//
// MANUAL top-ups and refunds (referenceType null — i.e. not the internal
// refund a sale-void performs) also auto-post their journal pair when the
// mapping is active.

import { postMappedEvent } from './accountingJournal.js';
import { moneyNumber } from './money.js';

export async function applyBalanceChange(
  db,
  { studentId, delta, kind, referenceType = null, referenceId = null, note = null, createdBy }
) {
  const safeDelta = moneyNumber(delta, 'Balance change');
  const balance = await db.query(
    `INSERT INTO student_balances (student_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (student_id)
     DO UPDATE SET balance = student_balances.balance + $2, updated_at = now()
     RETURNING balance`,
    [studentId, safeDelta]
  );
  const balanceAfter = moneyNumber(balance.rows[0].balance, 'Student balance');

  const txn = await db.query(
    `INSERT INTO student_balance_transactions
       (student_id, kind, amount, balance_after, reference_type, reference_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [studentId, kind, safeDelta, balanceAfter, referenceType, referenceId, note, createdBy]
  );

  if (
    (kind === 'topup' || kind === 'refund') &&
    referenceType === null
  ) {
    await postMappedEvent(db, {
      user: { id: createdBy, username: null },
      sourceType: 'balance_txn',
      sourceId: txn.rows[0].id,
      date: null,
      memo: kind === 'topup' ? 'Balance top-up' : 'Balance refund',
      pairs: [{ event: `balance.${kind}`, amount: Math.abs(safeDelta) }],
    });
  }

  return balanceAfter;
}
