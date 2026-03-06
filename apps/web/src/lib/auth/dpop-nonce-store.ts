import "server-only";

const SWEEP_INTERVAL_MS = 60_000;

class DpopNonceStore {
  private readonly nonces = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlSeconds?: number) {
    this.ttlMs = (ttlSeconds ?? 30) * 1000;
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  issue(): string {
    const nonce = crypto.randomUUID();
    this.nonces.set(nonce, Date.now() + this.ttlMs);
    return nonce;
  }

  validate(nonce: string): boolean {
    const expiresAt = this.nonces.get(nonce);
    if (expiresAt === undefined) {
      return false;
    }
    this.nonces.delete(nonce);
    return Date.now() < expiresAt;
  }

  private sweep() {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (now >= expiresAt) {
        this.nonces.delete(nonce);
      }
    }
  }
}

let instance: DpopNonceStore | undefined;

export function getDpopNonceStore(ttlSeconds?: number): DpopNonceStore {
  if (!instance) {
    instance = new DpopNonceStore(ttlSeconds);
  }
  return instance;
}
