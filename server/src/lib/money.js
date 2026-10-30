// PostgreSQL bigint values arrive as decimal strings. The current HTTP/client
// contract uses JavaScript numbers, so crossing that boundary is allowed only
// while the integer is exactly representable. Never silently round money.
export const MAX_SAFE_MONEY = Number.MAX_SAFE_INTEGER;
const MAX_SAFE_BIGINT = BigInt(MAX_SAFE_MONEY);

export function moneyNumber(value, label = 'Money amount') {
  let exact;
  try {
    exact = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    const err = new Error(`${label} is not a whole Toman amount.`);
    err.status = 400;
    err.code = 'VALIDATION_INVALID_TYPE';
    throw err;
  }
  if (exact > MAX_SAFE_BIGINT || exact < -MAX_SAFE_BIGINT) {
    const err = new Error(
      `${label} exceeds the largest amount this interface can represent exactly.`
    );
    err.status = 409;
    err.code = 'MONEY_OUT_OF_RANGE';
    err.params = { max: String(MAX_SAFE_MONEY) };
    throw err;
  }
  return Number(exact);
}

export function sumMoney(values, label = 'Money total') {
  const exact = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return moneyNumber(exact, label);
}
