import { RefreshCw, AlertTriangle, CheckCircle2, WifiOff } from 'lucide-react';
import type { GoldMarketData, Language } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface LiveGoldWidgetProps {
  language: Language;
  market: GoldMarketData | null;
  loading: boolean;
  onRefresh: () => void;
  compact?: boolean;
}

export function LiveGoldWidget({
  language,
  market,
  loading,
  onRefresh,
  compact = false,
}: LiveGoldWidgetProps) {
  const t = getT(language).marketWidget;
  const isUp = (market?.change ?? market?.changePercent ?? 0) >= 0;

  const statusLabel = !market
    ? loading
      ? language === 'fa'
        ? 'در حال دریافت قیمت...'
        : 'Fetching quote...'
      : t.unavailable
    : market.status === 'connected'
      ? market.isStale
        ? t.stale
        : market.isCached
          ? t.cached
          : t.live
      : market.status === 'disconnected'
        ? t.disconnected
        : t.error;

  const statusIcon =
    !market && loading ? (
      <RefreshCw className="w-3.5 h-3.5 text-[#D4AF37] animate-spin shrink-0" />
    ) : market?.status === 'connected' && !market.isStale ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
    ) : market?.status === 'disconnected' ? (
      <WifiOff className="w-3.5 h-3.5 text-[#9A9891] shrink-0" />
    ) : (
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
    );

  const fmt = (val: number | null) =>
    val === null || !Number.isFinite(val) ? '—' : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <section className="aurum-glass rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.title}</h2>
          <div className="flex items-center gap-2 text-xs text-[#9A9891] mt-1">
            {statusIcon}
            <span>{statusLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{market?.source || 'GoldAPI (goldapi.io)'}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{t.refresh}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <div className="text-3xl sm:text-4xl font-bold font-mono-num text-[#F5F2EB]">
            {fmt(market?.price ?? null)}
          </div>
          <div className="text-xs text-[#9A9891] mt-1 font-mono-num">
            {t.lastUpdate}:{' '}
            {market?.fetchedAt
              ? new Date(market.fetchedAt).toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')
              : t.unavailable}
          </div>
        </div>

        <div className="text-end">
          <div
            dir="ltr"
            className={`text-base font-semibold font-mono-num ${
              (market?.change === null || market?.change === undefined) &&
              (market?.changePercent === null || market?.changePercent === undefined)
                ? 'text-[#9A9891]'
                : isUp
                  ? 'text-emerald-400'
                  : 'text-rose-400'
            }`}
          >
            {market?.change !== null && market?.change !== undefined
              ? `${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)}${
                  market.changePercent !== null && market.changePercent !== undefined
                    ? ` (${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%)`
                    : ''
                }`
              : market?.changePercent !== null && market?.changePercent !== undefined
                ? `${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%`
                : '—'}
          </div>
          <div className="text-xs text-[#9A9891] mt-0.5">{t.dailyChange}</div>
        </div>
      </div>

      {!compact && (
        <div className="grid grid-cols-3 gap-4 py-4 border-b border-white/10 text-xs">
          <div>
            <div className="text-[#9A9891]">{t.dailyHigh}</div>
            <div className="font-mono-num text-sm font-semibold text-[#F5F2EB] mt-1">
              {fmt(market?.high ?? null)}
            </div>
          </div>
          <div>
            <div className="text-[#9A9891]">{t.dailyLow}</div>
            <div className="font-mono-num text-sm font-semibold text-[#F5F2EB] mt-1">
              {fmt(market?.low ?? null)}
            </div>
          </div>
          <div>
            <div className="text-[#9A9891]">{t.prevClose}</div>
            <div className="font-mono-num text-sm font-semibold text-[#F5F2EB] mt-1">
              {fmt(market?.prevClose ?? null)}
            </div>
          </div>
        </div>
      )}

      {market?.error && (
        <div className="mt-3 p-3 rounded-lg bg-amber-950/35 border border-amber-500/30 text-xs text-amber-200">
          {market.error}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[#9A9891]">{t.refDisclaimer}</p>
    </section>
  );
}
