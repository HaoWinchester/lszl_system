import type { GrowthSummary } from '../services/growth';

export const GROWTH_GOALS = [5, 10, 20, 30];
// All dates and achievement flags come from the server's Asia/Shanghai calendar.
// This layer formats presentation only; it never awards or persists progress.
export function growthView(summary: GrowthSummary) {
  const { today } = summary;
  return {
    percent: Math.min(100, Math.round(today.answered / Math.max(1, today.goal) * 100)),
    remaining: Math.max(0, today.goal - today.answered),
    weekCompleted: summary.week.filter(day => day.completed).length,
    weekAnswered: summary.week.reduce((sum, day) => sum + day.answered, 0),
    goalNotice: summary.goalEffectiveDate > summary.date
      ? `${summary.goalEffectiveDate} 起生效；今天仍以 ${today.goal} 题为目标。`
      : '目标调整从次日生效，今天与过去的记录保持不变。',
    week: summary.week.map((day, index) => ({ ...day, weekday: ['一', '二', '三', '四', '五', '六', '日'][index], dayLabel: day.date.slice(8), future: day.date > summary.date })),
    milestones: summary.milestones.map(item => ({ ...item, label: item.unlocked ? '已达成' : `还差 ${Math.max(0, item.days - summary.longestStreak)} 天` })),
  };
}
