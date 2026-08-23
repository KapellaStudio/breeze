/* ───────────────────────────────────────────────────────────────────────────
   POST /api/waitlist   { email, platform_hint? }

   Stores an email and nothing else. Netlify holds no Supabase admin key; it
   calls the narrow Breeze Ops Edge Function with a Breeze-only token. The
   Supabase project URL fallback is public infrastructure metadata, not a
   credential, and keeps the waitlist path resilient to Netlify env injection
   issues. The Breeze Ops token remains private and is never committed.
   ─────────────────────────────────────────────────────────────────────────── */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HINTS = ['macos', 'windows', 'linux', 'mobile'];
const PUBLIC_SUPABASE_URL = 'https://iyyuxzfjkrtqqixqzsrr.supabase.co';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'bad request' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const hint = HINTS.includes(body.platform_hint) ? body.platform_hint : null;
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: 'invalid email' }, 400);

  const base = Netlify.env.get('SUPABASE_URL') || PUBLIC_SUPABASE_URL;
  const token = Netlify.env.get('BREEZE_OPS_TOKEN');
  if (!token) return json({ error: 'server not configured' }, 500);

  let res;
  try {
    res = await fetch(`${base}/functions/v1/breeze-ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-breeze-ops': token },
      body: JSON.stringify({ action: 'waitlist', email, platform_hint: hint })
    });
  } catch {
    return json({ error: 'could not save' }, 502);
  }

  if (!res.ok) return json({ error: 'could not save' }, 502);
  return json({ ok: true }, 200);
};

export const config = { path: '/api/waitlist' };

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
