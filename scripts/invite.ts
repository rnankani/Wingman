/**
 * Opens a public tunnel to this machine's Wingman server, enrols a friend, and
 * prints the one command they run on their own laptop.
 *
 *   npm run invite -- "Alex"
 *
 * Keep this running for the whole demo — closing it closes the tunnel.
 *
 * Why a tunnel: TrueForge connectors are remote-only (manifest.type "remote"),
 * so the friend's harness needs a URL it can actually reach. On a venue network
 * with client isolation, LAN addresses often will not work; a tunnel always does.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const LOCAL = process.env.WINGMAN_LOCAL ?? 'http://localhost:3000';
const name = process.argv.slice(2).join(' ').trim();

if (!name) {
  console.error('Usage: npm run invite -- "Their Name"');
  process.exit(1);
}

let ADMIN_KEY = '';
try {
  ADMIN_KEY = readFileSync(resolve(process.cwd(), 'data/admin-key'), 'utf8').trim();
} catch {
  console.error('\n✗ data/admin-key not found. Start the server once first: npm run dev\n');
  process.exit(1);
}

/** Enrolling mints an identity, so it is owner-only. */
async function enrol(base: string) {
  const res = await fetch(`${base}/api/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wingman-admin': ADMIN_KEY },
    body: JSON.stringify({ displayName: name }),
  });
  if (!res.ok) throw new Error(`enroll failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { userId: string; displayName: string; token: string };
}

function startTunnel(): Promise<{ url: string; kill: () => void }> {
  return new Promise((res, reject) => {
    // --config with an empty file is load-bearing. cloudflared reads
    // ~/.cloudflared/config.yml even when you pass --url, and if that config
    // has ingress rules the quick tunnel falls through to its catch-all
    // (`http_status:404`) — every request 404s from Cloudflare's edge while the
    // tunnel itself reports a healthy connection. Very confusing to debug.
    const emptyCfg = resolve(tmpdir(), 'wingman-cloudflared-empty.yml');
    writeFileSync(emptyCfg, '{}\n');
    const proc = spawn(
      'cloudflared',
      ['tunnel', '--config', emptyCfg, '--protocol', 'http2', '--url', LOCAL],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let settled = false;
    const scan = (buf: Buffer) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !settled) {
        settled = true;
        res({ url: m[0], kill: () => proc.kill() });
      }
    };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);
    proc.on('error', (e) => !settled && (settled = true, reject(e)));
    proc.on('exit', (code) => !settled && (settled = true, reject(new Error(`cloudflared exited ${code}`))));
    setTimeout(() => !settled && (settled = true, reject(new Error('tunnel timed out after 45s'))), 45_000);
  });
}

async function main() {
  try {
    const h = await fetch(`${LOCAL}/health`).then((r) => r.json());
    console.log(`Wingman server: up (${h.profiles} profiles)`);
  } catch {
    console.error(`\n✗ Wingman server is not running at ${LOCAL}.  Start it: npm run dev\n`);
    process.exit(1);
  }

  const preset = process.env.WINGMAN_PUBLIC_URL;
  let url: string;
  if (preset) {
    url = preset.replace(/\/$/, '');
    const probe = await fetch(`${url}/health`).then((r) => r.ok).catch(() => false);
    if (!probe) throw new Error(`WINGMAN_PUBLIC_URL ${url} is not serving this Wingman.`);
    console.log(`Using existing public URL: ${url}`);
  } else {
    console.log('Opening tunnel…');
    url = (await startTunnel()).url;
  }

  // Enrol through the tunnel so a failure here surfaces now rather than on
  // their laptop, where you cannot debug it.
  const who = await enrol(url);

  const bar = '─'.repeat(72);
  console.log(`\n${bar}`);
  console.log(`  Tunnel:  ${url}`);
  console.log(`  Invited: ${who.displayName}  (userId: ${who.userId})`);
  console.log(bar);
  console.log(`\n  Send your friend these two steps.\n`);
  console.log(`  1. Start TrueForge and add a model key at http://localhost:8790`);
  console.log(`\n       npx @truefoundry/trueforge@latest\n`);
  console.log(`  2. Clone this repo, npm install, then run:\n`);
  console.log(`     macOS / Linux:`);
  console.log(`       WINGMAN_URL=${url}/mcp \\`);
  console.log(`       WINGMAN_TOKEN=${who.token} \\`);
  console.log(`       npm run setup\n`);
  // PowerShell does not accept `VAR=value command`; it runs the command with no
  // env set and the connector silently comes up unauthenticated.
  console.log(`     Windows PowerShell:`);
  console.log(`       $env:WINGMAN_URL="${url}/mcp"`);
  console.log(`       $env:WINGMAN_TOKEN="${who.token}"`);
  console.log(`       npm run setup\n`);
  console.log(`  That token IS their identity. TrueForge sends it as a header on every`);
  console.log(`  MCP call; no tool takes a userId, so neither agent can read the other's`);
  console.log(`  profile. Do not paste it into a chat window you would not paste a`);
  console.log(`  password into.\n`);
  console.log(`  Watch both sides at ${LOCAL}\n`);
  console.log(`  Tunnel stays open while this process runs. Ctrl-C ends the demo.\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  if (String(err.message).includes('ENOENT')) {
    console.error(`  cloudflared is not installed:  brew install cloudflared\n`);
  }
  process.exit(1);
});
