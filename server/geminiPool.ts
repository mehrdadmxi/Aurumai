import { GoogleGenAI } from '@google/genai';
import {
  classifyGeminiRetryAction,
  maskSecret,
  parseApiKeyPool,
} from '../src/lib/tradingRules.ts';

const QUOTA_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown after 429 on a model
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours cooldown for invalid/blocked key

const keyCooldowns = new Map<string, { until: number; reason: string }>();
let roundRobinCursor = 0;

function cooldownSlot(modelScope: string, apiKey: string): string {
  return `${modelScope}::${apiKey}`;
}

export function getGeminiApiKeys(): string[] {
  return parseApiKeyPool(process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEYS);
}

export function getGeminiPoolMaskedSummary(modelScope = 'gemini-3.1-flash-lite'): {
  configured: boolean;
  totalKeys: number;
  healthyKeys: number;
  maskedDisplay: string;
} {
  const keys = getGeminiApiKeys();
  const now = Date.now();
  const healthy = keys.filter((k) => {
    const authBlocked = keyCooldowns.get(cooldownSlot('*', k));
    if (authBlocked && now < authBlocked.until) return false;
    const modelBlocked = keyCooldowns.get(cooldownSlot(modelScope, k));
    return !modelBlocked || now >= modelBlocked.until;
  });

  if (keys.length === 0) {
    return {
      configured: false,
      totalKeys: 0,
      healthyKeys: 0,
      maskedDisplay: 'Not configured',
    };
  }

  const maskedPrimary = maskSecret(keys[0]);
  return {
    configured: true,
    totalKeys: keys.length,
    healthyKeys: healthy.length,
    maskedDisplay: keys.length > 1 ? `${keys.length} keys (${maskedPrimary})` : maskedPrimary,
  };
}

function getOrderedCandidateKeys(keys: string[], modelScope: string): string[] {
  const now = Date.now();
  const len = keys.length;
  if (len === 0) return [];

  const startIdx = roundRobinCursor % len;
  roundRobinCursor = (roundRobinCursor + 1) % len;

  const rotated: string[] = [];
  for (let i = 0; i < len; i++) {
    rotated.push(keys[(startIdx + i) % len]);
  }

  const healthy: string[] = [];
  const cooling: Array<{ key: string; until: number }> = [];

  for (const key of rotated) {
    const authCd = keyCooldowns.get(cooldownSlot('*', key));
    if (authCd && now < authCd.until) {
      cooling.push({ key, until: authCd.until });
      continue;
    }
    if (authCd) keyCooldowns.delete(cooldownSlot('*', key));

    const slot = cooldownSlot(modelScope, key);
    const cd = keyCooldowns.get(slot);
    if (!cd || now >= cd.until) {
      if (cd) keyCooldowns.delete(slot);
      healthy.push(key);
    } else {
      cooling.push({ key, until: cd.until });
    }
  }

  // Try healthy keys first; if all are cooling down, try the ones closest to recovery as last resort
  cooling.sort((a, b) => a.until - b.until);
  return [...healthy, ...cooling.map((c) => c.key)];
}

export async function executeWithGeminiKeyPool<T>(
  operation: (
    ai: GoogleGenAI,
    keyMeta: { keyIndex: number; totalKeys: number; abortSignal?: AbortSignal }
  ) => Promise<T>,
  options?: {
    modelScope?: string;
    timeoutMs?: number;
    maxTotalMs?: number;
    maxTransientAttempts?: number;
  }
): Promise<T> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw Object.assign(
      new Error('Gemini API is not configured (missing GEMINI_API_KEY / GEMINI_API_KEYS in server secrets).'),
      { code: 'GEMINI_NOT_CONFIGURED' }
    );
  }

  const modelScope = options?.modelScope || 'default';
  const ordered = getOrderedCandidateKeys(keys, modelScope);
  const startedAt = Date.now();
  let transientCount = 0;
  let lastError: unknown;

  for (let i = 0; i < ordered.length; i++) {
    if (options?.maxTotalMs && i > 0 && Date.now() - startedAt >= options.maxTotalMs) {
      break;
    }

    const apiKey = ordered[i];
    const keyIndex = keys.indexOf(apiKey);
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const remainingBudget =
      options?.maxTotalMs ? Math.max(3000, options.maxTotalMs - (Date.now() - startedAt)) : undefined;
    const effectiveTimeoutMs =
      options?.timeoutMs && remainingBudget
        ? Math.min(options.timeoutMs, remainingBudget)
        : options?.timeoutMs ?? remainingBudget;

    const abortSignal =
      effectiveTimeoutMs && effectiveTimeoutMs > 0
        ? AbortSignal.timeout(effectiveTimeoutMs)
        : undefined;

    try {
      const result = await operation(ai, { keyIndex, totalKeys: keys.length, abortSignal });
      keyCooldowns.delete(cooldownSlot(modelScope, apiKey));
      keyCooldowns.delete(cooldownSlot('*', apiKey));
      return result;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err || '');
      const action = classifyGeminiRetryAction(msg);

      if (action === 'fatal') {
        throw err;
      }

      if (action === 'rotate_cooldown') {
        keyCooldowns.set(cooldownSlot(modelScope, apiKey), {
          until: Date.now() + QUOTA_COOLDOWN_MS,
          reason: 'quota',
        });
      } else if (action === 'rotate_auth') {
        keyCooldowns.set(cooldownSlot('*', apiKey), {
          until: Date.now() + AUTH_COOLDOWN_MS,
          reason: 'auth',
        });
      } else if (action === 'retry_transient') {
        keyCooldowns.set(cooldownSlot(modelScope, apiKey), {
          until: Date.now() + 2 * 60 * 1000,
          reason: 'transient',
        });
        transientCount += 1;
        if (options?.maxTransientAttempts && transientCount >= options.maxTransientAttempts) {
          break;
        }
        if (i < ordered.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'All Gemini API keys failed.'));
}
