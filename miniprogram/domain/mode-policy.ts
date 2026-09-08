import type { BackendPracticeMode, PracticeMode } from '../types/api';

export interface ModePolicy {
  id: PracticeMode;
  title: string;
  copy: string;
  showTimer: boolean;
  timerKind: 'none' | 'elapsed' | 'countdown';
  initialSeconds?: number;
  revealAfterAnswer: boolean;
  revealAfterComplete: boolean;
  allowPause: boolean;
  accent: 'green' | 'clay' | 'gold';
}

export const MODE_POLICIES: Record<PracticeMode, ModePolicy> = {
  normal: {
    id: 'normal', title: '普通练习', copy: '作答即看反馈，答完自动交卷', showTimer: false, timerKind: 'none',
    revealAfterAnswer: true, revealAfterComplete: true, allowPause: true, accent: 'green',
  },
  challenge: {
    id: 'challenge', title: '挑战模式', copy: '答错扣生命，生命归零仍可继续', showTimer: false, timerKind: 'none',
    revealAfterAnswer: false, revealAfterComplete: true, allowPause: true, accent: 'clay',
  },
  scholar: {
    id: 'scholar', title: '学霸模式', copy: '答对加时、答错扣时，生命归零结束', showTimer: true, timerKind: 'countdown', initialSeconds: 60,
    revealAfterAnswer: false, revealAfterComplete: true, allowPause: true, accent: 'gold',
  },
  revenge: {
    id: 'revenge', title: '错题复仇', copy: '重答原题，读完纠错后完成变式验证', showTimer: false, timerKind: 'none',
    revealAfterAnswer: true, revealAfterComplete: true, allowPause: true, accent: 'clay',
  },
};

export const MODE_CHOICES = [
  MODE_POLICIES.normal,
  MODE_POLICIES.challenge,
  MODE_POLICIES.scholar,
];

export function getModePolicy(mode: PracticeMode | BackendPracticeMode | string): ModePolicy {
  const key = mode === 'practice' ? 'normal' : mode;
  return MODE_POLICIES[key as PracticeMode] || MODE_POLICIES.normal;
}

export function formatTimer(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
