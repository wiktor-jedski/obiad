#!/usr/bin/env python3
"""Run repository CI checks against a disposable PostgreSQL service."""

from __future__ import annotations

import os
import secrets
import shlex
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
POSTGRES_IMAGE = "postgres:17-alpine"
POSTGRES_CONTAINER_PORT = "5432/tcp"
POSTGRES_START_TIMEOUT_SECONDS = 60


def run_checked(
    command: list[str],
    *,
    cwd: Path = REPO_ROOT,
    env: dict[str, str] | None = None,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run command, echoing it without printing environment-provided credentials."""

    print(f"+ {shlex.join(command)}", flush=True)
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=True,
        text=True,
        capture_output=capture_output,
    )


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
    """Wait until PostgreSQL accepts connections or fail with container logs."""

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

    subprocess.run(
        ["docker", "logs", container_name],
        cwd=REPO_ROOT,
        check=False,
    )
    raise RuntimeError("PostgreSQL did not become ready")


def published_postgres_port(container_name: str) -> int:
    """Return Docker's randomly assigned loopback port for PostgreSQL."""

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


def run_ci_checks() -> None:
    """Validate planning files and run Go tests against disposable PostgreSQL."""

    run_checked([sys.executable, "scripts/validate_phase_plan.py"])

    container_name = f"obiad-ci-postgres-{os.getpid()}-{secrets.token_hex(4)}"
    password = secrets.token_urlsafe(24)
    docker_env = os.environ.copy()
    docker_env["POSTGRES_PASSWORD"] = password

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
        port = published_postgres_port(container_name)
        database_url = (
            f"postgres://postgres:{quote(password, safe='')}"
            f"@127.0.0.1:{port}/postgres?sslmode=disable"
        )
        test_env = os.environ.copy()
        test_env["OBIAD_TEST_ADMIN_DATABASE_URL"] = database_url
        run_checked(["go", "test", "-count=1", "./..."], cwd=BACKEND_ROOT, env=test_env)
    finally:
        print("Stopping disposable PostgreSQL.", flush=True)
        subprocess.run(
            ["docker", "rm", "--force", container_name],
            cwd=REPO_ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> int:
    """Run CI checks and return a shell-compatible status code."""

    try:
        run_ci_checks()
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
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
