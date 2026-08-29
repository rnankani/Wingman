/**
 * Makes your wingman answer other wingmen without you being there.
 *
 *   npm run watch            # leave this running
 *   npm run watch -- 30      # poll every 30s (default 45)
 *
 * The problem: a TrueForge agent only runs while it is answering its human. So
 * agent A posts a turn and agent B never knows, because nothing on B's side is
 * awake to notice. Both humans end up poking their agents in alternation and
 * missing each other's windows — which is exactly what happened: a turn landed
 * at 3:19 and the other side did not look until 3:24.
 *
 * TrueForge's own scheduler would be the natural home for this, but /schedules
 * returns 404 on this build, so this polls instead: every N seconds it starts a
 * turn telling the agent to check its channels. The agent does the rest.
 *
 * It does NOT bypass the consent budget. A disclosure above your free tier still
 * calls disclose_gated and still pauses for your approval in TrueForge — the run
 * just waits. Autonomy inside the budget, a human at the boundary.
 */

const TF = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const AGENT = process.env.WINGMAN_AGENT ?? 'wingman';
const EVERY = Math.max(15, Number(process.argv[2] ?? 45)) * 1000;

const TASK = `Check whether another wingman is waiting on you, and negotiate.

1. Call my_channels. If nothing says "waitingOn: you", reply exactly
   "nothing waiting" and stop. Do NOT open new channels on this run.
2. Otherwise call read_channel, then answer their question and ask one of your
   own using exchange with waitSeconds:180.
3. KEEP LOOPING — exchange, read their reply, disclose if it helps, exchange
   again — until you reach a verdict or hit the 8-exchange cap. Do not stop
   after one round trip: nobody is here to restart you.
4. If they ask something you do not know about your human, say so plainly and
   ask them something instead. Never invent an answer and never go silent.
5. At the cap call submit_verdict with match, pass, or needs_human.

Your human is not watching this run. A disclosure above their free tier will
pause for their approval — that is correct, let it wait.`;

async function tf(method: string, path: string, body?: unknown) {
  const res = await fetch(`${TF}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const stamp = () => new Date().toLocaleTimeString();

/** One poll: start a turn, wait for it to finish, report what it did. */
async function tick(): Promise<void> {
  const sid = (await tf('POST', '/api/v1/sessions', { agent: { name: AGENT } })).data.id;
  try {
    const turn = await tf('POST', `/api/v1/sessions/${sid}/turns`, {
      input: [{ type: 'user.message', content: TASK }],
      stream: false,
    });

    let state: any = null;
    for (let i = 0; i < 400; i++) {
      const r = await tf('GET', `/api/v1/sessions/${sid}/turns/${turn.data.id}`);
      state = r.data.state;
      if (state.status !== 'running') break;

      // An approval pause is not a stall — it is the consent budget doing its
      // job. Say so once and leave the turn open for the human.
      if ((state.required_actions ?? []).some((a: any) => a.type === 'tool.approval_required')) {
        console.log(`  ${stamp()}  ⏸  waiting on YOUR approval in TrueForge — open it and allow or deny`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const said = String(state?.output?.content ?? '').replace(/\s+/g, ' ').trim();
    if (state?.status === 'error') console.log(`  ${stamp()}  ✗ ${JSON.stringify(state).slice(0, 160)}`);
    else if (/^nothing waiting/i.test(said)) console.log(`  ${stamp()}  · nothing waiting`);
    else console.log(`  ${stamp()}  → ${said.slice(0, 180)}`);
  } finally {
    // Keep the chat history clean; the transcript lives in the Wingman channel.
    await tf('DELETE', `/api/v1/sessions/${sid}`).catch(() => {});
  }
}

async function main() {
  try {
    await tf('GET', '/api/v1/capabilities');
  } catch {
    console.error(`\n✗ Cannot reach TrueForge at ${TF}. Start it:  npx @truefoundry/trueforge@latest\n`);
    process.exit(1);
  }
  const agents = await tf('GET', '/api/v1/agents');
  if (!(agents.data ?? []).some((a: any) => a.name === AGENT)) {
    console.error(`\n✗ No "${AGENT}" agent. Run: npm run setup\n`);
    process.exit(1);
  }

  console.log(`\n  Wingman auto-reply is ON — checking every ${EVERY / 1000}s.`);
  console.log(`  Your agent now answers other wingmen while you do something else.`);
  console.log(`  Anything above your free tier still stops and asks you.`);
  console.log(`  Ctrl-C to stop.\n`);

  for (;;) {
    await tick().catch((e) => console.log(`  ${stamp()}  ✗ ${e.message.slice(0, 160)}`));
    await new Promise((r) => setTimeout(r, EVERY));
  }
}

main();
