import { banksApi, papersApi, type Bank, type Paper, type Question } from '../api/questions'
import { learningApi } from '../api/learning'
import type { NewLegacyFrameAdapter, NewLegacyMessage } from './newLegacyBridge'

const BANKS_PREFIX = 'kg_question_banks_v1__'
const CURRENT_BANK_PREFIX = 'kg_question_current_v1__'
const PAPERS_PREFIX = 'kg_exam_papers_v1__'
const CURRENT_PAPER_PREFIX = 'kg_exam_current_v1__'
const SESSIONS_PREFIX = 'kg_learning_sessions_v2__'
const EVENTS_PREFIX = 'kg_learning_events_v1__'

function timestamp(value: string | null | undefined): number {
  if (!value) return Date.now()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function frameQuestion(question: Question): Record<string, unknown> {
  return {
    ...question,
    stem: question.stemParts.map((part) => part.text).join(''),
    createdAt: timestamp(question.createdAt),
    updatedAt: timestamp(question.updatedAt),
  }
}

async function questionsFor(bank: Bank): Promise<Record<string, unknown>[]> {
  const questions: Question[] = []
  let page = 1
  let total = 0
  do {
    const result = await banksApi.listQuestions(bank.id, { page, page_size: 100 })
    questions.push(...result.questions)
    total = result.total
    page += 1
  } while (questions.length < total)
  return questions.map(frameQuestion)
}

function framePaper(paper: Paper): Record<string, unknown> {
  return {
    ...paper,
    publishedAt: timestamp(paper.publishedAt),
    updatedAt: timestamp(paper.createdAt),
    questions: (paper.questions ?? []).map((question, index) => ({
      bankId: question.bankId,
      questionId: question.id,
      order: index + 1,
      score: 1,
    })),
  }
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseList(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      : []
  } catch {
    return []
  }
}

class TrainingFrameAdapter implements NewLegacyFrameAdapter {
  private knownEventIds = new Set<string>()
  private knownQuestionIds = new Set<string>()

  async load(username: string | null): Promise<Record<string, unknown>> {
    this.knownEventIds.clear()
    this.knownQuestionIds.clear()
    if (!username) return { storage: {} }

    const banks = await banksApi.list()
    const banksWithQuestions = await Promise.all(banks.map(async (bank) => ({
      ...bank,
      version: '1.0',
      visibility: 'private',
      createdAt: timestamp(bank.createdAt),
      updatedAt: timestamp(bank.updatedAt),
      questions: await questionsFor(bank),
    })))
    const paperSummaries = await papersApi.list('published')
    const papers = await Promise.all(paperSummaries.map((paper) => papersApi.get(paper.id)))
    const questionIds = [...new Set(banksWithQuestions.flatMap((bank) => bank.questions.map((question) => String(question.id))))]
    questionIds.forEach((questionId) => this.knownQuestionIds.add(questionId))
    const sessionPairs = await Promise.all(questionIds.map(async (questionId) => {
      try {
        return [questionId, await learningApi.getSession(questionId)] as const
      } catch {
        return [questionId, null] as const
      }
    }))
    const sessions = Object.fromEntries(sessionPairs.filter(([, session]) => Boolean(session)))
    let events: Record<string, unknown>[] = []
    try {
      const serverEvents = await learningApi.listEvents({ page: 1, page_size: 100 })
      events = (serverEvents as Record<string, unknown>[]).map((event) => ({
        id: event.id,
        type: event.eventType,
        userId: username,
        questionId: event.questionId ?? '',
        sessionId: (event.payload as Record<string, unknown> | undefined)?.sessionId ?? '',
        payload: event.payload ?? {},
        occurredAt: timestamp(typeof event.createdAt === 'string' ? event.createdAt : null),
      }))
      events.forEach((event) => this.knownEventIds.add(String(event.id ?? '')))
    } catch {
      events = []
    }

    const scope = `user__${encodeURIComponent(username)}`
    const encodedUser = encodeURIComponent(username)
    const storage: Record<string, string> = {
      [`${BANKS_PREFIX}${scope}`]: JSON.stringify(banksWithQuestions),
      [`${PAPERS_PREFIX}${scope}`]: JSON.stringify(papers.map(framePaper)),
      [`${SESSIONS_PREFIX}${encodedUser}`]: JSON.stringify({
        version: 2,
        userId: username,
        sessions,
        updatedAt: Date.now(),
      }),
      [`${EVENTS_PREFIX}${encodedUser}`]: JSON.stringify(events),
    }
    const firstBank = banksWithQuestions[0]
    if (firstBank) storage[`${CURRENT_BANK_PREFIX}${scope}`] = JSON.stringify({ bankId: firstBank.id, index: 0 })
    const firstPaper = papers[0]
    if (firstPaper) storage[`${CURRENT_PAPER_PREFIX}${scope}`] = JSON.stringify({ paperId: firstPaper.id, index: 0 })
    return { storage }
  }

  async onMessage(message: NewLegacyMessage, username: string | null): Promise<void> {
    if (!username || message.type !== 'state:changed') return
    const key = typeof message.payload.key === 'string' ? message.payload.key : ''
    const value = message.payload.value
    const encodedUser = encodeURIComponent(username)

    if (key === `${SESSIONS_PREFIX}${encodedUser}`) {
      const bucket = parseRecord(value)
      const sessions = bucket?.sessions
      if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
        await Promise.all(Object.entries(sessions).map(([questionId, session]) => (
          this.knownQuestionIds.has(questionId) && session && typeof session === 'object' && !Array.isArray(session)
            ? learningApi.saveSession(questionId, session as Record<string, unknown>)
            : Promise.resolve()
        )))
      }
    }

    if (key === `${EVENTS_PREFIX}${encodedUser}`) {
      for (const event of parseList(value).reverse()) {
        const id = String(event.id ?? '')
        if (!id || this.knownEventIds.has(id)) continue
        const questionId = String(event.questionId ?? '')
        await learningApi.appendEvent({
          questionId: this.knownQuestionIds.has(questionId) ? questionId : undefined,
          eventType: String(event.type ?? 'UNKNOWN'),
          payload: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : {},
        })
        this.knownEventIds.add(id)
      }
    }
  }
}

export const trainingFrameAdapter = new TrainingFrameAdapter()
