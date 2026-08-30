#!/usr/bin/env python3
"""Reject tracked production-data artifacts outside local-only storage."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections.abc import Iterable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
APPLICATION_HTML = "frontend/index.html"

PROHIBITED_ARTIFACTS = (
    ("production Ingredient record", re.compile(r"(?:^|/)ingredients/[^/]+\.json$")),
    ("production Meal record", re.compile(r"(?:^|/)meals/[^/]+\.json$")),
    (
        "Open Food Facts or USDA download",
        re.compile(r"(?:^|/)[^/]*(?:open[-_]?food[-_]?facts|usda)[^/]*(?:/|$)", re.IGNORECASE),
    ),
    ("generated aggregate catalog", re.compile(r"(?:^|/)catalogs(?:/|$)|(?:^|/)catalog\.json$")),
    ("source HTML", re.compile(r"\.html?$", re.IGNORECASE)),
    ("source page text", re.compile(r"\.txt$", re.IGNORECASE)),
    ("source-content checksum", re.compile(r"\.sha256$", re.IGNORECASE)),
)


def tracked_paths(repository: Path) -> list[str]:
    """Return Git-tracked paths for one working tree."""
    result = subprocess.run(
        ["git", "-C", str(repository), "ls-files", "-z"],
        check=False,
        capture_output=True,
    )
    if result.returncode:
        message = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"cannot list tracked files in {repository}: {message}")
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def prohibited_artifacts(paths: Iterable[str]) -> list[tuple[str, str]]:
    """Return each tracked path together with its prohibited artifact type."""
    violations: list[tuple[str, str]] = []
    for path in paths:
        if path == APPLICATION_HTML:
            continue
        for artifact, pattern in PROHIBITED_ARTIFACTS:
            if pattern.search(path):
                violations.append((path, artifact))
                break
    return violations


def initialized_data_submodule(repository: Path) -> Path | None:
    """Return the initialized data submodule path, if this repository has one."""
    data = repository / "data"
    if not data.exists():
        return None
    result = subprocess.run(
        ["git", "-C", str(repository), "submodule", "status", "--", "data"],
        check=False,
        capture_output=True,
    )
    if result.returncode:
        message = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"cannot inspect data submodule in {repository}: {message}")
    lines = result.stdout.splitlines()
    if not lines:
        return None
    if len(lines) != 1:
        raise RuntimeError(f"malformed data submodule status in {repository}: {result.stdout!r}")
    status = lines[0]
    if status[:1] == b"-":
        return None
    if status[:1] not in (b" ", b"+", b"U"):
        raise RuntimeError(f"malformed data submodule status in {repository}: {status!r}")
    if not data.is_dir():
        raise RuntimeError(f"initialized data submodule is unreadable: {data}")
    return data


def repositories_to_check(repository: Path) -> list[Path]:
    """Return the application repository and its initialized data submodule."""
    repositories = [repository]
    if data := initialized_data_submodule(repository):
        repositories.append(data)
    return repositories


def check(repository: Path) -> int:
    """Report prohibited tracked artifacts in the application boundary."""
    violations: list[tuple[Path, str, str]] = []
    for tree in repositories_to_check(repository):
        violations.extend(
            (tree, path, artifact) for path, artifact in prohibited_artifacts(tracked_paths(tree))
        )
    if violations:
        for tree, path, artifact in violations:
            print(f"{tree}: {path}: prohibited {artifact}", file=sys.stderr)
        return 1
    print("Data boundary check passed.")
    return 0


def main() -> int:
    """Run the data-boundary check for the selected Git working tree."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repository",
        type=Path,
        default=REPO_ROOT,
        help="application Git working tree to check (default: repository root)",
    )
    args = parser.parse_args()
    try:
        return check(args.repository.resolve())
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
