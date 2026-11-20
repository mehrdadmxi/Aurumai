import { ArrowLeft, ArrowRight, Layers, ShieldCheck, TrendingUp } from 'lucide-react';
import type { AppPage, GoldMarketData, Language } from '../types.ts';
import { getT } from '../i18n/translations.ts';
import { GoldSphereHero3D } from '../components/GoldSphereHero3D.tsx';
import { LiveGoldWidget } from '../components/LiveGoldWidget.tsx';

interface HomePageProps {
  language: Language;
  market: GoldMarketData | null;
  marketLoading: boolean;
  onRefreshMarket: () => void;
  onNavigate: (page: AppPage) => void;
}

export function HomePage({
  language,
  market,
  marketLoading,
  onRefreshMarket,
  onNavigate,
}: HomePageProps) {
  const t = getT(language);
  const ArrowIcon = language === 'fa' ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-12">
      {/* Cinematic Hero with 3D Metallic Golden Sphere */}
      <section className="aurum-glass-strong rounded-2xl p-6 sm:p-10 relative overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 space-y-5 z-10 order-last lg:order-first">
            <p className="text-xs font-medium tracking-wide text-[#D4AF37]">
              {t.hero.eyebrow}
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight aurum-gold-gradient-text font-display-serif">
              {t.hero.title}
            </h1>
            <p className="text-xl sm:text-2xl font-semibold text-[#F5F2EB] leading-snug">
              {t.hero.slogan}
            </p>
            <p className="text-sm font-medium text-[#F3E5AB]">
              {t.hero.secondarySlogan}
            </p>
            <p className="text-sm sm:text-base text-[#9A9891] leading-relaxed max-w-xl">
              {t.hero.description}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('analysis')}
                className="aurum-gold-btn inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0"
              >
                <span>{t.hero.primaryCta}</span>
                <ArrowIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors whitespace-nowrap shrink-0"
              >
                <span>{t.hero.secondaryCta}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 order-first lg:order-last">
            <GoldSphereHero3D />
          </div>
        </div>
      </section>

      {/* Live GoldAPI Reference Widget */}
      <LiveGoldWidget
        language={language}
        market={market}
        loading={marketLoading}
        onRefresh={onRefreshMarket}
      />

      {/* Multi-Timeframe Methodology */}
      <section className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-bold text-[#F5F2EB]">{t.hero.capabilitiesTitle}</h2>
          <p className="text-sm text-[#9A9891] leading-relaxed">{t.hero.capabilitiesSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <article className="aurum-glass rounded-xl p-6 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#D4AF37] font-mono-num">
              <span>01 · 1H</span>
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="text-base font-semibold text-[#F5F2EB]">{t.hero.cap1Title}</h3>
            <p className="text-sm text-[#9A9891] leading-relaxed">{t.hero.cap1Desc}</p>
          </article>

          <article className="aurum-glass rounded-xl p-6 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#D4AF37] font-mono-num">
              <span>02 · 15M</span>
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-base font-semibold text-[#F5F2EB]">{t.hero.cap2Title}</h3>
            <p className="text-sm text-[#9A9891] leading-relaxed">{t.hero.cap2Desc}</p>
          </article>

          <article className="aurum-glass rounded-xl p-6 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#D4AF37] font-mono-num">
              <span>03 · 5M</span>
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h3 className="text-base font-semibold text-[#F5F2EB]">{t.hero.cap3Title}</h3>
            <p className="text-sm text-[#9A9891] leading-relaxed">{t.hero.cap3Desc}</p>
          </article>
        </div>
      </section>
    </div>
  );
}
