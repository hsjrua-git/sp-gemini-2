// The cafe tools — the agent's ENTIRE capability boundary, bound to a Panel
// client and the dialogue state. Both brains (the Ollama/OpenAI LLM through
// tool-calling, and the deterministic intent engine) drive these same
// functions; nothing outside them is reachable whatever the model says.
//
// Handlers return PLAIN DATA. Rendering data into Persian/English speech is
// the dialogue's job (phrases.js), so both languages share one logic path.

import { normalizeForMatch, cartTotal, snapshotCart } from './cartMath.js';

export { normalizeForMatch, cartTotal, snapshotCart } from './cartMath.js';

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_products',
      description: 'List the active cafe products with prices / فهرست محصولات فعال کافه با قیمت‌ها',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_students',
      description: 'Find a student by name or code; returns only name, code, balance / جست‌وجوی دانش‌آموز با نام یا کد (فقط نام، کد، مانده)',
      parameters: {
        type: 'object',
        properties: { search: { type: 'string' } },
        required: ['search'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Current balance of one student by id / مانده یک دانش‌آموز با شناسه',
      parameters: {
        type: 'object',
        properties: { studentId: { type: 'string' } },
        required: ['studentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_to_cart',
      description: 'Add a line to the current cart (nothing is recorded yet) / افزودن قلم به سبد (قبل از تأیید چیزی ثبت نمی‌شود)',
      parameters: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          qty: { type: 'number', description: 'up to three decimals / تا سه رقم اعشار' },
        },
        required: ['productName', 'qty'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_cart',
      description: 'Remove a line from the cart / حذف یک قلم از سبد',
      parameters: {
        type: 'object',
        properties: { productName: { type: 'string' } },
        required: ['productName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attach_student',
      description: 'Charge the sale to a student instead of cash / شارژ فروش به حساب دانش‌آموز',
      parameters: {
        type: 'object',
        properties: { studentId: { type: 'string', description: 'student id or name/code' } },
        required: ['studentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_confirmation',
      description: 'Read the cart back and ask for confirmation / خواندن سبد و درخواست تأیید',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_sale',
      description: 'Record the cart as a sale — only the Supervisor may allow this after the confirmation protocol / ثبت نهایی فروش (فقط پس از پروتکل تأیید)',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'void_last_sale',
      description: 'Void the sale recorded in this dialogue / ابطال آخرین فروش همین گفت‌وگو',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sales_report',
      description: 'Today’s sales report (count, revenue, profit, debt) / گزارش فروش امروز',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export function makeToolHandlers({ panel, state }) {
  const findProduct = (name) => {
    const needle = normalizeForMatch(name);
    if (!needle) return undefined;
    return state.products.find((p) => normalizeForMatch(p.name).includes(needle));
  };

  return {
    async list_products() {
      const products = await panel.listProducts();
      state.products = products;
      return { products: products.map((p) => ({ name: p.name, price: p.price })) };
    },

    async find_students({ search }) {
      const students = await panel.findStudents(String(search ?? '').trim());
      return { students: students.slice(0, 5) };
    },

    async get_balance({ studentId }) {
      return panel.getBalance(studentId);
    },

    async add_to_cart({ productName, qty }) {
      const product = findProduct(productName);
      if (!product) return { ok: false, reason: 'not_in_menu' };
      const quantity = Number(qty);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
        return { ok: false, reason: 'invalid_qty' };
      }
      const rounded = Math.round(quantity * 1000) / 1000;
      const existing = state.cart.find((line) => line.productId === product.id);
      if (existing) existing.qty = Math.round((existing.qty + rounded) * 1000) / 1000;
      else {
        state.cart.push({
          productId: product.id,
          productName: product.name,
          qty: rounded,
          unitPrice: product.price,
        });
      }
      state.phase = 'idle';
      state.spokenConfirmed = false;
      state.stageGate = 'closed';
      return { ok: true, product: { name: product.name }, cart: snapshotCart(state) };
    },

    async remove_from_cart({ productName }) {
      const product = findProduct(productName);
      const before = state.cart.length;
      state.cart = state.cart.filter((line) => line.productId !== product?.id);
      if (state.cart.length < before) {
        state.phase = 'idle';
        state.spokenConfirmed = false;
        state.stageGate = 'closed';
      }
      return {
        ok: state.cart.length < before,
        cart: snapshotCart(state),
      };
    },

    async attach_student({ studentId }) {
      const found = await panel.findStudents(String(studentId));
      const student =
        found.find((s) => s.id === studentId) ??
        (found.length === 1 ? found[0] : null);
      if (!student) return { ok: false, reason: 'student_not_found' };
      state.student = { id: student.id, name: student.fullName, balance: student.balance };
      state.phase = 'idle';
      state.spokenConfirmed = false;
      state.stageGate = 'closed';
      return { ok: true, student: { ...state.student } };
    },

    async request_confirmation() {
      if (state.cart.length === 0) return { ok: false, reason: 'empty_cart' };
      state.phase = 'confirming';
      return { ok: true, cart: snapshotCart(state), student: state.student };
    },

    async record_sale({ note } = {}) {
      // The confirmation protocol lives in the Supervisor, never in the
      // model: this refuses unless dialogue.js set stageGate = 'open', which
      // happens only after the protocol completed for THIS cart.
      if (state.stageGate !== 'open') return { ok: false, reason: 'not_confirmed' };
      if (state.cart.length === 0) return { ok: false, reason: 'empty_cart' };
      const sale = await panel.recordSale({
        customer: state.student ? 'student' : 'walk_in',
        studentId: state.student?.id,
        items: state.cart.map((line) => ({ productId: line.productId, qty: line.qty })),
        note: note ? `voice: ${note}` : 'voice',
      });
      state.lastSale = { id: sale.id, total: sale.total };
      const result = {
        ok: true,
        saleId: sale.id,
        total: sale.total,
        balanceAfter: sale.balanceAfter,
      };
      resetCart(state);
      return result;
    },

    async void_last_sale() {
      if (!state.lastSale) return { ok: false, reason: 'nothing_to_void' };
      const target = state.lastSale;
      const result = await panel.voidSale(target.id);
      state.lastSale = null;
      return { ok: true, total: target.total, balanceAfter: result.balanceAfter };
    },

    async sales_report() {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
      const report = await panel.rangeReport({ from: today, to: today });
      return { report };
    },
  };
}

// Clear the cart after a sale; the gate closes with it.
export function resetCart(state) {
  state.cart = [];
  state.student = null;
  state.phase = 'idle';
  state.stageGate = 'closed';
  state.spokenConfirmed = false;
}
