export interface ParsedGmailHeader {
  name?: string;
  value?: string;
}

export interface RawGmailPayload {
  mimeType?: string;
  headers?: ParsedGmailHeader[];
  body?: { data?: string; size?: number };
  parts?: RawGmailPayload[];
}

export interface RawGmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: RawGmailPayload;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  timestampIso: string;
  snippet: string;
  bodyText: string;
  labelIds: string[];
  isUnread: boolean;
}

export interface GmailLabelInfo {
  id: string;
  name: string;
  type?: string;
  messagesUnread?: number;
}

export function encodeBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64UrlUtf8(base64Url?: string | null): string {
  if (!base64Url || typeof base64Url !== 'string') return '';
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

export function encodeMimeHeaderUtf8(value: string): string {
  const trimmed = value.replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed) return '';
  // Pure printable ASCII needs no RFC 2047 encoding
  if (/^[\x20-\x7E]+$/.test(trimmed)) {
    return trimmed;
  }
  const bytes = new TextEncoder().encode(trimmed);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

export function buildRawMimeEmail(params: {
  to: string;
  subject: string;
  bodyText: string;
  from?: string;
}): string {
  const to = params.to.replace(/[\r\n]+/g, ' ').trim();
  const subjectHeader = encodeMimeHeaderUtf8(params.subject || '(No Subject)');
  const from = params.from ? params.from.replace(/[\r\n]+/g, ' ').trim() : '';

  const headers: string[] = [];
  if (from) headers.push(`From: ${from}`);
  headers.push(`To: ${to}`);
  headers.push(`Subject: ${subjectHeader}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: base64');

  const bodyBytes = new TextEncoder().encode(params.bodyText || '');
  let bodyBinary = '';
  for (let i = 0; i < bodyBytes.length; i += 1) {
    bodyBinary += String.fromCharCode(bodyBytes[i]);
  }
  const bodyBase64 = btoa(bodyBinary);

  const mimeMessage = `${headers.join('\r\n')}\r\n\r\n${bodyBase64}`;
  return encodeBase64UrlUtf8(mimeMessage);
}

function getHeaderValue(headers: ParsedGmailHeader[] | undefined, targetName: string): string {
  if (!Array.isArray(headers)) return '';
  const lower = targetName.toLowerCase();
  const found = headers.find((h) => (h.name || '').toLowerCase() === lower);
  return (found?.value || '').trim();
}

function stripHtmlTagsToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractBodyTextFromPayload(payload?: RawGmailPayload): string {
  if (!payload) return '';

  const queue: RawGmailPayload[] = [payload];
  let htmlFallback = '';

  while (queue.length > 0) {
    const node = queue.shift()!;
    const mime = (node.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && node.body?.data) {
      const text = decodeBase64UrlUtf8(node.body.data).trim();
      if (text) return text;
    }
    if (mime === 'text/html' && node.body?.data && !htmlFallback) {
      htmlFallback = stripHtmlTagsToText(decodeBase64UrlUtf8(node.body.data));
    }
    if (Array.isArray(node.parts)) {
      queue.push(...node.parts);
    }
  }

  if (payload.body?.data) {
    const raw = decodeBase64UrlUtf8(payload.body.data).trim();
    if (raw) {
      return (payload.mimeType || '').toLowerCase().includes('html')
        ? stripHtmlTagsToText(raw)
        : raw;
    }
  }

  return htmlFallback;
}

export function parseGmailMessage(raw: RawGmailMessage): GmailMessageSummary {
  const headers = raw.payload?.headers;
  const subject = getHeaderValue(headers, 'Subject') || '(No Subject)';
  const from = getHeaderValue(headers, 'From') || 'Unknown Sender';
  const to = getHeaderValue(headers, 'To');
  const date = getHeaderValue(headers, 'Date');

  let timestampIso = new Date().toISOString();
  if (raw.internalDate && /^\d+$/.test(raw.internalDate)) {
    const ms = Number(raw.internalDate);
    if (Number.isFinite(ms) && ms > 0) {
      timestampIso = new Date(ms).toISOString();
    }
  } else if (date) {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed)) {
      timestampIso = new Date(parsed).toISOString();
    }
  }

  const labelIds = Array.isArray(raw.labelIds) ? raw.labelIds : [];
  const snippet = (raw.snippet || '')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  const bodyText = extractBodyTextFromPayload(raw.payload) || snippet;

  return {
    id: raw.id,
    threadId: raw.threadId || raw.id,
    subject,
    from,
    to,
    date,
    timestampIso,
    snippet,
    bodyText,
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
  };
}
