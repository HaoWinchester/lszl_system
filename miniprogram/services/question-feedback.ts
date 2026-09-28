import { showDialog } from '../domain/dialog';
import { messageOf, request } from './http';

export interface QuestionFeedbackContext {
  questionId: string;
  paperId?: string;
  releaseId?: string;
  sessionId?: string;
}

// Reuse the feedback inbox; frozen identifiers locate the exact published content.
export async function reportQuestionContent(context: QuestionFeedbackContext, missing: boolean): Promise<boolean> {
  if (!context.questionId) return false;
  const title = missing ? '题目解析缺失' : '题目解析需要核对';
  const labels: Record<string, string> = { questionId: '题目 ID', paperId: '试卷 ID', releaseId: '发布版本 ID', sessionId: '练习 ID' };
  const references = Object.entries(labels).map(([key, label]) => `${label}：${context[key as keyof QuestionFeedbackContext] || '未提供'}`).join('\n');
  const decision = await showDialog({ title, content: `将反馈当前题目与试卷版本，供管理员核对。\n${references}`, confirmText: '提交反馈', cancelText: '取消' });
  if (!decision.confirm) return false;
  try {
    await request({ path: '/api/v1/engagement/feedback', method: 'POST', data: {
      type: 'content', title, detail: `${title}，请核对已发布内容。\n${references}`, page: 'miniprogram/question-review',
    } });
    await showDialog({ title: '反馈已提交', content: '管理员会核对这道题的解析。你的答案和练习进度保持不变。', showCancel: false });
    return true;
  } catch (error) {
    await showDialog({ title: '反馈未提交', content: `${messageOf(error)}，可再次点击反馈重试。`, showCancel: false });
    return false;
  }
}
