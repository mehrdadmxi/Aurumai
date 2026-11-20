import {
  extractAdminTokenFromHeaders,
  issueAdminSessionToken,
  verifyAdminCredentials,
  verifyAdminSessionToken,
} from '../../src/lib/adminAuth.ts';
import {
  calculateOverallTechnicalScore,
  classifyGeminiRetryAction,
  DEFAULT_XAUUSD_SOURCES,
  evaluateSignalValidity,
  filterXauusdTradingViewUrls,
  formatGeminiErrorMessage,
  isApifyApiToken,
  isExplicitNonGoldSymbol,
  maskSecret,
  mergeNewsTranslations,
  normalizeNewsTimestamp,
  parseApiKeyPool,
  parseGoogleNewsRss,
  parsePercentChange,
  parseTradingViewPrice,
  parseTradingViewScannerGold,
  resolveApifyToken,
  sanitizeNewsSummary,
  validateImageFileMeta,
} from '../../src/lib/tradingRules.ts';
import type {
  AdminOverviewPayload,
  AnalysisReport,
  ApiConnectionStatus,
  ApiHealthSummary,
  ApifyStatusPayload,
  ChartInspectionResult,
  GoldMarketData,
  Language,
  NewsFeedState,
  NewsItem,
  SignalDecision,
  SystemConfig,
  TimeframeSlot,
} from '../../src/types.ts';

interface PagesContext {
  request: Request;
  env: Record<string, string | undefined>;
  params: { path?: string | string[] };
}

interface UploadedChartInput {
  timeframe: TimeframeSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  confirmedTimeframe?: boolean;
}

const DEFAULT_APIFY_ACTOR_ID = 'hOfycUMuUpaFZvG7a';
const MIN_MANUAL_REFRESH_MS = 10_000;
const REFERENCE_DISCLAIMER =
  'GoldAPI spot price is a reference market price and not the exact executable price of every broker.';

const isolateConfig: SystemConfig = {
  freeDailyQuota: 3,
  vipDailyQuota: 25,
  goldCacheSeconds: 60,
  supportedLanguages: ['fa', 'en'],
  vipOverrideEnabled: false,
  persistentBackendConfigured: true,
};

let isolateGoldCache: GoldMarketData | null = null;
let isolateGoldApiKeySignature = '';
let isolateGoldAttemptMs = 0;
let isolateGoldSuccessAt: string | null = null;
let isolateGoldLastError: string | null = null;
const isolateTicks: Array<{ time: string; price: number }> = [];

let isolateNewsCache: NewsFeedState | null = null;
let isolateNewsApiKeySignature = '';
let isolateNewsAttemptMs = 0;
let isolateNewsSuccessAt: string | null = null;
let isolateNewsLastError: string | null = null;
const isolateTranslations = new Map<string, { headlineFa: string; summaryFa?: string }>();

const isolateKeyCooldowns = new Map<string, number>();
let isolateRoundRobin = 0;
let isolateGeminiSuccessAt: string | null = null;
let isolateGeminiLastError: string | null = null;

const isolateUsage = new Map<string, { date: string; count: number }>();
const isolateLogs: AdminOverviewPayload['recentAnalyses'] = [];

let isolateApifySources = [...DEFAULT_XAUUSD_SOURCES];
let isolateApifySummary: string | null = null;
let isolateApifySyncAt: string | null = null;
let isolateApifyLastError: string | null = null;
let isolateApifyActorName: string | null = null;
let isolateApifySchemaDetected = false;
let isolateApifySchemaKeys: string[] = [];
let isolateApifyLastItemsCount = 0;
let isolateApifyLastStatus: ApiConnectionStatus = 'disconnected';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getClientKey(request: Request): string {
  return (
    request.headers.get('x-client-id')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'cf-client'
  );
}

function getUsage(clientKey: string): number {
  const today = getTodayKey();
  const entry = isolateUsage.get(clientKey);
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

function incUsage(clientKey: string): void {
  const today = getTodayKey();
  isolateUsage.set(clientKey, { date: today, count: getUsage(clientKey) + 1 });
}

async function checkAdmin(
  request: Request,
  env: Record<string, string | undefined>
): Promise<Response | null> {
  const token = extractAdminTokenFromHeaders(request.headers);
  const verified = await verifyAdminSessionToken(token, env);
  if (!verified.valid) {
    return jsonRes(
      {
        error: 'Admin authorization required. Please sign in with valid admin credentials.',
        code: 'ADMIN_UNAUTHORIZED',
      },
      401
    );
  }
  return null;
}

function stripDataUrlPrefix(b64: string): string {
  const idx = b64.indexOf(',');
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

function normalizeDecision(raw: string | undefined): SignalDecision {
  const upper = (raw || '').trim().toUpperCase();
  if (upper === 'BUY') return 'BUY';
  if (upper === 'SELL') return 'SELL';
  return 'NO TRADE';
}

function isModelOrConfigFallbackError(msg: string): boolean {
  const lower = (msg || '').toLowerCase();
  return (
    lower.includes('http 404') ||
    lower.includes('not_found') ||
    lower.includes('not found') ||
    lower.includes('is not supported') ||
    lower.includes('thinkingconfig') ||
    lower.includes('thinking_level') ||
    lower.includes('http 400')
  );
}

async function callGeminiRestWithPool(
  env: Record<string, string | undefined>,
  params: {
    model: string;
    contents: unknown;
    systemInstruction: string;
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
    responseSchema: unknown;
    timeoutMs: number;
    maxTotalMs?: number;
    maxTransientAttempts?: number;
  }
): Promise<string> {
  const keys = parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS);
  if (keys.length === 0) {
    throw Object.assign(
      new Error('Gemini API is not configured in Cloudflare environment variables.'),
      { code: 'GEMINI_NOT_CONFIGURED' }
    );
  }

  const now = Date.now();
  const startIdx = isolateRoundRobin % keys.length;
  isolateRoundRobin = (isolateRoundRobin + 1) % keys.length;
  const rotated = keys.map((_, i) => keys[(startIdx + i) % keys.length]);

  const healthy: string[] = [];
  const cooling: Array<{ key: string; until: number }> = [];
  for (const k of rotated) {
    const authUntil = isolateKeyCooldowns.get(`*::${k}`) || 0;
    const modelUntil = isolateKeyCooldowns.get(`${params.model}::${k}`) || 0;
    const until = Math.max(authUntil, modelUntil);
    if (now >= until) healthy.push(k);
    else cooling.push({ key: k, until });
  }
  cooling.sort((a, b) => a.until - b.until);
  const ordered = [...healthy, ...cooling.map((c) => c.key)];

  const startedAt = Date.now();
  let transientCount = 0;
  let lastError: unknown;

  for (let i = 0; i < ordered.length; i++) {
    if (params.maxTotalMs && i > 0 && Date.now() - startedAt >= params.maxTotalMs) break;

    const apiKey = ordered[i];
    const remaining = params.maxTotalMs
      ? Math.max(3000, params.maxTotalMs - (Date.now() - startedAt))
      : params.timeoutMs;
    const timeoutMs = Math.min(params.timeoutMs, remaining);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        params.model
      )}:generateContent`;

      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema: params.responseSchema,
      };
      if (params.thinkingLevel) {
        generationConfig.thinkingConfig = { thinkingLevel: params.thinkingLevel };
      }

      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: params.systemInstruction }] },
          contents: params.contents,
          generationConfig,
        }),
        timeoutMs,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }

      const payload = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = payload.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('')
        .trim();

      if (!text) {
        throw new Error('Gemini returned an empty response.');
      }
      isolateKeyCooldowns.delete(`${params.model}::${apiKey}`);
      isolateKeyCooldowns.delete(`*::${apiKey}`);
      isolateGeminiSuccessAt = new Date().toISOString();
      isolateGeminiLastError = null;
      return text;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err || '');
      const action = classifyGeminiRetryAction(msg);
      if (action === 'fatal') throw err;
      if (action === 'rotate_cooldown') {
        isolateKeyCooldowns.set(`${params.model}::${apiKey}`, Date.now() + 30 * 60_000);
      } else if (action === 'rotate_auth') {
        isolateKeyCooldowns.set(`*::${apiKey}`, Date.now() + 6 * 60 * 60_000);
      } else if (action === 'retry_transient') {
        isolateKeyCooldowns.set(`${params.model}::${apiKey}`, Date.now() + 3 * 60_000);
        transientCount += 1;
        if (params.maxTransientAttempts && transientCount >= params.maxTransientAttempts) break;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'Gemini request failed.'));
}

async function callGeminiWithModelFallbacks(
  env: Record<string, string | undefined>,
  attempts: Array<{
    model: string;
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
    timeoutMs: number;
    maxTotalMs?: number;
    maxTransientAttempts?: number;
  }>,
  baseParams: {
    contents: unknown;
    systemInstruction: string;
    responseSchema: unknown;
  }
): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      return await callGeminiRestWithPool(env, {
        ...baseParams,
        ...attempt,
      });
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err || '');
      const errCode = (err as { code?: string } | undefined)?.code;
      if (errCode === 'GEMINI_NOT_CONFIGURED') throw err;

      const isLast = i === attempts.length - 1;
      if (isLast) break;

      const action = classifyGeminiRetryAction(msg);
      const allowModelFallback =
        action === 'rotate_cooldown' ||
        action === 'retry_transient' ||
        isModelOrConfigFallbackError(msg);
      if (!allowModelFallback) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Gemini request failed.'));
}

async function fetchLiveMarketGoldFallback(
  env: Record<string, string | undefined>,
  apiKey: string,
  options: { sourceLabel: string; warningError?: string | null }
): Promise<GoldMarketData | null> {
  const actorId = env.APIFY_ACTOR_ID?.trim() || DEFAULT_APIFY_ACTOR_ID;
  const apifyToken = isApifyApiToken(apiKey)
    ? apiKey
    : resolveApifyToken(env.APIFY_API_TOKEN, env.GOLDAPI_API_KEY);

  let spotPrice: number | null = null;
  let spotFetchedAt: string | null = null;
  let tvQuote: ReturnType<typeof parseTradingViewScannerGold> = null;
  let apifyPrice: number | null = null;
  let apifyChangePct: number | null = null;

  const [tvRes, goldApiRes, apifyLastRes] = await Promise.allSettled([
    fetchWithTimeout('https://scanner.tradingview.com/cfd/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: { tickers: ['OANDA:XAUUSD', 'TVC:GOLD'] },
        columns: ['close', 'open', 'high', 'low', 'change', 'change_abs'],
      }),
      timeoutMs: 5500,
    }),
    fetchWithTimeout('https://api.gold-api.com/price/XAU', { timeoutMs: 5500 }),
    apifyToken
      ? fetchWithTimeout(
          `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs/last/dataset/items?status=SUCCEEDED&limit=3`,
          {
            headers: { Authorization: `Bearer ${apifyToken}` },
            timeoutMs: 4000,
          }
        )
      : Promise.resolve(null),
  ]);

  if (tvRes.status === 'fulfilled' && tvRes.value.ok) {
    const tvJson = await tvRes.value.json().catch(() => null);
    tvQuote = parseTradingViewScannerGold(tvJson);
  }

  if (goldApiRes.status === 'fulfilled' && goldApiRes.value.ok) {
    const spotJson = (await goldApiRes.value.json().catch(() => ({}))) as {
      price?: number;
      updatedAt?: string;
    };
    if (typeof spotJson.price === 'number' && Number.isFinite(spotJson.price)) {
      spotPrice = +spotJson.price.toFixed(2);
      spotFetchedAt = spotJson.updatedAt || new Date().toISOString();
    }
  }

  if (apifyLastRes.status === 'fulfilled' && apifyLastRes.value && apifyLastRes.value.ok) {
    const items = (await apifyLastRes.value.json().catch(() => [])) as Array<{
      symbol?: string;
      price?: unknown;
      change?: unknown;
    }>;
    if (Array.isArray(items)) {
      const goldItem =
        items.find((it) => {
          const s = (it.symbol || '').toUpperCase();
          return s.includes('GOLD') || s.includes('XAUUSD');
        }) || items[0];
      if (goldItem) {
        apifyPrice = parseTradingViewPrice(goldItem.price);
        apifyChangePct = parsePercentChange(goldItem.change);
      }
    }
  }

  if (spotPrice === null && !tvQuote && apifyPrice === null && apifyToken) {
    try {
      const runRes = await fetchWithTimeout(
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=25`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apifyToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbols: ['TVC:GOLD'] }),
          timeoutMs: 28000,
        }
      );
      if (runRes.ok) {
        const items = (await runRes.json().catch(() => [])) as Array<{
          symbol?: string;
          price?: unknown;
          change?: unknown;
        }>;
        const goldItem = Array.isArray(items) ? items[0] : undefined;
        if (goldItem) {
          apifyPrice = parseTradingViewPrice(goldItem.price);
          apifyChangePct = parsePercentChange(goldItem.change);
        }
      }
    } catch {
      // ignore Apify run fallback error
    }
  }

  const finalPrice = spotPrice ?? tvQuote?.price ?? apifyPrice;
  if (finalPrice === null) {
    return null;
  }

  const fetchedAt = spotFetchedAt || new Date().toISOString();
  const prevClose = tvQuote?.prevClose ?? null;
  const change =
    tvQuote?.change !== null && tvQuote?.change !== undefined
      ? tvQuote.change
      : prevClose !== null
        ? +(finalPrice - prevClose).toFixed(2)
        : null;
  const changePercent = tvQuote?.changePercent ?? apifyChangePct;

  return {
    symbol: 'XAUUSD',
    price: finalPrice,
    prevClose,
    open: tvQuote?.open ?? null,
    high: tvQuote?.high ?? null,
    low: tvQuote?.low ?? null,
    change,
    changePercent,
    bid: null,
    ask: null,
    timestamp: Math.floor(Date.parse(fetchedAt) / 1000) || Math.floor(Date.now() / 1000),
    fetchedAt,
    source: options.sourceLabel,
    isCached: false,
    isStale: false,
    status: 'connected',
    error: options.warningError ?? null,
    disclaimer: REFERENCE_DISCLAIMER,
  };
}

async function fetchGoldData(
  env: Record<string, string | undefined>,
  forceRefresh = false
): Promise<GoldMarketData> {
  const rawKey = env.GOLDAPI_API_KEY?.trim() || '';
  const apiKey = rawKey === 'MY_GOLDAPI_API_KEY' ? '' : rawKey;

  const now = Date.now();
  const ttlMs = Math.max(15, isolateConfig.goldCacheSeconds) * 1000;
  const sameKey = apiKey === isolateGoldApiKeySignature;
  if (isolateGoldCache && sameKey && !forceRefresh && now - isolateGoldAttemptMs < ttlMs) {
    return { ...isolateGoldCache, isCached: true, isStale: false };
  }
  if (isolateGoldCache && sameKey && forceRefresh && now - isolateGoldAttemptMs < MIN_MANUAL_REFRESH_MS) {
    return {
      ...isolateGoldCache,
      isCached: true,
      isStale: now - isolateGoldAttemptMs > ttlMs,
    };
  }

  isolateGoldApiKeySignature = apiKey;
  isolateGoldAttemptMs = now;
  try {
    if (!apiKey || isApifyApiToken(apiKey)) {
      const sourceLabel = isApifyApiToken(apiKey)
        ? 'Apify + TradingView Live'
        : 'TradingView + Gold-API Live';
      const liveFallback = await fetchLiveMarketGoldFallback(env, apiKey, {
        sourceLabel,
        warningError: null,
      });
      if (liveFallback) {
        isolateGoldCache = liveFallback;
        isolateGoldSuccessAt = liveFallback.fetchedAt;
        isolateGoldLastError = null;
        isolateTicks.push({ time: liveFallback.fetchedAt!, price: liveFallback.price! });
        if (isolateTicks.length > 60) isolateTicks.shift();
        return liveFallback;
      }

      const msg = apiKey
        ? 'Unable to retrieve XAUUSD spot price via Apify or live fallback feeds.'
        : 'GOLDAPI_API_KEY is not configured and live fallback feeds are currently unreachable.';
      isolateGoldLastError = msg;
      return {
        symbol: 'XAUUSD',
        price: null,
        prevClose: null,
        open: null,
        high: null,
        low: null,
        change: null,
        changePercent: null,
        bid: null,
        ask: null,
        timestamp: null,
        fetchedAt: null,
        source: sourceLabel,
        isCached: false,
        isStale: true,
        status: apiKey ? 'error' : 'disconnected',
        error: msg,
        disclaimer: REFERENCE_DISCLAIMER,
      };
    }

    const res = await fetchWithTimeout('https://www.goldapi.io/api/XAU/USD', {
      method: 'GET',
      headers: { 'x-access-token': apiKey, 'Content-Type': 'application/json' },
      timeoutMs: 8000,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let detail = `GoldAPI returned HTTP ${res.status}`;
      let isQuotaError = res.status === 429;
      try {
        const parsedErr = JSON.parse(errBody) as { code?: string; error?: string };
        if (parsedErr.code === 'MONTHLY_API_QUOTA_EXCEEDED') {
          isQuotaError = true;
          detail = 'GoldAPI monthly quota exceeded (MONTHLY_API_QUOTA_EXCEEDED).';
        } else if (parsedErr.error) {
          detail = `GoldAPI error: ${parsedErr.error}`;
        }
      } catch {
        if (res.status === 401 || res.status === 403) {
          detail = 'GoldAPI authentication failed (invalid or expired GOLDAPI_API_KEY).';
        } else if (res.status === 429) {
          detail = 'GoldAPI rate limit or monthly quota reached.';
        }
      }

      const fallbackLive = await fetchLiveMarketGoldFallback(env, apiKey, {
        sourceLabel: 'Gold-API + TradingView (fallback)',
        warningError: isQuotaError ? `${detail} Using live fallback reference price.` : detail,
      });
      if (fallbackLive) {
        isolateGoldCache = fallbackLive;
        isolateGoldSuccessAt = fallbackLive.fetchedAt;
        isolateGoldLastError = detail;
        isolateTicks.push({ time: fallbackLive.fetchedAt!, price: fallbackLive.price! });
        if (isolateTicks.length > 60) isolateTicks.shift();
        return fallbackLive;
      }

      throw new Error(detail);
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const price = typeof raw.price === 'number' ? raw.price : null;
    if (price === null || !Number.isFinite(price)) {
      throw new Error('GoldAPI returned an unexpected payload without a valid XAUUSD price.');
    }

    const prevClose = typeof raw.prev_close_price === 'number' ? raw.prev_close_price : null;
    const fetchedAt = new Date().toISOString();
    const fresh: GoldMarketData = {
      symbol: 'XAUUSD',
      price,
      prevClose,
      open: typeof raw.open_price === 'number' ? raw.open_price : null,
      high: typeof raw.high_price === 'number' ? raw.high_price : null,
      low: typeof raw.low_price === 'number' ? raw.low_price : null,
      change:
        typeof raw.ch === 'number'
          ? raw.ch
          : prevClose !== null
            ? +(price - prevClose).toFixed(2)
            : null,
      changePercent:
        typeof raw.chp === 'number'
          ? raw.chp
          : prevClose && prevClose > 0
            ? +(((price - prevClose) / prevClose) * 100).toFixed(2)
            : null,
      bid: typeof raw.bid === 'number' ? raw.bid : null,
      ask: typeof raw.ask === 'number' ? raw.ask : null,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Math.floor(Date.now() / 1000),
      fetchedAt,
      source: 'GoldAPI (goldapi.io)',
      isCached: false,
      isStale: false,
      status: 'connected',
      error: null,
      disclaimer: REFERENCE_DISCLAIMER,
    };

    isolateGoldCache = fresh;
    isolateGoldSuccessAt = fetchedAt;
    isolateGoldLastError = null;
    isolateTicks.push({ time: fetchedAt, price });
    if (isolateTicks.length > 60) isolateTicks.shift();
    return fresh;
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'GoldAPI request timed out after 8 seconds.'
        : err instanceof Error
          ? err.message
          : 'GoldAPI request failed.';
    isolateGoldLastError = msg;
    if (isolateGoldCache) {
      return { ...isolateGoldCache, isCached: true, isStale: true, status: 'error', error: msg };
    }
    return {
      symbol: 'XAUUSD',
      price: null,
      prevClose: null,
      open: null,
      high: null,
      low: null,
      change: null,
      changePercent: null,
      bid: null,
      ask: null,
      timestamp: null,
      fetchedAt: null,
      source: 'GoldAPI (goldapi.io)',
      isCached: false,
      isStale: true,
      status: 'error',
      error: msg,
      disclaimer: REFERENCE_DISCLAIMER,
    };
  }
}

function classifyNewsCategory(text: string): NewsItem['category'] {
  const lower = text.toLowerCase();
  if (lower.includes('fed') || lower.includes('fomc') || lower.includes('powell') || lower.includes('rate')) {
    return 'Fed / FOMC';
  }
  if (lower.includes('central bank') || lower.includes('ecb') || lower.includes('boj') || lower.includes('pboc')) {
    return 'Central Banks';
  }
  if (lower.includes('cpi') || lower.includes('inflation') || lower.includes('pce')) return 'Inflation (CPI/PCE)';
  if (lower.includes('payroll') || lower.includes('nfp') || lower.includes('unemployment')) return 'Labor (NFP/Jobs)';
  if (lower.includes('war') || lower.includes('geopolit') || lower.includes('conflict')) return 'Geopolitics';
  if (lower.includes('yield') || lower.includes('treasury') || lower.includes('bond')) return 'US Rates & Yields';
  return 'USD Index';
}

function classifyGoldImpact(text: string): NewsItem['goldImpact'] {
  const lower = text.toLowerCase();
  const bull = ['rate cut', 'dovish', 'geopolit', 'inflation rises', 'gold surges', 'gold rises', 'safe-haven'].some(
    (k) => lower.includes(k)
  );
  const bear = ['rate hike', 'hawkish', 'dollar surges', 'strong payroll', 'gold falls', 'gold drops'].some((k) =>
    lower.includes(k)
  );
  if (bull && !bear) return 'Bullish';
  if (bear && !bull) return 'Bearish';
  return 'Mixed / Volatile';
}

async function fetchGoogleNewsRssItems(timeoutMs = 8000): Promise<NewsItem[]> {
  const rssUrl =
    'https://news.google.com/rss/search?q=XAUUSD+OR+%22gold+price%22+OR+%22Federal+Reserve%22+OR+FOMC+OR+CPI&hl=en-US&gl=US&ceid=US:en';
  const res = await fetchWithTimeout(rssUrl, {
    headers: { 'User-Agent': 'AurumAI-News/1.0' },
    timeoutMs,
  });
  if (!res.ok) {
    throw new Error(`Google News RSS returned HTTP ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parseGoogleNewsRss(xml, 12);
  parsed.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return parsed.map((entry) => {
    const publishedMs = Date.parse(entry.publishedAt);
    const ageHours = Number.isFinite(publishedMs)
      ? (Date.now() - publishedMs) / (1000 * 60 * 60)
      : 0;
    return {
      id: entry.id,
      headline: entry.headline,
      source: entry.source,
      publishedAt: entry.publishedAt,
      category: classifyNewsCategory(entry.headline),
      goldImpact: classifyGoldImpact(entry.headline),
      isDelayed: ageHours > 2,
      ...(entry.url ? { url: entry.url } : {}),
    };
  });
}

async function fetchNewsFeed(
  env: Record<string, string | undefined>,
  lang: Language,
  forceRefresh = false
): Promise<NewsFeedState> {
  const apiKey = env.NEWS_API_KEY?.trim() || '';
  const isAskNews = Boolean(apiKey && apiKey.startsWith('ank_'));
  const isNewsData = Boolean(apiKey && apiKey.startsWith('pub_'));
  const providerName = !apiKey
    ? 'Google News RSS'
    : isAskNews
      ? 'AskNews'
      : isNewsData
        ? 'NewsData.io'
        : 'NewsAPI';

  const now = Date.now();
  const sameKey = apiKey === isolateNewsApiKeySignature;
  let feed: NewsFeedState | null = null;
  if (isolateNewsCache && sameKey && !forceRefresh && now - isolateNewsAttemptMs < 15 * 60_000) {
    feed = isolateNewsCache;
  } else {
    isolateNewsApiKeySignature = apiKey;
    isolateNewsAttemptMs = now;
    let primaryError: string | null = null;
    const items: NewsItem[] = [];
    let resolvedProvider = providerName;

    if (apiKey) {
      try {
        if (isAskNews) {
          const url = new URL('https://api.asknews.app/v1/news/search');
          url.searchParams.set('query', 'XAUUSD OR gold OR "Federal Reserve" OR FOMC OR CPI OR inflation');
          url.searchParams.set('n_articles', '12');
          url.searchParams.set('method', 'kw');
          url.searchParams.set('return_type', 'dicts');
          url.searchParams.set('languages', 'en');
          const res = await fetchWithTimeout(url.toString(), {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeoutMs: 9000,
          });
          if (!res.ok) {
            throw new Error(`AskNews returned HTTP ${res.status}`);
          }
          const raw = (await res.json()) as {
            as_dicts?: Array<{
              article_id?: string;
              title?: string;
              eng_title?: string;
              summary?: string | null;
              source_id?: string;
              domain_url?: string;
              pub_date?: string;
              article_url?: string;
            }>;
          };
          for (const r of (raw.as_dicts || []).slice(0, 12)) {
            const title = (r.eng_title || r.title || '').trim();
            if (!title) continue;
            const summary = sanitizeNewsSummary(r.summary);
            const combined = `${title} ${summary || ''}`;
            const publishedAt = normalizeNewsTimestamp(r.pub_date);
            const ageHours = (Date.now() - Date.parse(publishedAt)) / (1000 * 60 * 60);
            items.push({
              id: r.article_id || r.article_url || crypto.randomUUID(),
              headline: title,
              ...(summary && summary !== title ? { summary } : {}),
              source: (r.source_id || r.domain_url || 'AskNews').trim(),
              publishedAt,
              category: classifyNewsCategory(combined),
              goldImpact: classifyGoldImpact(combined),
              isDelayed: ageHours > 2,
              url: r.article_url,
            });
          }
        } else if (isNewsData) {
          const url = new URL('https://newsdata.io/api/1/latest');
          url.searchParams.set('apikey', apiKey);
          url.searchParams.set('qInTitle', 'gold OR XAUUSD OR Fed OR FOMC OR inflation OR CPI OR dollar');
          url.searchParams.set('language', 'en');
          url.searchParams.set('category', 'business');
          const res = await fetchWithTimeout(url.toString(), { timeoutMs: 9000 });
          if (!res.ok) {
            throw new Error(`NewsData.io returned HTTP ${res.status}`);
          }
          const raw = (await res.json()) as {
            status?: string;
            results_message?: string;
            results?:
              | { message?: string }
              | Array<{
                  article_id?: string;
                  title?: string;
                  description?: string;
                  source_name?: string;
                  source_id?: string;
                  pubDate?: string;
                  pubDateTZ?: string;
                  link?: string;
                }>;
          };
          if (raw.status && raw.status !== 'success') {
            const errDetail =
              raw.results_message ||
              (!Array.isArray(raw.results) ? raw.results?.message : undefined) ||
              'NewsData.io returned an error response.';
            throw new Error(errDetail);
          }
          const resultsArr = Array.isArray(raw.results) ? raw.results : [];
          for (const r of resultsArr.slice(0, 12)) {
            if (!r.title) continue;
            const summary = sanitizeNewsSummary(r.description);
            const combined = `${r.title} ${summary || ''}`;
            const publishedAt = normalizeNewsTimestamp(r.pubDate, r.pubDateTZ);
            const ageHours = (Date.now() - Date.parse(publishedAt)) / (1000 * 60 * 60);
            items.push({
              id: r.article_id || r.link || crypto.randomUUID(),
              headline: r.title.trim(),
              ...(summary && summary !== r.title ? { summary } : {}),
              source: (r.source_name || r.source_id || 'NewsData.io').trim(),
              publishedAt,
              category: classifyNewsCategory(combined),
              goldImpact: classifyGoldImpact(combined),
              isDelayed: ageHours > 2,
              url: r.link,
            });
          }
        } else {
          const url = new URL('https://newsapi.org/v2/everything');
          url.searchParams.set(
            'q',
            '(gold OR XAUUSD OR "Federal Reserve" OR FOMC OR CPI OR PCE OR NFP OR "US Dollar" OR "Treasury yields")'
          );
          url.searchParams.set('language', 'en');
          url.searchParams.set('sortBy', 'publishedAt');
          url.searchParams.set('pageSize', '12');
          const res = await fetchWithTimeout(url.toString(), {
            headers: { 'X-Api-Key': apiKey, 'User-Agent': 'AurumAI-Cloudflare/1.0' },
            timeoutMs: 9000,
          });
          if (!res.ok) {
            throw new Error(`NewsAPI returned HTTP ${res.status}`);
          }
          const raw = (await res.json()) as {
            status?: string;
            message?: string;
            articles?: Array<{
              title?: string;
              description?: string;
              source?: { name?: string };
              publishedAt?: string;
              url?: string;
            }>;
          };
          if (raw.status === 'error') {
            throw new Error(raw.message || 'NewsAPI returned an error response.');
          }
          for (const a of raw.articles || []) {
            if (!a.title || a.title === '[Removed]') continue;
            const summary = sanitizeNewsSummary(a.description);
            const combined = `${a.title} ${summary || ''}`;
            const publishedAt = normalizeNewsTimestamp(a.publishedAt);
            const ageHours = (Date.now() - Date.parse(publishedAt)) / (1000 * 60 * 60);
            items.push({
              id: a.url || crypto.randomUUID(),
              headline: a.title.trim(),
              ...(summary && summary !== a.title ? { summary } : {}),
              source: a.source?.name || 'NewsAPI',
              publishedAt,
              category: classifyNewsCategory(combined),
              goldImpact: classifyGoldImpact(combined),
              isDelayed: ageHours > 2,
              url: a.url,
            });
          }
        }
      } catch (err) {
        primaryError = err instanceof Error ? err.message : 'Failed to fetch primary news provider.';
      }
    }

    if (items.length === 0) {
      try {
        const rssItems = await fetchGoogleNewsRssItems(8000);
        if (rssItems.length > 0) {
          items.push(...rssItems);
          resolvedProvider = apiKey ? `${providerName} → Google News RSS (fallback)` : 'Google News RSS';
        }
      } catch (rssErr) {
        const rssMsg = rssErr instanceof Error ? rssErr.message : 'Google News RSS fallback failed.';
        const combinedError = primaryError ? `${primaryError}; ${rssMsg}` : rssMsg;
        isolateNewsLastError = combinedError;
        if (isolateNewsCache) {
          feed = { ...isolateNewsCache, status: 'error', error: combinedError };
        } else {
          return {
            providerConfigured: Boolean(apiKey),
            providerName,
            status: 'error',
            lastFetchedAt: null,
            error: combinedError,
            items: [],
          };
        }
      }
    }

    if (!feed) {
      const fetchedAt = new Date().toISOString();
      if (items.length > 0) {
        feed = {
          providerConfigured: true,
          providerName: resolvedProvider,
          status: 'connected',
          lastFetchedAt: fetchedAt,
          error: primaryError,
          items,
        };
        isolateNewsCache = feed;
        isolateNewsSuccessAt = fetchedAt;
        isolateNewsLastError = primaryError;
      } else {
        const msg = primaryError || 'No macroeconomic gold news articles were returned.';
        isolateNewsLastError = msg;
        return {
          providerConfigured: Boolean(apiKey),
          providerName,
          status: 'error',
          lastFetchedAt: null,
          error: msg,
          items: [],
        };
      }
    }
  }

  if (lang !== 'fa' || feed.items.length === 0) return feed;

  const pending: NewsItem[] = [];
  const cached: Array<{ id: string; headlineFa?: string; summaryFa?: string }> = [];
  for (const item of feed.items) {
    const hit = isolateTranslations.get(`${item.id}::${item.headline}`);
    if (hit) cached.push({ id: item.id, ...hit });
    else pending.push(item);
  }
  let merged = cached.length > 0 ? mergeNewsTranslations(feed.items, cached) : feed.items;

  if (pending.length > 0 && parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS).length > 0) {
    try {
      const rawJson = await callGeminiWithModelFallbacks(
        env,
        [
          {
            model: 'gemini-3.1-flash-lite',
            thinkingLevel: 'MINIMAL',
            timeoutMs: 5_000,
            maxTotalMs: 7_500,
            maxTransientAttempts: 3,
          },
          {
            model: 'gemini-3-flash-preview',
            thinkingLevel: 'MINIMAL',
            timeoutMs: 6_500,
            maxTotalMs: 9_000,
            maxTransientAttempts: 3,
          },
        ],
        {
          systemInstruction:
            'You are a professional financial translator specializing in macroeconomics, Federal Reserve policy, inflation, and XAUUSD gold news. Translate English headlines and summaries into concise, accurate Persian (Farsi) without adding invented facts.',
          contents: [
            {
              parts: [
                {
                  text: `Translate the following financial/economic news items accurately into natural, professional Persian (Farsi) used by gold (XAUUSD) and forex traders. Keep financial tickers/abbreviations like XAUUSD, FOMC, CPI, PCE, NFP, DXY, Fed clear and accurate.\n\nItems:\n${JSON.stringify(
                    pending.map((p) => ({
                      id: p.id,
                      headline: p.headline,
                      summary: (p.summary || '').slice(0, 180),
                    }))
                  )}`,
                },
              ],
            },
          ],
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                headlineFa: { type: 'STRING' },
                summaryFa: { type: 'STRING' },
              },
              required: ['id', 'headlineFa'],
            },
          },
        }
      );

      const cleanJson = rawJson
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(cleanJson) as Array<{
        id: string;
        headlineFa?: string;
        summaryFa?: string;
      }>;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const src = pending.find((p) => p.id === entry.id);
          if (src && entry.headlineFa?.trim()) {
            isolateTranslations.set(`${src.id}::${src.headline}`, {
              headlineFa: entry.headlineFa.trim(),
              ...(entry.summaryFa?.trim() ? { summaryFa: entry.summaryFa.trim() } : {}),
            });
          }
        }
        merged = mergeNewsTranslations(merged, parsed);
        if (isolateNewsCache) {
          isolateNewsCache = { ...isolateNewsCache, items: merged };
        }
      }
    } catch {
      // Serve English items gracefully if translation times out or fails
    }
  }

  return { ...feed, items: merged };
}

function getApifyStatusSnapshot(env: Record<string, string | undefined>): ApifyStatusPayload {
  const token = resolveApifyToken(env.APIFY_API_TOKEN, env.GOLDAPI_API_KEY);
  const actorId = env.APIFY_ACTOR_ID?.trim() || DEFAULT_APIFY_ACTOR_ID;
  const configured = Boolean(token);
  return {
    actorId,
    configured,
    status: configured ? isolateApifyLastStatus : 'disconnected',
    lastSyncedAt: isolateApifySyncAt,
    lastError: configured
      ? isolateApifyLastError
      : 'APIFY_API_TOKEN is not configured in Cloudflare environment variables.',
    actorName: isolateApifyActorName,
    inputSchemaDetected: isolateApifySchemaDetected,
    inputSchemaKeys: isolateApifySchemaKeys,
    xauusdSources: isolateApifySources,
    supplementarySummary: isolateApifySummary,
    lastRunItemsCount: isolateApifyLastItemsCount,
  };
}

function buildActorInputFromSchema(
  properties: Record<string, { type?: string }>
): Record<string, unknown> | null {
  const xauusdUrls = isolateApifySources.map((s) => s.url);
  const xauusdSymbols = isolateApifySources.map((s) => s.symbol);
  const keys = Object.keys(properties);
  if (keys.length === 0) return null;

  const input: Record<string, unknown> = {};
  for (const key of keys) {
    const lower = key.toLowerCase();
    const fieldType = properties[key]?.type;
    if (lower === 'starturls' && fieldType === 'array') {
      input[key] = xauusdUrls.map((url) => ({ url }));
    } else if ((lower === 'urls' || lower === 'charturls' || lower === 'links') && fieldType === 'array') {
      input[key] = xauusdUrls;
    } else if ((lower === 'url' || lower === 'charturl') && fieldType === 'string') {
      input[key] = xauusdUrls[0];
    } else if ((lower === 'symbols' || lower === 'tickers') && fieldType === 'array') {
      input[key] = xauusdSymbols.slice(0, 1);
    } else if ((lower === 'symbol' || lower === 'ticker') && fieldType === 'string') {
      input[key] = 'TVC:GOLD';
    }
  }
  return Object.keys(input).length > 0 ? input : null;
}

async function runApifySupplementarySync(
  env: Record<string, string | undefined>
): Promise<ApifyStatusPayload> {
  const token = resolveApifyToken(env.APIFY_API_TOKEN, env.GOLDAPI_API_KEY);
  const actorId = env.APIFY_ACTOR_ID?.trim() || DEFAULT_APIFY_ACTOR_ID;

  if (!token) {
    isolateApifyLastStatus = 'disconnected';
    isolateApifyLastError =
      'APIFY_API_TOKEN is not configured in Cloudflare environment variables.';
    return getApifyStatusSnapshot(env);
  }

  try {
    const metaRes = await fetchWithTimeout(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 8000,
      }
    );
    if (!metaRes.ok) {
      throw new Error(`Apify Actor metadata inspection failed (HTTP ${metaRes.status}).`);
    }

    const metaJson = (await metaRes.json()) as {
      data?: {
        name?: string;
        title?: string;
        taggedBuilds?: { latest?: { buildId?: string } };
      };
    };
    const actorName = metaJson.data?.title || metaJson.data?.name || actorId;
    isolateApifyActorName = actorName;

    let properties: Record<string, { type?: string }> = {};
    const buildId = metaJson.data?.taggedBuilds?.latest?.buildId;
    if (buildId) {
      const buildRes = await fetchWithTimeout(
        `https://api.apify.com/v2/actor-builds/${encodeURIComponent(buildId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 8000,
        }
      );
      if (buildRes.ok) {
        const buildJson = (await buildRes.json()) as {
          data?: { inputSchema?: string | { properties?: Record<string, { type?: string }> } };
        };
        const rawSchema = buildJson.data?.inputSchema;
        if (typeof rawSchema === 'string') {
          try {
            const parsed = JSON.parse(rawSchema) as {
              properties?: Record<string, { type?: string }>;
            };
            properties = parsed.properties || {};
          } catch {
            properties = {};
          }
        } else if (rawSchema && typeof rawSchema === 'object') {
          properties = rawSchema.properties || {};
        }
      }
    }

    const schemaKeys = Object.keys(properties);
    isolateApifySchemaDetected = schemaKeys.length > 0;
    isolateApifySchemaKeys = schemaKeys;

    const mappedInput = buildActorInputFromSchema(properties);
    if (!mappedInput) {
      const msg =
        schemaKeys.length === 0
          ? `Inspected Actor ${actorId} (${actorName}), but no compatible input schema properties were exposed for XAUUSD URL mapping.`
          : `Inspected Actor ${actorId} schema keys [${schemaKeys.join(', ')}], none matched XAUUSD URL/symbol fields. Skipping actor execution.`;
      isolateApifyLastStatus = 'error';
      isolateApifyLastError = msg;
      return getApifyStatusSnapshot(env);
    }

    const runRes = await fetchWithTimeout(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=25`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mappedInput),
        timeoutMs: 28000,
      }
    );
    if (!runRes.ok) {
      throw new Error(`Apify Actor execution failed (HTTP ${runRes.status}).`);
    }

    const items = (await runRes.json()) as unknown;
    const itemList = Array.isArray(items) ? items : [];
    const xauItems = itemList.filter((item) => !JSON.stringify(item).toUpperCase().includes('BTCUSD'));

    isolateApifySyncAt = new Date().toISOString();
    isolateApifyLastStatus = 'connected';
    isolateApifyLastError = null;
    isolateApifyLastItemsCount = xauItems.length;
    isolateApifySummary =
      xauItems.length > 0
        ? `Retrieved ${xauItems.length} supplementary XAUUSD TradingView records from Actor ${actorId}.`
        : `Actor ${actorId} completed with 0 XAUUSD items; analysis relies primarily on uploaded charts and GoldAPI.`;

    return getApifyStatusSnapshot(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected failure communicating with Apify.';
    isolateApifyLastStatus = 'error';
    isolateApifyLastError = msg;
    return getApifyStatusSnapshot(env);
  }
}

const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    finalDecision: { type: 'STRING' },
    marketDirection: { type: 'STRING' },
    chartInspections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          timeframeSlot: { type: 'STRING' },
          isFinancialChart: { type: 'BOOLEAN' },
          detectedSymbol: { type: 'STRING' },
          isXauusdOrGold: { type: 'BOOLEAN' },
          detectedTimeframe: { type: 'STRING' },
          matchesSelectedSlot: { type: 'BOOLEAN' },
          isReadable: { type: 'BOOLEAN' },
          priceAxisVisible: { type: 'BOOLEAN' },
          timeAxisVisible: { type: 'BOOLEAN' },
          visibleIndicators: { type: 'ARRAY', items: { type: 'STRING' } },
          appearsIncompleteOrStale: { type: 'BOOLEAN' },
          extractedCurrentPrice: { type: 'NUMBER', nullable: true },
          notes: { type: 'STRING' },
        },
        required: [
          'timeframeSlot',
          'isFinancialChart',
          'detectedSymbol',
          'isXauusdOrGold',
          'detectedTimeframe',
          'matchesSelectedSlot',
          'isReadable',
          'priceAxisVisible',
          'timeAxisVisible',
          'visibleIndicators',
          'appearsIncompleteOrStale',
          'notes',
        ],
      },
    },
    analysis1H: {
      type: 'OBJECT',
      properties: {
        mainTrend: { type: 'STRING' },
        marketStructure: { type: 'STRING' },
        importantLevels: { type: 'STRING' },
        technicalObservations: { type: 'STRING' },
      },
      required: ['mainTrend', 'marketStructure', 'importantLevels', 'technicalObservations'],
    },
    analysis15M: {
      type: 'OBJECT',
      properties: {
        marketStructure: { type: 'STRING' },
        liquidity: { type: 'STRING' },
        bosChochMss: { type: 'STRING' },
        fvgOrderBlocks: { type: 'STRING' },
        importantLevels: { type: 'STRING' },
      },
      required: ['marketStructure', 'liquidity', 'bosChochMss', 'fvgOrderBlocks', 'importantLevels'],
    },
    analysis5M: {
      type: 'OBJECT',
      properties: {
        entryConfirmation: { type: 'STRING' },
        candlestickConfirmation: { type: 'STRING' },
        entryZone: { type: 'STRING' },
        setupValidity: { type: 'STRING' },
      },
      required: ['entryConfirmation', 'candlestickConfirmation', 'entryZone', 'setupValidity'],
    },
    tradingPlan: {
      type: 'OBJECT',
      properties: {
        entryZone: { type: 'STRING' },
        entryPrice: { type: 'NUMBER', nullable: true },
        stopLoss: { type: 'NUMBER', nullable: true },
        takeProfit1: { type: 'NUMBER', nullable: true },
        takeProfit2: { type: 'NUMBER', nullable: true },
        takeProfit3: { type: 'NUMBER', nullable: true },
        entryTimeframe: { type: 'STRING' },
        invalidationLevel: { type: 'STRING' },
        invalidationPrice: { type: 'NUMBER', nullable: true },
        plannedVsCurrentNote: { type: 'STRING' },
      },
      required: ['entryZone', 'entryTimeframe', 'invalidationLevel', 'plannedVsCurrentNote'],
    },
    scores: {
      type: 'OBJECT',
      properties: {
        priceAction: { type: 'NUMBER', nullable: true },
        marketStructure: { type: 'NUMBER', nullable: true },
        volume: { type: 'NUMBER', nullable: true },
        candlestickConfirmation: { type: 'NUMBER', nullable: true },
        multiTimeframeAlignment: { type: 'NUMBER', nullable: true },
        fundamentalContext: { type: 'NUMBER', nullable: true },
        explanations: {
          type: 'OBJECT',
          properties: {
            priceAction: { type: 'STRING' },
            marketStructure: { type: 'STRING' },
            volume: { type: 'STRING' },
            candlestickConfirmation: { type: 'STRING' },
            multiTimeframeAlignment: { type: 'STRING' },
            fundamentalContext: { type: 'STRING' },
          },
          required: [
            'priceAction',
            'marketStructure',
            'volume',
            'candlestickConfirmation',
            'multiTimeframeAlignment',
            'fundamentalContext',
          ],
        },
      },
      required: ['explanations'],
    },
    fundamentalContext: {
      type: 'OBJECT',
      properties: {
        relevantEvents: { type: 'STRING' },
        newsImpact: { type: 'STRING' },
        usdContext: { type: 'STRING' },
        riskConditions: { type: 'STRING' },
      },
      required: ['relevantEvents', 'newsImpact', 'usdContext', 'riskConditions'],
    },
    setupInvalidation: { type: 'STRING' },
    detailedExplanation: {
      type: 'OBJECT',
      properties: {
        decisionReason: { type: 'STRING' },
        supportingConfirmations: { type: 'STRING' },
        timeframeAlignment: { type: 'STRING' },
        invalidationConditions: { type: 'STRING' },
        priceProximityCheck: { type: 'STRING' },
      },
      required: [
        'decisionReason',
        'supportingConfirmations',
        'timeframeAlignment',
        'invalidationConditions',
        'priceProximityCheck',
      ],
    },
  },
  required: [
    'finalDecision',
    'marketDirection',
    'chartInspections',
    'analysis1H',
    'analysis15M',
    'analysis5M',
    'tradingPlan',
    'scores',
    'fundamentalContext',
    'setupInvalidation',
    'detailedExplanation',
  ],
};

const SYSTEM_INSTRUCTION = `You are Aurum AI, an institutional-grade XAUUSD (Gold) multi-timeframe Smart Money Concepts (SMC) & Price Action trading analyst.
Your primary objective is to examine THREE chart screenshots together (1H, 15M, and 5M) and deliver a clear, actionable trading plan ("BUY" or "SELL") whenever the charts show a readable price structure and a valid Risk-to-Reward setup (>= 1:1.5), while filtering out non-chart uploads or genuinely untradeable chop.

OPERATING RULES:
1. Practical Chart Inspection:
   - Determine whether each image is a financial candlestick/bar/line chart with a readable price scale.
   - Trust the user's slot assignment (1H, 15M, 5M) even if TradingView's top-left symbol/timeframe badge is cropped, abbreviated (e.g., 60/15/5/H1/M15/M5), or partially hidden.
   - Only mark isXauusdOrGold = false if the screenshot EXPLICITLY shows a different non-Gold symbol (such as BTCUSD, ETHUSD, EURUSD, NAS100, US30).
   - If an image is NOT a financial chart or has NO readable price numbers anywhere on the chart, set finalDecision to "NO TRADE".

2. Multi-Timeframe Trade Synthesis (1H -> 15M -> 5M):
   - A retracement/pullback on 15M or 5M against the 1H trend is NORMAL in real markets (it creates discount buys in a bullish 1H trend or premium sells in a bearish 1H trend). Do NOT treat a lower-timeframe pullback as a "conflict" requiring NO TRADE.

3. Strict Evidence & Non-Fabrication Rules:
   - ONLY cite indicators visibly rendered on the screenshots. If Volume is NOT visible, set volumeScore to null.
   - Read prices directly from the visible chart price axis on the screenshots.

4. Signal & Risk-to-Reward Construction:
   - Actively provide a "BUY" or "SELL" plan whenever a directional edge and clear structural SL/TP levels exist on the screenshots.
   - Analyze based on the uploaded charts' own price scale even if GoldAPI live price differs. Note any price gap vs GoldAPI in plannedVsCurrentNote without forcing NO TRADE.
   - Always ensure Entry, Stop Loss, TP1, TP2, and TP3 satisfy RR >= 1.5 at TP1:
     - BUY: stopLoss < entryPrice < takeProfit1 <= takeProfit2 <= takeProfit3.
     - SELL: stopLoss > entryPrice > takeProfit1 >= takeProfit2 >= takeProfit3.`;

export async function onRequest(context: PagesContext): Promise<Response> {
  try {
    const { request, env = {} } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token, x-client-id',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (path === '/api/health' && method === 'GET') {
      const geminiKeys = parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS);
      const apifyToken = resolveApifyToken(env.APIFY_API_TOKEN, env.GOLDAPI_API_KEY);
      return jsonRes({
        ok: true,
        service: 'Aurum AI (Cloudflare Pages)',
        timestamp: new Date().toISOString(),
        configuredApis: {
          gemini: geminiKeys.length > 0,
          geminiKeyCount: geminiKeys.length,
          goldApi: Boolean(env.GOLDAPI_API_KEY?.trim()),
          newsApi: Boolean(env.NEWS_API_KEY?.trim()),
          apify: Boolean(apifyToken),
        },
      });
    }

    if (path === '/api/market/gold' && method === 'GET') {
      const market = await fetchGoldData(env, url.searchParams.get('refresh') === '1');
      return jsonRes({ market, sessionTicks: isolateTicks });
    }

    if (path === '/api/market/apify' && method === 'GET') {
      return jsonRes(getApifyStatusSnapshot(env));
    }

    if (path === '/api/news' && method === 'GET') {
      const lang: Language = url.searchParams.get('lang') === 'en' ? 'en' : 'fa';
      const feed = await fetchNewsFeed(env, lang, url.searchParams.get('refresh') === '1');
      return jsonRes(feed);
    }

    if (path === '/api/subscription/status' && method === 'GET') {
      const clientKey = getClientKey(request);
      const tier = isolateConfig.vipOverrideEnabled ? 'VIP' : 'FREE';
      const dailyLimit = tier === 'VIP' ? isolateConfig.vipDailyQuota : isolateConfig.freeDailyQuota;
      const usedToday = getUsage(clientKey);
      return jsonRes({
        tier,
        dailyLimit,
        usedToday,
        remainingToday: Math.max(0, dailyLimit - usedToday),
        config: isolateConfig,
      });
    }

    if (path === '/api/analyze' && method === 'POST') {
      const clientKey = getClientKey(request);
      const tier = isolateConfig.vipOverrideEnabled ? 'VIP' : 'FREE';
      const dailyLimit = tier === 'VIP' ? isolateConfig.vipDailyQuota : isolateConfig.freeDailyQuota;
      const usedToday = getUsage(clientKey);
      if (usedToday >= dailyLimit) {
        return jsonRes(
          {
            error: `Daily analysis quota reached (${usedToday}/${dailyLimit} for ${tier} plan).`,
            code: 'QUOTA_EXCEEDED',
          },
          429
        );
      }

      let body: { charts?: UploadedChartInput[]; language?: Language };
      try {
        body = (await request.json()) as { charts?: UploadedChartInput[]; language?: Language };
      } catch {
        return jsonRes({ error: 'Malformed JSON request payload.', code: 'INVALID_JSON' }, 400);
      }

      const language: Language = body?.language === 'en' ? 'en' : 'fa';
      const charts = body?.charts || [];
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          };
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode('\n'));
            } catch {
              // stream closed
            }
          }, 5000);

          try {
            send({
              type: 'stage',
              stage: 1,
              totalStages: 7,
              stageKey: 'validating_charts',
              message:
                language === 'fa'
                  ? 'در حال اعتبارسنجی تصاویر آپلودشده (1H, 15M, 5M)...'
                  : 'Validating uploaded 1H, 15M, and 5M charts...',
            });

            if (!Array.isArray(charts) || charts.length !== 3) {
              throw Object.assign(new Error('Exactly three charts (1H, 15M, 5M) are required.'), {
                code: 'MISSING_IMAGES',
              });
            }

            const slotMap = new Map<TimeframeSlot, UploadedChartInput>();
            for (const chart of charts) {
              if (!['1H', '15M', '5M'].includes(chart.timeframe)) {
                throw new Error(`Invalid timeframe slot: ${chart.timeframe}`);
              }
              const check = validateImageFileMeta({
                mimeType: chart.mimeType,
                sizeBytes: chart.sizeBytes,
                base64: chart.base64,
              });
              if (!check.valid) {
                throw new Error(check.errorMessage || 'Invalid chart image.');
              }
              slotMap.set(chart.timeframe, chart);
            }

            const chart1H = slotMap.get('1H');
            const chart15M = slotMap.get('15M');
            const chart5M = slotMap.get('5M');
            if (!chart1H || !chart15M || !chart5M) {
              throw new Error('All three distinct timeframes (1H, 15M, 5M) are required.');
            }

            if (parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS).length === 0) {
              isolateGeminiLastError =
                'GEMINI_API_KEY / GEMINI_API_KEYS is not configured in Cloudflare environment variables.';
              throw Object.assign(
                new Error('Gemini API is not configured in Cloudflare environment variables.'),
                { code: 'GEMINI_NOT_CONFIGURED' }
              );
            }

            send({
              type: 'stage',
              stage: 2,
              totalStages: 7,
              stageKey: 'reading_1h',
              message:
                language === 'fa'
                  ? 'در حال بررسی ساختار تایم‌فریم 1H و همگام‌سازی داده‌ها...'
                  : 'Preparing 1H directional context and market references...',
            });

            const withSoftTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
              Promise.race([
                p,
                new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
              ]);

            const currentApify = getApifyStatusSnapshot(env);
            const [goldData, newsState, apifyState] = await Promise.all([
              fetchGoldData(env, false),
              withSoftTimeout(
                fetchNewsFeed(env, 'en', false).catch(
                  (): NewsFeedState => ({
                    providerConfigured: Boolean(env.NEWS_API_KEY?.trim()),
                    providerName: env.NEWS_API_KEY?.trim()?.startsWith('ank_')
                      ? 'AskNews'
                      : env.NEWS_API_KEY?.trim()?.startsWith('pub_')
                        ? 'NewsData.io'
                        : 'NewsAPI',
                    status: 'disconnected',
                    lastFetchedAt: null,
                    error: 'Unavailable',
                    items: [],
                  })
                ),
                5000,
                {
                  providerConfigured: Boolean(env.NEWS_API_KEY?.trim()),
                  providerName: env.NEWS_API_KEY?.trim()?.startsWith('ank_')
                    ? 'AskNews'
                    : env.NEWS_API_KEY?.trim()?.startsWith('pub_')
                      ? 'NewsData.io'
                      : 'NewsAPI',
                  status: 'disconnected' as const,
                  lastFetchedAt: null,
                  error: 'Timed out waiting for news feed.',
                  items: [],
                }
              ),
              currentApify.configured && !currentApify.lastSyncedAt
                ? withSoftTimeout(runApifySupplementarySync(env), 5000, currentApify)
                : Promise.resolve(currentApify),
            ]);

            send({
              type: 'stage',
              stage: 4,
              totalStages: 7,
              stageKey: 'finding_5m_entry',
              message:
                language === 'fa'
                  ? 'در حال بررسی تاییدیه ورود در تایم‌فریم 5M و الگوهای کندلی...'
                  : 'Evaluating 5M entry confirmation and candlestick triggers...',
            });

            const goldContext =
              goldData.price !== null
                ? `GoldAPI XAUUSD Reference Price: $${goldData.price} USD (Freshness: ${
                    goldData.isStale ? 'CACHED/STALE' : goldData.isCached ? 'CACHED' : 'LIVE'
                  }).`
                : 'GoldAPI XAUUSD Reference Price: UNAVAILABLE.';

            const newsContext =
              newsState.providerConfigured && newsState.items.length > 0
                ? `Recent News:\n` +
                  newsState.items
                    .slice(0, 5)
                    .map((n) => `- [${n.category} | ${n.goldImpact}] ${n.headline}`)
                    .join('\n')
                : 'Economic News Provider: UNAVAILABLE. Set scores.fundamentalContext to null.';

            const apifyContext = apifyState.supplementarySummary
              ? `Supplementary TradingView (Apify Actor ${apifyState.actorId}): ${apifyState.supplementarySummary}`
              : `Supplementary TradingView (Apify Actor ${apifyState.actorId}): Unavailable or not synced; rely on screenshots and GoldAPI.`;

            const langInstr =
              language === 'fa'
                ? 'Respond with ALL descriptive text fields written in fluent, professional Persian (Farsi) financial terminology. Keep finalDecision strictly as "BUY", "SELL", or "NO TRADE".'
                : 'Respond with ALL descriptive text fields written in crisp English financial terminology. Keep finalDecision strictly as "BUY", "SELL", or "NO TRADE".';

            const prompt = `Analyze these THREE XAUUSD chart screenshots together (1H, 15M, 5M).\n${goldContext}\n${newsContext}\n${apifyContext}\n${langInstr}\nRead Entry, Stop Loss, TP1, TP2, and TP3 strictly from the uploaded chart price scales, ensuring RR >= 1.5 at TP1. Do NOT reject valid historical, replay, or broker-offset charts as NO TRADE.`;

            const contents = [
              {
                parts: [
                  { text: 'Chart 1 (Confirmed Slot: 1H - Main Market Direction):' },
                  {
                    inlineData: {
                      mimeType: chart1H.mimeType,
                      data: stripDataUrlPrefix(chart1H.base64),
                    },
                  },
                  { text: 'Chart 2 (Confirmed Slot: 15M - Market Structure & Liquidity):' },
                  {
                    inlineData: {
                      mimeType: chart15M.mimeType,
                      data: stripDataUrlPrefix(chart15M.base64),
                    },
                  },
                  { text: 'Chart 3 (Confirmed Slot: 5M - Entry Confirmation):' },
                  {
                    inlineData: {
                      mimeType: chart5M.mimeType,
                      data: stripDataUrlPrefix(chart5M.base64),
                    },
                  },
                  { text: prompt },
                ],
              },
            ];

            const rawText = await callGeminiWithModelFallbacks(
              env,
              [
                {
                  model: 'gemini-3-flash-preview',
                  thinkingLevel: 'LOW',
                  timeoutMs: 16_000,
                  maxTotalMs: 26_000,
                  maxTransientAttempts: 3,
                },
                {
                  model: 'gemini-3.1-flash-lite',
                  thinkingLevel: 'MEDIUM',
                  timeoutMs: 18_000,
                  maxTotalMs: 28_000,
                  maxTransientAttempts: 3,
                },
                {
                  model: 'gemini-3.1-flash-lite-preview',
                  thinkingLevel: 'LOW',
                  timeoutMs: 18_000,
                  maxTotalMs: 28_000,
                  maxTransientAttempts: 3,
                },
                {
                  model: 'gemini-4-hydrogen',
                  thinkingLevel: 'LOW',
                  timeoutMs: 16_000,
                  maxTotalMs: 24_000,
                  maxTransientAttempts: 2,
                },
              ],
              {
                systemInstruction: SYSTEM_INSTRUCTION,
                contents,
                responseSchema: ANALYSIS_RESPONSE_SCHEMA,
              }
            );

            send({
              type: 'stage',
              stage: 6,
              totalStages: 7,
              stageKey: 'evaluating_confirmations',
              message:
                language === 'fa'
                  ? 'در حال راستی‌آزمایی نسبت ریسک به ریوارد (RR >= 1:1.5) و هم‌خوانی قیمت مرجع...'
                  : 'Verifying Risk-to-Reward (>= 1:1.5) and GoldAPI price consistency...',
            });

            const cleanRawText = rawText
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/```$/i, '')
              .trim();
            const parsedRaw = JSON.parse(cleanRawText) as Record<string, unknown>;
            const rawDecision = normalizeDecision(parsedRaw.finalDecision as string | undefined);
            const inspections = Array.isArray(parsedRaw.chartInspections)
              ? (parsedRaw.chartInspections as ChartInspectionResult[])
              : [];
            const rawPlan = (parsedRaw.tradingPlan || {}) as Record<string, unknown>;
            const numOrNull = (val: unknown): number | null =>
              typeof val === 'number' && Number.isFinite(val) ? val : null;

            const entryPrice = numOrNull(rawPlan.entryPrice);
            const stopLoss = numOrNull(rawPlan.stopLoss);
            const takeProfit1 = numOrNull(rawPlan.takeProfit1);
            const takeProfit2 = numOrNull(rawPlan.takeProfit2);
            const takeProfit3 = numOrNull(rawPlan.takeProfit3);
            const invalidationPrice = numOrNull(rawPlan.invalidationPrice);

            const validationOverrides: string[] = [];
            for (const insp of inspections) {
              if (insp.isFinancialChart === false) {
                validationOverrides.push(
                  `Slot ${insp.timeframeSlot}: Uploaded image was not recognized as a financial chart.`
                );
              } else if (
                insp.isReadable === false &&
                insp.priceAxisVisible === false &&
                entryPrice === null
              ) {
                validationOverrides.push(
                  `Slot ${insp.timeframeSlot}: Chart image has no readable price axis.`
                );
              }
              if (insp.isXauusdOrGold === false && isExplicitNonGoldSymbol(insp.detectedSymbol)) {
                validationOverrides.push(
                  `Slot ${insp.timeframeSlot}: Detected symbol (${insp.detectedSymbol}) is not XAUUSD / Gold.`
                );
              }
            }

            const chart5MInsp = inspections.find((i) => i.timeframeSlot === '5M');
            const chartPrice =
              chart5MInsp?.extractedCurrentPrice ??
              inspections.find((i) => typeof i.extractedCurrentPrice === 'number')
                ?.extractedCurrentPrice ??
              null;

            const validity = evaluateSignalValidity({
              decision: validationOverrides.length > 0 ? 'NO TRADE' : rawDecision,
              entryPrice,
              stopLoss,
              tp1: takeProfit1,
              tp2: takeProfit2,
              tp3: takeProfit3,
              referencePrice: goldData.price,
              chartPrice,
            });
            validationOverrides.push(...validity.overrideReasons);

            const finalDecision: SignalDecision =
              validationOverrides.length > 0 ? 'NO TRADE' : validity.finalDecision;

            const rawScores = (parsedRaw.scores || {}) as Record<string, unknown>;
            const rawExplanations = (rawScores.explanations || {}) as Record<string, string>;
            const scoreFields = {
              priceAction: numOrNull(rawScores.priceAction),
              marketStructure: numOrNull(rawScores.marketStructure),
              volume: numOrNull(rawScores.volume),
              candlestickConfirmation: numOrNull(rawScores.candlestickConfirmation),
              multiTimeframeAlignment: numOrNull(rawScores.multiTimeframeAlignment),
              fundamentalContext: newsState.providerConfigured
                ? numOrNull(rawScores.fundamentalContext)
                : null,
            };
            const overallScore = calculateOverallTechnicalScore(scoreFields);

            const a1h = (parsedRaw.analysis1H || {}) as Record<string, string>;
            const a15m = (parsedRaw.analysis15M || {}) as Record<string, string>;
            const a5m = (parsedRaw.analysis5M || {}) as Record<string, string>;
            const fund = (parsedRaw.fundamentalContext || {}) as Record<string, string>;
            const expl = (parsedRaw.detailedExplanation || {}) as Record<string, string>;

            const reportId = `aurum-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
            const report: AnalysisReport = {
              id: reportId,
              symbol: 'XAUUSD',
              language,
              createdAt: new Date().toISOString(),
              analysisStatus: validationOverrides.some(
                (v) => v.includes('not recognized') || v.includes('not XAUUSD')
              )
                ? 'rejected'
                : 'completed',
              goldReferencePrice: goldData.price,
              goldDataFreshness:
                goldData.price === null ? 'unavailable' : goldData.isCached ? 'cached' : 'live',
              decision: finalDecision,
              signalStatus: finalDecision === 'NO TRADE' ? 'UNVERIFIED' : 'ACTIVE',
              marketDirection: String(parsedRaw.marketDirection || 'Neutral / Unclear'),
              chartInspections: inspections,
              analysis1H: {
                mainTrend: String(a1h.mainTrend || ''),
                marketStructure: String(a1h.marketStructure || ''),
                importantLevels: String(a1h.importantLevels || ''),
                technicalObservations: String(a1h.technicalObservations || ''),
              },
              analysis15M: {
                marketStructure: String(a15m.marketStructure || ''),
                liquidity: String(a15m.liquidity || ''),
                bosChochMss: String(a15m.bosChochMss || ''),
                fvgOrderBlocks: String(a15m.fvgOrderBlocks || ''),
                importantLevels: String(a15m.importantLevels || ''),
              },
              analysis5M: {
                entryConfirmation: String(a5m.entryConfirmation || ''),
                candlestickConfirmation: String(a5m.candlestickConfirmation || ''),
                entryZone: String(a5m.entryZone || ''),
                setupValidity: String(a5m.setupValidity || ''),
              },
              tradingPlan: {
                direction: finalDecision,
                entryZone: String(
                  rawPlan.entryZone || (finalDecision === 'NO TRADE' ? 'N/A' : '')
                ),
                entryPrice: finalDecision === 'NO TRADE' ? null : entryPrice,
                stopLoss: finalDecision === 'NO TRADE' ? null : stopLoss,
                takeProfit1: finalDecision === 'NO TRADE' ? null : takeProfit1,
                takeProfit2: finalDecision === 'NO TRADE' ? null : takeProfit2,
                takeProfit3: finalDecision === 'NO TRADE' ? null : takeProfit3,
                riskToRewardLabel:
                  finalDecision === 'NO TRADE' || validity.rrRatio === null
                    ? 'N/A'
                    : `1 : ${validity.rrRatio.toFixed(2)}`,
                riskToRewardRatio: finalDecision === 'NO TRADE' ? null : validity.rrRatio,
                entryTimeframe: String(rawPlan.entryTimeframe || '5M'),
                invalidationLevel: String(rawPlan.invalidationLevel || ''),
                invalidationPrice,
                plannedVsCurrentNote: String(rawPlan.plannedVsCurrentNote || ''),
                isEntryValidAtCurrentPrice:
                  finalDecision !== 'NO TRADE' && validity.isEntryValidAtCurrentPrice,
              },
              technicalScores: {
                ...scoreFields,
                overallScore,
                explanations: {
                  priceAction: String(rawExplanations.priceAction || ''),
                  marketStructure: String(rawExplanations.marketStructure || ''),
                  volume: String(rawExplanations.volume || 'Volume unavailable (N/A).'),
                  candlestickConfirmation: String(rawExplanations.candlestickConfirmation || ''),
                  multiTimeframeAlignment: String(rawExplanations.multiTimeframeAlignment || ''),
                  fundamentalContext: newsState.providerConfigured
                    ? String(rawExplanations.fundamentalContext || '')
                    : language === 'fa'
                      ? 'داده اخبار اقتصادی در دسترس نیست (N/A).'
                      : 'News provider not configured (N/A).',
                },
              },
              fundamentalContext: {
                relevantEvents: String(fund.relevantEvents || ''),
                newsImpact: newsState.providerConfigured ? String(fund.newsImpact || '') : 'N/A',
                usdContext: String(fund.usdContext || 'N/A'),
                riskConditions: String(fund.riskConditions || ''),
                newsAvailable: newsState.providerConfigured && newsState.items.length > 0,
              },
              setupInvalidation: String(parsedRaw.setupInvalidation || ''),
              detailedExplanation: {
                decisionReason:
                  validationOverrides.length > 0
                    ? `${validationOverrides.join(' | ')}\n\n${String(expl.decisionReason || '')}`
                    : String(expl.decisionReason || ''),
                supportingConfirmations: String(expl.supportingConfirmations || ''),
                timeframeAlignment: String(expl.timeframeAlignment || ''),
                invalidationConditions: String(expl.invalidationConditions || ''),
                priceProximityCheck: String(expl.priceProximityCheck || ''),
              },
              apifyContextUsed: Boolean(apifyState.lastRunItemsCount > 0),
              validationOverrides,
            };

            isolateLogs.unshift({
              id: report.id,
              createdAt: report.createdAt,
              decision: report.decision,
              status: report.analysisStatus,
              goldReferencePrice: report.goldReferencePrice,
            });
            if (isolateLogs.length > 100) isolateLogs.length = 100;

            incUsage(clientKey);
            send({ type: 'complete', report });
          } catch (err) {
            const raw = err instanceof Error ? err.message : 'Unexpected error during AI analysis.';
            const friendly = formatGeminiErrorMessage(raw, language);
            isolateGeminiLastError = friendly;
            isolateLogs.unshift({
              id: `aurum-err-${Date.now()}`,
              createdAt: new Date().toISOString(),
              decision: 'NO TRADE',
              status: 'failed',
              error: friendly,
              goldReferencePrice: isolateGoldCache?.price ?? null,
            });
            if (isolateLogs.length > 100) isolateLogs.length = 100;
            send({
              type: 'error',
              error: friendly,
              errorCode:
                (err as { code?: string } | undefined)?.code || 'ANALYSIS_FAILED',
            });
          } finally {
            clearInterval(heartbeat);
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    if (path === '/api/admin/login' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        username?: string;
        password?: string;
      };
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const ok = await verifyAdminCredentials(username, password, env);
      if (!ok) {
        return jsonRes(
          { error: 'Invalid admin username or password.', code: 'INVALID_ADMIN_CREDENTIALS' },
          401
        );
      }
      const session = await issueAdminSessionToken(username, env);
      return jsonRes({
        ok: true,
        username,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    }

    if (path === '/api/admin/overview' && method === 'GET') {
      const authErr = await checkAdmin(request, env);
      if (authErr) return authErr;

      const geminiKeys = parseApiKeyPool(env.GEMINI_API_KEY, env.GEMINI_API_KEYS);
      const goldConfigured = Boolean(env.GOLDAPI_API_KEY?.trim());
      const apifyToken = resolveApifyToken(env.APIFY_API_TOKEN, env.GOLDAPI_API_KEY);
      const apifyConfigured = Boolean(apifyToken);
      const newsConfigured = Boolean(env.NEWS_API_KEY?.trim());

      const apis: ApiHealthSummary[] = [
        {
          name: 'GoldAPI',
          configured: goldConfigured,
          maskedKey: maskSecret(env.GOLDAPI_API_KEY),
          status: (!goldConfigured
            ? 'disconnected'
            : isolateGoldLastError && !isolateGoldSuccessAt
              ? 'error'
              : 'connected') as ApiConnectionStatus,
          lastSuccessfulRequest: isolateGoldSuccessAt || isolateGoldCache?.fetchedAt || null,
          lastError: goldConfigured
            ? isolateGoldLastError
            : 'GOLDAPI_API_KEY is not configured in Cloudflare environment variables.',
        },
        {
          name: 'Apify',
          configured: apifyConfigured,
          maskedKey: maskSecret(apifyToken || undefined),
          status: (!apifyConfigured
            ? 'disconnected'
            : isolateApifyLastError
              ? 'error'
              : 'connected') as ApiConnectionStatus,
          lastSuccessfulRequest: isolateApifySyncAt,
          lastError: apifyConfigured
            ? isolateApifyLastError
            : 'APIFY_API_TOKEN is not configured in Cloudflare environment variables.',
        },
        {
          name: 'Gemini',
          configured: geminiKeys.length > 0,
          maskedKey:
            geminiKeys.length > 1
              ? `${geminiKeys.length} keys (${maskSecret(geminiKeys[0])})`
              : maskSecret(geminiKeys[0]),
          status: (geminiKeys.length === 0
            ? 'disconnected'
            : isolateGeminiLastError && !isolateGeminiSuccessAt
              ? 'error'
              : 'connected') as ApiConnectionStatus,
          lastSuccessfulRequest: isolateGeminiSuccessAt,
          lastError:
            geminiKeys.length > 0
              ? isolateGeminiLastError
              : 'GEMINI_API_KEY / GEMINI_API_KEYS is not configured in Cloudflare environment variables.',
        },
        {
          name: 'NewsAPI',
          configured: newsConfigured,
          maskedKey: maskSecret(env.NEWS_API_KEY),
          status: (!newsConfigured
            ? 'disconnected'
            : isolateNewsLastError && !isolateNewsSuccessAt
              ? 'error'
              : 'connected') as ApiConnectionStatus,
          lastSuccessfulRequest: isolateNewsSuccessAt || isolateNewsCache?.lastFetchedAt || null,
          lastError: newsConfigured
            ? isolateNewsLastError
            : 'NEWS_API_KEY is not configured in Cloudflare environment variables.',
        },
      ];

      const payload: AdminOverviewPayload = {
        persistentAuthConfigured: true,
        stats: {
          totalRegisteredUsers: null,
          activeVipUsers: null,
          totalAnalyses: isolateLogs.length,
          successfulAnalyses: isolateLogs.filter((l) => l.status === 'completed').length,
          failedAnalyses: isolateLogs.filter((l) => l.status !== 'completed').length,
        },
        apis,
        recentAnalyses: isolateLogs.slice(0, 25),
        config: isolateConfig,
      };
      return jsonRes(payload);
    }

    if (path === '/api/admin/config' && method === 'POST') {
      const authErr = await checkAdmin(request, env);
      if (authErr) return authErr;
      const body = (await request.json().catch(() => ({}))) as Partial<SystemConfig>;
      if (typeof body.freeDailyQuota === 'number' && body.freeDailyQuota >= 1 && body.freeDailyQuota <= 100) {
        isolateConfig.freeDailyQuota = Math.floor(body.freeDailyQuota);
      }
      if (typeof body.vipDailyQuota === 'number' && body.vipDailyQuota >= 1 && body.vipDailyQuota <= 500) {
        isolateConfig.vipDailyQuota = Math.floor(body.vipDailyQuota);
      }
      if (typeof body.goldCacheSeconds === 'number' && body.goldCacheSeconds >= 15 && body.goldCacheSeconds <= 3600) {
        isolateConfig.goldCacheSeconds = Math.floor(body.goldCacheSeconds);
      }
      if (typeof body.vipOverrideEnabled === 'boolean') {
        isolateConfig.vipOverrideEnabled = body.vipOverrideEnabled;
      }
      return jsonRes({ ok: true, config: isolateConfig });
    }

    if (path === '/api/admin/apify/sync' && method === 'POST') {
      const authErr = await checkAdmin(request, env);
      if (authErr) return authErr;
      const status = await runApifySupplementarySync(env);
      return jsonRes(status);
    }

    if (path === '/api/admin/apify/urls' && method === 'POST') {
      const authErr = await checkAdmin(request, env);
      if (authErr) return authErr;
      const body = (await request.json().catch(() => ({}))) as { rawJson?: unknown };
      let parsed: unknown = body.rawJson;
      if (typeof body.rawJson === 'string') {
        try {
          parsed = JSON.parse(body.rawJson);
        } catch {
          return jsonRes({ error: 'Invalid JSON payload provided.' }, 400);
        }
      }
      const filtered = filterXauusdTradingViewUrls(parsed);
      if (filtered.length === 0) {
        return jsonRes(
          { error: 'No valid XAUUSD / TVC:GOLD TradingView URLs found in the uploaded JSON.' },
          400
        );
      }
      isolateApifySources = filtered;
      return jsonRes({ ok: true, count: filtered.length, xauusdSources: filtered });
    }

    return jsonRes({ error: 'API route not found.', code: 'NOT_FOUND' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected Cloudflare Pages Function error.';
    return jsonRes({ error: msg, code: 'CF_FUNCTION_ERROR' }, 500);
  }
}
