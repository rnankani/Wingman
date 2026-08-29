# Wingman

Wingman is a safety-first protocol for two AI agents that negotiate on behalf of two people while keeping humans in control. The dating scenario is only the demo; the protocol is the point: staged disclosure, isolated agent context, and explicit approval before anything is sent.

## Why Wingman

Most agent systems optimize for completing a task. Wingman focuses on whether an agent should disclose information or take an action at all. Every outbound step is explainable, reviewable, and bounded by the information the human has approved for that situation.

## Core Features

### 1. Human approval gate and disclosure ladder

Every outbound message or proposal passes through a human approval gate before it leaves the system.

- **Approve** the proposed action as written.
- **Edit** the action before it is sent.
- **Decline** the action and stop that path.
- **Use a vaguer fallback** when the requested disclosure is too specific for the approved level.

The disclosure ladder prevents an agent from jumping directly from a harmless introduction to sensitive personal information. A denial must not silently retry the same disclosure; it should either ask for a different approval or fall back to a less revealing message.

### 2. Two-agent negotiation with isolated context

Each person has a parent agent that coordinates the interaction, plus a negotiation subagent that works only with the context approved for the current exchange.

- Subagents receive a minimal, task-specific context projection.
- Agents exchange structured messages instead of raw internal memory.
- A subagent returns a verdict to its parent rather than directly sending a message.
- The parent agent uses that verdict to propose the next human-reviewed action.

This separation makes the negotiation easier to inspect and keeps private context from leaking across agent boundaries.

### 3. Durable profile memory with shareable levels

A canonical profile stores a person's preferences, constraints, and other facts separately from what may be shared in a specific conversation.

The sharing boundary is exposed through a function such as:

```text
get_shareable_profile(level)
```

The function returns a sanitized projection containing only information allowed at the requested disclosure level. The canonical profile remains durable, while each negotiation receives a temporary shareable view.

## Architecture

```text
Human A                         Human B
   |                               |
   v                               v
Parent Agent A                 Parent Agent B
   |                               |
   +-------- Approval Gate --------+
              |
              v
     Disclosure / Context Service
          |                 |
          v                 v
  Isolated Agent A   Isolated Agent B
          |                 |
          +---- Structured ----+
                Messages
                   |
                   v
             Verdict to Parent
                   |
                   v
              Human Review
```

### Request flow

1. A parent agent prepares a proposed message or negotiation step.
2. The profile service creates a shareable projection for the approved disclosure level.
3. The approval gate shows the human what will be sent and what information it contains.
4. The human approves, edits, declines, or requests a vaguer fallback.
5. Only approved context is passed to the isolated negotiation subagent.
6. The subagent returns a structured verdict to its parent agent.
7. The next outbound action goes through the approval gate again.

## Safety Invariants

These rules are the core of the protocol and should remain true as the implementation grows:

- No outbound message is sent without explicit human approval.
- A subagent can see only the approved context projection for its task.
- An agent cannot raise the disclosure level on its own.
- Declining a disclosure does not authorize a disguised retry at the same level.
- Subagents return decisions or proposals to their parent; they do not bypass the parent or approval gate.
- Approval decisions and disclosure levels should be auditable.

## Suggested Data Contracts

The exact language and framework are intentionally open, but the implementation should preserve contracts like these:

```text
type DisclosureLevel = "public" | "contextual" | "sensitive"

type ApprovalDecision = "approve" | "edit" | "decline" | "fallback"

type NegotiationVerdict =
  "continue" | "ask_human" | "propose" | "decline"

profile.get_shareable_profile(level) -> ShareableProfile
approval_gate.review(action, level) -> ApprovalDecision
negotiator.evaluate(approved_context) -> NegotiationVerdict
```

## Suggested Project Layout

```text
.
├── src/
│   ├── approval/       # Human review and disclosure decisions
│   ├── negotiation/    # Parent agents and isolated subagents
│   ├── profiles/       # Durable memory and shareable projections
│   ├── storage/        # Persistence and audit records
│   └── ui/             # Demo surface or API handlers
├── tests/
├── .env.example
└── README.md
```

## Getting Started

This repository currently contains the initial protocol design. Once the runtime scaffold is added, use the following as the setup shape:

### Prerequisites

- A supported runtime and package manager selected for the implementation.
- Credentials for the model provider used by the agents.
- A durable storage option for profiles and audit events.
- A local environment where outbound actions can be reviewed before they are sent.

### Setup placeholder

```bash
git clone https://github.com/rnankani/8-29-Hackathon.git
cd 8-29-Hackathon
cp .env.example .env
# Add model-provider credentials and storage settings to .env
# Install dependencies with the project's package manager
# Start the development server or demo
```

The first runnable version should expose a small end-to-end path: create or load a profile, generate a shareable projection, present an approval request, run an isolated negotiation step, and return a verdict without bypassing human review.

## Extending Wingman

Good next slices of work are:

1. Implement the profile store and `get_shareable_profile(level)` projection rules.
2. Build the approval gate with approve, edit, decline, and fallback states.
3. Add isolated subagent execution with a strict input/output schema.
4. Persist audit events for disclosure level, approval decision, and verdict.
5. Add a small demo UI that makes the approval boundary visible.
6. Add tests proving that unapproved context cannot reach a subagent or outbound sender.

## Project Status

Wingman is an early hackathon prototype. The README defines the protocol boundary and the first implementation milestones; the runtime and demo can be layered on top without changing the safety invariants above.
