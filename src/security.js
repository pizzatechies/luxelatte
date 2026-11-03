import crypto from 'node:crypto';

const COOKIE = 'll_admin';
const SESSION_HOURS = 12;

export function createAdminAuth({ password, secret }) {
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  const passwordMatches = (attempt) => {
    if (typeof attempt !== 'string') return false;
    const a = crypto.createHash('sha256').update(attempt).digest();
    const b = crypto.createHash('sha256').update(password).digest();
    return crypto.timingSafeEqual(a, b);
  };

  const readCookie = (req) => {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  };

  const isValid = (token) => {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = sign(exp);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  };

  const cookieFlags = (req) => `Path=/; HttpOnly; SameSite=Strict${req.secure ? '; Secure' : ''}`;

  return {
    passwordMatches,
    isAuthed: (req) => isValid(readCookie(req)),
    login(req, res) {
      const exp = String(Date.now() + SESSION_HOURS * 3600_000);
      res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Max-Age=${SESSION_HOURS * 3600}; ${cookieFlags(req)}`);
    },
    logout(req, res) {
      res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    },
    require(req, res, next) {
      if (isValid(readCookie(req))) return next();
      res.status(401).json({ error: 'Please sign in.' });
    },
  };
}

/** Tiny fixed-window rate limiter, keyed by client IP. Good enough for a single-server shop. */
export function rateLimit({ windowMs, max, message = 'Too many requests. Please try again in a few minutes.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
}

/** Unguessable public order reference used in tracking links. */
export const newOrderToken = () => crypto.randomBytes(9).toString('base64url');
