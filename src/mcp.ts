import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProfile, getShareableProfile, listProfiles, updateProfile } from './store.js';
import { FIELD_LEVELS, FIELD_NAMES, LEVELS, type FieldName } from './types.js';

const levelSchema = z.enum(LEVELS);
const userIdSchema = z.string().min(1).describe('Stable id for a person, e.g. "me" or "maya"');

/** Tool results go back to the model as text; JSON keeps it unambiguous. */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * A fresh McpServer per request (stateless transport). All state lives in the
 * JSON store, so there is nothing to keep warm between calls.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'wingman', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ---------------------------------------------------------------- read-only
  // readOnlyHint: true => TrueForge classifies these as @read-only and never
  // pauses for approval. That is deliberate: reading your own profile is not a
  // disclosure.

  server.registerTool(
    'get_profile',
    {
      title: 'Get profile',
      description:
        'Read the full profile for a user, including which disclosure level each known field sits at and the consent budget the human set. Call this at the START of every conversation to recall who you are working for.',
      inputSchema: { userId: userIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ userId }) => {
      const p = getProfile(userId);
      const known = (Object.keys(p.fields) as FieldName[]).map((f) => ({
        field: f,
        level: FIELD_LEVELS[f],
        value: p.fields[f],
      }));
      const unknown = FIELD_NAMES.filter((f) => !(f in p.fields)).map((f) => ({
        field: f,
        level: FIELD_LEVELS[f],
      }));
      return json({
        userId: p.userId,
        known,
        stillUnknown: unknown,
        consentBudget: p.budget,
        updatedAt: p.updatedAt,
      });
    },
  );

  server.registerTool(
    'get_shareable_profile',
    {
      title: 'Get shareable profile',
      description:
        'Preview exactly what a stranger would see at a given disclosure level. Returns only fields at or below that level, with neverShare matches stripped. This is a preview for your own reasoning — it does NOT count as disclosing anything.',
      inputSchema: { userId: userIdSchema, level: levelSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ userId, level }) => json(getShareableProfile(userId, level)),
  );

  server.registerTool(
    'list_candidates',
    {
      title: 'List candidates',
      description:
        'Browse everyone in the registry (seeded personas for the demo). Returns each candidate\'s profile at L1 (personal) — enough texture to reason about compatibility without touching anything that requires a negotiation. Use this to find people worth pursuing, then explain your reasoning in plain language, not scores.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const candidates = listProfiles()
        .filter((p) => p.isPersona)
        .map((p) => getShareableProfile(p.userId, 'L1'));
      return json({ count: candidates.length, candidates });
    },
  );

  // -------------------------------------------------------------------- write
  // readOnlyHint: false with destructiveHint: false => TrueForge classifies this
  // as @write. Left to the default policy it would prompt on every save, so the
  // agent spec overrides require_approval_for_tools with an explicit list.
  // Annotations stay honest; the policy decides what to gate.

  server.registerTool(
    'update_profile',
    {
      title: 'Update profile',
      description:
        'Save something you learned about the user. Pass only the fields that changed. Call this as soon as you learn something durable — the profile persists across sessions, but only what you write here survives.',
      inputSchema: {
        userId: userIdSchema,
        patch: z
          .record(z.string())
          .describe(
            `Field -> value. Valid fields: ${FIELD_NAMES.map((f) => `${f} (${FIELD_LEVELS[f]})`).join(', ')}. Unknown keys are ignored.`,
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ userId, patch }) => {
      const before = new Set(Object.keys(getProfile(userId).fields));
      const p = updateProfile(userId, patch as Partial<Record<FieldName, string>>);
      const after = Object.keys(p.fields);
      return json({
        saved: Object.keys(patch).filter((k) => k in FIELD_LEVELS),
        ignored: Object.keys(patch).filter((k) => !(k in FIELD_LEVELS)),
        newlyKnown: after.filter((k) => !before.has(k)),
        profileCompleteness: `${after.length}/${FIELD_NAMES.length} fields`,
      });
    },
  );

  return server;
}
