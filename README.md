# Wingman

**Your agent talks to their agent — and never says more than you allowed.**

You spend a few minutes talking to your wingman. It learns your texture. Then it opens a channel to *someone else's* wingman, and the two agents feel each other out on your behalf — disclosing a little more at each step, escalating one rung at a time, and stopping to ask you before crossing the line you drew.

Dating is the demo. The contribution is the protocol:
**agent-to-agent negotiation with progressive disclosure under a human consent budget.**

The two wingmen run in **separate TrueForge instances on separate machines**.
Neither can read the other's profile — not because it was told not to, but because there is no API for it to try.

---

## What is in this repo

| Layer | What it does |
|---|---|
| **Wingman server** (`src/server.ts`) | Express app: MCP over HTTP, JSON profile store, negotiation channels, dashboard API |
| **MCP tools** (`src/mcp.ts`) | 14 tools scoped to the caller's identity — profile, candidates, channels, disclosure |
| **TrueForge setup** (`scripts/setup-trueforge.ts`) | Registers the remote MCP connector and creates the `wingman` agent |
| **Dashboard** (`public/`) | Web UI: your profile, live channels, TrueForge pipeline status, consent budget editor |
| **Auth** (`src/admin.ts`, `src/accounts.ts`) | Per-person username/password sessions + wingman tokens for MCP |

State lives in `data/store.json` (gitignored). Delete it to reset.

---

## Backend setup

### Prerequisites

| Requirement | Version / notes |
|---|---|
| **Node.js** | ≥ 22.14 |
| **npm** | Comes with Node |
| **TrueForge** | `npx @truefoundry/trueforge@latest` (runs on `:8790` by default) |
| **Model API key** | Added in TrueForge → Settings → Models (Anthropic, OpenAI, etc.) |
| **cloudflared** (optional) | `brew install cloudflared` — only needed for `npm run invite` quick tunnels |

---

### 1. Clone and install

```bash
git clone https://github.com/rnankani/Wingman.git
cd Wingman
npm install
```

---

### 2. Environment variables

All variables are optional unless noted.

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PORT` | `3000` | server | HTTP port for Wingman |
| `WINGMAN_MAX_PEOPLE` | `40` | server | Soft cap on profiles (open `/join`) |
| `WINGMAN_PUBLIC_URL` | *(derived from request)* | server, invite | Public hostname shown in setup commands (e.g. `https://wingman.example.app`) |
| `WINGMAN_NAME` | `me` | server, setup | Display name when minting the host's first identity |
| `WINGMAN_LOCAL` | `http://localhost:3000` | invite | Local server URL the tunnel proxies to |
| `WINGMAN_URL` | `http://localhost:3000/mcp` | setup | Remote MCP endpoint (friend's machine points here) |
| `WINGMAN_TOKEN` | *(auto on host)* | setup | Bearer token sent as `x-wingman-token` on every MCP call |
| `WINGMAN_MODEL` | *(auto-pick)* | setup | Preferred model name in TrueForge |
| `TRUEFORGE_BASE_URL` | `http://localhost:8790` | setup, status | TrueForge API base URL |

Example for a stable public hostname:

```bash
export WINGMAN_PUBLIC_URL=https://wingman.example.app
```

---

### 3. Start the Wingman server (host machine)

```bash
npm run dev          # watch mode — restarts on file changes
# or
npm run start        # production-style, no watch
```

On first start the server creates:

| File | Purpose |
|---|---|
| `data/admin-key` | Host break-glass key (gitignored). Lets `npm run setup` and owner-only API routes work without a browser login |
| `data/store.json` | Profiles, tokens, channels, credentials (created on first write) |

Startup prints:

```
wingman mcp        http://localhost:3000/mcp   (wingman-token auth)
wingman dashboard  http://localhost:3000/?k=<admin-key>
join link (share)  http://localhost:3000/join
Sign in at         http://localhost:3000/login
```

**Verify:**

```bash
curl http://localhost:3000/health
# → {"ok":true,"profiles":0}
```

---

### 4. Start TrueForge (each machine that runs an agent)

In a **second terminal** on the same machine (or on your friend's laptop):

```bash
npx @truefoundry/trueforge@latest
```

Open **http://localhost:8790** → **Settings → Models** → add an API key.

---

### 5. Wire TrueForge to Wingman

On the **host** (Wingman + TrueForge both local):

```bash
npm run setup
```

This script:

1. Checks TrueForge is reachable
2. Claims the host identity via `POST /api/identity/primary` (uses `data/admin-key`)
3. Registers connector `wingman` → `http://localhost:3000/mcp` with header auth
4. Prints tool classification (`@read-only` / `@write` / gated)
5. Creates or updates agent **`wingman`** with approval on `disclose_gated`, `send_intro`, `book_date`

Then open TrueForge → **Agents Library** → pick **wingman**.

On a **friend's machine** (their TrueForge, your Wingman over a tunnel):

```bash
WINGMAN_URL=https://xxx.trycloudflare.com/mcp \
WINGMAN_TOKEN=wm_... \
npm run setup
```

The token **is** their identity. TrueForge sends it as `x-wingman-token` on every MCP call; no tool accepts a `userId` argument.

---

### 6. Accounts and sign-in

Everyone gets a **dashboard login** (username + password) and a **wingman token** (for MCP / TrueForge).

#### Self-serve sign-up (recommended for demos)

Share the join link (printed at startup, or `{WINGMAN_PUBLIC_URL}/join`):

1. Friend opens `/join`, picks a display name, username, and password
2. They are signed in immediately and shown the `npm run setup` command with their token

Rate limits: 5 sign-ups per IP per 10 minutes; max `WINGMAN_MAX_PEOPLE` profiles total.

#### Host-invited enrolment (owner mints identity)

```bash
npm run invite -- "Alex"
# or with a stable public URL already running:
WINGMAN_PUBLIC_URL=https://wingman.example.app npm run invite -- "Alex"
```

This opens a Cloudflare quick tunnel (unless `WINGMAN_PUBLIC_URL` is set), enrols the friend via owner API, and prints their setup command. **Keep the process running** — closing it closes the tunnel.

Invited profiles have a token but **no dashboard login** until you attach one:

```bash
npm run passwd -- <userId> <username> <password>
npm run passwd -- --list              # show all profiles
npm run passwd -- --owner <userId>    # mark server owner (sees TrueForge pipeline panel)
```

Restart the server after `passwd` so it reloads `data/store.json`.

#### Sign in

- **Dashboard:** http://localhost:3000/login (works from any machine if the server is tunneled)
- **Break-glass (host only):** `/?k=<admin-key>` — exchanges the key for a session cookie and redirects to `/`

---

### 7. Public access (Cloudflare tunnel)

For cross-machine demos without a fixed hostname:

```bash
# Terminal 1
npm run dev

# Terminal 2 — quick tunnel + invite flow
npm run invite -- "Their Name"
```

Or run your own tunnel and set the public URL:

```bash
cloudflared tunnel --url http://localhost:3000
export WINGMAN_PUBLIC_URL=https://your-subdomain.trycloudflare.com
npm run dev
```

The server sets `trust proxy` so session cookies get `Secure` over HTTPS tunnels.

---

### 8. npm scripts reference

| Script | Command | When to use |
|---|---|---|
| `dev` | `tsx watch src/server.ts` | Local development |
| `start` | `tsx src/server.ts` | Run without watch |
| `setup` | `tsx scripts/setup-trueforge.ts` | After TrueForge has a model key |
| `invite` | `tsx scripts/invite.ts` | Host invites someone + optional tunnel |
| `passwd` | `tsx scripts/set-password.ts` | Attach login to existing profile |

---

## HTTP API reference

### Public (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ ok, profiles }` |
| `GET` | `/brand/*` | Static mascot assets + generated CSS |
| `GET` | `/login` | Sign-in page |
| `POST` | `/login` | Form login → session cookie |
| `POST` | `/logout` | Clear session |
| `GET` | `/join` | Self-serve sign-up page |
| `POST` | `/join` | Create account + session |
| `GET` | `/settings` | Consent budget editor (auth via session, token, or admin key) |
| `GET` | `/identity/me` | Resolve wingman token → `{ userId, displayName }` |
| `POST` | `/mcp` | MCP Streamable HTTP (requires `x-wingman-token`) |

### Session-authenticated (`/api/*`)

Requires signed-in user or `?k=<admin-key>` / `x-wingman-admin` header (resolves to owner).

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/schema` | Disclosure ladder schema |
| `GET` | `/api/me` | Your full profile + L0–L3 views |
| `GET` | `/api/candidates` | Others at L0 only |
| `GET` | `/api/channels` | Your negotiations |
| `GET` | `/api/token` | Your MCP token + setup command |
| `POST` | `/api/token/rotate` | Burn old tokens, mint new |
| `PUT` | `/api/budget` | Update your consent budget |
| `GET` | `/api/status` | TrueForge pipeline checks (**owner only**) |
| `POST` | `/api/enroll` | Mint identity for invite flow (**owner only**) |
| `POST` | `/api/identity/primary` | Claim host identity (**admin key only**) |

### Consent budget editor (`/me/budget`)

Auth: session cookie, `x-wingman-token`, or admin key + `?u=<userId>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/me/budget` | Current budget + ladder previews |
| `POST` | `/me/budget/preview` | Preview unsaved budget |
| `PUT` | `/me/budget` | Save budget |

---

## Security model

| Surface | Auth | Notes |
|---|---|---|
| `POST /mcp` | `x-wingman-token` header | Identity never comes from tool arguments |
| `GET /identity/me` | `x-wingman-token` | Token verification for setup scripts |
| `/` and `/api/*` | Session cookie or admin key | Each session sees **only its own** profile |
| `/api/status`, `/api/enroll` | Owner session or admin key | Host-only operations |
| `/health`, `/brand/*` | None | Harmless |

**Never gate on "is the request from localhost".** Behind a tunnel or reverse proxy, every request appears to come from `127.0.0.1`.

Passwords are stored with **scrypt** in `data/store.json`. Sessions are in-memory (restart signs everyone out).

---

## The disclosure ladder

Every profile field sits at exactly one level.

| Level | Contains |
|---|---|
| **L0** public | vibe, broad interests, area, what a good Saturday looks like |
| **L1** personal | specific hobbies and tastes, what they want, rough age band |
| **L2** logistical | availability, precise neighbourhood, dealbreakers |
| **L3** identity | name, photo, job, contact handle |

Each level carries a policy: `free` · `ask` · `never`, plus a free-text `neverShare` list that beats all of it.

Default: L0 `free`, L1 `free`, L2 `ask`, L3 `ask`. Escalation is **one rung at a time**.

### How the consent budget is enforced

1. **Identity from a header** — TrueForge connectors use `auth: { type: "header" }`. No tool takes `userId`.
2. **Two disclose tools** — `disclose_free` (read-only, only `free` levels) vs `disclose_gated` (write, always pauses for approval).
3. **`neverShare` redaction** — matched bidirectionally so `"my employer"` blocks `job`.

---

## The 14 MCP tools

| Tool | Access |
|---|---|
| `whoami` `get_profile` `get_shareable_profile` | Your principal only |
| `list_candidates` | Others at L0 only |
| `read_channel` `my_channels` | Negotiation state |
| `update_profile` | Write your own profile |
| `open_channel` | Start a negotiation |
| `exchange` | Post a turn **and block** until the other wingman replies |
| `disclose_free` `disclose_gated` | Consent budget |
| `submit_verdict` `send_intro` `book_date` | Closing out |

`exchange` fuses send-and-wait into one call so turn-taking is structural, not something the model must remember.

---

## TrueForge integration notes

| Capability | How Wingman uses it |
|---|---|
| **Remote MCP** | `manifest.type: "remote"` — both machines dial the same Wingman server |
| **Header auth** | Each person's token is their identity |
| **Tool approval** | `disclose_gated`, `send_intro`, `book_date` gated by literal name |
| **Annotations** | Every tool has `readOnlyHint` / `destructiveHint` so `@write` selectors work |

**Gotcha:** unannotated tools skip approval by default ([trueforge#318](https://github.com/truefoundry/trueforge/issues/318)). `npm run setup` prints the classification table on every run.

---

## Project layout

```
src/
  server.ts       Express: /mcp, /api, /join, /settings, dashboard
  mcp.ts          14 MCP tools, scoped to caller
  store.ts        JSON persistence, channels, redaction, auth
  types.ts        Ladder, fields, consent budget, channel types
  identity.ts     Token minting, x-wingman-token header
  admin.ts        Sessions, login, owner/admin guards
  accounts.ts     scrypt password hashing
  status.ts       TrueForge pipeline introspection
  brand.ts        Mascot sprite CSS generator
scripts/
  setup-trueforge.ts   Connector + agent registration
  invite.ts            Tunnel + owner enrolment
  set-password.ts      Attach dashboard login to profile
public/
  index.html           Dashboard
  join.html            Self-serve sign-up
  settings.html        Consent budget editor
  brand/               Chikny mascot assets
data/                  Runtime state (gitignored except directory)
```

---

## Two-machine demo checklist

**Host laptop**

1. `npm install && npm run dev`
2. `npx @truefoundry/trueforge@latest` → add model key
3. `npm run setup`
4. Talk to wingman in TrueForge; build your profile
5. Share `/join` or run `npm run invite -- "Friend"`

**Friend laptop**

1. Clone repo, `npm install`
2. `npx @truefoundry/trueforge@latest` → add model key
3. Run the `WINGMAN_URL=… WINGMAN_TOKEN=… npm run setup` command they received
4. Sign in at host's `/login` to watch channels and copy tokens
5. Both agents: `list_candidates` → `open_channel` → `exchange` → disclose → verdict

---

## Status

- ✅ Profile memory survives restarts (MCP store, not model context)
- ✅ Cross-machine transport, identity isolation, disclosure ladder, gating — tested via MCP
- ✅ Per-person dashboard logins, self-serve `/join`, consent budget editor at `/settings`
- ⚠️ Two live models negotiating end-to-end not yet demo'd in production
- ❌ No seeded personas — `list_candidates` is empty until a second human joins

---

## Credits

Mascot art is **Chikny**, a Codex pet — see `public/brand/README.md`. Confirm the licence before redistributing that art.
