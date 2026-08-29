/**
 * Parse a ChatGPT/Claude paste into Wingman profile fields using only code.
 * No model. The paste is expected to be JSON (optionally wrapped in markdown)
 * or labeled lines like "vibe: …". Unknown keys and empty/generic values drop.
 */
import { FIELD_ALIASES, FIELD_LEVELS, FIELD_NAMES, type FieldName } from './types.js';

export const EXTRACT_PROMPT = `You are helping me export my personality profile for a dating wingman app called Wingman.

Using ONLY what you actually know about me from your memory and our past conversations:
- Do NOT guess or invent anything
- If you're unsure about a field, omit it entirely
- If you have no memory of me, say NO_MEMORY and stop

Output valid JSON only (no markdown fences, no explanation before or after):

{
  "vibe": "my overall personality and energy in 1-2 sentences",
  "interests": "broad interests",
  "area": "city or general area only",
  "goodSaturday": "how I actually spend a typical Saturday",
  "hobbies": "specific hobbies",
  "tastes": "music, food, films, etc.",
  "lookingFor": "what I'm looking for in dating/relationships",
  "ageBand": "rough age range only, e.g. late 20s",
  "availability": "when I'm generally free",
  "neighborhood": "neighborhood only if I've shared it",
  "dealbreakers": "dating dealbreakers if I've mentioned any",
  "name": "first name only if known",
  "job": "job/employer only if I've shared it",
  "contact": "only if I've explicitly shared contact info"
}

Rules:
- Texture over generic labels
- Never fill blanks with stereotypes
- Omit empty fields — don't use null or "unknown"
`;

const GENERIC = new Set([
  'unknown',
  'n/a',
  'na',
  'none',
  'not sure',
  'idk',
  'null',
  'undefined',
  'no_memory',
  'no memory',
]);

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveField(rawKey: string): FieldName | null {
  const n = normalizeKey(rawKey);
  if (!n) return null;
  for (const name of FIELD_NAMES) {
    if (normalizeKey(name) === n) return name;
  }
  for (const name of FIELD_NAMES) {
    const aliases = FIELD_ALIASES[name].map(normalizeKey);
    if (aliases.includes(n)) return name;
  }
  // "looking for" / "good saturday" style
  for (const name of FIELD_NAMES) {
    const aliases = [name, ...FIELD_ALIASES[name]].map(normalizeKey);
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return name;
  }
  return null;
}

function cleanValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    const joined = raw.map((x) => String(x).trim()).filter(Boolean).join(', ');
    return cleanValue(joined);
  }
  if (typeof raw === 'object') return null;
  const s = String(raw).trim().replace(/^["']|["']$/g, '');
  if (s.length < 2) return null;
  if (GENERIC.has(s.toLowerCase())) return null;
  return s;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function extractLabeledLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let current: FieldName | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!current) return;
    const v = cleanValue(buf.join(' ').trim());
    if (v) out[current] = v;
    current = null;
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•]\s*)?(?:["']?)([A-Za-z][A-Za-z0-9 _-]{0,40})(?:["']?)\s*[:\-–]\s*(.*)$/);
    if (m) {
      const field = resolveField(m[1]);
      if (field) {
        flush();
        current = field;
        buf = [m[2]];
        continue;
      }
    }
    if (current) buf.push(line.trim());
  }
  flush();
  return out;
}

export interface ImportPreview {
  method: 'json' | 'labeled' | 'none';
  fields: Partial<Record<FieldName, string>>;
  ignoredKeys: string[];
  skippedEmpty: string[];
  levels: Partial<Record<FieldName, string>>;
}

export function parseImportPaste(paste: string): ImportPreview {
  const ignoredKeys: string[] = [];
  const skippedEmpty: string[] = [];
  const fields: Partial<Record<FieldName, string>> = {};

  const json = extractJsonObject(paste);
  if (json) {
    for (const [k, v] of Object.entries(json)) {
      if (k.toLowerCase() === 'sources') continue;
      const field = resolveField(k);
      if (!field) {
        ignoredKeys.push(k);
        continue;
      }
      const cleaned = cleanValue(v);
      if (!cleaned) skippedEmpty.push(k);
      else fields[field] = cleaned;
    }
    return {
      method: 'json',
      fields,
      ignoredKeys,
      skippedEmpty,
      levels: Object.fromEntries(
        (Object.keys(fields) as FieldName[]).map((f) => [f, FIELD_LEVELS[f]]),
      ),
    };
  }

  const labeled = extractLabeledLines(paste);
  for (const [k, v] of Object.entries(labeled)) {
    fields[k as FieldName] = v;
  }
  return {
    method: Object.keys(labeled).length ? 'labeled' : 'none',
    fields,
    ignoredKeys,
    skippedEmpty,
    levels: Object.fromEntries(
      (Object.keys(fields) as FieldName[]).map((f) => [f, FIELD_LEVELS[f]]),
    ),
  };
}
