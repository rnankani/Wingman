import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Request, RequestHandler, Response } from 'express';
import { normalizeUsername } from './accounts.js';
import { isOwner, listProfiles, verifyLogin } from './store.js';

/**
 * Per-person dashboard login.
 *
 * Everyone who joins gets a username and password and signs in at the same
 * place, from whatever machine they like — the server runs on the host's
 * laptop, but nobody needs to be at it. A session is bound to ONE userId, and
 * every /api route reads the caller's identity from that session rather than
 * from a parameter, which is what keeps one person's dashboard from becoming a
 * window onto everyone else's profile.
 *
 * Authorisation cannot be based on the network. The moment this server sits
 * behind a tunnel, the proxy connects from 127.0.0.1 and *every* remote request
 * looks local — so an IP check silently authorises the entire internet. That is
 * not hypothetical: it handed out the owner's identity token over a public
 * hostname before this file existed.
 */
const KEY_PATH = resolve(process.cwd(), 'data/admin-key');
export const ADMIN_HEADER = 'x-wingman-admin';
const COOKIE = 'wingman_session';

/**
 * The host's break-glass key. Generated once, kept out of git, and treated as
 * the OWNER's credentials — it is what lets `npm run setup`, curl and the
 * startup link work without a browser login. It is not a second class of
 * access: it resolves to the owner profile and gets exactly that person's view.
 */
export const adminKey: string = (() => {
  if (existsSync(KEY_PATH)) {
    const k = readFileSync(KEY_PATH, 'utf8').trim();
    if (k) return k;
  }
  const k = randomBytes(18).toString('base64url');
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, k, { mode: 0o600 });
  return k;
})();

/**
 * sessionToken -> userId. In memory on purpose: a restart signs everyone out,
 * which for a laptop demo is the safe direction to fail.
 */
const sessions = new Map<string, string>();

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Minimal cookie read — not worth a cookie-parser dependency for one name. */
function cookieValue(raw: string | undefined, name: string): string | undefined {
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** The profile flagged owner, falling back to the first non-persona human. */
function ownerId(): string | null {
  const all = listProfiles();
  return (all.find((p) => p.isOwner) ?? all.find((p) => !p.isPersona))?.userId ?? null;
}

/**
 * Who is calling, or null. Checks the session cookie first, then the break-glass
 * key in either a header or ?k=.
 */
export function currentUser(req: Request): string | null {
  const session = cookieValue(req.headers.cookie, COOKIE);
  if (session) {
    const userId = sessions.get(session);
    if (userId) return userId;
  }

  const header = req.header(ADMIN_HEADER);
  if (header && constantTimeEqual(header, adminKey)) return ownerId();

  const q = req.query?.k;
  if (typeof q === 'string' && constantTimeEqual(q, adminKey)) return ownerId();

  return null;
}

function startSession(req: Request, res: Response, userId: string): void {
  const token = randomBytes(24).toString('base64url');
  sessions.set(token, userId);
  const proto = req.header('x-forwarded-proto') ?? req.protocol;
  res.cookie(COOKIE, token, {
    httpOnly: true, // page scripts cannot read it, so an XSS cannot exfiltrate it
    sameSite: 'lax', // only top-level GETs carry it, so another origin cannot PUT as you
    secure: proto === 'https', // tracks the real scheme: https over the tunnel, http locally
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** Signs out every session belonging to a user — used when a password changes. */
export function revokeSessionsFor(userId: string): void {
  for (const [token, id] of sessions) if (id === userId) sessions.delete(token);
}

/* -------------------------------------------------------------- brute force */
/**
 * This login is reachable from the public internet whenever the tunnel is up, so
 * an unthrottled password box is a real hole rather than a theoretical one.
 *
 * Keyed on the forwarded client IP AND the username, so one attacker grinding
 * away at a name cannot lock every other person out of their own account.
 * Behind the tunnel every socket is 127.0.0.1, so req.ip alone would lump the
 * whole internet into a single bucket.
 */
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { n: number; resetAt: number }>();

function clientKey(req: Request, username: string): string {
  const fwd = req.header('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0]!.trim() : '') || req.ip || 'unknown';
  return `${ip}|${username}`;
}

function throttled(key: string): boolean {
  const rec = attempts.get(key);
  return !!rec && Date.now() < rec.resetAt && rec.n >= ATTEMPT_LIMIT;
}

function noteFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now >= rec.resetAt) attempts.set(key, { n: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else rec.n += 1;
}

/* -------------------------------------------------------------------- pages */
const SHELL = `<!doctype html><meta charset="utf-8"><title>Wingman</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/brand/icon-32.png"><link rel="stylesheet" href="/brand/wingman.css">
<style>
  :root{color-scheme:dark;--bg:#171717;--panel:rgba(42,42,42,.94);--inset:#202020;
        --line:rgba(255,255,255,.09);--t1:#f1f0ed;--t3:#92908b;--t4:#77736b;
        --amber:#f3c742;--purple:#c7a2ff;--blue:#f3c742;
        --font:ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
        --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
       background:radial-gradient(circle at 82% -10%,rgba(243,199,66,.12),transparent 28rem),
                  radial-gradient(circle at 5% 92%,rgba(243,199,66,.05),transparent 24rem),var(--bg);
       color:var(--t1);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
  .box{width:100%;max-width:27rem;text-align:center}
  .chikny{--chikny-scale:0.5;margin:0 auto .75rem}
  h1{margin:0 0 .2rem;font-size:2.25rem;letter-spacing:-0.05em;font-weight:800}
  h1 i{font-style:normal;color:var(--amber)}
  .sub{color:var(--t4);font-size:.85rem;margin-bottom:1.4rem}
  form{background:linear-gradient(145deg,rgba(255,255,255,.04),rgba(255,255,255,.01)),var(--panel);
       border:1px solid var(--line);border-radius:20px;padding:1.6rem;text-align:left;
       box-shadow:0 28px 80px rgba(0,0,0,.35);backdrop-filter:blur(20px)}
  label{display:block;font-size:.7rem;letter-spacing:.04em;
        color:var(--t3);font-weight:700;margin:.9rem 0 .45rem}
  label:first-child{margin-top:0}
  input{width:100%;background:var(--inset);border:1px solid var(--line);border-radius:11px;
        padding:.78rem .9rem;color:var(--t1);font:15px var(--font);transition:border-color .2s,box-shadow .2s,background .2s}
  input:focus{outline:none;border-color:var(--amber);background:#252525;box-shadow:0 0 0 4px rgba(243,199,66,.11)}
  button{width:100%;margin-top:1.1rem;background:linear-gradient(135deg,#f3c742,#d99f32);color:#211a08;border:0;
         border-radius:11px;padding:.78rem;font:700 .92rem var(--font);cursor:pointer;
         box-shadow:0 14px 30px rgba(243,199,66,.18);transition:transform .2s,box-shadow .2s}
  button:hover{transform:translateY(-2px);box-shadow:0 18px 38px rgba(243,199,66,.26)}
  .err{margin-top:.8rem;font-size:.82rem;color:var(--purple)}
  .alt{margin-top:1rem;font-size:.8rem;color:var(--t4)}
  .alt a{color:var(--blue);text-decoration:none;font-weight:600}
  code{font:.76rem var(--mono);background:var(--inset);border:1px solid var(--line);
       border-radius:6px;padding:.1rem .35rem;color:var(--amber)}
</style>`;

export function loginPage(err?: string, username = ''): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `${SHELL}
<div class="box">
  <div class="chikny chikny--logo" role="img" aria-label="Wingman mascot"></div>
  <h1>Wing<i>man</i></h1>
  <div class="sub">sign in</div>
  <form method="POST" action="/login">
    <label for="u">Username</label>
    <input id="u" name="username" autocomplete="username" value="${esc(username)}"
           autocapitalize="none" spellcheck="false" autofocus required />
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
  </form>
  <div class="alt">No account? <a href="/join">Create one</a></div>
</div>`;
}

/* ----------------------------------------------------------------- handlers */

/**
 * Every /api route. Stashes the caller on res.locals so handlers take identity
 * from the session and never from a parameter the caller controls.
 */
export const requireUserApi: RequestHandler = (req, res, next) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).json({ error: 'sign in first', loginUrl: '/login' });
    return;
  }
  res.locals.userId = userId;
  next();
};

/** The pipeline panel describes the host's own TrueForge wiring. */
export const requireOwnerApi: RequestHandler = (req, res, next) => {
  const userId = currentUser(req);
  if (!userId || !isOwner(userId)) {
    res.status(403).json({ error: 'owner only' });
    return;
  }
  res.locals.userId = userId;
  next();
};

/** The dashboard shell — anyone without a session gets the login form. */
export const requireUserPage: RequestHandler = (req, res, next) => {
  const userId = currentUser(req);
  if (!userId) {
    res.status(401).type('html').send(loginPage());
    return;
  }
  // Arrived with ?k= — trade it for a session and drop it from the address bar,
  // so the URL is bookmarkable and never lands in a screenshot.
  if (typeof req.query?.k === 'string') {
    startSession(req, res, userId);
    res.redirect(302, req.path);
    return;
  }
  res.locals.userId = userId;
  next();
};

export const getLogin: RequestHandler = (req, res) => {
  if (currentUser(req)) {
    res.redirect(302, '/');
    return;
  }
  res.type('html').send(loginPage());
};

export const postLogin: RequestHandler = (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const given = String(req.body?.password ?? '');
  const key = clientKey(req, username);

  if (throttled(key)) {
    res.status(429).type('html').send(loginPage('Too many attempts. Wait a few minutes.', username));
    return;
  }

  const userId = verifyLogin(username, given);
  if (!userId) {
    noteFailure(key);
    // One message for both failures: naming which half was wrong tells an
    // attacker which usernames exist.
    res.status(401).type('html').send(loginPage('Wrong username or password.', username));
    return;
  }

  attempts.delete(key);
  startSession(req, res, userId);
  res.redirect(303, '/'); // 303 so the browser follows with GET, not another POST
};

export const postLogout: RequestHandler = (req, res) => {
  const session = cookieValue(req.headers.cookie, COOKIE);
  if (session) sessions.delete(session);
  res.clearCookie(COOKIE, { path: '/' });
  res.redirect(303, '/login');
};

/** Used by the join flow to sign someone in the moment they sign up. */
export function signIn(req: Request, res: Response, userId: string): void {
  startSession(req, res, userId);
}
