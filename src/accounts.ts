import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password storage for per-person dashboard logins.
 *
 * scrypt rather than a bare hash: this store is a JSON file on a laptop that is
 * exposed to the internet through a tunnel, and people reuse passwords. If the
 * file leaks, a fast hash leaks their other accounts too. scrypt is in the Node
 * standard library, so this costs no dependency.
 */
const KEYLEN = 64;
/** Node's defaults (N=16384, r=8, p=1) — ~100ms per hash on a laptop. */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export interface Credentials {
  salt: string;
  hash: string;
}

export function hashPassword(password: string): Credentials {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, creds: Credentials | undefined): boolean {
  if (!creds?.salt || !creds?.hash) return false;
  const expected = Buffer.from(creds.hash, 'hex');
  const actual = scryptSync(password, creds.salt, expected.length || KEYLEN, SCRYPT);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Lowercased, so "Aria" and "aria" cannot become two accounts. */
export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * Usernames end up in URLs, in the candidate list and in agent prompts, so keep
 * them boring. Returns null when acceptable, otherwise the reason to show.
 */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 24) return 'Username must be 24 characters or fewer.';
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return 'Username can only use letters, numbers, hyphens and underscores.';
  }
  return null;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password must be 200 characters or fewer.';
  return null;
}
