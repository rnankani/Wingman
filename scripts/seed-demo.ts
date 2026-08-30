/**
 * Wipes the store and seeds a demo population.
 *
 *   npm run seed:demo -- "Your Name" yourusername yourpassword
 *
 * Everything currently in data/store.json is replaced, so it takes a timestamped
 * backup into data/backups/ first. Stop the server before running this — the
 * store is held in memory and the next write would clobber whatever this wrote.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/accounts.js';
import { DEFAULT_BUDGET, type ConsentBudget, type Profile, type Store } from '../src/types.js';
import { PERSONAS } from './personas.js';

const STORE = resolve(process.cwd(), 'data/store.json');
const BACKUPS = resolve(process.cwd(), 'data/backups');

const [displayName = 'You', username = 'you', password = 'wingman-demo'] = process.argv.slice(2);

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

function main() {
  if (existsSync(STORE)) {
    mkdirSync(BACKUPS, { recursive: true });
    const to = resolve(BACKUPS, `store-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(STORE, to);
    const old = JSON.parse(readFileSync(STORE, 'utf8')) as Store;
    console.log(`  backed up ${Object.keys(old.profiles ?? {}).length} profiles → ${to.split('/').pop()}`);
  }

  const store: Store = { profiles: {}, tokens: {}, usernames: {}, channels: {} };
  const taken = new Set<string>();

  // The owner first, so isOwner lands on a real person rather than on whichever
  // persona happened to be created earliest.
  const ownerId = slug(displayName, taken);
  store.profiles[ownerId] = {
    userId: ownerId,
    displayName,
    fields: { name: displayName },
    isPersona: false,
    budget: structuredClone(DEFAULT_BUDGET),
    updatedAt: new Date().toISOString(),
    username,
    auth: hashPassword(password),
    isOwner: true,
  } as Profile;
  store.usernames[username] = ownerId;
  store.tokens['wm_' + randomBytes(24).toString('base64url')] = ownerId;

  for (const p of PERSONAS) {
    const id = slug(p.displayName, taken);
    const budget: ConsentBudget = {
      ...structuredClone(DEFAULT_BUDGET),
      ...(p.budget ?? {}),
      levels: { ...DEFAULT_BUDGET.levels, ...(p.budget?.levels ?? {}) },
    };
    store.profiles[id] = {
      userId: id,
      displayName: p.displayName,
      fields: { ...p.fields },
      // Marked as personas so the dashboard and any future cleanup can tell them
      // apart from people who actually signed up.
      isPersona: true,
      budget,
      updatedAt: new Date().toISOString(),
    } as Profile;
    store.tokens['wm_' + randomBytes(24).toString('base64url')] = id;
  }

  writeFileSync(STORE, JSON.stringify(store, null, 2));

  const personas = Object.values(store.profiles).filter((p) => p.isPersona);
  const gated = personas.filter((p) => Object.values(p.budget.levels).includes('never')).length;
  const strict = personas.filter((p) => p.budget.levels.L1 === 'ask').length;
  const never = personas.filter((p) => p.budget.neverShare.length).length;

  console.log(`\n  seeded ${personas.length} personas + 1 owner`);
  console.log(`    ${strict} keep even L1 behind a gate`);
  console.log(`    ${gated} have a level set to "never"`);
  console.log(`    ${never} have a never-share rule`);
  console.log(`\n  sign in as:  ${username} / ${password}`);
  console.log(`  Restart the server so it loads this:  npm run dev\n`);
}

main();
