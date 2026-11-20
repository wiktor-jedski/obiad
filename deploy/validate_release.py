#!/usr/bin/env python3
"""Validate accepted release artifacts before production database mutation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def unique_object(pairs: list[tuple[str, object]]) -> dict:
    """Reject duplicate keys in release JSON."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load(path: Path) -> dict:
    """Read an object without accepting duplicate fields."""
    result = json.loads(path.read_text(), object_pairs_hook=unique_object)
    if not isinstance(result, dict):
        raise TypeError(f"expected an object in {path.name}")
    return result


def digest(path: Path) -> str:
    """Hash an artifact with bounded memory use."""
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate(directory: Path) -> None:
    """Check acceptance, catalog validity, minimum size, and matching images."""
    manifest = load(directory / "release.json")
    if manifest.get("schemaVersion") != 1:
        raise ValueError("unsupported release schema")
    commit = manifest.get("dataCommit", "")
    if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ValueError("release requires a full data commit")
    if os.environ.get("OBIAD_ACCEPTED_DATA_COMMIT") != commit:
        raise ValueError("set OBIAD_ACCEPTED_DATA_COMMIT to the reviewed release data commit")
    catalog_path = directory / "catalog.json"
    if digest(catalog_path) != manifest.get("catalogSha256"):
        raise ValueError("catalog checksum does not match the release")
    result = subprocess.run(
        ["catalogcheck", str(catalog_path)], check=True, capture_output=True, text=True
    )
    count = int(result.stdout.strip())
    if count < 10:
        raise ValueError("production requires at least ten accepted Meals")
    catalog = load(catalog_path)
    objects = catalog["foodObjects"]
    ids = sorted(item["id"] for item in objects)
    if ids != manifest.get("mealIds") or len(ids) != count:
        raise ValueError("catalog IDs do not match the release Meals")
    images = manifest.get("images")
    keys = {item["imageKey"] for item in objects if "imageKey" in item}
    if not isinstance(images, dict) or set(images) != keys:
        raise ValueError("image manifest does not match catalog image keys")
    for key, image in images.items():
        if not isinstance(image, dict):
            raise TypeError("invalid image manifest entry")
        relative = image.get("file", "")
        if not isinstance(relative, str) or re.fullmatch(
            r"images/meal-[1-9][0-9]*\.(jpg|jpeg|png|webp|avif)", relative
        ) is None or Path(relative).stem != key:
            raise ValueError("invalid release image path")
        path = (directory / relative).resolve(strict=True)
        if not path.is_relative_to(directory.resolve()) or digest(path) != image.get("sha256"):
            raise ValueError(f"image checksum does not match: {key}")
    print(f"Accepted release {commit}: {count} Meals")


def main() -> int:
    """Validate one release directory and report a secret-free failure."""
    try:
        if len(sys.argv) != 2:
            raise ValueError("usage: validate_release.py RELEASE_DIRECTORY")
        validate(Path(sys.argv[1]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"release rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
