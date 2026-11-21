import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  Activity,
  BarChart3,
  Crown,
  Globe,
  History,
  Home,
  LayoutDashboard,
  Mail,
  Menu,
  Newspaper,
  Shield,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import type { AppPage, GoldMarketData, Language, SubscriptionTier } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface AppShellProps {
  language: Language;
  onToggleLanguage: () => void;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  market: GoldMarketData | null;
  tier: SubscriptionTier;
  children: ReactNode;
}

export function AppShell({
  language,
  onToggleLanguage,
  activePage,
  onNavigate,
  market,
  tier,
  children,
}: AppShellProps) {
  const t = getT(language);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ id: AppPage; label: string; icon: typeof Home }> = [
    { id: 'home', label: t.nav.home, icon: Home },
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'analysis', label: t.nav.analysis, icon: Sparkles },
    { id: 'signals', label: t.nav.signals, icon: Activity },
    { id: 'market', label: t.nav.market, icon: BarChart3 },
    { id: 'news', label: t.nav.news, icon: Newspaper },
    { id: 'gmail', label: t.nav.gmail, icon: Mail },
    { id: 'history', label: t.nav.history, icon: History },
    { id: 'pricing', label: t.nav.pricing, icon: Crown },
    { id: 'profile', label: t.nav.profile, icon: User },
    { id: 'admin', label: t.nav.admin, icon: Shield },
  ];

  const mobileBottomItems: Array<{ id: AppPage; label: string; icon: typeof Home }> = [
    { id: 'dashboard', label: language === 'fa' ? 'داشبورد' : 'Dashboard', icon: LayoutDashboard },
    { id: 'analysis', label: language === 'fa' ? 'تحلیل AI' : 'Analyze', icon: Sparkles },
    { id: 'signals', label: language === 'fa' ? 'سیگنال‌ها' : 'Signals', icon: Activity },
    { id: 'market', label: language === 'fa' ? 'بازار' : 'Market', icon: BarChart3 },
  ];

  const handleNav = (page: AppPage) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#060608] text-[#F5F2EB] flex flex-col lg:flex-row">
      {/* Desktop Workspace Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 shrink-0 border-e border-[#D4AF37]/15 bg-[#090A0D] sticky top-0 h-screen">
        <div className="px-6 py-5 border-b border-[#D4AF37]/15">
          <button
            type="button"
            onClick={() => handleNav('home')}
            className="text-xl font-bold tracking-tight aurum-gold-gradient-text font-display-serif whitespace-nowrap shrink-0"
          >
            {t.brand}
          </button>
        </div>

        <nav aria-label="Primary Sidebar" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#D4AF37]/15 text-[#F3E5AB] border border-[#D4AF37]/30'
                    : 'text-[#9A9891] hover:text-[#F5F2EB] hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#D4AF37]/15 text-xs text-[#9A9891] space-y-2">
          <div className="flex items-center justify-between">
            <span>{t.dashboard.planStatus}</span>
            <span className="font-mono-num font-semibold text-[#F3E5AB]">{tier}</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0">
        {/* Clean 3-Zone Top Bar */}
        <header className="no-print sticky top-0 z-30 bg-[#060608]/95 border-b border-[#D4AF37]/15 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand on mobile / Page context on desktop */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => handleNav('home')}
              className="lg:hidden text-lg font-bold aurum-gold-gradient-text font-display-serif whitespace-nowrap shrink-0"
            >
              {t.brand}
            </button>
            <span className="hidden lg:inline-block text-sm font-medium text-[#F5F2EB] truncate">
              {navItems.find((n) => n.id === activePage)?.label || t.report.title}
            </span>
          </div>

          {/* Zone 2: Inline tabular XAUUSD reference readout + Language Toggle */}
          <div className="flex items-center gap-4 text-xs text-[#9A9891] shrink-0">
            <div className="hidden sm:flex items-center gap-2 font-mono-num whitespace-nowrap">
              <span className="text-[#F3E5AB]">XAUUSD</span>
              <span className="text-[#F5F2EB] font-semibold">
                {market?.price !== null && market?.price !== undefined
                  ? `$${market.price.toFixed(2)}`
                  : t.marketWidget.unavailable}
              </span>
              {market?.isStale && market?.price !== null && (
                <span>· {t.marketWidget.cached}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleLanguage}
              aria-label={language === 'fa' ? 'Switch to English' : 'تغییر زبان به فارسی'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D4AF37]/30 text-xs font-medium text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors whitespace-nowrap shrink-0"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{t.switchLangLabel}</span>
            </button>
          </div>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleNav('analysis')}
              className="aurum-gold-btn px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0"
            >
              {t.hero.primaryCta}
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {children}
        </main>
      </div>

      {/* Compact Mobile Bottom Navigation Bar (<= 15% mobile height) */}
      <nav
        aria-label="Mobile Navigation"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#090A0D]/95 border-t border-[#D4AF37]/20 h-14 px-2 flex items-center justify-around"
      >
        {mobileBottomItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNav(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium min-w-[56px] whitespace-nowrap ${
                isActive ? 'text-[#F3E5AB]' : 'text-[#9A9891]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-[68px]">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-label="More navigation pages"
          className="flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium text-[#9A9891] min-w-[56px]"
        >
          {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          <span>{language === 'fa' ? 'بیشتر' : 'More'}</span>
        </button>
      </nav>

      {/* Mobile Drawer for remaining pages */}
      {mobileMenuOpen && (
        <div className="no-print lg:hidden fixed inset-x-0 bottom-14 z-30 bg-[#090A0D] border-t border-[#D4AF37]/25 p-4 grid grid-cols-2 gap-2">
          {navItems
            .filter((i) => !mobileBottomItems.some((m) => m.id === i.id))
            .map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                    isActive
                      ? 'bg-[#D4AF37]/15 text-[#F3E5AB] border border-[#D4AF37]/30'
                      : 'bg-white/5 text-[#F5F2EB]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
