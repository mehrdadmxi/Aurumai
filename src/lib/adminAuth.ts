const DEFAULT_ADMIN_USER_HASH =
  '8ca5f73cc3b384b6e2585d527cc5ca3a618cec51075d30df7026b33f5220666e';
const DEFAULT_ADMIN_PASS_HASH =
  '602e5691a815434ab897732898b68507d1ad0d4a042e44b0de78f2b208307c2a';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AdminEnvLike {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SECRET?: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getSigningSecret(env: AdminEnvLike): string {
  return (
    env.ADMIN_SECRET?.trim() ||
    env.ADMIN_PASSWORD?.trim() ||
    `aurum-hmac-${DEFAULT_ADMIN_PASS_HASH}`
  );
}

async function isValidUsername(username: string, env: AdminEnvLike): Promise<boolean> {
  const cleanUser = username.trim();
  if (!cleanUser) return false;
  const configuredUser = env.ADMIN_USERNAME?.trim();
  if (configuredUser) {
    return constantTimeEqual(cleanUser, configuredUser);
  }
  const hash = await sha256Hex(cleanUser);
  return constantTimeEqual(hash, DEFAULT_ADMIN_USER_HASH);
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
  env: AdminEnvLike
): Promise<boolean> {
  if (!username || !password) return false;
  if (!(await isValidUsername(username, env))) return false;

  const configuredPassword = env.ADMIN_PASSWORD?.trim();
  if (configuredPassword) {
    return constantTimeEqual(password, configuredPassword);
  }

  const passHash = await sha256Hex(password);
  if (constantTimeEqual(passHash, DEFAULT_ADMIN_PASS_HASH)) {
    return true;
  }

  const configuredSecret = env.ADMIN_SECRET?.trim();
  if (configuredSecret && constantTimeEqual(password, configuredSecret)) {
    return true;
  }

  return false;
}

export async function issueAdminSessionToken(
  username: string,
  env: AdminEnvLike,
  ttlMs = SESSION_TTL_MS
): Promise<{ token: string; expiresAt: number }> {
  const cleanUser = username.trim();
  const expiresAt = Date.now() + ttlMs;
  const payload = `${cleanUser}|${expiresAt}`;
  const sigHex = await hmacSha256Hex(getSigningSecret(env), payload);
  const encodedUser = btoa(unescape(encodeURIComponent(cleanUser)));
  return {
    token: `${encodedUser}.${expiresAt}.${sigHex}`,
    expiresAt,
  };
}

export async function verifyAdminSessionToken(
  token: string | undefined | null,
  env: AdminEnvLike
): Promise<{ valid: boolean; username?: string }> {
  const raw = token?.trim();
  if (!raw) return { valid: false };

  const configuredSecret = env.ADMIN_SECRET?.trim();
  if (configuredSecret && constantTimeEqual(raw, configuredSecret)) {
    return { valid: true, username: env.ADMIN_USERNAME?.trim() || 'admin' };
  }

  const parts = raw.split('.');
  if (parts.length !== 3) return { valid: false };
  const [encodedUser, expStr, sigHex] = parts;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { valid: false };
  }

  let username = '';
  try {
    username = decodeURIComponent(escape(atob(encodedUser)));
  } catch {
    return { valid: false };
  }

  if (!(await isValidUsername(username, env))) {
    return { valid: false };
  }

  const expectedSig = await hmacSha256Hex(
    getSigningSecret(env),
    `${username}|${expiresAt}`
  );
  if (!constantTimeEqual(sigHex, expectedSig)) {
    return { valid: false };
  }

  return { valid: true, username };
}

export function extractAdminTokenFromHeaders(
  headers: Headers | { get?: (name: string) => string | null } | Record<string, string | undefined>
): string | null {
  let authHeader: string | null | undefined;
  let adminTokenHeader: string | null | undefined;

  if (typeof (headers as Headers).get === 'function') {
    const h = headers as Headers;
    authHeader = h.get('authorization');
    adminTokenHeader = h.get('x-admin-token');
  } else {
    const rec = headers as Record<string, string | undefined>;
    authHeader = rec.authorization || rec.Authorization;
    adminTokenHeader = rec['x-admin-token'] || rec['X-Admin-Token'];
  }

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return adminTokenHeader?.trim() || null;
}
