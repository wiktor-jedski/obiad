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
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
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


def data_submodule_is_tracked(repository: Path) -> bool:
    """Return whether data is tracked as the root Git submodule gitlink."""
    result = subprocess.run(
        ["git", "-C", str(repository), "ls-files", "--stage", "--", "data"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        message = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"cannot inspect tracked data path in {repository}: {message}")
    entries = result.stdout.splitlines()
    if not entries:
        return False
    if len(entries) != 1:
        raise RuntimeError(f"malformed tracked data path in {repository}: {result.stdout!r}")
    header, separator, path = entries[0].partition(b"\t")
    if separator != b"\t" or path != b"data" or header.split()[:1] != [b"160000"]:
        raise RuntimeError(f"tracked data path is not a submodule gitlink in {repository}")
    return True


def data_submodule_has_metadata(repository: Path) -> None:
    """Require exactly one .gitmodules entry that maps a section to data."""
    result = subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "config",
            "--file",
            ".gitmodules",
            "--get-regexp",
            r"^submodule\..*\.path$",
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode not in (0, 1):
        message = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"cannot read data submodule configuration in {repository}: {message}")
    paths = [
        fields[1]
        for line in result.stdout.splitlines()
        if len(fields := line.split(None, 1)) == 2
    ]
    if paths.count(b"data") != 1:
        raise RuntimeError(f"tracked data gitlink lacks one .gitmodules path entry in {repository}")


def initialized_data_submodule(repository: Path) -> Path | None:
    """Return the initialized data submodule path, if this repository has one."""
    if not data_submodule_is_tracked(repository):
        return None
    data_submodule_has_metadata(repository)
    result = subprocess.run(
        ["git", "-C", str(repository), "submodule", "status", "--", "data"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        message = result.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"cannot inspect data submodule in {repository}: {message}")
    lines = result.stdout.splitlines()
    if len(lines) != 1:
        raise RuntimeError(f"malformed data submodule status in {repository}: {result.stdout!r}")
    status = lines[0]
    if status[:1] == b"-":
        return None
    if status[:1] not in (b" ", b"+", b"U"):
        raise RuntimeError(f"malformed data submodule status in {repository}: {status!r}")
    data = repository / "data"
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
