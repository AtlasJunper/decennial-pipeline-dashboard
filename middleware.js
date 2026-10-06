// middleware.js (repo root) - interim shared-password gate. Free on all Vercel plans.
// Covers every route, including /api/sites. Fails closed if DASH_PASSWORD is not set.
// Env vars: DASH_PASSWORD (required), DASH_USER (optional, default "decennial")

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};

export default function middleware(request) {
  const password = process.env.DASH_PASSWORD;
  const user = process.env.DASH_USER || 'decennial';

  if (!password) {
    return new Response('Service unavailable', { status: 503 });
  }

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const i = decoded.indexOf(':');
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (safeEqual(u, user) && safeEqual(p, password)) return; // allow
    } catch {
      // fall through to 401
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Decennial Pipeline", charset="UTF-8"',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
