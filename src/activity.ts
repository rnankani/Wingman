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

export type EventState = 'doing' | 'waiting' | 'did';

export interface ActivityEvent {
  id: string;
  ts: string;
  state: EventState;
  actor: string;
  title: string;
  detail: string;
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
    actor: 'Wingman',
    title: `Waiting on you: ${labelFor(a.action)}`,
    detail: a.sentence,
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
    return `Tell ${a.candidateName}'s wingman only that you're "into an active outdoorsy thing and good music" — no specifics yet.`;
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
      actor: 'You',
      title: `Declined: ${labelFor(a.action)}`,
      detail: a.sentence,
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
      actor: 'Wingman',
      title: 'Backing off to something vaguer',
      detail: 'You said no to that much detail — proposing a softer version instead of retrying the same thing.',
      approvalId: fallback.id,
    });
  } else {
    const sent = decision === 'edit' && editedText ? editedText : decision === 'vaguer' ? vaguerVersionOf(a) : a.sentence;
    a.sentSentence = sent;
    const label = decision === 'edit' ? 'Sent (edited)' : decision === 'vaguer' ? 'Sent (said less)' : 'Sent';
    pushEvent({
      state: 'did',
      actor: 'Wingman',
      title: `${label}: ${labelFor(a.action)}`,
      detail: sent,
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
      pushEvent({ state: 'doing', actor: 'Wingman', title: "Maya's wingman answered", detail: 'She climbs too, and just got back into vinyl — proposing the next step.' });
      demoTimer = setTimeout(() => {
        pushApproval({
          action: 'send_intro',
          candidateId: CANDIDATE.id,
          candidateName: CANDIDATE.name,
          sentence: `Tell Maya's wingman you'd like an intro — mention you're both usually at the climbing gym on weekends.`,
          fields: ['availability'],
        });
      }, 1400);
    }, 1200);
    return;
  }

  if (justResolved.action === 'send_intro') {
    demoTimer = setTimeout(() => {
      pushEvent({ state: 'doing', actor: 'Wingman', title: 'Finding a time and place', detail: 'Checking your evenings against a spot between your two neighborhoods.' });
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
      pushEvent({ state: 'did', actor: 'Wingman', title: 'Matched', detail: 'Invite sent for Thursday, 7:00 PM at The Anchor. Both sides confirmed.' });
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

  pushEvent({ state: 'doing', actor: 'Wingman', title: 'Reading your profile', detail: 'Recalling what you already told me before I do anything else.' });

  demoTimer = setTimeout(() => {
    pushEvent({ state: 'doing', actor: 'Wingman', title: 'Comparing you against 5 candidates', detail: 'Weighing shared interests, schedules, and dealbreakers.' });

    demoTimer = setTimeout(() => {
      pushEvent({ state: 'did', actor: 'Wingman', title: 'Found a strong match: Maya', detail: 'You both do the climbing-gym-then-record-store thing on Saturdays.' });

      demoTimer = setTimeout(() => {
        pushEvent({ state: 'doing', actor: 'Wingman', title: "Opening a conversation with Maya's wingman", detail: 'Starting at the public level — nothing identifying yet.' });

        demoTimer = setTimeout(() => {
          pushApproval({
            action: 'share_detail',
            candidateId: CANDIDATE.id,
            candidateName: CANDIDATE.name,
            sentence: `Tell Maya's wingman you climb and collect vinyl?`,
            fields: ['hobbies', 'tastes'],
          });
        }, 1200);
      }, 1400);
    }, 1600);
  }, 1000);
}
