import {
  renderRecipeSchema,
  type RenderRecipe,
  type ServerRenderError,
  type WorkerClaim,
  type WorkerJobUrls,
  type WorkerOutputTicket,
  type WorkerOutputsRequest,
} from '@immersia/shared/render';

/** The jobs API of the web app, as the worker uses it (everything behind the shared secret). */
export interface WorkerApi {
  claim(): Promise<ClaimedJob | null>;
  heartbeat(jobId: string, claimToken: string): Promise<'ok' | 'lease_lost' | 'timeout'>;
  registerOutputs(
    jobId: string,
    claimToken: string,
    outputs: WorkerOutputsRequest['outputs'],
  ): Promise<WorkerOutputTicket[] | 'lease_lost'>;
  complete(jobId: string, claimToken: string, renderMs: number): Promise<'ok' | 'lease_lost' | 'incomplete'>;
  /** Report a failed try. False: the job is not this worker's any more. */
  fail(jobId: string, claimToken: string, code: ServerRenderError): Promise<boolean>;
}

export interface ClaimedJob {
  id: string;
  claimToken: string;
  attempts: number;
  maxAttempts: number;
  leaseMs: number;
  recipe: RenderRecipe;
  urls: WorkerJobUrls;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Network errors and 5xx/429 are retried a few times; other answers are final. */
const retryable = (status: number) => status === 429 || status >= 500;

export function createApi(
  cfg: { apiUrl: string; secret: string; workerId: string },
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = 1_000,
): WorkerApi {
  async function call(path: string, body: unknown, acceptStatuses: number[] = []) {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(retryDelayMs * 3 ** (attempt - 1));
      try {
        const res = await fetchImpl(`${cfg.apiUrl}/api/render-worker${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok || acceptStatuses.includes(res.status)) return { status: res.status, json };
        last = new ApiError(res.status, typeof json.error === 'string' ? json.error : `http_${res.status}`);
        if (!retryable(res.status)) throw last;
      } catch (err) {
        if (err instanceof ApiError && !retryable(err.status)) throw err;
        last = err;
      }
    }
    throw last;
  }

  return {
    async claim() {
      const { json } = await call('/claim', { workerId: cfg.workerId });
      const job = (json as unknown as WorkerClaim).job;
      if (!job) return null;
      // The recipe crosses a trust boundary like any other input: validated here, not assumed.
      const recipe = renderRecipeSchema.safeParse(job.recipe);
      if (!recipe.success) {
        // The server validated it too; a mismatch means the two are different versions. Fail it for good.
        await call(`/jobs/${job.id}/fail`, { claimToken: job.claimToken, code: 'invalid_recipe' }, [409]);
        return null;
      }
      return { ...job, recipe: recipe.data };
    },

    async heartbeat(jobId, claimToken) {
      const { status, json } = await call(`/jobs/${jobId}/heartbeat`, { claimToken }, [409]);
      if (status === 200) return 'ok';
      return json.error === 'timeout' ? 'timeout' : 'lease_lost';
    },

    async registerOutputs(jobId, claimToken, outputs) {
      const { status, json } = await call(`/jobs/${jobId}/outputs`, { claimToken, outputs }, [409]);
      if (status !== 200) return 'lease_lost';
      return (json as { uploads: WorkerOutputTicket[] }).uploads;
    },

    async complete(jobId, claimToken, renderMs) {
      const { status, json } = await call(`/jobs/${jobId}/complete`, { claimToken, renderMs }, [409]);
      if (status === 200) return 'ok';
      return json.error === 'incomplete' ? 'incomplete' : 'lease_lost';
    },

    async fail(jobId, claimToken, code) {
      const { status } = await call(`/jobs/${jobId}/fail`, { claimToken, code }, [409]);
      return status === 200;
    },
  };
}
