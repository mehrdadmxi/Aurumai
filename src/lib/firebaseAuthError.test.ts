import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFirebaseAuthError } from './firebaseAuthError.ts';

test('formatFirebaseAuthError includes hostname for auth/unauthorized-domain', () => {
  const fa = formatFirebaseAuthError(
    { code: 'auth/unauthorized-domain', message: 'Firebase: Error (auth/unauthorized-domain).' },
    'fa',
    'aurumai-73x.pages.dev'
  );
  assert.match(fa, /aurumai-73x\.pages\.dev/);
  assert.match(fa, /auth\/unauthorized-domain/);

  const en = formatFirebaseAuthError(
    { code: 'auth/unauthorized-domain' },
    'en',
    'example.com'
  );
  assert.match(en, /example\.com/);
  assert.match(en, /Authorized domains/);
});

test('formatFirebaseAuthError translates auth/operation-not-allowed and popup errors cleanly', () => {
  const disabledMsg = formatFirebaseAuthError({ code: 'auth/operation-not-allowed' }, 'fa');
  assert.match(disabledMsg, /auth\/operation-not-allowed/);
  assert.match(disabledMsg, /Sign-in method/);

  const blockedMsg = formatFirebaseAuthError(new Error('Firebase: Error (auth/popup-blocked).'), 'en');
  assert.match(blockedMsg, /allow popups/i);

  const closedMsg = formatFirebaseAuthError({ code: 'auth/popup-closed-by-user' }, 'fa');
  assert.match(closedMsg, /بسته شد/);

  const cancelledMsg = formatFirebaseAuthError({ code: 'auth/cancelled-popup-request' }, 'en');
  assert.match(cancelledMsg, /cancelled/i);
});

test('formatFirebaseAuthError detects Firestore permission-denied wrapped in JSON error', () => {
  const wrapped = new Error(
    JSON.stringify({
      error: '7 PERMISSION_DENIED: Missing or insufficient permissions.',
      operationType: 'create',
      path: 'users/abc',
    })
  );
  const msg = formatFirebaseAuthError(wrapped, 'fa');
  assert.match(msg, /permission-denied/);
  assert.match(msg, /Cloud Firestore/);
});

test('formatFirebaseAuthError handles web-storage-unsupported and internal-error', () => {
  const storageErr = formatFirebaseAuthError({ code: 'auth/web-storage-unsupported' }, 'fa');
  assert.match(storageErr, /auth\/web-storage-unsupported/);
  assert.match(storageErr, /تب جدید/);

  const internalErr = formatFirebaseAuthError({ code: 'auth/internal-error' }, 'en');
  assert.match(internalErr, /auth\/internal-error/);
  assert.match(internalErr, /try again/i);
});

test('formatFirebaseAuthError preserves unknown error code in fallback message', () => {
  const msg = formatFirebaseAuthError({ code: 'auth/user-disabled' }, 'en');
  assert.match(msg, /auth\/user-disabled/);
});
