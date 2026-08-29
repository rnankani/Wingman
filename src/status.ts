/**
 * Introspects the TrueForge side of the setup so the dashboard can show whether
 * the pipeline is actually wired, rather than making you re-run `npm run setup`
 * to find out. Every check is server-side — the browser never talks to TrueForge
 * directly, so there is no CORS story to get wrong.
 */

const TF = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const CONNECTOR = 'wingman';
const AGENT = 'wingman';

export type CheckState = 'ok' | 'warn' | 'down';

export interface Check {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  /** What the human should do about it. Empty when ok. */
  fix: string;
}

async function tf(path: string, timeoutMs = 2500): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${TF}${path}`, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** How TrueForge's @write / @destructive selectors read an MCP annotation. */
export function classify(annotations: any): '@read-only' | '@write' | '@destructive' | '@unannotated' {
  const a = annotations ?? {};
  if (a.destructiveHint === true) return '@destructive';
  if (a.readOnlyHint === true) return '@read-only';
  if (a.readOnlyHint === false) return '@write';
  // Matches neither default selector, so it would skip approval entirely.
  return '@unannotated';
}

export interface PipelineStatus {
  trueforgeUrl: string;
  checks: Check[];
  tools: { name: string; klass: string; gated: boolean; description: string }[];
  approvalPolicy: string[] | null;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const checks: Check[] = [];

  const caps = await tf('/api/v1/capabilities');
  checks.push({
    key: 'trueforge',
    label: 'TrueForge',
    state: caps ? 'ok' : 'down',
    detail: caps ? `reachable at ${TF}` : `no response from ${TF}`,
    fix: caps ? '' : 'npx @truefoundry/trueforge@latest',
  });

  if (!caps) {
    return { trueforgeUrl: TF, checks, tools: [], approvalPolicy: null };
  }

  const models = await tf('/api/v1/models');
  const modelNames: string[] = (models?.data ?? []).map((m: any) =>
    typeof m === 'string' ? m : (m.name ?? m.id),
  );
  checks.push({
    key: 'model',
    label: 'Model provider',
    state: modelNames.length ? 'ok' : 'down',
    detail: modelNames.length ? `${modelNames.length} model(s): ${modelNames.slice(0, 3).join(', ')}` : 'none configured',
    fix: modelNames.length ? '' : `Open ${TF} → Settings → Models and add an API key`,
  });

  const connector = await tf(`/api/v1/settings/mcp-servers/${CONNECTOR}`);
  checks.push({
    key: 'connector',
    label: 'Connector',
    state: connector ? 'ok' : 'down',
    detail: connector ? `"${CONNECTOR}" → ${connector.data?.manifest?.url ?? '?'}` : 'not registered',
    fix: connector ? '' : 'npm run setup',
  });

  const toolsRes = connector ? await tf(`/api/v1/mcp-servers/${CONNECTOR}/tools`) : null;
  const rawTools: any[] = toolsRes?.data ?? [];

  const agents = await tf('/api/v1/agents');
  const agent = (agents?.data ?? []).find((a: any) => a.name === AGENT);
  const serverCfg = agent?.manifest?.mcp_servers?.find((s: any) => s.name === CONNECTOR);
  // Absent means TrueForge falls back to its default policy.
  const approvalPolicy: string[] | null = serverCfg
    ? (serverCfg.require_approval_for_tools ?? ['@write', '@destructive'])
    : null;

  checks.push({
    key: 'agent',
    label: 'Agent',
    state: agent ? 'ok' : 'down',
    detail: agent ? `"${AGENT}" on ${agent.manifest?.model?.name ?? '?'}` : 'not created',
    fix: agent ? '' : 'npm run setup',
  });

  const gatedBy = (name: string, klass: string) => {
    if (!approvalPolicy) return false;
    if (approvalPolicy.includes('@all')) return true;
    if (approvalPolicy.includes(name)) return true;
    return approvalPolicy.includes(klass);
  };

  const tools = rawTools.map((t) => {
    const klass = classify(t.annotations);
    return {
      name: t.name,
      klass,
      gated: gatedBy(t.name, klass),
      description: String(t.description ?? '').split('.')[0],
    };
  });

  checks.push({
    key: 'tools',
    label: 'Tool surface',
    state: tools.length ? 'ok' : 'down',
    detail: tools.length ? `${tools.length} tools visible to TrueForge` : 'TrueForge sees no tools',
    fix: tools.length ? '' : 'Is the wingman server reachable from TrueForge?',
  });

  // An unannotated tool matches neither @write nor @destructive, so the default
  // policy exempts it from approval. That is the one failure mode that looks
  // like success, so it gets its own check rather than hiding in the table.
  const unannotated = tools.filter((t) => t.klass === '@unannotated');
  if (unannotated.length) {
    checks.push({
      key: 'annotations',
      label: 'Annotations',
      state: 'warn',
      detail: `${unannotated.map((t) => t.name).join(', ')} publish no annotation — approval would be skipped`,
      fix: 'Add readOnlyHint / destructiveHint in src/mcp.ts',
    });
  }

  return { trueforgeUrl: TF, checks, tools, approvalPolicy };
}
