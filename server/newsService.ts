import { ThinkingLevel, Type } from '@google/genai';
import fs from 'node:fs';
import type { Language, NewsFeedState, NewsItem } from '../src/types.ts';
import {
  mergeNewsTranslations,
  normalizeNewsTimestamp,
  parseGoogleNewsRss,
  sanitizeNewsSummary,
} from '../src/lib/tradingRules.ts';
import { runtimeStore } from './config.ts';
import { executeWithGeminiKeyPool, getGeminiApiKeys } from './geminiPool.ts';

const TRANSLATION_CACHE_PATH = '/tmp/aurum-news-translations.json';
let cachedNews: NewsFeedState | null = null;
let lastNewsFetchMs = 0;
const NEWS_CACHE_MS = 15 * 60 * 1000;
const translationCache = new Map<string, { headlineFa: string; summaryFa?: string }>();
let inFlightTranslation: Promise<NewsItem[]> | null = null;
let inFlightNewsFetch: Promise<NewsFeedState> | null = null;
let translationCooldownUntil = 0;

function loadTranslationCacheFromDisk() {
  try {
    if (!fs.existsSync(TRANSLATION_CACHE_PATH)) return;
    const raw = fs.readFileSync(TRANSLATION_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { headlineFa: string; summaryFa?: string }>;
    if (parsed && typeof parsed === 'object') {
      for (const [key, val] of Object.entries(parsed)) {
        if (val?.headlineFa) {
          translationCache.set(key, val);
        }
      }
    }
  } catch {
    // Ignore cache read failures
  }
}

function saveTranslationCacheToDisk() {
  try {
    const entries = Array.from(translationCache.entries()).slice(-120);
    const serialized = JSON.stringify(Object.fromEntries(entries));
    fs.writeFileSync(TRANSLATION_CACHE_PATH, serialized, 'utf8');
  } catch {
    // Ignore cache write failures
  }
}

loadTranslationCacheFromDisk();

function categorizeHeadline(title: string): {
  category: NewsItem['category'];
  goldImpact: NewsItem['goldImpact'];
} {
  const lower = title.toLowerCase();
  let category: NewsItem['category'] = 'USD Index';
  if (lower.includes('fomc') || lower.includes('federal reserve') || lower.includes('fed ') || lower.includes("fed's")) {
    category = 'Fed / FOMC';
  } else if (lower.includes('cpi') || lower.includes('pce') || lower.includes('inflation')) {
    category = 'Inflation (CPI/PCE)';
  } else if (lower.includes('nfp') || lower.includes('payroll') || lower.includes('unemployment') || lower.includes('jobs')) {
    category = 'Labor (NFP/Jobs)';
  } else if (lower.includes('yield') || lower.includes('treasury') || lower.includes('rate')) {
    category = 'US Rates & Yields';
  } else if (lower.includes('central bank') || lower.includes('ecb') || lower.includes('boe') || lower.includes('pboc')) {
    category = 'Central Banks';
  } else if (lower.includes('war') || lower.includes('conflict') || lower.includes('tariff') || lower.includes('geopolit')) {
    category = 'Geopolitics';
  }

  let goldImpact: NewsItem['goldImpact'] = 'Mixed / Volatile';
  if (lower.includes('rate cut') || lower.includes('dovish') || lower.includes('safe haven') || lower.includes('dollar falls') || lower.includes('gold rises') || lower.includes('gold jumps')) {
    goldImpact = 'Bullish';
  } else if (lower.includes('rate hike') || lower.includes('hawkish') || lower.includes('dollar surges') || lower.includes('yields jump') || lower.includes('gold falls')) {
    goldImpact = 'Bearish';
  }

  return { category, goldImpact };
}

async function translateNewsItemsToPersian(items: NewsItem[]): Promise<NewsItem[]> {
  if (items.length === 0) return items;

  // Apply any cached translations immediately
  const cachedEntries: Array<{ id: string; headlineFa?: string; summaryFa?: string }> = [];
  const pendingItems: NewsItem[] = [];

  for (const item of items) {
    const cacheKey = `${item.id}::${item.headline}`;
    const hit = translationCache.get(cacheKey);
    if (hit) {
      cachedEntries.push({ id: item.id, headlineFa: hit.headlineFa, summaryFa: hit.summaryFa });
    } else if (!item.headlineFa) {
      pendingItems.push(item);
    }
  }

  let merged = cachedEntries.length > 0 ? mergeNewsTranslations(items, cachedEntries) : items;
  if (pendingItems.length === 0) {
    return merged;
  }

  if (Date.now() < translationCooldownUntil) {
    return merged;
  }

  if (getGeminiApiKeys().length === 0) {
    return merged;
  }

  if (inFlightTranslation) {
    try {
      const done = await inFlightTranslation;
      const doneMap = new Map(done.map((d) => [d.id, d]));
      return merged.map((m) => {
        const hit = doneMap.get(m.id);
        return hit?.headlineFa ? { ...m, headlineFa: hit.headlineFa, summaryFa: hit.summaryFa ?? m.summaryFa } : m;
      });
    } catch {
      return merged;
    }
  }

  inFlightTranslation = (async () => {
    try {
      const inputPayload = pendingItems.map((item) => ({
        id: item.id,
        headline: item.headline,
        summary: (item.summary || '').slice(0, 180),
      }));

      const response = await executeWithGeminiKeyPool(
        (ai, { abortSignal }) =>
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: `Translate the following financial/economic news items accurately into natural, professional Persian (Farsi) used by gold (XAUUSD) and forex traders. Keep financial tickers/abbreviations like XAUUSD, FOMC, CPI, PCE, NFP, DXY, Fed clear and accurate. Return one translated entry per item id.\n\nItems:\n${JSON.stringify(inputPayload)}`,
            config: {
              systemInstruction:
                'You are a professional financial translator specializing in macroeconomics, Federal Reserve policy, inflation, and XAUUSD gold news. Translate English headlines and summaries into concise, accurate Persian (Farsi) without adding invented facts.',
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    headlineFa: { type: Type.STRING },
                    summaryFa: { type: Type.STRING },
                  },
                  required: ['id', 'headlineFa'],
                },
              },
              ...(abortSignal ? { abortSignal } : {}),
            },
          }),
        {
          modelScope: 'gemini-3.1-flash-lite',
          timeoutMs: 6_500,
          maxTotalMs: 18_000,
          maxTransientAttempts: 4,
        }
      );

      const rawText = (response.text ?? '[]')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(rawText) as Array<{
        id: string;
        headlineFa?: string;
        summaryFa?: string;
      }>;

      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const sourceItem = pendingItems.find((p) => p.id === entry.id);
          if (sourceItem && entry.headlineFa?.trim()) {
            translationCache.set(`${sourceItem.id}::${sourceItem.headline}`, {
              headlineFa: entry.headlineFa.trim(),
              ...(entry.summaryFa?.trim() ? { summaryFa: entry.summaryFa.trim() } : {}),
            });
          }
        }
        saveTranslationCacheToDisk();
        merged = mergeNewsTranslations(merged, parsed);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        translationCooldownUntil = Date.now() + 15 * 60 * 1000;
      } else {
        console.info('News Persian translation deferred; showing English headlines.');
      }
    } finally {
      inFlightTranslation = null;
    }

    return merged;
  })();

  return inFlightTranslation;
}

async function fetchGoogleNewsRssItems(signal?: AbortSignal): Promise<NewsItem[]> {
  const rssUrl =
    'https://news.google.com/rss/search?q=XAUUSD+OR+%22gold+price%22+OR+%22Federal+Reserve%22+OR+FOMC+OR+CPI&hl=en-US&gl=US&ceid=US:en';
  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'AurumAI-News/1.0' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Google News RSS returned HTTP ${res.status}.`);
  }
  const xml = await res.text();
  const parsed = parseGoogleNewsRss(xml, 12);
  parsed.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return parsed.map((entry) => {
    const publishedMs = Date.parse(entry.publishedAt);
    const ageHours = Number.isFinite(publishedMs)
      ? (Date.now() - publishedMs) / (1000 * 60 * 60)
      : 0;
    const { category, goldImpact } = categorizeHeadline(entry.headline);
    return {
      id: entry.id,
      headline: entry.headline,
      source: entry.source,
      publishedAt: entry.publishedAt,
      category,
      goldImpact,
      isDelayed: ageHours > 2,
      ...(entry.url ? { url: entry.url } : {}),
    };
  });
}

export async function fetchMacroGoldNews(
  language: Language = 'fa',
  forceRefresh = false
): Promise<NewsFeedState> {
  const apiKey = process.env.NEWS_API_KEY?.trim() || '';

  const now = Date.now();
  if (!forceRefresh && cachedNews && now - lastNewsFetchMs < NEWS_CACHE_MS) {
    if (language === 'fa' && cachedNews.items.some((item) => !item.headlineFa)) {
      cachedNews = {
        ...cachedNews,
        items: await translateNewsItemsToPersian(cachedNews.items),
      };
    }
    return cachedNews;
  }

  if (inFlightNewsFetch && !forceRefresh) {
    const shared = await inFlightNewsFetch;
    if (language === 'fa' && shared.items.some((item) => !item.headlineFa)) {
      return {
        ...shared,
        items: await translateNewsItemsToPersian(shared.items),
      };
    }
    return shared;
  }

  lastNewsFetchMs = now;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const isAskNewsKey = apiKey.startsWith('ank_');
  const isNewsDataKey = apiKey.startsWith('pub_');
  const providerLabel = !apiKey
    ? 'Google News RSS'
    : isAskNewsKey
      ? 'AskNews'
      : isNewsDataKey
        ? 'NewsData.io'
        : 'NewsAPI';

  const runFetch = async (): Promise<NewsFeedState> => {
    try {
      let items: NewsItem[] = [];
      let primaryError: string | null = null;
      let resolvedProvider = providerLabel;

      if (apiKey) {
        try {
          if (isAskNewsKey) {
            const query = encodeURIComponent(
              'XAUUSD OR gold OR "Federal Reserve" OR FOMC OR CPI OR inflation'
            );
            const url = `https://api.asknews.app/v1/news/search?query=${query}&n_articles=12&method=kw&return_type=dicts&languages=en`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            });

            if (!res.ok) {
              throw new Error(`AskNews returned HTTP ${res.status}.`);
            }

            const payload = (await res.json()) as {
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

            items = (payload.as_dicts || [])
              .filter((a) => Boolean(a.eng_title || a.title))
              .slice(0, 12)
              .map((a, idx) => {
                const title = (a.eng_title || a.title || '').trim();
                const summary = sanitizeNewsSummary(a.summary);
                const { category, goldImpact } = categorizeHeadline(`${title} ${summary || ''}`);
                const publishedAt = normalizeNewsTimestamp(a.pub_date);
                const publishedMs = Date.parse(publishedAt);
                const ageHours = (Date.now() - publishedMs) / (1000 * 60 * 60);
                return {
                  id: a.article_id || a.article_url || `asknews-${idx}-${publishedMs}`,
                  headline: title,
                  ...(summary && summary !== title ? { summary } : {}),
                  source: (a.source_id || a.domain_url || 'AskNews').trim(),
                  publishedAt,
                  category,
                  goldImpact,
                  isDelayed: ageHours > 2,
                  url: a.article_url,
                };
              });
          } else if (isNewsDataKey) {
            const qInTitle = encodeURIComponent('gold OR XAUUSD OR Fed OR FOMC OR inflation OR CPI OR dollar');
            const url = `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(apiKey)}&qInTitle=${qInTitle}&language=en&category=business`;
            const res = await fetch(url, { signal: controller.signal });

            if (!res.ok) {
              throw new Error(`NewsData.io returned HTTP ${res.status}.`);
            }

            const payload = (await res.json()) as {
              status?: string;
              results?: Array<{
                article_id?: string;
                title?: string;
                description?: string | null;
                source_name?: string;
                source_id?: string;
                pubDate?: string;
                pubDateTZ?: string;
                link?: string;
              }>;
              results_message?: string;
            };

            if (payload.status && payload.status !== 'success') {
              throw new Error(payload.results_message || 'NewsData.io returned an error response.');
            }

            items = (payload.results || [])
              .filter((a) => Boolean(a.title))
              .slice(0, 12)
              .map((a, idx) => {
                const title = a.title || '';
                const summary = sanitizeNewsSummary(a.description);
                const { category, goldImpact } = categorizeHeadline(title);
                const publishedAt = normalizeNewsTimestamp(a.pubDate, a.pubDateTZ);
                const publishedMs = Date.parse(publishedAt);
                const ageHours = (Date.now() - publishedMs) / (1000 * 60 * 60);
                return {
                  id: a.article_id || `news-${idx}-${publishedMs}`,
                  headline: title,
                  ...(summary && summary !== title ? { summary } : {}),
                  source: a.source_name || a.source_id || 'NewsData.io',
                  publishedAt,
                  category,
                  goldImpact,
                  isDelayed: ageHours > 2,
                  url: a.link,
                };
              });
          } else {
            const query = encodeURIComponent(
              '(gold OR XAUUSD OR "Federal Reserve" OR FOMC OR CPI OR PCE OR NFP OR "US Dollar" OR "Treasury yields")'
            );
            const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=12`;
            const res = await fetch(url, {
              headers: { 'X-Api-Key': apiKey },
              signal: controller.signal,
            });

            if (!res.ok) {
              throw new Error(`News provider returned HTTP ${res.status}.`);
            }

            const payload = (await res.json()) as {
              articles?: Array<{
                title?: string;
                description?: string | null;
                source?: { name?: string };
                publishedAt?: string;
                url?: string;
              }>;
            };

            items = (payload.articles || [])
              .filter((a) => Boolean(a.title))
              .map((a, idx) => {
                const title = a.title || '';
                const summary = sanitizeNewsSummary(a.description);
                const { category, goldImpact } = categorizeHeadline(title);
                const publishedAt = normalizeNewsTimestamp(a.publishedAt);
                const publishedMs = Date.parse(publishedAt);
                const ageHours = (Date.now() - publishedMs) / (1000 * 60 * 60);
                return {
                  id: `news-${idx}-${publishedMs}`,
                  headline: title,
                  ...(summary && summary !== title ? { summary } : {}),
                  source: a.source?.name || 'External Wire',
                  publishedAt,
                  category,
                  goldImpact,
                  isDelayed: ageHours > 2,
                  url: a.url,
                };
              });
          }
        } catch (err) {
          primaryError =
            err instanceof Error ? err.message : 'Failed to connect to primary news provider.';
        }
      }

      if (items.length === 0) {
        try {
          const rssItems = await fetchGoogleNewsRssItems(controller.signal);
          if (rssItems.length > 0) {
            items = rssItems;
            resolvedProvider = apiKey ? `${providerLabel} → Google News RSS (fallback)` : 'Google News RSS';
          }
        } catch (rssErr) {
          const rssMsg =
            rssErr instanceof Error ? rssErr.message : 'Google News RSS fallback failed.';
          const msg = primaryError ? `${primaryError} ${rssMsg}` : rssMsg;
          runtimeStore.recordApiError('NewsAPI', msg, 'error');
          return {
            providerConfigured: Boolean(apiKey),
            providerName: providerLabel,
            status: 'error',
            lastFetchedAt: cachedNews?.lastFetchedAt || null,
            error: msg,
            items: cachedNews?.items || [],
          };
        }
      }

      if (language === 'fa') {
        items = await translateNewsItemsToPersian(items);
      }

      if (primaryError) {
        runtimeStore.recordApiError('NewsAPI', `${primaryError} Using Google News RSS fallback.`, 'connected');
      } else {
        runtimeStore.recordApiSuccess('NewsAPI');
      }
      cachedNews = {
        providerConfigured: true,
        providerName: resolvedProvider,
        status: 'connected',
        lastFetchedAt: new Date().toISOString(),
        error: primaryError,
        items,
      };
      return cachedNews;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to connect to external news provider.';
      runtimeStore.recordApiError('NewsAPI', msg, 'error');
      return {
        providerConfigured: Boolean(apiKey),
        providerName: providerLabel,
        status: 'error',
        lastFetchedAt: cachedNews?.lastFetchedAt || null,
        error: msg,
        items: cachedNews?.items || [],
      };
    } finally {
      clearTimeout(timeout);
      inFlightNewsFetch = null;
    }
  };

  inFlightNewsFetch = runFetch();
  return inFlightNewsFetch;
}
