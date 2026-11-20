import type { AnalysisReport } from '../types.ts';

export function formatReportAsText(report: AnalysisReport): string {
  const isFa = report.language === 'fa';
  const scoreVal = (v: number | null) => (v === null ? 'N/A' : `${v}/10`);
  const numVal = (v: number | null) => (v === null ? 'N/A' : v.toFixed(2));

  if (isFa) {
    return [
      `=== گزارش تحلیل Aurum AI (XAUUSD) ===`,
      `تصمیم نهایی: ${report.decision}`,
      `تاریخ تحلیل: ${new Date(report.createdAt).toLocaleString('fa-IR')}`,
      `قیمت مرجع GoldAPI: ${report.goldReferencePrice !== null ? `$${report.goldReferencePrice}` : 'در دسترس نیست'} (${report.goldDataFreshness})`,
      `جهت کلی بازار: ${report.marketDirection}`,
      ``,
      `--- تحلیل چندتایم‌فریمی ---`,
      `[1H] روند: ${report.analysis1H.mainTrend} | ساختار: ${report.analysis1H.marketStructure} | سطوح: ${report.analysis1H.importantLevels}`,
      `[15M] ساختار: ${report.analysis15M.marketStructure} | نقدینگی: ${report.analysis15M.liquidity} | BOS/CHoCH: ${report.analysis15M.bosChochMss} | FVG/OB: ${report.analysis15M.fvgOrderBlocks}`,
      `[5M] تاییدیه ورود: ${report.analysis5M.entryConfirmation} | کندل‌ها: ${report.analysis5M.candlestickConfirmation} | ناحیه ورود: ${report.analysis5M.entryZone}`,
      ``,
      `--- برنامه معاملاتی ---`,
      `نقطه ورود: ${report.tradingPlan.entryZone} (${numVal(report.tradingPlan.entryPrice)})`,
      `حد ضرر (SL): ${numVal(report.tradingPlan.stopLoss)}`,
      `حد سود ۱: ${numVal(report.tradingPlan.takeProfit1)}`,
      `حد سود ۲: ${numVal(report.tradingPlan.takeProfit2)}`,
      `حد سود ۳: ${numVal(report.tradingPlan.takeProfit3)}`,
      `ریسک به ریوارد: ${report.tradingPlan.riskToRewardLabel}`,
      `سطح ابطال ستاپ: ${report.setupInvalidation}`,
      ``,
      `--- امتیاز کیفیت تکنیکال (${report.technicalScores.overallScore}/10) ---`,
      `پرایس اکشن: ${scoreVal(report.technicalScores.priceAction)} | ساختار بازار: ${scoreVal(report.technicalScores.marketStructure)} | حجم: ${scoreVal(report.technicalScores.volume)} | کندل‌شناسی: ${scoreVal(report.technicalScores.candlestickConfirmation)} | هم‌راستایی تایم‌فریم‌ها: ${scoreVal(report.technicalScores.multiTimeframeAlignment)} | فاندامنتال: ${scoreVal(report.technicalScores.fundamentalContext)}`,
      ``,
      `--- جمع‌بندی و مدیریت ریسک ---`,
      report.detailedExplanation.decisionReason,
      report.detailedExplanation.priceProximityCheck,
    ].join('\n');
  }

  return [
    `=== AURUM AI XAUUSD ANALYSIS REPORT ===`,
    `FINAL DECISION: ${report.decision}`,
    `Timestamp: ${new Date(report.createdAt).toISOString()}`,
    `GoldAPI Reference Price: ${report.goldReferencePrice !== null ? `$${report.goldReferencePrice}` : 'UNAVAILABLE'} (${report.goldDataFreshness})`,
    `Market Direction: ${report.marketDirection}`,
    ``,
    `--- MULTI-TIMEFRAME ANALYSIS ---`,
    `[1H] Trend: ${report.analysis1H.mainTrend} | Structure: ${report.analysis1H.marketStructure} | Levels: ${report.analysis1H.importantLevels}`,
    `[15M] Structure: ${report.analysis15M.marketStructure} | Liquidity: ${report.analysis15M.liquidity} | BOS/CHoCH: ${report.analysis15M.bosChochMss} | FVG/OB: ${report.analysis15M.fvgOrderBlocks}`,
    `[5M] Entry Confirmation: ${report.analysis5M.entryConfirmation} | Candles: ${report.analysis5M.candlestickConfirmation} | Entry Zone: ${report.analysis5M.entryZone}`,
    ``,
    `--- TRADING PLAN ---`,
    `Entry: ${report.tradingPlan.entryZone} (${numVal(report.tradingPlan.entryPrice)})`,
    `Stop Loss: ${numVal(report.tradingPlan.stopLoss)}`,
    `TP1: ${numVal(report.tradingPlan.takeProfit1)} | TP2: ${numVal(report.tradingPlan.takeProfit2)} | TP3: ${numVal(report.tradingPlan.takeProfit3)}`,
    `Risk-to-Reward: ${report.tradingPlan.riskToRewardLabel}`,
    `Setup Invalidation: ${report.setupInvalidation}`,
    ``,
    `--- TECHNICAL QUALITY SCORE (${report.technicalScores.overallScore}/10) ---`,
    `Price Action: ${scoreVal(report.technicalScores.priceAction)} | Structure: ${scoreVal(report.technicalScores.marketStructure)} | Volume: ${scoreVal(report.technicalScores.volume)} | Candlestick: ${scoreVal(report.technicalScores.candlestickConfirmation)} | MTF Alignment: ${scoreVal(report.technicalScores.multiTimeframeAlignment)} | Fundamental: ${scoreVal(report.technicalScores.fundamentalContext)}`,
    ``,
    `--- EXPLANATION & RISK MANAGEMENT ---`,
    report.detailedExplanation.decisionReason,
    report.detailedExplanation.priceProximityCheck,
  ].join('\n');
}
