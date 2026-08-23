/* ═══════════════════════════════════════════════════════════════════════════
   BREEZE OPS — narrow privileged backend seam

   Netlify never receives a Supabase secret/service-role key. It holds one
   random Breeze-only token. This function validates that token, then uses the
   secret key Supabase injects into Edge Functions to perform exactly two
   privileged operations: waitlist insert and aggregate download counting.

   The token itself is NEVER committed. Only its SHA-256 digest is here.
   ═══════════════════════════════════════════════════════════════════════════ */

const TOKEN_SHA256S = new Set([
  'bd8dec2243730b53df4d5e59d5ba025bfe9c5dd84b22e073cab4c9ebc99f25ba', // current production Netlify token
])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const HINTS = new Set(['macos', 'windows', 'linux', 'mobile'])
const PLATFORMS = new Set(['macos-arm', 'macos-x64', 'windows-x64', 'linux-x64'])

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function authorized(req: Request) {
  const token = req.headers.get('x-breeze-ops') || ''
  if (token.length < 32 || token.length > 256) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const candidate = hex(digest)
  let matched = false
  for (const expected of TOKEN_SHA256S) matched = constantTimeEqual(candidate, expected) || matched
  return matched
}

function adminKey() {
  try {
    const current = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    if (typeof current.default === 'string' && current.default) return current.default
  } catch {}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

function adminHeaders(key: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { apikey: key, ...extra }
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`
  return headers
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401)

  const base = Deno.env.get('SUPABASE_URL') || ''
  const key = adminKey()
  if (!base || !key) return json({ error: 'server not configured' }, 500)

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return json({ error: 'bad request' }, 400) }

  if (body.action === 'waitlist') {
    const email = String(body.email || '').trim().toLowerCase()
    const rawHint = String(body.platform_hint || '')
    const platform_hint = HINTS.has(rawHint) ? rawHint : null
    if (email.length > 254 || !EMAIL.test(email)) return json({ error: 'invalid email' }, 400)

    const res = await fetch(`${base}/rest/v1/waitlist`, {
      method: 'POST',
      headers: adminHeaders(key, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      }),
      body: JSON.stringify({ email, platform_hint }),
    })
    if (!res.ok && res.status !== 409) return json({ error: 'could not save' }, 502)
    return json({ ok: true })
  }

  if (body.action === 'record_download') {
    const platform = String(body.platform || '')
    const version = String(body.version || '').trim()
    if (!PLATFORMS.has(platform) || !version || version.length > 64) return json({ error: 'invalid download record' }, 400)

    const res = await fetch(`${base}/rest/v1/rpc/record_download`, {
      method: 'POST',
      headers: adminHeaders(key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_platform: platform, p_version: version }),
    })
    if (!res.ok) return json({ error: 'could not count' }, 502)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
})
