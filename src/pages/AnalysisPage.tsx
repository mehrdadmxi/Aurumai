import type { ChangeEvent, DragEvent } from 'react';
import { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AnalysisReport,
  AnalysisStageEvent,
  ChartUploadSlot,
  Language,
  TimeframeSlot,
} from '../types.ts';
import { getT } from '../i18n/translations.ts';
import {
  formatClientNetworkError,
  parseNdjsonChunk,
  validateImageFileMeta,
} from '../lib/tradingRules.ts';
import { optimizeChartImageFile } from '../lib/imageOptimizer.ts';
import { getClientId } from '../lib/storage.ts';

interface AnalysisPageProps {
  language: Language;
  onAnalysisComplete: (report: AnalysisReport) => void;
}

const SLOTS: TimeframeSlot[] = ['1H', '15M', '5M'];

export function AnalysisPage({ language, onAnalysisComplete }: AnalysisPageProps) {
  const t = getT(language).analysis;

  const [charts, setCharts] = useState<Record<TimeframeSlot, ChartUploadSlot | null>>({
    '1H': null,
    '15M': null,
    '5M': null,
  });
  const [slotErrors, setSlotErrors] = useState<Record<TimeframeSlot, string | null>>({
    '1H': null,
    '15M': null,
    '5M': null,
  });
  const [optimizingSlots, setOptimizingSlots] = useState<Record<TimeframeSlot, boolean>>({
    '1H': false,
    '15M': false,
    '5M': false,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [stageMessage, setStageMessage] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputs = {
    '1H': useRef<HTMLInputElement | null>(null),
    '15M': useRef<HTMLInputElement | null>(null),
    '5M': useRef<HTMLInputElement | null>(null),
  };

  const slotMeta: Record<TimeframeSlot, { title: string; sub: string }> = {
    '1H': { title: t.slot1Title, sub: t.slot1Sub },
    '15M': { title: t.slot2Title, sub: t.slot2Sub },
    '5M': { title: t.slot3Title, sub: t.slot3Sub },
  };

  const handleFile = async (slot: TimeframeSlot, file: File) => {
    setSubmitError(null);
    const validation = validateImageFileMeta({
      mimeType: file.type,
      sizeBytes: file.size,
    });

    if (!validation.valid) {
      setSlotErrors((prev) => ({
        ...prev,
        [slot]: validation.errorMessage || t.invalidStatus,
      }));
      return;
    }

    setOptimizingSlots((prev) => ({ ...prev, [slot]: true }));
    setSlotErrors((prev) => ({ ...prev, [slot]: null }));

    try {
      const optimized = await optimizeChartImageFile(file);
      setCharts((prev) => ({
        ...prev,
        [slot]: {
          timeframe: slot,
          fileName: optimized.fileName,
          mimeType: optimized.mimeType,
          sizeBytes: optimized.sizeBytes,
          base64: optimized.base64,
          previewUrl: optimized.base64,
          uploadedAt: new Date().toISOString(),
          validation: { valid: true },
        },
      }));
    } catch {
      setSlotErrors((prev) => ({
        ...prev,
        [slot]:
          language === 'fa'
            ? 'خواندن تصویر ناموفق بود. لطفاً تصویر معتبر PNG یا JPG انتخاب کنید.'
            : 'Failed to read image file. Please select a valid PNG or JPG image.',
      }));
    } finally {
      setOptimizingSlots((prev) => ({ ...prev, [slot]: false }));
    }
  };

  const onInputChange = (slot: TimeframeSlot) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(slot, file);
    e.target.value = '';
  };

  const onDrop = (slot: TimeframeSlot) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(slot, file);
  };

  const removeSlot = (slot: TimeframeSlot) => {
    setSubmitError(null);
    setSlotErrors((prev) => ({ ...prev, [slot]: null }));
    setCharts((prev) => ({ ...prev, [slot]: null }));
  };

  const isOptimizingAny = SLOTS.some((s) => optimizingSlots[s]);
  const allReady = SLOTS.every((s) => charts[s] !== null && charts[s]!.validation.valid);

  const handleAnalyze = async () => {
    if (isOptimizingAny) {
      return;
    }
    if (!allReady) {
      setSubmitError(t.missingThreeError);
      return;
    }

    setSubmitError(null);
    setIsAnalyzing(true);
    setActiveStage(1);
    setStageMessage(t.stages[0]);

    let payloadBytes = 0;

    try {
      const payload = {
        language,
        charts: SLOTS.map((slot) => {
          const c = charts[slot]!;
          return {
            timeframe: c.timeframe,
            fileName: c.fileName,
            mimeType: c.mimeType,
            sizeBytes: c.sizeBytes,
            base64: c.base64,
          };
        }),
      };

      const bodyString = JSON.stringify(payload);
      payloadBytes = new Blob([bodyString]).size;

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': getClientId(),
        },
        body: bodyString,
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const errJson = (await res.json()) as { error?: string };
          throw new Error(errJson.error || `Request failed with status ${res.status}`);
        }
        const rawText = await res.text().catch(() => '');
        if (res.status === 413) {
          throw new Error(
            language === 'fa'
              ? 'حجم مجموع تصاویر از سقف مجاز سرور بیشتر است. لطفاً تصاویر با حجم کمتر انتخاب کنید.'
              : 'Uploaded images exceed the server request size limit (HTTP 413).'
          );
        }
        throw new Error(
          rawText && rawText.length < 200 && !rawText.trim().startsWith('<')
            ? rawText
            : language === 'fa'
              ? `خطای سرور هنگام پردازش تحلیل (کد وضعیت ${res.status}).`
              : `Server returned HTTP ${res.status} while processing analysis.`
        );
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(
          language === 'fa'
            ? 'مسیر /api/analyze صفحه HTML برگرداند؛ Cloudflare Pages Functions روی این دیپلوی فعال نیستند (حتماً با wrangler pages deploy یا اتصال Git دیپلوی کنید).'
            : '/api/analyze returned HTML instead of API stream (Cloudflare Pages Functions are not active on this deployment).'
        );
      }

      if (!res.body) {
        throw new Error(
          language === 'fa'
            ? 'پاسخ جریانی سرور در دسترس نیست.'
            : 'Streaming response unavailable.'
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalReport: AnalysisReport | null = null;

      const handleParsedEvents = (events: AnalysisStageEvent[]) => {
        for (const evt of events) {
          if (evt.type === 'stage' && evt.stage) {
            setActiveStage(evt.stage);
            if (evt.message) setStageMessage(evt.message);
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Analysis failed.');
          } else if (evt.type === 'complete' && evt.report) {
            finalReport = evt.report;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const flushed = parseNdjsonChunk<AnalysisStageEvent>(
            buffer,
            decoder.decode(),
            true
          );
          handleParsedEvents(flushed.events);
          break;
        }
        const chunkText = decoder.decode(value, { stream: true });
        const parsed = parseNdjsonChunk<AnalysisStageEvent>(buffer, chunkText, false);
        buffer = parsed.remainingBuffer;
        handleParsedEvents(parsed.events);
      }

      if (!finalReport) {
        throw new Error(
          language === 'fa'
            ? 'تحلیل بدون دریافت گزارش نهایی متوقف شد. لطفاً دوباره تلاش کنید.'
            : 'Analysis completed without a valid report payload.'
        );
      }

      onAnalysisComplete(finalReport);
    } catch (err) {
      setSubmitError(formatClientNetworkError(err, language, { payloadBytes }));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2 max-w-3xl">
        <h1 className="text-2xl sm:text-3xl font-bold text-[#F5F2EB]">{t.pageTitle}</h1>
        <p className="text-sm text-[#9A9891] leading-relaxed">{t.pageSubtitle}</p>
      </div>

      {/* Three Upload Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {SLOTS.map((slot) => {
          const item = charts[slot];
          const errMsg = slotErrors[slot];
          const meta = slotMeta[slot];

          return (
            <section
              key={slot}
              data-testid={`upload-card-${slot}`}
              className="aurum-glass rounded-xl p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#F3E5AB]">{meta.title}</h2>
                  <span className="font-mono-num text-xs font-bold text-[#D4AF37]">{slot}</span>
                </div>
                <p className="text-xs text-[#9A9891]">{meta.sub}</p>
                <div className="flex items-center gap-2 text-xs pt-1 text-[#9A9891]">
                  <span>{item ? t.uploadedStatus : t.waitingStatus}</span>
                  <span aria-hidden="true">·</span>
                  <span className={item ? 'text-emerald-400' : 'text-[#9A9891]'}>
                    {errMsg ? t.invalidStatus : item ? t.validStatus : '—'}
                  </span>
                </div>
              </div>

              <input
                ref={fileInputs[slot]}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label={`${meta.title} file input`}
                onChange={onInputChange(slot)}
              />

              {optimizingSlots[slot] ? (
                <div className="border border-dashed border-[#D4AF37]/40 rounded-xl p-6 text-center space-y-2 bg-black/30">
                  <Loader2 className="w-6 h-6 text-[#D4AF37] animate-spin mx-auto" />
                  <p className="text-xs text-[#F3E5AB]">
                    {language === 'fa'
                      ? 'در حال بهینه‌سازی تصویر چارت...'
                      : 'Optimizing chart screenshot...'}
                  </p>
                </div>
              ) : item ? (
                <div className="space-y-3">
                  <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black aspect-video">
                    <img
                      src={item.previewUrl}
                      alt={`${slot} XAUUSD Chart Preview`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#9A9891]">
                    <span className="truncate max-w-[180px]">{item.fileName}</span>
                    <span className="font-mono-num shrink-0">
                      {(item.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputs[slot].current?.click()}
                      disabled={isAnalyzing}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/30 text-[#F3E5AB] hover:bg-[#D4AF37]/10 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{t.replaceBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlot(slot)}
                      disabled={isAnalyzing}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-rose-500/30 text-rose-300 hover:bg-rose-950/40 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t.removeBtn}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop(slot)}
                  className="border border-dashed border-[#D4AF37]/35 rounded-xl p-6 text-center space-y-3 hover:border-[#D4AF37]/70 transition-colors bg-black/30"
                >
                  <Upload className="w-7 h-7 text-[#D4AF37] mx-auto" />
                  <p className="text-xs text-[#F5F2EB]">{t.dropzonePrompt}</p>
                  <p className="text-[11px] text-[#9A9891]">{t.formatLimit}</p>
                  <button
                    type="button"
                    onClick={() => fileInputs[slot].current?.click()}
                    disabled={isAnalyzing}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-[#D4AF37]/40 text-[#F3E5AB] hover:bg-[#D4AF37]/15 transition-colors"
                  >
                    {t.uploadBtn}
                  </button>
                </div>
              )}

              {errMsg && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errMsg}</span>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Error Message */}
      {submitError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-950/45 border border-rose-500/40 text-sm text-rose-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
          <span>{submitError}</span>
        </div>
      )}

      {/* Multi-Stage Real Backend Progress */}
      {isAnalyzing && (
        <section className="aurum-glass-strong rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-[#D4AF37] animate-spin" />
              <span className="text-sm font-semibold text-[#F3E5AB]">{stageMessage}</span>
            </div>
            <span className="font-mono-num text-xs text-[#9A9891]">{activeStage} / 7</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
            {t.stages.map((label, idx) => {
              const stageNum = idx + 1;
              const isDone = activeStage > stageNum;
              const isCurrent = activeStage === stageNum;
              return (
                <div
                  key={label}
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    isCurrent
                      ? 'border-[#D4AF37]/60 bg-[#D4AF37]/10 text-[#F3E5AB]'
                      : isDone
                        ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                        : 'border-white/10 bg-white/[0.02] text-[#9A9891]'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono-num">
                    <span>0{stageNum}</span>
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="leading-snug">{label}</div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[#9A9891]">{t.pipelineNote}</p>
        </section>
      )}

      {/* Primary Analyze Submit */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={isAnalyzing || isOptimizingAny}
          className="aurum-gold-btn px-7 py-3.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-60"
        >
          {isAnalyzing ? t.analyzingBtn : t.submitBtn}
        </button>
      </div>
    </div>
  );
}
