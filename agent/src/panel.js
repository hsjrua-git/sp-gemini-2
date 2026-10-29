// The agent's view of the Student Panel API. The hard rule from the
// architecture doc: the agent is an API USER, never a DB peer — sessions,
// CSRF, permissions and the audit trail apply exactly as they do for a
// human cashier. Zero dependencies: a hand-rolled cookie jar over fetch.

const SAFE_METHOD = /^(GET|HEAD|OPTIONS)$/i;

export class PanelError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'PanelError';
    this.status = status;
    this.code = code;
  }
}

export class Panel {
  constructor({ baseUrl, username, password, fetch: impl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.fetch = impl;
    this.cookies = new Map(); // name -> value
    this.user = null;
  }

  #cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #storeCookies(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /expires=thu, 01 jan 1970/i.test(line)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = { cookie: this.#cookieHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const mutating = !SAFE_METHOD.test(method);
    if (mutating) {
      // Double-submit token (same rule as the SPA's http.js) plus an Origin
      // matching the Host, so both CSRF layers pass.
      const csrf = this.cookies.get('csrf');
      if (csrf) headers['x-csrf-token'] = csrf;
      headers.origin = this.baseUrl;
    }
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.#storeCookies(response);
    let data = null;
    try {
      data = await response.json();
    } catch {
      // no body
    }
    if (!response.ok) {
      throw new PanelError(data?.error ?? `Request failed (${response.status})`, {
        status: response.status,
        code: data?.code ?? null,
      });
    }
    return data;
  }

  async login() {
    // GET /me first so the server issues the readable csrf cookie before the
    // mutating login (mirrors the SPA's boot order).
    await this.request('/api/auth/me').catch(() => {});
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username: this.username, password: this.password },
    });
    this.user = data.user;
    return this.user;
  }

  async logout() {
    await this.request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.user = null;
  }

  // ---- cafe reads (cafe.view) --------------------------------------------

  async listProducts({ includeInactive = false } = {}) {
    const data = await this.request(
      `/api/cafe/products${includeInactive ? '?includeInactive=1' : ''}`
    );
    return data.products.map((p) => ({ ...p, price: Number(p.price), avgCost: Number(p.avgCost) }));
  }

  // Minimal identity only (name/code/balance) — the kiosk role has no
  // students.view by design.
  async findStudents(search) {
    const data = await this.request(
      `/api/cafe/balances/students?search=${encodeURIComponent(search)}`
    );
    return data.students.map((s) => ({ ...s, balance: Number(s.balance) }));
  }

  async getBalance(studentId) {
    const data = await this.request(`/api/cafe/balances/${encodeURIComponent(studentId)}`);
    return { ...data, balance: Number(data.balance) };
  }

  async rangeReport({ from, to }) {
    const data = await this.request(
      `/api/cafe/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    return data;
  }

  // ---- cafe writes (cafe.sell) -------------------------------------------

  async recordSale({ customer, studentId, items, note }) {
    const body = { customer, items };
    if (studentId) body.studentId = studentId;
    if (note) body.note = note;
    const data = await this.request('/api/cafe/sales', { method: 'POST', body });
    return {
      ...data.sale,
      total: Number(data.sale.total),
      costTotal: Number(data.sale.costTotal),
      balanceAfter: data.sale.balanceAfter == null ? null : Number(data.sale.balanceAfter),
    };
  }

  async voidSale(saleId) {
    const data = await this.request(
      `/api/cafe/sales/${encodeURIComponent(saleId)}/void`,
      { method: 'POST' }
    );
    return {
      ...data,
      balanceAfter: data.balanceAfter == null ? null : Number(data.balanceAfter),
    };
  }
}
