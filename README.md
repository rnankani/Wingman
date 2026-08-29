# Wingman

**Your agent talks to their agent — and never says more than you allowed.**

You spend two minutes talking to your wingman. It learns your texture. Then it
opens a channel to *someone else's* wingman, and the two agents feel each other
out on your behalf — disclosing a little more at each step, escalating one rung
at a time, and stopping to ask you before crossing the line you drew.

Dating is the demo. The contribution is the protocol:
**agent-to-agent negotiation with progressive disclosure under a human consent budget.**

The two wingmen run in **separate TrueForge instances on separate machines**.
Neither can read the other's profile — not because it was told not to, but
because there is no API for it to try.

---

## The disclosure ladder

Every profile field sits at exactly one level.

| Level | Contains |
|---|---|
| **L0** public | vibe, broad interests, area, what a good Saturday looks like |
| **L1** personal | specific hobbies and tastes, what they want, rough age band |
| **L2** logistical | availability, precise neighbourhood, dealbreakers |
| **L3** identity | name, photo, job, contact handle |

Each level carries a policy the human sets: `free` · `ask` · `never`, plus a
free-text `neverShare` list that beats all of it.

Default: L0 `free`, L1 `free`, L2 `ask`, L3 `ask`.
Escalation is **one rung at a time** — there is no L0 → L3.

---

## How the consent budget is enforced

Three independent mechanisms, because instructions are not a security control.

**1. Identity comes from a header, not a tool argument.**
TrueForge connectors support `auth: { type: "header" }`. Each machine's harness
attaches its own token to every MCP call; the server resolves it to a userId.
**No tool takes a userId parameter** — a model cannot name someone else and read
their data, because there is nothing to name.

**2. Two disclose tools, split by annotation.**

| tool | annotation | TrueForge sees | behaviour |
|---|---|---|---|
| `disclose_free` | `readOnlyHint: true` | `@read-only` | never gated — and **refuses** any level not marked `free` |
| `disclose_gated` | `readOnlyHint: false` | `@write` | always pauses for human approval |

This split exists because `require_approval_for_tools` is frozen into the agent
manifest at session start, so a live settings change cannot move it. The
*routing* decision therefore lives in the server (which settings does control)
while the *approval card* stays in the harness. Flipping L3 from `ask` to `free`
changes which tool can succeed, with no agent reconfiguration.

**3. `neverShare` overrides every level.**
Matched in both directions — needle against the field's name/aliases/value, and
the field's aliases against the needle — so `"my employer"` redacts `job` even
though the two strings share no substring. One-directional matching fails
silently, and a privacy control that fails quietly is worse than none.

---

## TrueForge capabilities, and why each is load-bearing

| Capability | How Wingman uses it | Why it matters |
|---|---|---|
| **Remote MCP connectors** | The Wingman server is the rendezvous both machines dial | `manifest.type` is remote-only — no stdio. This is what makes two-machine work possible at all |
| **Header auth on connectors** | Each side's token *is* its identity | The privacy boundary. Without it identity would be a forgeable tool argument |
| **Tool approval** | `disclose_gated`, `send_intro`, `book_date` | The consent budget's checkpoint — by literal tool name, not `@write` |
| **MCP tool annotations** | `readOnlyHint` / `destructiveHint` on all 14 tools | What `@read-only`/`@write`/`@destructive` selectors resolve against |
| **Durable sessions** | Profile lives in the MCP server, recalled via `get_profile` | The agent has no memory; a fresh session recalls you through a tool call |

**Gotcha:** a tool publishing *no* annotations matches neither `@write` nor
`@destructive`, so the default policy **exempts it from approval** rather than
gating it ([trueforge#318](https://github.com/truefoundry/trueforge/issues/318)).
That fails open, and silently. Wingman annotates every tool explicitly *and*
lists gated tools by literal name. `npm run setup` prints the resulting
classification table on every run, so a misclassification is visible before a demo.

---

## Run it

Node ≥ 22.14.

```bash
npm install
npm run dev                            # Wingman on :3000, prints your dashboard URL
npx @truefoundry/trueforge@latest      # TrueForge on :8790 — add a model key in Settings → Models
npm run setup                          # registers the connector, creates the agent
```

Open the dashboard link printed by `npm run dev` — it carries your owner key.
Then pick **wingman** in TrueForge's Agents Library and talk to it.

### Two machines

```bash
npm run invite -- "Their Name"
# or with an existing public hostname:
WINGMAN_PUBLIC_URL=https://wingman.example.app npm run invite -- "Their Name"
```

That mints their identity and prints the single command they run:

```bash
WINGMAN_URL=https://…/mcp WINGMAN_TOKEN=wm_… npm run setup
```

Their token **is** their identity — it grants access to their profile and no one
else's. It is not a shared secret.

---

## Security model

| Surface | Auth |
|---|---|
| `POST /mcp` | wingman token, sent by that person's harness |
| `GET /identity/me` | wingman token |
| `/` and `/api/*` | **owner key** — `data/admin-key`, gitignored |
| `/health`, `/brand/*` | public |

**Never gate this on "is the request from localhost".** Behind any tunnel or
reverse proxy, the proxy connects from `127.0.0.1`, so every remote request looks
local and an IP check authorises the entire internet. An earlier version of this
server did exactly that and served the owner's identity token to the public.

---

## The 14 tools

| | |
|---|---|
| `whoami` `get_profile` `get_shareable_profile` | your own principal only |
| `list_candidates` | others, at L0 only |
| `read_channel` `my_channels` | negotiation state |
| `update_profile` | write to your own profile |
| `open_channel` | start a negotiation |
| `exchange` | post a turn **and block** until the other wingman replies |
| `disclose_free` `disclose_gated` | the consent budget |
| `submit_verdict` `send_intro` `book_date` | closing out |

`exchange` fuses send-and-wait into one call. If the agent had to poll, a single
forgotten follow-up would stall the negotiation; blocking makes turn-taking
structural instead of a thing the model has to remember.

---

## Layout

```
src/types.ts      the ladder, field→level map, never-share aliases
src/store.ts      JSON store, redaction, channels — single source of truth
src/identity.ts   token minting, the auth header
src/admin.ts      owner-key guard for the dashboard and /api
src/mcp.ts        the 14 tools, every one scoped to the caller
src/status.ts     TrueForge introspection for the dashboard
src/brand.ts      mascot sprite map; generates the CSS
src/server.ts     Express: /mcp, /api, dashboard
scripts/setup-trueforge.ts   connector + agent, either machine
scripts/invite.ts            tunnel + enrol a friend
```

State lives in `data/store.json`. Delete it to start over.

---

## Status

- ✅ Profile builds itself and survives restarts — verified with a fresh session
      that recalled a stored fact with zero message history
- ✅ Cross-machine transport, identity isolation, disclosure ladder, gating,
      verdict rules — 14/14 assertions, including a 30s long-poll held open
      through Cloudflare
- ⚠️ **Two live models have not yet negotiated end to end.** Everything above was
      proven with direct MCP calls, not with two agents talking
- ❌ `/settings` — the consent budget is enforced but not human-editable
- ❌ No seeded personas, so `list_candidates` is empty until a second human enrols

## Credits

Mascot art is **Chikny**, a Codex pet — see `public/brand/README.md`. Confirm the
licence before treating this repo as a distribution of that art.
