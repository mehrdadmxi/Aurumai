import type { Language } from '../types.ts';

function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') {
    if (typeof err === 'string') {
      const m = err.match(
        /auth\/[a-z0-9-]+|permission-denied|unavailable|failed-precondition|redirect_uri_mismatch/i
      );
      return m ? m[0].toLowerCase() : null;
    }
    return null;
  }

  const record = err as { code?: unknown; message?: unknown };
  if (typeof record.code === 'string' && record.code.trim()) {
    return record.code.trim().toLowerCase();
  }

  if (typeof record.message === 'string') {
    // Check if wrapped JSON from handleFirestoreError
    try {
      const parsed = JSON.parse(record.message) as { error?: unknown };
      if (typeof parsed.error === 'string') {
        const innerMatch = parsed.error.match(
          /auth\/[a-z0-9-]+|permission-denied|unavailable|failed-precondition|redirect_uri_mismatch/i
        );
        if (innerMatch) return innerMatch[0].toLowerCase();
        if (parsed.error.toLowerCase().includes('missing or insufficient permissions')) {
          return 'permission-denied';
        }
      }
    } catch {
      // Not JSON
    }

    const msgMatch = record.message.match(
      /auth\/[a-z0-9-]+|permission-denied|unavailable|failed-precondition|redirect_uri_mismatch/i
    );
    if (msgMatch) return msgMatch[0].toLowerCase();
    if (record.message.toLowerCase().includes('missing or insufficient permissions')) {
      return 'permission-denied';
    }
  }

  return null;
}

export function formatFirebaseAuthError(
  err: unknown,
  language: Language,
  hostname?: string,
  authDomain?: string
): string {
  const code = extractErrorCode(err);
  const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const safeHost = (hostname || '').trim() || 'current-domain';
  const effectiveAuthDomain = (authDomain || '').trim() || safeHost;
  const expectedRedirectUri = `https://${effectiveAuthDomain}/__/auth/handler`;

  if (code === 'redirect_uri_mismatch') {
    return language === 'fa'
      ? `آدرس بازگشت OAuth در Google Cloud Console ثبت نشده است (redirect_uri_mismatch). لطفاً نشانی ${expectedRedirectUri} را در بخش Authorized redirect URIs و نشانی https://${safeHost} را در Authorized JavaScript origins اضافه کنید.`
      : `OAuth redirect URI mismatch. Add ${expectedRedirectUri} to Authorized redirect URIs and https://${safeHost} to Authorized JavaScript origins in Google Cloud Console.`;
  }

  if (code === 'auth/popup-closed-by-user') {
    return language === 'fa'
      ? 'پنجره ورود گوگل قبل از تکمیل بسته شد. لطفاً دوباره روی دکمه ورود کلیک کنید.'
      : 'Google sign-in popup was closed before completing. Please try again.';
  }

  if (code === 'auth/popup-blocked') {
    return language === 'fa'
      ? 'مرورگر پنجره بازشو (Popup) را مسدود کرده است. لطفاً اجازه باز شدن Popup را بدهید یا از دکمه «باز کردن در تب جدید» استفاده کنید.'
      : 'Browser blocked the sign-in popup. Please allow popups for this site or open the app in a new tab.';
  }

  if (code === 'auth/cancelled-popup-request') {
    return language === 'fa'
      ? 'درخواست پنجره ورود به دلیل باز شدن هم‌زمان پنجره دیگر لغو شد. لطفاً دوباره کلیک کنید.'
      : 'A previous popup request was cancelled. Please click Sign in with Google again.';
  }

  if (code === 'auth/unauthorized-domain') {
    return language === 'fa'
      ? `دامنه فعلی (${safeHost}) در فهرست دامنه‌های مجاز Firebase Authentication ثبت نشده است (auth/unauthorized-domain). در Firebase Console → Authentication → Settings → Authorized domains این دامنه را اضافه کنید.`
      : `Current domain (${safeHost}) is not listed under Authorized domains in Firebase Authentication (auth/unauthorized-domain). Add it in Firebase Console → Authentication → Settings → Authorized domains.`;
  }

  if (code === 'auth/operation-not-allowed') {
    return language === 'fa'
      ? 'ورود با حساب گوگل در پروژه Firebase فعال نشده است (auth/operation-not-allowed). لطفاً در Firebase Console → Authentication → Sign-in method گزینه Google را فعال کنید.'
      : 'Google Sign-In provider is disabled in Firebase Auth (auth/operation-not-allowed). Enable Google under Authentication → Sign-in method in Firebase Console.';
  }

  if (code === 'auth/operation-not-supported-in-this-environment') {
    return language === 'fa'
      ? 'مرورگر یا قاب پیش‌نمایش فعلی از این روش ورود پشتیبانی نمی‌کند (auth/operation-not-supported-in-this-environment). لطفاً صفحه را در یک تب جدید مرورگر باز کرده و دوباره وارد شوید.'
      : 'Current embedded browser frame does not support this auth flow (auth/operation-not-supported-in-this-environment). Please open the app in a new tab and retry.';
  }

  if (code === 'auth/network-request-failed') {
    return language === 'fa'
      ? 'خطای شبکه هنگام اتصال به سرورهای احراز هویت گوگل و Firebase (auth/network-request-failed). لطفاً اتصال اینترنت یا فیلترشکن خود را بررسی کرده و دوباره تلاش کنید.'
      : 'Network error while connecting to Google/Firebase Authentication (auth/network-request-failed). Check your internet connection and retry.';
  }

  if (code === 'auth/account-exists-with-different-credential') {
    return language === 'fa'
      ? 'حسابی با همین ایمیل قبلاً با روش دیگری ثبت شده است (auth/account-exists-with-different-credential).'
      : 'An account already exists with the same email using a different sign-in provider.';
  }

  if (code === 'auth/invalid-api-key') {
    return language === 'fa'
      ? 'کلید پیکربندی Firebase API نامعتبر است (auth/invalid-api-key). لطفاً فایل پیکربندی Firebase پروژه را بررسی کنید.'
      : 'Invalid Firebase API key configuration (auth/invalid-api-key). Please verify your Firebase project config.';
  }

  if (code === 'auth/web-storage-unsupported') {
    return language === 'fa'
      ? 'مرورگر شما ذخیره کوکی یا حافظه شخص‌ثالث را در حالت فعلی مسدود کرده است (auth/web-storage-unsupported). لطفاً سایت را مستقیم در تب جدید باز کنید تا ورود گوگل انجام شود.'
      : 'Third-party browser storage is blocked or unsupported in this frame (auth/web-storage-unsupported). Please open the app directly in a new tab to sign in.';
  }

  if (code === 'auth/internal-error' || code === 'auth/invalid-credential') {
    return language === 'fa'
      ? `خطای داخلی ارتباط با سرویس احراز هویت گوگل/فایربیس (${code}). لطفاً دسترسی شبکه به Google/Firebase را بررسی کرده و دوباره تلاش کنید.`
      : `Internal Google/Firebase authentication error (${code}). Please check network access to Google/Firebase and try again.`;
  }

  if (code === 'permission-denied') {
    return language === 'fa'
      ? 'ورود گوگل با موفقیت انجام شد، اما دسترسی همگام‌سازی پروفایل در Cloud Firestore تایید نشد (permission-denied). از تایید ایمیل حساب گوگل و انتشار قوانین Firestore اطمینان حاصل کنید.'
      : 'Google sign-in succeeded, but Cloud Firestore profile sync was denied (permission-denied). Verify email verification status and deployed Firestore rules.';
  }

  if (code === 'unavailable' || rawMessage.toLowerCase().includes('the client is offline')) {
    return language === 'fa'
      ? 'اتصال به سرورهای Cloud Firestore برقرار نشد (آفلاین/در دسترس نیست). لطفاً اینترنت خود را بررسی کرده و دوباره تلاش کنید.'
      : 'Could not reach Cloud Firestore servers (client offline/unavailable). Please check your connection and retry.';
  }

  const codeSuffix = code ? ` (${code})` : '';
  return language === 'fa'
    ? `خطا در احراز هویت گوگل / Firebase${codeSuffix}. لطفاً دوباره تلاش کنید یا تنظیمات Firebase Auth را بررسی نمایید.`
    : `Failed to complete Google Firebase Authentication${codeSuffix}. Please retry or check your Firebase Auth configuration.`;
}
