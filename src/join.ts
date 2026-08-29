import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Self-serve enrolment: anyone with the join link claims their own identity and
 * builds their own persona. The owner never has to mint tokens by hand.
 *
 * The link carries a code because this server is reachable from the internet.
 * Without one, a stranger could fill the candidate registry with junk — they
 * still could not read anyone's private fields (identity comes from a token and
 * no tool takes a userId), but a demo drowning in spam profiles is its own kind
 * of broken. The code is a party invite, not a password.
 */
const CODE_PATH = resolve(process.cwd(), 'data/join-code');

export const joinCode: string = (() => {
  if (existsSync(CODE_PATH)) {
    const c = readFileSync(CODE_PATH, 'utf8').trim();
    if (c) return c;
  }
  // Short and sayable — this gets read aloud or typed off a phone screen.
  const c = randomBytes(4).toString('hex');
  mkdirSync(dirname(CODE_PATH), { recursive: true });
  writeFileSync(CODE_PATH, c, { mode: 0o600 });
  return c;
})();

export function codeOk(given: unknown): boolean {
  return typeof given === 'string' && given.trim().toLowerCase() === joinCode;
}
