/* ───────────────────────────────────────────────────────────────────────────
   GET /download?platform=macos-arm[&channel=stable]

   Looks up the newest published build, records an aggregate count when the
   private Breeze Ops token is available, and redirects to the exact published
   artifact. No user identifier is stored.

   The Supabase URL/publishable-key fallbacks are public client credentials,
   not secrets. They make release reads resilient to Netlify env injection
   issues. The private Breeze Ops token is never committed; if it is absent,
   counting is skipped rather than blocking a legitimate download.
   ─────────────────────────────────────────────────────────────────────────── */
const PLATFORMS = ['macos-arm', 'macos-x64', 'windows-x64', 'linux-x64'];
const CHANNELS = ['stable', 'beta'];
const PUBLIC_SUPABASE_URL = 'https://iyyuxzfjkrtqqixqzsrr.supabase.co';
const PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BuhqH2ZOrhsQCQN60EDsCw_JO6AdpT5';

export default async (req) => {
  const url = new URL(req.url);
  const platform = url.searchParams.get('platform') || '';
  const channel = url.searchParams.get('channel') || 'stable';

  if (!PLATFORMS.includes(platform)) return json({ error: 'unknown platform' }, 400);
  if (!CHANNELS.includes(channel)) return json({ error: 'unknown channel' }, 400);

  const base = Netlify.env.get('SUPABASE_URL') || PUBLIC_SUPABASE_URL;
  const readKey = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY')
    || Netlify.env.get('SUPABASE_ANON_KEY')
    || PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const opsToken = Netlify.env.get('BREEZE_OPS_TOKEN');

  const q = `${base}/rest/v1/releases`
    + `?select=version,file_url,sha256,file_size`
    + `&is_published=eq.true&channel=eq.${channel}&platform=eq.${platform}`
    + `&order=released_at.desc&limit=1`;

  const res = await fetch(q, { headers: { apikey: readKey } });
  if (!res.ok) return json({ error: 'lookup failed' }, 502);
  const rows = await res.json();
  if (!rows.length) return json({ error: 'no build for this platform yet' }, 404);

  const build = rows[0];

  if (opsToken) fetch(`${base}/functions/v1/breeze-ops`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-breeze-ops': opsToken },
    body: JSON.stringify({ action: 'record_download', platform, version: build.version })
  }).catch(() => {});

  return new Response(null, {
    status: 302,
    headers: {
      Location: build.file_url,
      'X-Breeze-SHA256': build.sha256,
      'Cache-Control': 'no-store'
    }
  });
};

export const config = { path: '/download' };

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
