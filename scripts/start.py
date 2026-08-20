#!/usr/bin/env python3
"""Start the disposable local Obiad database, backend, and frontend stack."""

from __future__ import annotations

import os
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
FRONTEND_ROOT = REPO_ROOT / "frontend"
DATABASE_SETUP = REPO_ROOT / "scripts" / "setup_local_database.sh"
POSTGRES_IMAGE = "postgres:17-alpine"
POSTGRES_CONTAINER_PORT = "5432/tcp"
POSTGRES_START_TIMEOUT_SECONDS = 60
APPLICATION_START_TIMEOUT_SECONDS = 60
BACKEND_ADDRESS = ("127.0.0.1", 8080)
FRONTEND_ADDRESS = ("127.0.0.1", 5173)


def run_checked(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run a setup command without printing environment-provided credentials."""

    print(f"+ {shlex.join(command)}", flush=True)
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=True,
        text=True,
        capture_output=capture_output,
    )


def require_tools() -> None:
    """Fail before mutation when a directly required executable is unavailable."""

    missing = [
        tool
        for tool in ("bash", "bun", "docker", "go", "psql", "realpath")
        if shutil.which(tool) is None
    ]
    if missing:
        raise RuntimeError(f"required command(s) not found: {', '.join(missing)}")
    run_checked(["docker", "info"], capture_output=True)


def require_free_application_ports() -> None:
    """Fail clearly when either fixed loopback application port is occupied."""

    for host, port in (BACKEND_ADDRESS, FRONTEND_ADDRESS):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            try:
                listener.bind((host, port))
            except OSError as error:
                raise RuntimeError(
                    f"application port {host}:{port} is occupied; stop its process and retry"
                ) from error


def container_is_running(container_name: str) -> bool:
    """Return whether Docker reports the disposable container as running."""

    result = subprocess.run(
        ["docker", "inspect", "--format={{.State.Running}}", container_name],
        cwd=REPO_ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def wait_for_postgres(container_name: str) -> None:
    """Wait until PostgreSQL accepts connections or report its logs."""

    deadline = time.monotonic() + POSTGRES_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        readiness = subprocess.run(
            [
                "docker",
                "exec",
                container_name,
                "pg_isready",
                "--host=127.0.0.1",
                "--username=postgres",
                "--dbname=postgres",
            ],
            cwd=REPO_ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if readiness.returncode == 0:
            print("PostgreSQL is ready.", flush=True)
            return
        if not container_is_running(container_name):
            break
        time.sleep(0.25)

    subprocess.run(["docker", "logs", container_name], cwd=REPO_ROOT, check=False)
    raise RuntimeError("PostgreSQL did not become ready")


def published_postgres_port(container_name: str) -> int:
    """Return Docker's randomly assigned loopback PostgreSQL port."""

    result = run_checked(
        ["docker", "port", container_name, POSTGRES_CONTAINER_PORT],
        capture_output=True,
    )
    endpoints = result.stdout.strip().splitlines()
    if len(endpoints) != 1:
        raise RuntimeError(
            f"expected one PostgreSQL port mapping, got {result.stdout.strip()!r}"
        )
    host, separator, port = endpoints[0].rpartition(":")
    if separator != ":" or host != "127.0.0.1" or not port.isdecimal():
        raise RuntimeError(f"unexpected PostgreSQL port mapping: {endpoints[0]!r}")
    return int(port)


def spawn(
    name: str,
    command: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    """Start one visible service in its own process group."""

    print(f"+ {shlex.join(command)}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        start_new_session=True,
    )
    print(f"Started {name} (pid {process.pid}).", flush=True)
    return process


def wait_for_http(
    name: str,
    process: subprocess.Popen[bytes],
    url: str,
) -> None:
    """Wait for a service's HTTP readiness while detecting an early exit."""

    deadline = time.monotonic() + APPLICATION_START_TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        return_code = process.poll()
        if return_code is not None:
            raise RuntimeError(f"{name} exited during startup with status {return_code}")
        try:
            with urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    print(f"{name} is ready at {url}.", flush=True)
                    return
        except (OSError, URLError) as error:
            last_error = error
        time.sleep(0.2)
    raise RuntimeError(f"{name} did not become ready at {url}: {last_error}")


def stop_process(name: str, process: subprocess.Popen[bytes]) -> None:
    """Stop a complete owned process group, escalating only when necessary."""

    if process.poll() is not None:
        return
    print(f"Stopping {name}.", flush=True)
    for process_signal, timeout in (
        (signal.SIGINT, 5),
        (signal.SIGTERM, 3),
        (signal.SIGKILL, 1),
    ):
        try:
            os.killpg(process.pid, process_signal)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            continue


def prepare_sources() -> None:
    """Install locked frontend dependencies and materialize generated clients."""

    run_checked(["go", "generate", "./..."], cwd=BACKEND_ROOT)
    run_checked(["bun", "install", "--frozen-lockfile"], cwd=FRONTEND_ROOT)
    run_checked(["bun", "run", "generate:api"], cwd=FRONTEND_ROOT)


def run_stack() -> None:
    """Own the disposable database and both application processes until interrupted."""

    require_tools()
    require_free_application_ports()
    prepare_sources()

    container_name = f"obiad-dev-postgres-{os.getpid()}-{secrets.token_hex(4)}"
    postgres_password = secrets.token_urlsafe(24)
    owner_password = secrets.token_urlsafe(24)
    runtime_password = secrets.token_urlsafe(24)
    docker_env = os.environ.copy()
    docker_env["POSTGRES_PASSWORD"] = postgres_password
    processes: list[tuple[str, subprocess.Popen[bytes]]] = []

    try:
        run_checked(
            [
                "docker",
                "run",
                "--detach",
                "--rm",
                "--name",
                container_name,
                "--env",
                "POSTGRES_PASSWORD",
                "--publish",
                "127.0.0.1::5432",
                POSTGRES_IMAGE,
            ],
            env=docker_env,
            capture_output=True,
        )
        wait_for_postgres(container_name)
        postgres_port = published_postgres_port(container_name)
        encoded_postgres_password = quote(postgres_password, safe="")
        encoded_runtime_password = quote(runtime_password, safe="")
        admin_url = (
            f"postgres://postgres:{encoded_postgres_password}"
            f"@127.0.0.1:{postgres_port}/postgres?sslmode=disable"
        )
        runtime_url = (
            f"postgres://obiad_runtime:{encoded_runtime_password}"
            f"@127.0.0.1:{postgres_port}/obiad?sslmode=disable"
        )

        with tempfile.TemporaryDirectory(prefix="obiad-start-") as temp_dir:
            setup_env = os.environ.copy()
            setup_env.update(
                {
                    "OBIAD_ADMIN_DATABASE_URL": admin_url,
                    "OBIAD_OWNER_PASSWORD": owner_password,
                    "OBIAD_RUNTIME_PASSWORD": runtime_password,
                    "OBIAD_CREDENTIAL_FILE": str(Path(temp_dir) / "database-urls"),
                }
            )
            run_checked(["bash", str(DATABASE_SETUP)], env=setup_env)

            backend_env = os.environ.copy()
            backend_env["OBIAD_RUNTIME_DATABASE_URL"] = runtime_url
            backend = spawn(
                "backend",
                ["go", "run", "./cmd/server"],
                cwd=BACKEND_ROOT,
                env=backend_env,
            )
            processes.append(("backend", backend))
            wait_for_http("Backend", backend, "http://127.0.0.1:8080/health")

            frontend = spawn(
                "frontend",
                [
                    "bun",
                    "run",
                    "dev",
                    "--",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "5173",
                    "--strictPort",
                ],
                cwd=FRONTEND_ROOT,
            )
            processes.append(("frontend", frontend))
            wait_for_http("Frontend", frontend, "http://127.0.0.1:5173/")

            print("\nObiad is ready: http://127.0.0.1:5173", flush=True)
            print("Press Ctrl-C to stop frontend, backend, and PostgreSQL.\n", flush=True)
            while True:
                for name, process in processes:
                    return_code = process.poll()
                    if return_code is not None:
                        raise RuntimeError(
                            f"{name} exited unexpectedly with status {return_code}"
                        )
                if not container_is_running(container_name):
                    raise RuntimeError("PostgreSQL exited unexpectedly")
                time.sleep(0.5)
    finally:
        for name, process in reversed(processes):
            stop_process(name, process)
        print("Stopping disposable PostgreSQL.", flush=True)
        subprocess.run(
            ["docker", "rm", "--force", container_name],
            cwd=REPO_ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> int:
    """Start the local stack and return a shell-compatible status code."""

    try:
        run_stack()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
        return 130
    except FileNotFoundError as error:
        print(f"error: required command not found: {error.filename}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        if error.stdout:
            print(error.stdout, file=sys.stderr, end="")
        if error.stderr:
            print(error.stderr, file=sys.stderr, end="")
        return error.returncode or 1
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
