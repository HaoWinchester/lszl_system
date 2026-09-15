import { invalidateLearningPages } from '../domain/page-freshness';
import { request } from './http';

export interface GrowthDay { date: string; answered: number; goal: number; completed: boolean; isToday: boolean; }
export interface GrowthSummary {
  date: string;
  timezone: string;
  today: { answered: number; goal: number; completed: boolean };
  configuredGoal: number;
  goalEffectiveDate: string;
  currentStreak: number;
  longestStreak: number;
  totalCompletedDays: number;
  week: GrowthDay[];
  milestones: { days: number; unlocked: boolean }[];
}
export const getGrowthSummary = () => request<GrowthSummary>({ path: '/api/v1/learning/practice/growth' });
export async function updateGrowthGoal(goal: number): Promise<GrowthSummary> {
  const summary = await request<GrowthSummary>({ path: '/api/v1/learning/practice/growth/goal', method: 'PUT', data: { goal } });
  invalidateLearningPages();
  return summary;
}
