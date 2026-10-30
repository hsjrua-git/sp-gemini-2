// Small pure cart helpers shared by the tools, the intent brain and the
// dialogue renderer.

export function normalizeForMatch(text) {
  return String(text ?? '')
    .replace(/[\u064A\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u200c\u064B-\u0652\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cartTotal(state) {
  return state.cart.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}

export function snapshotCart(state) {
  return state.cart.map((line) => ({ ...line }));
}
