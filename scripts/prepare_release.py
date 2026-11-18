#!/usr/bin/env python3
"""Package the pinned production catalog and images for Docker builds."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = ROOT / ".release"


def git(directory: Path, *arguments: str) -> str:
    """Read one Git value without changing the checkout."""
    return subprocess.check_output(
        ["git", "-C", str(directory), *arguments], text=True
    ).strip()


def data_commit() -> str:
    """Require a clean data checkout at the application's pinned revision."""
    entry = git(ROOT, "ls-tree", "HEAD", "data").split()
    if len(entry) != 4 or entry[:2] != ["160000", "commit"]:
        raise ValueError("data must be a committed Git submodule")
    commit = git(DATA, "rev-parse", "HEAD")
    if commit != entry[2] or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ValueError("run git submodule update --init data to use the pinned data revision")
    if git(DATA, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("the data checkout must be clean before release preparation")
    return commit


def digest(path: Path) -> str:
    """Hash a release file without loading it into memory."""
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare() -> None:
    """Export validated Meals and publish the completed build inputs."""
    commit = data_commit()
    with tempfile.TemporaryDirectory(prefix="obiad-release-") as temporary:
        release = Path(temporary)
        subprocess.run(
            ["uv", "run", "--project", str(DATA), "--frozen", "obiad-data",
             "export-catalog", "--ingredients-dir", str(DATA / "ingredients"),
             "--meals-dir", str(DATA / "meals"), "--schema", str(ROOT / "api/catalog.schema.json"),
             "--output", str(release / "catalog.json")],
            cwd=ROOT, check=True,
        )
        catalog = json.loads((release / "catalog.json").read_text())
        (release / "catalog.json").chmod(0o644)
        objects = catalog["foodObjects"]
        if len(objects) < 10:
            raise ValueError("production requires at least ten validated Meals")
        meals = {meal["id"]: meal for path in (DATA / "meals").glob("*.json")
                 if isinstance(meal := json.loads(path.read_text()), dict)}
        if set(meals) != {item["id"] for item in objects}:
            raise ValueError("catalog IDs do not match the pinned Meal records")
        (release / "images").mkdir()
        images = {}
        imports = []
        entries = []
        for item in objects:
            key = item.get("imageKey")
            if key is None:
                continue
            if key != f"meal-{item['id']}":
                raise ValueError("catalog image key does not match the Meal ID")
            source = (DATA / meals[item["id"]]["image_path"]).resolve(strict=True)
            if not source.is_relative_to((DATA / "images").resolve()):
                raise ValueError("Meal image escapes the data images directory")
            target = Path("images") / f"{key}{source.suffix.lower()}"
            shutil.copyfile(source, release / target)
            images[key] = {"file": target.as_posix(), "sha256": digest(release / target)}
            variable = f"mealImage{item['id']}"
            imports.append(f'import {variable} from "../../../../.release/{target.as_posix()}";')
            entries.append(f'  ["{key}", {variable}],')
        image_map = "\n".join([
            *imports, "", "/** Maps released Meal keys to their bundled images. */",
            "export const mealImages: ReadonlyMap<string, string> = new Map([", *entries, "]);", "",
        ])
        (release / "generated-meal-images.ts").write_text(image_map)
        manifest = {
            "schemaVersion": 1, "dataCommit": commit,
            "catalogSha256": digest(release / "catalog.json"),
            "mealIds": sorted(meals), "images": images,
        }
        (release / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
        if data_commit() != commit:
            raise ValueError("data changed during release preparation")
        staged = ROOT / ".release-next"
        if staged.exists():
            raise ValueError("remove the incomplete .release-next directory before retrying")
        try:
            shutil.copytree(release, staged)
            staged.chmod(0o755)
            if OUTPUT.exists():
                shutil.rmtree(OUTPUT)
            os.replace(staged, OUTPUT)
        finally:
            if staged.exists():
                shutil.rmtree(staged)
    print(f"Prepared {len(objects)} Meals from {commit} in .release/")


def main() -> int:
    """Prepare release inputs without accepting them for publication."""
    try:
        prepare()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"release preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
