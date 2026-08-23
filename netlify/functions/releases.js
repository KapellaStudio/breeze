/* ───────────────────────────────────────────────────────────────────────────
   GET /api/releases[?channel=stable]

   What the download section reads to decide whether there is anything to
   download. Returns the newest published build per platform, with the size
   and the SHA-256 so the page can show a user exactly what they are about to
   install before they click.

   This exists as a function rather than a direct Supabase call from the page
   for two reasons. The site's CSP is `connect-src 'self'`, so the browser
   cannot reach supabase.co at all — correctly, since a download page that can
   phone a third party is a download page that can be made to phone anywhere.
   And no key of any kind reaches the browser this way.

   No release rows yet is not an error. It returns an empty list, and the page
   renders the waitlist instead. That is the intended pre-launch state.
   ─────────────────────────────────────────────────────────────────────────── */
const CHANNELS = ['stable', 'beta'];

export default async (req) => {
  const url     = new URL(req.url);
  const channel = url.searchParams.get('channel') || 'stable';
  if (!CHANNELS.includes(channel)) return json({ error: 'unknown channel' }, 400);

  const base = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
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

  // Newest per platform. The query is already newest-first, so the first row
  // seen for a platform wins.
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
    version:  newest ? newest.version  : null,
    codename: newest ? newest.codename : null,
    notes:    newest ? newest.release_notes : null,
    builds
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Short cache: publishing a release should show up in a minute, not on
      // the next deploy, but every visitor should not hit Supabase either.
      'Cache-Control': 'public, max-age=60, s-maxage=60'
    }
  });
};

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
