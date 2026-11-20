import { Fragment, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AnalysisReport, Language, SignalStatus } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface SignalsPageProps {
  language: Language;
  reports: AnalysisReport[];
  onOpenReport: (report: AnalysisReport) => void;
  onStartAnalysis: () => void;
}

const ALL_STATUSES: SignalStatus[] = [
  'ACTIVE',
  'ENTRY REACHED',
  'TP1 HIT',
  'TP2 HIT',
  'TP3 HIT',
  'STOP LOSS HIT',
  'EXPIRED',
  'INVALIDATED',
  'UNVERIFIED',
];

export function SignalsPage({
  language,
  reports,
  onOpenReport,
  onStartAnalysis,
}: SignalsPageProps) {
  const t = getT(language);
  const [expandedId, setExpandedId] = useState<string | null>(() => reports[0]?.id ?? null);

  const decisionBadgeClass = (decision: AnalysisReport['decision']) => {
    if (decision === 'BUY') return 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30';
    if (decision === 'SELL') return 'text-rose-400 border-rose-500/30 bg-rose-950/30';
    return 'text-amber-300 border-amber-500/30 bg-amber-950/30';
  };

  const fmt = (val: number | null) =>
    val === null || !Number.isFinite(val) ? 'N/A' : `$${val.toFixed(2)}`;

  const isCompactNumericZone = (zone?: string) =>
    Boolean(zone) && zone!.trim().length <= 24 && /^[\d.,\s$–-]+$/.test(zone!.trim());

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.signals.title}</h1>
        <p className="text-sm text-[#9A9891]">{t.signals.subtitle}</p>
      </div>

      <div className="aurum-glass rounded-xl p-4 text-xs text-[#9A9891] space-y-2">
        <p>{t.signals.statusNote}</p>
        <div dir="ltr" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono-num text-[#F3E5AB]">
          {ALL_STATUSES.map((s, idx) => (
            <Fragment key={s}>
              {idx > 0 && (
                <span aria-hidden="true" className="text-[#9A9891]/60">
                  ·
                </span>
              )}
              <span>{s}</span>
            </Fragment>
          ))}
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="aurum-glass rounded-xl p-10 text-center space-y-4">
          <p className="text-sm text-[#9A9891] max-w-lg mx-auto">{t.signals.empty}</p>
          <button
            type="button"
            onClick={onStartAnalysis}
            className="aurum-gold-btn px-5 py-2.5 rounded-xl text-xs font-semibold"
          >
            {t.hero.primaryCta}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((rep) => {
            const isExpanded = expandedId === rep.id;
            const compactZone = isCompactNumericZone(rep.tradingPlan.entryZone);

            return (
              <article
                key={rep.id}
                className="aurum-glass rounded-xl p-5 space-y-4"
              >
                {/* Header Row: Identity, Decision, Status, Score, Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <div className="flex flex-wrap items-center gap-3">
                    <span dir="ltr" className="font-mono-num font-bold text-base text-[#F3E5AB]">
                      {rep.symbol}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${decisionBadgeClass(
                        rep.decision
                      )}`}
                    >
                      {rep.decision}
                    </span>
                    <span className="text-xs font-mono-num text-[#9A9891]">
                      {rep.signalStatus}
                    </span>
                    <span aria-hidden="true" className="text-white/20">·</span>
                    <span className="text-xs font-mono-num text-[#F5F2EB]">
                      <span dir="ltr">{rep.technicalScores.overallScore}/10</span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-mono-num text-[#9A9891]">
                      {new Date(rep.createdAt).toLocaleString(
                        language === 'fa' ? 'fa-IR' : 'en-US'
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(rep.id)}
                      aria-expanded={isExpanded}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-[#F5F2EB] hover:border-[#D4AF37]/40 hover:text-[#F3E5AB] transition-colors whitespace-nowrap"
                    >
                      <span>{isExpanded ? t.signals.hideDetails : t.signals.showDetails}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenReport(rep)}
                      className="px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 font-medium transition-colors whitespace-nowrap"
                    >
                      {t.history.openReport}
                    </button>
                  </div>
                </div>

                {/* Aligned Execution Levels Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                  <div>
                    <div className="text-[#9A9891]">{t.signals.colEntry}</div>
                    <div className="font-mono-num font-bold text-sm text-[#F3E5AB] mt-1">
                      <span dir="ltr" className="inline-block">
                        {rep.tradingPlan.entryPrice !== null
                          ? fmt(rep.tradingPlan.entryPrice)
                          : compactZone
                            ? rep.tradingPlan.entryZone
                            : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[#9A9891]">{t.signals.colSL}</div>
                    <div className="font-mono-num font-bold text-sm text-rose-400 mt-1">
                      <span dir="ltr" className="inline-block">
                        {fmt(rep.tradingPlan.stopLoss)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[#9A9891]">TP1</div>
                    <div className="font-mono-num font-semibold text-sm text-emerald-400 mt-1">
                      <span dir="ltr" className="inline-block">
                        {fmt(rep.tradingPlan.takeProfit1)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[#9A9891]">TP2</div>
                    <div className="font-mono-num font-semibold text-sm text-emerald-400 mt-1">
                      <span dir="ltr" className="inline-block">
                        {fmt(rep.tradingPlan.takeProfit2)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[#9A9891]">TP3</div>
                    <div className="font-mono-num font-semibold text-sm text-emerald-400 mt-1">
                      <span dir="ltr" className="inline-block">
                        {fmt(rep.tradingPlan.takeProfit3)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[#9A9891]">{t.signals.colRR}</div>
                    <div className="font-mono-num font-bold text-sm text-[#F3E5AB] mt-1">
                      <span dir="ltr" className="inline-block">
                        {rep.tradingPlan.riskToRewardLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Structured Entry Details & Analytical Rationale */}
                {isExpanded && (
                  <div className="pt-4 border-t border-white/10 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-[#F3E5AB]">
                        {t.signals.entryDetailsHeading}
                      </h3>
                      <span className="text-[11px] font-mono-num text-[#9A9891]">
                        {rep.tradingPlan.entryTimeframe}
                      </span>
                    </div>

                    <dl className="divide-y divide-white/10 text-xs">
                      <div className="py-2 first:pt-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline">
                        <dt className="sm:col-span-3 text-[#9A9891]">{t.signals.entryZoneLabel}</dt>
                        <dd className="sm:col-span-9 text-[#F5F2EB] leading-relaxed">
                          {compactZone ? (
                            <span dir="ltr" className="inline-block font-mono-num font-semibold text-[#F3E5AB]">
                              {rep.tradingPlan.entryZone}
                            </span>
                          ) : (
                            rep.tradingPlan.entryZone || 'N/A'
                          )}
                          {rep.tradingPlan.entryTimeframe ? (
                            <span className="text-[#9A9891] font-mono-num ms-2">
                              ({rep.tradingPlan.entryTimeframe})
                            </span>
                          ) : null}
                        </dd>
                      </div>

                      <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline">
                        <dt className="sm:col-span-3 text-[#9A9891]">{t.signals.entryTriggerLabel}</dt>
                        <dd className="sm:col-span-9 text-[#F5F2EB] leading-relaxed">
                          {rep.analysis5M?.entryConfirmation || '—'}
                        </dd>
                      </div>

                      <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline">
                        <dt className="sm:col-span-3 text-[#9A9891]">{t.signals.priceStatusLabel}</dt>
                        <dd className="sm:col-span-9 text-[#F5F2EB] leading-relaxed">
                          {rep.tradingPlan.plannedVsCurrentNote || '—'}
                        </dd>
                      </div>

                      <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline">
                        <dt className="sm:col-span-3 text-[#9A9891]">{t.signals.rationaleLabel}</dt>
                        <dd className="sm:col-span-9 text-[#9A9891] leading-relaxed">
                          {rep.detailedExplanation?.decisionReason || '—'}
                        </dd>
                      </div>

                      <div className="py-2 last:pb-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline">
                        <dt className="sm:col-span-3 text-[#9A9891]">{t.signals.invalidationLabel}</dt>
                        <dd className="sm:col-span-9 text-rose-300/90 leading-relaxed">
                          {rep.setupInvalidation || rep.tradingPlan.invalidationLevel || '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
