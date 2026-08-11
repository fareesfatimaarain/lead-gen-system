/**
 * Search-param parsing.
 *
 * List state lives in the URL, so every list screen has to turn untrusted query
 * strings into bounded values. A hand-edited `?page=99999999` must not become an
 * unbounded OFFSET, and `?status=<anything>` must not reach a Postgres enum
 * comparison and error the page out.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 50;

function first(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed : undefined;
}

export function getPage(params: SearchParams): number {
  const raw = Number(first(params, "page") ?? 1);
  if (!Number.isFinite(raw)) return 1;
  // 200 pages at 50 rows is 10,000 records — past that the answer is a filter,
  // not a deeper offset, and an unbounded OFFSET is a sequential scan.
  return Math.min(Math.max(Math.floor(raw), 1), 200);
}

export function getSearch(params: SearchParams): string | undefined {
  const q = first(params, "q");
  return q ? q.slice(0, 100) : undefined;
}

/**
 * Read a param only if it is one of a known set.
 *
 * Enum columns are the reason this is strict rather than merely escaped: an
 * unrecognized value would be a type error at the database, not an empty result.
 */
export function getEnum<T extends string>(
  params: SearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = first(params, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function getString(params: SearchParams, key: string): string | undefined {
  return first(params, key);
}

/** The values a list screen echoes back into its pager links. */
export function toQueryRecord(params: SearchParams, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((k) => [k, first(params, k)]));
}

export function offsetFor(page: number, pageSize = PAGE_SIZE): number {
  return (page - 1) * pageSize;
}
