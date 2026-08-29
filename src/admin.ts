import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RequestHandler } from 'express';

/**
 * The dashboard and every /api route are owner-only.
 *
 * They cannot be protected by checking for localhost. The moment this server
 * sits behind any reverse proxy or tunnel, the proxy connects from 127.0.0.1
 * and *every* remote request looks local — so an IP check silently authorises
 * the entire internet. That is not a hypothetical: it handed out the owner's
 * identity token over a public hostname before this file existed.
 *
 * So: a real secret, generated once and kept out of git.
 */
const KEY_PATH = resolve(process.cwd(), 'data/admin-key');
export const ADMIN_HEADER = 'x-wingman-admin';

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

function presented(req: Parameters<RequestHandler>[0]): string | undefined {
  const header = req.header(ADMIN_HEADER);
  if (header) return header;
  const q = req.query?.k;
  return typeof q === 'string' ? q : undefined;
}

/** Constant-time-ish compare; the key is short and this is not a login form. */
function matches(given: string | undefined): boolean {
  if (!given || given.length !== adminKey.length) return false;
  let diff = 0;
  for (let i = 0; i < adminKey.length; i++) diff |= given.charCodeAt(i) ^ adminKey.charCodeAt(i);
  return diff === 0;
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (matches(presented(req))) return next();
  res.status(401).json({
    error: 'owner only',
    hint: 'Open the dashboard from the URL printed when the server started.',
  });
};

/** The dashboard shell itself — served only with the key, so the page can hold it. */
export const requireAdminPage: RequestHandler = (req, res, next) => {
  if (matches(presented(req))) return next();
  res
    .status(401)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><title>Wingman</title>
       <style>body{font:16px/1.6 ui-sans-serif,system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#fffaf0;color:#48074f;text-align:center;padding:2rem}code{background:#fff;border:1px solid rgba(72,7,79,.16);border-radius:6px;padding:.15rem .4rem}</style>
       <div><h1 style="margin:0 0 .5rem">Wingman</h1>
       <p>This dashboard is owner-only.</p>
       <p style="color:#873f94;font-size:.9rem">Open the URL printed in the terminal where you ran <code>npm run dev</code>.</p></div>`,
    );
};
