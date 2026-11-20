import { Crown, Send } from 'lucide-react';
import type { AppPage, Language, SubscriptionTier } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface PricingPageProps {
  language: Language;
  tier: SubscriptionTier;
  freeLimit: number;
  vipLimit: number;
  onNavigate: (page: AppPage) => void;
}

export function PricingPage({
  language,
  tier,
  freeLimit,
  vipLimit,
  onNavigate,
}: PricingPageProps) {
  const t = getT(language).pricing;
  const isFa = language === 'fa';

  const freeFeatures = isFa
    ? [
        `${freeLimit} تحلیل هوش مصنوعی در روز`,
        'گزارش تکنیکال پایه (1H / 15M / 5M)',
        'نمایش قیمت مرجع لحظه‌ای GoldAPI',
        'تاریخچه محدود محلی در مرورگر',
        'وضعیت اخبار اقتصادی کلان',
      ]
    : [
        `${freeLimit} AI chart analyses per day`,
        'Core multi-timeframe technical report',
        'Live GoldAPI spot reference display',
        'Limited local browser history',
        'Basic macro news feed status',
      ];

  const vipFeatures = isFa
    ? [
        `${vipLimit} تحلیل هوش مصنوعی در روز`,
        'تحلیل پیشرفته ICT و Smart Money Concepts',
        'گزارش تفصیلی چندتایم‌فریمی و بازرسی ساختار',
        'تاریخچه گسترده و خروجی کامل PDF (RTL/LTR)',
        'جزئیات کامل سطوح ابطال، نقدینگی و FVG/OB',
        'پایش وضعیت سیگنال‌ها در صورت وجود داده معتبر',
      ]
    : [
        `${vipLimit} AI chart analyses per day`,
        'Advanced ICT & Smart Money Concepts depth',
        'Detailed multi-timeframe structural breakdown',
        'Extended analysis history & full PDF export',
        'Full liquidity, FVG/OB & invalidation mapping',
        'Signal monitoring when reliable price data exists',
      ];

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
        <p className="text-sm text-[#9A9891]">{t.subtitle}</p>
      </div>

      <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
        {t.vipBanner}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FREE Tier */}
        <article className="aurum-glass rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#F5F2EB]">{t.freeName}</h2>
              {tier === 'FREE' && (
                <span className="text-xs font-semibold text-emerald-400">{t.activeBadge}</span>
              )}
            </div>
            <p className="text-xs text-[#9A9891]">{t.freeAudience}</p>
            <div className="text-2xl font-bold text-[#F5F2EB]">
              {isFa ? 'رایگان' : '$0'}{' '}
              <span className="text-xs font-normal text-[#9A9891]">
                {isFa ? '/ پلن پایه' : '/ Free Plan'}
              </span>
            </div>
            <ul className="space-y-2.5 pt-2 border-t border-white/10 text-xs text-[#F5F2EB]">
              {freeFeatures.map((feat) => (
                <li key={feat} className="flex items-start gap-2">
                  <span className="text-[#D4AF37]">—</span>
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('analysis')}
            className="w-full py-2.5 rounded-xl text-xs font-semibold border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
          >
            {isFa ? 'ادامه با پلن رایگان' : 'Continue on Free Tier'}
          </button>
        </article>

        {/* VIP Tier */}
        <article className="aurum-glass-strong rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold aurum-gold-gradient-text flex items-center gap-2">
                <Crown className="w-5 h-5 text-[#D4AF37]" />
                <span>{t.vipName}</span>
              </h2>
              {tier === 'VIP' && (
                <span className="text-xs font-semibold text-emerald-400">{t.activeBadge}</span>
              )}
            </div>
            <p className="text-xs text-[#9A9891]">{t.vipAudience}</p>
            <div className="text-2xl font-bold text-[#F3E5AB]">
              {isFa ? '1 میلیون تومان' : '1 Million Toman'}{' '}
              <span className="text-xs font-normal text-[#9A9891]">
                {isFa ? '/ سالانه' : '/ Yearly'}
              </span>
            </div>
            <ul className="space-y-2.5 pt-2 border-t border-white/10 text-xs text-[#F5F2EB]">
              {vipFeatures.map((feat) => (
                <li key={feat} className="flex items-start gap-2">
                  <span className="text-[#D4AF37]">—</span>
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="https://t.me/khanli_mehrdad"
            target="_blank"
            rel="noopener noreferrer"
            className="aurum-gold-btn w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 text-center"
          >
            <Send className="w-3.5 h-3.5 shrink-0" />
            <span>{t.activateViaAdmin}</span>
          </a>
        </article>
      </div>
    </div>
  );
}
