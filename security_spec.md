# Aurum AI — Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Identity & Ownership**:
   - Every `/users/{userId}` document must have `uid == userId == request.auth.uid`.
   - Every `/users/{userId}/analyses/{analysisId}` document must belong to an existing user (`exists(/databases/$(database)/documents/users/$(userId))`) and match `userId == request.auth.uid` and `id == analysisId`.
2. **PII Isolation**:
   - User profiles contain PII (`email`, `displayName`) and are readable/writable **strictly** by the account owner (`request.auth.uid == userId`) or a verified admin (`isAdmin()`). No blanket `isSignedIn()` reads or collection-wide `list` on `/users`.
3. **Subscription Privilege Protection**:
   - Non-admin users MUST only create profiles with `tier == 'FREE'` and CANNOT change `tier` during updates (`incoming().tier == existing().tier`). Only verified admins (`isAdmin()`) may set `tier` to `'VIP'`.
4. **Immutable Ownership & Timestamps**:
   - `createdAt` (and `serverCreatedAt` on analyses) MUST equal `request.time` on creation and cannot be altered on update. `updatedAt` MUST equal `request.time` on create/update.
5. **Verified Users & Path Hardening**:
   - All document IDs (`userId`, `analysisId`, `adminId`) must satisfy `isValidId()` (`<= 128` chars, `^[a-zA-Z0-9_\-]+$`).
   - All client writes require `request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with `PERMISSION_DENIED`)
1. **Unauthenticated read/write**: `get /users/u1` with `auth == null` -> DENY.
2. **Cross-user PII read**: `get /users/victimUid` as `attackerUid` -> DENY.
3. **Users collection scrape**: `list /users` as `attackerUid` -> DENY.
4. **Self-upgrade to VIP on create**: `create /users/u1` with `{ uid: 'u1', tier: 'VIP', ... }` -> DENY.
5. **Self-upgrade to VIP on update**: `update /users/u1` changing `tier` from `'FREE'` to `'VIP'` -> DENY.
6. **Ghost / shadow field injection**: `create /users/u1` with extra `{ isAdmin: true }` -> DENY (`keys().hasOnly(...)`).
7. **Unverified email write**: `create /users/u1` with `email_verified: false` -> DENY.
8. **Forged admin email spoofing**: `get /users/victim` with `email: 'mehrdadmahmodkhanli@gmail.com'` and `email_verified: false` -> DENY.
9. **Client timestamp forgery**: `create /users/u1` with backdated `createdAt` (`!= request.time`) -> DENY.
10. **Cross-user analysis spoofing**: `create /users/victimUid/analyses/a1` as `attackerUid` -> DENY.
11. **Oversized ID poisoning**: `create /users/u1/analyses/<1500-char-id>` -> DENY (`isValidId`).
12. **Self-assign admin document**: `create /admins/attackerUid` as `attackerUid` -> DENY.
