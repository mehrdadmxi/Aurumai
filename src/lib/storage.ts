import type { AnalysisReport, Language } from '../types.ts';

const KEYS = {
  language: 'aurum_ai_language',
  history: 'aurum_ai_local_history_v1',
  clientId: 'aurum_ai_client_id_v1',
};

export function getClientId(): string {
  try {
    let id = localStorage.getItem(KEYS.clientId);
    if (!id) {
      id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEYS.clientId, id);
    }
    return id;
  } catch {
    return 'local-session';
  }
}

export function loadSavedLanguage(): Language {
  try {
    const val = localStorage.getItem(KEYS.language);
    return val === 'en' ? 'en' : 'fa';
  } catch {
    return 'fa';
  }
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(KEYS.language, lang);
  } catch {
    // ignore storage quota errors
  }
}

export function loadLocalAnalysisHistory(): AnalysisReport[] {
  try {
    const raw = localStorage.getItem(KEYS.history);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalysisReport[]) : [];
  } catch {
    return [];
  }
}

export function saveReportToLocalHistory(report: AnalysisReport): AnalysisReport[] {
  const existing = loadLocalAnalysisHistory();
  const updated = [report, ...existing.filter((r) => r.id !== report.id)].slice(0, 50);
  try {
    localStorage.setItem(KEYS.history, JSON.stringify(updated));
  } catch {
    // ignore storage quota errors
  }
  return updated;
}

export function deleteReportFromLocalHistory(id: string): AnalysisReport[] {
  const existing = loadLocalAnalysisHistory();
  const updated = existing.filter((r) => r.id !== id);
  try {
    localStorage.setItem(KEYS.history, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}
