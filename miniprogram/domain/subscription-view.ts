import type { SubscriptionState } from '../services/subscription';

const PLAN_NAMES: Record<string, string> = { free: '基础权限', monthly: '月度会员', quarterly: '季度会员', half_year: '半年会员', lifetime: '终身会员' };

function expiry(value?: string | null) {
  if (!value) return { time: NaN, label: '待确认' };
  // The backend's naive timestamps are UTC; never interpret them as device-local time.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) return { time, label: '待确认' };
  const china = new Date(time + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { time, label: `${china.getUTCFullYear()}.${pad(china.getUTCMonth() + 1)}.${pad(china.getUTCDate())} ${pad(china.getUTCHours())}:${pad(china.getUTCMinutes())}` };
}

export function subscriptionView(role: string, state?: SubscriptionState) {
  if (role === 'admin' || role === 'teacher') return { title: '教学账号', statusLabel: '全部试卷已开放', expiryLabel: '不受会员期限限制', description: '当前账号具有教学权限，可访问全部试卷。' };
  if (role === 'viewer') return { title: '访客账号', statusLabel: '访客权限', expiryLabel: '不适用', description: '当前为访客身份，访问范围由账号权限决定。' };
  const sub = state?.subscription;
  if (!sub?.planId) return { title: '会员信息', statusLabel: '待确认', expiryLabel: '待确认', description: '会员信息尚未获取，请重新同步。' };
  const title = PLAN_NAMES[sub.planId] || sub.planId;
  if (sub.planId === 'free') return { title, statusLabel: '未开通', expiryLabel: '未开通', description: '当前账号可练习免费试卷，学习记录正常保留。' };
  const end = expiry(sub.expiresAt);
  const entitled = state?.entitlements?.allExamPapers === true;
  const statusLabel = sub.status === 'disabled' || sub.status === 'suspended' ? '已停用'
    : sub.status === 'paused' ? '已暂停'
    : sub.status === 'expired' || end.time <= Date.now() ? '已到期'
    : sub.status === 'active' && entitled ? '生效中' : '待确认';
  return { title, statusLabel,
    expiryLabel: sub.planId === 'lifetime' && !sub.expiresAt && sub.status === 'active' && entitled ? '长期有效' : end.label,
    description: statusLabel === '生效中' ? '会员试卷已开放，与网页端共用同一份权益。'
      : statusLabel === '已到期' ? '会员已到期，已有练习记录仍会保留。'
      : statusLabel === '已暂停' ? '会员权限已暂停，已有练习记录仍会保留，请联系管理员核实。'
      : statusLabel === '已停用' ? '会员权限已停用，请联系管理员核实。' : '会员权限待确认，请重新同步。',
  };
}
