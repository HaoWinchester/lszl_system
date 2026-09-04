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
    id: 'normal', title: '普通练习', copy: '提交后即可查看答案与解析', showTimer: false, timerKind: 'none',
    revealAfterAnswer: true, revealAfterComplete: true, allowPause: true, accent: 'green',
  },
  challenge: {
    id: 'challenge', title: '挑战模式', copy: '记录总用时，交卷后统一查看结果', showTimer: true, timerKind: 'elapsed',
    revealAfterAnswer: false, revealAfterComplete: true, allowPause: false, accent: 'clay',
  },
  scholar: {
    id: 'scholar', title: '学霸模式', copy: '每题 60 秒，超时自动记为未答', showTimer: true, timerKind: 'countdown', initialSeconds: 60,
    revealAfterAnswer: false, revealAfterComplete: true, allowPause: false, accent: 'gold',
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
