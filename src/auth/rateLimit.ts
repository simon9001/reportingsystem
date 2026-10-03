export class LoginLimiter {
  private readonly failures = new Map<string, number[]>()

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff)
    this.failures.set(key, list)
    return list
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max
  }

  recordFailure(key: string): void {
    this.recent(key).push(this.now())
  }

  reset(key: string): void {
    this.failures.delete(key)
  }

  clear(): void {
    this.failures.clear()
  }
}

export const loginLimiter = new LoginLimiter()
