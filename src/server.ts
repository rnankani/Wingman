import express from 'express';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import {
  enroll,
  ensureToken,
  getProfile,
  getShareableProfile,
  listChannelsFor,
  listProfiles,
  listTokensFor,
  resolveToken,
  setBudget,
} from './store.js';
import { PALETTE, POSES, spriteCss } from './brand.js';
import { getPipelineStatus } from './status.js';
import { AUTH_HEADER } from './identity.js';
import { ADMIN_HEADER, adminKey, requireAdmin, requireAdminPage } from './admin.js';
import { codeOk, joinCode } from './join.js';
import { FIELD_LEVELS, FIELD_NAMES, LEVEL_LABELS, LEVELS, type ConsentBudget } from './types.js';

const PORT = Number(process.env.PORT ?? 3000);
/** Soft cap so a public join link cannot fill the registry with junk. */
const MAX_PEOPLE = Number(process.env.WINGMAN_MAX_PEOPLE ?? 40);
const app = express();

app.use(express.json({ limit: '1mb' }));

// ------------------------------------------------------------------ branding
// The stylesheet is generated from src/brand.ts so a pose and its CSS cannot
// drift apart. Everything else in public/ is static.
app.get('/brand/wingman.css', (_req, res) => {
  res.type('text/css').send(spriteCss());
});
app.get('/brand/poses.json', (_req, res) => {
  res.json({ poses: POSES, palette: PALETTE });
});
// Brand assets are harmless and shared by both machines' pages.
app.use('/brand', express.static(resolve(process.cwd(), 'public/brand')));

// The dashboard shell is owner-only, and so is everything under /api.
app.get(['/', '/index.html'], requireAdminPage, (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/index.html'));
});
app.use('/api', requireAdmin);

/**
 * Stateless Streamable HTTP. TrueForge only speaks to remote MCP servers
 * (manifest.type is "remote" — there is no stdio), so this endpoint is the
 * whole integration surface.
 */
app.post('/mcp', async (req, res) => {
  // Identity comes from the header TrueForge attaches per connector, never from
  // a tool argument — so a model cannot name someone else and read their data.
  const token = req.header(AUTH_HEADER) ?? undefined;
  const me = resolveToken(token);
  if (!me) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `Missing or unknown ${AUTH_HEADER}. Enrol at /enroll to get a token.`,
      },
      id: null,
    });
    return;
  }

  const server = buildMcpServer(me);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless mode has no server-initiated stream and no session to delete.
const notAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed (stateless server).' },
    id: null,
  });
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

app.get('/health', (_req, res) => {
  res.json({ ok: true, profiles: listProfiles().length });
});

// (There used to be an unauthenticated /debug/profile/:userId here. It returned
// every field including L3 to anyone who knew a userId. The dashboard covers the
// same need behind the owner key.)

// ----------------------------------------------------------------- dashboard
app.get('/api/status', async (_req, res) => {
  res.json(await getPipelineStatus());
});

app.get('/api/schema', (_req, res) => {
  res.json({ levels: LEVELS, levelLabels: LEVEL_LABELS, fieldLevels: FIELD_LEVELS });
});

/**
 * Every profile, plus the four ladder views precomputed. Sending all four means
 * the level switcher in the UI is instant and, more importantly, that what the
 * dashboard shows is produced by the same getShareableProfile the MCP tools
 * call — a preview that reimplemented the filter would be worth nothing.
 */
app.get('/api/profiles', (_req, res) => {
  const profiles = listProfiles().map((p) => {
    const views = Object.fromEntries(LEVELS.map((l) => [l, getShareableProfile(p.userId, l)!]));
    return {
      userId: p.userId,
      displayName: p.displayName,
      isPersona: p.isPersona,
      updatedAt: p.updatedAt,
      budget: p.budget,
      fields: p.fields,
      known: Object.keys(p.fields).length,
      total: FIELD_NAMES.length,
      enrolled: listTokensFor(p.userId).length > 0,
      views,
    };
  });
  res.json({ profiles: profiles.sort((a, b) => Number(a.isPersona) - Number(b.isPersona)) });
});

/** Live negotiations, for the split-screen transcript on the dashboard. */
app.get('/api/channels', (_req, res) => {
  const seen = new Set<string>();
  const channels = listProfiles()
    .flatMap((p) => listChannelsFor(p.userId))
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => ({
      id: c.id,
      parties: c.parties,
      level: c.level,
      exchanges: c.exchanges,
      maxExchanges: c.maxExchanges,
      waitingOn: c.waitingOn,
      turns: c.turns,
      disclosures: c.disclosures.map((d) => ({ from: d.from, field: d.field, level: d.level, via: d.via })),
      verdicts: c.verdicts,
      intro: c.intro ?? null,
      date: c.date ?? null,
      closed: c.closed,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ channels });
});

app.put('/api/budget/:userId', (req, res) => {
  const budget = req.body as ConsentBudget;
  if (!budget?.levels || !Array.isArray(budget.neverShare)) {
    res.status(400).json({ error: 'Expected { levels, neverShare, forwardness }' });
    return;
  }
  const p = setBudget(req.params.userId, budget);
  if (!p) {
    res.status(404).json({ error: 'no such user' });
    return;
  }
  res.json({ ok: true, budget: p.budget });
});

/** Mints an identity and the token that machine's TrueForge will send. */
app.post('/api/enroll', (req, res) => {
  const name = String(req.body?.displayName ?? '').trim();
  if (name.length < 2) {
    res.status(400).json({ error: 'displayName required' });
    return;
  }
  res.json(enroll(name, Boolean(req.body?.isPersona)));
});

/**
 * The owner of this server. Reuses the pre-identity profile if one exists, so
 * the profile the agent already built survives.
 *
 * Guarded by the admin key via the /api middleware — NOT by an IP check. Behind
 * the tunnel every request originates from 127.0.0.1, so "is it local" is a
 * question this process cannot answer.
 */
app.post('/api/identity/primary', (_req, res) => {
  const human = listProfiles().find((p) => !p.isPersona);
  if (human) {
    res.json({ userId: human.userId, displayName: human.displayName, token: ensureToken(human.userId) });
    return;
  }
  res.json(enroll(process.env.WINGMAN_NAME ?? 'me'));
});

// --------------------------------------------------------------- self-serve
// Outside /api on purpose: the whole point is that someone who is NOT the owner
// can claim an identity. Guarded by the join code instead of the owner key.

app.get('/join', (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/join.html'));
});

app.post('/join', (req, res) => {
  if (!codeOk(req.body?.code)) {
    res.status(403).json({ error: 'Wrong or missing join code. Ask whoever sent you the link.' });
    return;
  }
  const name = String(req.body?.displayName ?? '').trim();
  if (name.length < 2 || name.length > 40) {
    res.status(400).json({ error: 'Give a name between 2 and 40 characters.' });
    return;
  }
  if (listProfiles().length >= MAX_PEOPLE) {
    res.status(429).json({ error: 'This Wingman is full. Ask the host to make room.' });
    return;
  }

  const who = enroll(name);
  // Built from the request's own host so the command works whether they joined
  // over the tunnel hostname or on the LAN.
  const base = `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('host')}`;
  res.json({
    ...who,
    command: `WINGMAN_URL=${base}/mcp \\\n  WINGMAN_TOKEN=${who.token} \\\n  npm run setup`,
  });
});

/**
 * Who a wingman token belongs to. Deliberately OUTSIDE /api: the friend's setup
 * script has their own token but not the owner's admin key, and it authenticates
 * with the token it is verifying.
 */
app.get('/identity/me', (req, res) => {
  const userId = resolveToken(req.header(AUTH_HEADER));
  if (!userId) {
    res.status(401).json({ error: 'unknown token' });
    return;
  }
  const p = getProfile(userId)!;
  res.json({ userId: p.userId, displayName: p.displayName });
});

app.listen(PORT, () => {
  console.log(`\n  wingman mcp        http://localhost:${PORT}/mcp   (wingman-token auth)`);
  console.log(`  wingman dashboard  http://localhost:${PORT}/?k=${adminKey}`);
  const pub = process.env.WINGMAN_PUBLIC_URL ?? `http://localhost:${PORT}`;
  console.log(`  join link (share)  ${pub}/join?c=${joinCode}`);
  console.log(`\n  The dashboard link contains your owner key — it is the whole`);
  console.log(`  password. Anything under /api is refused without it.\n`);
});
