export class UpstreamQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(
    private readonly gapMs: number,
    private readonly maxWaitMs: number,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > this.maxWaitMs) {
        throw new Error("RATE_LIMIT");
      }
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.last = Date.now();
      return task();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const osrmQueue = new UpstreamQueue(1100, 3500);
export const nominatimQueue = new UpstreamQueue(1100, 3500);
export const overpassQueue = new UpstreamQueue(2000, 5000);

const recent = new Map<string, { at: number; body: unknown; status: number }>();

export function remember(key: string, status: number, body: unknown): void {
  recent.set(key, { at: Date.now(), body, status });
  if (recent.size > 100) {
    const oldest = [...recent.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) recent.delete(oldest[0]);
  }
}

export function recall(key: string, ttlMs = 60_000): { status: number; body: unknown } | undefined {
  const hit = recent.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    recent.delete(key);
    return undefined;
  }
  return { status: hit.status, body: hit.body };
}
