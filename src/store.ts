import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_BUDGET,
  FIELD_ALIASES,
  FIELD_LEVELS,
  fieldsAtOrBelow,
  type ConsentBudget,
  type FieldName,
  type Level,
  type Profile,
  type Store,
} from './types.js';

const STORE_PATH = resolve(process.cwd(), 'data/store.json');

let store: Store = load();

function load(): Store {
  if (!existsSync(STORE_PATH)) return { profiles: {} };
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Store;
  } catch {
    return { profiles: {} };
  }
}

function persist(): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getProfile(userId: string): Profile {
  let p = store.profiles[userId];
  if (!p) {
    p = {
      userId,
      fields: {},
      isPersona: false,
      budget: structuredClone(DEFAULT_BUDGET),
      updatedAt: new Date().toISOString(),
    };
    store.profiles[userId] = p;
    persist();
  }
  // Older records may predate a budget field; heal them on read.
  if (!p.budget) p.budget = structuredClone(DEFAULT_BUDGET);
  return p;
}

export function listProfiles(): Profile[] {
  return Object.values(store.profiles);
}

export function updateProfile(
  userId: string,
  patch: Partial<Record<FieldName, string>>,
): Profile {
  const p = getProfile(userId);
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in FIELD_LEVELS)) continue; // ignore unknown keys rather than inventing levels
    if (v === null || v === undefined || v === '') delete p.fields[k as FieldName];
    else p.fields[k as FieldName] = String(v);
  }
  p.updatedAt = new Date().toISOString();
  persist();
  return p;
}

export function setBudget(userId: string, budget: ConsentBudget): Profile {
  const p = getProfile(userId);
  p.budget = budget;
  p.updatedAt = new Date().toISOString();
  persist();
  return p;
}

export function upsertPersona(p: Omit<Profile, 'updatedAt'>): void {
  store.profiles[p.userId] = { ...p, updatedAt: new Date().toISOString() };
  persist();
}

/**
 * The one place a field value is allowed to become visible to another party.
 * neverShare beats every level policy. A needle matches a field if either:
 *   - the needle appears in the field's name, aliases, or value ("Hayes" -> neighborhood), or
 *   - one of the field's aliases appears in the needle ("my employer" -> job).
 * The second direction is what makes free text usable; without it "my employer"
 * matches nothing and the human believes they are protected when they are not.
 */
export function isRedacted(profile: Profile, field: FieldName): boolean {
  const needles = profile.budget.neverShare
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return false;

  const aliases = FIELD_ALIASES[field];
  const haystack = [field, ...aliases, profile.fields[field] ?? ''].join(' ').toLowerCase();

  return needles.some(
    (n) => haystack.includes(n) || aliases.some((a) => n.includes(a)),
  );
}

export interface ShareableProfile {
  userId: string;
  level: Level;
  fields: Record<string, string>;
  redacted: string[];
  withheldAbove: string[];
}

export function getShareableProfile(userId: string, level: Level): ShareableProfile {
  const p = getProfile(userId);
  const allowed = fieldsAtOrBelow(level);
  const fields: Record<string, string> = {};
  const redacted: string[] = [];

  for (const f of allowed) {
    const v = p.fields[f];
    if (v === undefined) continue;
    if (isRedacted(p, f)) redacted.push(f);
    else fields[f] = v;
  }

  const withheldAbove = (Object.keys(p.fields) as FieldName[])
    .filter((f) => !allowed.includes(f))
    .map((f) => `${f} (${FIELD_LEVELS[f]})`);

  return { userId, level, fields, redacted, withheldAbove };
}
