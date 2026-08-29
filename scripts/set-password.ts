/**
 * Gives an existing profile a dashboard login.
 *
 * Profiles created before logins existed (and any minted by `npm run invite`)
 * have a wingman token but no username or password, so their owner cannot sign
 * in. This attaches one without disturbing the profile the agent already built.
 *
 *   npm run passwd -- <userId> <username> <password>
 *   npm run passwd -- --owner <userId>
 *
 * Run it on the machine the server is on; it edits data/store.json directly, so
 * restart the server afterwards to pick the change up.
 */

import {
  attachUsername,
  getProfile,
  listProfiles,
  makeOwner,
  setPassword,
  usernameTaken,
} from '../src/store.js';
import { normalizeUsername, passwordProblem, usernameProblem } from '../src/accounts.js';

function usage(msg?: string): never {
  if (msg) console.error(`\n✗ ${msg}`);
  console.error(`
  Usage:
    npm run passwd -- <userId> <username> <password>   attach a login
    npm run passwd -- --owner <userId>                 mark as this server's owner
    npm run passwd -- --list                           show profiles and logins
`);
  process.exit(msg ? 1 : 0);
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') usage();

if (argv[0] === '--list') {
  const rows = listProfiles().map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    username: p.username ?? '—',
    login: p.auth ? 'yes' : 'no',
    owner: p.isOwner ? 'yes' : '',
    persona: p.isPersona ? 'yes' : '',
  }));
  console.table(rows);
  process.exit(0);
}

if (argv[0] === '--owner') {
  const userId = argv[1];
  if (!userId) usage('--owner needs a userId.');
  if (!getProfile(userId)) usage(`No profile "${userId}". Try --list.`);
  makeOwner(userId);
  console.log(`\n✓ "${userId}" is now the owner — they see the TrueForge pipeline panel.\n`);
  process.exit(0);
}

const [userId, rawUsername, password] = argv;
if (!userId || !rawUsername || !password) usage('Need <userId> <username> <password>.');

if (!getProfile(userId)) usage(`No profile "${userId}". Try --list.`);

const username = normalizeUsername(rawUsername);
const badUser = usernameProblem(username);
if (badUser) usage(badUser);

const badPw = passwordProblem(password);
if (badPw) usage(badPw);

// Taken by someone else? attachUsername would refuse anyway, but saying so here
// is a better error than a bare false.
const currentlyMine = getProfile(userId)!.username === username;
if (!currentlyMine && usernameTaken(username)) usage(`Username "${username}" is already taken.`);

if (!currentlyMine && !attachUsername(userId, username)) usage(`Could not attach "${username}".`);
setPassword(userId, password);

console.log(`\n✓ ${userId} can now sign in as "${username}".`);
console.log(`  Restart the server so it reloads the store.\n`);
