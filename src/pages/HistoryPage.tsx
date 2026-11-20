import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AnalysisReport, Language, SignalDecision } from '../types.ts';
import { getT } from '../i18n/translations.ts';

interface HistoryPageProps {
  language: Language;
  history: AnalysisReport[];
  isAuthenticated?: boolean;
  onOpenReport: (report: AnalysisReport) => void;
  onDeleteReport: (id: string) => void;
}

export function HistoryPage({
  language,
  history,
  isAuthenticated = false,
  onOpenReport,
  onDeleteReport,
}: HistoryPageProps) {
  const t = getT(language);
  const [filter, setFilter] = useState<'ALL' | SignalDecision>('ALL');

  const filtered =
    filter === 'ALL' ? history : history.filter((r) => r.decision === filter);

  const filterButtons: Array<{ id: 'ALL' | SignalDecision; label: string }> = [
    { id: 'ALL', label: t.history.filterAll },
    { id: 'BUY', label: t.history.filterBuy },
    { id: 'SELL', label: t.history.filterSell },
    { id: 'NO TRADE', label: t.history.filterNoTrade },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold text-[#F5F2EB]">{t.history.title}</h1>
        <p className="text-sm text-[#9A9891]">{t.history.subtitle}</p>
      </div>

      {isAuthenticated ? (
        <div className="p-3.5 rounded-xl bg-emerald-950/25 border border-emerald-500/25 text-xs text-emerald-200">
          {t.history.cloudActiveNotice}
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-500/25 text-xs text-amber-200">
          {t.history.localNotice}
        </div>
      )}

      {/* Interactive Filter Tabs */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0D0E12] border border-[#D4AF37]/20">
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => setFilter(btn.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filter === btn.id
                ? 'bg-[#D4AF37]/20 text-[#F3E5AB]'
                : 'text-[#9A9891] hover:text-[#F5F2EB]'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="aurum-glass rounded-xl p-10 text-center text-sm text-[#9A9891]">
          {t.history.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="aurum-glass rounded-xl p-5 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1 min-w-[240px]">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-mono-num font-bold text-[#F3E5AB]">{item.symbol}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-bold ${
                      item.decision === 'BUY'
                        ? 'text-emerald-400'
                        : item.decision === 'SELL'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                    }`}
                  >
                    {item.decision}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num text-[#9A9891]">
                    {new Date(item.createdAt).toLocaleString(
                      language === 'fa' ? 'fa-IR' : 'en-US'
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num text-[#F5F2EB]">
                    RR {item.tradingPlan.riskToRewardLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num text-[#D4AF37]">
                    {item.technicalScores.overallScore}/10
                  </span>
                </div>
                <p className="text-xs text-[#9A9891] line-clamp-2 leading-relaxed">
                  {item.detailedExplanation.decisionReason}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenReport(item)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
                >
                  {t.history.openReport}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteReport(item.id)}
                  aria-label={`${t.history.deleteRecord} ${item.id}`}
                  className="p-2 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-950/40 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
