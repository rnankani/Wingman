import {
  ArrowLeft,
  BarChart3,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Gauge,
  HeartHandshake,
  Import,
  LockKeyhole,
  LogOut,
  MessageSquareMore,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  json,
  type ActivityEvent,
  type Approval,
  type Candidate,
  type Channel,
  type ImportPreview,
  type Profile,
  type Schema,
  type View,
  type WorkflowStage,
} from '@/api';
import { Chikny, type ChiknyPose } from '@/components/chikny';
import { FlowButton } from '@/components/ui/flow-button';
import { GlowCard } from '@/components/ui/spotlight-card';
import { cn } from '@/lib/utils';

const WORKFLOW: Array<{ id: WorkflowStage; label: string; short: string }> = [
  { id: 'profile', label: 'Know your personality', short: 'PERSONALITY' },
  { id: 'preferences', label: 'Read your preferences', short: 'PREFERENCES' },
  { id: 'discovery', label: 'Find potential people', short: 'DISCOVERY' },
  { id: 'negotiation', label: 'Talk to their agents', short: 'NEGOTIATING' },
  { id: 'introduction', label: 'Confirm an introduction', short: 'INTRO' },
  { id: 'planning', label: 'Plan the next step', short: 'PLANNING' },
  { id: 'matched', label: 'Both sides agree', short: 'MATCHED' },
];

const COLORS = ['blue', 'green', 'purple', 'orange', 'red'] as const;
const GLOW = ['orange', 'purple', 'green', 'blue', 'red'] as const;

function initialView(): View {
  if (location.hash === '#import') return 'import';
  if (location.hash === '#stats') return 'stats';
  if (location.hash === '#matches' || location.hash === '#people') return 'matches';
  return 'agentic';
}

function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function pendingStage(approval?: Approval): WorkflowStage | null {
  if (!approval) return null;
  if (approval.action === 'share_detail') return 'negotiation';
  if (approval.action === 'send_intro') return 'introduction';
  return 'planning';
}

function words(value?: string) {
  return value?.toLowerCase().match(/[a-z]{4,}/g) ?? [];
}

function compatibility(me: Profile | undefined, candidate: Profile) {
  const keys = ['interests', 'hobbies', 'tastes', 'goodSaturday'];
  const mine = new Set(keys.flatMap((key) => words(me?.fields[key])));
  const shared: string[] = [];
  for (const key of keys) {
    for (const word of words(candidate.fields[key])) {
      if (mine.has(word) && !shared.includes(word)) shared.push(word);
    }
  }
  return { score: shared.length, shared };
}

function candidateProfile(candidate: Candidate): Profile {
  const view = { fields: candidate.fields, redacted: candidate.redacted, withheldAbove: [] };
  return {
    userId: candidate.userId,
    displayName: candidate.displayName,
    isPersona: candidate.isPersona,
    updatedAt: new Date(0).toISOString(),
    fields: candidate.fields,
    known: Object.keys(candidate.fields).length,
    total: 15,
    views: { L0: view, L1: view, L2: view, L3: view },
  };
}

function channelActivity(channels: Channel[], me: Profile): ActivityEvent[] {
  const names = new Map<string, string>([[me.userId, me.displayName || me.fields.name || 'You']]);
  const events: ActivityEvent[] = [];
  for (const channel of channels) {
    const other = channel.parties.find((id) => id !== me.userId) ?? 'their agent';
    for (const turn of channel.turns) {
      const outbound = turn.from === me.userId;
      events.push({
        id: `${channel.id}:${turn.at}:${events.length}`,
        ts: turn.at,
        state: 'did',
        stage: channel.closed ? 'matched' : 'negotiation',
        kind: 'message',
        direction: outbound ? 'outbound' : 'inbound',
        pose: 'negotiating',
        actor: outbound ? 'Your Wingman' : `${names.get(turn.from) ?? turn.from}'s Wingman`,
        counterpart: outbound ? `${other}'s Wingman` : 'Your Wingman',
        title: outbound ? `Sent at ${turn.level}` : `Agent replied at ${turn.level}`,
        detail: turn.message,
      });
    }
    for (const disclosure of channel.disclosures) {
      events.push({
        id: `${channel.id}:disclosure:${disclosure.from}:${disclosure.field}`,
        ts: channel.createdAt,
        state: 'did',
        stage: 'approval',
        kind: 'status',
        direction: 'internal',
        pose: 'thinking',
        actor: 'Wingman',
        title: `${disclosure.field} shared at ${disclosure.level}`,
        detail: `${disclosure.via === 'approved' ? 'You approved' : 'Your consent budget allowed'} this field. The audit log records the authority, not the private value.`,
        counterpart: other,
      });
    }
    for (const [from, verdict] of Object.entries(channel.verdicts)) {
      events.push({
        id: `${channel.id}:verdict:${from}`,
        ts: channel.createdAt,
        state: 'did',
        stage: verdict.verdict === 'match' ? 'matched' : 'negotiation',
        kind: 'status',
        direction: 'internal',
        pose: verdict.verdict === 'match' ? 'matched' : verdict.verdict === 'pass' ? 'passed' : 'thinking',
        actor: from === me.userId ? 'Your Wingman' : `${from}'s Wingman`,
        title: `Verdict: ${verdict.verdict.replace('_', ' ')}`,
        detail: verdict.reason,
        counterpart: other,
      });
    }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

function matchInsight(me: Profile | undefined, candidate: Profile) {
  const direct = compatibility(me, candidate).shared;
  const sameArea = Boolean(me?.fields.area && candidate.fields.area &&
    me.fields.area.toLowerCase() === candidate.fields.area.toLowerCase());
  const myAge = me?.fields.ageBand?.toLowerCase();
  const candidateAge = candidate.fields.ageBand?.toLowerCase();
  const eligibilityPending = Boolean(myAge?.includes('teen') && !candidateAge);
  const ageLocked = Boolean(myAge?.includes('teen') && candidateAge && !candidateAge.includes('teen'));
  const confidence = Math.min(94, 48 + direct.length * 9 + (sameArea ? 8 : 0));
  const reasons = [
    direct.length
      ? `Direct overlap: ${direct.slice(0, 3).join(', ')}`
      : 'Both profiles describe hands-on, curiosity-led hobbies',
    sameArea ? 'You are in the same area' : 'Location compatibility still needs confirmation',
    'Confidence uses only saved profile fields; missing answers are not guessed',
  ];
  return { confidence, direct, reasons, ageLocked, eligibilityPending };
}

interface Snapshot {
  stage: WorkflowStage | null;
  pose: ChiknyPose;
  title: string;
  detail: string;
  pending?: Approval;
}

function currentSnapshot(events: ActivityEvent[], approvals: Approval[]): Snapshot {
  const pending = [...approvals].reverse().find((approval) => approval.status === 'pending');
  if (pending) {
    return {
      stage: pendingStage(pending),
      pose: 'thinking',
      title: 'Waiting for your call',
      detail: `Nothing goes to ${pending.candidateName}'s agent until you approve it.`,
      pending,
    };
  }
  const latest = events.at(-1);
  if (latest) {
    return {
      stage: latest.stage === 'approval' ? 'negotiation' : latest.stage,
      pose: latest.pose,
      title: latest.title,
      detail: latest.detail,
    };
  }
  return {
    stage: null,
    pose: 'idle',
    title: 'Your agent is ready',
    detail: 'Waiting for activity from your connected Wingman agents.',
  };
}

function IconButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'primary' | 'danger' | 'warm';
}) {
  return (
    <button className={cn('pixel-button', `pixel-button--${tone}`)} onClick={onClick}>
      {children}
    </button>
  );
}

function Sidebar({
  view,
  pending,
  me,
  onNavigate,
  onLogout,
}: {
  view: View;
  pending: number;
  me?: Profile;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}) {
  const items = [
    { id: 'agentic' as const, label: 'Agentic', icon: BrainCircuit, count: pending },
    { id: 'stats' as const, label: 'Self Stats', icon: BarChart3 },
    { id: 'matches' as const, label: 'Matches', icon: HeartHandshake },
    { id: 'import' as const, label: 'Import', icon: Import },
  ];
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><Chikny pose="greeting" /></div>
        <div><strong>WINGMAN</strong><span>AGENT LINK</span></div>
      </div>
      <div className="search-shell">
        <Search size={15} />
        <span>SEARCH</span>
        <kbd>⌘K</kbd>
      </div>
      <span className="nav-label">MAIN MENU</span>
      <nav className="side-nav">
        {items.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            className={cn('side-link', view === id && 'is-active')}
            onClick={() => onNavigate(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {!!count && <b>{count}</b>}
          </button>
        ))}
        <button className="side-link" onClick={() => { location.href = '/status'; }}>
          <Gauge size={18} /><span>Status</span><ExternalLink size={12} />
        </button>
        <button className="side-link" onClick={() => { location.href = '/settings'; }}>
          <Settings size={18} /><span>Settings</span><ExternalLink size={12} />
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="vault-card"><LockKeyhole size={18} /><strong>PRIVACY VAULT</strong><span>IDENTITY DATA LOCKED</span></div>
      <div className="operator-card">
        <div className="operator-avatar">YOU</div>
        <div><strong>{me?.displayName || me?.fields.name || 'YOU'}</strong><span>{me ? `${me.known}/${me.total} SIGNALS` : 'NO PROFILE'}</span></div>
        <button className="logout-button" aria-label="Sign out" onClick={onLogout}><LogOut size={14} /></button>
      </div>
    </aside>
  );
}

function StageList({ active }: { active: WorkflowStage | null }) {
  const activeIndex = WORKFLOW.findIndex(({ id }) => id === active);
  return (
    <div className="stage-list">
      {WORKFLOW.map((stage, index) => {
        const done = activeIndex >= 0 && index < activeIndex;
        const current = index === activeIndex;
        return (
          <div key={stage.id} className={cn('stage-item', done && 'is-done', current && 'is-current')}>
            <div className="stage-led">{done ? <Check size={11} /> : String(index + 1).padStart(2, '0')}</div>
            <div><strong>{stage.label}</strong><span>{stage.short}</span></div>
            {current && <span className="stage-pulse">LIVE</span>}
          </div>
        );
      })}
    </div>
  );
}

function ApprovalGate({
  approval,
  schema,
  onDecision,
}: {
  approval: Approval;
  schema: Schema;
  onDecision: (id: string, decision: string, editedText?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(approval.sentence);
  return (
    <div className="approval-gate">
      <div className="gate-heading"><ShieldCheck size={15} /> HUMAN CHECKPOINT</div>
      <blockquote>{approval.sentence}</blockquote>
      <div className="signal-tags">
        {approval.fields.map((field) => (
          <span key={field}>{field} · {schema.fieldLevels[field]}</span>
        ))}
      </div>
      <div className="gate-actions">
        <IconButton tone="primary" onClick={() => void onDecision(approval.id, 'approve')}><Check size={14} />Approve</IconButton>
        <IconButton onClick={() => setEditing((value) => !value)}>Edit</IconButton>
        <IconButton tone="warm" onClick={() => void onDecision(approval.id, 'vaguer')}>Say less</IconButton>
        <IconButton tone="danger" onClick={() => void onDecision(approval.id, 'decline')}><X size={14} />Decline</IconButton>
      </div>
      {editing && (
        <div className="edit-gate">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          <IconButton tone="primary" onClick={() => void onDecision(approval.id, 'edit', draft)}><Send size={14} />Send edit</IconButton>
        </div>
      )}
    </div>
  );
}

function ChatMessage({ event }: { event: ActivityEvent }) {
  const initial = event.direction === 'inbound'
    ? (event.actor.match(/[A-Z]/)?.[0] ?? 'A')
    : event.direction === 'outbound' ? 'W' : 'AI';
  return (
    <div className={cn('chat-row', `chat-row--${event.direction}`)}>
      <div className="chat-avatar" aria-hidden="true">{initial}</div>
      <article className={cn('message', `message--${event.direction}`)}>
        <div className="message-route">
          <strong>{event.actor}</strong>
          {event.counterpart && <><ChevronRight size={12} /><span>{event.counterpart}</span></>}
          <time>{ago(event.ts)}</time>
        </div>
        <h4>{event.title}</h4>
        <p>{event.detail}</p>
        <span className="message-kind">{event.kind === 'message' ? `${event.direction} · seen` : 'agent reasoning'}</span>
      </article>
    </div>
  );
}

function Transcript({
  events,
  approvals,
  schema,
  onDecision,
}: {
  events: ActivityEvent[];
  approvals: Approval[];
  schema: Schema;
  onDecision: (id: string, decision: string, editedText?: string) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [events.length, approvals.filter((item) => item.status === 'pending').length]);

  if (!events.length) {
    return <div className="empty-feed"><MessageSquareMore size={25} /><span>NO AGENT TRAFFIC YET</span></div>;
  }
  return (
    <div className="transcript">
      {events.map((event) => {
        const approval = event.approvalId
          ? approvals.find((candidate) => candidate.id === event.approvalId && candidate.status === 'pending')
          : undefined;
        return (
          <div key={event.id}>
            <ChatMessage event={event} />
            {approval && <ApprovalGate approval={approval} schema={schema} onDecision={onDecision} />}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function AgentChamber({ snapshot }: { snapshot: Snapshot }) {
  const stage = WORKFLOW.find(({ id }) => id === snapshot.stage);
  return (
    <section className="agent-chamber pixel-panel">
      <div className="panel-kicker"><span className={cn('live-led', snapshot.pending && 'is-waiting')} />{snapshot.pending ? 'AWAITING OPERATOR' : 'AGENT ONLINE'}</div>
      <div className="avatar-orbit">
        <div className="pixel-cross pixel-cross--one" />
        <div className="pixel-cross pixel-cross--two" />
        <Chikny pose={snapshot.pose} label={snapshot.title} />
      </div>
      <div className="agent-readout">
        <span>{stage?.short ?? 'STANDBY'}</span>
        <h2>{snapshot.title}</h2>
        <p>{snapshot.detail}</p>
      </div>
    </section>
  );
}

function PotentialCards({
  profiles,
  onSelect,
}: {
  profiles: Profile[];
  onSelect: (profile: Profile) => void;
}) {
  const me = profiles[0];
  const candidates = profiles
    .slice(1)
    .map((profile) => ({ profile, match: compatibility(me, profile) }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 4);
  return (
    <section className="potential-section">
      <div className="section-heading"><div><span>SCANNED NETWORK</span><h3>Potential</h3></div><Users size={20} /></div>
      <div className="potential-strip">
        {candidates.map(({ profile, match }, index) => {
          const name = profile.fields.name || profile.userId;
          const insight = matchInsight(me, profile);
          return (
            <button key={profile.userId} className="potential-button" onClick={() => onSelect(profile)}>
              <GlowCard customSize glowColor={GLOW[index % GLOW.length]} className="match-glow-card">
                <div className="match-topline"><span>0{index + 1}</span>{insight.ageLocked || insight.eligibilityPending ? <LockKeyhole size={15} /> : <HeartHandshake size={17} />}</div>
                <div className={cn('pixel-avatar', `pixel-avatar--${COLORS[index % COLORS.length]}`)}>{name[0]}</div>
                <div className="match-info">
                  <strong>{name}</strong>
                  <span>{profile.fields.area || 'LOCATION HIDDEN'}</span>
                  <p>{insight.ageLocked ? 'AGE-BAND SAFETY LOCK' : insight.eligibilityPending ? 'ELIGIBILITY CHECK PENDING' : match.shared.length ? `SHARED: ${match.shared.slice(0, 2).join(' + ')}` : profile.fields.vibe}</p>
                </div>
                <div className="match-open">VIEW REASONING <ChevronRight size={14} /></div>
              </GlowCard>
            </button>
          );
        })}
        {!candidates.length && <div className="empty-potential">RUN <code>npm run seed</code> TO LOAD POTENTIAL MATCHES</div>}
      </div>
    </section>
  );
}

function Cockpit({
  events,
  approvals,
  profiles,
  schema,
  onDecision,
  onRefresh,
  onSelect,
}: {
  events: ActivityEvent[];
  approvals: Approval[];
  profiles: Profile[];
  schema: Schema;
  onDecision: (id: string, decision: string, editedText?: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelect: (profile: Profile) => void;
}) {
  const snapshot = currentSnapshot(events, approvals);
  return (
    <>
      <PageHeader eyebrow="LIVE AGENT CONTROL" title="Agentic">
        <FlowButton text="Consent settings" onClick={() => { location.href = '/settings'; }} />
        <IconButton onClick={() => void onRefresh()}><RefreshCw size={14} />Refresh</IconButton>
      </PageHeader>
      <div className="cockpit-grid">
        <div className="cockpit-left">
          <section className="pixel-panel stage-panel">
            <div className="panel-heading"><span>PROCESS MAP</span><strong>What the agent is doing</strong></div>
            <StageList active={snapshot.stage} />
          </section>
          <section className="pixel-panel comm-panel">
            <div className="panel-heading panel-heading--row">
              <div><span>LIVE WIRE</span><strong>Agent communication</strong></div>
              <b>{events.length.toString().padStart(2, '0')} LOGS</b>
            </div>
            <Transcript events={events} approvals={approvals} schema={schema} onDecision={onDecision} />
          </section>
        </div>
        <div className="cockpit-right">
          <AgentChamber snapshot={snapshot} />
          <PotentialCards profiles={profiles} onSelect={onSelect} />
        </div>
      </div>
    </>
  );
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div><span>{eyebrow}</span><h1>{title}</h1></div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

function MatchDetail({
  profile,
  me,
  events,
  schema,
  onBack,
}: {
  profile: Profile;
  me?: Profile;
  events: ActivityEvent[];
  schema: Schema;
  onBack: () => void;
}) {
  const name = profile.fields.name || profile.userId;
  const needle = profile.userId.toLowerCase();
  const messages = events.filter((event) =>
    `${event.actor} ${event.counterpart ?? ''}`.toLowerCase().includes(needle),
  );
  const insight = matchInsight(me, profile);
  return (
    <>
      <PageHeader eyebrow="MATCH INTELLIGENCE" title={name}>
        <span className={cn('safety-badge', (insight.ageLocked || insight.eligibilityPending) && 'is-locked')}>
          <LockKeyhole size={13} />{insight.ageLocked ? 'Safety locked' : insight.eligibilityPending ? 'Eligibility pending' : 'Privacy locked'}
        </span>
        <IconButton onClick={onBack}><ArrowLeft size={14} />Back</IconButton>
      </PageHeader>
      <div className="match-detail-grid">
        <section className="pixel-panel match-chat">
          <div className="chat-profile-bar">
            <div className="chat-profile-stack">
              <div className="chat-profile-avatar chat-profile-avatar--wingman">W</div>
              <div className="chat-profile-avatar">{name[0]}</div>
            </div>
            <div><strong>Wingman × {name}</strong><span><i /> AGENT CHANNEL · PRIVATE</span></div>
            <LockKeyhole size={16} />
          </div>
          {messages.length ? (
            <div className="transcript match-transcript">{messages.map((event) => <ChatMessage key={event.id} event={event} />)}</div>
          ) : <div className="empty-feed"><MessageSquareMore /><span>NO CONVERSATION WITH THIS AGENT YET</span></div>}
        </section>
        <aside className="match-insight-column">
          <section className="pixel-panel reason-card">
            <div className="panel-heading"><span>WHY THIS MATCH</span><strong>The agents' reasoning trail</strong></div>
            <div className="confidence-row">
              <div><strong>{insight.confidence}%</strong><span>WORKING CONFIDENCE</span></div>
              <div className="confidence-track"><i style={{ width: `${insight.confidence}%` }} /></div>
            </div>
            <ol className="reason-timeline">
              {insight.reasons.map((reason, index) => (
                <li key={reason}><b>{String(index + 1).padStart(2, '0')}</b><div><span>{index === 0 ? 'PROFILE EVIDENCE' : index === 1 ? 'CONSTRAINT CHECK' : 'CONFIDENCE LIMIT'}</span><p>{reason}</p></div></li>
              ))}
            </ol>
            {insight.ageLocked && (
              <div className="safety-lock"><LockKeyhole size={18} /><div><strong>Age-band safety lock</strong><p>This demo profile is outside your age band. Agents can explain the result, but cannot make contact.</p></div></div>
            )}
          </section>
          <section className="pixel-panel profile-file">
          <div className="profile-banner">
            <div className="pixel-avatar pixel-avatar--purple">{name[0]}</div>
            <div><span>OTHER PERSON PROFILE</span><h2>{name}</h2><p>{profile.fields.vibe}</p></div>
          </div>
          <div className="profile-signals">
            {Object.entries(profile.views.L1.fields).map(([key, value]) => (
              <div key={key}><span>{key.toUpperCase()} · {schema.fieldLevels[key]}</span><p>{value}</p></div>
            ))}
          </div>
          <div className="privacy-note"><ShieldCheck size={16} />Only fields this person made public are visible here.</div>
          </section>
        </aside>
      </div>
    </>
  );
}

function SelfStats({ me, profiles }: { me?: Profile; profiles: Profile[] }) {
  const known = me?.known ?? 0;
  const total = me?.total ?? 15;
  const completion = Math.round((known / total) * 100);
  const levels = ['L0', 'L1', 'L2', 'L3'].map((level) => ({
    level,
    count: Object.keys(me?.views[level as keyof Profile['views']]?.fields ?? {}).length,
  }));
  const ranked = profiles.filter((profile) => profile.isPersona)
    .map((profile) => ({ profile, insight: matchInsight(me, profile) }))
    .sort((a, b) => b.insight.confidence - a.insight.confidence)
    .slice(0, 4);
  return (
    <>
      <PageHeader eyebrow="PERSONAL SIGNAL DASHBOARD" title="Self Stats" />
      <div className="stats-grid">
        <section className="dashboard-card stats-hero">
          <div className="dashboard-card-title"><div><span>PROFILE HEALTH</span><strong>What Wingman knows</strong></div><UserRound /></div>
          <div className="completion-layout">
            <div className="completion-ring" style={{ '--completion': `${completion * 3.6}deg` } as CSSProperties}><strong>{completion}%</strong><span>COMPLETE</span></div>
            <div><h2>{me?.fields.name || 'Your profile'}</h2><p>{me?.fields.vibe || 'Import a profile to teach Wingman your vibe.'}</p><b>{known} OF {total} SIGNALS KNOWN</b></div>
          </div>
        </section>
        <section className="dashboard-card metric-card metric-card--yellow"><Sparkles /><strong>{known}</strong><span>KNOWN SIGNALS</span><small>Used with your permission</small></section>
        <section className="dashboard-card metric-card metric-card--purple"><LockKeyhole /><strong>{total - known}</strong><span>STILL PRIVATE</span><small>Never guessed by the agent</small></section>
        <section className="dashboard-card profile-understanding">
          <div className="dashboard-card-title"><div><span>SELF MODEL</span><strong>How your agent understands you</strong></div><BrainCircuit /></div>
          <div className="understanding-list">
            {['interests', 'hobbies', 'area', 'lookingFor'].map((key) => (
              <div key={key}><span>{key}</span><p>{me?.fields[key] || 'Not provided yet'}</p></div>
            ))}
          </div>
        </section>
        <section className="dashboard-card disclosure-chart">
          <div className="dashboard-card-title"><div><span>PRIVACY LADDER</span><strong>Signals visible by level</strong></div><ShieldCheck /></div>
          <div className="bar-chart">
            {levels.map(({ level, count }, index) => <div key={level}><span>{level}</span><i><b style={{ width: `${Math.max(8, (count / total) * 100)}%` }} className={`bar-tone-${index}`} /></i><strong>{count}</strong></div>)}
          </div>
        </section>
        <section className="dashboard-card match-readiness">
          <div className="dashboard-card-title"><div><span>AGENT ESTIMATES</span><strong>Current match confidence</strong></div><TrendingUp /></div>
          <div className="readiness-list">{ranked.map(({ profile, insight }) => (
            <div key={profile.userId}><span>{profile.fields.name || profile.userId}</span><i><b style={{ width: `${insight.confidence}%` }} /></i><strong>{insight.confidence}%</strong></div>
          ))}</div>
        </section>
      </div>
    </>
  );
}

function Matches({ profiles, onSelect }: { profiles: Profile[]; onSelect: (profile: Profile) => void }) {
  const me = profiles[0];
  return (
    <>
      <PageHeader eyebrow="EXPLAINABLE MATCHING" title="Matches">
        <span className="header-note"><ShieldCheck size={13} />Every score includes an evidence trail</span>
      </PageHeader>
      <div className="matches-dashboard">
        {profiles.slice(1).map((profile, index) => {
          const name = profile.fields.name || profile.userId;
          const insight = matchInsight(me, profile);
          return (
            <button key={profile.userId} className="match-dashboard-card dashboard-card" onClick={() => onSelect(profile)}>
              <div className="match-dashboard-top">
                <div className={cn('pixel-avatar', `pixel-avatar--${COLORS[index % COLORS.length]}`)}>{name[0]}</div>
                <span className={cn('mini-lock', (insight.ageLocked || insight.eligibilityPending) && 'is-locked')}><LockKeyhole size={12} />{insight.ageLocked ? 'SAFETY LOCK' : insight.eligibilityPending ? 'CHECK PENDING' : 'PRIVATE'}</span>
              </div>
              <div className="match-dashboard-name"><div><span>MATCH {String(index + 1).padStart(2, '0')}</span><h3>{name}</h3></div><strong>{insight.confidence}%</strong></div>
              <div className="confidence-track"><i style={{ width: `${insight.confidence}%` }} /></div>
              <p>{profile.fields.vibe}</p>
              <div className="match-reason-preview"><BrainCircuit size={15} /><span>{insight.reasons[0]}</span></div>
              <div className="match-open">VIEW AGENT REASONING <ChevronRight size={14} /></div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ImportView({ prompt, onSaved }: { prompt: string; onSaved: () => Promise<void> }) {
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const submit = async (save: boolean) => {
    try {
      setError('');
      const result = await json<ImportPreview>('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paste, save }),
      });
      setPreview(result);
      if (save) await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed');
    }
  };
  return (
    <>
      <PageHeader eyebrow="PROFILE BOOTSTRAP" title="Import from your AI">
        <IconButton onClick={() => void navigator.clipboard.writeText(prompt)}><Copy size={14} />Copy prompt</IconButton>
      </PageHeader>
      <div className="import-grid">
        <section className="pixel-panel import-step">
          <div className="step-number">01</div><div className="panel-heading"><span>ASK THEIR AI</span><strong>Copy this prompt</strong></div>
          <textarea value={prompt} readOnly />
        </section>
        <section className="pixel-panel import-step">
          <div className="step-number">02</div><div className="panel-heading"><span>PASTE RESPONSE</span><strong>Drop the JSON here</strong></div>
          <textarea value={paste} onChange={(event) => setPaste(event.target.value)} placeholder='{"vibe":"...", "hobbies":"..."}' />
          <div className="import-actions">
            <IconButton onClick={() => void submit(false)}><Sparkles size={14} />Preview</IconButton>
            <FlowButton text="Save profile" onClick={() => void submit(true)} />
          </div>
          {error && <p className="form-error">{error}</p>}
        </section>
        <section className="pixel-panel import-step import-results">
          <div className="step-number">03</div><div className="panel-heading"><span>CODE PARSER</span><strong>Extracted signals</strong></div>
          {preview && Object.keys(preview.fields).length ? (
            <div className="profile-signals">{Object.entries(preview.fields).map(([key, value]) => <div key={key}><span>{key}</span><p>{value}</p></div>)}</div>
          ) : <div className="empty-feed"><Bot /><span>NO SIGNALS PARSED</span></div>}
        </section>
      </div>
    </>
  );
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [schema, setSchema] = useState<Schema>({ levels: [], levelLabels: {}, fieldLevels: {} });
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<Profile>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [meData, candidateData, channelData, schemaData, promptData] = await Promise.all([
        json<Profile>('/api/me'),
        json<{ candidates: Candidate[] }>('/api/candidates'),
        json<{ channels: Channel[] }>('/api/channels'),
        json<Schema>('/api/schema'),
        prompt ? Promise.resolve({ prompt }) : json<{ prompt: string }>('/api/import/prompt'),
      ]);
      setEvents(channelActivity(channelData.channels, meData));
      setApprovals([]);
      setProfiles([meData, ...candidateData.candidates.map(candidateProfile)]);
      setSchema(schemaData);
      setPrompt(promptData.prompt);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reach Wingman');
    }
  }, [prompt]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const syncHash = () => {
      if (location.hash !== '#match') {
        setView(initialView());
        setSelected(undefined);
      }
    };
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const navigate = (next: View) => {
    setView(next);
    setSelected(undefined);
    location.hash = next === 'agentic' ? '' : next;
  };
  const select = (profile: Profile) => {
    setSelected(profile);
    setView('match');
  };
  const decide = async () => { await load(); };
  const pending = useMemo(() => approvals.filter((approval) => approval.status === 'pending').length, [approvals]);
  const me = profiles[0];
  const logout = async () => {
    await fetch('/logout', { method: 'POST' });
    location.assign('/login');
  };

  return (
    <div className="app-shell">
      <Sidebar view={view} pending={pending} me={me} onNavigate={navigate} onLogout={() => void logout()} />
      <main className="main-stage">
        <div className="scanlines" />
        {error && <div className="connection-error">{error}</div>}
        {view === 'agentic' && <Cockpit events={events} approvals={approvals} profiles={profiles} schema={schema} onDecision={decide} onRefresh={load} onSelect={select} />}
        {view === 'stats' && <SelfStats me={me} profiles={profiles} />}
        {view === 'matches' && <Matches profiles={profiles} onSelect={select} />}
        {view === 'import' && <ImportView prompt={prompt} onSaved={load} />}
        {view === 'match' && selected && <MatchDetail profile={selected} me={me} events={events} schema={schema} onBack={() => navigate('matches')} />}
      </main>
    </div>
  );
}
