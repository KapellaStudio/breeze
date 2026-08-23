export default async () => new Response(JSON.stringify({
  ok: true,
  service: 'breeze',
  runtime: 'netlify-functions'
}), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  }
});

export const config = { path: '/api/health' };
