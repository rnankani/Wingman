/**
 * Runs the demo population's wingmen. One process, fifty people.
 *
 *   npm run respond
 *
 * Why one process and not fifty watchers: a watcher per persona would mean
 * fifty agent runs every poll regardless of whether anyone had spoken, which is
 * fifty times the model spend to discover that nothing happened. This is
 * demand-driven instead — it asks the Wingman server which channels are waiting
 * on a persona, and only then spins up that persona's agent. Idle personas cost
 * nothing.
 *
 * Each persona still gets its own connector and its own token, so the isolation
 * is real: Maya's agent authenticates as Maya and cannot read anyone else's
 * profile. Connectors are created lazily, the first time a persona actually has
 * to answer, so TrueForge does not fill up with fifty entries nobody used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Store } from '../src/types.js';

const TF = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const WINGMAN = process.env.WINGMAN_PUBLIC_URL ?? 'http://localhost:3000';
const STORE = resolve(process.cwd(), 'data/store.json');
const EVERY = Math.max(10, Number(process.argv[2] ?? 20)) * 1000;
/** A cap so one runaway channel cannot spend the whole model budget. */
const MAX_CONCURRENT = Number(process.env.WINGMAN_CONCURRENCY ?? 3);

const TASK = `Another wingman is waiting on you. Take ONE turn on your human's behalf.

1. get_profile — that is everything you know about your human.
2. my_channels, then read_channel on the channel waiting on you.
3. Answer their question and ask ONE of your own, with
   exchange(waitSeconds: 0). Zero matters: post and return immediately. Do NOT
   wait for their reply and do NOT loop — you will be brought back the moment
   they answer. Waiting here just burns the run.
4. Disclose with disclose_free / disclose_gated when a fact would genuinely
   help. Escalate one rung at a time.
5. Stay in character. You represent a specific person with specific tastes and
   a real dealbreaker. Never invent facts that are not in the profile.

MAKE IT GO SOMEWHERE. Pleasant small talk that never lands is a failure. Once
you have a real read on each other, push toward something concrete: when they
are free, roughly where they are, what you would actually do together.

STOP CIRCLING. Before you write anything, read the last four turns. If you and
they have already agreed on the same thing — a place, a day, a time — do NOT
re-confirm it, do NOT ask which they prefer, and do NOT restate the plan back.
Agreeing repeatedly is not progress. The moment a venue and a time exist and
neither of you has objected, you are done talking: call submit_verdict('match')
immediately. If your human's dealbreaker has been hit, call
submit_verdict('pass') just as fast.

Never send a message that is substantially the same as one you already sent. If
you cannot think of a genuinely new question, that is the signal to submit your
verdict, not to paraphrase yourself.

When you have enough to decide, call submit_verdict — match, pass, or
needs_human. Pass when a dealbreaker is genuinely hit; do not match to be nice.
Once BOTH sides have matched, send_intro and then book_date with a specific
venue and an ISO time that fits what both people said about their availability.
A match with no plan attached is not finished.

Then stop. One turn per run.`;

async function tf(method: string, path: string, body?: unknown) {
  const res = await fetch(`${TF}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

const stamp = () => new Date().toLocaleTimeString();
const readStore = (): Store => JSON.parse(readFileSync(STORE, 'utf8'));

/** userId -> its own token, so each persona's agent authenticates as itself. */
function tokenFor(store: Store, userId: string): string | null {
  return Object.entries(store.tokens).find(([, u]) => u === userId)?.[0] ?? null;
}

const wired = new Set<string>();

async function ensureConnector(userId: string, token: string): Promise<string> {
  const name = `p-${userId}`.slice(0, 64);
  if (wired.has(name)) return name;
  await tf('PUT', '/api/v1/settings/mcp-servers', {
    manifest: {
      type: 'remote',
      name,
      url: `${WINGMAN}/mcp`,
      description: `Wingman tools acting as ${userId}.`,
      auth: { type: 'header', headers: { 'x-wingman-token': token } },
    },
  });
  wired.add(name);
  return name;
}

let model: string | null = null;

async function reply(userId: string, token: string): Promise<string> {
  const connector = await ensureConnector(userId, token);
  if (!model) {
    model = (await tf('GET', '/api/v1/models')).data.map((m: any) => (typeof m === 'string' ? m : m.name))[0];
  }

  const sid = (
    await tf('POST', '/api/v1/sessions', {
      agent: {
        spec: {
          model: { name: model },
          instructions: TASK,
          mcp_servers: [
            {
              name: connector,
              enable_tools: ['@all'],
              // Preload matters: with deferred loading the model is only told a
              // server exists and never goes looking, so it answers with nothing.
              preload: true,
              // Personas approve their own disclosures — there is no human
              // sitting behind them. The ladder and never-share rules are still
              // enforced server-side, which is what actually protects the data.
              require_approval_for_tools: [],
            },
          ],
          config: {
            sandbox: { enabled: false },
            generative_ui: { enabled: false },
            ask_user_questions: { enabled: false },
            dynamic_sub_agents: { enabled: false },
            iteration_limit: 60,
          },
        },
      },
    })
  ).data.id;

  try {
    const turn = await tf('POST', `/api/v1/sessions/${sid}/turns`, {
      input: [{ type: 'user.message', content: 'Go.' }],
      stream: false,
    });
    let state: any = null;
    for (let i = 0; i < 400; i++) {
      const r = await tf('GET', `/api/v1/sessions/${sid}/turns/${turn.data.id}`);
      state = r.data.state;
      if (state.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (state?.status === 'error') return `error: ${JSON.stringify(state).slice(0, 120)}`;
    return String(state?.output?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  } finally {
    await tf('DELETE', `/api/v1/sessions/${sid}`).catch(() => {});
  }
}

const busy = new Set<string>();

async function tick(): Promise<void> {
  const store = readStore();
  const personas = new Set(Object.values(store.profiles).filter((p) => p.isPersona).map((p) => p.userId));

  const waiting = Object.values(store.channels)
    .filter((c) => !c.closed && personas.has(c.waitingOn) && !busy.has(c.waitingOn))
    .map((c) => c.waitingOn);

  const todo = [...new Set(waiting)].slice(0, Math.max(0, MAX_CONCURRENT - busy.size));

  for (const userId of todo) {
    const token = tokenFor(store, userId);
    if (!token) continue;
    busy.add(userId);
    const name = store.profiles[userId]?.displayName ?? userId;
    console.log(`  ${stamp()}  ${name} is replying…`);

    // Deliberately NOT awaited. Awaiting every reply meant one slow agent run
    // froze the whole poll loop: two personas started at 4:37, sat inside a
    // 180-second exchange wait for a human who never came back, and nothing
    // else in the population moved for twenty minutes. The busy set is what
    // prevents double-running someone, not the await.
    void reply(userId, token)
      .then((out) => console.log(`  ${stamp()}  ${name}: ${out}`))
      .catch((e) => console.log(`  ${stamp()}  ${name} ✗ ${String(e.message).slice(0, 140)}`))
      .finally(() => busy.delete(userId));
  }
}

async function main() {
  try {
    await tf('GET', '/api/v1/capabilities');
  } catch {
    console.error(`\n✗ TrueForge not reachable at ${TF}. Start it: npx @truefoundry/trueforge@latest\n`);
    process.exit(1);
  }
  const store = readStore();
  const n = Object.values(store.profiles).filter((p) => p.isPersona).length;
  console.log(`\n  Demo population is live — ${n} people, answering on their own.`);
  console.log(`  Polling every ${EVERY / 1000}s, up to ${MAX_CONCURRENT} at once.`);
  console.log(`  Idle personas cost nothing; only someone actually waiting gets a run.`);
  console.log(`  Ctrl-C to stop.\n`);

  for (;;) {
    await tick().catch((e) => console.log(`  ${stamp()}  ✗ ${String(e.message).slice(0, 140)}`));
    await new Promise((r) => setTimeout(r, EVERY));
  }
}

main();
