/**
 * In-memory activity feed + approval gate for the cockpit UI.
 *
 * This is deliberately NOT wired to a real negotiation between two LLM
 * subagents — that lives in TrueForge once it's reachable. What this module
 * proves is the *contract* the UI is judged on: every state the agent can be
 * in (doing / waiting / did), and the fact that nothing irreversible crosses
 * the wire without a human clicking a button first. `runDemo` scripts a
 * realistic sequence of those states; the human still has to make every
 * approval decision for real — the UI is not narrating a canned video.
 */
import { randomUUID } from 'node:crypto';
import type { PoseName } from './brand.js';

export type EventState = 'doing' | 'waiting' | 'did';
export type WorkflowStage =
  | 'profile'
  | 'preferences'
  | 'discovery'
  | 'negotiation'
  | 'approval'
  | 'introduction'
  | 'planning'
  | 'matched';
export type EventKind = 'status' | 'message';
export type MessageDirection = 'internal' | 'outbound' | 'inbound';

export interface ActivityEvent {
  id: string;
  ts: string;
  state: EventState;
  stage: WorkflowStage;
  kind: EventKind;
  direction: MessageDirection;
  pose: PoseName;
  actor: string;
  title: string;
  detail: string;
  counterpart?: string;
  approvalId?: string;
}

export type ApprovalAction = 'share_detail' | 'send_intro' | 'book_date';
export type ApprovalDecision = 'approve' | 'edit' | 'decline' | 'vaguer';
export type ApprovalStatus = 'pending' | 'resolved';

export interface PendingApproval {
  id: string;
  ts: string;
  action: ApprovalAction;
  candidateId: string;
  candidateName: string;
  /** The exact sentence that would be sent. This is what the human reviews. */
  sentence: string;
  fields: string[];
  status: ApprovalStatus;
  decision?: ApprovalDecision;
  sentSentence?: string;
  resolvedAt?: string;
}

let events: ActivityEvent[] = [];
let approvals: PendingApproval[] = [];
let demoTimer: ReturnType<typeof setTimeout> | null = null;
let demoStep = 0;

export function listEvents(): ActivityEvent[] {
  return events;
}

export function listApprovals(): PendingApproval[] {
  return approvals;
}

function pushEvent(e: Omit<ActivityEvent, 'id' | 'ts'>): ActivityEvent {
  const full: ActivityEvent = { id: randomUUID(), ts: new Date().toISOString(), ...e };
  events.push(full);
  return full;
}

function pushApproval(a: Omit<PendingApproval, 'id' | 'ts' | 'status'>): PendingApproval {
  const full: PendingApproval = { id: randomUUID(), ts: new Date().toISOString(), status: 'pending', ...a };
  approvals.push(full);
  pushEvent({
    state: 'waiting',
    stage: 'approval',
    kind: 'status',
    direction: 'internal',
    pose: 'thinking',
    actor: 'Wingman',
    title: `Waiting on you: ${labelFor(a.action)}`,
    detail: a.sentence,
    counterpart: a.candidateName,
    approvalId: full.id,
  });
  return full;
}

function labelFor(action: ApprovalAction): string {
  return {
    share_detail: 'share a detail',
    send_intro: 'send an introduction',
    book_date: 'propose a date',
  }[action];
}

function vaguerVersionOf(a: PendingApproval): string {
  // A crude but real fallback: strip the sentence to the vibe-level clause.
  if (a.action === 'share_detail') {
    return `Tell ${a.candidateName}'s wingman only that you're into hands-on projects — no specifics yet.`;
  }
  if (a.action === 'send_intro') {
    return `Tell ${a.candidateName}'s wingman you're interested, without proposing anything concrete yet.`;
  }
  return `Ask ${a.candidateName}'s wingman for a general week that works, without naming a place yet.`;
}

/** The one function every irreversible action must pass through. */
export function decideApproval(
  id: string,
  decision: ApprovalDecision,
  editedText?: string,
): PendingApproval {
  const a = approvals.find((x) => x.id === id);
  if (!a) throw new Error('unknown approval');
  if (a.status !== 'pending') return a;

  a.status = 'resolved';
  a.decision = decision;
  a.resolvedAt = new Date().toISOString();

  if (decision === 'decline') {
    pushEvent({
      state: 'did',
      stage: 'approval',
      kind: 'status',
      direction: 'internal',
      pose: 'passed',
      actor: 'You',
      title: `Declined: ${labelFor(a.action)}`,
      detail: a.sentence,
      counterpart: a.candidateName,
    });
    const fallback = pushApproval({
      action: a.action,
      candidateId: a.candidateId,
      candidateName: a.candidateName,
      sentence: vaguerVersionOf(a),
      fields: [],
    });
    pushEvent({
      state: 'doing',
      stage: 'approval',
      kind: 'status',
      direction: 'internal',
      pose: 'thinking',
      actor: 'Wingman',
      title: 'Backing off to something vaguer',
      detail: 'You said no to that much detail — proposing a softer version instead of retrying the same thing.',
      counterpart: a.candidateName,
      approvalId: fallback.id,
    });
  } else {
    const sent = decision === 'edit' && editedText ? editedText : decision === 'vaguer' ? vaguerVersionOf(a) : a.sentence;
    a.sentSentence = sent;
    const label = decision === 'edit' ? 'Sent (edited)' : decision === 'vaguer' ? 'Sent (said less)' : 'Sent';
    const stage: WorkflowStage =
      a.action === 'share_detail'
        ? 'negotiation'
        : a.action === 'send_intro'
          ? 'introduction'
          : 'planning';
    pushEvent({
      state: 'did',
      stage,
      kind: 'message',
      direction: 'outbound',
      pose: 'negotiating',
      actor: 'Your Wingman',
      title: `${label}: ${labelFor(a.action)}`,
      detail: sent,
      counterpart: `${a.candidateName}'s Wingman`,
    });
    advanceDemo(a);
  }

  return a;
}

// ------------------------------------------------------------------- script
// A fixed, hand-written sequence so the "pick it up and drive" demo behaves
// identically every run. Each step only fires after the previous approval was
// actually resolved by a human click — nothing here is on a timer once a
// pending approval exists.

const CANDIDATE = { id: 'maya', name: 'Maya' };

/**
 * Keyed on the action that just got a real send, not a step counter — a
 * decline-then-vaguer loop can resolve the same `share_detail` approval twice
 * before it ever advances, and this must still only move forward once.
 */
function advanceDemo(justResolved: PendingApproval) {
  if (demoStep === 0) return; // demo isn't running

  if (justResolved.action === 'share_detail') {
    demoTimer = setTimeout(() => {
      pushEvent({
        state: 'doing',
        stage: 'negotiation',
        kind: 'message',
        direction: 'inbound',
        pose: 'negotiating',
        actor: "Maya's Wingman",
        title: "Maya's wingman answered",
        detail: 'Her profile also points to hands-on hobbies and curiosity — proposing the next simulated step.',
        counterpart: 'Your Wingman',
      });
      demoTimer = setTimeout(() => {
        pushApproval({
          action: 'send_intro',
          candidateId: CANDIDATE.id,
          candidateName: CANDIDATE.name,
          sentence: `Tell Maya's wingman you're interested in learning more based on the shared hands-on energy.`,
          fields: ['vibe', 'hobbies'],
        });
      }, 1400);
    }, 1200);
    return;
  }

  if (justResolved.action === 'send_intro') {
    demoTimer = setTimeout(() => {
      pushEvent({
        state: 'doing',
        stage: 'planning',
        kind: 'status',
        direction: 'internal',
        pose: 'thinking',
        actor: 'Wingman',
        title: 'Finding a time and place',
        detail: 'Checking your evenings against a spot between your two neighborhoods.',
        counterpart: CANDIDATE.name,
      });
      demoTimer = setTimeout(() => {
        pushApproval({
          action: 'book_date',
          candidateId: CANDIDATE.id,
          candidateName: CANDIDATE.name,
          sentence: `Propose Thursday, 7:00 PM at The Anchor — it's roughly between Hayes and the harbor side.`,
          fields: ['availability', 'neighborhood'],
        });
      }, 1600);
    }, 1200);
    return;
  }

  if (justResolved.action === 'book_date') {
    demoTimer = setTimeout(() => {
      pushEvent({
        state: 'did',
        stage: 'matched',
        kind: 'status',
        direction: 'internal',
        pose: 'matched',
        actor: 'Wingman',
        title: 'Matched',
        detail: 'Invite sent for Thursday, 7:00 PM at The Anchor. Both sides confirmed.',
        counterpart: CANDIDATE.name,
      });
      demoStep = 0;
    }, 900);
  }
}

export function resetDemo(): void {
  if (demoTimer) clearTimeout(demoTimer);
  demoTimer = null;
  demoStep = 0;
  events = [];
  approvals = [];
}

export function runDemo(): void {
  resetDemo();
  demoStep = 1;

  pushEvent({
    state: 'doing',
    stage: 'profile',
    kind: 'status',
    direction: 'internal',
    pose: 'learning',
    actor: 'Wingman',
    title: 'Reading your profile',
    detail: 'Recalling what you already told me before I do anything else.',
  });

  demoTimer = setTimeout(() => {
    pushEvent({
      state: 'doing',
      stage: 'preferences',
      kind: 'status',
      direction: 'internal',
      pose: 'thinking',
      actor: 'Wingman',
      title: 'Understanding your preferences',
      detail: 'Checking the interests, schedules, and dealbreakers you approved for matching.',
    });

    demoTimer = setTimeout(() => {
      pushEvent({
        state: 'did',
        stage: 'discovery',
        kind: 'status',
        direction: 'internal',
        pose: 'thinking',
        actor: 'Wingman',
        title: 'Found a demo candidate: Maya',
        detail: 'This scripted persona exercises the explainable-match flow; production contact still requires an age-band safety check.',
        counterpart: CANDIDATE.name,
      });

      demoTimer = setTimeout(() => {
        pushEvent({
          state: 'doing',
          stage: 'negotiation',
          kind: 'status',
          direction: 'internal',
          pose: 'negotiating',
          actor: 'Wingman',
          title: "Preparing a simulated agent exchange",
          detail: 'Demo-only channel. Starting at the public level — nothing identifying leaves until you approve it.',
          counterpart: "Maya's Wingman",
        });

        demoTimer = setTimeout(() => {
          pushApproval({
            action: 'share_detail',
            candidateId: CANDIDATE.id,
            candidateName: CANDIDATE.name,
            sentence: `Tell Maya's wingman you're into hands-on projects and figuring out how things work?`,
            fields: ['vibe', 'hobbies'],
          });
        }, 1200);
      }, 1400);
    }, 1600);
  }, 1000);
}
