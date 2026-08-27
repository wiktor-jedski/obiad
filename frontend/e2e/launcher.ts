import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const FRONTEND = resolve(import.meta.dir, "..");
const REPO = resolve(FRONTEND, "..");
const BACKEND = join(REPO, "backend");
const SETUP_SCRIPT = join(REPO, "scripts", "setup_local_database.sh");

const FIBER_ADDR = "127.0.0.1:8080";
const FIBER_PORT = 8080;

const PREVIEW_PORT = 4173;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

const POSTGRES_IMAGE = "postgres:17-alpine";

const OUTAGE_SUITES = [
  {
    grep: "Substitution request failures",
    label: "Substitution request failures",
  },
  {
    grep: "Control accessibility failure states",
    label: "Control accessibility failure states",
  },
  {
    grep: "Responsive presentation failure surfaces",
    label: "Responsive presentation failure surfaces",
  },
] as const;

const PROCESS_START_TIMEOUT_MS = 60_000;
const POSTGRES_START_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 3_000;
const STOP_HARD_MS = 1_000;

const GROUP_DEREGISTER_GRACE_MS = 250;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;
const CONTAINER_RM_RETRIES = 3;

const DOCKER_OP_TIMEOUT_MS = 15_000;

const DOCKER_PROBE_TIMEOUT_MS = 5_000;

const TOOL_CHECK_TIMEOUT_MS = 10_000;

const GENERATED_CLIENT_DIR = join(FRONTEND, "src", "client");
const TEST_RESULTS_DIR = join(FRONTEND, "test-results");
const GENERATED_TRANSPORT_FILE = join(
  BACKEND,
  "internal",
  "transport",
  "suggestions.gen.go",
);

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
  containers: string[];
  tempDir: string | null;

  fiberStarted: boolean;
  previewStarted: boolean;

  groups: Map<number, ProcessGroup>;

  outputs: ManagedOutput[];
}

interface BoundedResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ShutdownState {
  signal: NodeJS.Signals | null;
  cleanupInFlight: Promise<string[]> | null;
}

const shutdown: ShutdownState = {
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
  return randomBytes(bytes).toString("hex");
}

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

function assertRunning(): void {
  if (shutdown.signal) {
    throw new Error(`interrupted by ${shutdown.signal}`);
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function processAlive(resources: OwnedResources, child: ChildProcess): boolean {
  const group =
    child.pid !== undefined ? resources.groups.get(child.pid) : undefined;
  return (
    group !== undefined && child.exitCode === null && child.signalCode === null
  );
}

function tcpPortInUse(port: number): Promise<boolean> {
  const { promise, resolve: settle } = Promise.withResolvers<boolean>();
  const socket = net.connect({ host: "127.0.0.1", port });
  let settled = false;
  const finish = (inUse: boolean) => {
    if (settled) {
      return;
    }
    settled = true;
    socket.destroy();
    settle(inUse);
  };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.setTimeout(1_000, () => finish(false));
  return promise;
}

function spawnOwned(
  resources: OwnedResources,
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  } = {},
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO,
    env: options.env ?? process.env,
    stdio: options.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit",
    detached: true,
  });
  child.once("error", (error: Error) => {
    log(`error: failed to spawn '${command}': ${error.message}`);
    if (child.pid !== undefined) {
      resources.groups.delete(child.pid);
    }
  });
  if (child.pid !== undefined) {
    resources.groups.set(child.pid, {
      label: `${command} ${args.join(" ")}`,
      leader: child,
    });
  }
  return child;
}

function deregisterGroupWhenGone(
  resources: OwnedResources,
  child: ChildProcess,
): void {
  const pgid = child.pid;
  if (pgid === undefined) {
    return;
  }
  void (async () => {
    const deadline = Date.now() + GROUP_DEREGISTER_GRACE_MS;
    while (Date.now() < deadline && groupAlive(pgid)) {
      await sleep(25);
    }
    if (!groupAlive(pgid)) {
      resources.groups.delete(pgid);
    }
  })();
}

async function runStep(
  resources: OwnedResources,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  assertRunning();
  const child = spawnOwned(resources, command, args, options);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  child.once("error", reject);
  child.once("exit", (code) => {
    resolve(code ?? 1);
    deregisterGroupWhenGone(resources, child);
  });
  return promise;
}

function assertStepSucceeded(status: number, description: string): void {
  if (status !== 0) {
    throw new Error(`${description} failed with status ${status}`);
  }
}

function assertBoundedStepSucceeded(
  result: BoundedResult,
  description: string,
): void {
  if (result.status === 0) {
    return;
  }
  const status = result.status ?? "timeout";
  const timeout = result.timedOut ? ", timed out" : "";
  throw new Error(`${description} (docker status ${status}${timeout})`);
}

async function runBounded(
  resources: OwnedResources,
  command: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    inheritStdout?: boolean;
  } = {},
): Promise<BoundedResult> {
  const timeoutMs = options.timeoutMs ?? DOCKER_OP_TIMEOUT_MS;
  const { promise, resolve } = Promise.withResolvers<BoundedResult>();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const controller = new AbortController();
  const child = spawn(command, args, {
    cwd: REPO,
    env: options.env ?? process.env,
    stdio: [
      "ignore",
      options.inheritStdout ? "inherit" : "pipe",
      options.inheritStdout ? "inherit" : "pipe",
    ],
    detached: true,
    signal: controller.signal,
  });
  const pgid = child.pid;
  child.once("error", (error: Error) => {
    finish({ status: null, stdout, stderr: stderr || error.message, timedOut });
  });
  if (pgid !== undefined) {
    resources.groups.set(pgid, {
      label: `${command} ${args.join(" ")}`,
      leader: child,
    });
  }

  async function drainGroupAfterTimeout(): Promise<void> {
    if (pgid === undefined) {
      return;
    }
    controller.abort();
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {}
    const grace = Date.now() + STOP_GRACE_MS;
    while (Date.now() < grace && groupAlive(pgid)) {
      await sleep(50);
    }
    if (groupAlive(pgid)) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {}
      const hardDeadline = Date.now() + STOP_HARD_MS;
      while (Date.now() < hardDeadline && groupAlive(pgid)) {
        await sleep(50);
      }
    }
    resources.groups.delete(pgid);
  }

  const timer = setTimeout(() => {
    timedOut = true;
    void drainGroupAfterTimeout();
  }, timeoutMs);

  if (!options.inheritStdout) {
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
  }
  function finish(result: BoundedResult): void {
    clearTimeout(timer);
    if (pgid !== undefined && groupAlive(pgid)) {
      resolve(result);
      return;
    }
    if (pgid !== undefined) {
      resources.groups.delete(pgid);
    }
    resolve(result);
  }
  child.once("exit", (code) => {
    finish({ status: code, stdout, stderr, timedOut });
  });
  return promise;
}

async function stopProcessGroup(
  resources: OwnedResources,
  pgid: number,
): Promise<boolean> {
  const group = resources.groups.get(pgid);
  if (!group) {
    return true;
  }
  const label = group.label;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && groupAlive(pgid)) {
    await sleep(50);
  }
  if (groupAlive(pgid)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
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

async function preflight(resources: OwnedResources): Promise<void> {
  for (const [command, args, label] of [
    ["docker", ["--version"], "docker"],
    ["go", ["version"], "go"],
    ["bun", ["--version"], "bun"],
    ["bash", ["--version"], "bash"],
  ] as const) {
    const result = await runBounded(resources, command, args, {
      timeoutMs: TOOL_CHECK_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      throw new Error(
        `required binary ${label} is not available (${result.stderr.trim() || `status ${result.status}`}${result.timedOut ? ", timed out" : ""})`,
      );
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

async function waitForPostgresReady(
  resources: OwnedResources,
  containerName: string,
): Promise<void> {
  const deadline = Date.now() + POSTGRES_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertRunning();
    const probe = await runBounded(
      resources,
      "docker",
      [
        "exec",
        containerName,
        "pg_isready",
        "--host=127.0.0.1",
        "--username=postgres",
        "--dbname=postgres",
      ],
      { timeoutMs: DOCKER_PROBE_TIMEOUT_MS },
    );
    if (probe.status === 0) {
      return;
    }
    const running = await runBounded(
      resources,
      "docker",
      ["inspect", "--format={{.State.Running}}", containerName],
      { timeoutMs: DOCKER_PROBE_TIMEOUT_MS },
    );
    if (running.status !== 0 || running.stdout.trim() !== "true") {
      break;
    }
    await sleep(250);
  }
  await runBounded(resources, "docker", ["logs", containerName], {
    timeoutMs: DOCKER_OP_TIMEOUT_MS,
    inheritStdout: true,
  });
  throw new Error(
    `PostgreSQL container ${containerName} did not become ready within ${POSTGRES_START_TIMEOUT_MS} ms`,
  );
}

async function dockerPublishedPort(
  resources: OwnedResources,
  containerName: string,
): Promise<number> {
  const result = await runBounded(
    resources,
    "docker",
    ["port", containerName, "5432/tcp"],
    {
      timeoutMs: DOCKER_OP_TIMEOUT_MS,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `failed to read the PostgreSQL port mapping for ${containerName}`,
    );
  }
  const lines = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(
      `expected one PostgreSQL port mapping, got ${result.stdout.trim()}`,
    );
  }
  const match = /^127\.0\.0\.1:(\d+)$/.exec(lines[0].trim());
  if (!match) {
    throw new Error(`unexpected PostgreSQL port mapping: ${lines[0]}`);
  }
  return Number(match[1]);
}

function unquoteShellWord(word: string): string {
  if (word.startsWith("'")) {
    return unquoteSingleQuotedShellWord(word);
  }
  if (word.startsWith('"')) {
    return unquoteDoubleQuotedShellWord(word);
  }
  return unquoteBareShellWord(word);
}

function unquoteSingleQuotedShellWord(word: string): string {
  const end = word.indexOf("'", 1);
  if (end === -1) {
    throw new Error(`malformed single-quoted credential value: ${word}`);
  }
  return word.slice(1, end);
}

function unquoteDoubleQuotedShellWord(word: string): string {
  let out = "";
  for (let i = 1; i < word.length; i++) {
    const char = word[i];
    if (char === '"' && (i === word.length - 1 || word[i + 1] === "\n")) {
      break;
    }
    if (char === "\\" && i + 1 < word.length) {
      const next = word[i + 1];
      if (
        next === '"' ||
        next === "\\" ||
        next === "$" ||
        next === "`" ||
        next === "\n"
      ) {
        out += next === "\n" ? "" : next;
        i++;
        continue;
      }
    }
    out += char;
  }
  return out;
}

function unquoteBareShellWord(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    if (word[i] === "\\" && i + 1 < word.length) {
      out += word[i + 1];
      i++;
      continue;
    }
    out += word[i];
  }
  return out;
}

function readCredentialLine(content: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of content.split("\n")) {
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
  accept: (status: number, body: string, contentType: string) => boolean,
  alive: () => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + PROCESS_START_TIMEOUT_MS;
  let lastProbe = "no response";
  while (Date.now() < deadline) {
    assertRunning();
    if (!alive()) {
      throw new Error(
        `${label}: owned process exited before becoming ready (last probe: ${lastProbe})`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      });
      const body = await response.text();
      lastProbe = `${response.status} ${response.headers.get("content-type") ?? ""}`;
      if (
        accept(
          response.status,
          body,
          response.headers.get("content-type") ?? "",
        )
      ) {
        return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(
    `${label}: did not become ready within ${PROCESS_START_TIMEOUT_MS} ms (last probe: ${lastProbe})`,
  );
}

function fiberReady(
  status: number,
  body: string,
  contentType: string,
): boolean {
  if (status !== 200) {
    return false;
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return false;
  }
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed) === '{"status":"ready"}';
  } catch {
    return false;
  }
}

async function removeContainer(
  resources: OwnedResources,
  name: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= CONTAINER_RM_RETRIES; attempt++) {
    const result = await runBounded(
      resources,
      "docker",
      ["rm", "--force", name],
      {
        timeoutMs: DOCKER_OP_TIMEOUT_MS,
      },
    );
    if (result.status === 0) {
      log(`removed PostgreSQL container ${name}`);
      return true;
    }
    const stderr = result.stderr.trim();
    if (/no such container/i.test(stderr)) {
      log(`PostgreSQL container ${name} is already gone`);
      return true;
    }
    log(
      `docker rm --force ${name} failed (attempt ${attempt}/${CONTAINER_RM_RETRIES}): ${stderr || `status ${result.status}${result.timedOut ? " (timed out)" : ""}`}`,
    );
    await sleep(1_000);
  }
  return false;
}

function snapshotOutputs(resources: OwnedResources): void {
  if (!resources.tempDir) {
    return;
  }
  const snapshotsDir = join(resources.tempDir, "snapshots");
  const managed = [
    { path: GENERATED_CLIENT_DIR, label: "generated TypeScript client" },
    { path: TEST_RESULTS_DIR, label: "Playwright output" },
    { path: GENERATED_TRANSPORT_FILE, label: "generated Go transport models" },
  ];
  for (const output of managed) {
    const preExisted = existsSync(output.path);
    let snapshotPath: string | null = null;
    if (preExisted) {
      snapshotPath = join(
        snapshotsDir,
        output.label.replace(/[^a-z0-9]+/gi, "-"),
      );
      cpSync(output.path, snapshotPath, { recursive: true, force: true });
      log(
        `preserving pre-existing ${output.label} at ${output.path} (snapshot ${snapshotPath})`,
      );
    }
    resources.outputs.push({ ...output, preExisted, snapshotPath });
  }
}

async function cleanup(resources: OwnedResources): Promise<string[]> {
  const problems: string[] = [];

  while (resources.groups.size > 0) {
    const pgids = [...resources.groups.keys()];
    for (const pgid of pgids) {
      if (!(await stopProcessGroup(resources, pgid))) {
        problems.push(`process group ${pgid} could not be terminated`);
      }
    }
  }

  for (const name of resources.containers) {
    if (await removeContainer(resources, name)) {
      resources.containers = resources.containers.filter(
        (owned) => owned !== name,
      );
    } else {
      problems.push(
        `container ${name} could not be removed and is still owned`,
      );
    }
  }

  for (const output of resources.outputs) {
    try {
      if (output.preExisted && output.snapshotPath) {
        rmSync(output.path, { recursive: true, force: true });
        cpSync(output.snapshotPath, output.path, {
          recursive: true,
          force: true,
        });
        log(`restored pre-existing ${output.label} at ${output.path}`);
      } else if (existsSync(output.path)) {
        rmSync(output.path, { recursive: true, force: true });
        log(`removed invocation-created ${output.label} at ${output.path}`);
      }
    } catch (error) {
      problems.push(
        `failed to ${output.preExisted ? "restore" : "remove"} ${output.label} at ${output.path}: ${String(error)}`,
      );
    }
  }

  if (resources.tempDir) {
    const dir = resources.tempDir;
    try {
      rmSync(dir, { recursive: true, force: true });
      log(
        `removed temporary directory ${dir} (build output, browser bundle, server binary, credential file)`,
      );
    } catch (error) {
      problems.push(
        `failed to remove temporary directory ${dir}: ${String(error)}`,
      );
      return problems;
    }
    resources.tempDir = null;
  }

  return problems;
}

function ensureCleanup(resources: OwnedResources): Promise<string[]> {
  if (!shutdown.cleanupInFlight) {
    shutdown.cleanupInFlight = cleanup(resources);
  }
  return shutdown.cleanupInFlight;
}

function requestShutdown(
  resources: OwnedResources,
  signal: NodeJS.Signals,
): void {
  if (shutdown.signal) {
    return;
  }
  shutdown.signal = signal;
  log(`received ${signal}: cleaning up owned resources before exiting`);
  void ensureCleanup(resources);
}

function processGroupCleanupProblems(resources: OwnedResources): string[] {
  const problems: string[] = [];
  for (const [pgid, group] of resources.groups) {
    if (groupAlive(pgid)) {
      problems.push(
        `process group ${pgid} (${group.label}) is still alive after cleanup`,
      );
    }
  }
  return problems;
}

async function containerCleanupProblems(
  resources: OwnedResources,
): Promise<string[]> {
  const problems: string[] = [];
  for (const name of resources.containers) {
    const inspect = await runBounded(
      resources,
      "docker",
      ["inspect", "--format={{.State.Running}}", name],
      { timeoutMs: DOCKER_PROBE_TIMEOUT_MS },
    );
    if (inspect.status === 0) {
      problems.push(`container ${name} is still present after cleanup`);
    }
  }
  return problems;
}

function outputCleanupProblems(resources: OwnedResources): string[] {
  const problems: string[] = [];
  for (const output of resources.outputs) {
    const present = existsSync(output.path);
    if (output.preExisted && !present) {
      problems.push(
        `${output.label} was pre-existing but is missing after cleanup`,
      );
    }
    if (!output.preExisted && present) {
      problems.push(`${output.label} still exists after cleanup`);
    }
  }
  if (resources.tempDir && existsSync(resources.tempDir)) {
    problems.push(`temporary directory ${resources.tempDir} still exists`);
  }
  return problems;
}

async function portCleanupProblems(
  resources: OwnedResources,
): Promise<string[]> {
  const ports: number[] = [];
  if (resources.fiberStarted) {
    ports.push(FIBER_PORT);
  }
  if (resources.previewStarted) {
    ports.push(PREVIEW_PORT);
  }
  const problems: string[] = [];
  for (const port of ports) {
    if (await tcpPortInUse(port)) {
      problems.push(`application port ${port} is still occupied after cleanup`);
    }
  }
  return problems;
}

async function verifyClean(resources: OwnedResources): Promise<boolean> {
  const [containerProblems, portProblems] = await Promise.all([
    containerCleanupProblems(resources),
    portCleanupProblems(resources),
  ]);
  const problems = [
    ...processGroupCleanupProblems(resources),
    ...containerProblems,
    ...outputCleanupProblems(resources),
    ...portProblems,
  ];
  if (problems.length === 0) {
    log(
      "cleanup verified: no owned process group, container, credential file, or generated output remains",
    );
    return true;
  }
  for (const problem of problems) {
    log(`cleanup verification failed: ${problem}`);
  }
  return false;
}

async function runOutageSuite(
  resources: OwnedResources,
  options: {
    tempDir: string;
    serverBinary: string;
    browserClientBundle: string;
    grep: string;
    label: string;
  },
): Promise<number> {
  const outageContainerName = `obiad-e2e-outage-postgres-${process.pid}-${randomHex(4)}`;
  resources.containers.push(outageContainerName);
  const outagePostgresPassword = randomHex(24);
  const outageDockerRun = await runBounded(
    resources,
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      outageContainerName,
      "--env",
      "POSTGRES_PASSWORD",
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: outagePostgresPassword } },
  );
  assertBoundedStepSucceeded(
    outageDockerRun,
    "failed to start the outage PostgreSQL container",
  );
  assertRunning();
  log(`started outage PostgreSQL container ${outageContainerName}`);
  await waitForPostgresReady(resources, outageContainerName);
  const outagePostgresPort = await dockerPublishedPort(
    resources,
    outageContainerName,
  );
  log(`outage PostgreSQL 17 is ready on loopback port ${outagePostgresPort}`);

  const outageOwnerPassword = randomHex(24);
  const outageRuntimePassword = randomHex(24);
  const outageCredentialFile = join(options.tempDir, "outage-database-urls");
  log(
    "running scripts/setup_local_database.sh for the outage stack with ephemeral credentials",
  );
  const setupStatus = await runStep(resources, "bash", [SETUP_SCRIPT], {
    cwd: REPO,
    env: {
      ...process.env,
      OBIAD_ADMIN_DATABASE_URL: `postgres://postgres:${outagePostgresPassword}@127.0.0.1:${outagePostgresPort}/postgres?sslmode=disable`,
      OBIAD_OWNER_PASSWORD: outageOwnerPassword,
      OBIAD_RUNTIME_PASSWORD: outageRuntimePassword,
      OBIAD_CREDENTIAL_FILE: outageCredentialFile,
    },
  });
  assertRunning();
  assertStepSucceeded(setupStatus, "outage scripts/setup_local_database.sh");
  const outageCredentialContent = readFileSync(outageCredentialFile, "utf8");
  const outageRuntimeDatabaseUrl = readCredentialLine(
    outageCredentialContent,
    "OBIAD_RUNTIME_DATABASE_URL",
  );
  log("outage database setup complete; outage Fiber credential ready");

  const outageFiber = spawnOwned(resources, options.serverBinary, [], {
    cwd: BACKEND,
    env: {
      ...process.env,
      OBIAD_RUNTIME_DATABASE_URL: outageRuntimeDatabaseUrl,
    },
  });
  if (outageFiber.pid === undefined) {
    throw new Error(
      `failed to spawn the outage Fiber server ${options.serverBinary}`,
    );
  }
  outageFiber.once("exit", () =>
    deregisterGroupWhenGone(resources, outageFiber),
  );
  log(`started outage Fiber process (pid ${outageFiber.pid}) on ${FIBER_ADDR}`);
  await waitForService(
    `http://${FIBER_ADDR}/health`,
    fiberReady,
    () => processAlive(resources, outageFiber),
    "outage Fiber GET /health",
  );
  log(
    'outage Fiber is healthy: GET /health returns 200 with exactly {"status":"ready"}',
  );

  log(
    `running the serial database-outage Playwright scenario: ${options.label}`,
  );
  const suiteStatus = await runStep(
    resources,
    "bun",
    ["x", "playwright", "test", "--grep", options.grep],
    {
      cwd: FRONTEND,
      env: {
        ...process.env,
        OBIAD_E2E_BROWSER_CLIENT_BUNDLE: options.browserClientBundle,
        OBIAD_E2E_OUTAGE_CONTAINER: outageContainerName,
      },
    },
  );
  assertRunning();

  log(`stopping the outage Fiber after the ${options.label} suite`);
  if (outageFiber.pid !== undefined) {
    await stopProcessGroup(resources, outageFiber.pid);
  }
  return suiteStatus;
}

async function runStack(
  resources: OwnedResources,
  mode: "e2e" | "performance",
): Promise<number> {
  assertRunning();
  await preflight(resources);
  await preflightPorts();
  assertRunning();
  log(
    "preflight passed: required binaries present and fixed loopback application ports are free",
  );

  const tempDir = mkdtempSync(join(tmpdir(), "obiad-e2e-"));
  resources.tempDir = tempDir;
  log(`owned temporary directory: ${tempDir}`);

  snapshotOutputs(resources);

  log("generating the TypeScript API client");
  let status = await runStep(resources, "bun", ["run", "generate:api"], {
    cwd: FRONTEND,
  });
  assertRunning();
  assertStepSucceeded(status, "bun run generate:api");
  log("generated client written to src/client");
  const browserClientBundle = join(tempDir, "browser-client.js");
  log(
    `bundling the generated client for the browser into ${browserClientBundle}`,
  );
  status = await runStep(
    resources,
    "bun",
    [
      "build",
      "e2e/browser-client-entry.ts",
      "--target",
      "browser",
      "--format",
      "iife",
      "--outfile",
      browserClientBundle,
    ],
    { cwd: FRONTEND },
  );
  assertRunning();
  assertStepSucceeded(status, "bundling the browser client entry");

  const buildOutDir = join(tempDir, "dist");
  log(`building the optimized client into ${buildOutDir}`);
  status = await runStep(
    resources,
    "bun",
    ["run", "build", "--", "--outDir", buildOutDir],
    { cwd: FRONTEND },
  );
  assertRunning();
  assertStepSucceeded(status, "bun run build");
  log("optimized build emitted");

  const containerName = `obiad-e2e-postgres-${process.pid}-${randomHex(4)}`;
  resources.containers.push(containerName);
  const postgresPassword = randomHex(24);
  const dockerRun = await runBounded(
    resources,
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--env",
      "POSTGRES_PASSWORD",
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: postgresPassword } },
  );
  assertBoundedStepSucceeded(
    dockerRun,
    "failed to start the PostgreSQL container",
  );
  assertRunning();
  log(`started PostgreSQL container ${containerName}`);
  await waitForPostgresReady(resources, containerName);
  const postgresPort = await dockerPublishedPort(resources, containerName);
  log(`PostgreSQL 17 is ready on loopback port ${postgresPort}`);

  const adminDatabaseUrl = `postgres://postgres:${postgresPassword}@127.0.0.1:${postgresPort}/postgres?sslmode=disable`;
  const ownerPassword = randomHex(24);
  const runtimePassword = randomHex(24);
  const credentialFile = join(tempDir, "database-urls");
  log("running scripts/setup_local_database.sh with ephemeral credentials");
  status = await runStep(resources, "bash", [SETUP_SCRIPT], {
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
  assertStepSucceeded(status, "scripts/setup_local_database.sh");
  const credentialContent = readFileSync(credentialFile, "utf8");
  const runtimeDatabaseUrl = readCredentialLine(
    credentialContent,
    "OBIAD_RUNTIME_DATABASE_URL",
  );
  log(
    "local database setup complete; seeded catalog and runtime credential ready",
  );

  const serverBinary = join(tempDir, "obiad-server");
  log("generating the Go transport models");
  status = await runStep(resources, "go", ["generate", "./..."], {
    cwd: BACKEND,
  });
  assertRunning();
  assertStepSucceeded(status, "go generate ./...");
  log(`building the Fiber server into ${serverBinary}`);
  status = await runStep(
    resources,
    "go",
    ["build", "-o", serverBinary, "./cmd/server"],
    { cwd: BACKEND },
  );
  assertRunning();
  assertStepSucceeded(status, "go build of the Fiber server");
  const fiber = spawnOwned(resources, serverBinary, [], {
    cwd: BACKEND,
    env: { ...process.env, OBIAD_RUNTIME_DATABASE_URL: runtimeDatabaseUrl },
  });
  if (fiber.pid === undefined) {
    throw new Error(`failed to spawn the Fiber server ${serverBinary}`);
  }
  fiber.once("exit", () => deregisterGroupWhenGone(resources, fiber));
  resources.fiberStarted = true;
  log(`started real Fiber process (pid ${fiber.pid}) on ${FIBER_ADDR}`);
  await waitForService(
    `http://${FIBER_ADDR}/health`,
    fiberReady,
    () => processAlive(resources, fiber),
    "Fiber GET /health",
  );
  log(
    'Fiber is healthy: GET /health returns 200 with exactly {"status":"ready"}',
  );

  const preview = spawnOwned(
    resources,
    "bun",
    [
      "x",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(PREVIEW_PORT),
      "--strictPort",
      "--outDir",
      buildOutDir,
    ],
    { cwd: FRONTEND },
  );
  if (preview.pid === undefined) {
    throw new Error("failed to spawn the Vite preview");
  }
  preview.once("exit", () => deregisterGroupWhenGone(resources, preview));
  resources.previewStarted = true;
  log(
    `started optimized Vite preview (pid ${preview.pid}) on ${PREVIEW_ORIGIN}`,
  );
  await waitForService(
    `${PREVIEW_ORIGIN}/`,
    (httpStatus) => httpStatus === 200,
    () => processAlive(resources, preview),
    "Vite preview origin",
  );
  assertRunning();
  log("Vite preview is serving the optimized build");

  log("ensuring the pinned Playwright Chromium is installed");
  status = await runStep(
    resources,
    "bun",
    ["x", "playwright", "install", "chromium"],
    { cwd: FRONTEND },
  );
  assertRunning();
  assertStepSucceeded(status, "playwright install chromium");

  if (mode === "performance") {
    log("running the serial Search performance scenario on the normal stack");
    const performanceStatus = await runStep(
      resources,
      "bun",
      [
        "x",
        "playwright",
        "test",
        "--grep",
        "Search performance",
        "--workers=1",
      ],
      {
        cwd: FRONTEND,
        env: {
          ...process.env,
          OBIAD_E2E_BROWSER_CLIENT_BUNDLE: browserClientBundle,
        },
      },
    );
    assertRunning();
    return performanceStatus;
  }

  log("running the real-stack Playwright suite on the normal stack");
  const normalStatus = await runStep(
    resources,
    "bun",
    [
      "x",
      "playwright",
      "test",
      "--grep-invert",
      "Substitution request failures|Control accessibility failure states|Result Card motion|Responsive presentation failure surfaces|Search performance",
    ],
    {
      cwd: FRONTEND,
      env: {
        ...process.env,
        OBIAD_E2E_BROWSER_CLIENT_BUNDLE: browserClientBundle,
      },
    },
  );
  assertRunning();

  log("running the serial Result Card motion timing suite on the normal stack");
  const motionStatus = await runStep(
    resources,
    "bun",
    ["x", "playwright", "test", "--grep", "Result Card motion", "--workers=1"],
    {
      cwd: FRONTEND,
      env: {
        ...process.env,
        OBIAD_E2E_BROWSER_CLIENT_BUNDLE: browserClientBundle,
      },
    },
  );
  assertRunning();

  log("stopping the normal-stack Fiber for the outage-stack handoff");
  if (fiber.pid !== undefined) {
    await stopProcessGroup(resources, fiber.pid);
  }

  let outageStatus = 0;
  for (const outageSpec of OUTAGE_SUITES) {
    const suiteStatus = await runOutageSuite(resources, {
      tempDir,
      serverBinary,
      browserClientBundle,
      grep: outageSpec.grep,
      label: outageSpec.label,
    });
    assertRunning();
    if (suiteStatus !== 0) {
      outageStatus = suiteStatus;
    }
  }

  return normalStatus !== 0
    ? normalStatus
    : motionStatus !== 0
      ? motionStatus
      : outageStatus;
}

async function main(): Promise<number> {
  const resources: OwnedResources = {
    containers: [],
    tempDir: null,
    fiberStarted: false,
    previewStarted: false,
    groups: new Map(),
    outputs: [],
  };
  process.on("SIGINT", () => requestShutdown(resources, "SIGINT"));
  process.on("SIGTERM", () => requestShutdown(resources, "SIGTERM"));

  const mode: "e2e" | "performance" =
    process.argv[2] === "performance" ? "performance" : "e2e";

  let exitCode = 1;
  try {
    exitCode = await runStack(resources, mode);
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
