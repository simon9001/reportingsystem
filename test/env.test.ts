import { describe, expect, it } from 'vitest'
import { envSchema } from '../src/lib/env'

describe('SMTP env parsing', () => {
  it('treats blank SMTP values as unset', () => {
    const r = envSchema.safeParse({ ...process.env, SR_SMTP_HOST: '', SR_SMTP_PORT: '', SR_SMTP_SECURE: '', SR_SMTP_USER: '', SR_SMTP_PASSWORD: '', SR_SMTP_FROM: '' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.SR_SMTP_HOST).toBeUndefined()
    expect(r.data.SR_SMTP_PORT).toBe(587)
    expect(r.data.SR_SMTP_SECURE).toBe(false)
  })

  it('parses explicit secure and port', () => {
    const r = envSchema.safeParse({ ...process.env, SR_SMTP_SECURE: 'true', SR_SMTP_PORT: '465' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.SR_SMTP_SECURE).toBe(true)
    expect(r.data.SR_SMTP_PORT).toBe(465)
  })
})
