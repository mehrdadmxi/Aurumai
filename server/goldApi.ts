import type { GoldMarketData } from '../src/types.ts';
import {
  isApifyApiToken,
  parsePercentChange,
  parseTradingViewPrice,
  parseTradingViewScannerGold,
  resolveApifyToken,
} from '../src/lib/tradingRules.ts';
import { runtimeStore } from './config.ts';

interface GoldTickPoint {
  time: string;
  price: number;
}

const GOLD_API_URL = 'https://www.goldapi.io/api/XAU/USD';
const MIN_MANUAL_REFRESH_MS = 10_000;

let cachedGoldData: GoldMarketData | null = null;
let lastFetchAttemptMs = 0;
let inFlightRequest: Promise<GoldMarketData> | null = null;
const sessionTicks: GoldTickPoint[] = [];

const REFERENCE_DISCLAIMER =
  'GoldAPI spot price is a reference market price and not the exact executable price of every broker.';

function buildUnavailablePayload(errorMessage: string): GoldMarketData {
  if (cachedGoldData && cachedGoldData.price !== null) {
    return {
      ...cachedGoldData,
      isCached: true,
      isStale: true,
      status: 'error',
      error: errorMessage,
    };
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
    status: process.env.GOLDAPI_API_KEY ? 'error' : 'disconnected',
    error: errorMessage,
    disclaimer: REFERENCE_DISCLAIMER,
  };
}

export function getSessionGoldTicks(): GoldTickPoint[] {
  return sessionTicks;
}

async function fetchLiveMarketGoldFallback(
  apiKey: string,
  options: { sourceLabel: string; warningError?: string | null }
): Promise<GoldMarketData | null> {
  const actorId = process.env.APIFY_ACTOR_ID?.trim() || 'hOfycUMuUpaFZvG7a';
  const apifyToken = isApifyApiToken(apiKey)
    ? apiKey
    : resolveApifyToken(process.env.APIFY_API_TOKEN, process.env.GOLDAPI_API_KEY);

  let spotPrice: number | null = null;
  let spotFetchedAt: string | null = null;
  let tvQuote: ReturnType<typeof parseTradingViewScannerGold> = null;
  let apifyPrice: number | null = null;
  let apifyChangePct: number | null = null;

  const [tvRes, goldApiRes, apifyLastRes] = await Promise.allSettled([
    fetch('https://scanner.tradingview.com/cfd/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols: { tickers: ['OANDA:XAUUSD', 'TVC:GOLD'] },
        columns: ['close', 'open', 'high', 'low', 'change', 'change_abs'],
      }),
      signal: AbortSignal.timeout(5500),
    }),
    fetch('https://api.gold-api.com/price/XAU', { signal: AbortSignal.timeout(5500) }),
    apifyToken
      ? fetch(
          `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs/last/dataset/items?status=SUCCEEDED&limit=3`,
          {
            headers: { Authorization: `Bearer ${apifyToken}` },
            signal: AbortSignal.timeout(4000),
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
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?timeout=25`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apifyToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbols: ['TVC:GOLD'] }),
          signal: AbortSignal.timeout(28_000),
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

export async function fetchGoldReferencePrice(forceRefresh = false): Promise<GoldMarketData> {
  const rawKey = process.env.GOLDAPI_API_KEY?.trim() || '';
  const apiKey = rawKey === 'MY_GOLDAPI_API_KEY' ? '' : rawKey;

  const now = Date.now();
  const cacheTtlMs = Math.max(15, runtimeStore.config.goldCacheSeconds) * 1000;

  if (cachedGoldData && !forceRefresh && now - lastFetchAttemptMs < cacheTtlMs) {
    return {
      ...cachedGoldData,
      isCached: true,
      isStale: false,
    };
  }

  // Throttle forced refreshes to preserve GoldAPI quota
  if (cachedGoldData && forceRefresh && now - lastFetchAttemptMs < MIN_MANUAL_REFRESH_MS) {
    return {
      ...cachedGoldData,
      isCached: true,
      isStale: now - lastFetchAttemptMs > cacheTtlMs,
    };
  }

  if (inFlightRequest) {
    return inFlightRequest;
  }

  lastFetchAttemptMs = now;
  inFlightRequest = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), isApifyApiToken(apiKey) ? 28_000 : 8000);
    try {
      if (!apiKey || isApifyApiToken(apiKey)) {
        const sourceLabel = isApifyApiToken(apiKey)
          ? 'Apify + TradingView Live'
          : 'TradingView + Gold-API Live';
        const liveFallback = await fetchLiveMarketGoldFallback(apiKey, {
          sourceLabel,
          warningError: null,
        });
        if (liveFallback) {
          cachedGoldData = liveFallback;
          runtimeStore.recordApiSuccess('GoldAPI');
          sessionTicks.push({ time: liveFallback.fetchedAt!, price: liveFallback.price! });
          if (sessionTicks.length > 60) sessionTicks.shift();
          return liveFallback;
        }
        const msg = apiKey
          ? 'Unable to retrieve XAUUSD spot price via Apify or live fallback feeds.'
          : 'GOLDAPI_API_KEY is not configured. Unable to fetch live XAUUSD reference price.';
        runtimeStore.recordApiError('GoldAPI', msg, apiKey ? 'error' : 'disconnected');
        return buildUnavailablePayload(msg);
      }

      const response = await fetch(GOLD_API_URL, {
        method: 'GET',
        headers: {
          'x-access-token': apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        let detail = `GoldAPI returned HTTP ${response.status}`;
        let isQuotaError = response.status === 429;
        try {
          const parsedErr = JSON.parse(errBody) as { code?: string; error?: string };
          if (parsedErr.code === 'MONTHLY_API_QUOTA_EXCEEDED') {
            isQuotaError = true;
            detail = 'GoldAPI monthly quota exceeded (MONTHLY_API_QUOTA_EXCEEDED).';
          } else if (parsedErr.error) {
            detail = `GoldAPI error: ${parsedErr.error}`;
          }
        } catch {
          if (response.status === 401 || response.status === 403) {
            detail = 'GoldAPI authentication failed (invalid or expired GOLDAPI_API_KEY).';
          } else if (response.status === 429) {
            detail = 'GoldAPI rate limit or monthly quota reached.';
          }
        }

        const fallbackLive = await fetchLiveMarketGoldFallback(apiKey, {
          sourceLabel: 'Gold-API + TradingView (fallback)',
          warningError: isQuotaError ? `${detail} Using live fallback reference price.` : null,
        });
        if (fallbackLive) {
          cachedGoldData = fallbackLive;
          runtimeStore.recordApiSuccess('GoldAPI');
          sessionTicks.push({ time: fallbackLive.fetchedAt!, price: fallbackLive.price! });
          if (sessionTicks.length > 60) sessionTicks.shift();
          return fallbackLive;
        }

        runtimeStore.recordApiError('GoldAPI', detail, 'error');
        return buildUnavailablePayload(detail);
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const price = typeof raw.price === 'number' ? raw.price : null;

      if (price === null || !Number.isFinite(price)) {
        const msg = 'GoldAPI returned an unexpected payload without a valid XAUUSD price.';
        runtimeStore.recordApiError('GoldAPI', msg, 'error');
        return buildUnavailablePayload(msg);
      }

      const prevClose = typeof raw.prev_close_price === 'number' ? raw.prev_close_price : null;
      const open = typeof raw.open_price === 'number' ? raw.open_price : null;
      const high = typeof raw.high_price === 'number' ? raw.high_price : null;
      const low = typeof raw.low_price === 'number' ? raw.low_price : null;
      const change = typeof raw.ch === 'number' ? raw.ch : prevClose !== null ? +(price - prevClose).toFixed(2) : null;
      const changePercent =
        typeof raw.chp === 'number'
          ? raw.chp
          : prevClose && prevClose > 0
            ? +(((price - prevClose) / prevClose) * 100).toFixed(2)
            : null;
      const bid = typeof raw.bid === 'number' ? raw.bid : null;
      const ask = typeof raw.ask === 'number' ? raw.ask : null;
      const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Math.floor(Date.now() / 1000);
      const fetchedAt = new Date().toISOString();

      const fresh: GoldMarketData = {
        symbol: 'XAUUSD',
        price,
        prevClose,
        open,
        high,
        low,
        change,
        changePercent,
        bid,
        ask,
        timestamp,
        fetchedAt,
        source: 'GoldAPI (goldapi.io)',
        isCached: false,
        isStale: false,
        status: 'connected',
        error: null,
        disclaimer: REFERENCE_DISCLAIMER,
      };

      cachedGoldData = fresh;
      runtimeStore.recordApiSuccess('GoldAPI');

      sessionTicks.push({ time: fetchedAt, price });
      if (sessionTicks.length > 60) {
        sessionTicks.shift();
      }

      return fresh;
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'GoldAPI request timed out after 8 seconds.'
          : 'Network failure while contacting GoldAPI.';
      runtimeStore.recordApiError('GoldAPI', msg, 'error');
      return buildUnavailablePayload(msg);
    } finally {
      clearTimeout(timeout);
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}
