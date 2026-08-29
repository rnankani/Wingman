import express from 'express';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import { getProfile, getShareableProfile, listProfiles } from './store.js';
import { PALETTE, POSES, spriteCss } from './brand.js';
import { getPipelineStatus } from './status.js';
import { FIELD_LEVELS, FIELD_NAMES, LEVEL_LABELS, LEVELS } from './types.js';

const PORT = Number(process.env.PORT ?? 3000);
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
