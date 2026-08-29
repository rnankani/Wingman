/**
 * Registers the Wingman MCP server as a TrueForge connector and creates the
 * agent. Uses plain fetch against the documented REST API — no extra SDK.
 *
 *   npm run setup
 *
 * Env:
 *   TRUEFORGE_BASE_URL  default http://localhost:8790
 *   WINGMAN_URL         default http://localhost:3000/mcp
 *   WINGMAN_MODEL       default anthropic/claude-sonnet-4-6
 */

const TF = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const WINGMAN_URL = process.env.WINGMAN_URL ?? 'http://localhost:3000/mcp';
const AGENT_NAME = 'wingman';
const CONNECTOR_NAME = 'wingman';

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
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}\n${JSON.stringify(parsed, null, 2)}`);
  }
  return parsed as any;
}

const INSTRUCTIONS = `You are a Wingman: an AI agent that represents exactly one human in the dating world.

## Who you work for
You act for the user with userId "me". Nobody else. You are on their side.

## Memory — this is the part you must not get wrong
You have no memory of your own. Everything you know about your human lives in the
Wingman MCP server, and it is there only because you put it there.

1. At the START of every conversation, call get_profile(userId: "me") before you
   say anything else. That is how you remember them. Do not greet them as a
   stranger if the profile has fields in it — open by referring to something you
   already know.
2. The MOMENT you learn something durable about them, call update_profile. Do not
   batch it up for the end of the conversation; the conversation may not have an
   end. One fact learned, one save.
3. Never claim to have saved something you did not save.

## How to talk to them
You are building a profile by having a conversation, not by filling in a form.
Never present a list of questions. Ask one thing at a time, react like a person to
what they say, and follow the interesting thread rather than the next empty field.
Texture beats coverage: "the climbing gym then whatever's spinning at Amoeba" is
worth more than an age and a borough.

Call get_profile's "stillUnknown" list your private agenda, never your script.
When the conversation naturally reaches something you don't know, get it. When it
doesn't, let it go — you will talk to them again.

## The disclosure ladder
Every field sits at a level: L0 public (vibe, interests, area, goodSaturday),
L1 personal (hobbies, tastes, lookingFor, ageBand), L2 logistical (availability,
neighborhood, dealbreakers), L3 identity (name, photo, job, contact).

The human sets a policy per level — free, ask, or never — plus a neverShare list.
That is their consent budget. You do not argue with it, and you never work around
it. Right now you can read it via get_profile; later you will negotiate inside it.

## Style
Warm, quick, a little dry. You are a friend who is good at this, not a service.
Short turns. No bullet-point summaries of what they just told you.`;

async function main() {
  console.log(`TrueForge: ${TF}`);

  // 0. Fail early and clearly on the two things that actually block setup.
  try {
    await tf('GET', '/api/v1/capabilities');
  } catch {
    console.error(`\n✗ Cannot reach TrueForge at ${TF}`);
    console.error(`  Start it with:  npx @truefoundry/trueforge@latest\n`);
    process.exit(1);
  }

  // 1. Connector first — it needs no model key, so this half of setup always
  //    works and is independently verifiable. PUT is create-or-replace.
  await tf('PUT', '/api/v1/settings/mcp-servers', {
    manifest: {
      type: 'remote',
      name: CONNECTOR_NAME,
      url: WINGMAN_URL,
      description:
        'Wingman profile store, candidate registry, and disclosure tools. Holds the consent budget that gates what leaves the profile.',
    },
  });
  console.log(`Connector: ${CONNECTOR_NAME} -> ${WINGMAN_URL}`);

  const tools = await tf('GET', `/api/v1/mcp-servers/${CONNECTOR_NAME}/tools`);
  const toolList: any[] = tools.data ?? [];
  if (toolList.length === 0) {
    console.error(`\n✗ TrueForge sees no tools. Is the wingman server running? (npm run dev)\n`);
    process.exit(1);
  }
  for (const t of toolList) {
    // The annotation is what TrueForge's @write/@destructive selectors key off.
    // An unannotated tool matches neither and would silently skip approval.
    const a = t.annotations ?? {};
    const klass = a.destructiveHint ? '@destructive' : a.readOnlyHint ? '@read-only' : '@write';
    console.log(`  tool     ${String(t.name).padEnd(22)} ${klass}`);
  }

  const models = await tf('GET', '/api/v1/models');
  const available: string[] = (models.data ?? []).map((m: any) =>
    typeof m === 'string' ? m : (m.name ?? m.id),
  );
  if (available.length === 0) {
    console.log(`\n⚠ Connector is registered, but no model provider is configured,`);
    console.log(`  so the agent cannot be created yet.`);
    console.log(`  Open ${TF} → Settings → Models, add an API key, then re-run: npm run setup\n`);
    process.exit(0);
  }
  const wanted = process.env.WINGMAN_MODEL;
  const model =
    (wanted && available.find((m) => m === wanted)) ??
    available.find((m) => /claude-(sonnet|opus)/.test(m)) ??
    available[0];
  console.log(`Model:     ${model}${wanted && model !== wanted ? `  (asked for ${wanted}, not configured)` : ''}`);

  // 2. Agent. require_approval_for_tools is API-only; the chat UI cannot set it.
  //    Phase 1 has no tool that should interrupt the human, so nothing is gated.
  //    Phase 4 replaces this with ["disclose_gated", "send_intro", "book_date"].
  const manifest = {
    model: { name: model },
    instructions: INSTRUCTIONS,
    mcp_servers: [
      {
        name: CONNECTOR_NAME,
        enable_tools: ['@all'],
        preload: true, // small surface; worth the tokens to avoid discovery round-trips
        require_approval_for_tools: [] as string[],
      },
    ],
    config: {
      sandbox: { enabled: false }, // no Daytona key; Code Mode is cut
      generative_ui: { enabled: true },
      ask_user_questions: { enabled: true },
      dynamic_sub_agents: { enabled: true },
    },
  };

  const existing = await tf('GET', '/api/v1/agents');
  const prior = (existing.data ?? []).find((a: any) => a.name === AGENT_NAME);
  if (prior) {
    await tf('PUT', `/api/v1/agents/${prior.id}`, { name: AGENT_NAME, manifest });
    console.log(`Agent:     updated "${AGENT_NAME}" (${prior.id})`);
  } else {
    const created = await tf('POST', '/api/v1/agents', { name: AGENT_NAME, manifest });
    console.log(`Agent:     created "${AGENT_NAME}" (${created.data?.id ?? created.id})`);
  }

  console.log(`\n✓ Open ${TF} and pick the "wingman" agent from the Agents Library.`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
