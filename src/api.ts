import type { ChiknyPose } from '@/components/chikny';

export type View = 'agentic' | 'stats' | 'matches' | 'import' | 'match';
export type WorkflowStage =
  | 'profile'
  | 'preferences'
  | 'discovery'
  | 'negotiation'
  | 'approval'
  | 'introduction'
  | 'planning'
  | 'matched';

export interface ActivityEvent {
  id: string;
  ts: string;
  state: 'doing' | 'waiting' | 'did';
  stage: WorkflowStage;
  kind: 'status' | 'message';
  direction: 'internal' | 'outbound' | 'inbound';
  pose: ChiknyPose;
  actor: string;
  title: string;
  detail: string;
  counterpart?: string;
  approvalId?: string;
}

export interface Approval {
  id: string;
  ts: string;
  action: 'share_detail' | 'send_intro' | 'book_date';
  candidateId: string;
  candidateName: string;
  sentence: string;
  fields: string[];
  status: 'pending' | 'resolved';
  decision?: 'approve' | 'edit' | 'decline' | 'vaguer';
  sentSentence?: string;
}

export interface ShareableView {
  fields: Record<string, string>;
  redacted: string[];
  withheldAbove: string[];
}

export interface Profile {
  userId: string;
  displayName?: string;
  username?: string | null;
  isOwner?: boolean;
  isPersona: boolean;
  updatedAt: string;
  fields: Record<string, string>;
  known: number;
  total: number;
  views: Record<'L0' | 'L1' | 'L2' | 'L3', ShareableView>;
}

export interface Candidate {
  userId: string;
  displayName: string;
  isPersona: boolean;
  fields: Record<string, string>;
  redacted: string[];
}

export interface Channel {
  id: string;
  parties: [string, string];
  level: Record<string, string>;
  exchanges: number;
  maxExchanges: number;
  waitingOn: string;
  turns: Array<{ from: string; message: string; level: string; at: string }>;
  disclosures: Array<{ from: string; field: string; level: string; via: 'free' | 'approved' }>;
  verdicts: Record<string, { verdict: 'match' | 'pass' | 'needs_human'; reason: string }>;
  intro: { from: string; text: string; at: string } | null;
  date: { venue: string; isoTime: string; proposedBy: string; acceptedBy: string[] } | null;
  closed: boolean;
  createdAt: string;
}

export interface Schema {
  levels: string[];
  levelLabels: Record<string, string>;
  fieldLevels: Record<string, string>;
}

export interface ImportPreview {
  method: 'json' | 'labeled' | 'none';
  fields: Record<string, string>;
  ignoredKeys: string[];
  skippedEmpty: string[];
  saved: boolean;
  savedCount: number;
}

export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (response.status === 401 && data.loginUrl) {
    location.assign(data.loginUrl);
  }
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data as T;
}
