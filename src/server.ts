import express from 'express';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import { getProfile, getShareableProfile, listProfiles, setBudget, updateProfile } from './store.js';
import { PALETTE, POSES, spriteCss } from './brand.js';
import { getPipelineStatus } from './status.js';
import { decideApproval, listApprovals, listEvents, resetDemo, runDemo } from './activity.js';
import {
  DEFAULT_BUDGET, FIELD_ALIASES, FIELD_LEVELS, FIELD_NAMES, LEVEL_LABELS, LEVELS,
  type FieldName, type Level, type Policy,
} from './types.js';

const PORT = Number(process.env.PORT ?? 3001);
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
app.use(express.static(resolve(process.cwd(), 'public')));
app.get('/status', (_req, res) => {
  res.sendFile(resolve(process.cwd(), 'public/status.html'));
});
// The app is a hash-routed SPA; these give the inner views real, typeable URLs.
for (const [path, hash] of [['/settings', '#/settings'], ['/agent', '#/agent'], ['/people', '#/people']] as const) {
  app.get(path, (_req, res) => res.redirect('/' + hash));
}

// ------------------------------------------------------------------ profile API
// The settings screen writes through these. They are deliberately the same
// operations the MCP tools expose (update_profile, and the consent budget the
// disclosure ladder reads), so the UI cannot drift from what the agent sees.

app.post('/api/profile/:userId', (req, res) => {
  const patch = (req.body?.patch ?? {}) as Record<string, unknown>;
  const clean: Partial<Record<FieldName, string>> = {};
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k in FIELD_LEVELS) clean[k as FieldName] = v == null ? '' : String(v);
    else ignored.push(k);
  }
  const p = updateProfile(req.params.userId, clean);
  res.json({
    ok: true,
    saved: Object.keys(clean),
    ignored,
    known: Object.keys(p.fields).length,
    total: FIELD_NAMES.length,
  });
});

const POLICIES: Policy[] = ['free', 'ask', 'never'];

app.post('/api/profile/:userId/budget', (req, res) => {
  const current = getProfile(req.params.userId).budget;
  const { levels, neverShare, forwardness } = req.body ?? {};

  const nextLevels = { ...current.levels };
  for (const [l, pol] of Object.entries(levels ?? {})) {
    // Silently ignoring a bad policy would leave the human believing they set
    // a restriction that never took effect — the one failure mode that matters.
    if (!LEVELS.includes(l as Level)) return res.status(400).json({ error: `unknown level ${l}` });
    if (!POLICIES.includes(pol as Policy)) return res.status(400).json({ error: `policy must be one of ${POLICIES.join(', ')}` });
    nextLevels[l as Level] = pol as Policy;
  }

  const p = setBudget(req.params.userId, {
    levels: nextLevels,
    neverShare: Array.isArray(neverShare)
      ? [...new Set(neverShare.filter((s: unknown) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()))]
      : current.neverShare,
    forwardness: Number.isFinite(forwardness)
      ? Math.min(5, Math.max(1, Math.round(Number(forwardness))))
      : current.forwardness,
  });
  res.json(p.budget);
});

/** Field catalogue for the settings form: name, level, and how a human might say it. */
app.get('/api/fields', (_req, res) => {
  res.json({
    fields: FIELD_NAMES.map((f) => ({ field: f, level: FIELD_LEVELS[f], aliases: FIELD_ALIASES[f] })),
    levels: LEVELS,
    levelLabels: LEVEL_LABELS,
    defaultBudget: DEFAULT_BUDGET,
  });
});

// --------------------------------------------------------------- activity API
// Backs the cockpit UI's "doing / waiting / did" feed and the approval gate.
// Not wired to a live TrueForge negotiation — see src/activity.ts for why.
app.get('/api/activity', (_req, res) => {
  res.json({ events: listEvents(), approvals: listApprovals() });
});

app.post('/api/approvals/:id/decision', (req, res) => {
  const { decision, editedText } = req.body ?? {};
  if (!['approve', 'edit', 'decline', 'vaguer'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approve, edit, decline, or vaguer' });
  }
  try {
    res.json(decideApproval(req.params.id, decision, editedText));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

app.post('/api/demo/run', (_req, res) => {
  runDemo();
  res.json({ ok: true });
});

app.post('/api/demo/reset', (_req, res) => {
  resetDemo();
  res.json({ ok: true });
});

/**
 * Stateless Streamable HTTP. TrueForge only speaks to remote MCP servers
 * (manifest.type is "remote" — there is no stdio), so this endpoint is the
 * whole integration surface.
 */
app.post('/mcp', async (req, res) => {
  const server = buildMcpServer();
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

// Handy while building: eyeball the store without opening the JSON file.
app.get('/debug/profile/:userId', (req, res) => {
  res.json(getProfile(req.params.userId));
});

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
    const views = Object.fromEntries(
      LEVELS.map((l) => [l, getShareableProfile(p.userId, l)]),
    );
    const known = Object.keys(p.fields).length;
    return {
      userId: p.userId,
      isPersona: p.isPersona,
      updatedAt: p.updatedAt,
      budget: p.budget,
      fields: p.fields,
      known,
      total: FIELD_NAMES.length,
      redactedNow: LEVELS.flatMap((l) => views[l].redacted).filter((v, i, a) => a.indexOf(v) === i),
      views,
    };
  });
  res.json({
    profiles: profiles.sort((a, b) => Number(a.isPersona) - Number(b.isPersona)),
  });
});

app.listen(PORT, () => {
  console.log(`wingman  mcp      http://localhost:${PORT}/mcp`);
  console.log(`wingman  health   http://localhost:${PORT}/health`);
});
