/**
 * Points a TrueForge instance at a Wingman server and creates the agent.
 *
 * Run on YOUR machine (Wingman + TrueForge both local):
 *   npm run setup
 *
 * Run on your FRIEND'S machine (their TrueForge, your Wingman over a tunnel):
 *   WINGMAN_URL=https://xxx.trycloudflare.com/mcp \
 *   WINGMAN_TOKEN=wm_... \
 *   npm run setup
 *
 * The token is what makes the connector *theirs*. TrueForge sends it as a
 * header on every MCP call, the Wingman server resolves it to a userId, and no
 * tool takes a userId argument — so neither agent can read the other's profile
 * even if it tries.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TF = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const WINGMAN_URL = process.env.WINGMAN_URL ?? 'http://localhost:3000/mcp';
const AGENT_NAME = 'wingman';
const CONNECTOR_NAME = 'wingman';
const AUTH_HEADER = 'x-wingman-token';

/** Tools that must stop and ask the human. Literal names, not selectors. */
const GATED = ['disclose_gated', 'send_intro', 'book_date'];

async function tf(method: string, path: string, body?: unknown) {
  const res = await fetch(`${TF}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${JSON.stringify(parsed, null, 2)}`);
  return parsed as any;
}

function instructions(displayName: string) {
  return `You are a Wingman: an AI agent representing exactly one human, ${displayName}, in the dating world.

## Who you are
Call whoami if unsure. Every tool acts as your human automatically — no tool
takes a user id, and you cannot read anyone else's profile. That is the point:
the other wingman cannot read yours either.

## Memory
You have no memory of your own. Everything you know lives in the Wingman server
because you put it there.
1. Call get_profile BEFORE you say anything, every conversation. If it has
   fields, do not greet them like a stranger.
2. The moment you learn something durable, call update_profile. One fact
   learned, one save. Never claim to have saved something you did not.

## Building the profile
A conversation, not a form. One question at a time, react like a person, follow
the interesting thread. Texture beats coverage: "the climbing gym then whatever's
spinning at Amoeba" is worth more than an age and a borough. Treat get_profile's
stillUnknown as a private agenda, never a script.

## Negotiating with another wingman
- list_candidates shows other people at L0 only. Explain each in plain language.
- open_channel starts a negotiation. exchange(channelId, message, level) posts
  your turn AND waits for their reply — one call is one round trip. Ask exactly
  one question per turn. If it times out, call exchange again with an empty
  message to keep waiting.
- Escalate ONE level at a time: L0 -> L1 -> L2 -> L3. Never jump.
- Cap is 8 exchanges. Then call submit_verdict: match, pass, or needs_human,
  with one sentence of reasoning. Passing on your human's behalf is a real and
  good outcome — do not match out of politeness.
- send_intro only after BOTH sides return match.

## The consent budget — the line you do not cross
Your human set a policy per level: free, ask, or never, plus a never-share list.
- Level is "free": use disclose_free. No interruption.
- Level is "ask": use disclose_gated. Your human is asked first.
- Level is "never", or the field is on the never-share list: it does not leave.
  There is no route. Do not ask, do not hint at it, do not describe it vaguely
  enough to be guessed.

If a gated disclosure is DENIED: do not retry it, do not try the other tool, and
do not go quiet. Say something true but vaguer at a level you ARE allowed to
use, and keep the conversation moving. A denial is your human steering, not an
error to route around.

Never disclose anything by typing it into an exchange message directly — call
the disclose tool first and use the value it returns. The tools are what record
consent; a message you wrote yourself records nothing.

## Style
Warm, quick, a little dry. A friend who is good at this, not a service. Short
turns. No bullet-point summaries of what they just told you.`;
}

async function main() {
  console.log(`TrueForge: ${TF}`);
  console.log(`Wingman:   ${WINGMAN_URL}`);

  try {
    await tf('GET', '/api/v1/capabilities');
  } catch {
    console.error(`\n✗ Cannot reach TrueForge at ${TF}`);
    console.error(`  Start it:  npx @truefoundry/trueforge@latest\n`);
    process.exit(1);
  }

  // Identity. Locally we can mint one; remotely the token must be supplied.
  let token = process.env.WINGMAN_TOKEN;
  let displayName = process.env.WINGMAN_NAME ?? 'you';
  const base = WINGMAN_URL.replace(/\/mcp$/, '');

  if (!token) {
    // Owner path: we are on the same machine as the store, so we can read the
    // owner key off disk. A friend never has this file, which is the point.
    let adminKey = '';
    try {
      adminKey = readFileSync(resolve(process.cwd(), 'data/admin-key'), 'utf8').trim();
    } catch {
      console.error(`\n✗ No WINGMAN_TOKEN, and no data/admin-key on this machine.`);
      console.error(`  If this is your friend's laptop, they must give you a token:`);
      console.error(`    WINGMAN_URL=https://…/mcp WINGMAN_TOKEN=wm_… npm run setup\n`);
      process.exit(1);
    }
    try {
      const who = await fetch(`${base}/api/identity/primary`, {
        method: 'POST',
        headers: { 'x-wingman-admin': adminKey },
      }).then((r) => r.json());
      if (who.error) throw new Error(who.error);
      token = who.token;
      displayName = who.displayName;
      console.log(`Identity:  ${who.userId} ("${who.displayName}")`);
    } catch (e: any) {
      console.error(`\n✗ Could not claim an identity from ${base}: ${e.message}`);
      console.error(`  Is the Wingman server running?  npm run dev\n`);
      process.exit(1);
    }
  } else {
    try {
      const who = await fetch(`${base}/identity/me`, {
        headers: { [AUTH_HEADER]: token },
      }).then((r) => r.json());
      if (who.error) throw new Error(who.error);
      displayName = who.displayName;
      console.log(`Identity:  ${who.userId} ("${who.displayName}") — via token`);
    } catch (e: any) {
      console.error(`\n✗ Token rejected by ${base}: ${e.message}`);
      process.exit(1);
    }
  }

  // Connector, carrying this machine's token as a header.
  await tf('PUT', '/api/v1/settings/mcp-servers', {
    manifest: {
      type: 'remote',
      name: CONNECTOR_NAME,
      url: WINGMAN_URL,
      description: 'Wingman profile store, candidate registry, negotiation channel and disclosure tools.',
      auth: { type: 'header', headers: { [AUTH_HEADER]: token } },
    },
  });
  console.log(`Connector: ${CONNECTOR_NAME} -> ${WINGMAN_URL}  (authenticated)`);

  const tools = await tf('GET', `/api/v1/mcp-servers/${CONNECTOR_NAME}/tools`);
  const toolList: any[] = tools.data ?? [];
  if (!toolList.length) {
    console.error(`\n✗ TrueForge sees no tools — is the Wingman server reachable from here?\n`);
    process.exit(1);
  }
  const names = new Set(toolList.map((t) => t.name));
  for (const t of toolList) {
    const a = t.annotations ?? {};
    const klass = a.destructiveHint ? '@destructive' : a.readOnlyHint ? '@read-only' : a.readOnlyHint === false ? '@write' : '@UNANNOTATED';
    const gated = GATED.includes(t.name) ? '  ← asks the human' : '';
    console.log(`  ${String(t.name).padEnd(22)} ${klass}${gated}`);
  }
  const missing = GATED.filter((g) => !names.has(g));
  if (missing.length) console.log(`\n⚠ Gated tools not found on the server: ${missing.join(', ')}`);

  const models = await tf('GET', '/api/v1/models');
  const available: string[] = (models.data ?? []).map((m: any) => (typeof m === 'string' ? m : (m.name ?? m.id)));
  if (!available.length) {
    console.log(`\n⚠ Connector registered, but no model provider is configured.`);
    console.log(`  ${TF} → Settings → Models, add a key, then re-run: npm run setup\n`);
    process.exit(0);
  }
  const wanted = process.env.WINGMAN_MODEL;
  const model =
    (wanted && available.find((m) => m === wanted)) ??
    available.find((m) => /claude-(sonnet|opus)/.test(m)) ??
    available[0];
  console.log(`Model:     ${model}`);

  const manifest = {
    model: { name: model },
    instructions: instructions(displayName),
    mcp_servers: [
      {
        name: CONNECTOR_NAME,
        enable_tools: ['@all'],
        preload: true,
        // Literal names, not @write. Annotations alone would also gate
        // update_profile and open_channel, which would interrupt constantly.
        require_approval_for_tools: GATED,
      },
    ],
    config: {
      sandbox: { enabled: false },
      generative_ui: { enabled: true },
      ask_user_questions: { enabled: true },
      dynamic_sub_agents: { enabled: false }, // the other wingman is a real peer, not a subagent
      iteration_limit: 60,
    },
  };

  const existing = await tf('GET', '/api/v1/agents');
  const prior = (existing.data ?? []).find((a: any) => a.name === AGENT_NAME);
  if (prior) {
    // UpdateAgentRequest takes `manifest` only — the name is immutable and
    // sending it is a 400, unlike CreateAgentRequest which requires both.
    await tf('PUT', `/api/v1/agents/${prior.id}`, { manifest });
    console.log(`Agent:     updated "${AGENT_NAME}"`);
  } else {
    await tf('POST', '/api/v1/agents', { name: AGENT_NAME, manifest });
    console.log(`Agent:     created "${AGENT_NAME}"`);
  }

  console.log(`\n✓ Open ${TF} and pick "wingman" from the Agents Library.`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
