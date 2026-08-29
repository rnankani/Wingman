import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mintToken } from './identity.js';
import {
  DEFAULT_BUDGET,
  FIELD_ALIASES,
  FIELD_LEVELS,
  LEVELS,
  MAX_EXCHANGES,
  fieldsAtOrBelow,
  type Channel,
  type ConsentBudget,
  type DisclosureRecord,
  type FieldName,
  type Level,
  type Profile,
  type Store,
  type Verdict,
} from './types.js';

const STORE_PATH = resolve(process.cwd(), 'data/store.json');

let store: Store = load();

function load(): Store {
  const empty: Store = { profiles: {}, tokens: {}, channels: {} };
  if (!existsSync(STORE_PATH)) return empty;
  try {
    const s = { ...empty, ...(JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Store) };
    // Profiles written before identities existed have no displayName. Heal
    // rather than drop — the profile the agent already built is the point.
    for (const [id, p] of Object.entries(s.profiles)) {
      if (!p.displayName) p.displayName = id;
      if (!p.budget) p.budget = structuredClone(DEFAULT_BUDGET);
    }
    return s;
  } catch {
    return empty;
  }
}

/** Gives an existing profile a token, for stores that predate auth. */
export function ensureToken(userId: string): string {
  const existing = Object.entries(store.tokens).find(([, u]) => u === userId);
  if (existing) return existing[0];
  const token = mintToken();
  store.tokens[token] = userId;
  persist();
  return token;
}

function persist(): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// ------------------------------------------------------------------ identity

/** Resolves a request header to a userId. Returns null for unknown tokens. */
export function resolveToken(token: string | undefined): string | null {
  if (!token) return null;
  return store.tokens[token] ?? null;
}

export interface Enrollment {
  userId: string;
  displayName: string;
  token: string;
}

/** Creates a person and the token their harness will authenticate with. */
export function enroll(displayName: string, isPersona = false): Enrollment {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'friend';
  let userId = base;
  let n = 2;
  while (store.profiles[userId]) userId = `${base}-${n++}`;

  store.profiles[userId] = {
    userId,
    displayName,
    fields: {},
    isPersona,
    budget: structuredClone(DEFAULT_BUDGET),
    updatedAt: new Date().toISOString(),
  };
  const token = mintToken();
  store.tokens[token] = userId;
  persist();
  return { userId, displayName, token };
}

export function listTokensFor(userId: string): string[] {
  return Object.entries(store.tokens).filter(([, u]) => u === userId).map(([t]) => t);
}

// ------------------------------------------------------------------ profiles

export function getProfile(userId: string): Profile | null {
  const p = store.profiles[userId];
  if (!p) return null;
  if (!p.budget) p.budget = structuredClone(DEFAULT_BUDGET);
  return p;
}

export function listProfiles(): Profile[] {
  return Object.values(store.profiles);
}

export function updateProfile(userId: string, patch: Partial<Record<FieldName, string>>): Profile | null {
  const p = getProfile(userId);
  if (!p) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in FIELD_LEVELS)) continue;
    if (v === null || v === undefined || v === '') delete p.fields[k as FieldName];
    else p.fields[k as FieldName] = String(v);
  }
  p.updatedAt = new Date().toISOString();
  persist();
  return p;
}

export function setBudget(userId: string, budget: ConsentBudget): Profile | null {
  const p = getProfile(userId);
  if (!p) return null;
  p.budget = budget;
  p.updatedAt = new Date().toISOString();
  persist();
  return p;
}

// ---------------------------------------------------------------- redaction

/**
 * neverShare beats every level policy. A needle matches a field if either the
 * needle appears in the field's name/aliases/value ("Hayes" -> neighborhood), or
 * one of the field's aliases appears in the needle ("my employer" -> job). The
 * second direction is what makes free text usable — without it "my employer"
 * matches nothing and the human believes they are protected when they are not.
 */
export function isRedacted(profile: Profile, field: FieldName): boolean {
  const needles = profile.budget.neverShare.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return false;
  const aliases = FIELD_ALIASES[field];
  const haystack = [field, ...aliases, profile.fields[field] ?? ''].join(' ').toLowerCase();
  return needles.some((n) => haystack.includes(n) || aliases.some((a) => n.includes(a)));
}

export interface ShareableProfile {
  userId: string;
  displayName: string;
  level: Level;
  fields: Record<string, string>;
  redacted: string[];
  withheldAbove: string[];
}

export function getShareableProfile(userId: string, level: Level): ShareableProfile | null {
  const p = getProfile(userId);
  if (!p) return null;
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

  return { userId, displayName: p.displayName, level, fields, redacted, withheldAbove };
}

// ----------------------------------------------------------------- channels

function channelId(): string {
  return 'ch_' + randomBytes(6).toString('hex');
}

export function findOpenChannel(a: string, b: string): Channel | null {
  return (
    Object.values(store.channels).find(
      (c) => !c.closed && c.parties.includes(a) && c.parties.includes(b),
    ) ?? null
  );
}

export function openChannel(from: string, to: string): Channel {
  const existing = findOpenChannel(from, to);
  if (existing) return existing;
  const c: Channel = {
    id: channelId(),
    parties: [from, to],
    turns: [],
    disclosures: [],
    level: { [from]: 'L0', [to]: 'L0' },
    verdicts: {},
    waitingOn: from, // opener speaks first
    exchanges: 0,
    maxExchanges: MAX_EXCHANGES,
    closed: false,
    createdAt: new Date().toISOString(),
  };
  store.channels[c.id] = c;
  persist();
  return c;
}

export function getChannel(id: string): Channel | null {
  return store.channels[id] ?? null;
}

export function listChannelsFor(userId: string): Channel[] {
  return Object.values(store.channels).filter((c) => c.parties.includes(userId));
}

export function other(c: Channel, me: string): string {
  return c.parties[0] === me ? c.parties[1] : c.parties[0];
}

export function postTurn(c: Channel, from: string, message: string, level: Level): void {
  c.turns.push({ from, message, level, at: new Date().toISOString() });
  c.waitingOn = other(c, from);
  // One exchange = both sides have spoken.
  c.exchanges = Math.floor(c.turns.length / 2);
  persist();
}

export function recordDisclosure(c: Channel, rec: DisclosureRecord): void {
  c.disclosures.push(rec);
  const seen = LEVELS.indexOf(c.level[rec.from] ?? 'L0');
  if (LEVELS.indexOf(rec.level) > seen) c.level[rec.from] = rec.level;
  persist();
}

export function setVerdict(c: Channel, from: string, verdict: Verdict, reason: string): void {
  c.verdicts[from] = { verdict, reason };
  const both = c.parties.every((p) => c.verdicts[p]);
  if (both) {
    const allMatch = c.parties.every((p) => c.verdicts[p]!.verdict === 'match');
    if (!allMatch) c.closed = true;
  }
  persist();
}

export function bothMatched(c: Channel): boolean {
  return c.parties.every((p) => c.verdicts[p]?.verdict === 'match');
}

export function recordIntro(c: Channel, from: string, text: string): void {
  c.intro = { from, text, at: new Date().toISOString() };
  persist();
}

export function recordDate(c: Channel, venue: string, isoTime: string, by: string): void {
  c.date = { venue, isoTime, proposedBy: by, acceptedBy: [by] };
  persist();
}

export function touch(): void {
  persist();
}
