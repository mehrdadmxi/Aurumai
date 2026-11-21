export type Language = 'fa' | 'en';

export type TimeframeSlot = '1H' | '15M' | '5M';

export type SignalDecision = 'BUY' | 'SELL' | 'NO TRADE';

export type SignalStatus =
  | 'ACTIVE'
  | 'ENTRY REACHED'
  | 'TP1 HIT'
  | 'TP2 HIT'
  | 'TP3 HIT'
  | 'STOP LOSS HIT'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'UNVERIFIED';

export type SubscriptionTier = 'FREE' | 'VIP';

export type ApiConnectionStatus = 'connected' | 'disconnected' | 'error';

export type AppPage =
  | 'home'
  | 'dashboard'
  | 'analysis'
  | 'report'
  | 'signals'
  | 'market'
  | 'news'
  | 'gmail'
  | 'history'
  | 'pricing'
  | 'profile'
  | 'admin';

export interface ImageFileValidation {
  valid: boolean;
  errorCode?: 'MISSING' | 'INVALID_FORMAT' | 'TOO_LARGE';
  errorMessage?: string;
}

export interface ChartUploadSlot {
  timeframe: TimeframeSlot;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  previewUrl: string;
  confirmedTimeframe?: boolean;
  uploadedAt: string;
  validation: ImageFileValidation;
}

export interface GoldMarketData {
  symbol: 'XAUUSD';
  price: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: number | null;
  fetchedAt: string | null;
  source: string;
  isCached: boolean;
  isStale: boolean;
  status: ApiConnectionStatus;
  error: string | null;
  disclaimer: string;
}

export interface ApifySourceEntry {
  symbol: string;
  url: string;
}

export interface ApifyStatusPayload {
  actorId: string;
  configured: boolean;
  status: ApiConnectionStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  actorName: string | null;
  inputSchemaDetected: boolean;
  inputSchemaKeys: string[];
  xauusdSources: ApifySourceEntry[];
  supplementarySummary: string | null;
  lastRunItemsCount: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  headlineFa?: string;
  summary?: string;
  summaryFa?: string;
  source: string;
  publishedAt: string;
  category:
    | 'Fed / FOMC'
    | 'US Rates & Yields'
    | 'Inflation (CPI/PCE)'
    | 'Labor (NFP/Jobs)'
    | 'USD Index'
    | 'Geopolitics'
    | 'Central Banks';
  goldImpact: 'Bullish' | 'Bearish' | 'Mixed / Volatile' | 'Neutral';
  isDelayed: boolean;
  url?: string;
}

export interface NewsFeedState {
  providerConfigured: boolean;
  providerName: string | null;
  status: ApiConnectionStatus;
  lastFetchedAt: string | null;
  error: string | null;
  items: NewsItem[];
}

export interface TechnicalScores {
  priceAction: number | null;
  marketStructure: number | null;
  volume: number | null;
  candlestickConfirmation: number | null;
  multiTimeframeAlignment: number | null;
  fundamentalContext: number | null;
  overallScore: number;
  explanations: {
    priceAction: string;
    marketStructure: string;
    volume: string;
    candlestickConfirmation: string;
    multiTimeframeAlignment: string;
    fundamentalContext: string;
  };
}

export interface ChartInspectionResult {
  timeframeSlot: TimeframeSlot;
  isFinancialChart: boolean;
  detectedSymbol: string;
  isXauusdOrGold: boolean;
  detectedTimeframe: string;
  matchesSelectedSlot: boolean;
  isReadable: boolean;
  priceAxisVisible: boolean;
  timeAxisVisible: boolean;
  visibleIndicators: string[];
  appearsIncompleteOrStale: boolean;
  extractedCurrentPrice: number | null;
  notes: string;
}

export interface TradingPlan {
  direction: SignalDecision;
  entryZone: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskToRewardLabel: string;
  riskToRewardRatio: number | null;
  entryTimeframe: string;
  invalidationLevel: string;
  invalidationPrice: number | null;
  plannedVsCurrentNote: string;
  isEntryValidAtCurrentPrice: boolean;
}

export interface AnalysisReport {
  id: string;
  symbol: 'XAUUSD';
  language: Language;
  createdAt: string;
  analysisStatus: 'completed' | 'rejected' | 'failed';
  goldReferencePrice: number | null;
  goldDataFreshness: 'live' | 'cached' | 'unavailable';
  decision: SignalDecision;
  signalStatus: SignalStatus;
  marketDirection: string;
  chartInspections: ChartInspectionResult[];
  analysis1H: {
    mainTrend: string;
    marketStructure: string;
    importantLevels: string;
    technicalObservations: string;
  };
  analysis15M: {
    marketStructure: string;
    liquidity: string;
    bosChochMss: string;
    fvgOrderBlocks: string;
    importantLevels: string;
  };
  analysis5M: {
    entryConfirmation: string;
    candlestickConfirmation: string;
    entryZone: string;
    setupValidity: string;
  };
  tradingPlan: TradingPlan;
  technicalScores: TechnicalScores;
  fundamentalContext: {
    relevantEvents: string;
    newsImpact: string;
    usdContext: string;
    riskConditions: string;
    newsAvailable: boolean;
  };
  setupInvalidation: string;
  detailedExplanation: {
    decisionReason: string;
    supportingConfirmations: string;
    timeframeAlignment: string;
    invalidationConditions: string;
    priceProximityCheck: string;
  };
  apifyContextUsed: boolean;
  validationOverrides: string[];
}

export interface AnalysisStageEvent {
  type: 'stage' | 'complete' | 'error';
  stage?: number;
  totalStages?: number;
  stageKey?: string;
  message?: string;
  report?: AnalysisReport;
  error?: string;
  errorCode?: string;
}

export interface AppUser {
  id: string;
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  emailVerified?: boolean;
  tier: SubscriptionTier;
  createdAt: string;
  language: Language;
  authProvider: 'firebase';
}

export interface ApiHealthSummary {
  name: 'GoldAPI' | 'Apify' | 'Gemini' | 'NewsAPI';
  configured: boolean;
  maskedKey: string;
  status: ApiConnectionStatus;
  lastSuccessfulRequest: string | null;
  lastError: string | null;
}

export interface SystemConfig {
  freeDailyQuota: number;
  vipDailyQuota: number;
  goldCacheSeconds: number;
  supportedLanguages: Language[];
  vipOverrideEnabled: boolean;
  persistentBackendConfigured: boolean;
}

export interface AdminOverviewPayload {
  persistentAuthConfigured: boolean;
  stats: {
    totalRegisteredUsers: number | null;
    activeVipUsers: number | null;
    totalAnalyses: number;
    successfulAnalyses: number;
    failedAnalyses: number;
  };
  apis: ApiHealthSummary[];
  recentAnalyses: Array<{
    id: string;
    createdAt: string;
    decision: SignalDecision;
    status: 'completed' | 'rejected' | 'failed';
    error?: string;
    goldReferencePrice: number | null;
  }>;
  config: SystemConfig;
}
