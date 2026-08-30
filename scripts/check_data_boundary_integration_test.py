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
    """Verify Gitlink-based data submodule boundary handling."""

    def test_renamed_uninitialized_submodule_succeeds_and_corruption_fails_closed(self) -> None:
        """Accept a renamed uninitialized section and reject a corrupt worktree."""
        with tempfile.TemporaryDirectory(prefix="obiad-data-boundary-") as temporary:
            application = self.create_application_with_data_submodule(
                Path(temporary), "production-data"
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


    def test_repository_without_data_gitlink_succeeds(self) -> None:
        """Allow Git repositories that do not track data."""
        with tempfile.TemporaryDirectory(prefix="obiad-data-boundary-") as temporary:
            application = Path(temporary) / "application"
            self.run_git(["init", "--quiet", str(application)])

            result = self.run_checker(application)
            self.assertEqual(result.returncode, 0, result.stderr)

    def create_application_with_data_submodule(self, root: Path, section_name: str) -> Path:
        """Create one application fixture with a root data gitlink."""
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
                "--name",
                section_name,
                "--quiet",
                str(origin),
                "data",
            ]
        )
        return application

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
