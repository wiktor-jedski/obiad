#!/usr/bin/env python3
"""Join validated catalog Meals to their authored recipe details."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def read_records(directory: Path) -> dict[int, dict]:
    """Index the canonical one-object-per-file authoring records."""
    records = {}
    for path in directory.glob("*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        identifier = record["id"]
        if type(identifier) is not int or identifier < 1:
            raise ValueError(f"ID must be a positive integer in {path}")
        if identifier in records:
            raise ValueError(f"duplicate ID {identifier} in {directory}")
        records[identifier] = record
    return records


def encode(value: object) -> bytes:
    """Write stable UTF-8 JSON for content-addressed browser assets."""
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def write_recipe_assets(
    output: Path, objects: list[dict], meals: dict[int, dict], ingredients_dir: Path
) -> None:
    """Publish only the selected Meals. Keep all recipe bodies out of the index."""
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"recipe output must be empty: {output}")
    ingredients = read_records(ingredients_dir)
    bodies = output / "public" / "recipes"
    bodies.mkdir(parents=True)
    index = []
    for item in objects:
        identifier = item["id"]
        meal = meals[identifier]
        if (
            item["names"] != meal["names"]
            or item["nutritionBasis"] != meal["nutrition_basis"]
            or not item.get("source")
            or item["source"] != meal.get("source")
        ):
            raise ValueError(f"catalog Meal {identifier} does not match its authored recipe")
        profile = item["macroProfile"]
        recipe = {
            "id": identifier,
            "names": item["names"],
            "source": item["source"],
            "quantity": {"value": meal["yield"]["value"], "unit": item["nutritionBasis"]},
            "macroProfile": {
                "protein": profile["protein"],
                "carbohydrate": profile["availableCarbohydrate"],
                "fat": profile["fat"],
            },
            "ingredients": [
                {"names": ingredients[line["ingredient_id"]]["names"], "grams": line["quantity_g"]}
                for line in meal["composition"]
            ],
            "steps": meal["steps"],
        }
        if "imageKey" in item:
            recipe["imageKey"] = item["imageKey"]
        content = encode(recipe)
        filename = f"{identifier}-{hashlib.sha256(content).hexdigest()}.json"
        (bodies / filename).write_bytes(content)
        index.append([identifier, item["names"], filename])
    (output / "index.json").write_bytes(encode(index))


def main() -> int:
    """Prepare detail assets from one selected export and its authoring tree."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        catalog = json.loads(arguments.catalog.read_text(encoding="utf-8"))
        write_recipe_assets(arguments.output, catalog["foodObjects"],
                            read_records(arguments.data / "meals"), arguments.data / "ingredients")
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"recipe preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
