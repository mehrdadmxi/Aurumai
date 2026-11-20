import { useState } from 'react';
import { CheckCircle2, Cloud, Loader2, LogOut, ShieldCheck, UserCheck } from 'lucide-react';
import type { AppUser, Language, SubscriptionTier } from '../types.ts';
import { getT } from '../i18n/translations.ts';
import {
  type FirebaseUser,
  signInWithGoogle,
  signInWithGoogleRedirect,
  signOutFirebase,
} from '../lib/firebase.ts';
import { formatFirebaseAuthError } from '../lib/firebaseAuthError.ts';

interface ProfilePageProps {
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  user: AppUser | null;
  authReady: boolean;
  authError?: string | null;
  onGoogleSignedIn?: (fbUser: FirebaseUser) => Promise<AppUser>;
  onClearAuthError?: () => void;
  tier: SubscriptionTier;
  usedToday: number;
  dailyLimit: number;
}

function GoogleLogoIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function ProfilePage({
  language,
  onChangeLanguage,
  user,
  authReady,
  authError,
  onGoogleSignedIn,
  onClearAuthError,
  tier,
  usedToday,
  dailyLimit,
}: ProfilePageProps) {
  const t = getT(language).profile;
  const [signingIn, setSigningIn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleError = error || authError || null;

  const handleGoogleLogin = async () => {
    setError(null);
    onClearAuthError?.();
    setSigningIn(true);
    try {
      const fbUser = await signInWithGoogle();
      if (onGoogleSignedIn) {
        await onGoogleSignedIn(fbUser);
      }
    } catch (err) {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
      setError(formatFirebaseAuthError(err, language, hostname));
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleRedirectLogin = async () => {
    setError(null);
    onClearAuthError?.();
    setRedirecting(true);
    try {
      await signInWithGoogleRedirect();
    } catch (err) {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
      setError(formatFirebaseAuthError(err, language, hostname));
      setRedirecting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    onClearAuthError?.();
    setSigningOut(true);
    try {
      await signOutFirebase();
    } catch {
      setError(
        language === 'fa' ? 'خطا هنگام خروج از حساب کاربری.' : 'Failed to sign out.'
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
      </div>

      <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-3 leading-relaxed">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
        <span>{t.firebaseActiveBanner}</span>
      </div>

      {/* Language & Quota Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="aurum-glass rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.languagePref}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeLanguage('fa')}
              className={`px-4 py-2 rounded-lg text-xs font-medium border ${
                language === 'fa'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#F3E5AB]'
                  : 'border-white/10 text-[#9A9891]'
              }`}
            >
              فارسی (RTL)
            </button>
            <button
              type="button"
              onClick={() => onChangeLanguage('en')}
              className={`px-4 py-2 rounded-lg text-xs font-medium border ${
                language === 'en'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#F3E5AB]'
                  : 'border-white/10 text-[#9A9891]'
              }`}
            >
              English (LTR)
            </button>
          </div>
        </section>

        <section className="aurum-glass rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-[#F3E5AB]">{t.quotaCard}</h2>
          <div className="text-lg font-bold font-mono-num text-[#F5F2EB]">
            {usedToday} <span className="text-xs font-normal text-[#9A9891]">{t.usedOf}</span>{' '}
            {dailyLimit}
          </div>
          <div className="text-xs text-[#9A9891]">
            Plan: <strong className="text-[#F3E5AB]">{tier}</strong>
          </div>
        </section>
      </div>

      {/* Firebase Auth Account Card */}
      {!authReady ? (
        <section className="aurum-glass rounded-xl p-6 text-xs text-[#9A9891]">
          {language === 'fa' ? 'در حال بررسی وضعیت احراز هویت Firebase...' : 'Checking Firebase Auth session...'}
        </section>
      ) : user ? (
        <section className="aurum-glass-strong rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.name}
                  className="w-11 h-11 rounded-full border border-[#D4AF37]/40 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center">
                  <UserCheck className="w-5 h-5 text-[#D4AF37]" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#F5F2EB]">{user.name}</h2>
                  {user.emailVerified && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t.verifiedBadge}</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#9A9891] font-mono-num">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-rose-500/35 text-rose-300 hover:bg-rose-950/40 transition-colors disabled:opacity-60"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.logoutBtn}</span>
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-300 pt-3 border-t border-white/10">
            <Cloud className="w-3.5 h-3.5 shrink-0" />
            <span>{t.cloudSyncLabel}</span>
          </div>
        </section>
      ) : (
        <section className="aurum-glass rounded-xl p-6 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-[#F3E5AB]">{t.signInTitle}</h2>
            <p className="text-xs text-[#9A9891] leading-relaxed">{t.signInDesc}</p>
          </div>

          {visibleError && (
            <p
              role="alert"
              className="text-xs text-rose-300 bg-rose-950/35 border border-rose-500/30 rounded-lg px-3.5 py-2.5 leading-relaxed"
            >
              {visibleError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={signingIn || redirecting}
              className="inline-flex items-center justify-center gap-3 px-6 py-3 rounded-xl text-xs font-semibold bg-[#F5F2EB] text-[#0B0C10] hover:bg-white transition-colors shadow-md disabled:opacity-60 cursor-pointer"
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#0B0C10]" />
              ) : (
                <GoogleLogoIcon />
              )}
              <span>{signingIn ? t.signingInBtn : t.googleSignInBtn}</span>
            </button>

            <button
              type="button"
              onClick={handleGoogleRedirectLogin}
              disabled={signingIn || redirecting}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors disabled:opacity-60 cursor-pointer"
            >
              {redirecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{redirecting ? t.redirectingBtn : t.googleRedirectBtn}</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
