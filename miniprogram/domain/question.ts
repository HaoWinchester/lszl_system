import { PracticeQuestion, QuestionOption } from '../types/api';
import { sanitizeRichText } from './rich-text';

function text(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function httpsImages(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(text).filter(url => url.startsWith('https://'));
}

export function normalizeQuestion(rawValue: unknown): PracticeQuestion {
  const raw = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<string, any>;
  const parts = Array.isArray(raw.stemParts ?? raw.stem_parts) ? (raw.stemParts ?? raw.stem_parts) : [];
  const stem = text(raw.stem || raw.title || parts.map((part: any) => text(part?.text)).join('\n'));
  const stemEn = text(raw.stemEn || raw.stem_en || parts.map((part: any) => text(part?.textEn || part?.text_en)).filter(Boolean).join('\n'));
  const options: QuestionOption[] = (Array.isArray(raw.options) ? raw.options : []).map((option: any, index: number) => ({
    id: text(option?.id || option?.key || String.fromCharCode(65 + index)),
    text: text(option?.text || option?.label),
    ...(text(option?.textEn || option?.text_en) ? { textEn: text(option?.textEn || option?.text_en) } : {}),
  }));
  return {
    id: text(raw.id || raw.questionId || raw.question_id),
    type: raw.type === 'multiple_choice' ? 'multiple_choice' : 'single_choice',
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
