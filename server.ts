import dotenv from 'dotenv';
dotenv.config({ override: true });
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractAdminTokenFromHeaders,
  issueAdminSessionToken,
  verifyAdminCredentials,
  verifyAdminSessionToken,
} from './src/lib/adminAuth.ts';
import { filterXauusdTradingViewUrls } from './src/lib/tradingRules.ts';
import type { AdminOverviewPayload, Language } from './src/types.ts';
import { getApifyStatus, runApifySupplementarySync } from './server/apifyService.ts';
import { runtimeStore } from './server/config.ts';
import { runMultiTimeframeAnalysis, type UploadedChartInput } from './server/geminiAnalysis.ts';
import { fetchGoldReferencePrice, getSessionGoldTicks } from './server/goldApi.ts';
import { fetchMacroGoldNews } from './server/newsService.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

// Simple in-memory request throttler per IP
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function throttleMiddleware(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${req.ip || 'local'}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait briefly before retrying.',
        code: 'RATE_LIMITED',
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}

function getAdminEnv() {
  return {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_SECRET: process.env.ADMIN_SECRET,
  };
}

async function adminGuard(req: Request, res: Response, next: NextFunction) {
  const token = extractAdminTokenFromHeaders(req.headers as Record<string, string | undefined>);
  const verified = await verifyAdminSessionToken(token, getAdminEnv());
  if (!verified.valid) {
    res.status(401).json({
      error: 'Admin authorization required. Please sign in with valid admin credentials.',
      code: 'ADMIN_UNAUTHORIZED',
    });
    return;
  }
  next();
}

async function createServer() {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });
  app.use(express.json({ limit: '48mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'Aurum AI',
      timestamp: new Date().toISOString(),
    });
  });

  // Live GoldAPI Reference Price
  app.get('/api/market/gold', throttleMiddleware(30, 60_000), async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const data = await fetchGoldReferencePrice(forceRefresh);
    res.json({
      market: data,
      sessionTicks: getSessionGoldTicks(),
    });
  });

  // Apify TradingView XAUUSD Status
  app.get('/api/market/apify', (_req, res) => {
    res.json(getApifyStatus());
  });

  // Economic News Adapter
  app.get('/api/news', throttleMiddleware(20, 60_000), async (req, res) => {
    const lang: Language = req.query.lang === 'en' ? 'en' : 'fa';
    const forceRefresh = req.query.refresh === '1';
    const feed = await fetchMacroGoldNews(lang, forceRefresh);
    res.json(feed);
  });

  // Quota & Subscription Status
  app.get('/api/subscription/status', (req, res) => {
    const clientKey = req.header('x-client-id')?.trim() || req.ip || 'web-client';
    const tier = runtimeStore.config.vipOverrideEnabled ? 'VIP' : 'FREE';
    const dailyLimit =
      tier === 'VIP' ? runtimeStore.config.vipDailyQuota : runtimeStore.config.freeDailyQuota;
    const usedToday = runtimeStore.getClientUsage(clientKey);
    res.json({
      tier,
      dailyLimit,
      usedToday,
      remainingToday: Math.max(0, dailyLimit - usedToday),
      config: runtimeStore.config,
    });
  });

  // Main Multi-Timeframe AI Analysis Endpoint (NDJSON streaming stages)
  app.post('/api/analyze', throttleMiddleware(10, 60_000), async (req, res) => {
    const clientKey = req.header('x-client-id')?.trim() || req.ip || 'web-client';
    const tier = runtimeStore.config.vipOverrideEnabled ? 'VIP' : 'FREE';
    const dailyLimit =
      tier === 'VIP' ? runtimeStore.config.vipDailyQuota : runtimeStore.config.freeDailyQuota;
    const usedToday = runtimeStore.getClientUsage(clientKey);

    if (usedToday >= dailyLimit) {
      res.status(429).json({
        error: `Daily analysis quota reached (${usedToday}/${dailyLimit} for ${tier} plan).`,
        code: 'QUOTA_EXCEEDED',
      });
      return;
    }

    const body = req.body as {
      charts?: UploadedChartInput[];
      language?: Language;
    };

    const language: Language = body?.language === 'en' ? 'en' : 'fa';
    const charts = body?.charts || [];

    // Stream NDJSON stages so frontend shows real backend progress
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientClosed = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        clientClosed = true;
      }
    });

    const writeEvent = (payload: Record<string, unknown>) => {
      if (!clientClosed && !res.writableEnded) {
        res.write(`${JSON.stringify(payload)}\n`);
      }
    };

    // Keep proxy / Cloud Run HTTP stream alive during multi-image Gemini inference
    const heartbeat = setInterval(() => {
      if (!clientClosed && !res.writableEnded) {
        res.write('\n');
      }
    }, 5000);

    try {
      const report = await runMultiTimeframeAnalysis({
        charts,
        language,
        callbacks: {
          onStage: (stage, totalStages, stageKey, message) => {
            writeEvent({
              type: 'stage',
              stage,
              totalStages,
              stageKey,
              message,
            });
          },
        },
      });

      runtimeStore.incrementClientUsage(clientKey);
      writeEvent({ type: 'complete', report });
      if (!res.writableEnded) res.end();
    } catch (err) {
      const errObj = err as { message?: string; code?: string };
      writeEvent({
        type: 'error',
        error: errObj?.message || 'Unexpected error during AI analysis.',
        errorCode: errObj?.code || 'ANALYSIS_FAILED',
      });
      if (!res.writableEnded) res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });

  // Admin Authentication & Protected Admin Endpoints (no raw secrets ever returned!)
  app.post('/api/admin/login', throttleMiddleware(15, 60_000), async (req, res) => {
    const body = (req.body || {}) as { username?: string; password?: string };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const env = getAdminEnv();
    const ok = await verifyAdminCredentials(username, password, env);
    if (!ok) {
      res.status(401).json({
        error: 'Invalid admin username or password.',
        code: 'INVALID_ADMIN_CREDENTIALS',
      });
      return;
    }
    const session = await issueAdminSessionToken(username, env);
    res.json({
      ok: true,
      username,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  app.get('/api/admin/overview', adminGuard, (_req, res) => {
    const logs = runtimeStore.analysisLogs;
    const payload: AdminOverviewPayload = {
      persistentAuthConfigured: runtimeStore.config.persistentBackendConfigured,
      stats: {
        totalRegisteredUsers: null,
        activeVipUsers: null,
        totalAnalyses: logs.length,
        successfulAnalyses: logs.filter((l) => l.status === 'completed').length,
        failedAnalyses: logs.filter((l) => l.status === 'failed' || l.status === 'rejected').length,
      },
      apis: runtimeStore.getApiHealthSummaries(),
      recentAnalyses: logs.slice(0, 25),
      config: runtimeStore.config,
    };
    res.json(payload);
  });

  app.post('/api/admin/config', adminGuard, (req, res) => {
    const body = req.body as Partial<typeof runtimeStore.config>;
    if (typeof body.freeDailyQuota === 'number' && body.freeDailyQuota >= 1 && body.freeDailyQuota <= 100) {
      runtimeStore.config.freeDailyQuota = Math.floor(body.freeDailyQuota);
    }
    if (typeof body.vipDailyQuota === 'number' && body.vipDailyQuota >= 1 && body.vipDailyQuota <= 500) {
      runtimeStore.config.vipDailyQuota = Math.floor(body.vipDailyQuota);
    }
    if (typeof body.goldCacheSeconds === 'number' && body.goldCacheSeconds >= 15 && body.goldCacheSeconds <= 3600) {
      runtimeStore.config.goldCacheSeconds = Math.floor(body.goldCacheSeconds);
    }
    if (typeof body.vipOverrideEnabled === 'boolean') {
      runtimeStore.config.vipOverrideEnabled = body.vipOverrideEnabled;
    }
    res.json({ ok: true, config: runtimeStore.config });
  });

  app.post('/api/admin/apify/sync', adminGuard, async (_req, res) => {
    const status = await runApifySupplementarySync();
    res.json(status);
  });

  app.post('/api/admin/apify/urls', adminGuard, (req, res) => {
    const { rawJson } = req.body as { rawJson?: unknown };
    let parsed: unknown = rawJson;
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        res.status(400).json({ error: 'Invalid JSON payload provided.' });
        return;
      }
    }
    const filtered = filterXauusdTradingViewUrls(parsed);
    if (filtered.length === 0) {
      res.status(400).json({
        error: 'No valid XAUUSD / TVC:GOLD TradingView URLs found in the uploaded JSON (BTCUSD URLs are ignored).',
      });
      return;
    }
    runtimeStore.xauusdSources = filtered;
    res.json({
      ok: true,
      count: filtered.length,
      xauusdSources: filtered,
    });
  });

  // Ensure API body-parser / payload errors return structured JSON instead of HTML
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!err) {
      next();
      return;
    }
    const errObj = err as { type?: string; status?: number; message?: string };
    if (errObj.type === 'entity.too.large' || errObj.status === 413) {
      res.status(413).json({
        error: 'Uploaded images exceed the maximum request size limit.',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }
    if (err instanceof SyntaxError || errObj.type === 'entity.parse.failed') {
      res.status(400).json({
        error: 'Malformed JSON request payload.',
        code: 'INVALID_JSON',
      });
      return;
    }
    res.status(errObj.status || 500).json({
      error: errObj.message || 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  });

  // Mount Vite middleware in development or serve built dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aurum AI server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Aurum AI server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
