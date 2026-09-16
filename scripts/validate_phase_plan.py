#!/usr/bin/env python3
"""Validate the task-list ledger and its task-description files."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from urllib.parse import unquote, urlsplit

REQUIRED_COLUMNS = (
    "ID",
    "Architecture Component",
    "Status",
    "Depends On (ID)",
)
DETAIL_COLUMNS = frozenset(
    {
        "Description",
        "Acceptance Criteria",
        "Verification Criteria",
        "Command",
        "Commands",
    }
)
ALLOWED_STATUSES = frozenset({"OPEN", "PREPARED", "PASSED"})
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
RUN_COMMAND_RE = re.compile(r"\bRun\s+`[^`\n]+`", re.IGNORECASE)


@dataclass(frozen=True)
class Task:
    """One task-list ledger row."""

    number: int
    line: int
    architecture_component: str
    status: str
    dependencies: tuple[int, ...]


def split_markdown_row(line: str) -> list[str]:
    """Split a Markdown table row while preserving escaped pipes."""

    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return []

    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for character in stripped[1:-1]:
        if character == "|" and not escaped:
            cells.append("".join(current).strip().replace(r"\|", "|"))
            current = []
        else:
            current.append(character)
        escaped = character == "\\" and not escaped
        if character != "\\":
            escaped = False
    cells.append("".join(current).strip().replace(r"\|", "|"))
    return cells


def is_table_separator(line: str) -> bool:
    """Return whether a row is a Markdown table delimiter."""

    cells = split_markdown_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def parse_dependencies(value: str, line: int, errors: list[str]) -> tuple[int, ...]:
    """Parse a dependency cell that is empty, a dash, or comma-separated IDs."""

    if not value or value == "-":
        return ()
    if not re.fullmatch(r"[1-9]\d*(?:\s*,\s*[1-9]\d*)*", value):
        errors.append(
            f"task row at line {line} has invalid dependencies {value!r}; "
            "use comma-separated IDs, '-' or an empty cell"
        )
        return ()
    return tuple(int(part.strip()) for part in value.split(","))


def validate_status_declaration(lines: list[str], path: Path, errors: list[str]) -> None:
    """Validate the task-list status declaration."""

    status_line = next(
        (line for line in lines if line.startswith("Valid Task statuses:")), None
    )
    if status_line is None:
        errors.append(f"{path} does not declare valid task statuses")
        return

    declared = {
        status.strip()
        for status in status_line.partition(":")[2].split(",")
        if status.strip()
    }
    if declared != ALLOWED_STATUSES:
        errors.append(
            f"{path} declares statuses {sorted(declared)}; "
            f"expected {sorted(ALLOWED_STATUSES)}"
        )


def parse_tasks(path: Path, errors: list[str]) -> list[Task]:
    """Parse the one task-list ledger table."""

    if not path.is_file():
        errors.append(f"task list does not exist: {path}")
        return []

    lines = path.read_text(encoding="utf-8").splitlines()
    validate_status_declaration(lines, path, errors)
    table_starts: list[int] = []
    for index in range(len(lines) - 1):
        headers = split_markdown_row(lines[index])
        if headers and is_table_separator(lines[index + 1]) and "ID" in headers:
            table_starts.append(index)

    if not table_starts:
        errors.append(f"no task table found in {path}")
        return []
    if len(table_starts) > 1:
        locations = ", ".join(str(index + 1) for index in table_starts)
        errors.append(f"multiple task tables found in {path} at lines {locations}")

    index = table_starts[0]
    headers = split_markdown_row(lines[index])
    duplicate_headers = sorted(
        {header for header in headers if headers.count(header) > 1}
    )
    if duplicate_headers:
        errors.append(
            f"task table at line {index + 1} has duplicate columns {duplicate_headers}"
        )

    missing_columns = [column for column in REQUIRED_COLUMNS if column not in headers]
    if missing_columns:
        errors.append(
            f"task table at line {index + 1} is missing columns {missing_columns}"
        )
    detail_columns = sorted(DETAIL_COLUMNS.intersection(headers))
    if detail_columns:
        errors.append(
            f"task table at line {index + 1} contains task-detail columns "
            f"{detail_columns}; put task detail in the tasks directory"
        )
    if missing_columns or duplicate_headers:
        return []

    tasks: list[Task] = []
    row_index = index + 2
    while row_index < len(lines) and lines[row_index].lstrip().startswith("|"):
        cells = split_markdown_row(lines[row_index])
        line_number = row_index + 1
        if len(cells) != len(headers):
            errors.append(
                f"task row at line {line_number} has {len(cells)} cells; "
                f"expected {len(headers)}"
            )
            row_index += 1
            continue

        values = dict(zip(headers, cells, strict=True))
        raw_number = values["ID"]
        if not re.fullmatch(r"[1-9]\d*", raw_number):
            errors.append(f"task row at line {line_number} has invalid ID {raw_number!r}")
            row_index += 1
            continue

        number = int(raw_number)
        architecture_component = values["Architecture Component"]
        status = values["Status"]
        if not architecture_component:
            errors.append(f"task {number} has no Architecture Component")
        if status not in ALLOWED_STATUSES:
            errors.append(f"task {number} has invalid status {status!r}")

        tasks.append(
            Task(
                number=number,
                line=line_number,
                architecture_component=architecture_component,
                status=status,
                dependencies=parse_dependencies(
                    values["Depends On (ID)"], line_number, errors
                ),
            )
        )
        row_index += 1

    return tasks


def validate_identifiers_and_dependencies(tasks: list[Task], errors: list[str]) -> None:
    """Validate task IDs and the dependency graph."""

    task_by_id: dict[int, Task] = {}
    for task in tasks:
        previous = task_by_id.get(task.number)
        if previous is not None:
            errors.append(
                f"duplicate task ID {task.number} at lines {previous.line} and {task.line}"
            )
        else:
            task_by_id[task.number] = task

    for previous, current in pairwise(tasks):
        if current.number <= previous.number:
            errors.append(
                f"task IDs are not growing at line {current.line}: "
                f"{current.number} follows {previous.number}"
            )

    graph: dict[int, tuple[int, ...]] = {}
    for task in tasks:
        graph[task.number] = task.dependencies
        if len(task.dependencies) != len(set(task.dependencies)):
            errors.append(f"task {task.number} repeats a dependency")
        for dependency in task.dependencies:
            if dependency not in task_by_id:
                errors.append(f"task {task.number} depends on missing task {dependency}")
            if dependency >= task.number:
                errors.append(
                    f"task {task.number} dependency {dependency} must have a smaller ID "
                    "and appear first"
                )

    state: dict[int, int] = {}
    stack: list[int] = []

    def visit(task_id: int) -> None:
        if state.get(task_id) == 2:
            return
        if state.get(task_id) == 1:
            cycle_start = stack.index(task_id)
            cycle = stack[cycle_start:] + [task_id]
            errors.append("task dependency cycle: " + " -> ".join(map(str, cycle)))
            return
        state[task_id] = 1
        stack.append(task_id)
        for dependency in graph.get(task_id, ()):
            if dependency in graph:
                visit(dependency)
        stack.pop()
        state[task_id] = 2

    for task_id in graph:
        visit(task_id)


def markdown_anchors(path: Path, cache: dict[Path, set[str]]) -> set[str]:
    """Build GitHub-style heading anchors for one Markdown source."""

    if path in cache:
        return cache[path]

    anchors: set[str] = set()
    counts: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line)
        if not match:
            continue
        heading = match.group(1)
        heading = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", heading)
        heading = re.sub(r"<[^>]+>", "", heading)
        heading = heading.replace("`", "")
        heading = re.sub(r"[*_~]", "", heading).strip().lower()
        slug = "".join(
            character
            for character in heading
            if character.isalnum() or character in {" ", "-", "_"}
        ).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        anchors.add(slug if count == 0 else f"{slug}-{count}")

    cache[path] = anchors
    return anchors


def validate_link(
    target: str,
    source: Path,
    repo_root: Path,
    anchor_cache: dict[Path, set[str]],
    context: str,
    errors: list[str],
) -> bool:
    """Validate one local link and return whether it names a local source file."""

    target = target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        return False

    raw_path = unquote(parsed.path)
    if raw_path:
        linked_path = (
            repo_root / raw_path.lstrip("/")
            if raw_path.startswith("/")
            else source.parent / raw_path
        )
    else:
        linked_path = source
    linked_path = linked_path.resolve()
    if not linked_path.is_file():
        errors.append(f"{context} references missing source {target!r}")
        return bool(raw_path)

    if parsed.fragment and linked_path.suffix.lower() == ".md":
        fragment = unquote(parsed.fragment).lower()
        if fragment not in markdown_anchors(linked_path, anchor_cache):
            errors.append(
                f"{context} references missing heading #{parsed.fragment} in {linked_path}"
            )
    return bool(raw_path)


def section_body(
    lines: list[str], heading_index: int, next_heading_index: int
) -> list[str]:
    """Return non-heading lines in a task-file section."""

    return lines[heading_index + 1 : next_heading_index]


def validate_task_file(
    task: Task,
    path: Path,
    repo_root: Path,
    anchor_cache: dict[Path, set[str]],
    errors: list[str],
) -> None:
    """Validate one task-description file."""

    lines = path.read_text(encoding="utf-8").splitlines()
    expected_title = f"# Task {task.number}"
    titles = [line for line in lines if line.startswith("# ")]
    if titles != [expected_title]:
        errors.append(f"{path} must contain only the title {expected_title!r}")

    level_two = [(index, line) for index, line in enumerate(lines) if line.startswith("## ")]
    expected_headings = ["## Description", "## Acceptance Criteria"]
    if [line for _, line in level_two] != expected_headings:
        errors.append(
            f"{path} must contain exactly these sections in order: "
            f"{expected_headings}"
        )
        return

    description_index = level_two[0][0]
    acceptance_index = level_two[1][0]
    description_lines = section_body(lines, description_index, acceptance_index)
    acceptance_lines = section_body(lines, acceptance_index, len(lines))
    description = "\n".join(description_lines).strip()
    acceptance = "\n".join(acceptance_lines).strip()

    if not description:
        errors.append(f"{path} has an empty Description")
    if not acceptance:
        errors.append(f"{path} has empty Acceptance Criteria")

    local_source_count = 0
    for target in MARKDOWN_LINK_RE.findall(description):
        if validate_link(
            target,
            path,
            repo_root,
            anchor_cache,
            f"task {task.number} Description",
            errors,
        ):
            local_source_count += 1
    for target in MARKDOWN_LINK_RE.findall(acceptance):
        validate_link(
            target,
            path,
            repo_root,
            anchor_cache,
            f"task {task.number} Acceptance Criteria",
            errors,
        )
    if description and local_source_count == 0:
        errors.append(
            f"task {task.number} Description must contain at least one local design "
            "or architecture link"
        )

    if acceptance and not any(
        re.match(r"^\s*-\s+\S", line) for line in acceptance_lines
    ):
        errors.append(f"task {task.number} Acceptance Criteria must use a Markdown list")
    if acceptance and not RUN_COMMAND_RE.search(acceptance):
        errors.append(
            f"task {task.number} Acceptance Criteria must name a command as 'Run `...`'"
        )


def validate_task_files(
    tasks: list[Task], task_list_path: Path, repo_root: Path, errors: list[str]
) -> None:
    """Validate the one-to-one mapping between ledger rows and task files."""

    details_path = task_list_path.parent / "tasks"
    if not details_path.is_dir():
        errors.append(f"task-details directory does not exist: {details_path}")
        return

    task_by_id = {task.number: task for task in tasks}
    discovered: dict[int, Path] = {}
    for path in sorted(details_path.iterdir()):
        if not path.is_file() or path.suffix != ".md":
            continue
        if not re.fullmatch(r"[1-9]\d*\.md", path.name):
            errors.append(
                f"task file name must be a canonical positive integer ID: {path}"
            )
            continue
        task_id = int(path.stem)
        discovered[task_id] = path
        if task_id not in task_by_id:
            errors.append(f"task file has no task-list row: {path}")

    anchor_cache: dict[Path, set[str]] = {}
    for task in tasks:
        path = discovered.get(task.number)
        if path is None:
            errors.append(f"task {task.number} has no task file {details_path / f'{task.number}.md'}")
            continue
        validate_task_file(task, path, repo_root, anchor_cache, errors)


def resolve_path(repo_root: Path, value: Path | None, default: str) -> Path:
    """Resolve a CLI path against the selected repository root."""

    path = value if value is not None else Path(default)
    return path.resolve() if path.is_absolute() else (repo_root / path).resolve()


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="repository root (default: parent of scripts/)",
    )
    parser.add_argument("--tasks", type=Path, help="task-list path")
    return parser.parse_args()


def main() -> int:
    """Run all task-list checks and return a process exit status."""

    args = parse_args()
    repo_root = args.repo_root.resolve()
    task_list_path = resolve_path(
        repo_root, args.tasks, "docs/implementation/task-list.md"
    )

    errors: list[str] = []
    tasks = parse_tasks(task_list_path, errors)
    validate_identifiers_and_dependencies(tasks, errors)
    validate_task_files(tasks, task_list_path, repo_root, errors)

    if errors:
        print(f"Task-list validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"Task-list validation passed: {len(tasks)} task(s), "
        f"{len(tasks)} task-description file(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
