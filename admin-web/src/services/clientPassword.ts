/** Mirrors mobile `client_login_gate.dart` PBKDF2-HMAC-SHA256 (single output block). */

const PASSWORD_ITERATIONS_DEFAULT = 64000

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(data))
  return new Uint8Array(sig)
}

async function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  const block = new Uint8Array(salt.length + 4)
  block.set(salt, 0)
  block[salt.length] = 0
  block[salt.length + 1] = 0
  block[salt.length + 2] = 0
  block[salt.length + 3] = 1

  let u = await hmacSha256(passwordBytes, block)
  const t = new Uint8Array(u)
  for (let i = 1; i < iterations; i++) {
    u = await hmacSha256(passwordBytes, u)
    for (let j = 0; j < t.length; j++) t[j] ^= u[j]!
  }
  return t
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function hasClientPasswordSet(data: Record<string, unknown>): boolean {
  if ((data.appPasswordHash ?? "").toString().trim()) return true
  return (data.appPassword ?? "").toString().trim().length > 0
}

export async function verifyClientPasswordData(
  data: Record<string, unknown>,
  password: string,
): Promise<boolean> {
  const storedHash = (data.appPasswordHash ?? "").toString()
  if (storedHash) {
    const salt = hexToBytes((data.appPasswordSalt ?? "").toString())
    const iter = Number(data.appPasswordIter) || PASSWORD_ITERATIONS_DEFAULT
    const computed = bytesToHex(await pbkdf2Sha256(password, salt, iter))
    return constantTimeEquals(computed, storedHash)
  }
  const legacy = (data.appPassword ?? "").toString()
  return legacy.length > 0 && legacy === password
}
