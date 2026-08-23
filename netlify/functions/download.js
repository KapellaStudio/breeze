/* ───────────────────────────────────────────────────────────────────────────
   GET /download?platform=macos-arm[&channel=stable]

   Looks up the newest published build, records an AGGREGATE count, and
   redirects to the file. The counter deliberately stores no identifier — not
   an IP, not a user agent hash. A privacy browser cannot log its own users.
   ─────────────────────────────────────────────────────────────────────────── */
const PLATFORMS = ['macos-arm', 'macos-x64', 'windows-x64', 'linux-x64'];
const CHANNELS  = ['stable', 'beta'];

export default async (req) => {
  const url      = new URL(req.url);
  const platform = url.searchParams.get('platform') || '';
  const channel  = url.searchParams.get('channel')  || 'stable';

  // Allowlist both params. Never interpolate user input into a query.
  if (!PLATFORMS.includes(platform)) return json({ error: 'unknown platform' }, 400);
  if (!CHANNELS.includes(channel))   return json({ error: 'unknown channel'  }, 400);

  const base = process.env.SUPABASE_URL;
  const readKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const opsToken = process.env.BREEZE_OPS_TOKEN;
  if (!base || !readKey) return json({ error: 'server not configured' }, 500);

  const q = `${base}/rest/v1/releases`
    + `?select=version,file_url,sha256,file_size`
    + `&is_published=eq.true&channel=eq.${channel}&platform=eq.${platform}`
    + `&order=released_at.desc&limit=1`;

  const res  = await fetch(q, { headers: { apikey: readKey } });
  if (!res.ok) return json({ error: 'lookup failed' }, 502);
  const rows = await res.json();
  if (!rows.length) return json({ error: 'no build for this platform yet' }, 404);

  const build = rows[0];

  // Fire and forget: a counter must never delay or block the download.
  if (opsToken) fetch(`${base}/functions/v1/breeze-ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-breeze-ops': opsToken },
    body: JSON.stringify({ action: 'record_download', platform, version: build.version })
  }).catch(() => {});

  return new Response(null, {
    status: 302,
    headers: { Location: build.file_url, 'X-Breeze-SHA256': build.sha256, 'Cache-Control': 'no-store' }
  });
};

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
