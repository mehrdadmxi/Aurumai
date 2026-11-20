import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../../functions/api/[[path]].ts';
import { onRequest as onAuthProxyRequest } from '../../functions/__/auth/[[path]].ts';

function makeContext(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    env?: Record<string, string | undefined>;
  }
) {
  const method = options?.method || 'GET';
  const headers = new Headers(options?.headers || {});
  let body: string | undefined;
  if (options?.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  const request = new Request(`https://aurumai-73x.pages.dev${path}`, {
    method,
    headers,
    body,
  });
  return {
    request,
    env: options?.env || {},
    params: { path: path.replace(/^\/api\/?/, '').split('/') },
  };
}

test('GET /api/health reports non-secret configuredApis flags', async () => {
  const resEmpty = await onRequest(makeContext('/api/health'));
  assert.equal(resEmpty.status, 200);
  const jsonEmpty = (await resEmpty.json()) as {
    ok: boolean;
    configuredApis: Record<string, boolean | number>;
  };
  assert.equal(jsonEmpty.ok, true);
  assert.equal(jsonEmpty.configuredApis.gemini, false);
  assert.equal(jsonEmpty.configuredApis.goldApi, false);

  const resConfigured = await onRequest(
    makeContext('/api/health/', {
      env: {
        GEMINI_API_KEYS: 'k1,k2',
        GOLDAPI_API_KEY: 'gold-key',
        NEWS_API_KEY: 'news-key',
        APIFY_API_TOKEN: 'apify-tok',
      },
    })
  );
  const jsonCfg = (await resConfigured.json()) as {
    configuredApis: {
      gemini: boolean;
      geminiKeyCount: number;
      goldApi: boolean;
      newsApi: boolean;
      apify: boolean;
    };
  };
  assert.equal(jsonCfg.configuredApis.gemini, true);
  assert.equal(jsonCfg.configuredApis.geminiKeyCount, 2);
  assert.equal(jsonCfg.configuredApis.goldApi, true);
  assert.equal(jsonCfg.configuredApis.newsApi, true);
  assert.equal(jsonCfg.configuredApis.apify, true);
});

test('GET /api/market/gold handles missing key, quota fallback, and live GoldAPI fetch', async () => {
  const originalFetch = globalThis.fetch;

  // 0. When missing key AND upstream fallback feeds fail, status is disconnected
  globalThis.fetch = (async () => new Response('{}', { status: 503 })) as typeof fetch;
  try {
    const resNoKey = await onRequest(makeContext('/api/market/gold'));
    const jsonNoKey = (await resNoKey.json()) as { market: { status: string; price: number | null } };
    assert.equal(jsonNoKey.market.status, 'disconnected');
    assert.equal(jsonNoKey.market.price, null);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 1. Test MONTHLY_API_QUOTA_EXCEEDED fallback to api.gold-api.com + TradingView Scanner
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes('goldapi.io')) {
      return new Response(
        JSON.stringify({ code: 'MONTHLY_API_QUOTA_EXCEEDED', error: 'Quota exceeded' }),
        { status: 403 }
      );
    }
    if (u.includes('api.gold-api.com/price/XAU')) {
      return new Response(
        JSON.stringify({ price: 3582.97, updatedAt: '2026-11-20T10:28:05Z' }),
        { status: 200 }
      );
    }
    if (u.includes('scanner.tradingview.com')) {
      return new Response(
        JSON.stringify({
          data: [{ s: 'OANDA:XAUUSD', d: [3583.1, 3610, 3620, 3550, -0.75, -27.1] }],
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const resFallback = await onRequest(
      makeContext('/api/market/gold?refresh=1', {
        env: { GOLDAPI_API_KEY: 'goldapi-quota-test' },
      })
    );
    const jsonFallback = (await resFallback.json()) as {
      market: { status: string; price: number; high: number; low: number; source: string; error: string };
    };
    assert.equal(jsonFallback.market.status, 'connected');
    assert.equal(jsonFallback.market.price, 3582.97);
    assert.equal(jsonFallback.market.high, 3620);
    assert.equal(jsonFallback.market.low, 3550);
    assert.equal(jsonFallback.market.source, 'Gold-API + TradingView (fallback)');
    assert.ok(jsonFallback.market.error.includes('MONTHLY_API_QUOTA_EXCEEDED'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 2. Test primary GoldAPI live response (mocked non-refresh cache bypass via fresh isolate check)
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        price: 3685.5,
        prev_close_price: 3660.0,
        open_price: 3661.0,
        high_price: 3700.0,
        low_price: 3650.0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )) as typeof fetch;

  try {
    const resLive = await onRequest(
      makeContext('/api/market/gold', {
        env: { GOLDAPI_API_KEY: 'test-gold-key' },
      })
    );
    const jsonLive = (await resLive.json()) as {
      market: { status: string; price: number };
      sessionTicks: Array<{ price: number }>;
    };
    assert.equal(jsonLive.market.status, 'connected');
    assert.ok(jsonLive.market.price > 0);
    assert.ok(jsonLive.sessionTicks.length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/market/apify uses Actor ID hOfycUMuUpaFZvG7a and admin sync hits Apify REST API', async () => {
  const statusRes = await onRequest(makeContext('/api/market/apify'));
  const statusJson = (await statusRes.json()) as { actorId: string; status: string };
  assert.equal(statusJson.actorId, 'hOfycUMuUpaFZvG7a');
  assert.equal(statusJson.status, 'disconnected');

  const env = {
    ADMIN_USERNAME: 'admin-user',
    ADMIN_PASSWORD: 'StrongTestPassword123!',
    ADMIN_SECRET: 'signing-secret-xyz',
    APIFY_API_TOKEN: 'apify-test-token',
  };

  const loginRes = await onRequest(
    makeContext('/api/admin/login', {
      method: 'POST',
      body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD },
      env,
    })
  );
  assert.equal(loginRes.status, 200);
  const { token } = (await loginRes.json()) as { token: string };
  assert.ok(token);

  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(u);
    if (u.endsWith('/v2/acts/hOfycUMuUpaFZvG7a')) {
      return new Response(
        JSON.stringify({
          data: { title: 'TV Scraper', taggedBuilds: { latest: { buildId: 'b1' } } },
        }),
        { status: 200 }
      );
    }
    if (u.endsWith('/v2/actor-builds/b1')) {
      return new Response(
        JSON.stringify({
          data: { inputSchema: { properties: { symbols: { type: 'array' } } } },
        }),
        { status: 200 }
      );
    }
    if (u.includes('/run-sync-get-dataset-items')) {
      return new Response(JSON.stringify([{ symbol: 'TVC:GOLD', price: 3685 }]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const syncRes = await onRequest(
      makeContext('/api/admin/apify/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        env,
      })
    );
    assert.equal(syncRes.status, 200);
    const syncJson = (await syncRes.json()) as {
      status: string;
      lastRunItemsCount: number;
      inputSchemaDetected: boolean;
    };
    assert.equal(syncJson.status, 'connected');
    assert.equal(syncJson.inputSchemaDetected, true);
    assert.equal(syncJson.lastRunItemsCount, 1);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/analyze falls back from 404/400 primary models to gemini-3.1-flash-lite-preview and emits complete report', async () => {
  const sampleChart = {
    timeframe: '1H',
    fileName: 'chart.png',
    mimeType: 'image/png',
    sizeBytes: 128,
    base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  };
  const charts = [
    sampleChart,
    { ...sampleChart, timeframe: '15M' },
    { ...sampleChart, timeframe: '5M' },
  ];

  const modelsAttempted: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes('generativelanguage.googleapis.com')) {
      if (u.includes('gemini-3-flash-preview')) {
        modelsAttempted.push('gemini-3-flash-preview');
        return new Response(JSON.stringify({ error: { code: 404, message: 'Model not found' } }), {
          status: 404,
        });
      }
      if (u.includes('gemini-3.1-flash-lite-preview')) {
        modelsAttempted.push('gemini-3.1-flash-lite-preview');
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        finalDecision: 'BUY',
                        marketDirection: 'Bullish BOS above 3670',
                        chartInspections: [
                          {
                            timeframeSlot: '1H',
                            isFinancialChart: true,
                            detectedSymbol: 'XAUUSD',
                            isXauusdOrGold: true,
                            detectedTimeframe: '1H',
                            matchesSelectedSlot: true,
                            isReadable: true,
                            priceAxisVisible: true,
                            timeAxisVisible: true,
                            visibleIndicators: [],
                            appearsIncompleteOrStale: false,
                            extractedCurrentPrice: 3685,
                            notes: 'Clear bullish trend',
                          },
                        ],
                        analysis1H: {
                          mainTrend: 'Bullish',
                          marketStructure: 'HH/HL',
                          importantLevels: '3670 support',
                          technicalObservations: 'Strong impulse',
                        },
                        analysis15M: {
                          marketStructure: 'Pullback to OB',
                          liquidity: 'SSL swept',
                          bosChochMss: 'BOS confirmed',
                          fvgOrderBlocks: 'FVG at 3680',
                          importantLevels: '3675-3685',
                        },
                        analysis5M: {
                          entryConfirmation: 'CHoCH upward',
                          candlestickConfirmation: 'Bullish engulfing',
                          entryZone: '3680-3685',
                          setupValidity: 'Valid',
                        },
                        tradingPlan: {
                          entryZone: '3680 - 3685',
                          entryPrice: 3685,
                          stopLoss: 3675,
                          takeProfit1: 3705,
                          takeProfit2: 3715,
                          takeProfit3: 3725,
                          entryTimeframe: '5M',
                          invalidationLevel: 'Below 3675',
                          invalidationPrice: 3675,
                          plannedVsCurrentNote: 'Aligned with live spot',
                        },
                        scores: {
                          priceAction: 8.5,
                          marketStructure: 8.5,
                          volume: null,
                          candlestickConfirmation: 8.0,
                          multiTimeframeAlignment: 9.0,
                          fundamentalContext: null,
                          explanations: {
                            priceAction: 'Clean impulse',
                            marketStructure: 'Aligned BOS',
                            volume: 'N/A',
                            candlestickConfirmation: 'Engulfing close',
                            multiTimeframeAlignment: '1H/15M/5M aligned',
                            fundamentalContext: 'N/A',
                          },
                        },
                        fundamentalContext: {
                          relevantEvents: 'N/A',
                          newsImpact: 'N/A',
                          usdContext: 'N/A',
                          riskConditions: 'Standard risk',
                        },
                        setupInvalidation: 'Close below 3675',
                        detailedExplanation: {
                          decisionReason: '1H/15M/5M bullish alignment with 1:2 RR',
                          supportingConfirmations: 'SSL sweep + OB bounce',
                          timeframeAlignment: 'Aligned',
                          invalidationConditions: 'Break below 3675',
                          priceProximityCheck: 'At entry',
                        },
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('gemini-3.1-flash-lite')) {
        modelsAttempted.push('gemini-3.1-flash-lite');
        return new Response(
          JSON.stringify({ error: { code: 400, message: 'thinkingLevel unsupported' } }),
          { status: 400 }
        );
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const res = await onRequest(
      makeContext('/api/analyze', {
        method: 'POST',
        body: { charts, language: 'en' },
        env: { GEMINI_API_KEY: 'key-a, key-b, key-c' },
      })
    );
    assert.equal(res.status, 200);
    const ndjson = await res.text();
    const events = ndjson
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; report?: { decision: string } });

    const complete = events.find((e) => e.type === 'complete');
    assert.ok(complete?.report, 'Expected complete event with report');
    assert.equal(complete.report.decision, 'BUY');
    assert.deepEqual(modelsAttempted, [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-preview',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/news detects AskNews ank_* keys and maps articles cleanly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes('api.asknews.app/v1/news/search')) {
      return new Response(
        JSON.stringify({
          as_dicts: [
            {
              article_id: 'a1',
              eng_title: 'Gold holds steady ahead of Fed rate decision',
              summary: 'XAUUSD awaits Federal Reserve policy guidance.',
              source_id: 'Reuters',
              pub_date: '2026-11-20T09:00:00Z',
              article_url: 'https://example.com/gold-fed',
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const res = await onRequest(
      makeContext('/api/news?lang=en&refresh=1', {
        env: { NEWS_API_KEY: 'ank_test_token_12345' },
      })
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      providerName: string;
      status: string;
      items: Array<{ headline: string; category: string; source: string }>;
    };
    assert.equal(json.providerName, 'AskNews');
    assert.equal(json.status, 'connected');
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].category, 'Fed / FOMC');
    assert.equal(json.items[0].source, 'Reuters');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apify_api_* token in GOLDAPI_API_KEY powers /api/health, /api/market/gold, and Apify sync without hitting goldapi.io', async () => {
  const env = {
    GOLDAPI_API_KEY: 'apify_api_test_gold_token_999',
    ADMIN_USERNAME: 'admin-user',
    ADMIN_PASSWORD: 'StrongTestPassword123!',
    ADMIN_SECRET: 'signing-secret-xyz',
  };

  const healthRes = await onRequest(makeContext('/api/health', { env }));
  const healthJson = (await healthRes.json()) as {
    configuredApis: { goldApi: boolean; apify: boolean };
  };
  assert.equal(healthJson.configuredApis.goldApi, true);
  assert.equal(healthJson.configuredApis.apify, true);

  let calledGoldApiIo = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes('goldapi.io')) {
      calledGoldApiIo = true;
      return new Response('{}', { status: 403 });
    }
    if (u.includes('scanner.tradingview.com')) {
      return new Response(
        JSON.stringify({
          data: [{ s: 'OANDA:XAUUSD', d: [3589.4, 3620, 3630, 3540, -0.84, -30.6] }],
        }),
        { status: 200 }
      );
    }
    if (u.includes('api.gold-api.com/price/XAU')) {
      return new Response(
        JSON.stringify({ price: 3589.42, updatedAt: '2026-11-20T10:45:00Z' }),
        { status: 200 }
      );
    }
    if (u.includes('/runs/last/dataset/items')) {
      return new Response(
        JSON.stringify([{ symbol: 'TVC:GOLD', price: '3.59K USD', change: '-0.87%' }]),
        { status: 200 }
      );
    }
    if (u.endsWith('/v2/acts/hOfycUMuUpaFZvG7a')) {
      return new Response(
        JSON.stringify({ data: { title: 'TV Scraper', taggedBuilds: { latest: { buildId: 'b1' } } } }),
        { status: 200 }
      );
    }
    if (u.endsWith('/v2/actor-builds/b1')) {
      return new Response(
        JSON.stringify({ data: { inputSchema: { properties: { symbols: { type: 'array' } } } } }),
        { status: 200 }
      );
    }
    if (u.includes('/run-sync-get-dataset-items')) {
      return new Response(JSON.stringify([{ symbol: 'TVC:GOLD', price: '3.59K USD' }]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const goldRes = await onRequest(makeContext('/api/market/gold', { env }));
    const goldJson = (await goldRes.json()) as {
      market: {
        status: string;
        price: number;
        high: number | null;
        low: number | null;
        changePercent: number | null;
        source: string;
        error: string | null;
      };
    };
    assert.equal(calledGoldApiIo, false);
    assert.equal(goldJson.market.status, 'connected');
    assert.equal(goldJson.market.price, 3589.42);
    assert.equal(goldJson.market.high, 3630);
    assert.equal(goldJson.market.low, 3540);
    assert.equal(goldJson.market.changePercent, -0.84);
    assert.equal(goldJson.market.source, 'Apify + TradingView Live');
    assert.equal(goldJson.market.error, null);

    const loginRes = await onRequest(
      makeContext('/api/admin/login', {
        method: 'POST',
        body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD },
        env,
      })
    );
    const { token } = (await loginRes.json()) as { token: string };
    const syncRes = await onRequest(
      makeContext('/api/admin/apify/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        env,
      })
    );
    const syncJson = (await syncRes.json()) as { configured: boolean; status: string; lastRunItemsCount: number };
    assert.equal(syncJson.configured, true);
    assert.equal(syncJson.status, 'connected');
    assert.equal(syncJson.lastRunItemsCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/news falls back cleanly to Google News RSS when AskNews returns HTTP 401', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (u.includes('api.asknews.app')) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (u.includes('news.google.com/rss/search')) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
          <item>
            <title>Gold holds near $3,580 ahead of Fed decision - Yahoo Finance</title>
            <link>https://news.google.com/rss/articles/gold-1</link>
            <guid>rss-gold-1</guid>
            <pubDate>Fri, 20 Nov 2026 11:00:00 GMT</pubDate>
            <source url="https://finance.yahoo.com">Yahoo Finance</source>
          </item>
        </channel></rss>`,
        { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const res = await onRequest(
      makeContext('/api/news?lang=en&refresh=1', {
        env: { NEWS_API_KEY: 'ank_expired_key_123' },
      })
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      providerConfigured: boolean;
      providerName: string;
      status: string;
      items: Array<{ headline: string; source: string; category: string }>;
    };
    assert.equal(json.providerConfigured, true);
    assert.equal(json.status, 'connected');
    assert.ok(json.providerName.includes('Google News RSS'));
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].headline, 'Gold holds near $3,580 ahead of Fed decision');
    assert.equal(json.items[0].source, 'Yahoo Finance');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/__/auth/* reverse proxy forwards requests to Firebase Hosting with manual redirects and COOP header', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedRedirect = '';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    capturedRedirect = init?.redirect || '';
    return new Response('<html><body>Auth Handler</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    const res = await onAuthProxyRequest({
      request: new Request('https://aurumai-73x.pages.dev/__/auth/handler?apiKey=test&providerId=google.com'),
      env: {},
    });
    assert.equal(res.status, 200);
    assert.equal(
      capturedUrl,
      'https://totemic-booking-rvc14.firebaseapp.com/__/auth/handler?apiKey=test&providerId=google.com'
    );
    assert.equal(capturedRedirect, 'manual');
    assert.equal(res.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

