"""Build two synthetic recipe assets for the browser suite's dummy catalog."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def prepare(work: Path) -> None:
    """Use the release asset generator with the selected and second-page test meals."""
    (work / "meals").mkdir(parents=True)
    (work / "ingredients").mkdir()
    foods = json.loads((ROOT / "backend/catalog/dummy.json").read_text())["foodObjects"]
    selected = [food for food in foods if food["id"] in (1, 3)]
    for index, names in enumerate([{"en": "Flour", "pl": "Mąka"}, {"en": "Tomato", "pl": "Pomidor"}], 1):
        (work / "ingredients" / f"{index}.json").write_text(json.dumps({"id": index, "names": names}))
    for food in selected:
        meal_id = food["id"]
        food["source"] = f"https://example.org/recipes/{meal_id}"
        meal = {
            "id": meal_id, "names": food["names"], "source": food["source"],
            "yield": {"method": "summed_input_mass", "value": 800}, "nutrition_basis": "g",
            "composition": [{"ingredient_id": 1, "quantity_g": 600}, {"ingredient_id": 2, "quantity_g": 200}],
            "steps": ["Mix in 200 g of tomato.", "Cook for 15 minutes."],
        }
        (work / "meals" / f"{meal_id}.json").write_text(json.dumps(meal))
    catalog = work / "catalog.json"
    catalog.write_text(json.dumps({"foodObjects": selected}))
    subprocess.run([sys.executable, str(ROOT / "scripts/recipe_assets.py"), "--data", str(work),
                    "--catalog", str(catalog), "--output", str(work / "bundle")], check=True)


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
