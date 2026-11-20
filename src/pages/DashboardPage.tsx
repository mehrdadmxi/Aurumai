import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type {
  AnalysisReport,
  AppPage,
  AppUser,
  GoldMarketData,
  Language,
  SubscriptionTier,
} from '../types.ts';
import { getT } from '../i18n/translations.ts';
import { LiveGoldWidget } from '../components/LiveGoldWidget.tsx';

interface DashboardPageProps {
  language: Language;
  user: AppUser | null;
  market: GoldMarketData | null;
  marketLoading: boolean;
  onRefreshMarket: () => void;
  history: AnalysisReport[];
  tier: SubscriptionTier;
  remainingQuota: number;
  dailyLimit: number;
  onOpenReport: (report: AnalysisReport) => void;
  onNavigate: (page: AppPage) => void;
}

export function DashboardPage({
  language,
  user,
  market,
  marketLoading,
  onRefreshMarket,
  history,
  tier,
  remainingQuota,
  dailyLimit,
  onOpenReport,
  onNavigate,
}: DashboardPageProps) {
  const t = getT(language);
  const latestSignal = history[0] || null;
  const ArrowIcon = language === 'fa' ? ArrowLeft : ArrowRight;

  const decisionBadgeClass = (decision: AnalysisReport['decision']) => {
    if (decision === 'BUY') return 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30';
    if (decision === 'SELL') return 'text-rose-400 border-rose-500/30 bg-rose-950/30';
    return 'text-amber-300 border-amber-500/30 bg-amber-950/30';
  };

  const fmtPrice = (val: number | null) =>
    val === null || !Number.isFinite(val) ? 'N/A' : `$${val.toFixed(2)}`;

  const isCompactNumericZone = (zone?: string) =>
    Boolean(zone) && zone!.trim().length <= 24 && /^[\d.,\s$–-]+$/.test(zone!.trim());

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="aurum-glass rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#F5F2EB]">
            {user ? `${t.dashboard.welcome} — ${user.name}` : t.dashboard.welcome}
          </h1>
          <p className="text-sm text-[#9A9891]">{t.dashboard.welcomeSub}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('analysis')}
          className="aurum-gold-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>{t.dashboard.quickLaunch}</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="aurum-glass rounded-xl p-5">
          <div className="text-xs text-[#9A9891]">{t.dashboard.goldPrice}</div>
          <div className="text-2xl font-bold font-mono-num text-[#F3E5AB] mt-2">
            {market?.price !== null && market?.price !== undefined
              ? `$${market.price.toFixed(2)}`
              : t.marketWidget.unavailable}
          </div>
          <div className="text-xs text-[#9A9891] mt-1">
            {market?.isStale && market.price !== null ? t.marketWidget.cached : market?.source}
          </div>
        </div>

        <div className="aurum-glass rounded-xl p-5">
          <div className="text-xs text-[#9A9891]">{t.dashboard.dailyMove}</div>
          <div
            className={`text-2xl font-bold font-mono-num mt-2 ${
              (market?.change ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {market?.changePercent !== null && market?.changePercent !== undefined
              ? `${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%`
              : '—'}
          </div>
          <div className="text-xs text-[#9A9891] mt-1 font-mono-num">
            {market?.change !== null && market?.change !== undefined
              ? `${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)} USD`
              : t.marketWidget.unavailable}
          </div>
        </div>

        <div className="aurum-glass rounded-xl p-5">
          <div className="text-xs text-[#9A9891]">{t.dashboard.completedAnalyses}</div>
          <div className="text-2xl font-bold font-mono-num text-[#F5F2EB] mt-2">
            {history.length}
          </div>
          <div className="text-xs text-[#9A9891] mt-1">
            {t.dashboard.remainingDaily}: <span className="font-mono-num text-[#F3E5AB]">{remainingQuota}/{dailyLimit}</span>
          </div>
        </div>

        <div className="aurum-glass rounded-xl p-5">
          <div className="text-xs text-[#9A9891]">{t.dashboard.planStatus}</div>
          <div className="text-2xl font-bold font-mono-num text-[#D4AF37] mt-2">
            {tier}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('pricing')}
            className="text-xs text-[#F3E5AB] hover:underline mt-1"
          >
            {t.nav.pricing}
          </button>
        </div>
      </div>

      {/* Main Split: Latest Signal + Live Gold Market */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 aurum-glass rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#F3E5AB]">{t.dashboard.latestSignal}</h2>
            <button
              type="button"
              onClick={() => onNavigate('signals')}
              className="inline-flex items-center gap-1 text-xs text-[#9A9891] hover:text-[#F3E5AB]"
            >
              <span>{t.dashboard.viewAllSignals}</span>
              <ArrowIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {latestSignal ? (
            <div className="space-y-4">
              {/* Top Identity & Timestamp */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <span dir="ltr" className="font-mono-num font-bold text-lg text-[#F5F2EB]">
                    XAUUSD
                  </span>
                  <span className="text-xs font-mono-num text-[#9A9891]">
                    {latestSignal.tradingPlan.entryTimeframe}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${decisionBadgeClass(
                      latestSignal.decision
                    )}`}
                  >
                    {latestSignal.decision}
                  </span>
                </div>
                <span dir="ltr" className="text-xs font-mono-num text-[#9A9891]">
                  {new Date(latestSignal.createdAt).toLocaleString(
                    language === 'fa' ? 'fa-IR' : 'en-US'
                  )}
                </span>
              </div>

              {/* Clean Tabular Execution Levels Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pb-3 border-b border-white/10">
                <div>
                  <div className="text-[#9A9891]">{t.signals.colEntry}</div>
                  <div className="font-mono-num font-bold text-sm text-[#F3E5AB] mt-1">
                    <span dir="ltr" className="inline-block">
                      {latestSignal.tradingPlan.entryPrice !== null
                        ? fmtPrice(latestSignal.tradingPlan.entryPrice)
                        : isCompactNumericZone(latestSignal.tradingPlan.entryZone)
                          ? latestSignal.tradingPlan.entryZone
                          : 'N/A'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[#9A9891]">{t.signals.colSL}</div>
                  <div className="font-mono-num font-bold text-sm text-rose-400 mt-1">
                    <span dir="ltr" className="inline-block">
                      {fmtPrice(latestSignal.tradingPlan.stopLoss)}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[#9A9891]">TP1 / TP2</div>
                  <div className="font-mono-num font-semibold text-emerald-400 mt-1">
                    <span dir="ltr" className="inline-block">
                      {latestSignal.tradingPlan.takeProfit1 !== null
                        ? fmtPrice(latestSignal.tradingPlan.takeProfit1)
                        : 'N/A'}
                      {latestSignal.tradingPlan.takeProfit2 !== null
                        ? ` / ${fmtPrice(latestSignal.tradingPlan.takeProfit2)}`
                        : ''}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[#9A9891]">{t.signals.colRR}</div>
                  <div className="font-mono-num font-bold text-sm text-[#F3E5AB] mt-1">
                    <span dir="ltr" className="inline-block">
                      {latestSignal.tradingPlan.riskToRewardLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Structured Entry Details & Setup Rationale */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-[#F3E5AB]">
                  {t.dashboard.entryDetailsTitle}
                </h3>

                <dl className="divide-y divide-white/10 text-xs">
                  {latestSignal.tradingPlan.entryZone && (
                    <div className="py-2 first:pt-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 items-baseline">
                      <dt className="sm:col-span-4 text-[#9A9891] shrink-0">
                        {t.dashboard.entryZoneLabel}
                      </dt>
                      <dd className="sm:col-span-8 leading-relaxed text-[#F5F2EB]">
                        {isCompactNumericZone(latestSignal.tradingPlan.entryZone) ? (
                          <span dir="ltr" className="inline-block font-mono-num font-semibold text-[#F3E5AB]">
                            {latestSignal.tradingPlan.entryZone}
                          </span>
                        ) : (
                          latestSignal.tradingPlan.entryZone
                        )}
                      </dd>
                    </div>
                  )}

                  {latestSignal.analysis5M?.entryConfirmation && (
                    <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 items-baseline">
                      <dt className="sm:col-span-4 text-[#9A9891] shrink-0">
                        {t.dashboard.entryTriggerLabel}
                      </dt>
                      <dd className="sm:col-span-8 text-[#F5F2EB] leading-relaxed">
                        {latestSignal.analysis5M.entryConfirmation}
                      </dd>
                    </div>
                  )}

                  {latestSignal.tradingPlan.plannedVsCurrentNote && (
                    <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 items-baseline">
                      <dt className="sm:col-span-4 text-[#9A9891] shrink-0">
                        {t.dashboard.priceStatusLabel}
                      </dt>
                      <dd className="sm:col-span-8 text-[#F5F2EB] leading-relaxed">
                        {latestSignal.tradingPlan.plannedVsCurrentNote}
                      </dd>
                    </div>
                  )}

                  {latestSignal.detailedExplanation?.decisionReason && (
                    <div className="py-2 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 items-baseline">
                      <dt className="sm:col-span-4 text-[#9A9891] shrink-0">
                        {t.dashboard.decisionReasonLabel}
                      </dt>
                      <dd className="sm:col-span-8 text-[#9A9891] leading-relaxed">
                        {latestSignal.detailedExplanation.decisionReason}
                      </dd>
                    </div>
                  )}

                  {latestSignal.setupInvalidation && (
                    <div className="py-2 last:pb-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3 items-baseline">
                      <dt className="sm:col-span-4 text-[#9A9891] shrink-0">
                        {t.dashboard.invalidationLabel}
                      </dt>
                      <dd className="sm:col-span-8 text-rose-300/90 leading-relaxed">
                        {latestSignal.setupInvalidation}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="pt-1 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenReport(latestSignal)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
                >
                  {t.history.openReport}
                </button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-[#9A9891]">{t.dashboard.noSignalYet}</p>
              <button
                type="button"
                onClick={() => onNavigate('analysis')}
                className="aurum-gold-btn px-4 py-2 rounded-lg text-xs font-semibold"
              >
                {t.hero.primaryCta}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-6">
          <LiveGoldWidget
            language={language}
            market={market}
            loading={marketLoading}
            onRefresh={onRefreshMarket}
          />
        </div>
      </div>

      {/* Recent History Table */}
      <section className="aurum-glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#F3E5AB]">{t.dashboard.recentHistory}</h2>
          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="inline-flex items-center gap-1 text-xs text-[#9A9891] hover:text-[#F3E5AB]"
          >
            <span>{t.dashboard.viewAllHistory}</span>
            <ArrowIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-[#9A9891] py-4">{t.history.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[#9A9891]">
                  <th className="py-2.5 text-start font-medium">{t.signals.colTime}</th>
                  <th className="py-2.5 text-start font-medium">{t.signals.colDecision}</th>
                  <th className="py-2.5 text-start font-medium">{t.signals.colEntry}</th>
                  <th className="py-2.5 text-start font-medium">{t.signals.colRR}</th>
                  <th className="py-2.5 text-start font-medium">{t.signals.colScore}</th>
                  <th className="py-2.5 text-end font-medium" />
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 5).map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-3 font-mono-num text-[#9A9891]">
                      {new Date(item.createdAt).toLocaleString(
                        language === 'fa' ? 'fa-IR' : 'en-US'
                      )}
                    </td>
                    <td className="py-3 font-semibold text-[#F5F2EB]">{item.decision}</td>
                    <td className="py-3 font-mono-num text-[#F5F2EB]">
                      <span dir="ltr">
                        {item.tradingPlan.entryPrice !== null
                          ? fmtPrice(item.tradingPlan.entryPrice)
                          : isCompactNumericZone(item.tradingPlan.entryZone)
                            ? item.tradingPlan.entryZone
                            : 'N/A'}
                      </span>
                    </td>
                    <td className="py-3 font-mono-num text-[#F3E5AB]">
                      <span dir="ltr">{item.tradingPlan.riskToRewardLabel}</span>
                    </td>
                    <td className="py-3 font-mono-num text-[#F5F2EB]">
                      {item.technicalScores.overallScore}/10
                    </td>
                    <td className="py-3 text-end">
                      <button
                        type="button"
                        onClick={() => onOpenReport(item)}
                        className="text-[#F3E5AB] hover:underline font-medium"
                      >
                        {t.history.openReport}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
