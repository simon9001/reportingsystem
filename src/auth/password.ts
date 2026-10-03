import { hash, verify } from '@node-rs/argon2'

export function hashPassword(password: string): Promise<string> {
  return hash(password) // argon2id with library defaults
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> = createDummyHash()

function createDummyHash(): Promise<string> {
  const p = hashPassword('not-a-real-password-for-timing')
  p.catch(() => {
    if (dummyHash === p) dummyHash = createDummyHash()
  })
  return p
}

/** Spends the same time as a real check so unknown emails cannot be detected by timing. */
export async function burnPasswordCheck(password: string): Promise<false> {
  await verifyPassword(await dummyHash, password)
  return false
}
