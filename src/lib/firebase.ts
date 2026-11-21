import { initializeApp } from 'firebase/app';
import {
  type Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Unsubscribe,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { resolveFirebaseAuthDomain } from './tradingRules.ts';
import type { AnalysisReport, AppUser, Language, SubscriptionTier } from '../types.ts';

export const resolvedFirebaseAuthDomain = resolveFirebaseAuthDomain({
  hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
  configuredAuthDomain: firebaseConfig.authDomain,
  envAuthDomain:
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FIREBASE_AUTH_DOMAIN
      : undefined,
});

const app = initializeApp({
  ...firebaseConfig,
  authDomain: resolvedFirebaseAuthDomain,
});

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

function initPersistentAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = initPersistentAuth();
auth.useDeviceLanguage();

export const GMAIL_SCOPES: string[] = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
];

// Strictly in-memory OAuth access token cache (never stored in localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

function setCachedAccessToken(token: string | null): void {
  cachedAccessToken = token;
  for (const listener of tokenListeners) {
    listener(token);
  }
}

export function getGmailAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGmailAccessToken(): void {
  setCachedAccessToken(null);
}

export function subscribeGmailAccessToken(
  listener: (token: string | null) => void
): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

// Proactively initialize browserPopupRedirectResolver and preserve any redirect result/error
// returned after signInWithRedirect on strict/mobile browsers.
const pendingRedirectPromise: Promise<{ user: FirebaseUser | null; error: unknown | null }> =
  typeof window !== 'undefined'
    ? getRedirectResult(auth, browserPopupRedirectResolver)
        .then((res) => {
          if (res) {
            const cred = GoogleAuthProvider.credentialFromResult(res);
            if (cred?.accessToken) {
              setCachedAccessToken(cred.accessToken);
            }
          }
          return { user: res?.user ?? null, error: null };
        })
        .catch((err) => ({ user: null, error: err }))
    : Promise.resolve({ user: null, error: null });

export async function resolvePendingGoogleRedirect(): Promise<{
  user: FirebaseUser | null;
  error: unknown | null;
}> {
  return pendingRedirectPromise;
}

export type { FirebaseUser };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function clampStr(value: string | null | undefined, maxLen: number, fallback = ''): string {
  const raw = (value ?? fallback).trim();
  if (!raw) return fallback;
  return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  return cleaned || `aurum-${Date.now()}`;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function createGoogleProvider(includeGmailScopes = false, loginHint?: string | null): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');
  if (includeGmailScopes) {
    for (const scope of GMAIL_SCOPES) {
      provider.addScope(scope);
    }
  }
  const params: Record<string, string> = { prompt: 'select_account' };
  if (loginHint && loginHint.trim()) {
    params.login_hint = loginHint.trim();
  }
  provider.setCustomParameters(params);
  return provider;
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  const result = await signInWithPopup(
    auth,
    createGoogleProvider(false),
    browserPopupRedirectResolver
  );
  return result.user;
}

export async function connectGmailWithGoogle(): Promise<{
  user: FirebaseUser;
  accessToken: string;
}> {
  const result = await signInWithPopup(
    auth,
    createGoogleProvider(true, auth.currentUser?.email),
    browserPopupRedirectResolver
  );
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Failed to obtain Google OAuth access token for Gmail.');
  }
  setCachedAccessToken(credential.accessToken);
  return { user: result.user, accessToken: credential.accessToken };
}

export async function signInWithGoogleRedirect(): Promise<void> {
  await signInWithRedirect(auth, createGoogleProvider(false), browserPopupRedirectResolver);
}

export function buildFallbackAppUser(
  fbUser: FirebaseUser,
  preferredLanguage: Language
): AppUser {
  const uid = fbUser.uid;
  const email = clampStr(fbUser.email, 200, `${uid}@users.aurum.local`);
  const displayName = clampStr(
    fbUser.displayName || email.split('@')[0],
    120,
    'Trader'
  );
  const photoURL = fbUser.photoURL ? clampStr(fbUser.photoURL, 500) : undefined;
  return {
    id: uid,
    uid,
    name: displayName,
    email,
    ...(photoURL ? { photoURL } : {}),
    emailVerified: Boolean(fbUser.emailVerified),
    tier: 'FREE',
    createdAt: new Date().toISOString(),
    language: preferredLanguage,
    authProvider: 'firebase',
  };
}

export async function signOutFirebase(): Promise<void> {
  setCachedAccessToken(null);
  await signOut(auth);
}

export function subscribeAuthState(
  callback: (firebaseUser: FirebaseUser | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, (fbUser) => {
    if (!fbUser) {
      setCachedAccessToken(null);
    }
    callback(fbUser);
  });
}

export async function ensureUserProfile(
  fbUser: FirebaseUser,
  preferredLanguage: Language
): Promise<AppUser> {
  const uid = fbUser.uid;
  const userPath = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  const email = clampStr(fbUser.email, 200, `${uid}@users.aurum.local`);
  const displayName = clampStr(
    fbUser.displayName || email.split('@')[0],
    120,
    'Trader'
  );
  const photoURL = fbUser.photoURL ? clampStr(fbUser.photoURL, 500) : undefined;

  let existingTier: SubscriptionTier = 'FREE';
  let createdIso = new Date().toISOString();
  let existingLang: Language = preferredLanguage;

  let docExists = false;
  let storedData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      docExists = true;
      const data = snap.data() as Record<string, unknown>;
      storedData = data;
      if (data.tier === 'VIP' || data.tier === 'FREE') {
        existingTier = data.tier;
      }
      if (data.language === 'fa' || data.language === 'en') {
        existingLang = data.language;
      }
      if (data.createdAt && typeof (data.createdAt as { toDate?: () => Date }).toDate === 'function') {
        createdIso = (data.createdAt as { toDate: () => Date }).toDate().toISOString();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!docExists) {
    try {
      const createPayload: Record<string, unknown> = {
        uid,
        displayName,
        email,
        tier: 'FREE',
        language: preferredLanguage,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) createPayload.photoURL = photoURL;
      await setDoc(ref, createPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  } else {
    const needsProfileUpdate =
      !storedData ||
      storedData.displayName !== displayName ||
      storedData.email !== email ||
      storedData.language !== existingLang ||
      (Boolean(photoURL) && storedData.photoURL !== photoURL);

    if (needsProfileUpdate) {
      try {
        const updatePayload: Record<string, unknown> = {
          displayName,
          email,
          language: existingLang,
          updatedAt: serverTimestamp(),
        };
        if (photoURL) updatePayload.photoURL = photoURL;
        await updateDoc(ref, updatePayload);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    }
  }

  return {
    id: uid,
    uid,
    name: displayName,
    email,
    ...(photoURL ? { photoURL } : {}),
    emailVerified: Boolean(fbUser.emailVerified),
    tier: existingTier,
    createdAt: createdIso,
    language: existingLang,
    authProvider: 'firebase',
  };
}

export async function updateUserLanguagePreference(
  uid: string,
  language: Language
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      language,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveAnalysisToFirestore(
  uid: string,
  report: AnalysisReport
): Promise<void> {
  const safeId = sanitizeDocId(report.id);
  const path = `users/${uid}/analyses/${safeId}`;
  const cleanReport = stripUndefinedDeep({ ...report, id: safeId });
  const summaryText = clampStr(report.detailedExplanation?.decisionReason, 4000, report.marketDirection);

  try {
    await setDoc(doc(db, 'users', uid, 'analyses', safeId), {
      id: safeId,
      userId: uid,
      symbol: 'XAUUSD',
      language: report.language === 'en' ? 'en' : 'fa',
      decision: report.decision,
      signalStatus: clampStr(report.signalStatus, 32, 'ACTIVE'),
      analysisStatus: report.analysisStatus,
      createdAt: clampStr(report.createdAt, 40, new Date().toISOString()),
      serverCreatedAt: serverTimestamp(),
      ...(summaryText ? { summary: summaryText } : {}),
      reportPayload: cleanReport,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteAnalysisFromFirestore(
  uid: string,
  analysisId: string
): Promise<void> {
  const safeId = sanitizeDocId(analysisId);
  const path = `users/${uid}/analyses/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'analyses', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserAnalyses(
  uid: string,
  onData: (reports: AnalysisReport[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colPath = `users/${uid}/analyses`;
  const q = query(
    collection(db, 'users', uid, 'analyses'),
    where('userId', '==', uid),
    limit(100)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AnalysisReport[] = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data() as { reportPayload?: AnalysisReport };
        if (data?.reportPayload && typeof data.reportPayload === 'object') {
          items.push(data.reportPayload);
        }
      }
      items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items.slice(0, 50));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (wrapped) {
        if (onError) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    }
  );
}
