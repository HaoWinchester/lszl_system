import type { PracticeQuestion, QuestionOption } from '../types/api';
import { sanitizeRichText } from './rich-text';

function text(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function httpsImages(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(text).filter(url => url.startsWith('https://'));
}

function optionText(value: unknown, id: string): string {
  const original = text(value);
  if (!/^[A-Za-z]$/.test(id)) return original;
  // Only explicit labels for this option; keep API, H.264 and quoted other labels.
  const prefix = new RegExp(`^(?:[（(]${id}[）)]\\s*|${id}(?:[.．]\\s+|[、:：)）]\\s*))`);
  return original.replace(prefix, '').trim() || original;
}

export function normalizeQuestion(rawValue: unknown): PracticeQuestion {
  const raw = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<string, any>;
  const parts = Array.isArray(raw.stemParts ?? raw.stem_parts) ? (raw.stemParts ?? raw.stem_parts) : [];
  const stem = text(raw.stem || parts.map((part: any) => String(part?.text || '')).join('') || raw.title);
  const stemEn = text(raw.stemEn || raw.stem_en || parts.map((part: any) => text(part?.textEn || part?.text_en)).filter(Boolean).join('\n'));
  const options: QuestionOption[] = (Array.isArray(raw.options) ? raw.options : []).map((option: any, index: number) => {
    const id = text(option?.id || option?.key || String.fromCharCode(65 + index));
    return {
      id, text: optionText(option?.text || option?.label, id),
      ...(text(option?.textEn || option?.text_en) ? { textEn: optionText(option?.textEn || option?.text_en, id) } : {}),
    };
  });
  return {
    id: text(raw.id || raw.questionId || raw.question_id),
    type: !raw.type || ['single_choice','scenario','case_analysis'].includes(raw.type) ? 'single_choice' : ['multiple_choice','matching'].includes(raw.type) ? raw.type : 'unknown',
    matching: raw.matching || raw.metadata?.matching,
    material: raw.material || raw.metadata?.material,
    caseGroup: raw.caseGroup || raw.metadata?.caseGroup,
    imageAssets: (Array.isArray(raw.images || raw.metadata?.images) ? (raw.images || raw.metadata.images) : []).filter((image: any) => image && typeof image === 'object' && /^\/api\/v1\/question-assets\/[\w-]+$/.test(String(image.url || ''))),
    stem,
    ...(stemEn ? { stemEn } : {}),
    stemNodes: sanitizeRichText(raw.stemNodes || raw.stem_nodes || stem),
    options,
    images: httpsImages(raw.images || raw.imageUrls || raw.image_urls),
    ...(raw.analysis != null ? { analysis: text(raw.analysis) } : {}),
    ...(raw.explanation != null ? { explanation: text(raw.explanation) } : {}),
    ...(raw.correctAnswer != null ? { correctAnswer: text(raw.correctAnswer) } : {}),
    ...(Array.isArray(raw.correctOptionIds) ? { correctOptionIds: raw.correctOptionIds.map(text) } : {}),
  };
}
