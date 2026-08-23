/* ───────────────────────────────────────────────────────────────────────────
   GET /api/releases[?channel=stable]

   Returns the newest published build per platform. The browser never receives
   a Supabase key; this function performs the least-privilege read server-side.
   ─────────────────────────────────────────────────────────────────────────── */
const CHANNELS = ['stable', 'beta'];

export default async (req) => {
  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') || 'stable';
  if (!CHANNELS.includes(channel)) return json({ error: 'unknown channel' }, 400);

  const base = Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY') || Netlify.env.get('SUPABASE_ANON_KEY');
  if (!base || !key) return json({ error: 'server not configured' }, 500);

  const q = `${base}/rest/v1/releases`
    + `?select=version,codename,platform,file_size,sha256,release_notes,released_at`
    + `&is_published=eq.true&channel=eq.${channel}`
    + `&order=released_at.desc`;

  let rows;
  try {
    const res = await fetch(q, { headers: { apikey: key } });
    if (!res.ok) return json({ error: 'lookup failed' }, 502);
    rows = await res.json();
  } catch {
    return json({ error: 'lookup failed' }, 502);
  }

  const seen = new Map();
  for (const r of rows) if (!seen.has(r.platform)) seen.set(r.platform, r);

  const builds = [...seen.values()].map(r => ({
    platform: r.platform,
    size: r.file_size || null,
    sha256: r.sha256,
    released_at: r.released_at
  }));
  const newest = rows[0] || null;

  return new Response(JSON.stringify({
    version: newest ? newest.version : null,
    codename: newest ? newest.codename : null,
    notes: newest ? newest.release_notes : null,
    builds
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60'
    }
  });
};

export const config = { path: '/api/releases' };

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
