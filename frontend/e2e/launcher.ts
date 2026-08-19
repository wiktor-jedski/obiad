/**
 * Self-cleaning real-stack launcher behind `bun run test:e2e` (task 22;
 * ARCH-008, ARCH-016, ARCH-022; ISSUE-006 lifecycle contract).
 *
 * The launcher owns one complete disposable Obiad stack and tears it down
 * after success, failure, or interruption:
 *
 *   1. preflights the required binaries and the fixed loopback application
 *      ports (127.0.0.1:8080 and 127.0.0.1:4173), failing clearly when either
 *      is occupied;
 *   2. snapshots any pre-existing generated outputs (the TypeScript client,
 *      the Go transport models, and Playwright output) so cleanup restores
 *      prior state instead of deleting output another run created;
 *   3. generates the TypeScript API client (`bun run generate:api`) and
 *      bundles a browser entry that exposes the generated client to
 *      Chromium (`bun build --format iife`);
 *   4. builds the optimized client before preview into an owned temporary
 *      output directory (`bun run build -- --outDir …`);
 *   5. creates a disposable loopback-only PostgreSQL 17 container on a
 *      random loopback port;
 *   6. runs the existing local deployment setup
 *      (scripts/setup_local_database.sh) with ephemeral credentials and a
 *      temporary mode-0600 credential file, seeding the real catalog;
 *   7. materializes the uncommitted Go transport models (`go generate ./...`),
 *      builds, and starts the real Fiber process on the fixed loopback
 *      listener, waiting for the exact `GET /health` ready contract;
 *   8. starts the optimized Vite preview on strict port 4173 over the
 *      owned build output, proxying same-origin `/api` to Fiber;
 *   9. installs the pinned Playwright Chromium when missing and runs the
 *      real-stack Playwright scenario, whose status becomes the exit status;
 *  10. cleans up every owned process group (including in-flight step
 *      children), container, temporary credential file, generated output,
 *      build output, and test artifact through one serialized path, verifies
 *      that nothing owned remains, and exits nonzero when any lifecycle step
 *      failed, an owned process was unhealthy, or cleanup itself failed.
 *
 * Lifecycle ownership rules:
 *
 *   - Every spawned child runs in its own process group (`detached: true`)
 *     and is registered by group id, so cleanup can signal the group even
 *     after its leader has exited and descendants survive.
 *   - Signals (SIGINT, SIGTERM) only request shutdown: they set the
 *     shutdown flag and start the single memoized cleanup promise. The main
 *     flow stops starting work at its next checkpoint and awaits the same
 *     cleanup before exiting, so `process.exit` never runs while lifecycle
 *     work or cleanup is still active. The exit status is 130 on SIGINT and
 *     143 on SIGTERM when cleanup succeeds, and 1 when any cleanup problem
 *     remains.
 *   - The PostgreSQL container ownership is retained until `docker rm
 *     --force` is confirmed (or the container is already gone); removal is
 *     retried and a failed removal forces a nonzero result and a failing
 *     verification by container identity.
 *   - Managed generated outputs (`frontend/src/client/`,
 *     `frontend/test-results/`, `backend/internal/transport/
 *     suggestions.gen.go`) are snapshotted before this run touches them;
 *     cleanup restores pre-existing output and removes only output this
 *     invocation created.
 *
 * Credentials are generated per run, are never printed, and exist only
 * inside the temporary credential file, which cleanup removes together with
 * its directory.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const FRONTEND = resolve(import.meta.dir, '..');
const REPO = resolve(FRONTEND, '..');
const BACKEND = join(REPO, 'backend');
const SETUP_SCRIPT = join(REPO, 'scripts', 'setup_local_database.sh');

/** The fixed loopback Fiber listener (ARCH-016, ISSUE-004). */
const FIBER_ADDR = '127.0.0.1:8080';
const FIBER_PORT = 8080;
/** The strict-port optimized Vite preview origin (ISSUE-006, playwright.config.ts). */
const PREVIEW_PORT = 4173;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
/** The pinned disposable PostgreSQL 17 image (AGENTS.md, ISSUE-006). */
const POSTGRES_IMAGE = 'postgres:17-alpine';

const PROCESS_START_TIMEOUT_MS = 60_000;
const POSTGRES_START_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 3_000;
const STOP_HARD_MS = 1_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;
const CONTAINER_RM_RETRIES = 3;

/** Gitignored generated output owned by this launcher run when this run creates it. */
const GENERATED_CLIENT_DIR = join(FRONTEND, 'src', 'client');
const TEST_RESULTS_DIR = join(FRONTEND, 'test-results');
const GENERATED_TRANSPORT_FILE = join(BACKEND, 'internal', 'transport', 'suggestions.gen.go');

interface ProcessGroup {
  label: string;
  leader: ChildProcess;
}

interface ManagedOutput {
  path: string;
  label: string;
  preExisted: boolean;
  snapshotPath: string | null;
}

interface OwnedResources {
  containerName: string | null;
  tempDir: string | null;
  /** Whether this run ever started the Fiber or preview process (port ownership). */
  fiberStarted: boolean;
  previewStarted: boolean;
  /** Every spawned child, keyed by its process-group id (the leader pid). */
  groups: Map<number, ProcessGroup>;
  /** Snapshot ownership of managed generated outputs. */
  outputs: ManagedOutput[];
}

/** One serialized shutdown: the first signal wins and cleanup runs exactly once. */
const shutdown: { signal: NodeJS.Signals | null; cleanupInFlight: Promise<string[]> | null } = {
  signal: null,
  cleanupInFlight: null,
};

function log(message: string): void {
  console.log(`[e2e] ${message}`);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve: wake } = Promise.withResolvers<void>();
  setTimeout(wake, ms);
  return promise;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

/** Throws when a shutdown has been requested; runStack checks between phases. */
function assertRunning(): void {
  if (shutdown.signal) {
    throw new Error(`interrupted by ${shutdown.signal}`);
  }
}

/** Whether any process in the group `pgid` still exists (Linux kill(0) probe). */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether the leader of a registered process group is still running. */
function processAlive(resources: OwnedResources, child: ChildProcess): boolean {
  const group = child.pid !== undefined ? resources.groups.get(child.pid) : undefined;
  return group !== undefined && child.exitCode === null && child.signalCode === null;
}

function tcpPortInUse(port: number): Promise<boolean> {
  const { promise, resolve: settle } = Promise.withResolvers<boolean>();
  const socket = net.connect({ host: '127.0.0.1', port });
  let settled = false;
  const finish = (inUse: boolean) => {
    if (settled) {
      return;
    }
    settled = true;
    socket.destroy();
    settle(inUse);
  };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(1_000, () => finish(false));
  return promise;
}

/**
 * Spawns a detached child in its own process group and registers the group
 * for cleanup. Every lifecycle child — step commands, Fiber, and the Vite
 * preview — is registered here, so cleanup owns every spawned process group.
 */
function spawnOwned(
  resources: OwnedResources,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO,
    env: options.env ?? process.env,
    stdio: 'inherit',
    detached: true,
  });
  if (child.pid !== undefined) {
    resources.groups.set(child.pid, { label: `${command} ${args.join(' ')}`, leader: child });
  }
  return child;
}

/** Runs one lifecycle step to completion and returns its exit status. */
async function runStep(
  resources: OwnedResources,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  assertRunning();
  const child = spawnOwned(resources, command, args, options);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
  return promise;
}

/**
 * Terminates a process group regardless of its leader's state and verifies
 * that the group disappears, escalating to SIGKILL after a short grace
 * period. The group id is retained until the group is confirmed gone, so
 * descendants that outlive their leader are still stopped.
 */
async function stopProcessGroup(resources: OwnedResources, pgid: number): Promise<boolean> {
  const group = resources.groups.get(pgid);
  if (!group) {
    return true;
  }
  const label = group.label;
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    // ESRCH: the group is already gone; nothing to stop.
  }
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && groupAlive(pgid)) {
    await sleep(50);
  }
  if (groupAlive(pgid)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // group vanished between the check and the kill
    }
    const hardDeadline = Date.now() + STOP_HARD_MS;
    while (Date.now() < hardDeadline && groupAlive(pgid)) {
      await sleep(50);
    }
  }
  resources.groups.delete(pgid);
  if (groupAlive(pgid)) {
    log(`error: process group ${pgid} (${label}) could not be terminated`);
    return false;
  }
  log(`stopped process group ${pgid} (${label})`);
  return true;
}

function preflight(): void {
  for (const [command, args, label] of [
    ['docker', ['--version'], 'docker'],
    ['go', ['version'], 'go'],
    ['bun', ['--version'], 'bun'],
    ['bash', ['--version'], 'bash'],
  ] as const) {
    const result = spawnSync(command, args, { stdio: 'ignore' });
    if (result.error) {
      throw new Error(`required binary ${label} is not available: ${result.error.message}`);
    }
  }
}

async function preflightPorts(): Promise<void> {
  for (const port of [FIBER_PORT, PREVIEW_PORT]) {
    if (await tcpPortInUse(port)) {
      throw new Error(
        `application port ${port} is occupied; stop the process listening on 127.0.0.1:${port} and retry (ISSUE-006)`,
      );
    }
  }
}

async function waitForPostgresReady(containerName: string): Promise<void> {
  const deadline = Date.now() + POSTGRES_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = spawnSync(
      'docker',
      ['exec', containerName, 'pg_isready', '--host=127.0.0.1', '--username=postgres', '--dbname=postgres'],
      { stdio: 'ignore' },
    );
    if (probe.status === 0) {
      return;
    }
    const running = spawnSync('docker', ['inspect', '--format={{.State.Running}}', containerName], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (running.status !== 0 || running.stdout.toString().trim() !== 'true') {
      break;
    }
    await sleep(250);
  }
  spawnSync('docker', ['logs', containerName], { stdio: 'inherit' });
  throw new Error(
    `PostgreSQL container ${containerName} did not become ready within ${POSTGRES_START_TIMEOUT_MS} ms`,
  );
}

function dockerPublishedPort(containerName: string): number {
  const result = spawnSync('docker', ['port', containerName, '5432/tcp'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`failed to read the PostgreSQL port mapping for ${containerName}`);
  }
  const lines = result.stdout.toString().trim().split('\n').filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(`expected one PostgreSQL port mapping, got ${result.stdout.toString().trim()}`);
  }
  const match = /^127\.0\.0\.1:(\d+)$/.exec(lines[0].trim());
  if (!match) {
    throw new Error(`unexpected PostgreSQL port mapping: ${lines[0]}`);
  }
  return Number(match[1]);
}

/**
 * Unquotes one bash `%q`-escaped shell word (single-quoted, double-quoted,
 * or bare with backslash escapes). The setup script writes the connection
 * URLs with `printf %q`, which may emit any of those forms depending on the
 * characters present (for example `\?` for a bare value containing `?`).
 * The file is owned by this launcher run (mode 0600, hex-only passwords), so
 * executing its quoting is safe and deterministic.
 */
function unquoteShellWord(word: string): string {
  if (word.startsWith("'")) {
    const end = word.indexOf("'", 1);
    if (end === -1) {
      throw new Error(`malformed single-quoted credential value: ${word}`);
    }
    return word.slice(1, end);
  }
  if (word.startsWith('"')) {
    let out = '';
    for (let i = 1; i < word.length; i++) {
      const char = word[i];
      if (char === '"' && (i === word.length - 1 || word[i + 1] === '\n')) {
        break;
      }
      if (char === '\\' && i + 1 < word.length) {
        const next = word[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          out += next === '\n' ? '' : next;
          i++;
          continue;
        }
      }
      out += char;
    }
    return out;
  }
  let out = '';
  for (let i = 0; i < word.length; i++) {
    if (word[i] === '\\' && i + 1 < word.length) {
      out += word[i + 1];
      i++;
      continue;
    }
    out += word[i];
  }
  return out;
}

/**
 * Reads one shell-escaped value from the credential file. The setup script
 * writes `KEY=<printf %q value>` lines with mode 0600.
 */
function readCredentialLine(content: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of content.split('\n')) {
    if (!line.startsWith(prefix)) {
      continue;
    }
    const value = unquoteShellWord(line.slice(prefix.length));
    if (value.length === 0) {
      throw new Error(`credential file has an empty ${key}`);
    }
    return value;
  }
  throw new Error(`credential file does not contain ${key}`);
}

/**
 * Polls an HTTP URL with a bounded per-request timeout until the predicate
 * accepts the status, body, and content type, or the owned process exits,
 * or the overall deadline expires.
 */
async function waitForService(
  url: string,
  accept: (status: number, body: string, contentType: string) => boolean,
  alive: () => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + PROCESS_START_TIMEOUT_MS;
  let lastProbe = 'no response';
  while (Date.now() < deadline) {
    if (!alive()) {
      throw new Error(`${label}: owned process exited before becoming ready (last probe: ${lastProbe})`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
      const body = await response.text();
      lastProbe = `${response.status} ${response.headers.get('content-type') ?? ''}`;
      if (accept(response.status, body, response.headers.get('content-type') ?? '')) {
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`${label}: did not become ready within ${PROCESS_START_TIMEOUT_MS} ms (last probe: ${lastProbe})`);
}

/**
 * The exact ARCH-009 ready contract: HTTP 200 with an `application/json`
 * body that is exactly the single-field object `{"status":"ready"}`. A
 * false or malformed ready body never passes.
 */
function fiberReady(status: number, body: string, contentType: string): boolean {
  if (status !== 200 || !contentType.toLowerCase().includes('application/json')) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as Record<string, unknown>).length === 1 &&
      (parsed as Record<string, unknown>).status === 'ready'
    );
  } catch {
    return false;
  }
}

/**
 * Removes the owned PostgreSQL container, retrying on failure. Returns true
 * when the container is confirmed gone (removed or already absent).
 */
async function removeContainer(name: string): Promise<boolean> {
  for (let attempt = 1; attempt <= CONTAINER_RM_RETRIES; attempt++) {
    const result = spawnSync('docker', ['rm', '--force', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status === 0) {
      log(`removed PostgreSQL container ${name}`);
      return true;
    }
    const stderr = (result.stderr?.toString() ?? '').trim();
    if (/no such container/i.test(stderr)) {
      log(`PostgreSQL container ${name} is already gone`);
      return true;
    }
    log(`docker rm --force ${name} failed (attempt ${attempt}/${CONTAINER_RM_RETRIES}): ${stderr || `status ${result.status}`}`);
    await sleep(1_000);
  }
  return false;
}

/**
 * Snapshots any pre-existing managed generated outputs into the owned
 * temporary directory so cleanup can restore them instead of deleting
 * output another run created.
 */
function snapshotOutputs(resources: OwnedResources): void {
  if (!resources.tempDir) {
    return;
  }
  const snapshotsDir = join(resources.tempDir, 'snapshots');
  const managed = [
    { path: GENERATED_CLIENT_DIR, label: 'generated TypeScript client' },
    { path: TEST_RESULTS_DIR, label: 'Playwright output' },
    { path: GENERATED_TRANSPORT_FILE, label: 'generated Go transport models' },
  ];
  for (const output of managed) {
    const preExisted = existsSync(output.path);
    let snapshotPath: string | null = null;
    if (preExisted) {
      snapshotPath = join(snapshotsDir, output.label.replace(/[^a-z0-9]+/gi, '-'));
      cpSync(output.path, snapshotPath, { recursive: true, force: true });
      log(`preserving pre-existing ${output.label} at ${output.path} (snapshot ${snapshotPath})`);
    }
    resources.outputs.push({ ...output, preExisted, snapshotPath });
  }
}

/**
 * The single cleanup path: stops every owned process group (including
 * in-flight step children), removes the owned container (retrying and
 * keeping ownership until removal is confirmed), restores or removes the
 * managed generated outputs, and removes the owned temporary directory.
 * It never throws; every problem is returned for the caller to force a
 * nonzero exit.
 */
async function cleanup(resources: OwnedResources): Promise<string[]> {
  const problems: string[] = [];

  for (const pgid of [...resources.groups.keys()]) {
    if (!(await stopProcessGroup(resources, pgid))) {
      problems.push(`process group ${pgid} could not be terminated`);
    }
  }

  if (resources.containerName) {
    const name = resources.containerName;
    if (await removeContainer(name)) {
      resources.containerName = null;
    } else {
      problems.push(`container ${name} could not be removed and is still owned`);
    }
  }

  for (const output of resources.outputs) {
    try {
      if (output.preExisted && output.snapshotPath) {
        rmSync(output.path, { recursive: true, force: true });
        cpSync(output.snapshotPath, output.path, { recursive: true, force: true });
        log(`restored pre-existing ${output.label} at ${output.path}`);
      } else if (existsSync(output.path)) {
        rmSync(output.path, { recursive: true, force: true });
        log(`removed invocation-created ${output.label} at ${output.path}`);
      }
    } catch (error) {
      problems.push(`failed to ${output.preExisted ? 'restore' : 'remove'} ${output.label} output at ${output.path}: ${String(error)}`);
    }
  }

  if (resources.tempDir) {
    const dir = resources.tempDir;
    try {
      rmSync(dir, { recursive: true, force: true });
      log(`removed temporary directory ${dir} (build output, browser bundle, server binary, credential file)`);
    } catch (error) {
      problems.push(`failed to remove temporary directory ${dir}: ${String(error)}`);
      return problems;
    }
    resources.tempDir = null;
  }

  return problems;
}

/** Starts the single cleanup promise; the first caller wins. */
function ensureCleanup(resources: OwnedResources): Promise<string[]> {
  if (!shutdown.cleanupInFlight) {
    shutdown.cleanupInFlight = cleanup(resources);
  }
  return shutdown.cleanupInFlight;
}

/** Requests shutdown: sets the flag and starts the one cleanup path. */
function requestShutdown(resources: OwnedResources, signal: NodeJS.Signals): void {
  if (shutdown.signal) {
    return;
  }
  shutdown.signal = signal;
  log(`received ${signal}: cleaning up owned resources before exiting`);
  void ensureCleanup(resources);
}

async function verifyClean(resources: OwnedResources): Promise<boolean> {
  const problems: string[] = [];
  for (const [pgid, group] of resources.groups) {
    if (groupAlive(pgid)) {
      problems.push(`process group ${pgid} (${group.label}) is still alive after cleanup`);
    }
  }
  if (resources.containerName) {
    const inspect = spawnSync('docker', ['inspect', '--format={{.State.Running}}', resources.containerName], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (inspect.status === 0) {
      problems.push(`container ${resources.containerName} is still present after cleanup`);
    }
  }
  for (const output of resources.outputs) {
    const present = existsSync(output.path);
    if (output.preExisted && !present) {
      problems.push(`${output.label} output was pre-existing but is missing after cleanup`);
    }
    if (!output.preExisted && present) {
      problems.push(`${output.label} output still exists after cleanup`);
    }
  }
  if (resources.tempDir && existsSync(resources.tempDir)) {
    problems.push(`temporary directory ${resources.tempDir} still exists`);
  }
  const ownedPorts: number[] = [];
  if (resources.fiberStarted) {
    ownedPorts.push(FIBER_PORT);
  }
  if (resources.previewStarted) {
    ownedPorts.push(PREVIEW_PORT);
  }
  for (const port of ownedPorts) {
    if (await tcpPortInUse(port)) {
      problems.push(`application port ${port} is still occupied after cleanup`);
    }
  }
  if (problems.length === 0) {
    log('cleanup verified: no owned process group, container, credential file, or generated output remains');
    return true;
  }
  for (const problem of problems) {
    log(`cleanup verification failed: ${problem}`);
  }
  return false;
}

async function runStack(resources: OwnedResources): Promise<number> {
  assertRunning();
  preflight();
  await preflightPorts();
  assertRunning();
  log('preflight passed: required binaries present and fixed loopback application ports are free');

  const tempDir = mkdtempSync(join(tmpdir(), 'obiad-e2e-'));
  resources.tempDir = tempDir;
  log(`owned temporary directory: ${tempDir}`);

  // 2. Snapshot pre-existing generated outputs before this run touches them.
  snapshotOutputs(resources);

  // 3. Generate the TypeScript API client (gitignored owned output) and
  // bundle the browser entry that exposes it to Chromium for the smoke
  // scenario (ARCH-022: the generated client executes in the browser).
  log('generating the TypeScript API client');
  let status = await runStep(resources, 'bun', ['run', 'generate:api'], { cwd: FRONTEND });
  assertRunning();
  if (status !== 0) {
    throw new Error(`bun run generate:api failed with status ${status}`);
  }
  log('generated client written to src/client');
  const browserClientBundle = join(tempDir, 'browser-client.js');
  log(`bundling the generated client for the browser into ${browserClientBundle}`);
  status = await runStep(
    resources,
    'bun',
    ['build', 'e2e/browser-client-entry.ts', '--target', 'browser', '--format', 'iife', '--outfile', browserClientBundle],
    { cwd: FRONTEND },
  );
  assertRunning();
  if (status !== 0) {
    throw new Error(`bundling the browser client entry failed with status ${status}`);
  }

  // 4. Build the optimized client before preview (ARCH-016: acceptance uses
  // the optimized Vite build through Vite preview).
  const buildOutDir = join(tempDir, 'dist');
  log(`building the optimized client into ${buildOutDir}`);
  status = await runStep(resources, 'bun', ['run', 'build', '--', '--outDir', buildOutDir], { cwd: FRONTEND });
  assertRunning();
  if (status !== 0) {
    throw new Error(`bun run build failed with status ${status}`);
  }
  log('optimized build emitted');

  // 5. Disposable loopback-only PostgreSQL 17 container on a random port.
  const containerName = `obiad-e2e-postgres-${process.pid}-${randomHex(4)}`;
  resources.containerName = containerName;
  const postgresPassword = randomHex(24);
  const dockerRun = spawnSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--env',
      'POSTGRES_PASSWORD',
      '--publish',
      '127.0.0.1::5432',
      POSTGRES_IMAGE,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: postgresPassword }, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (dockerRun.status !== 0) {
    throw new Error(`failed to start the PostgreSQL container (docker status ${dockerRun.status})`);
  }
  assertRunning();
  log(`started PostgreSQL container ${containerName}`);
  await waitForPostgresReady(containerName);
  const postgresPort = dockerPublishedPort(containerName);
  log(`PostgreSQL 17 is ready on loopback port ${postgresPort}`);

  // 6. Reuse the existing local deployment setup with ephemeral credentials
  // and a temporary credential file (ISSUE-001, ARCH-016).
  const adminDatabaseUrl = `postgres://postgres:${postgresPassword}@127.0.0.1:${postgresPort}/postgres?sslmode=disable`;
  const ownerPassword = randomHex(24);
  const runtimePassword = randomHex(24);
  const credentialFile = join(tempDir, 'database-urls');
  log('running scripts/setup_local_database.sh with ephemeral credentials');
  status = await runStep(resources, 'bash', [SETUP_SCRIPT], {
    cwd: REPO,
    env: {
      ...process.env,
      OBIAD_ADMIN_DATABASE_URL: adminDatabaseUrl,
      OBIAD_OWNER_PASSWORD: ownerPassword,
      OBIAD_RUNTIME_PASSWORD: runtimePassword,
      OBIAD_CREDENTIAL_FILE: credentialFile,
    },
  });
  assertRunning();
  if (status !== 0) {
    throw new Error(`scripts/setup_local_database.sh failed with status ${status}`);
  }
  const credentialContent = readFileSync(credentialFile, 'utf8');
  const runtimeDatabaseUrl = readCredentialLine(credentialContent, 'OBIAD_RUNTIME_DATABASE_URL');
  log('local database setup complete; seeded catalog and runtime credential ready');

  // 7. Materialize the uncommitted Go transport models, then build and start
  // the real Fiber process on the fixed loopback listener (AGENTS.md:
  // `go generate ./...` from backend/ before diagnostics or builds).
  const serverBinary = join(tempDir, 'obiad-server');
  log('generating the Go transport models');
  status = await runStep(resources, 'go', ['generate', './...'], { cwd: BACKEND });
  assertRunning();
  if (status !== 0) {
    throw new Error(`go generate ./... failed with status ${status}`);
  }
  log(`building the Fiber server into ${serverBinary}`);
  status = await runStep(resources, 'go', ['build', '-o', serverBinary, './cmd/server'], { cwd: BACKEND });
  assertRunning();
  if (status !== 0) {
    throw new Error(`go build of the Fiber server failed with status ${status}`);
  }
  const fiber = spawnOwned(resources, serverBinary, [], {
    cwd: BACKEND,
    env: { ...process.env, OBIAD_RUNTIME_DATABASE_URL: runtimeDatabaseUrl },
  });
  resources.fiberStarted = true;
  log(`started real Fiber process (pid ${fiber.pid}) on ${FIBER_ADDR}`);
  await waitForService(
    `http://${FIBER_ADDR}/health`,
    fiberReady,
    () => processAlive(resources, fiber),
    'Fiber GET /health',
  );
  log('Fiber is healthy: GET /health returns 200 with exactly {"status":"ready"}');

  // 8. Optimized Vite preview on the strict port over the owned build output.
  const preview = spawnOwned(
    resources,
    'bunx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort', '--outDir', buildOutDir],
    { cwd: FRONTEND },
  );
  resources.previewStarted = true;
  log(`started optimized Vite preview (pid ${preview.pid}) on ${PREVIEW_ORIGIN}`);
  await waitForService(
    `${PREVIEW_ORIGIN}/`,
    (httpStatus) => httpStatus === 200,
    () => processAlive(resources, preview),
    'Vite preview origin',
  );
  assertRunning();
  log('Vite preview is serving the optimized build');

  // 9. Ensure the pinned Playwright Chromium is installed (no-op when present).
  log('ensuring the pinned Playwright Chromium is installed');
  status = await runStep(resources, 'bunx', ['playwright', 'install', 'chromium'], { cwd: FRONTEND });
  assertRunning();
  if (status !== 0) {
    throw new Error(`playwright install chromium failed with status ${status}`);
  }

  // 10. Run the real-stack Playwright scenario; its status becomes the exit
  // status. The browser client bundle path reaches the scenario through the
  // environment; the scenario runs the generated client inside Chromium.
  log('running the real-stack Playwright scenario');
  return runStep(resources, 'bunx', ['playwright', 'test'], {
    cwd: FRONTEND,
    env: { ...process.env, OBIAD_E2E_BROWSER_CLIENT_BUNDLE: browserClientBundle },
  });
}

async function main(): Promise<number> {
  const resources: OwnedResources = {
    containerName: null,
    tempDir: null,
    fiberStarted: false,
    previewStarted: false,
    groups: new Map(),
    outputs: [],
  };
  process.on('SIGINT', () => requestShutdown(resources, 'SIGINT'));
  process.on('SIGTERM', () => requestShutdown(resources, 'SIGTERM'));

  let exitCode = 1;
  try {
    exitCode = await runStack(resources);
  } catch (error) {
    if (!shutdown.signal) {
      log(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    exitCode = 1;
  } finally {
    const problems = await ensureCleanup(resources);
    if (problems.length > 0) {
      for (const problem of problems) {
        log(`cleanup problem: ${problem}`);
      }
      exitCode = 1;
    } else if (shutdown.signal) {
      exitCode = signalExitCode(shutdown.signal);
    }
  }
  if (!(await verifyClean(resources))) {
    exitCode = 1;
  }
  log(`exiting with status ${exitCode}`);
  return exitCode;
}

const exitCode = await main();
process.exit(exitCode);
