import {
  buildRawMimeEmail,
  type GmailLabelInfo,
  type GmailMessageSummary,
  parseGmailMessage,
  type RawGmailMessage,
} from './gmailHelpers.ts';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
  }
}

async function gmailFetchJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let errText = `Gmail API error (${res.status})`;
    try {
      const payload = (await res.json()) as { error?: { message?: string } };
      if (payload?.error?.message) {
        errText = payload.error.message;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new GmailApiError(errText, res.status);
  }

  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export async function fetchGmailLabels(accessToken: string): Promise<GmailLabelInfo[]> {
  const data = await gmailFetchJson<{ labels?: GmailLabelInfo[] }>(accessToken, '/labels');
  return Array.isArray(data.labels) ? data.labels : [];
}

export async function fetchGmailMessages(
  accessToken: string,
  options?: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
  }
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options?.maxResults ?? 15));
  if (options?.q?.trim()) {
    params.set('q', options.q.trim());
  }
  if (options?.labelIds && options.labelIds.length > 0) {
    for (const labelId of options.labelIds) {
      params.append('labelIds', labelId);
    }
  }

  const listData = await gmailFetchJson<{ messages?: Array<{ id: string }> }>(
    accessToken,
    `/messages?${params.toString()}`
  );

  const ids = (listData.messages || []).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) return [];

  const details = await Promise.all(
    ids.map((id) =>
      gmailFetchJson<RawGmailMessage>(
        accessToken,
        `/messages/${encodeURIComponent(id)}?format=full`
      )
    )
  );

  return details.map((raw) => parseGmailMessage(raw));
}

export async function sendGmailMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    bodyText: string;
    from?: string;
  }
): Promise<{ id: string; threadId?: string }> {
  const raw = buildRawMimeEmail(params);
  return gmailFetchJson<{ id: string; threadId?: string }>(accessToken, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
}

export async function createGmailDraft(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    bodyText: string;
    from?: string;
  }
): Promise<{ id: string }> {
  const raw = buildRawMimeEmail(params);
  return gmailFetchJson<{ id: string }>(accessToken, '/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw } }),
  });
}

export async function setGmailMessageReadStatus(
  accessToken: string,
  messageId: string,
  markAsRead: boolean
): Promise<void> {
  await gmailFetchJson(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: 'POST',
      body: JSON.stringify(
        markAsRead ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }
      ),
    }
  );
}

export async function trashGmailMessage(accessToken: string, messageId: string): Promise<void> {
  await gmailFetchJson(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/trash`,
    { method: 'POST' }
  );
}
