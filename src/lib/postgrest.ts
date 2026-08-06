/**
 * A minimal PostgREST client over fetch.
 *
 * This replaces @supabase/postgrest-js with the small slice of it the app
 * actually uses: `from(table)` with the filters, modifiers and the one write
 * verb (`upsert`) that appear in `src/api/*` and `src/chat/*`. Results come
 * back as `{ data, error }` with errors normalised to `{ message }`, so call
 * sites read exactly as they always have. Nothing here knows about React.
 *
 * RLS is honoured the same way supabase-js did it: every request carries the
 * anon `apikey` plus `Authorization: Bearer <token>`, where the token is the
 * signed-in user's access token when there is a session and the anon key when
 * there is not.
 *
 * The builder mutates in place and is awaitable (PromiseLike), which matches
 * how the app composes queries — e.g. building a base query and conditionally
 * adding `.eq()` afterwards without reassigning.
 */

export type PostgrestError = { message: string }

export type PostgrestResult = { data: unknown; error: PostgrestError | null }

export type PostgrestConfig = {
  /** Backend origin, e.g. https://api.aisocratic.org — /rest/v1 is appended. */
  url: string
  anonKey: string
  /** Current session access token, or null to fall back to the anon key. */
  getAccessToken: () => Promise<string | null>
}

/**
 * Quote one element of an `in.(...)` or `cs.{...}` list. PostgREST treats
 * commas, parens and quotes as syntax inside lists, so every value is wrapped
 * in double quotes with inner quotes and backslashes escaped.
 */
function quoteListValue(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value)
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export class PostgrestQuery implements PromiseLike<PostgrestResult> {
  private params: [string, string][] = []
  private orders: string[] = []
  private method: "GET" | "POST" = "GET"
  private body: unknown = undefined
  private prefer: string[] = []
  private wantSingle = false

  constructor(
    private config: PostgrestConfig,
    private table: string,
  ) {}

  select(columns = "*"): this {
    this.params.push(["select", columns])
    if (this.method === "POST") this.prefer.push("return=representation")
    return this
  }

  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): this {
    this.method = "POST"
    this.body = values
    this.prefer.push("resolution=merge-duplicates")
    if (options?.onConflict) this.params.push(["on_conflict", options.onConflict])
    return this
  }

  eq(column: string, value: string | number | boolean): this {
    this.params.push([column, `eq.${value}`])
    return this
  }

  neq(column: string, value: string | number | boolean): this {
    this.params.push([column, `neq.${value}`])
    return this
  }

  gte(column: string, value: string | number): this {
    this.params.push([column, `gte.${value}`])
    return this
  }

  lt(column: string, value: string | number): this {
    this.params.push([column, `lt.${value}`])
    return this
  }

  ilike(column: string, pattern: string): this {
    this.params.push([column, `ilike.${pattern}`])
    return this
  }

  in(column: string, values: (string | number)[]): this {
    this.params.push([column, `in.(${values.map(quoteListValue).join(",")})`])
    return this
  }

  /** `.not("col", "is", null)` — the one negated form the app uses. */
  not(column: string, operator: string, value: string | number | boolean | null): this {
    this.params.push([column, `not.${operator}.${value === null ? "null" : value}`])
    return this
  }

  match(filters: Record<string, string | number | boolean>): this {
    for (const [column, value] of Object.entries(filters)) this.eq(column, value)
    return this
  }

  /** jsonb/array containment: `categories @> ["Research"]`. */
  contains(column: string, values: (string | number)[]): this {
    this.params.push([column, `cs.{${values.map(quoteListValue).join(",")}}`])
    return this
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push(`${column}.${(options?.ascending ?? true) ? "asc" : "desc"}`)
    return this
  }

  limit(count: number): this {
    this.params.push(["limit", String(count)])
    return this
  }

  range(from: number, to: number): this {
    this.params.push(["offset", String(from)])
    this.params.push(["limit", String(to - from + 1)])
    return this
  }

  /** Resolve to the only row, null when there is none, an error beyond one. */
  maybeSingle(): this {
    this.wantSingle = true
    return this
  }

  /** The URL this query executes against — exposed for tests. */
  toUrl(): string {
    const pairs = [...this.params]
    if (this.orders.length) pairs.push(["order", this.orders.join(",")])
    const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    return `${this.config.url}/rest/v1/${this.table}${qs ? `?${qs}` : ""}`
  }

  private async run(): Promise<PostgrestResult> {
    try {
      const token = (await this.config.getAccessToken()) ?? this.config.anonKey
      const headers: Record<string, string> = {
        apikey: this.config.anonKey,
        authorization: `Bearer ${token}`,
        accept: "application/json",
      }
      if (this.body !== undefined) headers["content-type"] = "application/json"
      if (this.prefer.length) headers.prefer = this.prefer.join(",")

      const response = await fetch(this.toUrl(), {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
      })

      const text = await response.text()
      const json: unknown = text ? JSON.parse(text) : null

      if (!response.ok) {
        const details = (json ?? {}) as { message?: unknown; hint?: unknown }
        const message =
          typeof details.message === "string" && details.message
            ? details.message
            : `PostgREST error ${response.status}`
        return { data: null, error: { message } }
      }

      if (this.wantSingle) {
        const rows = Array.isArray(json) ? json : json === null ? [] : [json]
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: `Expected a single row from ${this.table}, got ${rows.length}` },
          }
        }
        return { data: rows[0] ?? null, error: null }
      }

      return { data: json, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  then<TResult1 = PostgrestResult, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }
}

export type PostgrestClient = {
  from(table: string): PostgrestQuery
}

export function createPostgrest(config: PostgrestConfig): PostgrestClient {
  return {
    from: (table: string) => new PostgrestQuery(config, table),
  }
}
