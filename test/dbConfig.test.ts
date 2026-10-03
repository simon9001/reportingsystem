import { describe, expect, it } from 'vitest'
import { dbUrl, mssqlConfig, readDbSettings } from '../src/lib/dbConfig'

const source = {
  DB_USER: 'sa',
  DB_PASSWORD: '@Pa;ss%w}rd',
  DB_SERVER: 'localhost',
  DB_DATABASE: 'shiftreporting',
  DB_PORT: '1433',
  DB_ENCRYPT: 'false',
  DB_TRUST_SERVER_CERTIFICATE: 'true',
}

describe('dbConfig', () => {
  it('builds a Prisma URL with the password wrapped in braces and } doubled', () => {
    expect(dbUrl(readDbSettings(source))).toBe(
      'sqlserver://localhost:1433;database=shiftreporting;user=sa;password={@Pa;ss%w}}rd};encrypt=false;trustServerCertificate=true',
    )
  })

  it('passes the raw password to the mssql driver', () => {
    const cfg = mssqlConfig(readDbSettings(source))
    expect(cfg).toMatchObject({ server: 'localhost', port: 1433, user: 'sa', password: '@Pa;ss%w}rd', options: { encrypt: false, trustServerCertificate: true } })
  })

  it('applies defaults and rejects missing values', () => {
    const { DB_PORT: _p, DB_ENCRYPT: _e, DB_TRUST_SERVER_CERTIFICATE: _t, ...minimal } = source
    expect(readDbSettings(minimal)).toMatchObject({ DB_PORT: 1433, DB_ENCRYPT: false, DB_TRUST_SERVER_CERTIFICATE: true })
    expect(() => readDbSettings({ ...source, DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/)
  })
})
