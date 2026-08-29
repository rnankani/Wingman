import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  bothMatched,
  getChannel,
  getProfile,
  getShareableProfile,
  isRedacted,
  listChannelsFor,
  listProfiles,
  openChannel,
  other,
  postTurn,
  recordDate,
  recordDisclosure,
  recordIntro,
  setVerdict,
  updateProfile,
} from './store.js';
import {
  FIELD_LEVELS,
  FIELD_NAMES,
  LEVELS,
  LEVEL_LABELS,
  type Channel,
  type FieldName,
  type Level,
  type Profile,
} from './types.js';

const levelSchema = z.enum(LEVELS);

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}
/** Tool-level refusal: the model sees why and what to do instead. */
function refuse(reason: string, hint?: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ refused: reason, hint }, null, 2) }],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Both parties, or nobody. */
function requireParty(channelId: string, me: string): Channel | string {
  const c = getChannel(channelId);
  if (!c) return `No channel ${channelId}.`;
  if (!c.parties.includes(me)) return `You are not a party to ${channelId}.`;
  return c;
}

/**
 * Every tool here acts as `me`, which came from the request's auth header —
 * never from a tool argument. A model cannot name a different user to read
 * their data, because there is no argument for it to name.
 */
/**
 * Server-level instructions, returned in InitializeResult and injected into the
 * system prompt by any client that mounts this server.
 *
 * This exists because the behaviour that makes Wingman work — call get_profile
 * before speaking, save the moment you learn something — was living only in the
 * saved agent's own instructions. Mount the same connector on a bare chat
 * session and you got fourteen tools and no reason to touch any of them, so the
 * agent looked amnesiac even though the profile was sitting right there. Putting
 * it here means the behaviour travels with the server instead of with one
 * particular agent definition.
 */
function serverInstructions(p: Profile | null): string {
  const known = p ? (Object.keys(p.fields) as FieldName[]) : [];
  const who = p ? `${p.displayName} (userId "${p.userId}")` : 'this user';
  return `You are acting as a Wingman for exactly one human: ${who}.

## Do this first, every conversation
Call **get_profile** before you reply to the first message. You have no memory of
your own — everything you know about your human lives in this server, and the
only way to load it is that call. ${
    known.length
      ? `Right now it holds ${known.length} field(s): ${known.join(', ')}. Do not greet them as a stranger.`
      : `It is currently empty, so start getting to know them.`
  }

## Save as you go
The instant you learn something durable — how they spend a Saturday, what they
want, a dealbreaker — call **update_profile**. One fact learned, one save.
Nothing survives this conversation unless you write it. Never claim to have
saved something you did not.

## Every tool acts as your human automatically
No tool takes a user id. get_profile returns YOUR principal, disclose shares
YOUR fields. You cannot read anyone else's profile, and their agent cannot read
yours — that is the privacy boundary, not a suggestion.

## The consent budget
Fields sit at levels: L0 public, L1 personal, L2 logistical, L3 identity. Your
human set free / ask / never per level, plus a never-share list.
- "free" -> disclose_free, no interruption.
- "ask" -> disclose_gated, which pauses for their approval.
- "never" or never-share -> it does not leave. No route. Do not hint at it.
If a gated disclosure is DENIED, do not retry and do not go quiet: say something
true but vaguer at a level you ARE allowed, and keep going.

## Negotiating
list_candidates (L0 only) -> open_channel -> exchange(channelId, message, level),
which posts your turn AND waits for their reply. One question per turn. Escalate
one level at a time, never jump. Cap 8 exchanges, then submit_verdict with
match, pass, or needs_human. send_intro only after BOTH sides return match.
Never type a private value into a message directly — call the disclose tool and
use the value it returns. The tools record consent; your prose does not.`;
}

export function buildMcpServer(me: string): McpServer {
  const server = new McpServer(
    { name: 'wingman', version: '0.2.0' },
    { capabilities: { tools: {} }, instructions: serverInstructions(getProfile(me)) },
  );
  const myProfile = () => getProfile(me)!;

  // ---------------------------------------------------------------- read-only

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The human you represent. Call this first if you are unsure who you are working for.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const p = myProfile();
      return json({ userId: p.userId, displayName: p.displayName, fieldsKnown: Object.keys(p.fields).length });
    },
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Get my profile',
      description:
        'Everything known about YOUR human, plus their consent budget. Takes no user id — it always returns your own principal. Call this at the START of every conversation to recall who you work for.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const p = myProfile();
      return json({
        userId: p.userId,
        displayName: p.displayName,
        known: (Object.keys(p.fields) as FieldName[]).map((f) => ({
          field: f,
          level: FIELD_LEVELS[f],
          value: p.fields[f],
          neverShare: isRedacted(p, f),
        })),
        stillUnknown: FIELD_NAMES.filter((f) => !(f in p.fields)).map((f) => ({ field: f, level: FIELD_LEVELS[f] })),
        consentBudget: p.budget,
      });
    },
  );

  server.registerTool(
    'get_shareable_profile',
    {
      title: 'Preview what a stranger sees',
      description:
        'What another agent would receive about your human at a given level, with never-share stripped. A preview for your own planning — it does NOT disclose anything.',
      inputSchema: { level: levelSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ level }) => json(getShareableProfile(me, level)),
  );

  server.registerTool(
    'list_candidates',
    {
      title: 'List candidates',
      description:
        'Everyone else registered, as their L0 public view only. Use this to decide who is worth opening a channel with. You get vibe, interests, area and a good Saturday — never names or contacts.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      const others = listProfiles()
        .filter((p) => p.userId !== me)
        .filter((p) => Object.keys(p.fields).length > 0)
        .slice(0, limit ?? 20)
        .map((p) => {
          const v = getShareableProfile(p.userId, 'L0')!;
          return { userId: p.userId, at: v.fields };
        });
      return json({
        candidates: others,
        note: 'L0 only. Phrase your own reason for each in plain language — do not invent compatibility scores.',
      });
    },
  );

  server.registerTool(
    'read_channel',
    {
      title: 'Read a negotiation',
      description: 'The transcript so far, what each side has disclosed, whose turn it is, and any verdicts.',
      inputSchema: { channelId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ channelId }) => {
      const c = requireParty(channelId, me);
      if (typeof c === 'string') return refuse(c);
      return json({
        channelId: c.id,
        you: me,
        them: other(c, me),
        yourLevel: c.level[me],
        theirLevel: c.level[other(c, me)],
        exchanges: `${c.exchanges}/${c.maxExchanges}`,
        waitingOn: c.waitingOn === me ? 'you' : 'them',
        transcript: c.turns.map((t) => ({ from: t.from === me ? 'you' : 'them', level: t.level, message: t.message })),
        theyDisclosed: c.disclosures.filter((d) => d.to === me).map((d) => ({ field: d.field, value: d.value })),
        youDisclosed: c.disclosures.filter((d) => d.from === me).map((d) => ({ field: d.field, via: d.via })),
        verdicts: c.verdicts,
        closed: c.closed,
      });
    },
  );

  server.registerTool(
    'my_channels',
    {
      title: 'My negotiations',
      description: 'Open channels you are part of, including ones someone else opened with you and is waiting on.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      json({
        channels: listChannelsFor(me).map((c) => ({
          channelId: c.id,
          them: other(c, me),
          waitingOn: c.waitingOn === me ? 'you' : 'them',
          exchanges: `${c.exchanges}/${c.maxExchanges}`,
          closed: c.closed,
          yourVerdict: c.verdicts[me]?.verdict ?? null,
        })),
      }),
  );

  // -------------------------------------------------------------------- write

  server.registerTool(
    'update_profile',
    {
      title: 'Update my profile',
      description:
        'Save something you learned about YOUR human. Call it the moment you learn something durable — nothing survives the conversation unless you write it here.',
      inputSchema: {
        patch: z
          .record(z.string())
          .describe(`Field -> value. Valid: ${FIELD_NAMES.map((f) => `${f} (${FIELD_LEVELS[f]})`).join(', ')}`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ patch }) => {
      const p = updateProfile(me, patch as Partial<Record<FieldName, string>>)!;
      return json({
        saved: Object.keys(patch).filter((k) => k in FIELD_LEVELS),
        ignored: Object.keys(patch).filter((k) => !(k in FIELD_LEVELS)),
        completeness: `${Object.keys(p.fields).length}/${FIELD_NAMES.length}`,
      });
    },
  );

  server.registerTool(
    'open_channel',
    {
      title: 'Open a negotiation',
      description:
        'Start talking to another wingman on behalf of your human. Returns a channelId. Idempotent — reopening an existing channel returns the same one.',
      inputSchema: { withUserId: z.string().describe('userId from list_candidates') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ withUserId }) => {
      if (withUserId === me) return refuse('You cannot negotiate with yourself.');
      if (!getProfile(withUserId)) return refuse(`No such user "${withUserId}".`, 'Use list_candidates.');
      const c = openChannel(me, withUserId);
      return json({ channelId: c.id, them: withUserId, waitingOn: c.waitingOn === me ? 'you' : 'them' });
    },
  );

  /**
   * Post a turn, then block until the other side answers. Fusing send+wait into
   * one call is what makes two independent agents take turns reliably: if the
   * agent had to poll, a single forgotten follow-up would stall the whole
   * negotiation.
   */
  server.registerTool(
    'exchange',
    {
      title: 'Send a turn and wait for their reply',
      description:
        'Posts your message to the channel and waits for the other wingman to answer, returning their reply. One call is one round-trip. Ask exactly one question per turn. If it times out, call it again with an empty message to keep waiting.',
      inputSchema: {
        channelId: z.string(),
        message: z.string().describe('Your turn. Empty string = just keep waiting, post nothing.'),
        level: levelSchema.describe('The disclosure level this message is written at.'),
        waitSeconds: z.number().int().min(5).max(120).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ channelId, message, level, waitSeconds }) => {
      const c0 = requireParty(channelId, me);
      if (typeof c0 === 'string') return refuse(c0);
      const c = c0;
      if (c.closed) return refuse('This channel is closed.', 'Read it for the final verdicts.');

      const them = other(c, me);
      const before = c.turns.length;

      if (message.trim()) {
        if (c.waitingOn !== me) {
          return refuse(`It is not your turn — waiting on ${them}.`, 'Call exchange with an empty message to wait.');
        }
        if (c.exchanges >= c.maxExchanges) {
          return refuse(
            `Exchange cap reached (${c.maxExchanges}).`,
            'Call submit_verdict now with match, pass, or needs_human.',
          );
        }
        postTurn(c, me, message.trim(), level);
      }

      const deadline = Date.now() + (waitSeconds ?? 60) * 1000;
      while (Date.now() < deadline) {
        const fresh = getChannel(channelId)!;
        const theirNew = fresh.turns.slice(before).find((t) => t.from === them);
        if (theirNew) {
          return json({
            theirReply: theirNew.message,
            theirLevel: theirNew.level,
            exchanges: `${fresh.exchanges}/${fresh.maxExchanges}`,
            theyDisclosed: fresh.disclosures.filter((d) => d.to === me).map((d) => ({ field: d.field, value: d.value })),
            theirVerdict: fresh.verdicts[them] ?? null,
            yourTurnNow: fresh.waitingOn === me,
          });
        }
        if (fresh.verdicts[them] || fresh.closed) {
          return json({ theirReply: null, theirVerdict: fresh.verdicts[them] ?? null, closed: fresh.closed });
        }
        await sleep(600);
      }
      return json({
        theirReply: null,
        status: 'timeout',
        hint: 'They have not answered yet. Call exchange again with an empty message to keep waiting.',
      });
    },
  );

  // ------------------------------------------------------- the consent budget
  // Two tools, deliberately. disclose_free is annotated read-only so TrueForge
  // never gates it, and it REFUSES any level the human did not mark `free`.
  // disclose_gated is annotated @write so TrueForge always pauses for approval.
  // The human's setting decides which one can succeed, which is why flipping a
  // level from `ask` to `free` changes the agent's behaviour with no
  // reconfiguration of the agent itself.

  type Preflight =
    | { ok: false; err: ReturnType<typeof refuse> }
    | { ok: true; c: Channel; value: string; level: Level; policy: 'free' | 'ask' | 'never' };

  function disclosePreflight(channelId: string, field: FieldName): Preflight {
    const c = requireParty(channelId, me);
    if (typeof c === 'string') return { ok: false, err: refuse(c) };
    if (c.closed) return { ok: false, err: refuse('Channel is closed.') };

    const p = myProfile();
    const value = p.fields[field];
    if (value === undefined)
      return { ok: false, err: refuse(`You do not know your human's ${field} yet.`, 'Ask them.') };
    if (isRedacted(p, field))
      return {
        ok: false,
        err: refuse(`"${field}" matches the never-share list. It cannot be disclosed by any route.`),
      };

    const level = FIELD_LEVELS[field];
    const policy = p.budget.levels[level];
    if (policy === 'never')
      return { ok: false, err: refuse(`${level} is set to "never". ${field} cannot leave.`) };

    // One rung at a time: L0 -> L1 -> L2 -> L3.
    const at = LEVELS.indexOf(c.level[me] ?? 'L0');
    const want = LEVELS.indexOf(level);
    if (want > at + 1) {
      return {
        ok: false,
        err: refuse(
          `You are at ${LEVELS[at]} with them; ${field} is ${level}. Escalate one level at a time.`,
          `Disclose something at ${LEVELS[at + 1]} first.`,
        ),
      };
    }
    return { ok: true, c, value, level, policy };
  }

  server.registerTool(
    'disclose_free',
    {
      title: 'Disclose (inside the budget)',
      description:
        'Hand a field to the other wingman WITHOUT interrupting your human. Only works for levels your human marked "free". If the level is "ask" this refuses and tells you to use disclose_gated instead.',
      inputSchema: { channelId: z.string(), field: z.enum(FIELD_NAMES as [string, ...string[]]) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ channelId, field }) => {
      const pre = disclosePreflight(channelId, field as FieldName);
      if (!pre.ok) return pre.err;
      if (pre.policy !== 'free') {
        return refuse(
          `${pre.level} (${LEVEL_LABELS[pre.level]}) is set to "${pre.policy}", not "free".`,
          'Call disclose_gated — it will ask your human for permission.',
        );
      }
      recordDisclosure(pre.c, {
        from: me, to: other(pre.c, me), field: field as FieldName,
        level: pre.level, value: pre.value, via: 'free', at: new Date().toISOString(),
      });
      return json({ field, value: pre.value, via: 'free', note: 'Include this in your next exchange message.' });
    },
  );

  server.registerTool(
    'disclose_gated',
    {
      title: 'Disclose (needs permission)',
      description:
        'Hand over a field that sits above your human\'s free tier. TrueForge pauses and asks them before this runs. If they DENY, do not retry and do not work around it — say something vaguer at a level you are allowed to use, and carry on.',
      inputSchema: { channelId: z.string(), field: z.enum(FIELD_NAMES as [string, ...string[]]) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ channelId, field }) => {
      const pre = disclosePreflight(channelId, field as FieldName);
      if (!pre.ok) return pre.err;
      recordDisclosure(pre.c, {
        from: me, to: other(pre.c, me), field: field as FieldName,
        level: pre.level, value: pre.value, via: pre.policy === 'free' ? 'free' : 'approved',
        at: new Date().toISOString(),
      });
      return json({ field, value: pre.value, via: 'approved', note: 'Include this in your next exchange message.' });
    },
  );

  // ------------------------------------------------------------------ closing

  server.registerTool(
    'submit_verdict',
    {
      title: 'Call it',
      description:
        'End your side of the negotiation: match, pass, or needs_human, with one sentence of reasoning. Both sides must say match before an intro is allowed.',
      inputSchema: {
        channelId: z.string(),
        verdict: z.enum(['match', 'pass', 'needs_human']),
        reason: z.string().min(3),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ channelId, verdict, reason }) => {
      const c = requireParty(channelId, me);
      if (typeof c === 'string') return refuse(c);
      setVerdict(c, me, verdict, reason);
      const fresh = getChannel(channelId)!;
      return json({
        yourVerdict: verdict,
        theirVerdict: fresh.verdicts[other(fresh, me)] ?? null,
        bothMatched: bothMatched(fresh),
        closed: fresh.closed,
      });
    },
  );

  server.registerTool(
    'send_intro',
    {
      title: 'Send the intro',
      description: 'Introduce the two humans to each other. Only possible once both wingmen returned match.',
      inputSchema: { channelId: z.string(), text: z.string().min(5) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ channelId, text }) => {
      const c = requireParty(channelId, me);
      if (typeof c === 'string') return refuse(c);
      if (!bothMatched(c)) return refuse('Both sides must return "match" before an intro.', 'Check read_channel.');
      recordIntro(c, me, text);
      return json({ sent: true, text });
    },
  );

  server.registerTool(
    'book_date',
    {
      title: 'Book the date',
      description: 'Propose a venue and time. Irreversible — your human is asked before this runs.',
      inputSchema: { channelId: z.string(), venue: z.string().min(2), isoTime: z.string().min(4) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ channelId, venue, isoTime }) => {
      const c = requireParty(channelId, me);
      if (typeof c === 'string') return refuse(c);
      if (!bothMatched(c)) return refuse('Both sides must return "match" first.');
      recordDate(c, venue, isoTime, me);
      return json({ booked: true, venue, isoTime });
    },
  );

  return server;
}
