import {
  computeTargetImageDimensions,
  estimateBase64DecodedBytes,
} from './tradingRules.ts';

export interface OptimizedChartImage {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
}

const TARGET_MAX_DIMENSION = 1920;
const SOFT_MAX_OPTIMIZED_BYTES = 850 * 1024; // ~850 KB per chart -> 3 charts ~ 1.5–2.5 MB JSON total
const OPTIMIZE_TRIGGER_BYTES = 550 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image dimensions.'));
    img.src = src;
  });
}

function extractMimeFromDataUrl(dataUrl: string, fallback: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  return match?.[1]?.toLowerCase() || fallback;
}

export async function optimizeChartImageFile(file: File): Promise<OptimizedChartImage> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const rawMime = extractMimeFromDataUrl(rawDataUrl, file.type || 'image/png');
  const rawBytes = estimateBase64DecodedBytes(rawDataUrl) || file.size;

  // Keep small images untouched if we can verify or if canvas isn't needed
  try {
    const img = await loadImageElement(rawDataUrl);
    const { width, height, resized } = computeTargetImageDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      TARGET_MAX_DIMENSION
    );

    if (!resized && rawBytes <= OPTIMIZE_TRIGGER_BYTES) {
      return {
        fileName: file.name,
        mimeType: rawMime,
        sizeBytes: rawBytes,
        base64: rawDataUrl,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        fileName: file.name,
        mimeType: rawMime,
        sizeBytes: rawBytes,
        base64: rawDataUrl,
      };
    }

    // Fill dark chart-friendly backdrop so transparent PNG regions render crisply in JPEG/WebP
    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const tryEncode = (mime: 'image/webp' | 'image/jpeg', quality: number): string | null => {
      try {
        const out = canvas.toDataURL(mime, quality);
        return out.startsWith(`data:${mime};base64,`) ? out : null;
      } catch {
        return null;
      }
    };

    const candidateFormats: Array<'image/webp' | 'image/jpeg'> = ['image/webp', 'image/jpeg'];
    let bestDataUrl: string | null = null;
    let bestBytes = rawBytes;

    for (const fmt of candidateFormats) {
      for (const q of [0.9, 0.84, 0.76]) {
        const encoded = tryEncode(fmt, q);
        if (!encoded) continue;
        const encodedBytes = estimateBase64DecodedBytes(encoded);
        if (encodedBytes > 0 && (bestDataUrl === null || encodedBytes < bestBytes)) {
          bestDataUrl = encoded;
          bestBytes = encodedBytes;
        }
        if (encodedBytes > 0 && encodedBytes <= SOFT_MAX_OPTIMIZED_BYTES) {
          break;
        }
      }
      if (bestDataUrl && bestBytes <= SOFT_MAX_OPTIMIZED_BYTES) {
        break;
      }
    }

    if (bestDataUrl && (resized || bestBytes < rawBytes)) {
      return {
        fileName: file.name,
        mimeType: extractMimeFromDataUrl(bestDataUrl, 'image/jpeg'),
        sizeBytes: bestBytes,
        base64: bestDataUrl,
      };
    }
  } catch {
    // Graceful fallback to original data URL if canvas/image decode fails
  }

  return {
    fileName: file.name,
    mimeType: rawMime,
    sizeBytes: rawBytes,
    base64: rawDataUrl,
  };
}
