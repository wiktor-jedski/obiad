/**
 * Self-cleaning real-stack launcher behind `bun run test:e2e` (task 22;
 * ARCH-008, ARCH-016, ARCH-022; ISSUE-006 lifecycle contract).
 *
 * The launcher owns one complete disposable Obiad stack and tears it down
 * after success, failure, or interruption:
 *
 *   1. preflights the fixed loopback application ports (127.0.0.1:8080 and
 *      127.0.0.1:4173) and fails clearly when either is occupied;
 *   2. generates the TypeScript API client (`bun run generate:api`);
 *   3. builds the optimized client before preview into an owned temporary
 *      output directory (`bun run build -- --outDir …`);
 *   4. creates a disposable loopback-only PostgreSQL 17 container on a
 *      random loopback port;
 *   5. runs the existing local deployment setup
 *      (scripts/setup_local_database.sh) with ephemeral credentials and a
 *      temporary mode-0600 credential file, seeding the real catalog;
 *   6. materializes the uncommitted Go transport models (`go generate ./...`),
 *      builds, and starts the real Fiber process on the fixed loopback
 *      listener, waiting for `GET /health` to report ready;
 *   7. starts the optimized Vite preview on strict port 4173 over the
 *      owned build output, proxying same-origin `/api` to Fiber;
 *   8. installs the pinned Playwright Chromium when missing and runs the
 *      real-stack Playwright scenario;
 *   9. cleans up every owned process, container, temporary credential file,
 *      generated client output, generated Go transport models, build output,
 *      and test artifact, verifies that nothing owned remains, and exits
 *      nonzero when any lifecycle step failed or an owned process was
 *      unhealthy.
 *
 * The exit status is the Playwright status on success, 1 on any lifecycle
 * failure, 130 on SIGINT, and 143 on SIGTERM. Credentials are generated per
 * run, are never printed, and exist only inside the temporary credential
 * file, which cleanup removes together with its directory. The generated
 * client (`frontend/src/client/`) and the Playwright output directory
 * (`frontend/test-results/`) are gitignored generated output owned by this
 * launcher run and are removed during cleanup.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

/** Gitignored generated output directories owned by this launcher run. */
const GENERATED_CLIENT_DIR = join(FRONTEND, 'src', 'client');
const TEST_RESULTS_DIR = join(FRONTEND, 'test-results');
/** Gitignored generated Go transport models materialized by `go generate` (ISSUE-004). */
const GENERATED_TRANSPORT_FILE = join(BACKEND, 'internal', 'transport', 'suggestions.gen.go');

interface OwnedResources {
  containerName: string | null;
  fiber: ChildProcess | null;
  preview: ChildProcess | null;
  tempDir: string | null;
  /** Whether this run ever started the Fiber or preview process (port ownership). */
  fiberStarted: boolean;
  previewStarted: boolean;
}

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

/** Whether a spawned child has exited (by status or signal). */
function finished(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function onceExit(child: ChildProcess): Promise<void> {
  const { promise, resolve: markExited } = Promise.withResolvers<void>();
  child.once('exit', () => markExited());
  return promise;
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

/** Spawns a detached child in its own process group so cleanup can kill the whole tree. */
function spawnOwned(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcess {
  return spawn(command, args, {
    cwd: options.cwd ?? REPO,
    env: options.env ?? process.env,
    stdio: 'inherit',
    detached: true,
  });
}

/** Runs one lifecycle step to completion and returns its exit status. */
async function runStep(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const child = spawnOwned(command, args, options);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
  return promise;
}

/** Terminates a spawned process group, escalating to SIGKILL after a short grace period. */
async function stopProcessGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || finished(child)) {
    return;
  }
  const exited = onceExit(child);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)])) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // process group already gone
  }
  await Promise.race([onceExit(child), sleep(1_000)]);
}

function preflight(): void {
  for (const [command, args, label] of [
    ['docker', ['--version'], 'docker'],
    ['go', ['version'], 'go'],
    ['bun', ['--version'], 'bun'],
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

async function waitForService(
  url: string,
  accept: (status: number, body: string) => boolean,
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
      const response = await fetch(url);
      const body = await response.text();
      lastProbe = `${response.status}`;
      if (accept(response.status, body)) {
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`${label}: did not become ready within ${PROCESS_START_TIMEOUT_MS} ms (last probe: ${lastProbe})`);
}

async function cleanup(resources: OwnedResources): Promise<void> {
  if (resources.preview) {
    log(`stopping Vite preview (pid ${resources.preview.pid})`);
    await stopProcessGroup(resources.preview);
    resources.preview = null;
  }
  if (resources.fiber) {
    log(`stopping Fiber process (pid ${resources.fiber.pid})`);
    await stopProcessGroup(resources.fiber);
    resources.fiber = null;
  }
  if (resources.containerName) {
    const name = resources.containerName;
    resources.containerName = null;
    const result = spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
    log(result.status === 0 ? `removed PostgreSQL container ${name}` : `PostgreSQL container ${name} already removed`);
  }
  if (resources.tempDir) {
    const dir = resources.tempDir;
    resources.tempDir = null;
    rmSync(dir, { recursive: true, force: true });
    log(`removed temporary directory ${dir} (build output, server binary, credential file)`);
  }
  if (existsSync(GENERATED_CLIENT_DIR)) {
    rmSync(GENERATED_CLIENT_DIR, { recursive: true, force: true });
    log(`removed generated client output ${GENERATED_CLIENT_DIR}`);
  }
  if (existsSync(TEST_RESULTS_DIR)) {
    rmSync(TEST_RESULTS_DIR, { recursive: true, force: true });
    log(`removed Playwright output ${TEST_RESULTS_DIR}`);
  }
  if (existsSync(GENERATED_TRANSPORT_FILE)) {
    rmSync(GENERATED_TRANSPORT_FILE, { force: true });
    log(`removed generated Go transport models ${GENERATED_TRANSPORT_FILE}`);
  }
}

async function verifyClean(resources: OwnedResources): Promise<boolean> {
  const problems: string[] = [];
  if (resources.containerName) {
    const inspect = spawnSync('docker', ['inspect', '--format={{.State.Running}}', resources.containerName], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (inspect.status === 0 && inspect.stdout.toString().trim() === 'true') {
      problems.push(`container ${resources.containerName} is still running`);
    }
  }
  if (resources.tempDir && existsSync(resources.tempDir)) {
    problems.push(`temporary directory ${resources.tempDir} still exists`);
  }
  if (existsSync(GENERATED_CLIENT_DIR)) {
    problems.push(`generated client output ${GENERATED_CLIENT_DIR} still exists`);
  }
  if (existsSync(TEST_RESULTS_DIR)) {
    problems.push(`Playwright output ${TEST_RESULTS_DIR} still exists`);
  }
  if (existsSync(GENERATED_TRANSPORT_FILE)) {
    problems.push(`generated Go transport models ${GENERATED_TRANSPORT_FILE} still exist`);
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
    log('cleanup verified: no owned process, container, credential file, or generated output remains');
    return true;
  }
  for (const problem of problems) {
    log(`cleanup verification failed: ${problem}`);
  }
  return false;
}

async function runStack(resources: OwnedResources): Promise<number> {
  preflight();
  await preflightPorts();
  log('preflight passed: required binaries present and fixed loopback application ports are free');

  const tempDir = mkdtempSync(join(tmpdir(), 'obiad-e2e-'));
  resources.tempDir = tempDir;
  log(`owned temporary directory: ${tempDir}`);

  // 1. Generate the TypeScript API client (gitignored owned output).
  log('generating the TypeScript API client');
  let status = await runStep('bun', ['run', 'generate:api'], { cwd: FRONTEND });
  if (status !== 0) {
    throw new Error(`bun run generate:api failed with status ${status}`);
  }
  log('generated client written to src/client');

  // 2. Build the optimized client before preview (ARCH-016: acceptance uses
  // the optimized Vite build through Vite preview).
  const buildOutDir = join(tempDir, 'dist');
  log(`building the optimized client into ${buildOutDir}`);
  status = await runStep('bun', ['run', 'build', '--', '--outDir', buildOutDir], { cwd: FRONTEND });
  if (status !== 0) {
    throw new Error(`bun run build failed with status ${status}`);
  }
  log('optimized build emitted');

  // 3. Disposable loopback-only PostgreSQL 17 container on a random port.
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
  log(`started PostgreSQL container ${containerName}`);
  await waitForPostgresReady(containerName);
  const postgresPort = dockerPublishedPort(containerName);
  log(`PostgreSQL 17 is ready on loopback port ${postgresPort}`);

  // 4. Reuse the existing local deployment setup with ephemeral credentials
  // and a temporary credential file (ISSUE-001, ARCH-016).
  const adminDatabaseUrl = `postgres://postgres:${postgresPassword}@127.0.0.1:${postgresPort}/postgres?sslmode=disable`;
  const ownerPassword = randomHex(24);
  const runtimePassword = randomHex(24);
  const credentialFile = join(tempDir, 'database-urls');
  log('running scripts/setup_local_database.sh with ephemeral credentials');
  status = await runStep('bash', [SETUP_SCRIPT], {
    cwd: REPO,
    env: {
      ...process.env,
      OBIAD_ADMIN_DATABASE_URL: adminDatabaseUrl,
      OBIAD_OWNER_PASSWORD: ownerPassword,
      OBIAD_RUNTIME_PASSWORD: runtimePassword,
      OBIAD_CREDENTIAL_FILE: credentialFile,
    },
  });
  if (status !== 0) {
    throw new Error(`scripts/setup_local_database.sh failed with status ${status}`);
  }
  const credentialContent = readFileSync(credentialFile, 'utf8');
  const runtimeDatabaseUrl = readCredentialLine(credentialContent, 'OBIAD_RUNTIME_DATABASE_URL');
  log('local database setup complete; seeded catalog and runtime credential ready');

  // 5. Materialize the uncommitted Go transport models, then build and start
  // the real Fiber process on the fixed loopback listener (AGENTS.md:
  // `go generate ./...` from backend/ before diagnostics or builds).
  const serverBinary = join(tempDir, 'obiad-server');
  log('generating the Go transport models');
  status = await runStep('go', ['generate', './...'], { cwd: BACKEND });
  if (status !== 0) {
    throw new Error(`go generate ./... failed with status ${status}`);
  }
  log(`building the Fiber server into ${serverBinary}`);
  status = await runStep('go', ['build', '-o', serverBinary, './cmd/server'], { cwd: BACKEND });
  if (status !== 0) {
    throw new Error(`go build of the Fiber server failed with status ${status}`);
  }
  const fiber = spawnOwned(serverBinary, [], {
    cwd: BACKEND,
    env: { ...process.env, OBIAD_RUNTIME_DATABASE_URL: runtimeDatabaseUrl },
  });
  resources.fiber = fiber;
  resources.fiberStarted = true;
  log(`started real Fiber process (pid ${fiber.pid}) on ${FIBER_ADDR}`);
  await waitForService(
    `http://${FIBER_ADDR}/health`,
    (httpStatus, body) => httpStatus === 200 && body.includes('"ready"'),
    () => !finished(fiber),
    'Fiber GET /health',
  );
  log('Fiber is healthy: GET /health returns 200 {"status":"ready"}');

  // 6. Optimized Vite preview on the strict port over the owned build output.
  const preview = spawnOwned(
    'bunx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PREVIEW_PORT), '--strictPort', '--outDir', buildOutDir],
    { cwd: FRONTEND },
  );
  resources.preview = preview;
  resources.previewStarted = true;
  log(`started optimized Vite preview (pid ${preview.pid}) on ${PREVIEW_ORIGIN}`);
  await waitForService(
    `${PREVIEW_ORIGIN}/`,
    (httpStatus) => httpStatus === 200,
    () => !finished(preview),
    'Vite preview origin',
  );
  log('Vite preview is serving the optimized build');

  // 7. Ensure the pinned Playwright Chromium is installed (no-op when present).
  log('ensuring the pinned Playwright Chromium is installed');
  status = await runStep('bunx', ['playwright', 'install', 'chromium'], { cwd: FRONTEND });
  if (status !== 0) {
    throw new Error(`playwright install chromium failed with status ${status}`);
  }

  // 8. Run the real-stack Playwright scenario; its status becomes the exit status.
  log('running the real-stack Playwright scenario');
  return runStep('bunx', ['playwright', 'test'], { cwd: FRONTEND });
}

async function main(): Promise<number> {
  const resources: OwnedResources = {
    containerName: null,
    fiber: null,
    preview: null,
    tempDir: null,
    fiberStarted: false,
    previewStarted: false,
  };
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals, code: number) => {
    if (interrupted) {
      return;
    }
    interrupted = true;
    log(`received ${signal}: cleaning up owned resources before exiting`);
    void cleanup(resources).then(() => {
      log(`exiting with status ${code} (interrupted)`);
      process.exit(code);
    });
  };
  process.on('SIGINT', () => onSignal('SIGINT', 130));
  process.on('SIGTERM', () => onSignal('SIGTERM', 143));

  let exitCode = 1;
  try {
    exitCode = await runStack(resources);
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  } finally {
    await cleanup(resources);
  }
  if (!(await verifyClean(resources))) {
    exitCode = 1;
  }
  log(`exiting with status ${exitCode}`);
  return exitCode;
}

const exitCode = await main();
process.exit(exitCode);
