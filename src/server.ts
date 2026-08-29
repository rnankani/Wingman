import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import { getProfile, listProfiles } from './store.js';

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json({ limit: '1mb' }));

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

app.listen(PORT, () => {
  console.log(`wingman  mcp      http://localhost:${PORT}/mcp`);
  console.log(`wingman  health   http://localhost:${PORT}/health`);
});
