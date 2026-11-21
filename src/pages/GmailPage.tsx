import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MailOpen,
  PenSquare,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { AnalysisReport, AppUser, Language } from '../types.ts';
import { getT } from '../i18n/translations.ts';
import {
  clearGmailAccessToken,
  connectGmailWithGoogle,
  resolvedFirebaseAuthDomain,
} from '../lib/firebase.ts';
import { formatFirebaseAuthError } from '../lib/firebaseAuthError.ts';
import {
  createGmailDraft,
  fetchGmailLabels,
  fetchGmailMessages,
  GmailApiError,
  sendGmailMessage,
  setGmailMessageReadStatus,
  trashGmailMessage,
} from '../lib/gmail.ts';
import type { GmailLabelInfo, GmailMessageSummary } from '../lib/gmailHelpers.ts';
import { formatReportAsText } from '../lib/reportFormatter.ts';

export interface GmailComposeDraftPrefill {
  to?: string;
  subject?: string;
  bodyText?: string;
}

interface GmailPageProps {
  language: Language;
  user: AppUser | null;
  gmailToken: string | null;
  reports: AnalysisReport[];
  prefillCompose: GmailComposeDraftPrefill | null;
  onClearPrefill: () => void;
  onGoogleConnected: (token: string) => void;
}

type PendingMutationAction =
  | { type: 'send'; to: string; subject: string; bodyText: string }
  | { type: 'draft'; to: string; subject: string; bodyText: string }
  | { type: 'trash'; message: GmailMessageSummary }
  | { type: 'toggleRead'; message: GmailMessageSummary; markAsRead: boolean };

function OfficialGoogleButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="gsi-material-button inline-flex items-center justify-center gap-3 px-5 py-2.5 rounded-lg bg-white text-[#1f1f1f] border border-[#747775] hover:bg-[#f8f9fa] active:bg-[#e8eaed] text-sm font-medium shadow-sm transition-colors disabled:opacity-60 cursor-pointer"
    >
      <div className="gsi-material-button-icon w-5 h-5 shrink-0 flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-[#1f1f1f]" />
        ) : (
          <svg
            version="1.1"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 48 48"
            style={{ display: 'block', width: '18px', height: '18px' }}
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
        )}
      </div>
      <span className="gsi-material-button-contents">{label}</span>
    </button>
  );
}

export function GmailPage({
  language,
  user,
  gmailToken,
  reports,
  prefillCompose,
  onClearPrefill,
  onGoogleConnected,
}: GmailPageProps) {
  const t = getT(language).gmail;
  const [connecting, setConnecting] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [labels, setLabels] = useState<GmailLabelInfo[]>([]);
  const [activeLabel, setActiveLabel] = useState<string>('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<GmailMessageSummary | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');

  const [pendingAction, setPendingAction] = useState<PendingMutationAction | null>(null);

  useEffect(() => {
    if (prefillCompose) {
      setToEmail(prefillCompose.to ?? user?.email ?? '');
      setSubject(prefillCompose.subject ?? '');
      setBodyText(prefillCompose.bodyText ?? '');
      setComposeOpen(true);
      onClearPrefill();
    }
  }, [prefillCompose, onClearPrefill, user?.email]);

  const loadMailbox = useCallback(
    async (token: string, label = activeLabel, query = searchQuery) => {
      setLoadingMessages(true);
      setError(null);
      try {
        const [fetchedLabels, fetchedMessages] = await Promise.all([
          fetchGmailLabels(token),
          fetchGmailMessages(token, {
            labelIds: label ? [label] : undefined,
            q: query || undefined,
            maxResults: 15,
          }),
        ]);
        setLabels(fetchedLabels);
        setMessages(fetchedMessages);
        setSelectedMessage((prev) => {
          if (prev && fetchedMessages.some((m) => m.id === prev.id)) {
            return fetchedMessages.find((m) => m.id === prev.id) || fetchedMessages[0] || null;
          }
          return fetchedMessages[0] || null;
        });
      } catch (err) {
        if (err instanceof GmailApiError && err.status === 401) {
          clearGmailAccessToken();
          setError(t.tokenExpired);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load Gmail messages.');
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    [activeLabel, searchQuery, t.tokenExpired]
  );

  useEffect(() => {
    if (gmailToken) {
      void loadMailbox(gmailToken, activeLabel, searchQuery);
    }
  }, [gmailToken, activeLabel, loadMailbox]);

  const handleConnectGoogle = async () => {
    setError(null);
    setNotice(null);
    setConnecting(true);
    try {
      const { accessToken } = await connectGmailWithGoogle();
      onGoogleConnected(accessToken);
    } catch (err) {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
      setError(formatFirebaseAuthError(err, language, hostname, resolvedFirebaseAuthDomain));
    } finally {
      setConnecting(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (gmailToken) {
      void loadMailbox(gmailToken, activeLabel, searchQuery);
    }
  };

  const handleSelectReportPrefill = (reportId: string) => {
    const match = reports.find((r) => r.id === reportId);
    if (!match) return;
    setSubject(
      language === 'fa'
        ? `گزارش تحلیل طلا XAUUSD — تصمیم: ${match.decision}`
        : `Aurum AI XAUUSD Report — Decision: ${match.decision}`
    );
    setBodyText(formatReportAsText(match));
    if (!toEmail && user?.email) {
      setToEmail(user.email);
    }
  };

  const executeConfirmedAction = async () => {
    if (!pendingAction || !gmailToken) return;
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      if (pendingAction.type === 'send') {
        await sendGmailMessage(gmailToken, {
          to: pendingAction.to,
          subject: pendingAction.subject,
          bodyText: pendingAction.bodyText,
        });
        setNotice(t.sentSuccess);
        setComposeOpen(false);
        setToEmail('');
        setSubject('');
        setBodyText('');
        await loadMailbox(gmailToken, activeLabel, searchQuery);
      } else if (pendingAction.type === 'draft') {
        await createGmailDraft(gmailToken, {
          to: pendingAction.to,
          subject: pendingAction.subject,
          bodyText: pendingAction.bodyText,
        });
        setNotice(t.draftSuccess);
        setComposeOpen(false);
      } else if (pendingAction.type === 'trash') {
        await trashGmailMessage(gmailToken, pendingAction.message.id);
        setNotice(t.trashSuccess);
        setMessages((prev) => prev.filter((m) => m.id !== pendingAction.message.id));
        if (selectedMessage?.id === pendingAction.message.id) {
          setSelectedMessage(null);
        }
      } else if (pendingAction.type === 'toggleRead') {
        await setGmailMessageReadStatus(
          gmailToken,
          pendingAction.message.id,
          pendingAction.markAsRead
        );
        await loadMailbox(gmailToken, activeLabel, searchQuery);
      }
      setPendingAction(null);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 401) {
        clearGmailAccessToken();
        setError(t.tokenExpired);
      } else {
        setError(err instanceof Error ? err.message : 'Gmail operation failed.');
      }
      setPendingAction(null);
    } finally {
      setMutating(false);
    }
  };

  const presetLabels = [
    { id: 'INBOX', label: t.allInboxLabel, icon: Inbox },
    { id: 'UNREAD', label: t.unreadLabel, icon: Mail },
    { id: 'STARRED', label: t.starredLabel, icon: Star },
    { id: 'SENT', label: t.sentLabel, icon: Send },
  ];

  const inboxUnreadCount = labels.find((l) => l.id === 'INBOX')?.messagesUnread;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.title}</h1>
          <p className="text-xs text-[#9A9891]">{t.subtitle}</p>
        </div>

        {gmailToken && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadMailbox(gmailToken, activeLabel, searchQuery)}
              disabled={loadingMessages}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? 'animate-spin' : ''}`} />
              <span>{t.refreshBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!toEmail && user?.email) setToEmail(user.email);
                setComposeOpen(true);
              }}
              className="aurum-gold-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold"
            >
              <PenSquare className="w-3.5 h-3.5" />
              <span>{t.composeBtn}</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 rounded-xl bg-rose-950/35 border border-rose-500/35 text-xs text-rose-200 leading-relaxed"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-950/35 border border-emerald-500/35 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* Auth Gate when in-memory Gmail OAuth token is unavailable */}
      {!gmailToken ? (
        <section className="aurum-glass-strong rounded-xl p-8 max-w-xl space-y-5">
          <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center text-[#F3E5AB]">
            <Mail className="w-5 h-5" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-[#F3E5AB]">{t.authTitle}</h2>
            <p className="text-xs text-[#9A9891] leading-relaxed">{t.authDesc}</p>
          </div>
          <OfficialGoogleButton
            label={connecting ? t.connectingBtn : t.signInBtn}
            loading={connecting}
            onClick={handleConnectGoogle}
          />
        </section>
      ) : (
        <>
          {/* Filter Tabs & Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {presetLabels.map((item) => {
                const Icon = item.icon;
                const active = activeLabel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveLabel(item.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#D4AF37]/15 text-[#F3E5AB] border-[#D4AF37]/40'
                        : 'border-white/10 text-[#9A9891] hover:text-[#F5F2EB] hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                    {item.id === 'INBOX' && typeof inboxUnreadCount === 'number' && inboxUnreadCount > 0 && (
                      <span className="font-mono-num text-[11px] text-[#D4AF37]">
                        ({inboxUnreadCount})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[300px]">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[#9A9891] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full bg-[#0C0D12] border border-white/10 focus:border-[#D4AF37]/50 rounded-lg ps-9 pe-3 py-2 text-xs text-[#F5F2EB] placeholder:text-[#9A9891]/60 outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10"
              >
                {language === 'fa' ? 'جستجو' : 'Search'}
              </button>
            </form>
          </div>

          {/* Compose Panel */}
          {composeOpen && (
            <section className="aurum-glass-strong rounded-xl p-6 space-y-4 border border-[#D4AF37]/35">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#F3E5AB]">{t.composeBtn}</h2>
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  aria-label="Close composer"
                  className="p-1.5 rounded-lg text-[#9A9891] hover:text-[#F5F2EB] hover:bg-white/5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {reports.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#F3E5AB] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    <span>{t.prefillReportLabel}</span>
                  </label>
                  <select
                    defaultValue=""
                    onChange={(e) => handleSelectReportPrefill(e.target.value)}
                    className="w-full bg-[#0C0D12] border border-white/10 rounded-lg px-3 py-2 text-xs text-[#F5F2EB] outline-none focus:border-[#D4AF37]/50"
                  >
                    <option value="">{t.noReportOption}</option>
                    {reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        {`${r.symbol} · ${r.decision} · ${new Date(r.createdAt).toLocaleString(
                          language === 'fa' ? 'fa-IR' : 'en-US'
                        )}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs text-[#9A9891]">{t.toLabel}</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    placeholder="name@gmail.com"
                    className="w-full bg-[#0C0D12] border border-white/10 focus:border-[#D4AF37]/50 rounded-lg px-3 py-2 text-xs text-[#F5F2EB] outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs text-[#9A9891]">{t.subjectLabel}</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full bg-[#0C0D12] border border-white/10 focus:border-[#D4AF37]/50 rounded-lg px-3 py-2 text-xs text-[#F5F2EB] outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-[#9A9891]">{t.bodyLabel}</label>
                <textarea
                  rows={7}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full bg-[#0C0D12] border border-white/10 focus:border-[#D4AF37]/50 rounded-lg px-3 py-2.5 text-xs text-[#F5F2EB] outline-none leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-white/10 text-[#9A9891] hover:text-[#F5F2EB]"
                >
                  {t.cancelBtn}
                </button>
                <button
                  type="button"
                  disabled={!toEmail.trim() || !subject.trim()}
                  onClick={() =>
                    setPendingAction({
                      type: 'draft',
                      to: toEmail.trim(),
                      subject: subject.trim(),
                      bodyText,
                    })
                  }
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 disabled:opacity-50"
                >
                  {t.saveDraftBtn}
                </button>
                <button
                  type="button"
                  disabled={!toEmail.trim() || !subject.trim()}
                  onClick={() =>
                    setPendingAction({
                      type: 'send',
                      to: toEmail.trim(),
                      subject: subject.trim(),
                      bodyText,
                    })
                  }
                  className="aurum-gold-btn inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t.sendBtn}</span>
                </button>
              </div>
            </section>
          )}

          {/* Split-Pane Inbox & Reader */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Message List */}
            <section className="lg:col-span-5 aurum-glass rounded-xl overflow-hidden divide-y divide-white/5 max-h-[620px] overflow-y-auto">
              {loadingMessages ? (
                <div className="p-8 flex items-center justify-center gap-2 text-xs text-[#9A9891]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                  <span>{language === 'fa' ? 'در حال دریافت ایمیل‌ها...' : 'Loading Gmail messages...'}</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#9A9891]">{t.emptyList}</div>
              ) : (
                messages.map((msg) => {
                  const isSelected = selectedMessage?.id === msg.id;
                  return (
                    <button
                      key={msg.id}
                      type="button"
                      onClick={() => setSelectedMessage(msg)}
                      className={`w-full text-start p-4 transition-colors space-y-1.5 ${
                        isSelected ? 'bg-[#D4AF37]/12' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-xs truncate ${
                            msg.isUnread ? 'font-bold text-[#F3E5AB]' : 'font-medium text-[#F5F2EB]'
                          }`}
                        >
                          {msg.from}
                        </span>
                        <span className="text-[11px] font-mono-num text-[#9A9891] shrink-0">
                          {new Date(msg.timestampIso).toLocaleDateString(
                            language === 'fa' ? 'fa-IR' : 'en-US'
                          )}
                        </span>
                      </div>
                      <div
                        className={`text-xs truncate ${
                          msg.isUnread ? 'font-semibold text-[#F5F2EB]' : 'text-[#9A9891]'
                        }`}
                      >
                        {msg.subject}
                      </div>
                      <p className="text-[11px] text-[#9A9891]/80 line-clamp-2 leading-relaxed">
                        {msg.snippet}
                      </p>
                    </button>
                  );
                })
              )}
            </section>

            {/* Message Reader */}
            <section className="lg:col-span-7 aurum-glass rounded-xl p-6 min-h-[400px] flex flex-col">
              {!selectedMessage ? (
                <div className="flex-1 flex items-center justify-center text-xs text-[#9A9891]">
                  {t.selectPrompt}
                </div>
              ) : (
                <div className="space-y-4 flex-1 flex flex-col">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-white/10">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <h2 className="text-base font-bold text-[#F5F2EB] break-words">
                        {selectedMessage.subject}
                      </h2>
                      <div className="text-xs text-[#9A9891] space-y-0.5">
                        <p className="truncate">
                          <strong className="text-[#F3E5AB]">From:</strong> {selectedMessage.from}
                        </p>
                        {selectedMessage.to && (
                          <p className="truncate">
                            <strong className="text-[#F3E5AB]">To:</strong> {selectedMessage.to}
                          </p>
                        )}
                        <p className="font-mono-num text-[11px]">
                          {new Date(selectedMessage.timestampIso).toLocaleString(
                            language === 'fa' ? 'fa-IR' : 'en-US'
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({
                            type: 'toggleRead',
                            message: selectedMessage,
                            markAsRead: selectedMessage.isUnread,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-white/10 text-[#F5F2EB] hover:bg-white/5"
                      >
                        {selectedMessage.isUnread ? (
                          <MailCheck className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <MailOpen className="w-3.5 h-3.5 text-[#D4AF37]" />
                        )}
                        <span>{selectedMessage.isUnread ? t.markRead : t.markUnread}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAction({ type: 'trash', message: selectedMessage })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-rose-500/35 text-rose-300 hover:bg-rose-950/40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t.moveToTrash}</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 text-xs text-[#F5F2EB]/90 whitespace-pre-wrap leading-relaxed break-words overflow-y-auto max-h-[440px]">
                    {selectedMessage.bodyText}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* MANDATORY Explicit Confirmation Dialog before any mutating/destructive Gmail operation */}
      {pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="aurum-glass-strong rounded-xl p-6 max-w-md w-full space-y-4 border border-[#D4AF37]/40 shadow-2xl">
            <h3 className="text-base font-bold text-[#F3E5AB]">
              {pendingAction.type === 'send'
                ? t.confirmSendTitle
                : pendingAction.type === 'draft'
                  ? t.confirmDraftTitle
                  : pendingAction.type === 'trash'
                    ? t.confirmTrashTitle
                    : t.confirmModifyTitle}
            </h3>

            <p className="text-xs text-[#9A9891] leading-relaxed">
              {pendingAction.type === 'send'
                ? t.confirmSendDesc
                : pendingAction.type === 'draft'
                  ? t.confirmDraftDesc
                  : pendingAction.type === 'trash'
                    ? t.confirmTrashDesc
                    : t.confirmModifyDesc}
            </p>

            <div className="p-3 rounded-lg bg-[#090A0D] border border-white/10 text-xs space-y-1">
              {(pendingAction.type === 'send' || pendingAction.type === 'draft') && (
                <>
                  <p className="text-[#F5F2EB] truncate">
                    <strong className="text-[#D4AF37]">{t.toLabel}:</strong> {pendingAction.to}
                  </p>
                  <p className="text-[#F5F2EB] truncate">
                    <strong className="text-[#D4AF37]">{t.subjectLabel}:</strong>{' '}
                    {pendingAction.subject}
                  </p>
                </>
              )}
              {(pendingAction.type === 'trash' || pendingAction.type === 'toggleRead') && (
                <>
                  <p className="text-[#F5F2EB] truncate">
                    <strong className="text-[#D4AF37]">{t.subjectLabel}:</strong>{' '}
                    {pendingAction.message.subject}
                  </p>
                  <p className="text-[#9A9891] truncate">
                    <strong>From:</strong> {pendingAction.message.from}
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={mutating}
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-white/10 text-[#9A9891] hover:text-[#F5F2EB] disabled:opacity-50"
              >
                {t.cancelBtn}
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={() => void executeConfirmedAction()}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-60 ${
                  pendingAction.type === 'trash'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'aurum-gold-btn'
                }`}
              >
                {mutating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{t.confirmBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
