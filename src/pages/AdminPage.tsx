import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, LogOut, RefreshCw, Shield, Upload } from 'lucide-react';
import type { AdminOverviewPayload, Language } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface AdminPageProps {
  language: Language;
  onSubscriptionChanged: () => void;
}

type AdminTab = 'overview' | 'users' | 'apis' | 'analyses' | 'config';

const ADMIN_TOKEN_STORAGE_KEY = 'aurum_admin_session_token';

function readStoredAdminToken(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveStoredAdminToken(token: string | null) {
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function AdminPage({ language, onSubscriptionChanged }: AdminPageProps) {
  const t = getT(language).admin;
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewPayload | null>(null);
  const [sessionToken, setSessionToken] = useState<string>(() => readStoredAdminToken());

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [freeQuota, setFreeQuota] = useState(3);
  const [vipQuota, setVipQuota] = useState(25);
  const [goldCacheSec, setGoldCacheSec] = useState(60);
  const [vipOverride, setVipOverride] = useState(false);

  const lockPanel = useCallback(() => {
    saveStoredAdminToken(null);
    setSessionToken('');
    setOverview(null);
    setPassword('');
    setStatusMsg(null);
    setErrorMsg(null);
  }, []);

  const buildHeaders = useCallback(
    (tokenOverride?: string): Record<string, string> => {
      const token = (tokenOverride ?? sessionToken).trim();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    },
    [sessionToken]
  );

  const loadOverview = useCallback(
    async (tokenOverride?: string) => {
      const activeToken = (tokenOverride ?? sessionToken).trim();
      if (!activeToken) return;

      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/admin/overview', {
          headers: buildHeaders(activeToken),
        });
        if (res.status === 401 || res.status === 403) {
          lockPanel();
          return;
        }
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as AdminOverviewPayload;
        setOverview(data);
        setFreeQuota(data.config.freeDailyQuota);
        setVipQuota(data.config.vipDailyQuota);
        setGoldCacheSec(data.config.goldCacheSeconds);
        setVipOverride(data.config.vipOverrideEnabled);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load admin overview.');
      } finally {
        setLoading(false);
      }
    },
    [buildHeaders, lockPanel, sessionToken]
  );

  useEffect(() => {
    if (sessionToken) {
      loadOverview(sessionToken);
    }
  }, [loadOverview, sessionToken]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!username.trim() || !password) {
      setAuthError(t.invalidCredentials);
      return;
    }

    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setAuthError(
          language === 'fa'
            ? 'مسیر /api/admin/login پاسخ JSON نداد. لطفاً مطمئن شوید Cloudflare Pages Functions فعال هستند.'
            : '/api/admin/login did not return JSON. Verify Cloudflare Pages Functions are active.'
        );
        return;
      }
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAuthError(t.invalidCredentials);
        return;
      }
      saveStoredAdminToken(data.token);
      setSessionToken(data.token);
      setPassword('');
      await loadOverview(data.token);
    } catch {
      setAuthError(t.invalidCredentials);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSaveConfig = async (overrideVip?: boolean) => {
    setStatusMsg(null);
    setErrorMsg(null);
    const nextVip = overrideVip !== undefined ? overrideVip : vipOverride;
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          freeDailyQuota: Number(freeQuota),
          vipDailyQuota: Number(vipQuota),
          goldCacheSeconds: Number(goldCacheSec),
          vipOverrideEnabled: nextVip,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        lockPanel();
        return;
      }
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Failed to update configuration.');
      }
      setVipOverride(nextVip);
      setStatusMsg(
        language === 'fa' ? 'تنظیمات سیستم با موفقیت ذخیره شد.' : 'System configuration saved.'
      );
      onSubscriptionChanged();
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save config.');
    }
  };

  const handleApifySync = async () => {
    setStatusMsg(null);
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/apify/sync', {
        method: 'POST',
        headers: buildHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        lockPanel();
        return;
      }
      const data = (await res.json()) as { lastError?: string; supplementarySummary?: string };
      if (data.lastError) {
        setErrorMsg(data.lastError);
      } else {
        setStatusMsg(data.supplementarySummary || 'Apify sync completed.');
      }
      await loadOverview();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Apify sync failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleJsonUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/apify/urls', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ rawJson: text }),
      });
      if (res.status === 401 || res.status === 403) {
        lockPanel();
        return;
      }
      const data = (await res.json()) as { ok?: boolean; count?: number; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse JSON file.');
      }
      setStatusMsg(
        language === 'fa'
          ? `${data.count} آدرس معتبر XAUUSD بارگذاری شد (آدرس‌های BTCUSD حذف شدند).`
          : `Loaded ${data.count} XAUUSD TradingView URLs (BTCUSD URLs ignored).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid JSON upload.');
    } finally {
      e.target.value = '';
    }
  };

  if (!sessionToken) {
    return (
      <div className="max-w-md mx-auto py-8">
        <div className="aurum-glass rounded-2xl p-7 border border-[#D4AF37]/25 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#F5F2EB]">{t.loginTitle}</h1>
              <p className="text-xs text-[#9A9891] mt-0.5">{t.title}</p>
            </div>
          </div>

          <p className="text-xs text-[#9A9891] leading-relaxed">{t.loginSubtitle}</p>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/35 text-xs text-rose-200">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="admin-username" className="block text-xs font-medium text-[#D6D3CB]">
                {t.usernameLabel}
              </label>
              <input
                id="admin-username"
                type="text"
                dir="ltr"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 focus:border-[#D4AF37]/60 focus:outline-none text-sm text-[#F5F2EB]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="block text-xs font-medium text-[#D6D3CB]">
                {t.passwordLabel}
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-black/50 border border-white/15 focus:border-[#D4AF37]/60 focus:outline-none text-sm text-[#F5F2EB]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-2.5 flex items-center text-[#9A9891] hover:text-[#F5F2EB]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full aurum-gold-btn py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Shield className="w-4 h-4" />
              <span>{authSubmitting ? t.loggingInBtn : t.loginBtn}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: t.tabOverview },
    { id: 'users', label: t.tabUsers },
    { id: 'apis', label: t.tabApis },
    { id: 'analyses', label: t.tabAnalyses },
    { id: 'config', label: t.tabConfig },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-[#D4AF37]" />
          <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadOverview()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{language === 'fa' ? 'بروزرسانی' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            onClick={lockPanel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-rose-500/35 text-rose-300 hover:bg-rose-950/35"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t.lockBtn}</span>
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
        {t.systemBanner}
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/35 border border-emerald-500/35 text-xs text-emerald-200">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-950/35 border border-rose-500/35 text-xs text-rose-200">
          <p>{errorMsg}</p>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#0D0E12] border border-[#D4AF37]/20 w-fit">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              tab === item.id
                ? 'bg-[#D4AF37]/20 text-[#F3E5AB]'
                : 'text-[#9A9891] hover:text-[#F5F2EB]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && overview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="aurum-glass rounded-xl p-5">
            <div className="text-xs text-[#9A9891]">{t.totalUsers}</div>
            <div className="text-xl font-bold font-mono-num text-[#F5F2EB] mt-2">
              {overview.stats.totalRegisteredUsers ?? 'Firebase Auth'}
            </div>
          </div>
          <div className="aurum-glass rounded-xl p-5">
            <div className="text-xs text-[#9A9891]">{t.activeVip}</div>
            <div className="text-xl font-bold font-mono-num text-[#F3E5AB] mt-2">
              {overview.stats.activeVipUsers ?? (vipOverride ? 'VIP Active' : 'Standard')}
            </div>
          </div>
          <div className="aurum-glass rounded-xl p-5">
            <div className="text-xs text-[#9A9891]">{t.totalAnalyses}</div>
            <div className="text-xl font-bold font-mono-num text-[#F5F2EB] mt-2">
              {overview.stats.totalAnalyses}
            </div>
          </div>
          <div className="aurum-glass rounded-xl p-5">
            <div className="text-xs text-[#9A9891]">{t.successAnalyses}</div>
            <div className="text-xl font-bold font-mono-num text-emerald-400 mt-2">
              {overview.stats.successfulAnalyses}
            </div>
          </div>
          <div className="aurum-glass rounded-xl p-5">
            <div className="text-xs text-[#9A9891]">{t.failedAnalyses}</div>
            <div className="text-xl font-bold font-mono-num text-rose-400 mt-2">
              {overview.stats.failedAnalyses}
            </div>
          </div>
        </div>
      )}

      {/* User Management Tab */}
      {tab === 'users' && (
        <section className="aurum-glass rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#F3E5AB]">{t.tabUsers}</h2>
          <p className="text-xs text-[#9A9891]">
            {language === 'fa'
              ? 'احراز هویت Firebase Authentication و ذخیره‌سازی ابری Cloud Firestore فعال هستند. در پایین می‌توانید وضعیت سهمیه VIP سرور را برای همه نشست‌ها کنترل کنید.'
              : 'Firebase Authentication and Cloud Firestore persistence are active. You can toggle the system VIP quota override below.'}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/10">
            <div>
              <div className="text-sm font-medium text-[#F5F2EB]">{t.vipToggleLabel}</div>
              <div className="text-xs text-[#9A9891] font-mono-num mt-0.5">
                Active Tier: {vipOverride ? 'VIP' : 'FREE'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSaveConfig(!vipOverride)}
              className={`px-5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                vipOverride
                  ? 'border border-rose-500/40 text-rose-300 hover:bg-rose-950/40'
                  : 'aurum-gold-btn'
              }`}
            >
              {vipOverride
                ? language === 'fa'
                  ? 'غیرفعال‌سازی VIP سیستم'
                  : 'Deactivate System VIP'
                : language === 'fa'
                  ? 'فعال‌سازی VIP سیستم'
                  : 'Activate System VIP'}
            </button>
          </div>
        </section>
      )}

      {/* APIs Tab */}
      {tab === 'apis' && overview && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overview.apis.map((api) => (
              <article key={api.name} className="aurum-glass rounded-xl p-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-[#F3E5AB]">{api.name}</h2>
                  <span
                    className={`text-xs font-mono-num font-semibold uppercase ${
                      api.status === 'connected'
                        ? 'text-emerald-400'
                        : api.status === 'error'
                          ? 'text-amber-400'
                          : 'text-[#9A9891]'
                    }`}
                  >
                    {api.status}
                  </span>
                </div>
                <div className="text-xs text-[#9A9891] font-mono-num">
                  Credential: <span className="text-[#F5F2EB]">{api.maskedKey}</span>
                </div>
                <div className="text-xs text-[#9A9891] font-mono-num">
                  Last Success:{' '}
                  {api.lastSuccessfulRequest
                    ? new Date(api.lastSuccessfulRequest).toLocaleString()
                    : 'Never'}
                </div>
                {api.lastError && (
                  <p className="text-xs text-amber-300 bg-amber-950/30 p-2.5 rounded-lg border border-amber-500/20">
                    {api.lastError}
                  </p>
                )}
              </article>
            ))}
          </div>

          <button
            type="button"
            onClick={handleApifySync}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10"
          >
            {language === 'fa'
              ? 'اجرای بررسی اسکیما و همگام‌سازی Apify'
              : 'Sync Apify TradingView Actor'}
          </button>
        </section>
      )}

      {/* Analyses Tab */}
      {tab === 'analyses' && overview && (
        <section className="aurum-glass rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-[#F3E5AB]">{t.tabAnalyses}</h2>
          {overview.recentAnalyses.length === 0 ? (
            <p className="text-sm text-[#9A9891]">
              {language === 'fa' ? 'هنوز درخواستی در سرور ثبت نشده است.' : 'No server analysis executions logged yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[#9A9891]">
                    <th className="py-2 text-start">ID</th>
                    <th className="py-2 text-start">Time</th>
                    <th className="py-2 text-start">Decision</th>
                    <th className="py-2 text-start">Status</th>
                    <th className="py-2 text-start">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentAnalyses.map((log) => (
                    <tr key={log.id} className="border-b border-white/5">
                      <td className="py-2.5 font-mono-num text-[#F3E5AB]">{log.id}</td>
                      <td className="py-2.5 font-mono-num text-[#9A9891]">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 font-semibold">{log.decision}</td>
                      <td className="py-2.5">{log.status}</td>
                      <td className="py-2.5 text-rose-300">{log.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* System Config & JSON Upload Tab */}
      {tab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="aurum-glass rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#F3E5AB]">{t.tabConfig}</h2>
            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="cfg-free" className="block text-[#9A9891] mb-1">
                  Free Daily Quota
                </label>
                <input
                  id="cfg-free"
                  type="number"
                  min={1}
                  max={100}
                  value={freeQuota}
                  onChange={(e) => setFreeQuota(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/15 font-mono-num text-[#F5F2EB]"
                />
              </div>
              <div>
                <label htmlFor="cfg-vip" className="block text-[#9A9891] mb-1">
                  VIP Daily Quota
                </label>
                <input
                  id="cfg-vip"
                  type="number"
                  min={1}
                  max={500}
                  value={vipQuota}
                  onChange={(e) => setVipQuota(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/15 font-mono-num text-[#F5F2EB]"
                />
              </div>
              <div>
                <label htmlFor="cfg-cache" className="block text-[#9A9891] mb-1">
                  GoldAPI Cache Refresh Interval (seconds)
                </label>
                <input
                  id="cfg-cache"
                  type="number"
                  min={15}
                  max={3600}
                  value={goldCacheSec}
                  onChange={(e) => setGoldCacheSec(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/15 font-mono-num text-[#F5F2EB]"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSaveConfig()}
                className="aurum-gold-btn px-5 py-2.5 rounded-xl text-xs font-semibold"
              >
                {t.saveConfigBtn}
              </button>
            </div>
          </section>

          <section className="aurum-glass rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#F3E5AB]">{t.uploadJsonTitle}</h2>
            <p className="text-xs text-[#9A9891] leading-relaxed">{t.uploadJsonSub}</p>
            <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold border border-[#D4AF37]/40 text-[#F3E5AB] hover:bg-[#D4AF37]/10 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>{t.uploadJsonBtn}</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleJsonUpload}
                className="sr-only"
              />
            </label>
          </section>
        </div>
      )}
    </div>
  );
}
