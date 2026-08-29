# Wingman UI Layout Guide

This document records where product features belong in the interface. It describes screen structure, information hierarchy, navigation, and behavior. It intentionally does not prescribe colors, typography, gradients, frameworks, or coding patterns.

## 1. Application shell

Every authenticated screen uses the same two-part shell:

1. A persistent navigation sidebar on the left.
2. A scrollable page workspace filling the remaining width.

The sidebar remains visible while the workspace changes. Opening another primary section should not replace or move the navigation.

## 2. Sidebar

Items appear from top to bottom in this order:

1. Wingman identity and mascot.
2. Search entry point.
3. Main navigation:
   - Agentic
   - Self Stats
   - Matches
   - Import
4. Utility navigation:
   - Status
   - Settings
5. Privacy-vault summary.
6. Signed-in user summary and sign-out action.

Only one main navigation item is active at a time. Pending human decisions may appear as a count beside Agentic.

On narrow screens, the sidebar collapses to icons while preserving the same order.

## 3. Shared page header

Every workspace begins with:

- A short context label above the page title.
- The page title on the left.
- Page-specific actions on the right.

Actions should be limited to the most important tasks for that page. Secondary controls belong inside the relevant content section.

## 4. Agentic page

Purpose: show what the agents are doing now and keep the human in control.

### Desktop layout

The page is divided into two columns.

Left column:

1. Process map at the top.
2. Agent communication feed below it.

Right column:

1. Active Wingman state and mascot at the top.
2. Potential matches below it.

### Process map

The process map shows these stages in order:

1. Learn the user's personality.
2. Read preferences.
3. Discover potential people.
4. Talk to the other person's agent.
5. Confirm an introduction.
6. Plan the next step.
7. Record the final result.

Completed, current, and upcoming steps must be distinguishable. The current step should include a plain-language explanation.

### Agent communication

Messages appear chronologically.

- The user's Wingman messages align to one side.
- The other person's Wingman messages align to the opposite side.
- Internal reasoning and audit events are visually separate from actual messages.
- Each entry identifies the sender, recipient, time, disclosure level when relevant, and whether it was sent or only reasoned about.

The feed follows the newest activity while allowing the user to scroll backward.

### Human checkpoint

Whenever an outbound action needs approval, the checkpoint appears directly after the event that created it. It includes:

- The exact proposed message or action.
- The profile fields involved.
- The disclosure level.
- Approve, edit, say less, and decline actions.

The checkpoint must remain inside the chronological conversation so the decision has visible context.

### Wingman state

The mascot represents the current agent state. Under it, show:

- Current workflow stage.
- Current action or waiting state.
- A short explanation of what is happening.

### Potential matches

Show a compact set of the strongest available candidates. Each card includes:

- Candidate identity available at the current disclosure level.
- Broad area when public.
- Compatibility summary.
- Privacy or eligibility state.
- A direct path to the match reasoning screen.

## 5. Self Stats page

Purpose: explain what Wingman knows about the signed-in user.

### Dashboard arrangement

Top region:

- A large profile-completion summary.
- Small summary cards for known and missing/private signals.

Middle region:

- A structured summary of how Wingman currently understands the user.

Bottom region:

- Disclosure-level breakdown.
- Current matching-readiness or confidence estimates.

The page should make missing information clear without pressuring the user to disclose it.

## 6. Matches page

Purpose: browse candidates and understand why each candidate was surfaced.

Matches appear in a responsive card grid. Each card contains:

- Candidate name or approved identifier.
- Match confidence.
- Short public profile summary.
- Privacy and eligibility state.
- One leading reason for the recommendation.
- A “View agent reasoning” action.

Selecting a card opens that candidate's Match Detail page.

## 7. Match Detail page

Purpose: show the agent conversation and the evidence behind one match.

### Desktop layout

Left column:

- Private agent-to-agent conversation.

Right column:

1. Match confidence and reasoning trail.
2. Candidate profile fields currently permitted for display.

### Conversation header

The header identifies both agents, channel state, and privacy state.

### Reasoning trail

The explanation follows this order:

1. Profile evidence considered.
2. Constraints checked.
3. Uncertainty or missing information.
4. Safety or eligibility result.
5. Agent verdict when one exists.

The interface must distinguish direct evidence from inference. It must not present missing or hidden data as fact.

### Candidate profile

Only fields authorized by the other person's disclosure settings appear. The page states what disclosure boundary is being applied.

## 8. Import page

Purpose: bring profile information from another AI into Wingman.

The page follows a three-step sequence:

1. Copy the extraction prompt.
2. Paste the other AI's response.
3. Preview parsed profile signals.

Saving is separate from previewing. The user should see exactly which fields will be stored before confirming.

## 9. Status page

Purpose: show system health and agent infrastructure.

This page contains:

- Server and MCP health.
- Connected agent/tool status.
- Authentication or setup issues.
- Actionable recovery guidance.

Owner-only system information must not appear for regular accounts.

## 10. Settings page

Purpose: manage consent and disclosure behavior.

Settings include:

- Disclosure policy for each profile level.
- Never-share fields.
- Forwardness level.
- A live preview of what another agent could see.
- Save confirmation and validation feedback.

## 11. Authentication screens

### Sign in

The sign-in screen contains:

- Wingman identity.
- Username field.
- Password field.
- Primary sign-in action.
- Link to account creation.
- Inline authentication errors.

### Join

The join screen contains:

- Display name.
- Username.
- Password.
- Account-creation action.
- Post-signup connection instructions.

Successful signup signs the person in and sends them to their own dashboard.

## 12. Responsive behavior

Desktop:

- Persistent full sidebar.
- Multi-column dashboard and detail layouts.

Tablet:

- Full sidebar where space permits.
- Major two-column regions may stack.
- Card grids reduce their column count.

Mobile:

- Icon-only navigation rail.
- One-column content.
- Primary actions remain reachable near the page heading.
- Conversations retain left/right alignment without overflowing.
- Cards and forms use the full available width.

## 13. Product invariants

The layout must always preserve these rules:

- Human approval stays next to the action being approved.
- Sent messages and internal reasoning are never confused.
- Match reasons are inspectable.
- Direct evidence and inference are labeled separately.
- Hidden profile values remain hidden.
- The signed-in user only sees their own private profile.
- Safety and eligibility checks cannot be presented as completed when required information is unavailable.
- Navigation order remains stable across pages.

## 14. Complete statistics inventory

This section is the canonical list of every measurement the interface should preserve during a frontend rebuild.

### Signed-in user statistics

- Profile completion percentage.
  - Calculation: known profile fields divided by total supported fields.
- Known signals.
  - Number of profile fields that contain saved values.
- Missing signals.
  - Total supported fields minus known fields.
- Total supported signals.
  - Currently 15 fields across all disclosure levels.
- Account enrollment state.
  - Whether the user has a Wingman/MCP identity token.
- Account role.
  - Owner or regular member.
- Username and display name.
- Last profile update time.

### Disclosure statistics

- Number of visible fields at L0.
- Number of visible fields at L1.
- Number of visible fields at L2.
- Number of visible fields at L3.
- Fields withheld above the selected level.
- Fields removed by the never-share policy.
- Policy at every level:
  - Free
  - Ask
  - Never
- Forwardness value from 1 through 5.
- Number of never-share entries.

### Agent and channel statistics

- Number of active negotiation channels.
- Number of closed channels.
- Total messages exchanged in a channel.
- Maximum exchanges permitted in that channel.
- Remaining exchanges.
- Which person or agent the channel is waiting on.
- Current disclosure level reached by each side.
- Number of disclosures in the channel.
- Number of disclosures allowed automatically.
- Number of disclosures explicitly approved by a human.
- Verdict from each agent:
  - Match
  - Pass
  - Needs human
- Whether an introduction has been proposed.
- Whether a date has been proposed.
- Date acceptance count when a proposal exists.
- Channel creation time.
- Time of the newest message.

### Agentic page statistics

- Current workflow stage.
- Completed workflow stages.
- Remaining workflow stages.
- Total activity-log entries.
- Total sent messages.
- Total received messages.
- Total internal reasoning events.
- Pending human decisions.
- Current agent state:
  - Ready
  - Learning
  - Thinking
  - Negotiating
  - Waiting for approval
  - Matched
  - Passed

### Match statistics

- Match confidence percentage.
- Number of direct shared signals.
- Directly shared interests or keywords.
- Location compatibility state.
- Eligibility state:
  - Passed
  - Pending because required data is private or missing
  - Locked because of an incompatibility
- Number of profile facts considered.
- Number of unresolved constraints.
- Agent verdict.
- Agent-provided verdict reason.
- Candidate public-profile completeness.
- Whether an agent conversation exists.
- Number of messages in that conversation.

### Import statistics

- Parsing method:
  - JSON
  - Labeled text
  - No recognized format
- Number of extracted fields.
- Number of ignored keys.
- Number of empty values skipped.
- Number of fields that will be saved.
- Preview or saved state.

### System status statistics

- Server health.
- Number of profiles in the store.
- MCP endpoint status.
- TrueForge availability.
- Connector status.
- Agent status.
- Number of available tools.
- Tool classification.
- Whether a tool requires human approval.
- Authentication state.
- Owner-only status visibility.

## 15. Canonical profile fields

The frontend should preserve a place for all 15 fields even when some are empty.

### L0 — public

1. Vibe
2. Interests
3. Area
4. Good Saturday

### L1 — personal

5. Hobbies
6. Tastes
7. Looking for
8. Age band

### L2 — logistical

9. Availability
10. Neighborhood
11. Dealbreakers

### L3 — identity

12. Name
13. Photo
14. Job
15. Contact

Empty fields should read as unavailable or not provided. They must never be filled with guesses.

## 16. Canonical screen labels

These labels preserve the current information architecture. Their wording can be rewritten later without changing their purpose.

### Sidebar labels

- Agentic
- Self Stats
- Matches
- Import
- Status
- Settings
- Privacy Vault
- Sign out

### Agentic labels

- Live Agent Control
- Process Map
- What the agent is doing
- Agent Communication
- Agent Online
- Awaiting Operator
- Scanned Network
- Potential
- Consent Settings
- Refresh

### Workflow labels

- Know your personality
- Read your preferences
- Find potential people
- Talk to their agents
- Confirm an introduction
- Plan the next step
- Both sides agree

### Approval labels

- Human Checkpoint
- Approve
- Edit
- Say less
- Decline
- Send edit

### Self Stats labels

- Personal Signal Dashboard
- Profile Health
- What Wingman knows
- Known Signals
- Still Private
- Self Model
- How your agent understands you
- Privacy Ladder
- Signals visible by level
- Agent Estimates
- Current match confidence

### Matches labels

- Explainable Matching
- Every score includes an evidence trail
- Match
- Private
- Eligibility Pending
- Safety Lock
- View Agent Reasoning

### Match Detail labels

- Match Intelligence
- Agent Channel
- Private
- Why This Match
- The agents' reasoning trail
- Working Confidence
- Profile Evidence
- Constraint Check
- Confidence Limit
- Other Person Profile

### Import labels

- Profile Bootstrap
- Import from your AI
- Copy Prompt
- Ask Their AI
- Paste Response
- Code Parser
- Extracted Signals
- Preview
- Save Profile

### Authentication labels

- Sign in
- Username
- Password
- Create one
- Display name
- Create account

## 17. UI state inventory

The rebuilt frontend must account for each of these states.

### Global states

- Loading the first authenticated response.
- Authenticated.
- Session expired.
- Signed out.
- Server unreachable.
- Owner account.
- Regular account.
- Empty profile.
- Partially completed profile.
- Completed profile.

### Agentic states

- No channels or agent traffic.
- Channel opened but no messages sent.
- Outbound message sent.
- Inbound reply received.
- Internal reasoning recorded.
- Waiting for another agent.
- Waiting for the user.
- Disclosure automatically allowed.
- Disclosure approved by the user.
- Match verdict reached.
- Pass verdict reached.
- Channel closed.

### Matches states

- No candidates.
- Candidates available.
- Match evidence available.
- No direct overlap found.
- Eligibility information missing.
- Candidate locked by a safety constraint.
- Agent conversation available.
- No agent conversation yet.

### Import states

- Nothing pasted.
- Parsing.
- Valid preview.
- Partially valid preview.
- No fields recognized.
- Saving.
- Save succeeded.
- Save failed.

### Form states

- Default.
- Focused.
- Invalid.
- Disabled.
- Submitting.
- Success.
- Server error.

## 18. Data-to-screen mapping

This section identifies which backend data belongs on each screen.

### Agentic

Uses:

- Signed-in profile summary.
- Candidate public projections.
- Negotiation channels.
- Channel turns.
- Disclosure audit records.
- Agent verdicts.
- Introduction and date state.

### Self Stats

Uses:

- Signed-in user's full profile.
- Total field count.
- L0 through L3 shareable projections.
- Consent budget.
- Candidate public projections for estimates.

### Matches

Uses:

- Candidate public projections.
- Signed-in user's matching fields.
- Existing channels and verdicts.
- Eligibility status returned by the backend.

### Match Detail

Uses:

- Selected candidate public projection.
- The channel shared with that candidate.
- Turns in that channel.
- Disclosure field names and authority.
- Both agent verdicts and reasons.
- Introduction and date state.

### Import

Uses:

- Extraction prompt.
- Code-parser preview.
- Save result.
- Updated signed-in profile.

### Status

Uses:

- Pipeline checks.
- Available tools.
- Tool classifications.
- Approval policies.
- Connector and agent status.

### Settings

Uses:

- Current consent budget.
- Never-share entries.
- Forwardness.
- Shareable profile preview at every level.

## 19. Backend endpoint map

The current backend exposes these routes. Preserving this map allows the frontend to be rebuilt after pulling backend changes.

### Public routes

- `GET /health`
  - Basic server health and profile count.
- `GET /login`
  - Sign-in page.
- `POST /login`
  - Creates a dashboard session.
- `POST /logout`
  - Ends the dashboard session.
- `GET /join`
  - Account-creation page.
- `POST /join`
  - Creates an account and signs the person in.
- `POST /mcp`
  - Authenticated agent protocol endpoint.
- `GET /identity/me`
  - Resolves a Wingman token to its owner.

### Session-authenticated routes

- `GET /api/me`
  - Full signed-in profile, consent budget, account state, and L0–L3 projections.
- `GET /api/candidates`
  - Other people at their permitted public level.
- `GET /api/channels`
  - Negotiation channels belonging to the signed-in person.
- `GET /api/schema`
  - Profile fields and disclosure levels.
- `GET /api/import/prompt`
  - Prompt for extracting profile information from another AI.
- `POST /api/import`
  - Parses or saves imported profile information.
- `GET /api/token`
  - Signed-in person's MCP token and setup command.
- `POST /api/token/rotate`
  - Rotates the signed-in person's token.
- `PUT /api/budget`
  - Updates the signed-in person's consent budget.

### Owner-only routes

- `GET /api/status`
  - Infrastructure and TrueForge status.
- `POST /api/enroll`
  - Creates an invited identity.
- `POST /api/identity/primary`
  - Claims the host identity using the administrative key.

### Settings routes

- `GET /settings`
- `GET /me/budget`
- `POST /me/budget/preview`
- `PUT /me/budget`

## 20. Rebuild checklist after pulling backend changes

Use this order when replacing the frontend after a backend pull:

1. Preserve the backend authentication and authorization middleware.
2. Preserve all MCP, profile, channel, token, enrollment, and consent routes.
3. Confirm the signed-in identity comes from the server session, never from a frontend-supplied user ID.
4. Recreate the persistent application shell and sidebar.
5. Reconnect Self Stats to `/api/me`.
6. Reconnect candidate cards to `/api/candidates`.
7. Reconnect Agentic and Match Detail to `/api/channels`.
8. Reconnect Import to `/api/import/prompt` and `/api/import`.
9. Reconnect consent controls to the budget endpoints.
10. Restore every empty, loading, error, privacy, and eligibility state listed above.
11. Confirm regular users cannot load owner-only status data.
12. Confirm one signed-in user cannot request another user's private profile.
13. Verify the layout at desktop, tablet, and mobile widths.
14. Apply the new visual system only after the information architecture and data bindings work.

## 21. Files to preserve during a backend replacement

The following frontend references should be copied aside or kept on a separate branch before replacing the repository:

- `UI_LAYOUT_GUIDE.md`
  - Complete product and layout blueprint.
- `src/App.tsx`
  - Current screen composition and data placement.
- `src/index.css`
  - Current visual implementation. Optional when intentionally changing the palette.
- `src/components/`
  - Reusable interface components.
- `src/api.ts`
  - Frontend data contracts and request behavior.
- `src/main.tsx`
  - React entry point.
- `index.html`
  - Browser entry document.
- `components.json`
  - Component aliases and shadcn paths.
- `vite.config.ts`
  - Frontend build configuration.

Do not use `.env` to store this blueprint. Environment files are appropriate for ports, provider keys, public URLs, and runtime switches. Layout, labels, statistics, and screen behavior belong in version-controlled documentation and source files.
