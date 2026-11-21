import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisReport,
  ApifyStatusPayload,
  AppPage,
  AppUser,
  GoldMarketData,
  Language,
  NewsFeedState,
  SubscriptionTier,
} from './types.ts';
import {
  buildFallbackAppUser,
  deleteAnalysisFromFirestore,
  ensureUserProfile,
  type FirebaseUser,
  getGmailAccessToken,
  resolvedFirebaseAuthDomain,
  resolvePendingGoogleRedirect,
  saveAnalysisToFirestore,
  subscribeAuthState,
  subscribeGmailAccessToken,
  subscribeUserAnalyses,
  updateUserLanguagePreference,
} from './lib/firebase.ts';
import { formatFirebaseAuthError } from './lib/firebaseAuthError.ts';
import { formatReportAsText } from './lib/reportFormatter.ts';
import {
  deleteReportFromLocalHistory,
  getClientId,
  loadLocalAnalysisHistory,
  loadSavedLanguage,
  saveLanguage,
  saveReportToLocalHistory,
} from './lib/storage.ts';
import { AppShell } from './components/AppShell.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { AnalysisPage } from './pages/AnalysisPage.tsx';
import { AnalysisReportPage } from './pages/AnalysisReportPage.tsx';
import { SignalsPage } from './pages/SignalsPage.tsx';
import { MarketPage } from './pages/MarketPage.tsx';
import { NewsPage } from './pages/NewsPage.tsx';
import { GmailPage, type GmailComposeDraftPrefill } from './pages/GmailPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { PricingPage } from './pages/PricingPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';

export default function App() {
  const [language, setLanguage] = useState<Language>(() => loadSavedLanguage());
  const [activePage, setActivePage] = useState<AppPage>('home');

  const [market, setMarket] = useState<GoldMarketData | null>(null);
  const [sessionTicks, setSessionTicks] = useState<Array<{ time: string; price: number }>>([]);
  const [marketLoading, setMarketLoading] = useState(false);

  const [apify, setApify] = useState<ApifyStatusPayload | null>(null);
  const [news, setNews] = useState<NewsFeedState | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);

  const [history, setHistory] = useState<AnalysisReport[]>(() => loadLocalAnalysisHistory());
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(
    () => loadLocalAnalysisHistory()[0] || null
  );
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(() => getGmailAccessToken());
  const [gmailPrefill, setGmailPrefill] = useState<GmailComposeDraftPrefill | null>(null);

  const [tier, setTier] = useState<SubscriptionTier>('FREE');
  const [usedToday, setUsedToday] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [freeLimit, setFreeLimit] = useState(3);
  const [vipLimit, setVipLimit] = useState(25);

  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  const syncInFlightRef = useRef<{ uid: string; promise: Promise<AppUser> } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Sync HTML lang and dir attributes for Persian RTL / English LTR
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    saveLanguage(language);
  }, [language]);

  const [cloudProfileSynced, setCloudProfileSynced] = useState(false);

  const syncFirebaseUser = useCallback(async (fbUser: FirebaseUser): Promise<AppUser> => {
    const existingSync = syncInFlightRef.current;
    if (existingSync && existingSync.uid === fbUser.uid) {
      return existingSync.promise;
    }

    const promise = ensureUserProfile(fbUser, languageRef.current)
      .then((appUser) => {
        if (mountedRef.current) {
          setUser(appUser);
          setCloudProfileSynced(true);
          setAuthError(null);
          setAuthReady(true);
        }
        return appUser;
      })
      .catch((err) => {
        const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
        const formatted = formatFirebaseAuthError(
          err,
          languageRef.current,
          hostname,
          resolvedFirebaseAuthDomain
        );
        const fallbackUser = buildFallbackAppUser(fbUser, languageRef.current);
        if (mountedRef.current) {
          setUser(fallbackUser);
          setCloudProfileSynced(false);
          setAuthError(formatted);
          setAuthReady(true);
        }
        return fallbackUser;
      })
      .finally(() => {
        if (syncInFlightRef.current?.promise === promise) {
          syncInFlightRef.current = null;
        }
      });

    syncInFlightRef.current = { uid: fbUser.uid, promise };
    return promise;
  }, []);

  // Subscribe to Firebase Auth state changes & process any pending Google redirect result
  useEffect(() => {
    let cancelled = false;

    void resolvePendingGoogleRedirect().then((res) => {
      if (cancelled) return;
      if (res.user) {
        void syncFirebaseUser(res.user).catch((err) => {
          console.error(err);
        });
      } else if (res.error) {
        const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
        setAuthError(
          formatFirebaseAuthError(
            res.error,
            languageRef.current,
            hostname,
            resolvedFirebaseAuthDomain
          )
        );
      }
    });

    const unsubscribe = subscribeAuthState((fbUser) => {
      if (!fbUser) {
        if (!cancelled) {
          setUser(null);
          setCloudProfileSynced(false);
          setAuthReady(true);
          const local = loadLocalAnalysisHistory();
          setHistory(local);
          setSelectedReport((prev) => prev || local[0] || null);
        }
        return;
      }

      void syncFirebaseUser(fbUser).catch((err) => {
        console.error(err);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [syncFirebaseUser]);

  // Keep in-memory Gmail OAuth access token synchronized with Firebase auth lifecycle
  useEffect(() => {
    setGmailToken(getGmailAccessToken());
    return subscribeGmailAccessToken((nextToken) => {
      setGmailToken(nextToken);
    });
  }, []);

  // Attach Cloud Firestore real-time analyses listener ONLY after auth & profile sync succeed
  useEffect(() => {
    if (!authReady || !user?.uid || !cloudProfileSynced) return;
    const unsubscribe = subscribeUserAnalyses(
      user.uid,
      (cloudReports) => {
        setHistory(cloudReports);
        setSelectedReport((prev) => {
          if (prev && cloudReports.some((r) => r.id === prev.id)) {
            return prev;
          }
          return cloudReports[0] || prev || null;
        });
      },
      (err) => {
        console.error(err);
      }
    );
    return () => unsubscribe();
  }, [authReady, user?.uid, cloudProfileSynced]);

  const fetchGold = useCallback(async (forceRefresh = false) => {
    setMarketLoading(true);
    try {
      const res = await fetch(`/api/market/gold${forceRefresh ? '?refresh=1' : ''}`);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = (await res.json()) as {
          market: GoldMarketData;
          sessionTicks: Array<{ time: string; price: number }>;
        };
        setMarket(data.market);
        setSessionTicks(data.sessionTicks || []);
      } else if (ct.includes('text/html')) {
        setMarket((prev) =>
          prev || {
            symbol: 'XAUUSD',
            price: null,
            prevClose: null,
            open: null,
            high: null,
            low: null,
            change: null,
            changePercent: null,
            bid: null,
            ask: null,
            timestamp: null,
            fetchedAt: null,
            source: 'GoldAPI (goldapi.io)',
            isCached: false,
            isStale: true,
            status: 'error',
            error:
              languageRef.current === 'fa'
                ? 'پاسخ API قیمت طلا دریافت نشد. لطفاً وضعیت سرور برنامه را بررسی کنید.'
                : 'Gold market API endpoint returned HTML instead of JSON. Please check server status.',
            disclaimer:
              'GoldAPI spot price is a reference market price and not the exact executable price of every broker.',
          }
        );
      }
    } catch {
      // keep previous cached market state
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const fetchApify = useCallback(async () => {
    try {
      const res = await fetch('/api/market/apify');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        setApify((await res.json()) as ApifyStatusPayload);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchNews = useCallback(
    async (forceRefresh = false, targetLang?: Language) => {
      setNewsLoading(true);
      try {
        const lang = targetLang || language;
        const query = new URLSearchParams({ lang });
        if (forceRefresh) query.set('refresh', '1');
        const res = await fetch(`/api/news?${query.toString()}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          setNews((await res.json()) as NewsFeedState);
        } else if (ct.includes('text/html')) {
          setNews({
            providerConfigured: true,
            providerName: 'NewsAPI',
            status: 'error',
            lastFetchedAt: null,
            error:
              lang === 'fa'
                ? 'سرویس /api/news پاسخ نامعتبر برگرداند. لطفاً وضعیت سرور بک‌اند را بررسی کنید.'
                : '/api/news returned HTML instead of JSON. Please verify the Node backend server is running.',
            items: [],
          });
        }
      } catch {
        // ignore
      } finally {
        setNewsLoading(false);
      }
    },
    [language]
  );

  const fetchSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/subscription/status', {
        headers: { 'x-client-id': user?.uid || getClientId() },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = (await res.json()) as {
          tier: SubscriptionTier;
          usedToday: number;
          dailyLimit: number;
          config: { freeDailyQuota: number; vipDailyQuota: number };
        };
        setTier(data.tier);
        setUsedToday(data.usedToday);
        setDailyLimit(data.dailyLimit);
        setFreeLimit(data.config.freeDailyQuota);
        setVipLimit(data.config.vipDailyQuota);
      }
    } catch {
      // ignore
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchGold(false);
    fetchApify();
    fetchSubscription();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchGold(false);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [fetchGold, fetchApify, fetchSubscription]);

  useEffect(() => {
    fetchNews(false, language);
  }, [fetchNews, language]);

  const newsRetryRef = useRef(false);
  useEffect(() => {
    if (
      activePage === 'news' &&
      language === 'fa' &&
      !newsLoading &&
      news?.items?.length &&
      !news.items.some((item) => Boolean(item.headlineFa)) &&
      !newsRetryRef.current
    ) {
      newsRetryRef.current = true;
      fetchNews(false, 'fa');
    }
    if (activePage !== 'news' || news?.items?.some((item) => Boolean(item.headlineFa))) {
      newsRetryRef.current = false;
    }
  }, [activePage, fetchNews, language, news, newsLoading]);

  const handleChangeLanguage = (nextLang: Language) => {
    setLanguage(nextLang);
    if (user?.uid) {
      void updateUserLanguagePreference(user.uid, nextLang).catch((err) => console.error(err));
    }
  };

  const handleToggleLanguage = () => {
    const nextLang: Language = language === 'fa' ? 'en' : 'fa';
    handleChangeLanguage(nextLang);
  };

  const handleAnalysisComplete = (report: AnalysisReport) => {
    const updatedLocal = saveReportToLocalHistory(report);
    if (user?.uid) {
      setHistory((prev) => [report, ...prev.filter((r) => r.id !== report.id)].slice(0, 50));
      void saveAnalysisToFirestore(user.uid, report).catch((err) => console.error(err));
    } else {
      setHistory(updatedLocal);
    }
    setSelectedReport(report);
    setActivePage('report');
    fetchSubscription();
    fetchGold(false);
  };

  const handleOpenReport = (report: AnalysisReport) => {
    setSelectedReport(report);
    setActivePage('report');
  };

  const handleDeleteReport = (id: string) => {
    const updatedLocal = deleteReportFromLocalHistory(id);
    if (user?.uid) {
      setHistory((prev) => {
        const next = prev.filter((r) => r.id !== id);
        if (selectedReport?.id === id) {
          setSelectedReport(next[0] || null);
        }
        return next;
      });
      void deleteAnalysisFromFirestore(user.uid, id).catch((err) => console.error(err));
    } else {
      setHistory(updatedLocal);
      if (selectedReport?.id === id) {
        setSelectedReport(updatedLocal[0] || null);
      }
    }
  };

  const effectiveTier: SubscriptionTier = tier === 'VIP' || user?.tier === 'VIP' ? 'VIP' : 'FREE';
  const effectiveDailyLimit = effectiveTier === 'VIP' ? vipLimit : dailyLimit;
  const remainingQuota = Math.max(0, effectiveDailyLimit - usedToday);

  return (
    <AppShell
      language={language}
      onToggleLanguage={handleToggleLanguage}
      activePage={activePage}
      onNavigate={setActivePage}
      market={market}
      tier={effectiveTier}
    >
      {activePage === 'home' && (
        <HomePage
          language={language}
          market={market}
          marketLoading={marketLoading}
          onRefreshMarket={() => fetchGold(true)}
          onNavigate={setActivePage}
        />
      )}

      {activePage === 'dashboard' && (
        <DashboardPage
          language={language}
          user={user}
          market={market}
          marketLoading={marketLoading}
          onRefreshMarket={() => fetchGold(true)}
          history={history}
          tier={effectiveTier}
          remainingQuota={remainingQuota}
          dailyLimit={effectiveDailyLimit}
          onOpenReport={handleOpenReport}
          onNavigate={setActivePage}
        />
      )}

      {activePage === 'analysis' && (
        <AnalysisPage
          language={language}
          onAnalysisComplete={handleAnalysisComplete}
        />
      )}

      {activePage === 'report' && (
        <AnalysisReportPage
          language={language}
          report={selectedReport}
          onNewAnalysis={() => setActivePage('analysis')}
          onSendViaGmail={(rep) => {
            setGmailPrefill({
              to: user?.email || '',
              subject:
                language === 'fa'
                  ? `گزارش تحلیل طلا XAUUSD — تصمیم: ${rep.decision}`
                  : `Aurum AI XAUUSD Report — Decision: ${rep.decision}`,
              bodyText: formatReportAsText(rep),
            });
            setActivePage('gmail');
          }}
        />
      )}

      {activePage === 'signals' && (
        <SignalsPage
          language={language}
          reports={history}
          onOpenReport={handleOpenReport}
          onStartAnalysis={() => setActivePage('analysis')}
        />
      )}

      {activePage === 'market' && (
        <MarketPage
          language={language}
          market={market}
          marketLoading={marketLoading}
          onRefreshMarket={() => fetchGold(true)}
          sessionTicks={sessionTicks}
          apify={apify}
          news={news}
          latestReport={history[0] || null}
        />
      )}

      {activePage === 'news' && (
        <NewsPage
          language={language}
          news={news}
          loading={newsLoading}
          onRefresh={() => fetchNews(true, language)}
        />
      )}

      {activePage === 'gmail' && (
        <GmailPage
          language={language}
          user={user}
          gmailToken={gmailToken}
          reports={history}
          prefillCompose={gmailPrefill}
          onClearPrefill={() => setGmailPrefill(null)}
          onGoogleConnected={(token) => setGmailToken(token)}
        />
      )}

      {activePage === 'history' && (
        <HistoryPage
          language={language}
          history={history}
          isAuthenticated={Boolean(user)}
          onOpenReport={handleOpenReport}
          onDeleteReport={handleDeleteReport}
        />
      )}

      {activePage === 'pricing' && (
        <PricingPage
          language={language}
          tier={effectiveTier}
          freeLimit={freeLimit}
          vipLimit={vipLimit}
          onNavigate={setActivePage}
        />
      )}

      {activePage === 'profile' && (
        <ProfilePage
          language={language}
          onChangeLanguage={handleChangeLanguage}
          user={user}
          authReady={authReady}
          authError={authError}
          onGoogleSignedIn={syncFirebaseUser}
          onClearAuthError={() => setAuthError(null)}
          tier={effectiveTier}
          usedToday={usedToday}
          dailyLimit={effectiveDailyLimit}
        />
      )}

      {activePage === 'admin' && (
        <AdminPage
          language={language}
          onSubscriptionChanged={fetchSubscription}
        />
      )}
    </AppShell>
  );
}
