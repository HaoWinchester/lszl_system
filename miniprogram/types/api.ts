export type PracticeMode = 'normal' | 'challenge' | 'scholar' | 'revenge';
export type BackendPracticeMode = 'practice' | 'challenge' | 'scholar' | 'revenge';
export type PracticeOrder = 'paper' | 'random';

export interface PaperSummary {
  paperId: string;
  releaseId: string;
  version: number;
  title: string;
  subject: string;
  description: string;
  questionCount: number;
  accessLevel: 'free' | 'member';
  contentRestricted: boolean;
  enabledModes: string[];
  publishedAt: number | string | null;
}

export interface QuestionOption {
  id: string;
  text: string;
  textEn?: string;
}

export interface PracticeQuestion {
  id: string;
  type: 'single_choice' | 'multiple_choice';
  stem: string;
  stemEn?: string;
  stemNodes: unknown[];
  options: QuestionOption[];
  images: string[];
  analysis?: string;
  explanation?: string;
  correctAnswer?: string;
  correctOptionIds?: string[];
}

export interface SessionQuestion {
  questionId: string;
  bankId?: string;
  question: PracticeQuestion;
}

export interface PracticeSession {
  id: string;
  paperId?: string;
  releaseId?: string;
  paperName?: string;
  mode: BackendPracticeMode;
  order?: PracticeOrder;
  status: string;
  revision: number;
  currentIndex?: number;
  questions: SessionQuestion[];
  markedQuestionIds?: string[];
  answers?: Record<string, Record<string, unknown>>;
  runtimeState?: Record<string, any>;
  stats?: { total?: number; answered?: number; correct?: number; wrong?: number };
  remainingMs?: number;
  updatedAt?: number | string;
}

export interface StartSessionInput {
  paperId: string;
  releaseId: string;
  mode: PracticeMode;
  count: number;
  order: PracticeOrder;
}

export interface SessionWriteInput {
  revision: number;
  requestId?: string;
  [key: string]: unknown;
}

export interface PracticeReport {
  sessionId?: string;
  accuracy?: number;
  score?: number;
  durationMs?: number;
  experience?: number;
  wrongQuestions?: unknown[];
  weakDomains?: unknown[];
  [key: string]: unknown;
}
