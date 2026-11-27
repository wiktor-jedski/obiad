#!/usr/bin/env python3
"""Package the pinned production catalog, images, and recipes for Docker builds."""

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

from recipe_assets import read_records, write_recipe_assets

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


def export_catalog(path: Path) -> list[dict]:
    """Read the validated Food Objects calculated by the data exporter."""
    subprocess.run(
        ["uv", "run", "--project", str(DATA), "--frozen", "obiad-data",
         "export-catalog", "--ingredients-dir", str(DATA / "ingredients"),
         "--meals-dir", str(DATA / "meals"), "--schema", str(ROOT / "api/catalog.schema.json"),
         "--output", str(path)],
        cwd=ROOT, check=True,
    )
    return json.loads(path.read_text())["foodObjects"]


def prepare_preview_recipes(catalog: Path, temporary: Path) -> Path | None:
    """Prepare details only for selected rows identical to the pinned export."""
    if not (DATA / "meals").is_dir():
        return None
    commit = data_commit()
    canonical = {item["id"]: item for item in export_catalog(temporary / "pinned.json")}
    selected = json.loads(catalog.read_text())["foodObjects"]
    matches = [item for item in selected if item == canonical.get(item["id"])]
    if not matches:
        return None
    output = temporary / "recipe-assets"
    write_recipe_assets(output, matches, read_records(DATA / "meals"), DATA / "ingredients")
    if data_commit() != commit:
        raise ValueError("data changed during preview preparation")
    return output


def prepare() -> None:
    """Export validated Meals and publish the completed build inputs."""
    commit = data_commit()
    with tempfile.TemporaryDirectory(prefix="obiad-release-") as temporary:
        release = Path(temporary)
        objects = export_catalog(release / "catalog.json")
        (release / "catalog.json").chmod(0o644)
        if len(objects) < 10:
            raise ValueError("production requires at least ten validated Meals")
        meals = read_records(DATA / "meals")
        if set(meals) != {item["id"] for item in objects}:
            raise ValueError("catalog IDs do not match the pinned Meal records")
        recipes = release / "recipe-assets"
        write_recipe_assets(recipes, objects, meals, DATA / "ingredients")
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
            "schemaVersion": 2, "dataCommit": commit,
            "catalogSha256": digest(release / "catalog.json"),
            "recipeIndexSha256": digest(recipes / "index.json"),
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
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"release preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
