---
name: wingman-memory
description: Load and persist durable facts about the user through Wingman's own profile store (get_profile / update_profile MCP tools) instead of any other memory mechanism. Use at the very start of every conversation to recall what's already known, and immediately whenever you learn a new durable fact about the user (name, job, hobbies, availability, dealbreakers, etc.). Applies whenever acting as, testing, or building alongside the Wingman dating-negotiation agent in this repo.
---

# Wingman memory discipline

Wingman has no memory of its own. Everything it knows about a person lives in
its profile store, and only because something explicitly put it there
(`src/store.ts`, exposed over MCP by `src/mcp.ts`). This skill makes that the
default behavior for any agent working in or as Wingman.

## At the start of every conversation

1. Call `get_profile` with the relevant `userId` (the human user is `"me"`
   unless told otherwise) *before* saying anything else.
2. If fields are already known, open by referring to something already known —
   never greet someone the profile has data on as a stranger.
3. Treat the `stillUnknown` list as a private agenda, not a script — don't
   surface it to the user as a checklist of questions.

## The moment you learn something durable

- Call `update_profile` with only the fields that changed, as soon as you
  learn them. Do not batch saves for the end of the conversation — it may not
  have a clean end.
- One fact learned, one save.
- Never claim to have saved something you didn't actually save — check the
  tool result's `saved` list.
- Only write what the user actually told you. Passing `""`/`null` for a field
  deletes it, so never "helpfully" clear a field without the user asking.

### Valid fields (from `src/types.ts` — don't invent others)

| Level | Fields |
|---|---|
| L0 public | `vibe`, `interests`, `area`, `goodSaturday` |
| L1 personal | `hobbies`, `tastes`, `lookingFor`, `ageBand` |
| L2 logistical | `availability`, `neighborhood`, `dealbreakers` |
| L3 identity | `name`, `photo`, `job`, `contact` |

`update_profile` silently ignores unknown keys rather than inventing a level
for them, so treat this table as authoritative and check `src/types.ts` if the
schema may have changed since this skill was written.

The disclosure level only controls what a shareable projection may later
expose to a counterpart (via `get_shareable_profile`) — it does not gate
whether you're allowed to *record* the fact in the first place.

## Getting to the tools

Preferred path: the MCP tools `get_profile`, `get_shareable_profile`, and
`update_profile` registered in `src/mcp.ts`.

- If they aren't visible in this session, they may just be deferred — try
  `ToolSearch` with `select:mcp__wingman__get_profile,mcp__wingman__update_profile,mcp__wingman__get_shareable_profile`
  before assuming Wingman isn't connected.
- If Wingman genuinely isn't connected as an MCP server yet: start the local
  server with `npm run dev` (serves `POST /mcp` on
  `http://localhost:3000/mcp`, per `src/server.ts`), then connect it, e.g.
  `claude mcp add wingman http://localhost:3000/mcp --transport http`.
- Last-resort local fallback with no server running: the profile lives at
  `data/store.json`, keyed by `userId`, matching the `Profile` shape in
  `src/types.ts`. It's safe to read/edit directly when the dev server isn't
  running; don't hand-edit it while `npm run dev` is live, since the server
  holds its own in-memory copy and will overwrite the file on its next write.
