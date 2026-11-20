import { ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import type { Language, NewsFeedState } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface NewsPageProps {
  language: Language;
  news: NewsFeedState | null;
  loading: boolean;
  onRefresh: () => void;
}

export function NewsPage({ language, news, loading, onRefresh }: NewsPageProps) {
  const t = getT(language).news;
  const isFa = language === 'fa';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
          <p className="text-sm text-[#9A9891]">{t.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{isFa ? 'بروزرسانی اخبار' : 'Refresh News'}</span>
        </button>
      </div>

      {!news || !news.providerConfigured || news.items.length === 0 ? (
        <div className="aurum-glass rounded-xl p-10 text-center space-y-3">
          <Newspaper className="w-8 h-8 text-[#D4AF37] mx-auto opacity-80" />
          <h2 className="text-lg font-semibold text-[#F5F2EB]">{t.unavailableTitle}</h2>
          <p className="text-sm text-[#9A9891] max-w-lg mx-auto">{t.unavailableDesc}</p>
          {news?.error && news.providerConfigured && (
            <p className="text-xs text-amber-300 font-mono-num">{news.error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3.5">
          {news.items.map((item) => {
            const categoryLabel = t.categories[item.category] || item.category;
            const impactLabel = t.impacts[item.goldImpact] || item.goldImpact;
            const hasPersianTranslation = isFa && Boolean(item.headlineFa);

            return (
              <article key={item.id} className="aurum-glass rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9A9891]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[#F3E5AB] font-medium">{categoryLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.source}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.isDelayed ? t.delayedTag : t.liveTag}</span>
                  </div>
                  <span className="font-mono-num" dir="ltr">
                    {new Date(item.publishedAt).toLocaleString(
                      isFa ? 'fa-IR' : 'en-US'
                    )}
                  </span>
                </div>

                {hasPersianTranslation ? (
                  <div className="space-y-3">
                    {/* Persian Translation (Placed cleanly above original English text) */}
                    <div className="space-y-1.5">
                      <span className="inline-block text-[11px] font-medium text-[#D4AF37]">
                        {t.persianTranslationLabel}
                      </span>
                      <h2 className="text-base font-semibold text-[#F5F2EB] leading-relaxed">
                        {item.headlineFa}
                      </h2>
                      {item.summaryFa && (
                        <p className="text-sm text-[#D6D3CB] leading-relaxed">
                          {item.summaryFa}
                        </p>
                      )}
                    </div>

                    {/* Original English Text directly below */}
                    <div
                      dir="ltr"
                      className="pt-2.5 border-t border-white/10 space-y-1 text-left"
                    >
                      <span className="block text-[11px] font-medium text-[#7D7A72]">
                        {t.originalTextLabel}
                      </span>
                      <p className="text-xs sm:text-sm font-medium text-[#B8B4AC] leading-snug">
                        {item.headline}
                      </p>
                      {item.summary && (
                        <p className="text-xs text-[#8E8B84] leading-relaxed">
                          {item.summary}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div dir="ltr" className="space-y-1.5 text-left">
                    <h2 className="text-base font-semibold text-[#F5F2EB] leading-snug">
                      {item.headline}
                    </h2>
                    {item.summary && (
                      <p className="text-xs sm:text-sm text-[#9A9891] leading-relaxed">
                        {item.summary}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#9A9891]">
                  <div>
                    {t.impactLabel}:{' '}
                    <span
                      className={
                        item.goldImpact === 'Bullish'
                          ? 'text-emerald-400 font-semibold'
                          : item.goldImpact === 'Bearish'
                            ? 'text-rose-400 font-semibold'
                            : 'text-amber-300 font-semibold'
                      }
                    >
                      {impactLabel}
                    </span>
                  </div>

                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#D4AF37] hover:text-[#F3E5AB] transition-colors"
                    >
                      <span>{t.sourceLinkLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
