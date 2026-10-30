// The SupervisorAgent: the dialogue's state machine and the ONLY place the
// confirmation protocol lives. Money moves when — and only when — this file
// says so:
//   stage ≤ 2  speech never records; the screen Confirm button may (it is
//              the operator's own action, the stage-0 kiosk)
//   stage 3    spoken "yes" AND a screen Confirm press are both required
//   stage 4    the spoken "yes" alone records; the screen shows the receipt
// Any cart change after confirmation restarts the protocol. The yes/no
// patterns are matched literally (intents.js), never by model inference.

import { parseUtterance } from './intents.js';
import { cartTotal } from './cartMath.js';
import { resetCart } from './tools.js';
import { phrases, detectLanguage } from './phrases.js';

const MAX_MISSED = 2;

export class Dialogue {
  constructor({ panel, brain, stage, sink, sessionId, defaultLanguage = 'fa' }) {
    this.panel = panel;
    this.brain = brain; // { available, respond(...) } — may be the rule fallback
    this.stage = stage;
    this.sink = sink; // { say(text, {lang}), event(type, payload) }
    this.sessionId = sessionId;
    this.state = {
      products: [],
      productsLoaded: false,
      cart: [],
      student: null,
      phase: 'idle', // idle | confirming | recording
      saleInFlight: false,
      stageGate: 'closed',
      lastSale: null,
      spokenConfirmed: false,
      lang: defaultLanguage,
      muted: false,
      history: [],
    };
    this.handlers = null; // bound lazily once panel is logged in
    this.missed = 0;
  }

  bindHandlers(handlers) {
    this.handlers = handlers;
  }

  say(text, lang = this.state.lang) {
    this.sink.say(text, { lang });
  }

  publishState() {
    this.sink.event('state', {
      cart: this.state.cart,
      student: this.state.student,
      phase: this.state.phase,
      awaitingScreen: this.state.phase === 'confirming',
      stage: this.stage,
      lang: this.state.lang,
      lastSale: this.lastSaleForReceipt(),
    });
  }

  lastSaleForReceipt() {
    return this.state.lastSale;
  }

  #touch(lang) {
    if (lang && lang !== this.state.lang) this.state.lang = lang;
  }

  #fmtQty(qty) {
    return Number.isInteger(qty) ? String(qty) : qty.toFixed(3);
  }

  async ensureProducts() {
    if (this.state.productsLoaded) return;
    try {
      await this.handlers.list_products();
      this.state.productsLoaded = true;
    } catch {
      // the capability report already told the operator; turns will error
    }
  }

  // One user utterance → one spoken reply.
  async turn(rawText) {
    if (this.state.muted) return;
    const text = String(rawText ?? '').trim();
    if (text === '') return;
    const lang = detectLanguage(text, this.state.lang);
    const t = phrases(lang);
    if (this.state.saleInFlight) {
      this.say(t.saleInProgress(), lang);
      return;
    }
    this.sink.event('turn', { role: 'user', text, lang });

    let spoken;
    try {
      spoken = await this.#route(text, lang, t);
    } catch (err) {
      console.error('[dialogue] turn failed:', err.message);
      spoken = t.error();
      if (!this.state.saleInFlight) {
        this.state.phase = 'idle';
        this.state.stageGate = 'closed';
      }
    }
    this.state.history.push({ role: 'user', content: text }, { role: 'assistant', content: spoken });
    this.state.history = this.state.history.slice(-8);
    this.say(spoken, lang);
    this.publishState();
  }

  async #route(text, lang, t) {
    this.#touch(lang);
    await this.ensureProducts();
    if (this.state.saleInFlight) return t.saleInProgress();
    const parsed = parseUtterance(text, this.state);
    const P = parsed?.params ?? {};
    this.#touch(P.lang);

    // The literal yes/no of the confirmation protocol — before any brain.
    if (parsed?.intent === 'confirm_yes') return this.#onSpokenYes(t);
    if (parsed?.intent === 'confirm_no') {
      return resetCart(this.state) ? t.canceled() : t.saleInProgress();
    }
    if (parsed?.intent === 'switch_language') {
      this.state.lang = P.lang;
      return phrases(P.lang).langSwitched(P.lang);
    }

    // The LLM brain drives free conversation; the intent brain is the
    // fallback (and the only brain when no model is configured).
    if (this.brain?.available) {
      try {
        const result = await this.brain.respond({
          text,
          state: this.state,
          handlers: this.handlers,
          lang: this.state.lang,
        });
        if (result?.handled) return result.spoken;
      } catch (err) {
        console.warn('[dialogue] LLM brain failed, falling back to rules:', err.message);
      }
    }

    return this.#runIntent(parsed, lang, t);
  }

  async #runIntent(parsed, lang, t) {
    if (this.state.saleInFlight) return t.saleInProgress();
    if (!parsed) {
      this.missed += 1;
      if (this.missed >= MAX_MISSED) {
        this.missed = 0;
        return t.handover();
      }
      return t.unrecognized();
    }
    this.missed = 0;
    const h = this.handlers;
    switch (parsed.intent) {
      case 'menu': {
        const { products } = await h.list_products();
        return t.menuList(products);
      }
      case 'balance': {
        if (!parsed.params.search) return t.balanceWho();
        const { students } = await h.find_students({ search: parsed.params.search });
        if (students.length === 0) return t.studentNotFound();
        if (students.length > 1) return t.studentAmbiguous(students.length);
        return t.studentFound(students[0].fullName, students[0].balance);
      }
      case 'add': {
        const result = await h.add_to_cart({ productName: parsed.params.product.name, qty: parsed.params.qty });
        if (result.reason === 'sale_in_progress') return t.saleInProgress();
        if (!result.ok) return result.reason === 'invalid_qty' ? t.invalidQty() : t.notInMenu();
        this.state.phase = 'idle';
        this.state.spokenConfirmed = false;
        return t.added(result.product);
      }
      case 'remove': {
        const result = await h.remove_from_cart({ productName: parsed.params.product.name });
        if (result.reason === 'sale_in_progress') return t.saleInProgress();
        this.state.phase = 'idle';
        this.state.spokenConfirmed = false;
        return result.ok ? t.removed() : t.notInCart();
      }
      case 'attach': {
        const result = await h.attach_student({ studentId: parsed.params.search });
        if (result.reason === 'sale_in_progress') return t.saleInProgress();
        return result.ok ? t.attachStudent(result.student.name, result.student.balance) : t.studentNotFound();
      }
      case 'cancel': {
        return resetCart(this.state) ? t.canceled() : t.saleInProgress();
      }
      case 'void': {
        const result = await h.void_last_sale();
        return result.ok ? t.voided(result.total, result.balanceAfter) : t.nothingToVoid();
      }
      case 'report': {
        const { report } = await h.sales_report();
        return t.report({
          saleCount: report.totals.saleCount,
          revenue: report.totals.revenue,
          profit: report.totals.profit,
          outstandingDebt: report.outstandingDebt,
        });
      }
      case 'confirm_yes': {
        // A yes outside the confirming phase: read the cart back, ask.
        if (this.state.cart.length === 0) return t.emptyCart();
        const result = await h.request_confirmation();
        return result.ok ? t.cartDescription(this.#cartLines(), this.state.student?.name ?? null, cartTotal(this.state)) : t.emptyCart();
      }
      default:
        return t.unrecognized();
    }
  }

  #cartLines() {
    return this.state.cart.map((line) => `${this.#fmtQty(line.qty)} ${line.productName}`);
  }

  // The spoken "yes" while the dialogue is confirming.
  async #onSpokenYes(t) {
    if (this.state.saleInFlight) return t.saleInProgress();
    if (this.state.cart.length === 0) return t.emptyCart();
    if (this.state.phase !== 'confirming') {
      // yes with a cart but no read-back yet → read it back first
      const result = await this.handlers.request_confirmation();
      return result.ok
        ? t.cartDescription(this.#cartLines(), this.state.student?.name ?? null, cartTotal(this.state))
        : t.emptyCart();
    }
    if (this.stage >= 4) {
      return this.#executeSale(t);
    }
    if (this.stage === 3) {
      this.state.spokenConfirmed = true;
      this.sink.event('awaiting_screen', {});
      return t.screenConfirmRequired();
    }
    this.sink.event('awaiting_screen', {});
    return `${t.stageReadOnly()} ${t.screenConfirmRequired()}`;
  }

  // The kiosk screen's Confirm button.
  async confirmScreen() {
    const t = phrases(this.state.lang);
    if (this.state.muted) return;
    if (this.state.saleInFlight) {
      this.say(t.saleInProgress());
      return;
    }
    if (this.state.cart.length === 0 || this.state.phase !== 'confirming') {
      this.say(t.emptyCart());
      return;
    }
    if (this.stage === 3 && !this.state.spokenConfirmed) {
      // stage 3 needs the spoken yes FIRST
      this.say(t.confirmNeeded());
      return;
    }
    try {
      const spoken = await this.#executeSale(t);
      this.say(spoken);
    } catch (err) {
      console.error('[dialogue] confirmScreen failed:', err.message);
      this.state.phase = 'idle';
      this.state.stageGate = 'closed';
      this.state.spokenConfirmed = false;
      this.say(t.error());
      this.publishState();
    }
  }

  async cancelScreen() {
    const t = phrases(this.state.lang);
    this.say(resetCart(this.state) ? t.canceled() : t.saleInProgress());
    this.publishState();
  }

  async #executeSale(t) {
    if (this.state.saleInFlight) return t.saleInProgress();
    this.state.stageGate = 'open';
    let result;
    try {
      const pending = this.handlers.record_sale({ note: `stage-${this.stage}` });
      this.publishState();
      result = await pending;
    } finally {
      this.state.stageGate = 'closed';
      this.state.spokenConfirmed = false;
    }
    if (!result.ok) {
      resetCart(this.state);
      this.publishState();
      return result.reason === 'empty_cart' ? t.emptyCart() : t.notConfirmed();
    }
    this.publishState();
    return t.saleRecorded(result.total, result.balanceAfter);
  }

  setMuted(muted) {
    this.state.muted = muted;
    this.sink.event('muted', { muted });
  }
}
