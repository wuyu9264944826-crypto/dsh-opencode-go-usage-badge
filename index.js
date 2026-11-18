/**
 * Host half of the OpenCode Go usage badge.
 *
 * The browser must never hold the OpenCode API key, so this half reads it from
 * the Harness credential store, asks the official usage endpoint, and answers
 * the Client half over one exact same-origin route. The route is answered from
 * a short cache so several open windows never multiply upstream requests.
 */

/** Official Go usage endpoint: per-window used percentage and reset instant. */
const USAGE_ENDPOINT = 'https://opencode.ai/inference/go/v1/usage';
/** Exact pathname the Client half reads; must not start with the `/api` bridge. */
const ROUTE_PATH = '/plugin-api/opencode-go/usage';
const DEFAULT_KEY_ENV = 'OPENCODE_GO_API_KEY';
const DEFAULT_TIMEOUT_MS = 8_000;
/**
 * Where a click lands. `/console/go` is the public plan page, not the signed-in
 * workspace view, so the default is the Console root and `consoleUrl` in the
 * plugin config pins a workspace page such as
 * `https://opencode.ai/console/<organisation>/activity`.
 */
const DEFAULT_CONSOLE_URL = 'https://opencode.ai/console';
/** Upstream is polled at most this often, whatever the open pages ask for. */
const CACHE_MS = 10_000;

export const inject = ['webServer', 'credentials'];

function clampPercent(raw) {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}

/** Normalize one window: `percent`, `limited`, and an ISO reset instant. */
function normalizeWindow(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const percent = clampPercent(raw.percent);
  if (percent === undefined) return null;
  let resetsAt;
  if (typeof raw.resetsAt === 'string' && raw.resetsAt !== '') resetsAt = raw.resetsAt;
  else if (typeof raw.resetsAt === 'number' && Number.isFinite(raw.resetsAt)) resetsAt = new Date(raw.resetsAt).toISOString();
  const status = typeof raw.status === 'string' ? raw.status : undefined;
  const limited = raw.limited === true || (status !== undefined && status !== 'ok');
  return resetsAt === undefined ? { percent, limited } : { percent, limited, resetsAt };
}

function normalizeUsage(body) {
  const usage = body !== null && typeof body === 'object' ? body.usage : undefined;
  if (usage === null || typeof usage !== 'object') return null;
  const rolling = normalizeWindow(usage.rolling);
  const weekly = normalizeWindow(usage.weekly);
  const monthly = normalizeWindow(usage.monthly);
  if (rolling === null && weekly === null && monthly === null) return null;
  return { rolling, weekly, monthly };
}

async function fetchUsage(apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + apiKey,
        accept: 'application/json',
        'user-agent': 'DeepSeekHarness-opencode-go-badge/1.0',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'auth' };
    if (!response.ok) return { ok: false, reason: 'http', status: response.status };
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return { ok: false, reason: 'shape' };
    }
    const usage = normalizeUsage(body);
    if (usage === null) return { ok: false, reason: 'shape' };
    return { ok: true, usage };
  } catch (error) {
    const aborted = error !== null && typeof error === 'object' && error.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The page runs on the desktop carrier's own `dsh-app://app` origin, so its
 * read is cross-origin even though it is loopback. Echo the caller's origin
 * only when it is that app origin or a loopback web origin; any other page
 * gets no CORS permission and cannot read this route from script.
 */
function permittedOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return undefined;
  try {
    const url = new URL(origin);
    if (url.protocol === 'dsh-app:') return origin;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.hostname === 'localhost' || url.hostname === '::1' || /^127\./.test(url.hostname)) return origin;
    return undefined;
  } catch (error) {
    return undefined;
  }
}

/** Only an absolute http(s) address can become the click target. */
function normalizeConsoleUrl(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    return url.toString();
  } catch (error) {
    return fallback;
  }
}

function jsonResponse(request, payload) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  const origin = request === undefined ? undefined : permittedOrigin(request.headers.get('origin'));
  if (origin !== undefined) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'origin';
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const keyEnv = typeof settings.apiKeyEnv === 'string' && settings.apiKeyEnv !== ''
    ? settings.apiKeyEnv
    : DEFAULT_KEY_ENV;
  const timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0
    ? settings.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  /** Config owns the click target; the Client half mirrors whatever this answers. */
  const consoleUrl = normalizeConsoleUrl(settings.consoleUrl, DEFAULT_CONSOLE_URL);

  /** Last answer and the upstream request still running, if any. */
  let cache;
  let inFlight;

  const readOnce = async (force) => {
    const now = Date.now();
    if (!force && cache !== undefined && now - cache.at < CACHE_MS) return cache.value;
    if (inFlight !== undefined) return inFlight;

    const task = (async () => {
      let resolved;
      try {
        resolved = await ctx.credentials.resolve(keyEnv);
      } catch (error) {
        resolved = undefined;
      }
      const apiKey = resolved !== undefined && resolved !== null && typeof resolved.value === 'string'
        ? resolved.value.trim()
        : '';
      const value = apiKey === ''
        ? { ok: false, reason: 'no-key', fetchedAt: Date.now() }
        : { ...(await fetchUsage(apiKey, timeoutMs)), fetchedAt: Date.now() };
      cache = { at: Date.now(), value };
      return value;
    })();

    inFlight = task;
    try {
      return await task;
    } finally {
      inFlight = undefined;
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    /** GET/HEAD only; anything else is answered 405 by the server itself. */
    resource: async (request) => {
      let query;
      try {
        query = new URL(request.url).searchParams;
      } catch (error) {
        query = new URLSearchParams();
      }
      const result = await readOnce(query.get('force') === '1');
      /** The URL rides with every answer, including failures, so a click still lands somewhere useful. */
      return jsonResponse(request, { ...result, consoleUrl });
    },
  }), 'opencode-go-badge: usage route');
}
