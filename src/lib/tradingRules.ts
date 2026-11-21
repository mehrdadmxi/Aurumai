import type {
  ApifySourceEntry,
  ImageFileValidation,
  SignalDecision,
  TechnicalScores,
} from '../types.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export const DEFAULT_XAUUSD_SOURCES: ApifySourceEntry[] = [
  { symbol: 'TVC:GOLD', url: 'https://www.tradingview.com/chart/?symbol=TVC%3AGOLD' },
  { symbol: 'FX_IDC:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=FX_IDC%3AXAUUSD' },
  { symbol: 'STONEXTRADING:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=STONEXTRADING%3AXAUUSD' },
  { symbol: 'SKILLING:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=SKILLING%3AXAUUSD' },
  { symbol: 'BLACKBULL:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=BLACKBULL%3AXAUUSD' },
  { symbol: 'EIGHTCAP:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=EIGHTCAP%3AXAUUSD' },
  { symbol: 'SAXO:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=SAXO%3AXAUUSD' },
  { symbol: 'EASYMARKETS:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=EASYMARKETS%3AXAUUSD' },
  { symbol: 'PHILLIPNOVA:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=PHILLIPNOVA%3AXAUUSD' },
  { symbol: 'FOREXCOM:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=FOREXCOM%3AXAUUSD' },
  { symbol: 'OANDA:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD' },
  { symbol: 'FX:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=FX%3AXAUUSD' },
  { symbol: 'PEPPERSTONE:XAUUSD', url: 'https://www.tradingview.com/chart/?symbol=PEPPERSTONE%3AXAUUSD' },
];

export function validateImageFileMeta(input: {
  mimeType: string;
  sizeBytes: number;
  base64?: string;
}): ImageFileValidation {
  const mime = (input.mimeType || '').toLowerCase().trim();
  if (!SUPPORTED_IMAGE_MIMES.has(mime)) {
    return {
      valid: false,
      errorCode: 'INVALID_FORMAT',
      errorMessage: 'Unsupported image format. Please use PNG, JPG, JPEG, or WEBP.',
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return {
      valid: false,
      errorCode: 'MISSING',
      errorMessage: 'Image file appears empty.',
    };
  }
  if (input.sizeBytes > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      errorCode: 'TOO_LARGE',
      errorMessage: 'Image exceeds the 10 MB maximum file size limit.',
    };
  }
  return { valid: true };
}

export function calculateOverallTechnicalScore(
  scores: Pick<
    TechnicalScores,
    | 'priceAction'
    | 'marketStructure'
    | 'volume'
    | 'candlestickConfirmation'
    | 'multiTimeframeAlignment'
    | 'fundamentalContext'
  >
): number {
  const values = [
    scores.priceAction,
    scores.marketStructure,
    scores.volume,
    scores.candlestickConfirmation,
    scores.multiTimeframeAlignment,
    scores.fundamentalContext,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  if (values.length === 0) return 0;

  const clamped = values.map((v) => Math.max(0, Math.min(10, v)));
  const avg = clamped.reduce((acc, v) => acc + v, 0) / clamped.length;
  return Math.round(avg * 10) / 10;
}

export function computeRiskToReward(params: {
  decision: SignalDecision;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
}): { ratio: number | null; directionalValid: boolean; reason?: string } {
  const { decision, entry, stopLoss, tp1 } = params;
  if (decision === 'NO TRADE') {
    return { ratio: null, directionalValid: true };
  }
  if (
    entry === null ||
    stopLoss === null ||
    tp1 === null ||
    !Number.isFinite(entry) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(tp1)
  ) {
    return {
      ratio: null,
      directionalValid: false,
      reason: 'Missing numeric Entry, Stop Loss, or Take Profit 1 price.',
    };
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp1 - entry);

  if (risk <= 0) {
    return {
      ratio: null,
      directionalValid: false,
      reason: 'Stop Loss cannot equal Entry price.',
    };
  }

  if (decision === 'BUY') {
    if (!(stopLoss < entry && tp1 > entry)) {
      return {
        ratio: null,
        directionalValid: false,
        reason: 'BUY setup requires Stop Loss below Entry and Take Profit above Entry.',
      };
    }
  } else if (decision === 'SELL') {
    if (!(stopLoss > entry && tp1 < entry)) {
      return {
        ratio: null,
        directionalValid: false,
        reason: 'SELL setup requires Stop Loss above Entry and Take Profit below Entry.',
      };
    }
  }

  const ratio = Math.round((reward / risk) * 100) / 100;
  return { ratio, directionalValid: true };
}

export function isExplicitNonGoldSymbol(detectedSymbol?: string | null): boolean {
  if (!detectedSymbol) return false;
  const upper = detectedSymbol.toUpperCase().trim();
  if (
    !upper ||
    upper === 'UNKNOWN' ||
    upper === 'N/A' ||
    upper === 'NONE' ||
    upper === 'NOT VISIBLE' ||
    upper === 'UNSPECIFIED'
  ) {
    return false;
  }
  if (upper.includes('XAU') || upper.includes('GOLD') || upper.startsWith('GC')) {
    return false;
  }
  const nonGoldMarkers = [
    'BTC',
    'ETH',
    'SOL',
    'XRP',
    'BNB',
    'DOGE',
    'EURUSD',
    'EUR/USD',
    'GBPUSD',
    'GBP/USD',
    'USDJPY',
    'USD/JPY',
    'USDCAD',
    'AUDUSD',
    'NZDUSD',
    'USDCHF',
    'US30',
    'DJI',
    'NAS100',
    'NDX',
    'NQ1',
    'SPX',
    'US500',
    'ES1',
    'GER40',
    'DAX',
    'WTI',
    'USOIL',
    'UKOIL',
    'BRENT',
    'XAG',
    'SILVER',
    'DXY',
    'NVDA',
    'AAPL',
    'TSLA',
  ];
  return nonGoldMarkers.some((marker) => upper.includes(marker));
}

export function evaluateSignalValidity(params: {
  decision: SignalDecision;
  entryPrice: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  referencePrice: number | null;
  chartPrice: number | null;
  maxEntryDriftPercent?: number;
}): {
  finalDecision: SignalDecision;
  rrRatio: number | null;
  isEntryValidAtCurrentPrice: boolean;
  overrideReasons: string[];
} {
  const overrideReasons: string[] = [];
  const maxDriftPct = params.maxEntryDriftPercent ?? 2.5;

  if (params.decision === 'NO TRADE') {
    return {
      finalDecision: 'NO TRADE',
      rrRatio: null,
      isEntryValidAtCurrentPrice: false,
      overrideReasons,
    };
  }

  const rrCheck = computeRiskToReward({
    decision: params.decision,
    entry: params.entryPrice,
    stopLoss: params.stopLoss,
    tp1: params.tp1,
  });

  if (!rrCheck.directionalValid) {
    overrideReasons.push(rrCheck.reason || 'Invalid Stop Loss / Take Profit geometry.');
  }

  if (rrCheck.ratio !== null && rrCheck.ratio < 1.5) {
    overrideReasons.push(
      `Risk-to-Reward ratio (${rrCheck.ratio.toFixed(2)}) is below the mandatory 1:1.5 minimum.`
    );
  }

  // Check take-profit progression order
  if (
    params.entryPrice !== null &&
    params.tp1 !== null &&
    params.tp2 !== null &&
    params.tp3 !== null
  ) {
    if (params.decision === 'BUY' && !(params.tp1 <= params.tp2 && params.tp2 <= params.tp3)) {
      overrideReasons.push('BUY targets must progress upward (TP1 <= TP2 <= TP3).');
    }
    if (params.decision === 'SELL' && !(params.tp1 >= params.tp2 && params.tp2 >= params.tp3)) {
      overrideReasons.push('SELL targets must progress downward (TP1 >= TP2 >= TP3).');
    }
  }

  let isEntryValidAtCurrentPrice = true;

  // Compare live GoldAPI reference price only when chart appears to be in the same live price regime (<= 3% gap)
  if (params.referencePrice !== null && Number.isFinite(params.referencePrice)) {
    const ref = params.referencePrice;
    const regimeAnchor =
      params.chartPrice !== null && Number.isFinite(params.chartPrice) && params.chartPrice > 0
        ? params.chartPrice
        : params.entryPrice;

    const regimeGapPct =
      regimeAnchor !== null && Number.isFinite(regimeAnchor) && regimeAnchor > 0
        ? (Math.abs(ref - regimeAnchor) / regimeAnchor) * 100
        : 0;

    if (regimeGapPct > 1.0) {
      // Earlier session, historical/replay, or different-contract/broker chart (>1% from GoldAPI): preserve valid chart setup, mark live validity false
      isEntryValidAtCurrentPrice = false;
    } else if (params.entryPrice !== null && Number.isFinite(params.entryPrice)) {
      const driftPct = (Math.abs(ref - params.entryPrice) / params.entryPrice) * 100;

      const isPendingLimitPullbackBuy =
        params.chartPrice !== null &&
        Number.isFinite(params.chartPrice) &&
        params.chartPrice > params.entryPrice * 1.002;
      const isPendingLimitPullbackSell =
        params.chartPrice !== null &&
        Number.isFinite(params.chartPrice) &&
        params.chartPrice < params.entryPrice * 0.998;

      if (params.decision === 'BUY') {
        if (params.stopLoss !== null && ref <= params.stopLoss) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) is already below Stop Loss (${params.stopLoss}).`
          );
        } else if (params.tp1 !== null && ref >= params.tp1 && !isPendingLimitPullbackBuy) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) has already passed TP1 (${params.tp1}); entry window has passed.`
          );
        } else if (driftPct > maxDriftPct) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) differs by ${driftPct.toFixed(2)}% from proposed Entry (${params.entryPrice}).`
          );
        }
      } else if (params.decision === 'SELL') {
        if (params.stopLoss !== null && ref >= params.stopLoss) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) is already above Stop Loss (${params.stopLoss}).`
          );
        } else if (params.tp1 !== null && ref <= params.tp1 && !isPendingLimitPullbackSell) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) has already passed TP1 (${params.tp1}); entry window has passed.`
          );
        } else if (driftPct > maxDriftPct) {
          isEntryValidAtCurrentPrice = false;
          overrideReasons.push(
            `Current GoldAPI reference price (${ref}) differs by ${driftPct.toFixed(2)}% from proposed Entry (${params.entryPrice}).`
          );
        }
      }
    }
  }

  const finalDecision: SignalDecision =
    overrideReasons.length > 0 ? 'NO TRADE' : params.decision;

  return {
    finalDecision,
    rrRatio: rrCheck.ratio,
    isEntryValidAtCurrentPrice,
    overrideReasons,
  };
}

export function filterXauusdTradingViewUrls(rawInput: unknown): ApifySourceEntry[] {
  const candidates: string[] = [];

  const collect = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      candidates.push(node.trim());
    } else if (Array.isArray(node)) {
      for (const item of node) collect(item);
    } else if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const key of ['url', 'chartUrl', 'link', 'href', 'urls', 'charts', 'items']) {
        if (key in obj) collect(obj[key]);
      }
    }
  };

  collect(rawInput);

  const seen = new Set<string>();
  const results: ApifySourceEntry[] = [];

  for (const rawUrl of candidates) {
    if (!rawUrl.startsWith('http')) continue;
    const upper = rawUrl.toUpperCase();
    // Explicitly ignore BTCUSD / crypto URLs
    if (upper.includes('BTCUSD') || upper.includes('BTC')) continue;

    // Accept XAUUSD or TVC:GOLD URLs
    const isGold =
      upper.includes('XAUUSD') ||
      upper.includes('TVC:GOLD') ||
      upper.includes('TVC%3AGOLD');
    if (!isGold) continue;
    if (seen.has(rawUrl)) continue;
    seen.add(rawUrl);

    let symbol = 'XAUUSD';
    try {
      const parsed = new URL(rawUrl);
      const symParam = parsed.searchParams.get('symbol');
      if (symParam) {
        symbol = decodeURIComponent(symParam);
      } else {
        const match = rawUrl.match(/symbols\/([^/]+)/i);
        if (match) symbol = match[1].replace('-', ':');
      }
    } catch {
      // ignore URL parse error
    }

    results.push({ symbol, url: rawUrl });
  }

  return results;
}

export function maskSecret(value: string | undefined): string {
  if (!value || value.trim().length === 0) return 'Not configured';
  const trimmed = value.trim();
  if (trimmed.length <= 6) return '••••••';
  return `••••••••${trimmed.slice(-4)}`;
}

export function normalizeNewsTimestamp(rawDate?: string, tz?: string): string {
  if (!rawDate || !rawDate.trim()) return new Date().toISOString();
  const trimmed = rawDate.trim();
  // NewsData.io returns "YYYY-MM-DD HH:MM:SS" with pubDateTZ="UTC"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const suffix = !tz || tz.toUpperCase() === 'UTC' ? 'Z' : '';
    const parsed = Date.parse(`${trimmed.replace(' ', 'T')}${suffix}`);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export function sanitizeNewsSummary(raw?: string | null, maxLength = 240): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const cleaned = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  if (/only available in (paid|corporate) plans/i.test(cleaned)) return undefined;
  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export function mergeNewsTranslations<
  T extends { id: string; headlineFa?: string; summaryFa?: string }
>(
  items: T[],
  translations: Array<{ id: string; headlineFa?: string; summaryFa?: string }>
): T[] {
  const byId = new Map(translations.map((entry) => [entry.id, entry]));
  return items.map((item) => {
    const match = byId.get(item.id);
    if (!match) return item;
    const headlineFa = match.headlineFa?.trim() || item.headlineFa;
    const summaryFa = match.summaryFa?.trim() || item.summaryFa;
    return {
      ...item,
      ...(headlineFa ? { headlineFa } : {}),
      ...(summaryFa ? { summaryFa } : {}),
    };
  });
}

export function computeTargetImageDimensions(
  width: number,
  height: number,
  maxDimension = 1920
): { width: number; height: number; resized: boolean } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { width: 1, height: 1, resized: false };
  }
  const safeMax = Math.max(320, Math.floor(maxDimension));
  const longest = Math.max(width, height);
  if (longest <= safeMax) {
    return {
      width: Math.round(width),
      height: Math.round(height),
      resized: false,
    };
  }
  const scale = safeMax / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

export function estimateBase64DecodedBytes(dataUrlOrBase64: string): number {
  if (!dataUrlOrBase64) return 0;
  const commaIdx = dataUrlOrBase64.indexOf(',');
  const raw = (commaIdx >= 0 ? dataUrlOrBase64.slice(commaIdx + 1) : dataUrlOrBase64).replace(
    /\s+/g,
    ''
  );
  if (!raw) return 0;
  let padding = 0;
  if (raw.endsWith('==')) padding = 2;
  else if (raw.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

export function parseNdjsonChunk<T = Record<string, unknown>>(
  buffer: string,
  chunkText: string,
  flush = false
): { events: T[]; remainingBuffer: string } {
  const combined = `${buffer}${chunkText}`;
  const parts = combined.split('\n');
  const remaining = flush ? '' : parts.pop() || '';
  const events: T[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed) as T);
  }

  return { events, remainingBuffer: remaining };
}

export function formatClientNetworkError(
  err: unknown,
  language: 'fa' | 'en',
  context?: { payloadBytes?: number }
): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  const isNetworkFailure =
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed') ||
    lower.includes('err_connection') ||
    lower.includes('body stream');

  if (isNetworkFailure) {
    const mbNote =
      context?.payloadBytes && context.payloadBytes > 0
        ? ` (${(context.payloadBytes / (1024 * 1024)).toFixed(2)} MB)`
        : '';
    return language === 'fa'
      ? `ارتباط با سرور هنگام ارسال تصاویر${mbNote} قطع شد یا مرورگر نتوانست پاسخ را دریافت کند. لطفاً اتصال اینترنت را بررسی کرده و دوباره تلاش کنید؛ در صورت تکرار، تصاویر را با حجم کمتر یا فرمت JPG/PNG ذخیره و آپلود نمایید.`
      : `Connection to the server was interrupted while uploading charts${mbNote}. Please check your network connection and retry, or try re-saving the chart screenshots as standard PNG/JPG images.`;
  }

  return (
    raw ||
    (language === 'fa'
      ? 'خطای غیرمنتظره در ارتباط با سرور رخ داد.'
      : 'Unexpected error while running analysis.')
  );
}

export function formatGeminiErrorMessage(rawMessage: string, language: 'fa' | 'en'): string {
  const raw = (rawMessage || '').trim();
  const lower = raw.toLowerCase();

  if (lower.includes('403') || lower.includes('permission_denied') || lower.includes('api_key_invalid')) {
    return language === 'fa'
      ? 'احراز هویت سرویس Gemini نامعتبر است. لطفاً کلید GEMINI_API_KEY را در تنظیمات سرور بررسی کنید.'
      : 'Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets.';
  }

  if (lower.includes('429') || lower.includes('resource_exhausted')) {
    return language === 'fa'
      ? 'سهمیه روزانه یا محدودیت نرخ درخواست سرویس Gemini تکمیل شده است. لطفاً کمی بعد دوباره تلاش کنید یا کلید دارای صورتحساب را در بخش Settings > Secrets بررسی نمایید.'
      : 'Gemini API quota or rate limit exceeded. Please wait and retry later, or select a billing-enabled API key in Settings > Secrets.';
  }

  if (
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded')
  ) {
    return language === 'fa'
      ? 'سرویس هوش مصنوعی Gemini در حال حاضر با ترافیک بالا مواجه است (خطای موقت ۵۰۳). لطفاً چند ثانیه دیگر دوباره دکمه تحلیل را بزنید.'
      : 'Gemini AI is currently experiencing temporary high demand (503). Please wait a few seconds and try again.';
  }

  if (lower.includes('request payload size exceeds') || lower.includes('too large')) {
    return language === 'fa'
      ? 'حجم مجموع تصاویر ارسال‌شده بیش از حد مجاز سرویس تحلیل است. لطفاً اسکرین‌شات‌های با حجم کمتر آپلود کنید.'
      : 'Combined chart image payload exceeded the AI service limit. Please upload smaller screenshots.';
  }

  return raw || (language === 'fa' ? 'خطا در تحلیل تصاویر با هوش مصنوعی.' : 'Gemini Vision request failed.');
}

export function parseApiKeyPool(primaryKey?: string, poolEnv?: string): string[] {
  const candidates: string[] = [];
  const pushSplit = (raw?: string) => {
    if (!raw || typeof raw !== 'string') return;
    for (const part of raw.split(/[\s,;،|]+/)) {
      const trimmed = part.trim().replace(/^['"]|['"]$/g, '');
      if (trimmed) candidates.push(trimmed);
    }
  };

  pushSplit(poolEnv);
  pushSplit(primaryKey);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of candidates) {
    if (!key || key === 'MY_GEMINI_API_KEY' || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export type GeminiRetryAction = 'rotate_cooldown' | 'rotate_auth' | 'retry_transient' | 'fatal';

export function classifyGeminiRetryAction(errorMessage: string): GeminiRetryAction {
  const lower = (errorMessage || '').toLowerCase();
  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return 'rotate_cooldown';
  }
  if (
    lower.includes('403') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('expired') ||
    lower.includes('unauthenticated')
  ) {
    return 'rotate_auth';
  }
  if (
    lower.includes('503') ||
    lower.includes('500') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('abort') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset')
  ) {
    return 'retry_transient';
  }
  return 'fatal';
}

export function isApifyApiToken(key?: string): boolean {
  return Boolean(key && key.trim().startsWith('apify_api_'));
}

export function resolveApifyToken(apifyToken?: string, goldApiKey?: string): string {
  const direct = (apifyToken || '').trim();
  if (direct && direct !== 'MY_APIFY_API_TOKEN') return direct;
  const fallback = (goldApiKey || '').trim();
  if (isApifyApiToken(fallback)) return fallback;
  return '';
}

export function parseTradingViewPrice(raw?: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return +raw.toFixed(2);
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/,/g, '');
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!match) return null;
  let value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'K') value *= 1000;
  else if (suffix === 'M') value *= 1_000_000;
  return +value.toFixed(2);
}

export function parsePercentChange(raw?: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return +raw.toFixed(2);
  }
  if (typeof raw !== 'string') return null;
  const match = raw.trim().replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? +value.toFixed(2) : null;
}

export interface TradingViewScannerQuote {
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
}

export function parseTradingViewScannerGold(payload: unknown): TradingViewScannerQuote | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: Array<{ s?: string; d?: unknown[] }> }).data;
  if (!Array.isArray(data) || data.length === 0) return null;

  const preferred =
    data.find((row) => (row.s || '').toUpperCase().includes('XAUUSD')) ||
    data.find((row) => (row.s || '').toUpperCase().includes('GOLD')) ||
    data[0];

  const cols = preferred?.d;
  if (!Array.isArray(cols) || cols.length < 1) return null;

  const round2 = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(2) : null;

  const price = round2(cols[0]);
  if (price === null || price <= 0) return null;

  const open = round2(cols[1]);
  const high = round2(cols[2]);
  const low = round2(cols[3]);
  const changePercent = round2(cols[4]);
  const change = round2(cols[5]);
  const prevClose = change !== null ? +(price - change).toFixed(2) : null;

  return { price, open, high, low, prevClose, change, changePercent };
}

export interface ParsedRssNewsEntry {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  url?: string;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseGoogleNewsRss(xmlText: string, maxItems = 12): ParsedRssNewsEntry[] {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const entries: ParsedRssNewsEntry[] = [];
  const itemMatches = xmlText.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    if (entries.length >= maxItems) break;
    const rawTitle = itemXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const rawLink = itemXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '';
    const rawGuid = itemXml.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || '';
    const rawPubDate = itemXml.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
    const rawSource = itemXml.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '';

    let headline = decodeXmlEntities(rawTitle);
    if (!headline) continue;

    let source = decodeXmlEntities(rawSource);
    const trailingSep = headline.lastIndexOf(' - ');
    if (trailingSep > 15) {
      const candidateSource = headline.slice(trailingSep + 3).trim();
      if (candidateSource && (!source || candidateSource.toLowerCase() === source.toLowerCase())) {
        if (!source) source = candidateSource;
        headline = headline.slice(0, trailingSep).trim();
      }
    }

    const url = decodeXmlEntities(rawLink) || undefined;
    const id = decodeXmlEntities(rawGuid) || url || `rss-${entries.length}`;
    entries.push({
      id,
      headline,
      source: source || 'Google News',
      publishedAt: normalizeNewsTimestamp(decodeXmlEntities(rawPubDate)),
      ...(url ? { url } : {}),
    });
  }

  return entries;
}

export function resolveFirebaseAuthDomain(options: {
  hostname?: string | null;
  configuredAuthDomain: string;
  envAuthDomain?: string | null;
}): string {
  const cleanHostInput = (raw?: string | null): string => {
    if (!raw || typeof raw !== 'string') return '';
    return raw
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  };

  const explicit = cleanHostInput(options.envAuthDomain);
  if (explicit) return explicit;

  const configured = cleanHostInput(options.configuredAuthDomain) || options.configuredAuthDomain;
  return configured;
}

