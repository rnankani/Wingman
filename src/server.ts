import express from 'express';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import {
  createAccount,
  enroll,
  ensureToken,
  getProfile,
  getShareableProfile,
  listChannelsFor,
  listProfiles,
  listTokensFor,
  resolveToken,
  rotateToken,
  setBudget,
  usernameTaken,
} from './store.js';
import { PALETTE, POSES, spriteCss } from './brand.js';
import { getPipelineStatus } from './status.js';
import { AUTH_HEADER } from './identity.js';
import { normalizeUsername, passwordProblem, usernameProblem } from './accounts.js';
import {
  ADMIN_HEADER,
  adminKey,
  getLogin,
  postLogin,
  postLogout,
  currentUser,
  requireOwnerApi,
  requireUserApi,
  requireUserPage,
  signIn,
} from './admin.js';
import { FIELD_LEVELS, FIELD_NAMES, LEVEL_LABELS, LEVELS, type ConsentBudget } from './types.js';

const PORT = Number(process.env.PORT ?? 3000);
/** Soft cap so a public join link cannot fill the registry with junk. */
const MAX_PEOPLE = Number(process.env.WINGMAN_MAX_PEOPLE ?? 40);
const app = express();

// Behind the Cloudflare tunnel every socket is 127.0.0.1, so without this
// req.protocol reports http over an https tunnel and the session cookie would
// never get its Secure flag. It does NOT grant trust on its own — nothing
// authorises by IP.
app.set('trust proxy', true);

app.use(express.json({ limit: '1mb' }));
// The login form posts a normal urlencoded body, so it works with JS disabled.
app.use(express.urlencoded({ extended: false }));

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

// Sign-in lives outside every guard — it is how you get past them. Reachable
// from any machine, which is the point: the server runs here, the browser need
// not.
app.get('/login', getLogin);
app.post('/login', postLogin);
app.post('/logout', postLogout);

// The dashboard shell is owner-only, and so is everything under /api.
app.get(['/', '/index.html'], requireUserPage, (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/index.html'));
});
app.use('/api', requireUserApi);

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
//
// Everything below reads its identity from res.locals.userId, which the session
// middleware set. Nothing takes a userId from the caller: the moment a route
// trusts a parameter for "whose data is this", one signed-in person can read
// everyone else's profile by editing a URL, and the disclosure ladder the whole
// protocol is built on stops meaning anything.

/** The TrueForge pipeline is the host's own wiring, so only the host sees it. */
app.get('/api/status', requireOwnerApi, async (_req, res) => {
  res.json(await getPipelineStatus());
});

app.get('/api/schema', (_req, res) => {
  res.json({ levels: LEVELS, levelLabels: LEVEL_LABELS, fieldLevels: FIELD_LEVELS });
});

/**
 * Your own profile, in full, plus the four ladder views precomputed. Sending all
 * four means the level switcher is instant and, more importantly, that what the
 * dashboard shows is produced by the same getShareableProfile the MCP tools
 * call — a preview that reimplemented the filter would be worth nothing.
 */
app.get('/api/me', (_req, res) => {
  const userId = res.locals.userId as string;
  const p = getProfile(userId);
  if (!p) {
    res.status(404).json({ error: 'no such profile' });
    return;
  }
  const views = Object.fromEntries(LEVELS.map((l) => [l, getShareableProfile(userId, l)!]));
  res.json({
    userId: p.userId,
    displayName: p.displayName,
    username: p.username ?? null,
    isOwner: p.isOwner === true,
    isPersona: p.isPersona,
    updatedAt: p.updatedAt,
    budget: p.budget,
    fields: p.fields, // your own — this is the one profile you are entitled to in full
    known: Object.keys(p.fields).length,
    total: FIELD_NAMES.length,
    enrolled: listTokensFor(p.userId).length > 0,
    views,
  });
});

/**
 * Everyone else — at L0 only, exactly what the list_candidates tool exposes.
 * Built through getShareableProfile so it obeys each person's own consent
 * budget and never-share list rather than a second, laxer copy of those rules.
 */
app.get('/api/candidates', (_req, res) => {
  const me = res.locals.userId as string;
  const candidates = listProfiles()
    .filter((p) => p.userId !== me)
    .map((p) => {
      const view = getShareableProfile(p.userId, 'L0')!;
      return {
        userId: p.userId,
        displayName: p.displayName,
        isPersona: p.isPersona,
        fields: view.fields, // L0 only, redactions already applied
        redacted: view.redacted,
      };
    });
  res.json({ candidates });
});

/** Live negotiations — only the ones you are actually a party to. */
app.get('/api/channels', (_req, res) => {
  const me = res.locals.userId as string;
  const channels = listChannelsFor(me)
    .map((c) => ({
      id: c.id,
      parties: c.parties,
      level: c.level,
      exchanges: c.exchanges,
      maxExchanges: c.maxExchanges,
      waitingOn: c.waitingOn,
      turns: c.turns,
      // Field names only, never values: the dashboard shows THAT a disclosure
      // happened and under what authority, without becoming a side channel for
      // reading what the other side actually handed over.
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

/**
 * Your own wingman token, plus the command that wires your machine to this
 * server. This is the ONLY way to get the token back after sign-up, and it is
 * deliberately scoped to the session: `ensureToken` mints one for a profile that
 * predates tokens, but only ever for whoever is signed in.
 */
function connectPayload(req: express.Request, userId: string) {
  const token = ensureToken(userId);
  // Built from the request's own host so the command is correct whether they are
  // on the tunnel hostname or on the LAN.
  const base =
    process.env.WINGMAN_PUBLIC_URL ??
    `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('host')}`;
  return {
    token,
    mcpUrl: `${base}/mcp`,
    command: `WINGMAN_URL=${base}/mcp \\\n  WINGMAN_TOKEN=${token} \\\n  npm run setup`,
  };
}

app.get('/api/token', (req, res) => {
  res.json(connectPayload(req, res.locals.userId as string));
});

/** Burns every existing token for this person and issues one new one. */
app.post('/api/token/rotate', (req, res) => {
  const userId = res.locals.userId as string;
  if (!rotateToken(userId)) {
    res.status(404).json({ error: 'no such user' });
    return;
  }
  res.json(connectPayload(req, userId));
});

/**
 * Your consent budget. The userId comes from the session, never the URL — this
 * route used to be /api/budget/:userId, which let anyone with a login rewrite a
 * stranger's disclosure policy and then read what it unlocked.
 */
app.put('/api/budget', (req, res) => {
  const userId = res.locals.userId as string;
  const budget = req.body as ConsentBudget;
  if (!budget?.levels || !Array.isArray(budget.neverShare)) {
    res.status(400).json({ error: 'Expected { levels, neverShare, forwardness }' });
    return;
  }
  const p = setBudget(userId, budget);
  if (!p) {
    res.status(404).json({ error: 'no such user' });
    return;
  }
  res.json({ ok: true, budget: p.budget });
});

/** Mints an identity and the token that machine's TrueForge will send. */
app.post('/api/enroll', requireOwnerApi, (req, res) => {
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
 * Reachable only with the break-glass key via the /api middleware — NOT by an IP
 * check. Behind the tunnel every request originates from 127.0.0.1, so "is it
 * local" is a question this process cannot answer.
 */
app.post('/api/identity/primary', (_req, res) => {
  const human = listProfiles().find((p) => p.isOwner) ?? listProfiles().find((p) => !p.isPersona);
  if (human) {
    res.json({ userId: human.userId, displayName: human.displayName, token: ensureToken(human.userId) });
    return;
  }
  res.json(enroll(process.env.WINGMAN_NAME ?? 'me'));
});

// ----------------------------------------------------------------- settings
/**
 * Three ways in, because there are three legitimate editors:
 *   - someone signed in to the dashboard, editing their own budget
 *   - a person holding their own wingman token, editing their own budget
 *   - the owner holding the break-glass key, naming a user with ?u=
 * Everyone else gets nothing. A person can only ever reach their own budget.
 */
function whoIsEditing(req: express.Request): string | null {
  const bySession = currentUser(req);
  if (bySession) return bySession;

  const tok = req.header(AUTH_HEADER) ?? (typeof req.query.t === 'string' ? req.query.t : undefined);
  const byToken = resolveToken(tok);
  if (byToken) return byToken;

  const key = req.header(ADMIN_HEADER) ?? (typeof req.query.k === 'string' ? req.query.k : undefined);
  if (key && key === adminKey) {
    const u = typeof req.query.u === 'string' ? req.query.u : undefined;
    if (u && getProfile(u)) return u;
    return listProfiles().find((p) => !p.isPersona)?.userId ?? null;
  }
  return null;
}

app.get('/settings', (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/settings.html'));
});

function budgetPayload(userId: string, budget?: ConsentBudget) {
  const p = getProfile(userId)!;
  const effective = budget ?? p.budget;
  return {
    userId: p.userId,
    displayName: p.displayName,
    budget: effective,
    known: Object.keys(p.fields).length,
    total: FIELD_NAMES.length,
    levels: LEVELS,
    levelLabels: LEVEL_LABELS,
    fieldLevels: FIELD_LEVELS,
    views: Object.fromEntries(LEVELS.map((l) => [l, getShareableProfile(userId, l, effective)!])),
  };
}

app.get('/me/budget', (req, res) => {
  const me = whoIsEditing(req);
  if (!me) {
    res.status(401).json({ error: 'Open this page from your own settings link.' });
    return;
  }
  res.json(budgetPayload(me));
});

/** Preview an unsaved budget. Same filter the tools run, nothing saved. */
app.post('/me/budget/preview', (req, res) => {
  const me = whoIsEditing(req);
  if (!me) {
    res.status(401).json({ error: 'unauthorised' });
    return;
  }
  const b = req.body as ConsentBudget;
  if (!b?.levels || !Array.isArray(b.neverShare)) {
    res.status(400).json({ error: 'Expected { levels, neverShare, forwardness }' });
    return;
  }
  res.json(budgetPayload(me, b));
});

app.put('/me/budget', (req, res) => {
  const me = whoIsEditing(req);
  if (!me) {
    res.status(401).json({ error: 'unauthorised' });
    return;
  }
  const b = req.body as ConsentBudget;
  const valid =
    b?.levels &&
    LEVELS.every((l) => ['free', 'ask', 'never'].includes(b.levels[l])) &&
    Array.isArray(b.neverShare);
  if (!valid) {
    res.status(400).json({ error: 'Each level must be free, ask, or never.' });
    return;
  }
  const clean: ConsentBudget = {
    levels: Object.fromEntries(LEVELS.map((l) => [l, b.levels[l]])) as ConsentBudget['levels'],
    neverShare: b.neverShare.map((s) => String(s).trim()).filter(Boolean).slice(0, 20),
    forwardness: Math.min(5, Math.max(1, Number(b.forwardness) || 3)),
  };
  setBudget(me, clean);
  res.json(budgetPayload(me));
});

// --------------------------------------------------------------- self-serve
// Outside every guard on purpose: sign-up is open, so anyone with the link can
// claim an identity without the host handing out a code first.
//
// Open does not mean unbounded. With the tunnel up this endpoint is on the
// public internet, so MAX_PEOPLE caps the registry and the limiter below caps
// how fast one client can fill it — otherwise a single script takes every slot
// in a few seconds and real people find the demo "full".

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 10 * 60 * 1000;
const signups = new Map<string, { n: number; resetAt: number }>();

function signupClient(req: express.Request): string {
  const fwd = req.header('x-forwarded-for');
  // Behind the tunnel every socket is 127.0.0.1, so the forwarded address is the
  // only thing that distinguishes one visitor from another.
  return (fwd ? fwd.split(',')[0]!.trim() : '') || req.ip || 'unknown';
}

function signupThrottled(req: express.Request): boolean {
  const key = signupClient(req);
  const now = Date.now();
  const rec = signups.get(key);
  if (!rec || now >= rec.resetAt) {
    signups.set(key, { n: 1, resetAt: now + SIGNUP_WINDOW_MS });
    return false;
  }
  rec.n += 1;
  return rec.n > SIGNUP_LIMIT;
}

app.get('/join', (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/join.html'));
});

app.post('/join', (req, res) => {
  if (signupThrottled(req)) {
    res.status(429).json({ error: 'Too many accounts from here. Try again in a few minutes.' });
    return;
  }
  const name = String(req.body?.displayName ?? '').trim();
  if (name.length < 2 || name.length > 40) {
    res.status(400).json({ error: 'Give a name between 2 and 40 characters.' });
    return;
  }

  const username = normalizeUsername(req.body?.username);
  const badUser = usernameProblem(username);
  if (badUser) {
    res.status(400).json({ error: badUser });
    return;
  }
  if (usernameTaken(username)) {
    res.status(409).json({ error: 'That username is taken. Pick another.' });
    return;
  }

  const pw = String(req.body?.password ?? '');
  const badPw = passwordProblem(pw);
  if (badPw) {
    res.status(400).json({ error: badPw });
    return;
  }

  if (listProfiles().length >= MAX_PEOPLE) {
    res.status(429).json({ error: 'This Wingman is full. Ask the host to make room.' });
    return;
  }

  const who = createAccount({ displayName: name, username, password: pw });
  // Signed in immediately — having just proved who they are by choosing the
  // password, a second login screen would be theatre.
  signIn(req, res, who.userId);

  // Built from the request's own host so the command works whether they joined
  // over the tunnel hostname or on the LAN.
  const base = `${req.get('x-forwarded-proto') ?? req.protocol}://${req.get('host')}`;
  res.json({
    ...who,
    username,
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
  console.log(`  join link (share)  ${pub}/join    — open sign-up, no code`);
  console.log(`\n  Sign in at         ${pub}/login   — everyone, from any machine`);

  const withLogin = listProfiles().filter((p) => p.username);
  const withoutLogin = listProfiles().filter((p) => !p.username && !p.isPersona);
  console.log(`  Accounts           ${withLogin.length} with a login` +
    (withLogin.length ? `: ${withLogin.map((p) => p.username).join(', ')}` : ''));
  if (withoutLogin.length) {
    console.log(`\n  These profiles predate logins and cannot sign in yet:`);
    console.log(`    ${withoutLogin.map((p) => p.userId).join(', ')}`);
    console.log(`  Give one an account:  npm run passwd -- <userId> <username> <password>`);
  }
  console.log(`\n  Everyone else joins at the link above. The login is reachable`);
  console.log(`  wherever this server is, so if the tunnel is up it is on the public`);
  console.log(`  internet — /api is refused without a session, and each session only`);
  console.log(`  ever sees its own profile.\n`);
});
