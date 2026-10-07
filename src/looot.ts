// Minimal looot REST client. Plain fetch, no dependencies.
// Endpoints and fields are taken from https://api.looot.ai/openapi.json.

export const DEFAULT_BASE_URL = "https://api.looot.ai";

export class LoootError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LoootError";
    this.status = status;
    this.code = code;
  }
}

export interface JobOverview {
  id: string;
  title: string;
  providerCount: number;
  cheapestPerCall: number | null;
}

export interface Run {
  runId: string;
  status: string;
  result?: unknown;
  normalized?: { fields?: Record<string, unknown> };
  outcome?: string;
  actualCost?: number | null;
  estimatedCost?: number;
  error?: { code?: string; message?: string } | null;
  [key: string]: unknown;
}

export interface Balance {
  available: number;
  reserved: number;
  topUpUrl?: string | null;
  [key: string]: unknown;
}

export interface ClientOptions {
  token?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class Looot {
  baseUrl: string;
  token: string | undefined;
  #fetch: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.LOOOT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.token = (opts.token ?? process.env.LOOOT_TOKEN ?? "").trim() || undefined;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get hasToken(): boolean {
    return this.token !== undefined;
  }

  /** Free, no token. Every job with its cheapest price per call. */
  async jobs(): Promise<JobOverview[]> {
    const data = await this.#request<{ categories?: { platforms?: { jobs?: JobOverview[] }[] }[] }>(
      "GET",
      "/v1/catalog/overview",
      { query: { depth: "jobs" }, auth: false },
    );
    const out: JobOverview[] = [];
    for (const cat of data.categories ?? []) {
      for (const platform of cat.platforms ?? []) out.push(...(platform.jobs ?? []));
    }
    return out;
  }

  /** Free, needs a token with catalog.read. */
  search(q: string, limit = 5): Promise<{ endpoints?: unknown[] }> {
    return this.#request("GET", "/v1/catalog/search", { query: { q, limit } });
  }

  /** Free, needs a token with usage.read. */
  balance(): Promise<Balance> {
    return this.#request("GET", "/v1/balance");
  }

  /**
   * Paid. Runs `job:<job>`; looot picks the provider. The same idempotencyKey with the same
   * input never charges twice, so a rerun of the whole script is safe.
   */
  runJob(job: string, input: Record<string, unknown>, idempotencyKey: string, wait = 30): Promise<Run> {
    return this.#request("POST", "/v1/runs", {
      query: { wait },
      body: { endpointId: `job:${job}`, input, idempotencyKey, fallback: true },
    });
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string | number>; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth !== false) {
      if (!this.token) throw new LoootError(401, "missing_token", `${method} ${path} needs LOOOT_TOKEN`);
      headers.authorization = `Bearer ${this.token}`;
    }
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.#fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(75_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new LoootError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `HTTP ${res.status}`);
    }
    return data as T;
  }
}
