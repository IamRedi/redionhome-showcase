import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

type Candidate = {
  version: 1;
  pid: number;
  origin: string;
  root: string;
  dataDir: string;
  accessFile: string;
  logFile: string;
  activeDb?: { path: string; sha256: string; size: number; mtimeMs: number };
};

const command = process.argv[2] ?? 'start';
const phase = process.env.RDH_CANDIDATE_PHASE === 'RDH-02' ? 'RDH-02' : 'RDH-01';
const settings = phase === 'RDH-02'
  ? { rootEnv: 'RDH02_CANDIDATE_ROOT', activeDbEnv: 'RDH02_ACTIVE_DB', portEnv: 'RDH02_CANDIDATE_PORT', defaultPort: '4188', rootPrefix: '/var/tmp/redionhome-rdh02-', runtimeLabel: 'RDH-01 + RDH-02 SAMSUNG CANDIDATE · ISOLUAR · MOCK ONLY' }
  : { rootEnv: 'RDH01_CANDIDATE_ROOT', activeDbEnv: 'RDH01_ACTIVE_DB', portEnv: 'RDH01_CANDIDATE_PORT', defaultPort: '4185', rootPrefix: '/var/tmp/redionhome-rdh01-', runtimeLabel: 'RDH-01 SAMSUNG CANDIDATE · ISOLUAR · MOCK ONLY' };
const root = path.resolve(process.env[settings.rootEnv] ?? '');
const activeDb = process.env[settings.activeDbEnv] ? path.resolve(process.env[settings.activeDbEnv]!) : undefined;
const port = Number(process.env[settings.portEnv] ?? settings.defaultPort);

function fail(message: string): never { throw new Error(message); }

function assertRoot() {
  if (!root.startsWith(settings.rootPrefix))
    fail(`${settings.rootEnv} must be an explicit ${settings.rootPrefix}* directory`);
}

function fingerprint(file: string) {
  if (!existsSync(file)) fail(`Active database not found: ${file}`);
  const bytes = readFileSync(file);
  const metadata = statSync(file);
  return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), size: metadata.size, mtimeMs: metadata.mtimeMs };
}

function tailnetIp() {
  const status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 15000 })) as { BackendState?: string; Self?: { TailscaleIPs?: string[] } };
  if (status.BackendState !== 'Running') fail('Tailscale is not running');
  const ip = status.Self?.TailscaleIPs?.find(value => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value));
  if (!ip) fail('No Tailscale IPv4 address is available');
  return ip;
}

function readCandidate() {
  const file = path.join(root, 'candidate.json');
  if (!existsSync(file)) fail(`No ${phase} candidate metadata at ${file}`);
  return JSON.parse(readFileSync(file, 'utf8')) as Candidate;
}

async function health(origin: string) {
  const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
  return response.ok;
}

async function start() {
  assertRoot();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('RDH01_CANDIDATE_PORT must be 1024–65535');
  if (existsSync(root)) fail(`Candidate root already exists: ${root}`);
  const ip = tailnetIp();
  const origin = `http://${ip}:${port}`;
  const dataDir = path.join(root, 'data');
  const accessFile = path.join(root, 'SAMSUNG-ACCESS.txt');
  const logFile = path.join(root, 'candidate.log');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const password = randomBytes(24).toString('base64url');
  writeFileSync(accessFile, `${phase} Samsung candidate\n\nOpen: ${origin}\nPassword: ${password}\n\nThis is a disposable candidate with synthetic demo media only. It cannot reach the active home runtime or configured providers.\n`, { mode: 0o600 });
  const baseline = activeDb ? fingerprint(activeDb) : undefined;
  const log = openSync(logFile, 'a', 0o600);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: ip,
      APP_ORIGIN: origin,
      OWNER_PASSWORD: password,
      RUNTIME_LABEL: settings.runtimeLabel,
    },
  });
  child.unref();
  const candidate: Candidate = { version: 1, pid: child.pid!, origin, root, dataDir, accessFile, logFile, activeDb: baseline };
  writeFileSync(path.join(root, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n', { mode: 0o600 });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await health(origin).catch(() => false)) {
      console.log(JSON.stringify({ status: 'READY', origin, accessFile, scope: 'tailscale-ip-only', activeRuntimeChanged: false, publicFunnel: false }));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  process.kill(child.pid!, 'SIGTERM');
  fail(`Candidate did not become healthy; inspect ${logFile}`);
}

async function status() {
  assertRoot();
  const candidate = readCandidate();
  const running = (() => { try { process.kill(candidate.pid, 0); return true; } catch { return false; } })();
  const healthy = running && await health(candidate.origin).catch(() => false);
  const activeUnchanged = candidate.activeDb ? JSON.stringify(fingerprint(candidate.activeDb.path)) === JSON.stringify(candidate.activeDb) : 'NOT_CONFIGURED';
  console.log(JSON.stringify({ status: healthy ? 'READY' : running ? 'UNHEALTHY' : 'STOPPED', origin: candidate.origin, accessFile: candidate.accessFile, activeDbUnchanged: activeUnchanged, publicFunnel: false }));
}

function stop() {
  assertRoot();
  const candidate = readCandidate();
  try { process.kill(candidate.pid, 'SIGTERM'); } catch { /* already stopped */ }
  const activeUnchanged = candidate.activeDb ? JSON.stringify(fingerprint(candidate.activeDb.path)) === JSON.stringify(candidate.activeDb) : 'NOT_CONFIGURED';
  console.log(JSON.stringify({ status: 'STOP_REQUESTED', activeDbUnchanged: activeUnchanged, retainedCandidateRoot: root, deleteRequiresExplicitOwnerApproval: true }));
}

if (command === 'start') await start();
else if (command === 'status') await status();
else if (command === 'stop') stop();
else fail('Usage: rdh01-samsung-candidate.ts start|status|stop');
