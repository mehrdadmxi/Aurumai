import type { ApifyStatusPayload } from '../src/types.ts';
import { resolveApifyToken } from '../src/lib/tradingRules.ts';
import { runtimeStore } from './config.ts';

export const APIFY_ACTOR_ID = 'hOfycUMuUpaFZvG7a';

function getConfiguredApifyToken(): string {
  return resolveApifyToken(process.env.APIFY_API_TOKEN, process.env.GOLDAPI_API_KEY);
}

let lastApifyState: Omit<ApifyStatusPayload, 'xauusdSources'> = {
  actorId: APIFY_ACTOR_ID,
  configured: Boolean(getConfiguredApifyToken()),
  status: 'disconnected',
  lastSyncedAt: null,
  lastError: getConfiguredApifyToken()
    ? null
    : 'APIFY_API_TOKEN is not configured in environment secrets.',
  actorName: null,
  inputSchemaDetected: false,
  inputSchemaKeys: [],
  supplementarySummary: null,
  lastRunItemsCount: 0,
};

interface ActorSchemaInspection {
  actorName: string | null;
  properties: Record<string, { type?: string; title?: string; description?: string }>;
}

async function inspectApifyActorSchema(token: string): Promise<ActorSchemaInspection> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    // 1. Inspect Actor metadata
    const metaRes = await fetch(`https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
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
    const actorName = metaJson.data?.title || metaJson.data?.name || APIFY_ACTOR_ID;

    // 2. Inspect latest build's input schema if available
    let properties: Record<string, { type?: string; title?: string; description?: string }> = {};
    const buildId = metaJson.data?.taggedBuilds?.latest?.buildId;
    if (buildId) {
      const buildRes = await fetch(`https://api.apify.com/v2/actor-builds/${buildId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (buildRes.ok) {
        const buildJson = (await buildRes.json()) as {
          data?: {
            inputSchema?: string | { properties?: Record<string, { type?: string }> };
          };
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

    return { actorName, properties };
  } finally {
    clearTimeout(timeout);
  }
}

function buildActorInputFromSchema(
  properties: Record<string, { type?: string }>
): Record<string, unknown> | null {
  const xauusdUrls = runtimeStore.xauusdSources.map((s) => s.url);
  const xauusdSymbols = runtimeStore.xauusdSources.map((s) => s.symbol);
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return null;
  }

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

export function getApifyStatus(): ApifyStatusPayload {
  const token = getConfiguredApifyToken();
  return {
    ...lastApifyState,
    configured: Boolean(token),
    lastError: token ? lastApifyState.lastError : 'APIFY_API_TOKEN is not configured in environment secrets.',
    xauusdSources: runtimeStore.xauusdSources,
  };
}

export async function runApifySupplementarySync(): Promise<ApifyStatusPayload> {
  const token = getConfiguredApifyToken();
  if (!token) {
    const msg = 'APIFY_API_TOKEN is not configured. Using screenshot + GoldAPI workflow only.';
    runtimeStore.recordApiError('Apify', msg, 'disconnected');
    lastApifyState = {
      ...lastApifyState,
      configured: false,
      status: 'disconnected',
      lastError: msg,
    };
    return getApifyStatus();
  }

  try {
    const inspection = await inspectApifyActorSchema(token);
    const schemaKeys = Object.keys(inspection.properties);
    const mappedInput = buildActorInputFromSchema(inspection.properties);

    if (!mappedInput) {
      const msg =
        schemaKeys.length === 0
          ? `Inspected Actor ${APIFY_ACTOR_ID} (${inspection.actorName}), but no compatible input schema properties were exposed for XAUUSD URL mapping.`
          : `Inspected Actor ${APIFY_ACTOR_ID} schema keys [${schemaKeys.join(', ')}], none matched XAUUSD URL/symbol fields. Skipping actor execution to avoid inventing schema fields.`;
      runtimeStore.recordApiError('Apify', msg, 'error');
      lastApifyState = {
        ...lastApifyState,
        configured: true,
        status: 'error',
        actorName: inspection.actorName,
        inputSchemaDetected: schemaKeys.length > 0,
        inputSchemaKeys: schemaKeys,
        lastError: msg,
      };
      return getApifyStatus();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28_000);

    try {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?timeout=25`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mappedInput),
          signal: controller.signal,
        }
      );

      if (!runRes.ok) {
        throw new Error(`Apify Actor execution failed (HTTP ${runRes.status}).`);
      }

      const items = (await runRes.json()) as unknown;
      const itemList = Array.isArray(items) ? items : [];
      const xauItems = itemList.filter((item) => {
        const serialized = JSON.stringify(item).toUpperCase();
        return !serialized.includes('BTCUSD');
      });

      const nowIso = new Date().toISOString();
      runtimeStore.recordApiSuccess('Apify');

      lastApifyState = {
        actorId: APIFY_ACTOR_ID,
        configured: true,
        status: 'connected',
        lastSyncedAt: nowIso,
        lastError: null,
        actorName: inspection.actorName,
        inputSchemaDetected: true,
        inputSchemaKeys: schemaKeys,
        supplementarySummary:
          xauItems.length > 0
            ? `Retrieved ${xauItems.length} supplementary XAUUSD TradingView records from Actor ${APIFY_ACTOR_ID}.`
            : `Actor ${APIFY_ACTOR_ID} completed with 0 XAUUSD items; analysis relies primarily on uploaded charts and GoldAPI.`,
        lastRunItemsCount: xauItems.length,
      };

      return getApifyStatus();
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Unexpected failure communicating with Apify.';
    runtimeStore.recordApiError('Apify', msg, 'error');
    lastApifyState = {
      ...lastApifyState,
      configured: true,
      status: 'error',
      lastError: msg,
    };
    return getApifyStatus();
  }
}
