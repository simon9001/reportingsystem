import { describe, expect, it } from 'vitest'
import { LoginLimiter } from '../src/auth/rateLimit'

describe('LoginLimiter', () => {
  it('blocks after 5 failures within 15 minutes and forgets them afterwards', () => {
    let now = 0
    const limiter = new LoginLimiter(5, 15 * 60_000, () => now)
    for (let i = 0; i < 4; i++) limiter.recordFailure('a@x')
    expect(limiter.isBlocked('a@x')).toBe(false)
    limiter.recordFailure('a@x')
    expect(limiter.isBlocked('a@x')).toBe(true)
    expect(limiter.isBlocked('b@x')).toBe(false)
    now = 15 * 60_000 + 1
    expect(limiter.isBlocked('a@x')).toBe(false)
  })

  it('reset clears a key', () => {
    const limiter = new LoginLimiter(1, 60_000)
    limiter.recordFailure('a@x')
    limiter.reset('a@x')
    expect(limiter.isBlocked('a@x')).toBe(false)
  })

  it('does not grow for never-failed keys and prunes expired failures', () => {
    let now = 0
    const limiter = new LoginLimiter(5, 60_000, () => now)
    for (let i = 0; i < 100; i++) limiter.isBlocked(`k${i}@x`)
    expect(limiter.size).toBe(0)
    limiter.recordFailure('a@x')
    expect(limiter.size).toBe(1)
    now = 60_001
    expect(limiter.isBlocked('a@x')).toBe(false)
    expect(limiter.size).toBe(0)
  })
})
