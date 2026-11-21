import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOverallTechnicalScore,
  classifyGeminiRetryAction,
  computeRiskToReward,
  computeTargetImageDimensions,
  estimateBase64DecodedBytes,
  evaluateSignalValidity,
  filterXauusdTradingViewUrls,
  formatClientNetworkError,
  formatGeminiErrorMessage,
  isApifyApiToken,
  isExplicitNonGoldSymbol,
  maskSecret,
  MAX_IMAGE_BYTES,
  mergeNewsTranslations,
  normalizeNewsTimestamp,
  parseApiKeyPool,
  parseGoogleNewsRss,
  parseNdjsonChunk,
  parsePercentChange,
  parseTradingViewPrice,
  parseTradingViewScannerGold,
  resolveApifyToken,
  resolveFirebaseAuthDomain,
  sanitizeNewsSummary,
  validateImageFileMeta,
} from './tradingRules.ts';

test('validateImageFileMeta validates supported types and 10MB limit', () => {
  assert.equal(
    validateImageFileMeta({ mimeType: 'image/png', sizeBytes: 1024 }).valid,
    true
  );
  assert.equal(
    validateImageFileMeta({ mimeType: 'image/webp', sizeBytes: MAX_IMAGE_BYTES }).valid,
    true
  );
  const invalidMime = validateImageFileMeta({ mimeType: 'application/pdf', sizeBytes: 1024 });
  assert.equal(invalidMime.valid, false);
  assert.equal(invalidMime.errorCode, 'INVALID_FORMAT');

  const tooBig = validateImageFileMeta({
    mimeType: 'image/jpeg',
    sizeBytes: MAX_IMAGE_BYTES + 1,
  });
  assert.equal(tooBig.valid, false);
  assert.equal(tooBig.errorCode, 'TOO_LARGE');
});

test('calculateOverallTechnicalScore excludes N/A (null) categories without treating as zero', () => {
  const score = calculateOverallTechnicalScore({
    priceAction: 8,
    marketStructure: 9,
    volume: null, // N/A
    candlestickConfirmation: 7,
    multiTimeframeAlignment: 8,
    fundamentalContext: null, // N/A
  });
  assert.equal(score, 8);
});

test('computeRiskToReward validates direction and calculates ratio', () => {
  const buy = computeRiskToReward({
    decision: 'BUY',
    entry: 2650,
    stopLoss: 2640,
    tp1: 2670,
  });
  assert.equal(buy.directionalValid, true);
  assert.equal(buy.ratio, 2);

  const invertedBuy = computeRiskToReward({
    decision: 'BUY',
    entry: 2650,
    stopLoss: 2660,
    tp1: 2670,
  });
  assert.equal(invertedBuy.directionalValid, false);

  const sell = computeRiskToReward({
    decision: 'SELL',
    entry: 2650,
    stopLoss: 2660,
    tp1: 2635,
  });
  assert.equal(sell.directionalValid, true);
  assert.equal(sell.ratio, 1.5);
});

test('evaluateSignalValidity rejects RR below 1.5 and stale/passed entries', () => {
  const lowRr = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 2650,
    stopLoss: 2640,
    tp1: 2660, // 1:1 RR < 1.5
    tp2: 2670,
    tp3: 2680,
    referencePrice: 2651,
    chartPrice: 2650,
  });
  assert.equal(lowRr.finalDecision, 'NO TRADE');
  assert.ok(lowRr.overrideReasons.some((r) => r.includes('1:1.5')));

  const passedEntry = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 2650,
    stopLoss: 2640,
    tp1: 2670,
    tp2: 2680,
    tp3: 2690,
    referencePrice: 2672, // already above TP1
    chartPrice: 2650,
  });
  assert.equal(passedEntry.finalDecision, 'NO TRADE');
  assert.equal(passedEntry.isEntryValidAtCurrentPrice, false);

  const validBuy = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 2650,
    stopLoss: 2640,
    tp1: 2668,
    tp2: 2680,
    tp3: 2695,
    referencePrice: 2651,
    chartPrice: 2650,
  });
  assert.equal(validBuy.finalDecision, 'BUY');
  assert.equal(validBuy.rrRatio, 1.8);
  assert.equal(validBuy.isEntryValidAtCurrentPrice, true);

  // Pullback limit entry 1.1% away from live GoldAPI should remain valid
  const pullbackBuy = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 3820,
    stopLoss: 3805,
    tp1: 3845,
    tp2: 3860,
    tp3: 3880,
    referencePrice: 3862,
    chartPrice: 3860,
  });
  assert.equal(pullbackBuy.finalDecision, 'BUY');
  assert.equal(pullbackBuy.isEntryValidAtCurrentPrice, true);

  // Historical / replay / futures / prior-session chart (>1% regime gap) should preserve valid BUY without overriding to NO TRADE
  const sessionGapBuy = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 3859,
    stopLoss: 3845,
    tp1: 3880,
    tp2: 3895,
    tp3: 3910,
    referencePrice: 3770.53,
    chartPrice: 3864.5,
  });
  assert.equal(sessionGapBuy.finalDecision, 'BUY');
  assert.equal(sessionGapBuy.isEntryValidAtCurrentPrice, false);

  const historicalBuy = evaluateSignalValidity({
    decision: 'BUY',
    entryPrice: 2650,
    stopLoss: 2640,
    tp1: 2670,
    tp2: 2685,
    tp3: 2700,
    referencePrice: 3862,
    chartPrice: 2652,
  });
  assert.equal(historicalBuy.finalDecision, 'BUY');
  assert.equal(historicalBuy.isEntryValidAtCurrentPrice, false);
});

test('isExplicitNonGoldSymbol rejects explicit non-gold tickers and allows unknown/cropped gold charts', () => {
  assert.equal(isExplicitNonGoldSymbol('BTCUSD'), true);
  assert.equal(isExplicitNonGoldSymbol('FX:EURUSD'), true);
  assert.equal(isExplicitNonGoldSymbol('XAUUSD'), false);
  assert.equal(isExplicitNonGoldSymbol('TVC:GOLD'), false);
  assert.equal(isExplicitNonGoldSymbol('Unknown'), false);
  assert.equal(isExplicitNonGoldSymbol(''), false);
});

test('filterXauusdTradingViewUrls keeps only XAUUSD/GOLD URLs and ignores BTCUSD', () => {
  const mixed = {
    urls: [
      'https://www.tradingview.com/chart/?symbol=TVC%3AGOLD',
      'https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD',
      'https://www.tradingview.com/chart/?symbol=BITSTAMP%3ABTCUSD',
      'https://www.tradingview.com/chart/?symbol=COINBASE%3ABTCUSD',
    ],
  };
  const filtered = filterXauusdTradingViewUrls(mixed);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].symbol, 'TVC:GOLD');
  assert.equal(filtered[1].symbol, 'OANDA:XAUUSD');
});

test('maskSecret never reveals raw key', () => {
  assert.equal(maskSecret(undefined), 'Not configured');
  assert.equal(maskSecret('super_secret_token_9876'), '••••••••9876');
});

test('normalizeNewsTimestamp parses NewsData UTC dates and ISO timestamps', () => {
  assert.equal(
    normalizeNewsTimestamp('2026-11-13 00:08:58', 'UTC'),
    '2026-11-13T00:08:58.000Z'
  );
  assert.equal(
    normalizeNewsTimestamp('2026-11-13T10:30:00Z'),
    '2026-11-13T10:30:00.000Z'
  );
});

test('sanitizeNewsSummary strips HTML, filters paywall text, and truncates cleanly', () => {
  assert.equal(sanitizeNewsSummary('ONLY AVAILABLE IN PAID PLANS'), undefined);
  assert.equal(sanitizeNewsSummary('<p>Gold <b>rose</b> on CPI data.</p>'), 'Gold rose on CPI data.');
  const longText = 'Word '.repeat(70).trim();
  const truncated = sanitizeNewsSummary(longText, 60);
  assert.ok(truncated && truncated.length <= 62 && truncated.endsWith('…'));
});

test('mergeNewsTranslations applies Persian translations by id without losing existing fields', () => {
  const sampleItems: Array<{
    id: string;
    headline: string;
    headlineFa?: string;
    summaryFa?: string;
  }> = [
    { id: '1', headline: 'Gold drops ahead of Fed' },
    { id: '2', headline: 'US CPI rises' },
  ];
  const merged = mergeNewsTranslations(sampleItems, [
    { id: '1', headlineFa: 'افت طلا پیش از نشست فدرال رزرو', summaryFa: 'خلاصه خبر' },
  ]);
  assert.equal(merged[0].headlineFa, 'افت طلا پیش از نشست فدرال رزرو');
  assert.equal(merged[0].summaryFa, 'خلاصه خبر');
  assert.equal(merged[1].headlineFa, undefined);
});

test('computeTargetImageDimensions preserves aspect ratio and caps longest edge', () => {
  const unchanged = computeTargetImageDimensions(1280, 720, 1920);
  assert.deepEqual(unchanged, { width: 1280, height: 720, resized: false });

  const scaled4k = computeTargetImageDimensions(3840, 2160, 1920);
  assert.deepEqual(scaled4k, { width: 1920, height: 1080, resized: true });

  const portrait = computeTargetImageDimensions(1200, 3000, 1920);
  assert.deepEqual(portrait, { width: 768, height: 1920, resized: true });
});

test('estimateBase64DecodedBytes calculates byte length from data URLs', () => {
  // "hello" -> aGVsbG8= (8 chars, 1 pad => 5 bytes)
  assert.equal(estimateBase64DecodedBytes('data:image/png;base64,aGVsbG8='), 5);
  // "hell" -> aGVsbA== (8 chars, 2 pad => 4 bytes)
  assert.equal(estimateBase64DecodedBytes('aGVsbA=='), 4);
  assert.equal(estimateBase64DecodedBytes(''), 0);
});

test('parseNdjsonChunk skips keepalive blank lines and flushes trailing buffer', () => {
  const step1 = parseNdjsonChunk('', '{"type":"stage","stage":1}\n\n{"type":"com');
  assert.equal(step1.events.length, 1);
  assert.equal(step1.events[0].stage, 1);
  assert.equal(step1.remainingBuffer, '{"type":"com');

  const step2 = parseNdjsonChunk(step1.remainingBuffer, 'plete","ok":true}', true);
  assert.equal(step2.events.length, 1);
  assert.equal(step2.events[0].type, 'complete');
  assert.equal(step2.events[0].ok, true);
  assert.equal(step2.remainingBuffer, '');
});

test('formatClientNetworkError translates Failed to fetch into actionable guidance', () => {
  const faMsg = formatClientNetworkError(new TypeError('Failed to fetch'), 'fa', {
    payloadBytes: 2 * 1024 * 1024,
  });
  assert.ok(!faMsg.includes('Failed to fetch'));
  assert.ok(faMsg.includes('2.00 MB'));

  const serverMsg = formatClientNetworkError(new Error('Daily quota reached'), 'en');
  assert.equal(serverMsg, 'Daily quota reached');
});

test('formatGeminiErrorMessage maps 503/429/403 cleanly', () => {
  const busyFa = formatGeminiErrorMessage('{"error":{"code":503,"status":"UNAVAILABLE"}}', 'fa');
  assert.ok(busyFa.includes('۵۰۳'));

  const authEn = formatGeminiErrorMessage('403 PERMISSION_DENIED', 'en');
  assert.ok(authEn.includes('GEMINI_API_KEY'));
});

test('parseApiKeyPool deduplicates pool keys, strips quotes/placeholders, and keeps pool priority', () => {
  const keys = parseApiKeyPool('AQ.Primary', '"AQ.Key1", AIzaKey2 ; AQ.Key1\nMY_GEMINI_API_KEY');
  assert.deepEqual(keys, ['AQ.Key1', 'AIzaKey2', 'AQ.Primary']);
  assert.deepEqual(
    parseApiKeyPool('AQ.K1 ، AQ.K2, AQ.K3', ''),
    ['AQ.K1', 'AQ.K2', 'AQ.K3']
  );
  assert.deepEqual(parseApiKeyPool('MY_GEMINI_API_KEY', ''), []);
});

test('classifyGeminiRetryAction classifies 429, 403, 503, timeouts, and 400 properly', () => {
  assert.equal(classifyGeminiRetryAction('429 RESOURCE_EXHAUSTED quota exceeded'), 'rotate_cooldown');
  assert.equal(classifyGeminiRetryAction('403 API_KEY_INVALID'), 'rotate_auth');
  assert.equal(classifyGeminiRetryAction('API key expired'), 'rotate_auth');
  assert.equal(classifyGeminiRetryAction('503 UNAVAILABLE high demand'), 'retry_transient');
  assert.equal(classifyGeminiRetryAction('This operation was aborted'), 'retry_transient');
  assert.equal(classifyGeminiRetryAction('Request timed out after 25000ms'), 'retry_transient');
  assert.equal(classifyGeminiRetryAction('400 Invalid JSON schema'), 'fatal');
});

test('isApifyApiToken and resolveApifyToken detect apify_api_* tokens cleanly', () => {
  assert.equal(isApifyApiToken('apify_api_abc123'), true);
  assert.equal(isApifyApiToken('goldapi-123-io'), false);
  assert.equal(resolveApifyToken('apify_direct', 'apify_api_gold'), 'apify_direct');
  assert.equal(resolveApifyToken('', 'apify_api_gold'), 'apify_api_gold');
  assert.equal(resolveApifyToken('MY_APIFY_API_TOKEN', 'apify_api_gold'), 'apify_api_gold');
  assert.equal(resolveApifyToken('', 'goldapi-123-io'), '');
});

test('parseTradingViewPrice and parsePercentChange handle abbreviated TradingView strings', () => {
  assert.equal(parseTradingViewPrice('3.59K USD'), 3590);
  assert.equal(parseTradingViewPrice('3,582.97 USD'), 3582.97);
  assert.equal(parseTradingViewPrice(3612.456), 3612.46);
  assert.equal(parseTradingViewPrice('N/A'), null);
  assert.equal(parsePercentChange('-0.87%'), -0.87);
  assert.equal(parsePercentChange('+1.25%'), 1.25);
  assert.equal(parsePercentChange(null), null);
});

test('parseTradingViewScannerGold parses OANDA:XAUUSD / TVC:GOLD OHLC and prevClose cleanly', () => {
  const quote = parseTradingViewScannerGold({
    totalCount: 2,
    data: [
      { s: 'TVC:GOLD', d: [3585.72, 3625.45, 3636.726, 3514.648, -1.1116, -40.308] },
      { s: 'OANDA:XAUUSD', d: [3584.925, 3632.5, 3636.925, 3514.56, -1.0954, -39.705] },
    ],
  });
  assert.deepEqual(quote, {
    price: 3584.93,
    open: 3632.5,
    high: 3636.93,
    low: 3514.56,
    prevClose: 3624.63,
    change: -39.7,
    changePercent: -1.1,
  });
  assert.equal(parseTradingViewScannerGold({ data: [] }), null);
});

test('parseGoogleNewsRss parses RSS items, XML entities, and publisher cleanly', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <item>
      <title>Gold &amp; Dollar rally ahead of FOMC - Reuters</title>
      <link>https://news.google.com/rss/articles/abc</link>
      <guid>guid-1</guid>
      <pubDate>Fri, 20 Nov 2026 08:35:48 GMT</pubDate>
      <source url="https://www.reuters.com">Reuters</source>
    </item>
  </channel></rss>`;
  const items = parseGoogleNewsRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'guid-1');
  assert.equal(items[0].headline, 'Gold & Dollar rally ahead of FOMC');
  assert.equal(items[0].source, 'Reuters');
  assert.equal(items[0].url, 'https://news.google.com/rss/articles/abc');
  assert.equal(items[0].publishedAt, '2026-11-20T08:35:48.000Z');
});

test('resolveFirebaseAuthDomain preserves configured Firebase authDomain across AI Studio, localhost, and custom domains', () => {
  assert.equal(
    resolveFirebaseAuthDomain({
      hostname: 'aurumgold.ir',
      configuredAuthDomain: 'totemic-booking-rvc14.firebaseapp.com',
    }),
    'totemic-booking-rvc14.firebaseapp.com'
  );
  assert.equal(
    resolveFirebaseAuthDomain({
      hostname: 'ais-dev-xyz.europe-west2.run.app',
      configuredAuthDomain: 'totemic-booking-rvc14.firebaseapp.com',
    }),
    'totemic-booking-rvc14.firebaseapp.com'
  );
  assert.equal(
    resolveFirebaseAuthDomain({
      hostname: 'localhost',
      configuredAuthDomain: 'totemic-booking-rvc14.firebaseapp.com',
    }),
    'totemic-booking-rvc14.firebaseapp.com'
  );
  assert.equal(
    resolveFirebaseAuthDomain({
      hostname: 'aurumgold.ir',
      configuredAuthDomain: 'totemic-booking-rvc14.firebaseapp.com',
      envAuthDomain: 'https://custom.aurum.app/',
    }),
    'custom.aurum.app'
  );
});


