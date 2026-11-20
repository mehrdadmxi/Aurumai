import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rulesText = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('firestore.rules includes default-deny catch-all, rules_version 2, and email_verified checks', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2'/);
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /isValidId\(id\)/);
});

test('firestore.rules enforces PII isolation, tier anti-escalation, and list query filtering without get/exists in list', () => {
  assert.match(rulesText, /allow get: if isValidId\(userId\) && \(isOwner\(userId\) \|\| isAdmin\(\)\);/);
  assert.match(rulesText, /incoming\(\)\.tier == 'FREE'/);
  assert.match(rulesText, /incoming\(\)\.tier == existing\(\)\.tier/);
  assert.match(rulesText, /allow list: if isSignedIn\(\) && userId == request\.auth\.uid && resource\.data\.userId == request\.auth\.uid;/);
  assert.match(rulesText, /match \/admins\/\{adminId\}[\s\S]*allow list, create, update, delete: if false;/);
});
