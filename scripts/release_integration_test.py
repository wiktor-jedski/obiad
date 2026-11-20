"""Exercise the production release gate with the real Go catalog validator."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "a" * 40


class ReleaseIntegrationTest(unittest.TestCase):
    """Reject invalid releases before the deployment can reach PostgreSQL."""

    @classmethod
    def setUpClass(cls) -> None:
        """Build the actual offline validator once for all integration scenarios."""
        cls.binary = tempfile.TemporaryDirectory(prefix="obiad-catalogcheck-")
        subprocess.run(
            ["go", "build", "-o", str(Path(cls.binary.name) / "catalogcheck"), "./cmd/catalogcheck"],
            cwd=ROOT / "backend", check=True,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        """Remove the temporary executable."""
        cls.binary.cleanup()

    def setUp(self) -> None:
        """Prepare isolated application-owned catalog fixtures."""
        self.temporary = tempfile.TemporaryDirectory(prefix="obiad-release-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.catalog = json.loads((ROOT / "backend/catalog/dummy.json").read_text())
        self.catalog["foodObjects"] = self.catalog["foodObjects"][:10]
        self.environment = {**os.environ, "PATH": f"{self.binary.name}:{os.environ['PATH']}",
                            "OBIAD_ACCEPTED_DATA_COMMIT": COMMIT}
        for item in self.catalog["foodObjects"]:
            item.pop("imageKey", None)
        self.publish()

    def publish(self) -> None:
        """Publish a manifest matching the current catalog bytes."""
        body = json.dumps(self.catalog).encode()
        (self.directory / "catalog.json").write_bytes(body)
        self.manifest = {"schemaVersion": 1, "dataCommit": COMMIT,
                         "catalogSha256": hashlib.sha256(body).hexdigest(),
                         "mealIds": sorted(item["id"] for item in self.catalog["foodObjects"]),
                         "images": {}}
        (self.directory / "release.json").write_text(json.dumps(self.manifest))

    def validate(self) -> subprocess.CompletedProcess[str]:
        """Run the deployed preflight command as a separate process."""
        return subprocess.run(
            ["python3", str(ROOT / "deploy/validate_release.py"), str(self.directory)],
            env=self.environment, capture_output=True, text=True, check=False,
        )

    def test_accepted_catalog_is_reported(self) -> None:
        result = self.validate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"Accepted release {COMMIT}: 10 Meals", result.stdout)

    def test_unaccepted_or_different_commit_is_rejected(self) -> None:
        for accepted in ("", "b" * 40):
            with self.subTest(accepted=accepted):
                self.environment["OBIAD_ACCEPTED_DATA_COMMIT"] = accepted
                result = self.validate()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("reviewed release data commit", result.stderr)

    def test_small_catalog_is_rejected(self) -> None:
        self.catalog["foodObjects"].pop()
        self.publish()
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("at least ten", result.stderr)

    def test_changed_catalog_is_rejected(self) -> None:
        with (self.directory / "catalog.json").open("ab") as stream:
            stream.write(b" ")
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum", result.stderr)

    def test_invalid_catalog_cannot_pass_with_matching_checksum(self) -> None:
        self.catalog["foodObjects"][0]["macroProfile"]["protein"] = -1
        self.publish()
        self.assertNotEqual(self.validate().returncode, 0)

    def test_wrong_meal_identity_is_rejected(self) -> None:
        self.manifest["mealIds"][0] = 999999
        (self.directory / "release.json").write_text(json.dumps(self.manifest))
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("IDs do not match", result.stderr)

    def test_missing_or_changed_image_is_rejected(self) -> None:
        item = self.catalog["foodObjects"][0]
        key = f"meal-{item['id']}"
        item["imageKey"] = key
        self.publish()
        self.assertNotEqual(self.validate().returncode, 0)
        (self.directory / "images").mkdir()
        image = self.directory / "images" / f"{key}.webp"
        image.write_bytes(b"original fixture image")
        self.manifest["images"][key] = {"file": f"images/{key}.webp",
                                        "sha256": hashlib.sha256(image.read_bytes()).hexdigest()}
        (self.directory / "release.json").write_text(json.dumps(self.manifest))
        self.assertEqual(self.validate().returncode, 0)
        image.write_bytes(b"changed fixture image")
        self.assertNotEqual(self.validate().returncode, 0)

    def test_image_path_escape_is_rejected(self) -> None:
        item = self.catalog["foodObjects"][0]
        item["imageKey"] = f"meal-{item['id']}"
        self.publish()
        self.manifest["images"][item["imageKey"]] = {"file": "../outside.webp", "sha256": "a" * 64}
        (self.directory / "release.json").write_text(json.dumps(self.manifest))
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid release image path", result.stderr)


if __name__ == "__main__":
    unittest.main()
