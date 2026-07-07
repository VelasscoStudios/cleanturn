export async function apiFetch<T>(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new Error(json.error || `Request failed with status ${res.status}`);
  }

  return json as T;
}
