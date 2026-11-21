import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRawMimeEmail,
  decodeBase64UrlUtf8,
  encodeBase64UrlUtf8,
  encodeMimeHeaderUtf8,
  parseGmailMessage,
} from './gmailHelpers.ts';

test('encodeBase64UrlUtf8 and decodeBase64UrlUtf8 round-trip Persian and English text cleanly', () => {
  const text = 'گزارش تحلیل طلا XAUUSD — Entry: $3580.00';
  const encoded = encodeBase64UrlUtf8(text);
  assert.ok(!encoded.includes('+'));
  assert.ok(!encoded.includes('/'));
  assert.ok(!encoded.includes('='));
  assert.equal(decodeBase64UrlUtf8(encoded), text);
});

test('encodeMimeHeaderUtf8 keeps ASCII plain and encodes Persian subjects in RFC 2047 UTF-8', () => {
  assert.equal(encodeMimeHeaderUtf8('XAUUSD BUY Signal'), 'XAUUSD BUY Signal');
  const faHeader = encodeMimeHeaderUtf8('سیگنال خرید طلا XAUUSD');
  assert.ok(faHeader.startsWith('=?UTF-8?B?'));
  assert.ok(faHeader.endsWith('?='));
});

test('buildRawMimeEmail creates valid base64url MIME payload with To, Subject, and UTF-8 body', () => {
  const raw = buildRawMimeEmail({
    to: 'trader@example.com',
    subject: 'سیگنال جدید طلا',
    bodyText: 'نقطه ورود: 3580\nحد ضرر: 3565',
  });
  const decoded = decodeBase64UrlUtf8(raw);
  assert.match(decoded, /^To: trader@example\.com/m);
  assert.match(decoded, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(decoded, /Content-Type: text\/plain; charset="UTF-8"/);
});

test('parseGmailMessage extracts headers, multipart text/plain body, HTML fallback, and unread flag', () => {
  const msg = parseGmailMessage({
    id: 'msg-1',
    threadId: 'thr-1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Gold alert &amp; summary',
    internalDate: '1763640000000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Subject', value: 'XAUUSD Market Update' },
        { name: 'From', value: 'Alerts <alerts@aurum.ai>' },
        { name: 'To', value: 'user@gmail.com' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: encodeBase64UrlUtf8('Gold broke above $3,580 resistance.') },
        },
        {
          mimeType: 'text/html',
          body: { data: encodeBase64UrlUtf8('<p>Gold broke above <b>$3,580</b>.</p>') },
        },
      ],
    },
  });

  assert.equal(msg.id, 'msg-1');
  assert.equal(msg.subject, 'XAUUSD Market Update');
  assert.equal(msg.from, 'Alerts <alerts@aurum.ai>');
  assert.equal(msg.snippet, 'Gold alert & summary');
  assert.equal(msg.bodyText, 'Gold broke above $3,580 resistance.');
  assert.equal(msg.isUnread, true);
});
