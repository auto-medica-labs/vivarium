export class RateLimiter {
  private readonly windowMs = 60 * 1000;
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(private readonly limit: number) {
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  isAllowed(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = this.entries.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(ip, entry);
    }

    entry.count++;

    if (entry.count > this.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }
    return { allowed: true };
  }

  reset(): void {
    this.entries.clear();
  }

  stop(): void {
    clearInterval(this.cleanupInterval);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (now > entry.resetAt) {
        this.entries.delete(ip);
      }
    }
  }
}
