import { ExternalLink, RefreshCw } from 'lucide-react';
import type {
  AnalysisReport,
  ApifyStatusPayload,
  GoldMarketData,
  Language,
  NewsFeedState,
} from '../types.ts';
import { getT } from '../i18n/translations.ts';
import { LiveGoldWidget } from '../components/LiveGoldWidget.tsx';

interface MarketPageProps {
  language: Language;
  market: GoldMarketData | null;
  marketLoading: boolean;
  onRefreshMarket: () => void;
  sessionTicks: Array<{ time: string; price: number }>;
  apify: ApifyStatusPayload | null;
  news: NewsFeedState | null;
  latestReport: AnalysisReport | null;
}

export function MarketPage({
  language,
  market,
  marketLoading,
  onRefreshMarket,
  sessionTicks,
  apify,
  news,
  latestReport,
}: MarketPageProps) {
  const t = getT(language);

  const renderSessionSparkline = () => {
    if (sessionTicks.length < 2) {
      return (
        <div className="h-32 flex items-center justify-center text-xs text-[#9A9891] border border-dashed border-white/10 rounded-lg">
          {language === 'fa'
            ? 'نمودار نوسان جلسه پس از دریافت حداقل ۲ نرخ زنده از GoldAPI رسم می‌شود (داده جعلی تولید نمی‌شود).'
            : 'Session reference chart plots once at least 2 real GoldAPI ticks are recorded (no fabricated candles).'}
        </div>
      );
    }

    const prices = sessionTicks.map((pt) => pt.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    const width = 600;
    const height = 120;
    const points = sessionTicks
      .map((pt, idx) => {
        const x = (idx / (sessionTicks.length - 1)) * width;
        const y = height - 10 - ((pt.price - min) / span) * (height - 20);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32">
        <polyline
          fill="none"
          stroke="#D4AF37"
          strokeWidth="2"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.market.title}</h1>
        <p className="text-sm text-[#9A9891]">{t.market.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <LiveGoldWidget
            language={language}
            market={market}
            loading={marketLoading}
            onRefresh={onRefreshMarket}
          />
        </div>

        <div className="lg:col-span-5 aurum-glass rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">
            {language === 'fa' ? 'روند تیک‌های واقعی جلسه جاری' : 'Recorded Session GoldAPI Ticks'}
          </h2>
          {renderSessionSparkline()}
        </div>
      </div>

      {/* Market Trend & Key Technical Levels from latest real analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="aurum-glass rounded-xl p-6 space-y-3">
          <h2 className="text-base font-semibold text-[#F3E5AB]">{t.market.trendSection}</h2>
          {latestReport ? (
            <div className="space-y-2 text-xs text-[#9A9891] leading-relaxed">
              <p className="text-sm font-medium text-[#F5F2EB]">{latestReport.marketDirection}</p>
              <p><strong className="text-[#F5F2EB]">1H:</strong> {latestReport.analysis1H.mainTrend}</p>
              <p><strong className="text-[#F5F2EB]">15M:</strong> {latestReport.analysis15M.marketStructure}</p>
            </div>
          ) : (
            <p className="text-sm text-[#9A9891]">{t.market.noRecentAnalysis}</p>
          )}
        </section>

        <section className="aurum-glass rounded-xl p-6 space-y-3">
          <h2 className="text-base font-semibold text-[#F3E5AB]">{t.market.levelsSection}</h2>
          {latestReport ? (
            <div className="space-y-2 text-xs text-[#9A9891] leading-relaxed">
              <p><strong className="text-[#F5F2EB]">1H Levels:</strong> {latestReport.analysis1H.importantLevels}</p>
              <p><strong className="text-[#F5F2EB]">15M Levels:</strong> {latestReport.analysis15M.importantLevels}</p>
            </div>
          ) : (
            <p className="text-sm text-[#9A9891]">{t.market.noRecentAnalysis}</p>
          )}
        </section>
      </div>

      {/* Economic Events Summary */}
      <section className="aurum-glass rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-[#F3E5AB]">{t.market.eventsSection}</h2>
        {news?.providerConfigured && news.items.length > 0 ? (
          <div className="divide-y divide-white/10">
            {news.items.slice(0, 4).map((item) => (
              <div key={item.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="space-y-0.5">
                  <span className="block text-[#F5F2EB] font-medium">
                    {language === 'fa' && item.headlineFa ? item.headlineFa : item.headline}
                  </span>
                  {language === 'fa' && item.headlineFa && (
                    <span dir="ltr" className="block text-[11px] text-[#8E8B84]">
                      {item.headline}
                    </span>
                  )}
                </div>
                <span className="text-[#9A9891] font-mono-num">
                  {(t.news.categories[item.category] || item.category)} · {(t.news.impacts[item.goldImpact] || item.goldImpact)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#9A9891]">{t.news.unavailableTitle}</p>
        )}
      </section>

      {/* Apify TradingView XAUUSD Sources */}
      <section className="aurum-glass rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#F3E5AB]">{t.market.apifyTitle}</h2>
            <p className="text-xs text-[#9A9891] mt-1">
              {t.market.apifyActorId}: <span className="font-mono-num text-[#F5F2EB]">{apify?.actorId || 'hOfycUMuUpaFZvG7a'}</span> ·{' '}
              {apify?.status || 'disconnected'} · {t.market.apifyNote}
            </p>
          </div>
        </div>

        {apify?.lastError && (
          <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>{apify.lastError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {(apify?.xauusdSources || []).map((src) => (
            <a
              key={src.url}
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 hover:border-[#D4AF37]/40 text-xs transition-colors"
            >
              <span className="font-mono-num font-medium text-[#F5F2EB]">{src.symbol}</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#D4AF37]" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
