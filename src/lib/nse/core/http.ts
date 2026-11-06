
/**
 * Port of nselib/libutil.py request handling.
 *
 * nselib's `nse_urlfetch(url, origin_url)` first GETs the origin page to obtain session cookies,
 * then GETs the data URL with those cookies and browser-like headers. This module does the same.
 */

export class NseError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "NseError";
    this.status = status;
  }
}

/** Mirrors nselib `default_header`, used when fetching the origin page. */
const ORIGIN_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

/** Mirrors nselib `header`, used for data requests. Values copied as-is from libutil.py. */
const DATA_HEADERS: Record<string, string> = {
  referer: "https://www.nseindia.com/",
  Connection: "keep-alive",
  "Cache-Control": "max-age=0",
  DNT: "1",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Sec-Fetch-User": "?1",
  Accept:
    "ext/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "navigate",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
};

/** Default origin used by nselib's nse_urlfetch. */
export const DEFAULT_ORIGIN = "http://nseindia.com";

const TIMEOUT_MS = 20_000;
const COOKIE_TTL_MS = 2 * 60_000;
const cookieCache = new Map<string, { cookie: string; expires: number }>();

async function withTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new NseError(`Network error fetching ${new URL(url).host}: ${(err as Error).message}`, 502);
  }
}

/** Visits the origin page and keeps its Set-Cookie values for a short time, like nselib's per-call session. */
async function sessionCookie(origin: string): Promise<string> {
  const cached = cookieCache.get(origin);
  if (cached && cached.expires > Date.now()) return cached.cookie;

  const res = await withTimeout(origin, { headers: ORIGIN_HEADERS });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  await res.arrayBuffer().catch(() => undefined);

  cookieCache.set(origin, { cookie, expires: Date.now() + COOKIE_TTL_MS });
  return cookie;
}

/** Equivalent of nselib `nse_urlfetch`. Returns the raw Response. */
export async function nseFetch(url: string, origin: string = DEFAULT_ORIGIN): Promise<Response> {
  const cookie = await sessionCookie(origin);
  return withTimeout(url, { headers: { ...DATA_HEADERS, Cookie: cookie } });
}

/** Fetches bytes and throws a 404 NseError when NSE does not have the file, as nselib's FileNotFoundError. */
export async function fetchFile(url: string, origin?: string, notFoundMessage = "Data not found for this date"): Promise<Buffer> {
  const res = await nseFetch(url, origin);
  if (res.status !== 200) {
    throw new NseError(`${notFoundMessage} (NSE status ${res.status})`, res.status === 403 || res.status === 404 ? 404 : 502);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Fetches JSON. Non-200 and non-JSON responses become NseError. */
export async function fetchJson<T = unknown>(url: string, origin?: string): Promise<T> {
  const res = await nseFetch(url, origin);
  if (res.status !== 200) throw new NseError(`NSE returned status ${res.status}`, res.status === 404 ? 404 : 502);
  try {
    return (await res.json()) as T;
  } catch {
    throw new NseError("NSE returned a non-JSON response (the session may be blocked)", 502);
  }
}

/** Fetches text. Used by the CSV methods. */
export async function fetchText(url: string, origin?: string): Promise<string> {
  const buf = await fetchFile(url, origin);
  return buf.toString("utf-8");
}
