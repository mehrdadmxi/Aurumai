import { ThinkingLevel, Type } from '@google/genai';
import crypto from 'node:crypto';
import type {
  AnalysisReport,
  ChartInspectionResult,
  GoldMarketData,
  Language,
  NewsFeedState,
  SignalDecision,
  TimeframeSlot,
} from '../src/types.ts';
import {
  calculateOverallTechnicalScore,
  classifyGeminiRetryAction,
  evaluateSignalValidity,
  formatGeminiErrorMessage,
  isExplicitNonGoldSymbol,
  validateImageFileMeta,
} from '../src/lib/tradingRules.ts';
import { runtimeStore } from './config.ts';
import { executeWithGeminiKeyPool, getGeminiApiKeys } from './geminiPool.ts';
import { fetchGoldReferencePrice } from './goldApi.ts';
import { getApifyStatus, runApifySupplementarySync } from './apifyService.ts';
import { fetchMacroGoldNews } from './newsService.ts';

export interface UploadedChartInput {
  timeframe: TimeframeSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  confirmedTimeframe?: boolean;
}

export interface AnalyzeWorkflowCallbacks {
  onStage: (stage: number, totalStages: number, stageKey: string, message: string) => void;
}

const GEMINI_SYSTEM_INSTRUCTION = `You are Aurum AI, an institutional-grade XAUUSD (Gold) multi-timeframe Smart Money Concepts (SMC) & Price Action trading analyst.
Your primary objective is to examine THREE chart screenshots together (1H, 15M, and 5M) and deliver a clear, actionable trading plan ("BUY" or "SELL") whenever the charts show a readable price structure and a valid Risk-to-Reward setup (>= 1:1.5), while filtering out non-chart uploads or genuinely untradeable chop.

OPERATING RULES:
1. Practical Chart Inspection:
   - Determine whether each image is a financial candlestick/bar/line chart with a readable price scale.
   - Trust the user's slot assignment (1H, 15M, 5M) even if TradingView's top-left symbol/timeframe badge is cropped, abbreviated (e.g., 60/15/5/H1/M15/M5), or partially hidden.
   - Only mark isXauusdOrGold = false if the screenshot EXPLICITLY shows a different non-Gold symbol (such as BTCUSD, ETHUSD, EURUSD, NAS100, US30). If the ticker label is cropped or unclear, assume XAUUSD as submitted.
   - If an image is NOT a financial chart (e.g., blank photo, meme, text document) or has NO readable price numbers anywhere on the chart, set finalDecision to "NO TRADE".

2. Multi-Timeframe Trade Synthesis (1H -> 15M -> 5M):
   - 1H Chart: Identify the dominant directional bias, swing highs/lows, supply/demand zones, and major liquidity pools.
   - 15M Chart: Identify market structure (BOS, CHoCH, MSS), liquidity sweeps (BSL/SSL, EQH/EQL), FVGs, and Order Blocks.
   - 5M Chart: Identify the actionable entry trigger or nearest pullback Entry Zone (limit or market), logical Stop Loss beyond structure/sweep invalidation, and three progressive Take Profit levels (TP1, TP2, TP3) targeting liquidity/structure.
   - IMPORTANT: A retracement/pullback on 15M or 5M against the 1H trend is NORMAL in real markets (it creates discount buys in a bullish 1H trend or premium sells in a bearish 1H trend). Do NOT treat a lower-timeframe pullback as a "conflict" requiring NO TRADE—instead, align the trade with the higher-probability structure (or counter-trend CHoCH reversal if 15M/5M structure clearly shifted) and place Entry at the key reaction level.

3. Strict Evidence & Non-Fabrication Rules:
   - ONLY cite indicators that are visibly rendered on the screenshots (e.g., EMA, RSI, MACD). If none are shown, analyze pure price action and structure.
   - If Volume is NOT visible on the charts, set volumeScore to null (N/A).
   - If News data is marked unavailable in the prompt context, set fundamentalScore to null (N/A) and note news is unavailable.
   - Read prices directly from the visible chart price axis on the screenshots. Never invent prices detached from the uploaded charts.

4. Signal & Risk-to-Reward Construction:
   - Return exactly one primary decision: "BUY", "SELL", or "NO TRADE".
   - Actively provide a "BUY" or "SELL" plan whenever a directional edge and clear structural SL/TP levels exist on the screenshots (do NOT default to "NO TRADE" out of excessive caution). Reserve "NO TRADE" only for non-charts, non-Gold assets, unreadable charts with no price scale, or completely flat/directionless range chop where no 1:1.5 setup exists.
   - Analyze based on the uploaded charts' own price scale even if the GoldAPI live price differs (the user may be testing historical, replay, or broker/futures Gold charts). Note any price gap vs GoldAPI in plannedVsCurrentNote without forcing NO TRADE.
   - Always ensure numeric Entry, Stop Loss, TP1, TP2, and TP3 satisfy Risk-to-Reward >= 1.5 at TP1 (and preferably 1.8–2.5+):
     - For BUY: stopLoss < entryPrice < takeProfit1 <= takeProfit2 <= takeProfit3.
     - For SELL: stopLoss > entryPrice > takeProfit1 >= takeProfit2 >= takeProfit3.`;

const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    finalDecision: {
      type: Type.STRING,
      description: 'Must be exactly one of: "BUY", "SELL", or "NO TRADE".',
    },
    marketDirection: {
      type: Type.STRING,
      description: 'Concise summary of overall XAUUSD market direction.',
    },
    chartInspections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timeframeSlot: { type: Type.STRING },
          isFinancialChart: { type: Type.BOOLEAN },
          detectedSymbol: { type: Type.STRING },
          isXauusdOrGold: { type: Type.BOOLEAN },
          detectedTimeframe: { type: Type.STRING },
          matchesSelectedSlot: { type: Type.BOOLEAN },
          isReadable: { type: Type.BOOLEAN },
          priceAxisVisible: { type: Type.BOOLEAN },
          timeAxisVisible: { type: Type.BOOLEAN },
          visibleIndicators: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          appearsIncompleteOrStale: { type: Type.BOOLEAN },
          extractedCurrentPrice: { type: Type.NUMBER, nullable: true },
          notes: { type: Type.STRING },
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
      type: Type.OBJECT,
      properties: {
        mainTrend: { type: Type.STRING },
        marketStructure: { type: Type.STRING },
        importantLevels: { type: Type.STRING },
        technicalObservations: { type: Type.STRING },
      },
      required: ['mainTrend', 'marketStructure', 'importantLevels', 'technicalObservations'],
    },
    analysis15M: {
      type: Type.OBJECT,
      properties: {
        marketStructure: { type: Type.STRING },
        liquidity: { type: Type.STRING },
        bosChochMss: { type: Type.STRING },
        fvgOrderBlocks: { type: Type.STRING },
        importantLevels: { type: Type.STRING },
      },
      required: [
        'marketStructure',
        'liquidity',
        'bosChochMss',
        'fvgOrderBlocks',
        'importantLevels',
      ],
    },
    analysis5M: {
      type: Type.OBJECT,
      properties: {
        entryConfirmation: { type: Type.STRING },
        candlestickConfirmation: { type: Type.STRING },
        entryZone: { type: Type.STRING },
        setupValidity: { type: Type.STRING },
      },
      required: [
        'entryConfirmation',
        'candlestickConfirmation',
        'entryZone',
        'setupValidity',
      ],
    },
    tradingPlan: {
      type: Type.OBJECT,
      properties: {
        entryZone: { type: Type.STRING },
        entryPrice: { type: Type.NUMBER, nullable: true },
        stopLoss: { type: Type.NUMBER, nullable: true },
        takeProfit1: { type: Type.NUMBER, nullable: true },
        takeProfit2: { type: Type.NUMBER, nullable: true },
        takeProfit3: { type: Type.NUMBER, nullable: true },
        entryTimeframe: { type: Type.STRING },
        invalidationLevel: { type: Type.STRING },
        invalidationPrice: { type: Type.NUMBER, nullable: true },
        plannedVsCurrentNote: { type: Type.STRING },
      },
      required: ['entryZone', 'entryTimeframe', 'invalidationLevel', 'plannedVsCurrentNote'],
    },
    scores: {
      type: Type.OBJECT,
      properties: {
        priceAction: { type: Type.NUMBER, nullable: true },
        marketStructure: { type: Type.NUMBER, nullable: true },
        volume: { type: Type.NUMBER, nullable: true },
        candlestickConfirmation: { type: Type.NUMBER, nullable: true },
        multiTimeframeAlignment: { type: Type.NUMBER, nullable: true },
        fundamentalContext: { type: Type.NUMBER, nullable: true },
        explanations: {
          type: Type.OBJECT,
          properties: {
            priceAction: { type: Type.STRING },
            marketStructure: { type: Type.STRING },
            volume: { type: Type.STRING },
            candlestickConfirmation: { type: Type.STRING },
            multiTimeframeAlignment: { type: Type.STRING },
            fundamentalContext: { type: Type.STRING },
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
      type: Type.OBJECT,
      properties: {
        relevantEvents: { type: Type.STRING },
        newsImpact: { type: Type.STRING },
        usdContext: { type: Type.STRING },
        riskConditions: { type: Type.STRING },
      },
      required: ['relevantEvents', 'newsImpact', 'usdContext', 'riskConditions'],
    },
    setupInvalidation: { type: Type.STRING },
    detailedExplanation: {
      type: Type.OBJECT,
      properties: {
        decisionReason: { type: Type.STRING },
        supportingConfirmations: { type: Type.STRING },
        timeframeAlignment: { type: Type.STRING },
        invalidationConditions: { type: Type.STRING },
        priceProximityCheck: { type: Type.STRING },
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

function stripDataUrlPrefix(base64: string): string {
  const idx = base64.indexOf(',');
  return idx >= 0 ? base64.slice(idx + 1) : base64;
}

function normalizeDecision(raw: string | undefined): SignalDecision {
  const upper = (raw || '').trim().toUpperCase();
  if (upper === 'BUY') return 'BUY';
  if (upper === 'SELL') return 'SELL';
  return 'NO TRADE';
}

export async function runMultiTimeframeAnalysis(params: {
  charts: UploadedChartInput[];
  language: Language;
  callbacks: AnalyzeWorkflowCallbacks;
}): Promise<AnalysisReport> {
  const { charts, language, callbacks } = params;
  const totalStages = 7;
  const analysisId = `aurum-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  // STAGE 1: Validate all three uploaded chart images
  callbacks.onStage(
    1,
    totalStages,
    'validating_charts',
    language === 'fa'
      ? 'در حال اعتبارسنجی تصاویر آپلودشده (1H, 15M, 5M)...'
      : 'Validating uploaded 1H, 15M, and 5M charts...'
  );

  if (!Array.isArray(charts) || charts.length !== 3) {
    throw Object.assign(new Error('Exactly three charts (1H, 15M, 5M) are required.'), {
      code: 'MISSING_IMAGES',
    });
  }

  const slotMap = new Map<TimeframeSlot, UploadedChartInput>();
  for (const chart of charts) {
    if (!['1H', '15M', '5M'].includes(chart.timeframe)) {
      throw Object.assign(new Error(`Invalid timeframe slot: ${chart.timeframe}`), {
        code: 'INVALID_TIMEFRAME',
      });
    }
    const check = validateImageFileMeta({
      mimeType: chart.mimeType,
      sizeBytes: chart.sizeBytes,
      base64: chart.base64,
    });
    if (!check.valid) {
      throw Object.assign(new Error(check.errorMessage || 'Invalid chart image.'), {
        code: check.errorCode || 'INVALID_IMAGE',
      });
    }
    slotMap.set(chart.timeframe, chart);
  }

  const chart1H = slotMap.get('1H');
  const chart15M = slotMap.get('15M');
  const chart5M = slotMap.get('5M');
  if (!chart1H || !chart15M || !chart5M) {
    throw Object.assign(new Error('All three distinct timeframes (1H, 15M, 5M) are required.'), {
      code: 'MISSING_IMAGES',
    });
  }

  if (getGeminiApiKeys().length === 0) {
    runtimeStore.recordApiError(
      'Gemini',
      'GEMINI_API_KEY / GEMINI_API_KEYS is not configured in environment secrets.',
      'disconnected'
    );
    throw Object.assign(
      new Error(
        'Gemini Vision service is not configured (missing GEMINI_API_KEY in server secrets).'
      ),
      { code: 'GEMINI_NOT_CONFIGURED' }
    );
  }

  // STAGE 2 & 3 & 4: Prepare multi-timeframe context & check GoldAPI + Apify + News
  callbacks.onStage(
    2,
    totalStages,
    'reading_1h',
    language === 'fa'
      ? 'در حال بررسی ساختار تایم‌فریم 1H و همگام‌سازی داده‌ها...'
      : 'Preparing 1H directional context and market references...'
  );

  // STAGE 5 (and parallel prep): Check Live GoldAPI Reference Price + News + Apify
  callbacks.onStage(
    5,
    totalStages,
    'checking_gold_price',
    language === 'fa'
      ? 'در حال استعلام قیمت لحظه‌ای مرجع طلا از GoldAPI و بررسی اخبار اقتصادی...'
      : 'Checking live GoldAPI XAUUSD reference price and economic context...'
  );

  const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);

  const fallbackNews: NewsFeedState = {
    providerConfigured: Boolean(process.env.NEWS_API_KEY?.trim()),
    providerName: process.env.NEWS_API_KEY?.trim()?.startsWith('pub_') ? 'NewsData.io' : 'NewsAPI',
    status: 'disconnected',
    lastFetchedAt: null,
    error: 'Timed out waiting for news feed.',
    items: [],
  };

  const currentApify = getApifyStatus();

  const [goldData, newsState, apifyState]: [GoldMarketData, NewsFeedState, ReturnType<typeof getApifyStatus>] =
    await Promise.all([
      fetchGoldReferencePrice(false),
      withTimeout(fetchMacroGoldNews('en'), 6000, fallbackNews),
      currentApify.configured && !currentApify.lastSyncedAt
        ? withTimeout(runApifySupplementarySync(), 6000, currentApify)
        : Promise.resolve(currentApify),
    ]);

  callbacks.onStage(
    3,
    totalStages,
    'analyzing_15m',
    language === 'fa'
      ? 'در حال ارسال همزمان سه چارت به Gemini Vision برای تحلیل ساختار 15M و نقدینگی...'
      : 'Analyzing 1H trend, 15M liquidity & structure with Gemini Vision...'
  );

  const goldContextText =
    goldData.price !== null
      ? `GoldAPI XAUUSD Reference Price: $${goldData.price} USD (Data freshness: ${
          goldData.isStale ? 'CACHED/STALE' : goldData.isCached ? 'CACHED (recent)' : 'LIVE'
        }, fetchedAt: ${goldData.fetchedAt}, High: ${goldData.high ?? 'N/A'}, Low: ${
          goldData.low ?? 'N/A'
        }, Daily Change: ${goldData.changePercent ?? 'N/A'}%).`
      : `GoldAPI XAUUSD Reference Price: UNAVAILABLE (${goldData.error || 'Service disconnected'}). State clearly that live reference price verification could not be completed.`;

  const newsContextText =
    newsState.providerConfigured && newsState.items.length > 0
      ? `Recent Economic/Gold News Items (${newsState.items.length}):\n` +
        newsState.items
          .slice(0, 6)
          .map(
            (n) =>
              `- [${n.category} | Impact: ${n.goldImpact}${n.isDelayed ? ' | DELAYED' : ''}] ${
                n.headline
              } (${n.source}, ${n.publishedAt})`
          )
          .join('\n')
      : 'Economic News Provider: NOT CONFIGURED / UNAVAILABLE. You MUST state that news data is currently unavailable and set scores.fundamentalContext to null.';

  const apifyContextText = apifyState.supplementarySummary
    ? `Supplementary TradingView (Apify Actor ${apifyState.actorId}): ${apifyState.supplementarySummary}`
    : `Supplementary TradingView (Apify Actor ${apifyState.actorId}): Unavailable or not run; rely on the three uploaded charts and GoldAPI.`;

  const outputLanguageInstruction =
    language === 'fa'
      ? 'Respond with ALL descriptive text fields written in fluent, professional Persian (Farsi) financial terminology (e.g., روند صعودی/نزولی، شکست ساختار BOS، تغییر کاراکتر CHoCH، گپ ارزش منصفانه FVG، بلاک سفارش OB، حد ضرر، حد سود). Keep finalDecision strictly as "BUY", "SELL", or "NO TRADE".'
      : 'Respond with ALL descriptive text fields written in crisp, institutional English financial terminology. Keep finalDecision strictly as "BUY", "SELL", or "NO TRADE".';

  const userPrompt = `Analyze these THREE XAUUSD chart screenshots together in strict multi-timeframe order:
- Image 1 is user-confirmed as 1H (Main Market Direction).
- Image 2 is user-confirmed as 15M (Market Structure & Liquidity).
- Image 3 is user-confirmed as 5M (Entry Confirmation).

Current Timestamp: ${new Date().toISOString()}
${goldContextText}
${newsContextText}
${apifyContextText}

${outputLanguageInstruction}

Execution Checklist:
- First verify the images are financial price charts with visible price numbers (do NOT reject cropped charts if the ticker or timeframe text is not shown, unless a different symbol like BTCUSD/EURUSD is explicitly visible).
- Synthesize 1H bias + 15M structure/liquidity + 5M entry trigger or pullback zone to produce an actionable "BUY" or "SELL" trading plan whenever a valid setup exists.
- Read Entry, Stop Loss, TP1, TP2, and TP3 strictly from the price scale visible on the uploaded screenshots, ensuring RR >= 1.5 at TP1.
- Mention any difference between the screenshot's current price and the GoldAPI reference price (${
    goldData.price ?? 'UNAVAILABLE'
  }) in plannedVsCurrentNote, WITHOUT rejecting valid historical, replay, or broker-offset charts as NO TRADE.`;

  callbacks.onStage(
    4,
    totalStages,
    'finding_5m_entry',
    language === 'fa'
      ? 'در حال بررسی تاییدیه ورود در تایم‌فریم 5M و الگوهای کندلی...'
      : 'Evaluating 5M entry confirmation and candlestick triggers...'
  );

  let parsedRaw: Record<string, unknown>;
  try {
    const sharedParts = [
      {
        text: 'Chart 1 (Confirmed Slot: 1H - Main Market Direction):',
      },
      {
        inlineData: {
          mimeType: chart1H.mimeType,
          data: stripDataUrlPrefix(chart1H.base64),
        },
      },
      {
        text: 'Chart 2 (Confirmed Slot: 15M - Market Structure & Liquidity):',
      },
      {
        inlineData: {
          mimeType: chart15M.mimeType,
          data: stripDataUrlPrefix(chart15M.base64),
        },
      },
      {
        text: 'Chart 3 (Confirmed Slot: 5M - Entry Confirmation):',
      },
      {
        inlineData: {
          mimeType: chart5M.mimeType,
          data: stripDataUrlPrefix(chart5M.base64),
        },
      },
      {
        text: userPrompt,
      },
    ];

    const runWithModel = (
      model: string,
      thinkingLevel: ThinkingLevel,
      timeoutMs: number,
      extra?: { maxTotalMs?: number; maxTransientAttempts?: number }
    ) =>
      executeWithGeminiKeyPool(
        (ai, { abortSignal }) =>
          ai.models.generateContent({
            model,
            contents: { parts: sharedParts },
            config: {
              systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingLevel },
              responseMimeType: 'application/json',
              responseSchema: ANALYSIS_RESPONSE_SCHEMA,
              ...(abortSignal ? { abortSignal } : {}),
            },
          }),
        {
          modelScope: model,
          timeoutMs,
          ...extra,
        }
      );

    let response;
    try {
      response = await runWithModel('gemini-3-flash-preview', ThinkingLevel.LOW, 18_000, {
        maxTotalMs: 32_000,
        maxTransientAttempts: 3,
      });
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr || '');
      if (classifyGeminiRetryAction(primaryMsg) === 'fatal' && !primaryMsg.includes('404')) {
        throw primaryErr;
      }
      response = await runWithModel('gemini-3.1-flash-lite', ThinkingLevel.MEDIUM, 25_000, {
        maxTotalMs: 45_000,
      });
    }

    const jsonText = (response.text ?? '').trim();
    if (!jsonText) {
      throw new Error('Gemini returned an empty analysis response.');
    }
    parsedRaw = JSON.parse(jsonText) as Record<string, unknown>;
    runtimeStore.recordApiSuccess('Gemini');
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Gemini Vision request failed.';
    const friendly = formatGeminiErrorMessage(rawMsg, language);
    runtimeStore.recordApiError('Gemini', friendly, 'error');
    runtimeStore.addAnalysisLog({
      id: analysisId,
      createdAt: new Date().toISOString(),
      decision: 'NO TRADE',
      status: 'failed',
      error: friendly,
      goldReferencePrice: goldData.price,
    });
    throw Object.assign(new Error(friendly), { code: 'GEMINI_ERROR' });
  }

  callbacks.onStage(
    6,
    totalStages,
    'evaluating_confirmations',
    language === 'fa'
      ? 'در حال راستی‌آزمایی نسبت ریسک به ریوارد (RR >= 1:1.5) و هم‌خوانی قیمت مرجع...'
      : 'Verifying Risk-to-Reward (>= 1:1.5) and GoldAPI price consistency...'
  );

  // Extract structured fields safely
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

  const chart5MInspection = inspections.find((i) => i.timeframeSlot === '5M');
  const chartPrice =
    chart5MInspection?.extractedCurrentPrice ??
    inspections.find((i) => typeof i.extractedCurrentPrice === 'number')?.extractedCurrentPrice ??
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

  // Calculate technical scores without treating N/A as 0
  const rawScores = (parsedRaw.scores || {}) as Record<string, unknown>;
  const rawExplanations = (rawScores.explanations || {}) as Record<string, string>;

  const scoreFields = {
    priceAction: numOrNull(rawScores.priceAction),
    marketStructure: numOrNull(rawScores.marketStructure),
    volume: numOrNull(rawScores.volume),
    candlestickConfirmation: numOrNull(rawScores.candlestickConfirmation),
    multiTimeframeAlignment: numOrNull(rawScores.multiTimeframeAlignment),
    fundamentalContext: newsState.providerConfigured ? numOrNull(rawScores.fundamentalContext) : null,
  };

  const overallScore = calculateOverallTechnicalScore(scoreFields);

  callbacks.onStage(
    7,
    totalStages,
    'generating_report',
    language === 'fa'
      ? 'در حال تدوین گزارش نهایی تحلیل چندتایم‌فریمی Aurum AI...'
      : 'Compiling final Aurum AI multi-timeframe trading report...'
  );

  const a1h = (parsedRaw.analysis1H || {}) as Record<string, string>;
  const a15m = (parsedRaw.analysis15M || {}) as Record<string, string>;
  const a5m = (parsedRaw.analysis5M || {}) as Record<string, string>;
  const fund = (parsedRaw.fundamentalContext || {}) as Record<string, string>;
  const expl = (parsedRaw.detailedExplanation || {}) as Record<string, string>;

  const freshness: 'live' | 'cached' | 'unavailable' =
    goldData.price === null ? 'unavailable' : goldData.isCached ? 'cached' : 'live';

  const overrideNotice =
    validationOverrides.length > 0
      ? (language === 'fa'
          ? 'تغییر خودکار به عدم معامله (NO TRADE) توسط موتور اعتبارسنجی: '
          : 'Deterministic Validation Engine enforced NO TRADE: ') +
        validationOverrides.join(' | ')
      : '';

  const report: AnalysisReport = {
    id: analysisId,
    symbol: 'XAUUSD',
    language,
    createdAt: new Date().toISOString(),
    analysisStatus: validationOverrides.some((v) => v.includes('not recognized') || v.includes('not XAUUSD'))
      ? 'rejected'
      : 'completed',
    goldReferencePrice: goldData.price,
    goldDataFreshness: freshness,
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
      entryZone: String(rawPlan.entryZone || (finalDecision === 'NO TRADE' ? 'N/A' : '')),
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
        volume: String(rawExplanations.volume || 'Volume unavailable on screenshots (N/A).'),
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
      relevantEvents: newsState.providerConfigured
        ? String(fund.relevantEvents || '')
        : language === 'fa'
          ? 'در حال حاضر داده اخبار اقتصادی در دسترس نیست.'
          : 'News data is currently unavailable.',
      newsImpact: newsState.providerConfigured ? String(fund.newsImpact || '') : 'N/A',
      usdContext: String(fund.usdContext || (newsState.providerConfigured ? '' : 'N/A')),
      riskConditions: String(fund.riskConditions || ''),
      newsAvailable: newsState.providerConfigured && newsState.items.length > 0,
    },
    setupInvalidation: String(parsedRaw.setupInvalidation || ''),
    detailedExplanation: {
      decisionReason: overrideNotice
        ? `${overrideNotice}\n\n${String(expl.decisionReason || '')}`
        : String(expl.decisionReason || ''),
      supportingConfirmations: String(expl.supportingConfirmations || ''),
      timeframeAlignment: String(expl.timeframeAlignment || ''),
      invalidationConditions: String(expl.invalidationConditions || ''),
      priceProximityCheck: String(expl.priceProximityCheck || ''),
    },
    apifyContextUsed: Boolean(apifyState.lastRunItemsCount > 0),
    validationOverrides,
  };

  runtimeStore.addAnalysisLog({
    id: report.id,
    createdAt: report.createdAt,
    decision: report.decision,
    status: report.analysisStatus,
    goldReferencePrice: report.goldReferencePrice,
  });

  return report;
}
