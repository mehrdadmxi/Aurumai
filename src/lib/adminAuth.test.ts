import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAdminTokenFromHeaders,
  issueAdminSessionToken,
  verifyAdminCredentials,
  verifyAdminSessionToken,
} from './adminAuth.ts';

test('verifyAdminCredentials accepts default configured admin user/pass and rejects wrong values', async () => {
  assert.equal(await verifyAdminCredentials('mehrdadmxi', '09367113091mM@', {}), true);
  assert.equal(await verifyAdminCredentials('mehrdadmxi', 'wrong-pass', {}), false);
  assert.equal(await verifyAdminCredentials('otheruser', '09367113091mM@', {}), false);
  assert.equal(await verifyAdminCredentials('', '', {}), false);
});

test('verifyAdminCredentials respects explicit ADMIN_USERNAME and ADMIN_PASSWORD env overrides', async () => {
  const env = { ADMIN_USERNAME: 'customAdmin', ADMIN_PASSWORD: 'Secret!Password1' };
  assert.equal(await verifyAdminCredentials('customAdmin', 'Secret!Password1', env), true);
  assert.equal(await verifyAdminCredentials('mehrdadmxi', '09367113091mM@', env), false);
});

test('issueAdminSessionToken and verifyAdminSessionToken validate HMAC tokens and reject tampering or expiry', async () => {
  const env = {};
  const { token } = await issueAdminSessionToken('mehrdadmxi', env, 60_000);
  const validResult = await verifyAdminSessionToken(token, env);
  assert.equal(validResult.valid, true);
  assert.equal(validResult.username, 'mehrdadmxi');

  const tampered = `${token.slice(0, -4)}0000`;
  assert.equal((await verifyAdminSessionToken(tampered, env)).valid, false);

  const expired = await issueAdminSessionToken('mehrdadmxi', env, -1000);
  assert.equal((await verifyAdminSessionToken(expired.token, env)).valid, false);
});

test('extractAdminTokenFromHeaders reads Bearer and x-admin-token headers', () => {
  const h1 = new Headers({ Authorization: 'Bearer abc.123.def' });
  assert.equal(extractAdminTokenFromHeaders(h1), 'abc.123.def');

  const h2 = new Headers({ 'x-admin-token': 'xyz-token' });
  assert.equal(extractAdminTokenFromHeaders(h2), 'xyz-token');

  assert.equal(extractAdminTokenFromHeaders(new Headers()), null);
});
