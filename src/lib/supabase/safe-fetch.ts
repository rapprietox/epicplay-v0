import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type AnyClient = SupabaseClient<Database>;
type TableName = keyof Database["public"]["Tables"];

// Data-reliability batch. Two real, distinct bugs found this session, both
// from the same root cause (an unbounded Supabase/PostgREST query), fixed
// with two different shapes of pagination:
//
// 1. A large INPUT id list: `.in(column, ids)` with a few hundred ids can
//    push the request URL past what PostgREST/the proxy in front of it
//    accepts, and the whole request comes back a flat "Bad Request" --
//    confirmed live against this app's own demo team (~800 at_bat ids).
//    fetchInChunks splits the id list into chunk-sized `.in()` calls.
// 2. A large OUTPUT row count: PostgREST defaults to returning at most
//    1000 rows per request regardless of how few ids were asked for --
//    confirmed live: both the coach dashboard's and KAIROS's own
//    `at_bats` fetch (a handful of game ids, but 1000+ matching rows for
//    a real season) were silently truncated to the first 1000 rows,
//    understating every player's AB. fetchAllRows pages through the full
//    result with `.range()`.
//
// Both throw on any underlying error rather than returning a possibly-
// partial result silently -- every call site in this codebase before this
// batch destructured only `{ data }` and discarded `{ error }`, which is
// exactly how the chunking bug above read as "zero pitches for everyone"
// instead of a visible failure the one time it was caught.

const DEFAULT_CHUNK_SIZE = 150;

/**
 * Runs `.in(column, ids)` in chunks (default 150 ids/request) so a large id
 * list can't exceed a safe request URL size, checks every chunk's response
 * for an error, and throws on the first failure instead of silently
 * returning a partial result.
 */
export async function fetchInChunks<T = Record<string, unknown>>(
  supabase: AnyClient,
  table: TableName,
  column: string,
  ids: string[],
  select: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

  const results = await Promise.all(
    chunks.map((chunk) => supabase.from(table).select(select).in(column, chunk))
  );

  const rows: T[] = [];
  for (const result of results) {
    if (result.error) {
      throw new Error(`fetchInChunks: ${String(table)}.${column} fetch failed: ${result.error.message}`);
    }
    rows.push(...((result.data ?? []) as unknown as T[]));
  }
  return rows;
}

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Pages through every row a query matches (default 1000 rows/request --
 * PostgREST's own default cap) instead of trusting a single unbounded
 * `select()` to return everything, and throws on the first page that
 * errors instead of silently returning a truncated result.
 */
// `applyFilters` takes the query builder returned by `.select()` (still
// chainable -- `.eq()`/`.in()`/`.not()`/etc.) and must return something
// awaitable to `{ data, error }`. Typed loosely (`any` in, cast out through
// `T`) on purpose: expressing Supabase-js's real generic query-builder
// chain type here would mean re-deriving it from `AnyClient`, which buys
// nothing a concrete `select` string plus the caller's own `.eq()`/`.in()`
// chain doesn't already give -- the same "a hand-written stub can't
// express every real join/filter shape" tradeoff this app's own
// supabase/types.ts README already flags. `T` is what keeps the actual
// *rows* this function returns properly typed for every caller.
export async function fetchAllRows<T = Record<string, unknown>>(
  supabase: AnyClient,
  table: TableName,
  select: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilters: (query: any) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const base = supabase.from(table).select(select).range(from, from + pageSize - 1);
    const { data, error } = await applyFilters(base);
    if (error) throw new Error(`fetchAllRows: ${String(table)} fetch failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}
