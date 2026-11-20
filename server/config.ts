import type {
  ApiConnectionStatus,
  ApiHealthSummary,
  ApifySourceEntry,
  SignalDecision,
  SystemConfig,
} from '../src/types.ts';
import { DEFAULT_XAUUSD_SOURCES, maskSecret, resolveApifyToken } from '../src/lib/tradingRules.ts';
import { getGeminiPoolMaskedSummary } from './geminiPool.ts';

export interface ApiTelemetryEntry {
  status: ApiConnectionStatus;
  lastSuccessfulRequest: string | null;
  lastError: string | null;
}

export interface AnalysisLogEntry {
  id: string;
  createdAt: string;
  decision: SignalDecision;
  status: 'completed' | 'rejected' | 'failed';
  error?: string;
  goldReferencePrice: number | null;
}

class RuntimeStore {
  config: SystemConfig = {
    freeDailyQuota: 3,
    vipDailyQuota: 25,
    goldCacheSeconds: 60,
    supportedLanguages: ['fa', 'en'],
    vipOverrideEnabled: false,
    persistentBackendConfigured: true,
  };

  xauusdSources: ApifySourceEntry[] = [...DEFAULT_XAUUSD_SOURCES];

  telemetry: Record<'GoldAPI' | 'Apify' | 'Gemini' | 'NewsAPI', ApiTelemetryEntry> = {
    GoldAPI: {
      status: process.env.GOLDAPI_API_KEY ? 'disconnected' : 'disconnected',
      lastSuccessfulRequest: null,
      lastError: process.env.GOLDAPI_API_KEY
        ? null
        : 'GOLDAPI_API_KEY is not configured in environment secrets.',
    },
    Apify: {
      status: 'disconnected',
      lastSuccessfulRequest: null,
      lastError: resolveApifyToken(process.env.APIFY_API_TOKEN, process.env.GOLDAPI_API_KEY)
        ? null
        : 'APIFY_API_TOKEN is not configured in environment secrets.',
    },
    Gemini: {
      status: process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY ? 'connected' : 'disconnected',
      lastSuccessfulRequest: null,
      lastError:
        process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY
          ? null
          : 'GEMINI_API_KEY is not configured in environment secrets.',
    },
    NewsAPI: {
      status: process.env.NEWS_API_KEY ? 'connected' : 'disconnected',
      lastSuccessfulRequest: null,
      lastError: process.env.NEWS_API_KEY
        ? null
        : 'NEWS_API_KEY is not configured.',
    },
  };

  analysisLogs: AnalysisLogEntry[] = [];
  dailyUsageByClient: Map<string, { date: string; count: number }> = new Map();

  recordApiSuccess(name: 'GoldAPI' | 'Apify' | 'Gemini' | 'NewsAPI') {
    this.telemetry[name] = {
      status: 'connected',
      lastSuccessfulRequest: new Date().toISOString(),
      lastError: null,
    };
  }

  recordApiError(
    name: 'GoldAPI' | 'Apify' | 'Gemini' | 'NewsAPI',
    error: string,
    status: ApiConnectionStatus = 'error'
  ) {
    this.telemetry[name] = {
      ...this.telemetry[name],
      status,
      lastError: error,
    };
  }

  addAnalysisLog(entry: AnalysisLogEntry) {
    this.analysisLogs.unshift(entry);
    if (this.analysisLogs.length > 100) {
      this.analysisLogs.length = 100;
    }
  }

  getTodayDateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getClientUsage(clientKey: string): number {
    const today = this.getTodayDateKey();
    const record = this.dailyUsageByClient.get(clientKey);
    if (!record || record.date !== today) return 0;
    return record.count;
  }

  incrementClientUsage(clientKey: string): number {
    const today = this.getTodayDateKey();
    const current = this.getClientUsage(clientKey);
    const next = current + 1;
    this.dailyUsageByClient.set(clientKey, { date: today, count: next });
    return next;
  }

  getApiHealthSummaries(): ApiHealthSummary[] {
    const geminiSummary = getGeminiPoolMaskedSummary();
    const keyMap: Record<'GoldAPI' | 'Apify' | 'NewsAPI', string | undefined> = {
      GoldAPI: process.env.GOLDAPI_API_KEY,
      Apify: resolveApifyToken(process.env.APIFY_API_TOKEN, process.env.GOLDAPI_API_KEY) || undefined,
      NewsAPI: process.env.NEWS_API_KEY,
    };

    return (['GoldAPI', 'Apify', 'Gemini', 'NewsAPI'] as const).map((name) => {
      const t = this.telemetry[name];
      if (name === 'Gemini') {
        return {
          name,
          configured: geminiSummary.configured,
          maskedKey: geminiSummary.maskedDisplay,
          status: geminiSummary.configured ? (t.status === 'disconnected' ? 'connected' : t.status) : 'disconnected',
          lastSuccessfulRequest: t.lastSuccessfulRequest,
          lastError: geminiSummary.configured ? t.lastError : t.lastError || 'Gemini secret is not configured.',
        };
      }
      const secret = keyMap[name];
      const configured = Boolean(secret && secret.trim().length > 0);
      return {
        name,
        configured,
        maskedKey: maskSecret(secret),
        status: configured ? t.status : 'disconnected',
        lastSuccessfulRequest: t.lastSuccessfulRequest,
        lastError: configured ? t.lastError : t.lastError || `${name} secret is not configured.`,
      };
    });
  }
}

export const runtimeStore = new RuntimeStore();
