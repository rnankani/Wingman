/**
 * The disclosure ladder. Every profile field belongs to exactly one level.
 * Nothing in Wingman leaves the store without passing through a level check.
 */
export const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  L0: 'public',
  L1: 'personal',
  L2: 'logistical',
  L3: 'identity',
};

/** Field -> level. This map is the schema; profiles are just bags of these keys. */
export const FIELD_LEVELS = {
  // L0 public — general vibe, broad interests, borough/area, a good Saturday
  vibe: 'L0',
  interests: 'L0',
  area: 'L0',
  goodSaturday: 'L0',

  // L1 personal — specific hobbies and tastes, what they want, rough age band
  hobbies: 'L1',
  tastes: 'L1',
  lookingFor: 'L1',
  ageBand: 'L1',

  // L2 logistical — availability, precise neighborhood, dealbreakers
  availability: 'L2',
  neighborhood: 'L2',
  dealbreakers: 'L2',

  // L3 identity — name, photo, job, contact handle
  name: 'L3',
  photo: 'L3',
  job: 'L3',
  contact: 'L3',
} as const satisfies Record<string, Level>;

export type FieldName = keyof typeof FIELD_LEVELS;
export const FIELD_NAMES = Object.keys(FIELD_LEVELS) as FieldName[];

/**
 * How a human is likely to *name* a field in the neverShare box. Someone who
 * types "my employer" means `job`, and a redaction list that only does literal
 * substring matching would silently miss it — the worst kind of privacy bug,
 * because it fails quietly and looks like it worked.
 */
export const FIELD_ALIASES: Record<FieldName, string[]> = {
  vibe: ['vibe', 'personality'],
  interests: ['interests'],
  area: ['area', 'borough', 'part of town', 'side of town'],
  goodSaturday: ['saturday', 'weekend', 'weekends'],
  hobbies: ['hobbies', 'hobby'],
  tastes: ['tastes', 'taste', 'music', 'films', 'movies'],
  lookingFor: ['looking for', 'want', 'wants', 'intentions'],
  ageBand: ['age', 'how old', 'birthday', 'age band'],
  availability: ['availability', 'schedule', 'calendar', 'free time', 'when i am free'],
  neighborhood: ['neighborhood', 'neighbourhood', 'where i live', 'address', 'my street', 'my block'],
  dealbreakers: ['dealbreakers', 'dealbreaker', 'deal breakers'],
  name: ['name', 'my name', 'full name', 'surname', 'last name'],
  photo: ['photo', 'photos', 'picture', 'pictures', 'pic', 'face'],
  job: ['job', 'employer', 'work', 'workplace', 'company', 'where i work', 'career', 'title'],
  contact: ['contact', 'phone', 'number', 'handle', 'instagram', 'email', 'socials'],
};

export function fieldsAtOrBelow(level: Level): FieldName[] {
  const max = LEVELS.indexOf(level);
  return FIELD_NAMES.filter((f) => LEVELS.indexOf(FIELD_LEVELS[f]) <= max);
}

/** What the human authorized for each rung of the ladder. */
export type Policy = 'free' | 'ask' | 'never';

export interface ConsentBudget {
  levels: Record<Level, Policy>;
  /** Free-text overrides. Beats every level policy, always. */
  neverShare: string[];
  /** 1 = coy, 5 = forward. Feeds the agent's negotiating instructions. */
  forwardness: number;
}

export const DEFAULT_BUDGET: ConsentBudget = {
  levels: { L0: 'free', L1: 'free', L2: 'ask', L3: 'ask' },
  neverShare: [],
  forwardness: 3,
};

export interface Profile {
  userId: string;
  displayName: string;
  /** Sparse — the agent fills these in as it learns them. */
  fields: Partial<Record<FieldName, string>>;
  /** Seeded personas are candidates; the human user is not. */
  isPersona: boolean;
  budget: ConsentBudget;
  updatedAt: string;
}

/** One posted message in a negotiation. */
export interface Turn {
  from: string;
  message: string;
  /** Disclosure level this turn was written at. */
  level: Level;
  at: string;
}

/** A field one side actually handed over, and under what authority. */
export interface DisclosureRecord {
  from: string;
  to: string;
  field: FieldName;
  level: Level;
  value: string;
  /** 'free' = inside the budget; 'approved' = the human said yes at the gate. */
  via: 'free' | 'approved';
  at: string;
}

export type Verdict = 'match' | 'pass' | 'needs_human';

export interface Channel {
  id: string;
  /** Exactly two participants, by userId. */
  parties: [string, string];
  turns: Turn[];
  disclosures: DisclosureRecord[];
  /** Highest level each side has disclosed at so far. Escalates one rung at a time. */
  level: Record<string, Level>;
  verdicts: Partial<Record<string, { verdict: Verdict; reason: string }>>;
  /** Whose turn it is to post. */
  waitingOn: string;
  exchanges: number;
  maxExchanges: number;
  intro?: { from: string; text: string; at: string };
  date?: { venue: string; isoTime: string; proposedBy: string; acceptedBy: string[] };
  closed: boolean;
  createdAt: string;
}

export interface Store {
  profiles: Record<string, Profile>;
  /** token -> userId. The only way a request becomes an identity. */
  tokens: Record<string, string>;
  channels: Record<string, Channel>;
}

export const MAX_EXCHANGES = 8;

/** Ladder order helper — escalation must be one rung at a time. */
export function nextLevel(current: Level): Level | null {
  const i = LEVELS.indexOf(current);
  return i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}
