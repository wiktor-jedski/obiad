#!/usr/bin/env python3
"""Exercise production-data boundary checks with tracked temporary files."""

from __future__ import annotations

from contextlib import contextmanager
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CHECK_SCRIPT = REPOSITORY_ROOT / "scripts/check_data_boundary.py"


@contextmanager
def initialized_repository() -> Iterator[Path]:
    """Provide one application repository with an initialized data submodule."""
    with TemporaryDirectory() as directory:
        root = Path(directory) / "application"
        data_origin = Path(directory) / "data-origin"
        root.mkdir()
        data_origin.mkdir()
        _run("git", "init", data_origin)
        _write(data_origin / "ingredients/1-wheat-flour.json", "{}\n")
        _write(
            data_origin / "tests/fixtures/kuchnia_domowa/pierogi_ruskie.html", "fixture\n"
        )
        _run("git", "-C", data_origin, "add", ".")
        _run("git", "-C", data_origin, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture")
        _run("git", "init", root)
        _write(root / "frontend/index.html", "<!doctype html>\n")
        _run("git", "-C", root, "add", "frontend/index.html")
        _run(
            "git",
            "-C",
            root,
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            str(data_origin),
            "data",
        )
        yield root


def _run(*arguments: object, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run one command and retain output for an assertion failure."""
    return subprocess.run(
        [str(argument) for argument in arguments],
        check=check,
        text=True,
        capture_output=True,
    )


def _write(path: Path, content: str) -> None:
    """Write and stage one tracked test artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _check(root: Path) -> subprocess.CompletedProcess[str]:
    """Run the production boundary script against one temporary repository."""
    return _run(sys.executable, CHECK_SCRIPT, "--repository", root, check=False)


def _assert_passes(root: Path) -> None:
    """Require the boundary script to accept the temporary repository."""
    result = _check(root)
    assert result.returncode == 0, result.stderr


def _assert_rejects(root: Path, path: str, artifact: str) -> None:
    """Stage one forbidden artifact and require the expected rejection."""
    target = root / path
    _write(target, "forbidden\n")
    _run("git", "-C", root, "add", path)
    result = _check(root)
    assert result.returncode == 1, result.stderr
    assert f"{path}: prohibited {artifact}" in result.stderr, result.stderr


def _assert_data_rejects(root: Path, path: str, artifact: str) -> None:
    """Stage one forbidden production-data artifact and require rejection."""
    target = root / "data" / path
    _write(target, "forbidden\n")
    _run("git", "-C", root / "data", "add", path)
    result = _check(root)
    assert result.returncode == 1, result.stderr
    assert f"data: {path}: prohibited {artifact}" in result.stderr, result.stderr


def test_permits_ingredients_only_in_initialized_data() -> None:
    """Accept the Ingredient and approved recipe fixture in initialized data."""
    with initialized_repository() as root:
        _assert_passes(root)
        _assert_rejects(root, "ingredients/1-wheat-flour.json", "production Ingredient record")


def test_rejects_application_artifacts() -> None:
    """Reject every production-data artifact that remains outside data."""
    cases = (
        ("meals/1-pierogi.json", "production Meal record"),
        ("cache/open-food-facts.json", "Open Food Facts or USDA download"),
        ("catalog.json", "generated aggregate catalog"),
        ("source.html", "source HTML"),
        ("source.txt", "source page text"),
        ("source.sha256", "source-content checksum"),
    )
    for path, artifact in cases:
        with initialized_repository() as root:
            _assert_rejects(root, path, artifact)


def test_rejects_prohibited_data_artifacts() -> None:
    """Reject every still-prohibited artifact inside initialized data."""
    cases = (
        ("meals/1-pierogi.json", "production Meal record"),
        ("cache/usda.json", "Open Food Facts or USDA download"),
        ("catalogs/catalog.json", "generated aggregate catalog"),
        ("source.html", "source HTML"),
        ("source.txt", "source page text"),
        ("source.sha256", "source-content checksum"),
    )
    for path, artifact in cases:
        with initialized_repository() as root:
            _assert_data_rejects(root, path, artifact)


def main() -> int:
    """Run integration coverage without an external test framework."""
    test_permits_ingredients_only_in_initialized_data()
    test_rejects_application_artifacts()
    test_rejects_prohibited_data_artifacts()
    print("Data boundary integration test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
