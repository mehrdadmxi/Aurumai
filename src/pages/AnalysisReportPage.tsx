import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Crosshair,
  FileDown,
  Flag,
  Mail,
  PlusCircle,
  Scale,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import type { AnalysisReport, Language } from '../types.ts';
import { getT } from '../i18n/translations.ts';
import { formatReportAsText } from '../lib/reportFormatter.ts';

interface AnalysisReportPageProps {
  language: Language;
  report: AnalysisReport | null;
  onNewAnalysis: () => void;
  onSendViaGmail?: (report: AnalysisReport) => void;
}

export function AnalysisReportPage({
  language,
  report,
  onNewAnalysis,
  onSendViaGmail,
}: AnalysisReportPageProps) {
  const t = getT(language).report;
  const [copied, setCopied] = useState(false);

  if (!report) {
    return (
      <div className="aurum-glass rounded-xl p-10 text-center space-y-4">
        <h1 className="text-xl font-bold text-[#F5F2EB]">{t.noReportTitle}</h1>
        <p className="text-sm text-[#9A9891] max-w-md mx-auto">{t.noReportSub}</p>
        <button
          type="button"
          onClick={onNewAnalysis}
          className="aurum-gold-btn px-5 py-2.5 rounded-xl text-sm font-semibold"
        >
          {t.newAnalysisBtn}
        </button>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatReportAsText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handlePdfPrint = () => {
    window.print();
  };

  const decisionDisplay = () => {
    if (report.decision === 'BUY') {
      return {
        label: t.buyLabel,
        classes: 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300',
        icon: <TrendingUp className="w-5 h-5" />,
      };
    }
    if (report.decision === 'SELL') {
      return {
        label: t.sellLabel,
        classes: 'bg-rose-950/50 border-rose-500/50 text-rose-300',
        icon: <TrendingDown className="w-5 h-5" />,
      };
    }
    return {
      label: t.noTradeLabel,
      classes: 'bg-amber-950/50 border-amber-500/50 text-amber-300',
      icon: <AlertTriangle className="w-5 h-5" />,
    };
  };

  const badge = decisionDisplay();
  const fmtNum = (val: number | null) =>
    val === null || !Number.isFinite(val) ? 'N/A' : `$${val.toFixed(2)}`;
  const fmtScore = (val: number | null) => (val === null ? 'N/A' : `${val}/10`);

  const { tradingPlan } = report;
  const entryVal =
    tradingPlan.entryPrice !== null && Number.isFinite(tradingPlan.entryPrice)
      ? tradingPlan.entryPrice
      : null;
  const slVal =
    tradingPlan.stopLoss !== null && Number.isFinite(tradingPlan.stopLoss)
      ? tradingPlan.stopLoss
      : null;
  const riskUsd = entryVal !== null && slVal !== null ? Math.abs(entryVal - slVal) : null;
  const riskPct = riskUsd !== null && entryVal !== null && entryVal > 0 ? (riskUsd / entryVal) * 100 : null;

  const computeTpMeta = (tp: number | null) => {
    if (tp === null || !Number.isFinite(tp) || entryVal === null) {
      return { diff: null, pct: null, rMultiple: null };
    }
    const diff = Math.abs(tp - entryVal);
    const pct = entryVal > 0 ? (diff / entryVal) * 100 : null;
    const rMultiple = riskUsd !== null && riskUsd > 0 ? diff / riskUsd : null;
    return { diff, pct, rMultiple };
  };

  const rrRatio =
    tradingPlan.riskToRewardRatio !== null &&
    Number.isFinite(tradingPlan.riskToRewardRatio) &&
    tradingPlan.riskToRewardRatio > 0
      ? tradingPlan.riskToRewardRatio
      : null;
  const riskSharePct = rrRatio !== null ? Math.max(12, Math.min(50, (1 / (1 + rrRatio)) * 100)) : 50;
  const rewardSharePct = rrRatio !== null ? 100 - riskSharePct : 50;

  const tpCards = [
    {
      key: 'tp1',
      step: '07',
      title: t.cards.tp1,
      value: tradingPlan.takeProfit1,
      meta: computeTpMeta(tradingPlan.takeProfit1),
      Icon: Target,
      topBar: 'from-emerald-500/70 via-emerald-400/40 to-transparent',
      borderClass: 'border-emerald-500/20 hover:border-emerald-400/40',
      iconFrameClass: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
      valueClass: 'text-emerald-400',
    },
    {
      key: 'tp2',
      step: '08',
      title: t.cards.tp2,
      value: tradingPlan.takeProfit2,
      meta: computeTpMeta(tradingPlan.takeProfit2),
      Icon: Flag,
      topBar: 'from-emerald-400/85 via-emerald-300/50 to-transparent',
      borderClass: 'border-emerald-500/25 hover:border-emerald-400/45',
      iconFrameClass: 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300',
      valueClass: 'text-emerald-300',
    },
    {
      key: 'tp3',
      step: '09',
      title: t.cards.tp3,
      value: tradingPlan.takeProfit3,
      meta: computeTpMeta(tradingPlan.takeProfit3),
      Icon: Trophy,
      topBar: 'from-emerald-400 via-[#D4AF37]/80 to-transparent',
      borderClass: 'border-emerald-400/30 hover:border-[#D4AF37]/50',
      iconFrameClass: 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300',
      valueClass: 'text-emerald-300',
    },
  ];

  const isCompactNumericZone =
    Boolean(tradingPlan.entryZone) &&
    tradingPlan.entryZone.length <= 24 &&
    /^[\d.,\s$–-]+$/.test(tradingPlan.entryZone.trim());

  return (
    <div className="space-y-6 print-report-surface">
      {/* Top Action Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? t.copiedBtn : t.copyBtn}</span>
          </button>
          <button
            type="button"
            onClick={handlePdfPrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{t.pdfBtn}</span>
          </button>
          {onSendViaGmail && (
            <button
              type="button"
              onClick={() => onSendViaGmail(report)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{t.sendGmailBtn}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onNewAnalysis}
            className="aurum-gold-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{t.newAnalysisBtn}</span>
          </button>
        </div>
      </div>

      {/* Top Report Header Banner */}
      <section className="aurum-glass-strong rounded-xl p-6 flex flex-wrap items-center justify-between gap-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-5 flex-1">
          <div>
            <div className="text-xs text-[#9A9891]">{t.symbol}</div>
            <div className="text-lg font-bold font-mono-num text-[#F3E5AB] mt-1">{report.symbol}</div>
          </div>
          <div>
            <div className="text-xs text-[#9A9891]">{t.dateTime}</div>
            <div className="text-xs font-mono-num text-[#F5F2EB] mt-1.5">
              {new Date(report.createdAt).toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#9A9891]">{t.status}</div>
            <div className="text-xs font-semibold uppercase text-[#F5F2EB] mt-1.5">
              {report.analysisStatus}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#9A9891]">{t.refPrice}</div>
            <div className="text-sm font-bold font-mono-num text-[#F5F2EB] mt-1">
              {fmtNum(report.goldReferencePrice)}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#9A9891]">{t.freshness}</div>
            <div className="text-xs font-semibold uppercase text-[#F3E5AB] mt-1.5">
              {report.goldDataFreshness}
            </div>
          </div>
        </div>

        <div className={`px-6 py-3.5 rounded-xl border flex items-center gap-3 font-bold text-lg ${badge.classes}`}>
          {badge.icon}
          <span>{badge.label}</span>
        </div>
      </section>

      {/* 13 Structured Result Cards */}
      {/* Cards 1-4: Market Direction & Timeframes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.marketDirection}</h2>
          <p className="text-sm text-[#F5F2EB] leading-relaxed">{report.marketDirection}</p>
        </article>

        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.analysis1H}</h2>
          <div className="text-xs text-[#9A9891] space-y-1.5 leading-relaxed">
            <p><strong className="text-[#F5F2EB]">Trend:</strong> {report.analysis1H.mainTrend}</p>
            <p><strong className="text-[#F5F2EB]">Structure:</strong> {report.analysis1H.marketStructure}</p>
            <p><strong className="text-[#F5F2EB]">Levels:</strong> {report.analysis1H.importantLevels}</p>
            <p>{report.analysis1H.technicalObservations}</p>
          </div>
        </article>

        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.analysis15M}</h2>
          <div className="text-xs text-[#9A9891] space-y-1.5 leading-relaxed">
            <p><strong className="text-[#F5F2EB]">Structure:</strong> {report.analysis15M.marketStructure}</p>
            <p><strong className="text-[#F5F2EB]">Liquidity:</strong> {report.analysis15M.liquidity}</p>
            <p><strong className="text-[#F5F2EB]">BOS/CHoCH/MSS:</strong> {report.analysis15M.bosChochMss}</p>
            <p><strong className="text-[#F5F2EB]">FVG / OB:</strong> {report.analysis15M.fvgOrderBlocks}</p>
          </div>
        </article>

        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.analysis5M}</h2>
          <div className="text-xs text-[#9A9891] space-y-1.5 leading-relaxed">
            <p><strong className="text-[#F5F2EB]">Entry Trigger:</strong> {report.analysis5M.entryConfirmation}</p>
            <p><strong className="text-[#F5F2EB]">Candles:</strong> {report.analysis5M.candlestickConfirmation}</p>
            <p><strong className="text-[#F5F2EB]">Zone:</strong> {report.analysis5M.entryZone}</p>
            <p><strong className="text-[#F5F2EB]">Validity:</strong> {report.analysis5M.setupValidity}</p>
          </div>
        </article>
      </div>

      {/* Cards 5-10: Professional Trading Plan Execution Grid */}
      <section aria-label={t.tradingPlan.sectionTitle} className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#F3E5AB]">{t.tradingPlan.sectionTitle}</h2>
            {tradingPlan.plannedVsCurrentNote && (
              <p className="text-xs text-[#9A9891] max-w-3xl leading-relaxed">
                {tradingPlan.plannedVsCurrentNote}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#9A9891] shrink-0">{t.tradingPlan.entryTimeframeLabel}:</span>
            <strong className="font-mono-num text-[#F3E5AB]">{tradingPlan.entryTimeframe}</strong>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Card 5: Entry */}
          <article className="aurum-glass-strong rounded-xl overflow-hidden border border-[#D4AF37]/30 hover:border-[#D4AF37]/55 transition-colors flex flex-col justify-between">
            <div className="h-[2px] w-full bg-gradient-to-r from-[#D4AF37] via-[#F3E5AB] to-[#D4AF37]/20" />
            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="block text-[11px] font-mono-num text-[#D4AF37]/80">05</span>
                  <h3 className="text-sm font-semibold text-[#F5F2EB]">{t.cards.entry}</h3>
                </div>
                <div className="w-9 h-9 rounded-lg bg-[#D4AF37]/12 border border-[#D4AF37]/30 flex items-center justify-center text-[#F3E5AB] shrink-0">
                  <Crosshair className="w-4 h-4" />
                </div>
              </div>

              <div
                dir="ltr"
                className="text-2xl sm:text-[26px] font-bold font-mono-num tracking-tight text-[#F3E5AB]"
              >
                {entryVal !== null
                  ? fmtNum(entryVal)
                  : isCompactNumericZone
                    ? tradingPlan.entryZone
                    : 'N/A'}
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 text-xs text-[#9A9891]">
                {entryVal !== null && tradingPlan.entryZone && tradingPlan.entryZone !== 'N/A' ? (
                  <>
                    <span className="shrink-0">{t.tradingPlan.entryZoneLabel}</span>
                    <span dir="ltr" className="font-mono-num font-medium text-[#F3E5AB] truncate">
                      {tradingPlan.entryZone}
                    </span>
                  </>
                ) : !isCompactNumericZone && tradingPlan.entryZone ? (
                  <span className="truncate">{tradingPlan.entryZone}</span>
                ) : (
                  <>
                    <span className="shrink-0">{t.tradingPlan.entryTimeframeLabel}</span>
                    <span className="font-mono-num font-semibold text-[#F3E5AB] truncate">
                      {tradingPlan.entryTimeframe}
                    </span>
                  </>
                )}
              </div>
            </div>
          </article>

          {/* Card 6: Stop Loss */}
          <article className="aurum-glass rounded-xl overflow-hidden border border-rose-500/25 hover:border-rose-400/45 transition-colors flex flex-col justify-between">
            <div className="h-[2px] w-full bg-gradient-to-r from-rose-500/85 via-rose-400/45 to-transparent" />
            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="block text-[11px] font-mono-num text-rose-400/80">06</span>
                  <h3 className="text-sm font-semibold text-[#F5F2EB]">{t.cards.stopLoss}</h3>
                </div>
                <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
              </div>

              <div
                dir="ltr"
                className="text-2xl sm:text-[26px] font-bold font-mono-num tracking-tight text-rose-400"
              >
                {fmtNum(slVal)}
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                {riskUsd !== null && riskPct !== null ? (
                  <>
                    <span className="text-[#9A9891] shrink-0">{t.tradingPlan.riskDistance}</span>
                    <span dir="ltr" className="font-mono-num font-medium text-rose-300">
                      -${riskUsd.toFixed(2)} (-{riskPct.toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-[#9A9891] truncate">
                    {tradingPlan.invalidationLevel && tradingPlan.invalidationLevel !== 'N/A'
                      ? `${t.tradingPlan.invalidationLabel}: ${tradingPlan.invalidationLevel}`
                      : t.tradingPlan.noActiveSetup}
                  </span>
                )}
              </div>
            </div>
          </article>

          {/* Cards 7-9: TP1, TP2, TP3 */}
          {tpCards.map(({ key, step, title, value, meta, Icon, topBar, borderClass, iconFrameClass, valueClass }) => (
            <article
              key={key}
              className={`aurum-glass rounded-xl overflow-hidden border transition-colors flex flex-col justify-between ${borderClass}`}
            >
              <div className={`h-[2px] w-full bg-gradient-to-r ${topBar}`} />
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <span className="block text-[11px] font-mono-num text-emerald-400/80">{step}</span>
                    <h3 className="text-sm font-semibold text-[#F5F2EB]">{title}</h3>
                  </div>
                  <div
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${iconFrameClass}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <div
                  dir="ltr"
                  className={`text-2xl sm:text-[26px] font-bold font-mono-num tracking-tight ${valueClass}`}
                >
                  {fmtNum(value)}
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                  {meta.diff !== null && meta.pct !== null ? (
                    <>
                      <span dir="ltr" className="font-mono-num font-medium text-emerald-300">
                        +${meta.diff.toFixed(2)} (+{meta.pct.toFixed(2)}%)
                      </span>
                      <span dir="ltr" className="font-mono-num font-semibold text-[#F3E5AB]">
                        {meta.rMultiple !== null ? `${meta.rMultiple.toFixed(2)}R` : t.tradingPlan.rewardDistance}
                      </span>
                    </>
                  ) : (
                    <span className="text-[#9A9891]">{t.tradingPlan.noActiveSetup}</span>
                  )}
                </div>
              </div>
            </article>
          ))}

          {/* Card 10: Risk-to-Reward */}
          <article className="aurum-glass-strong rounded-xl overflow-hidden border border-[#D4AF37]/30 hover:border-[#D4AF37]/55 transition-colors flex flex-col justify-between">
            <div className="h-[2px] w-full bg-gradient-to-r from-rose-400/80 via-[#D4AF37] to-emerald-400" />
            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="block text-[11px] font-mono-num text-[#D4AF37]/80">10</span>
                  <h3 className="text-sm font-semibold text-[#F5F2EB]">{t.cards.rr}</h3>
                </div>
                <div className="w-9 h-9 rounded-lg bg-[#D4AF37]/12 border border-[#D4AF37]/30 flex items-center justify-center text-[#F3E5AB] shrink-0">
                  <Scale className="w-4 h-4" />
                </div>
              </div>

              <div className="space-y-2.5">
                <div
                  dir="ltr"
                  className="text-2xl sm:text-[26px] font-bold font-mono-num tracking-tight text-[#F5F2EB]"
                >
                  {tradingPlan.riskToRewardLabel}
                </div>

                {/* Risk vs Reward Visual Ratio Track */}
                <div className="space-y-1">
                  <div
                    dir="ltr"
                    className="h-1.5 w-full rounded-full overflow-hidden bg-white/10 flex"
                    aria-hidden="true"
                  >
                    {rrRatio !== null ? (
                      <>
                        <div
                          className="h-full bg-rose-400/85"
                          style={{ width: `${riskSharePct.toFixed(1)}%` }}
                        />
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${rewardSharePct.toFixed(1)}%` }}
                        />
                      </>
                    ) : (
                      <div className="h-full w-full bg-white/10" />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#9A9891]">
                    <span>{t.tradingPlan.riskLabel} (1R)</span>
                    <span>
                      {t.tradingPlan.rewardLabel} (
                      <span dir="ltr" className="font-mono-num">
                        {rrRatio !== null ? `${rrRatio.toFixed(2)}R` : '—'}
                      </span>
                      )
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                <span className={rrRatio !== null && rrRatio >= 1.5 ? 'text-emerald-300 font-medium' : 'text-[#9A9891]'}>
                  {rrRatio !== null && rrRatio >= 1.5 ? t.tradingPlan.rrRulePass : t.tradingPlan.rrRuleNa}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* Cards 11-13: Technical Score, Fundamental Context, Setup Invalidation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <article className="aurum-glass rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.score}</h2>
            <span className="text-xl font-bold font-mono-num text-[#D4AF37]">
              {report.technicalScores.overallScore} / 10
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-[#9A9891]">Price Action</span>
              <span className="font-mono-num">{fmtScore(report.technicalScores.priceAction)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9A9891]">Market Structure</span>
              <span className="font-mono-num">{fmtScore(report.technicalScores.marketStructure)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9A9891]">Volume</span>
              <span className="font-mono-num">{fmtScore(report.technicalScores.volume)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9A9891]">Candlestick</span>
              <span className="font-mono-num">
                {fmtScore(report.technicalScores.candlestickConfirmation)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9A9891]">MTF Alignment</span>
              <span className="font-mono-num">
                {fmtScore(report.technicalScores.multiTimeframeAlignment)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9A9891]">Fundamental</span>
              <span className="font-mono-num">
                {fmtScore(report.technicalScores.fundamentalContext)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-[#9A9891] pt-2 border-t border-white/10">
            {t.scoreDisclaimer}
          </p>
        </article>

        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.fundamental}</h2>
          <div className="text-xs text-[#9A9891] space-y-1.5 leading-relaxed">
            <p><strong className="text-[#F5F2EB]">Events:</strong> {report.fundamentalContext.relevantEvents}</p>
            <p><strong className="text-[#F5F2EB]">Impact:</strong> {report.fundamentalContext.newsImpact}</p>
            <p><strong className="text-[#F5F2EB]">USD Context:</strong> {report.fundamentalContext.usdContext}</p>
            <p><strong className="text-[#F5F2EB]">Risk:</strong> {report.fundamentalContext.riskConditions}</p>
          </div>
        </article>

        <article className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.cards.invalidation}</h2>
          <p className="text-xs text-[#F5F2EB] leading-relaxed">{report.setupInvalidation}</p>
          {report.tradingPlan.invalidationLevel && (
            <p className="text-xs font-mono-num text-rose-300 pt-2">
              {report.tradingPlan.invalidationLevel}
            </p>
          )}
        </article>
      </div>

      {/* Detailed Explanation Section */}
      <section className="aurum-glass rounded-xl p-6 space-y-4">
        <h2 className="text-base font-bold text-[#F3E5AB]">{t.explanationTitle}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs leading-relaxed">
          <div className="space-y-1">
            <h3 className="font-semibold text-[#F5F2EB]">{t.qReason}</h3>
            <p className="text-[#9A9891] whitespace-pre-line">{report.detailedExplanation.decisionReason}</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-[#F5F2EB]">{t.qConfirmations}</h3>
            <p className="text-[#9A9891]">{report.detailedExplanation.supportingConfirmations}</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-[#F5F2EB]">{t.qAlignment}</h3>
            <p className="text-[#9A9891]">{report.detailedExplanation.timeframeAlignment}</p>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-[#F5F2EB]">{t.qInvalidation}</h3>
            <p className="text-[#9A9891]">{report.detailedExplanation.invalidationConditions}</p>
          </div>
          <div className="md:col-span-2 space-y-1 pt-2 border-t border-white/10">
            <h3 className="font-semibold text-[#F5F2EB]">{t.qProximity}</h3>
            <p className="text-[#9A9891]">{report.detailedExplanation.priceProximityCheck}</p>
          </div>
        </div>
      </section>

      {/* Automated Chart Pre-Inspection Table */}
      {report.chartInspections.length > 0 && (
        <section className="aurum-glass rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.inspectionTitle}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[#9A9891]">
                  <th className="py-2 text-start">Slot</th>
                  <th className="py-2 text-start">Symbol</th>
                  <th className="py-2 text-start">Detected TF</th>
                  <th className="py-2 text-start">Axes</th>
                  <th className="py-2 text-start">Visible Indicators</th>
                  <th className="py-2 text-start">Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.chartInspections.map((ci) => (
                  <tr key={ci.timeframeSlot} className="border-b border-white/5">
                    <td className="py-2.5 font-mono-num font-semibold text-[#F3E5AB]">{ci.timeframeSlot}</td>
                    <td className="py-2.5">{ci.detectedSymbol}</td>
                    <td className="py-2.5 font-mono-num">{ci.detectedTimeframe}</td>
                    <td className="py-2.5">
                      {ci.priceAxisVisible && ci.timeAxisVisible ? 'Visible' : 'Incomplete'}
                    </td>
                    <td className="py-2.5 text-[#9A9891]">
                      {ci.visibleIndicators.length > 0 ? ci.visibleIndicators.join(', ') : 'None'}
                    </td>
                    <td className="py-2.5 text-[#9A9891]">{ci.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
