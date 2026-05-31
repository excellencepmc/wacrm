/* eslint-disable @typescript-eslint/no-explicit-any */
import postgres from 'postgres'

// `postgres` (postgres.js) is used instead of `pg` because it has native
// Cloudflare Workers support via `cloudflare:sockets` — no conditional-exports
// tracing mismatch that `pg` + `pg-cloudflare` produce under OpenNext.
//
// SSL: omitted here so the value is taken from `?sslmode=...` in DATABASE_URL.
// Local dev: postgresql://...@localhost:5432/db (no SSL needed)
// Production: postgresql://...@host/db?sslmode=require

declare global {
  // eslint-disable-next-line no-var
  var _pgClient: ReturnType<typeof postgres> | undefined
}

function createClient() {
  return postgres(process.env.DATABASE_URL!, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
  })
}

export const pool =
  globalThis._pgClient ?? (globalThis._pgClient = createClient())

// ── Typed query helpers ───────────────────────────────────────

/** Run a query, return all rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const rows = await pool.unsafe(sql, (params ?? []) as any[])
  return rows as unknown as T[]
}

/** Run a query, return first row or null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await pool.unsafe(sql, (params ?? []) as any[])
  return (rows[0] ?? null) as T | null
}

/** Run a query, return first row (throws if none). */
export async function queryRequired<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T> {
  const rows = await pool.unsafe(sql, (params ?? []) as any[])
  if (!rows[0]) throw new Error('Expected a row but got none')
  return rows[0] as T
}

/** Execute a statement (INSERT/UPDATE/DELETE), return row count. */
export async function execute(
  sql: string,
  params?: unknown[],
): Promise<number> {
  const rows = await pool.unsafe(sql, (params ?? []) as any[])
  return rows.count
}

/** Run multiple statements in a single transaction. */
export async function withTransaction<T>(
  fn: (client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
  }) => Promise<T>,
): Promise<T> {
  return pool.begin(async (txSql) => {
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        const rows = await txSql.unsafe(sql, (params ?? []) as any[])
        return { rows: rows as unknown[], rowCount: rows.count }
      },
    }
    return fn(client)
  }) as unknown as Promise<T>
}
