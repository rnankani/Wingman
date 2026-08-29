import { randomBytes } from 'node:crypto';

/**
 * Identity comes from a bearer token in an HTTP header, not from a tool
 * argument. TrueForge connectors support `auth: { type: "header" }`, so each
 * side's harness attaches its own token to every MCP request and the model
 * never sees it.
 *
 * This is the whole privacy boundary. If identity were a tool parameter the
 * model could pass someone else's userId and read their L3 — instructions
 * telling it not to would be the only thing stopping it, and instructions are
 * not a security control.
 */
export const AUTH_HEADER = 'x-wingman-token';

export function mintToken(): string {
  return 'wm_' + randomBytes(24).toString('base64url');
}

export interface Identity {
  userId: string;
  displayName: string;
}
