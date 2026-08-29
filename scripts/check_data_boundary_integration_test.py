#!/usr/bin/env python3
"""Exercise the data-boundary check against real Git submodule states."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).with_name("check_data_boundary.py")


class DataBoundarySubmoduleIntegrationTest(unittest.TestCase):
    """Verify uninitialized and corrupted configured data submodule handling."""

    def test_uninitialized_succeeds_and_corrupted_submodule_fails_closed(self) -> None:
        """Reject a configured submodule whose Git working tree is corrupt."""
        with tempfile.TemporaryDirectory(prefix="obiad-data-boundary-") as temporary:
            root = Path(temporary)
            origin = root / "origin"
            application = root / "application"
            self.run_git(["init", "--quiet", str(origin)])
            (origin / "README").write_text("fixture\n")
            self.run_git(["-C", str(origin), "add", "README"])
            self.run_git(
                [
                    "-C",
                    str(origin),
                    "-c",
                    "user.name=fixture",
                    "-c",
                    "user.email=fixture@example.test",
                    "commit",
                    "--quiet",
                    "-m",
                    "init",
                ]
            )
            self.run_git(["init", "--quiet", str(application)])
            self.run_git(
                [
                    "-C",
                    str(application),
                    "-c",
                    "protocol.file.allow=always",
                    "submodule",
                    "add",
                    "--quiet",
                    str(origin),
                    "data",
                ]
            )

            shutil.rmtree(application / "data")
            uninitialized = self.run_checker(application)
            self.assertEqual(uninitialized.returncode, 0, uninitialized.stderr)

            self.run_git(
                [
                    "-C",
                    str(application),
                    "-c",
                    "protocol.file.allow=always",
                    "submodule",
                    "update",
                    "--init",
                    "data",
                ]
            )
            (application / "data" / ".git").write_text("gitdir: missing\n")
            corrupted = self.run_checker(application)
            self.assertEqual(corrupted.returncode, 2)
            self.assertIn("cannot inspect data submodule", corrupted.stderr)

    def run_checker(self, repository: Path) -> subprocess.CompletedProcess[str]:
        """Run the public data-boundary command against one fixture repository."""
        return subprocess.run(
            [sys.executable, str(CHECKER), "--repository", str(repository)],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def run_git(self, arguments: list[str]) -> None:
        """Run one fixture Git command and fail the integration test on error."""
        subprocess.run(["git", *arguments], check=True)


if __name__ == "__main__":
    unittest.main()
