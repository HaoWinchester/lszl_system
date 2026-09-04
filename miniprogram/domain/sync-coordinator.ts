export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict';
export type ConflictChoice = 'server' | 'local';

export interface SyncJob {
  sessionId: string;
  key: string;
  action: string;
  payload: Record<string, unknown>;
}

type Executor = (job: SyncJob) => Promise<unknown>;

export function classifyFailure(error: any): 'offline' | 'auth' | 'conflict' | 'error' {
  if (Number(error?.statusCode ?? error?.status) === 0 || error?.code === 'NETWORK_ERROR') return 'offline';
  if (Number(error?.statusCode ?? error?.status) === 401) return 'auth';
  if (Number(error?.statusCode ?? error?.status) === 409 || String(error?.code || '').includes('REVISION_CONFLICT')) return 'conflict';
  return 'error';
}

export function resolveConflict<T extends { revision: number }>(
  serverDraft: T,
  localDraft: T,
  choice: ConflictChoice,
): T {
  return choice === 'server'
    ? serverDraft
    : { ...localDraft, revision: serverDraft.revision };
}

export function createSyncCoordinator(execute: Executor) {
  const chains = new Map<string, Promise<unknown>>();
  const pending = new Map<string, SyncJob>();
  const blocked = new Map<string, unknown>();

  function remember(job: SyncJob) {
    const identity = `${job.sessionId}\0${job.key}`;
    if (!pending.has(identity)) pending.set(identity, job);
  }

  function enqueueWrite<T = unknown>(job: SyncJob): Promise<T> {
    const previous = chains.get(job.sessionId) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      if (blocked.has(job.sessionId)) {
        remember(job);
        throw blocked.get(job.sessionId);
      }
      try {
        return await execute(job) as T;
      } catch (error) {
        if (classifyFailure(error) === 'offline') {
          remember(job);
          blocked.set(job.sessionId, error);
        }
        throw error;
      }
    });
    chains.set(job.sessionId, operation);
    operation.then(
      () => { if (chains.get(job.sessionId) === operation) chains.delete(job.sessionId); },
      () => { if (chains.get(job.sessionId) === operation) chains.delete(job.sessionId); },
    );
    return operation;
  }

  async function retryPending(): Promise<unknown[]> {
    const jobs = [...pending.values()];
    pending.clear();
    for (const job of jobs) blocked.delete(job.sessionId);
    const results: unknown[] = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      try {
        results.push(await execute(job));
      } catch (error) {
        if (classifyFailure(error) === 'offline') {
          blocked.set(job.sessionId, error);
          for (const remaining of jobs.slice(index)) remember(remaining);
        }
        throw error;
      }
    }
    return results;
  }

  return {
    enqueueWrite,
    retryPending,
    pendingCount: () => pending.size,
    stateFor: (sessionId: string): SyncState => blocked.has(sessionId) ? 'offline' : chains.has(sessionId) ? 'saving' : 'idle',
  };
}
