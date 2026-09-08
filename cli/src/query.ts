export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export type Query = Record<string, QueryValue>;

/**
 * Build a query string. `undefined` and `null` are dropped (the API treats a
 * missing filter and an explicit null differently, and the CLI only ever
 * means "unset"); arrays repeat the key, which is how the API takes
 * multi-valued filters such as industry.
 */
export function buildQuery(query: Query): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(key, String(item));
      }
    } else {
      params.append(key, String(value));
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
