#!/usr/bin/env python3
"""Validate implementation-phase task planning against the canonical phase plan."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

EXPECTED_COLUMNS = (
    "ID",
    "Architecture Component",
    "Status",
    "Description",
    "Depends On (ID)",
    "Verification Criteria",
)
ALLOWED_STATUSES = frozenset({"OPEN", "PREPARED", "PASSED"})
ALLOWED_ISSUE_STATUSES = frozenset(
    {"needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"}
)
ALLOWED_OPEN_ITEM_HEADINGS = frozenset(
    {
        "Assumptions",
        "Clarifications",
        "Actions needed",
        "Testing coverage deviations",
        "Comments",
    }
)
PHASE_HEADING_RE = re.compile(r"^## Phase\s+0*(\d+)\s+[—–-]\s+(.+?)\s*$")
ISSUE_HEADING_RE = re.compile(r"^## ISSUE-(\d+):\s*(.+?)\s*$")
GATE_MARKER_RE = re.compile(r"\bP0*(\d+)-G(\d+)\b")
REQUIREMENT_RE = re.compile(r"\bREQ-\d{3}\b")
INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
PLACEHOLDER_RE = re.compile(r"\b(?:TBD|TODO|UNKNOWN|UNSPECIFIED)\b", re.IGNORECASE)
ISSUE_REFERENCE_RE = re.compile(r"\bISSUE-\d+\b")
COMMAND_RE = re.compile(
    r"^(?:go|bun|python3?|npm|pnpm|yarn|cargo|docker|psql|make)\b"
)


@dataclass(frozen=True)
class PhasePlan:
    """One phase and the machine-checkable criteria extracted from the plan."""

    number: int
    title: str
    gate_criteria: tuple[str, ...]
    gate_commands: tuple[str, ...]
    requirements: tuple[str, ...]


@dataclass(frozen=True)
class Task:
    """One parsed task-table row."""

    number: int
    phase: int
    line: int
    architecture_component: str
    status: str
    description: str
    dependencies: tuple[int, ...]
    verification: str


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


def unique_in_order(values: list[str]) -> tuple[str, ...]:
    """Return values without duplicates while retaining source order."""

    return tuple(dict.fromkeys(values))


def split_gate_criteria(text: str) -> tuple[str, ...]:
    """Split a phase-gate paragraph without splitting punctuation inside code spans."""

    protected: list[str] = []

    def protect(match: re.Match[str]) -> str:
        protected.append(match.group(0))
        return f"PHASECODETOKEN{len(protected) - 1}"

    safe_text = INLINE_CODE_RE.sub(protect, text)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", safe_text)
    criteria: list[str] = []
    for part in parts:
        restored = part
        for index, code_span in enumerate(protected):
            restored = restored.replace(f"PHASECODETOKEN{index}", code_span)
        restored = restored.strip()
        if restored:
            criteria.append(restored)
    return tuple(criteria)


def parse_plan(path: Path, errors: list[str]) -> dict[int, PhasePlan]:
    """Parse phases, requirements, commands, and gate criteria from the plan."""

    if not path.is_file():
        errors.append(f"phase plan does not exist: {path}")
        return {}

    lines = path.read_text(encoding="utf-8").splitlines()
    headings: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = PHASE_HEADING_RE.match(line)
        if match:
            headings.append((index, int(match.group(1)), match.group(2).strip()))

    if not headings:
        errors.append(f"no phase headings found in {path}")
        return {}

    phases: dict[int, PhasePlan] = {}
    for heading_index, (start, number, title) in enumerate(headings):
        end = headings[heading_index + 1][0] if heading_index + 1 < len(headings) else len(lines)
        section = lines[start:end]
        gate_heading = next(
            (index for index, line in enumerate(section) if line.strip() == "**Phase gate**"),
            None,
        )
        if gate_heading is None:
            errors.append(f"phase {number} has no Phase gate section in {path}")
            gate_criteria: tuple[str, ...] = ()
        else:
            gate_end = next(
                (
                    index
                    for index in range(gate_heading + 1, len(section))
                    if section[index].strip().startswith("**")
                    and section[index].strip().endswith("**")
                ),
                len(section),
            )
            gate_text = " ".join(
                line.strip() for line in section[gate_heading + 1 : gate_end] if line.strip()
            )
            gate_criteria = split_gate_criteria(gate_text)
            if not gate_criteria:
                errors.append(f"phase {number} has an empty Phase gate section in {path}")

        requirements_heading = next(
            (
                index
                for index, line in enumerate(section)
                if line.strip() == "**Requirements that become testable**"
            ),
            None,
        )
        requirements: tuple[str, ...] = ()
        if requirements_heading is not None:
            requirements_end = next(
                (
                    index
                    for index in range(requirements_heading + 1, len(section))
                    if section[index].strip().startswith("**")
                    and section[index].strip().endswith("**")
                ),
                len(section),
            )
            requirement_text = "\n".join(section[requirements_heading + 1 : requirements_end])
            requirements = unique_in_order(REQUIREMENT_RE.findall(requirement_text))

        commands = unique_in_order(
            [
                code
                for criterion in gate_criteria
                for code in INLINE_CODE_RE.findall(criterion)
                if COMMAND_RE.match(code)
            ]
        )
        if number in phases:
            errors.append(f"duplicate phase number {number} in {path}")
        phases[number] = PhasePlan(number, title, gate_criteria, commands, requirements)

    return phases


def parse_dependencies(value: str, line: int, errors: list[str]) -> tuple[int, ...]:
    """Parse a comma-separated dependency cell."""

    if not value:
        return ()
    if not re.fullmatch(r"\d+(?:\s*,\s*\d+)*", value):
        errors.append(
            f"task row at line {line} has invalid dependencies {value!r}; use comma-separated IDs"
        )
        return ()
    return tuple(int(part.strip()) for part in value.split(","))


def parse_tasks(
    path: Path, errors: list[str]
) -> tuple[list[Task], dict[int, str], set[int]]:
    """Parse all phase-scoped task tables."""

    if not path.is_file():
        errors.append(f"task list does not exist: {path}")
        return [], {}, set()

    lines = path.read_text(encoding="utf-8").splitlines()
    status_line = next(
        (line for line in lines if line.startswith("Valid Task statuses:")), None
    )
    if status_line is None:
        errors.append(f"{path} does not declare valid task statuses")
    else:
        declared = {
            status.strip()
            for status in status_line.partition(":")[2].split(",")
            if status.strip()
        }
        if declared != ALLOWED_STATUSES:
            errors.append(
                f"{path} declares statuses {sorted(declared)}; expected {sorted(ALLOWED_STATUSES)}"
            )

    current_phase: int | None = None
    phase_titles: dict[int, str] = {}
    phases_with_tables: set[int] = set()
    tasks: list[Task] = []
    index = 0
    while index < len(lines):
        phase_match = PHASE_HEADING_RE.match(lines[index])
        if phase_match:
            current_phase = int(phase_match.group(1))
            title = phase_match.group(2).strip()
            if current_phase in phase_titles:
                errors.append(f"duplicate Phase {current_phase} heading at line {index + 1} in {path}")
            phase_titles[current_phase] = title
            index += 1
            continue

        if (
            lines[index].lstrip().startswith("|")
            and index + 1 < len(lines)
            and is_table_separator(lines[index + 1])
        ):
            headers = split_markdown_row(lines[index])
            if tuple(headers) != EXPECTED_COLUMNS:
                errors.append(
                    f"task table at line {index + 1} has columns {headers}; expected {list(EXPECTED_COLUMNS)}"
                )
            if current_phase is None:
                errors.append(f"task table at line {index + 1} is not under a Phase heading")
            else:
                phases_with_tables.add(current_phase)

            row_index = index + 2
            while row_index < len(lines) and lines[row_index].lstrip().startswith("|"):
                cells = split_markdown_row(lines[row_index])
                line_number = row_index + 1
                if len(cells) != len(headers):
                    errors.append(
                        f"task row at line {line_number} has {len(cells)} cells; expected {len(headers)}"
                    )
                    row_index += 1
                    continue
                if tuple(headers) != EXPECTED_COLUMNS or current_phase is None:
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
                description = values["Description"]
                verification = values["Verification Criteria"]
                if not architecture_component:
                    errors.append(f"task {number} has no Architecture Component")
                if status not in ALLOWED_STATUSES:
                    errors.append(f"task {number} has invalid status {status!r}")
                if not description:
                    errors.append(f"task {number} has an empty Description")
                if not verification:
                    errors.append(f"task {number} has empty Verification Criteria")
                elif not re.search(r"\bRun\s+`[^`]+`", verification, re.IGNORECASE):
                    errors.append(
                        f"task {number} Verification Criteria must name a command as 'Run `...`'"
                    )
                if verification and not re.search(r"\bPass:\s+\S", verification, re.IGNORECASE):
                    errors.append(
                        f"task {number} Verification Criteria must state observable evidence after 'Pass:'"
                    )

                tasks.append(
                    Task(
                        number=number,
                        phase=current_phase,
                        line=line_number,
                        architecture_component=architecture_component,
                        status=status,
                        description=description,
                        dependencies=parse_dependencies(
                            values["Depends On (ID)"], line_number, errors
                        ),
                        verification=verification,
                    )
                )
                row_index += 1
            index = row_index
            continue

        index += 1

    return tasks, phase_titles, phases_with_tables


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
    """Validate one local Markdown link and return whether it names a source file."""

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
            errors.append(f"{context} references missing heading #{parsed.fragment} in {linked_path}")
    return bool(raw_path)


def validate_task_links(
    tasks: list[Task], task_path: Path, repo_root: Path, errors: list[str]
) -> None:
    """Require and resolve source references in each task description."""

    anchor_cache: dict[Path, set[str]] = {}
    for task in tasks:
        links = MARKDOWN_LINK_RE.findall(task.description)
        local_source_count = 0
        for target in links:
            if validate_link(
                target,
                task_path,
                repo_root,
                anchor_cache,
                f"task {task.number}",
                errors,
            ):
                local_source_count += 1
        for target in MARKDOWN_LINK_RE.findall(task.verification):
            validate_link(
                target,
                task_path,
                repo_root,
                anchor_cache,
                f"task {task.number}",
                errors,
            )
        if local_source_count == 0:
            errors.append(
                f"task {task.number} Description must contain at least one local design or architecture link"
            )


def validate_identifiers_and_dependencies(tasks: list[Task], errors: list[str]) -> None:
    """Validate global task IDs and the dependency graph."""

    task_by_id: dict[int, Task] = {}
    for task in tasks:
        if task.number in task_by_id:
            errors.append(
                f"duplicate task ID {task.number} at lines {task_by_id[task.number].line} and {task.line}"
            )
        else:
            task_by_id[task.number] = task

    for previous, current in zip(tasks, tasks[1:]):
        if current.number <= previous.number:
            errors.append(
                f"task IDs are not growing at line {current.line}: {current.number} follows {previous.number}"
            )

    graph: dict[int, tuple[int, ...]] = {}
    for task in tasks:
        graph[task.number] = task.dependencies
        for dependency in task.dependencies:
            if dependency not in task_by_id:
                errors.append(f"task {task.number} depends on missing task {dependency}")
            if dependency >= task.number:
                errors.append(
                    f"task {task.number} dependency {dependency} must have a smaller ID and appear first"
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


def gate_marker(phase: int, criterion: int) -> str:
    """Return the stable marker for an ordered phase-gate criterion."""

    return f"P{phase:02d}-G{criterion}"


def validate_phase_coverage(
    phases: dict[int, PhasePlan],
    tasks: list[Task],
    phase_titles: dict[int, str],
    phases_with_tables: set[int],
    selected_phases: set[int],
    errors: list[str],
) -> tuple[int, int]:
    """Map every selected phase gate and requirement to task evidence."""

    gate_count = 0
    requirement_count = 0
    tasks_by_phase: dict[int, list[Task]] = {}
    for task in tasks:
        tasks_by_phase.setdefault(task.phase, []).append(task)

    for phase_number in sorted(selected_phases):
        plan_phase = phases.get(phase_number)
        if plan_phase is None:
            errors.append(f"task list contains Phase {phase_number}, absent from the phase plan")
            continue
        if phase_number not in phase_titles:
            errors.append(f"task list has no heading for Phase {phase_number}")
        elif phase_titles[phase_number] != plan_phase.title:
            errors.append(
                f"Phase {phase_number} title {phase_titles[phase_number]!r} does not match plan title {plan_phase.title!r}"
            )
        if phase_number not in phases_with_tables:
            errors.append(f"Phase {phase_number} has no task table")

        phase_tasks = tasks_by_phase.get(phase_number, [])
        if not phase_tasks:
            errors.append(f"Phase {phase_number} has no tasks")
            continue

        verification_text = "\n".join(task.verification for task in phase_tasks)
        all_task_text = "\n".join(
            f"{task.description}\n{task.verification}" for task in phase_tasks
        )
        expected_markers = {
            gate_marker(phase_number, index)
            for index in range(1, len(plan_phase.gate_criteria) + 1)
        }
        seen_markers: set[str] = set()
        for match in GATE_MARKER_RE.finditer(all_task_text):
            marker_phase = int(match.group(1))
            marker_number = int(match.group(2))
            normalized = gate_marker(marker_phase, marker_number)
            if marker_phase != phase_number:
                errors.append(
                    f"Phase {phase_number} task uses gate marker {match.group(0)} for Phase {marker_phase}"
                )
            elif normalized not in expected_markers:
                errors.append(
                    f"Phase {phase_number} task uses unknown gate marker {match.group(0)}"
                )
            seen_markers.add(normalized)

        for marker in sorted(expected_markers - seen_markers):
            criterion_number = int(marker.rsplit("G", 1)[1])
            criterion = plan_phase.gate_criteria[criterion_number - 1]
            errors.append(f"{marker} is not mapped to a task: {criterion}")
        gate_count += len(expected_markers)

        for requirement in plan_phase.requirements:
            if not re.search(rf"\b{re.escape(requirement)}\b", all_task_text):
                errors.append(
                    f"Phase {phase_number} requirement {requirement} is not referenced by a task"
                )
        requirement_count += len(plan_phase.requirements)

        for command in plan_phase.gate_commands:
            if f"`{command}`" not in verification_text:
                errors.append(
                    f"Phase {phase_number} gate command `{command}` is absent from Verification Criteria"
                )

    return gate_count, requirement_count


def validate_open_items(
    path: Path, tasks: list[Task], selected_phases: set[int], errors: list[str]
) -> None:
    """Validate issue references and structured phase open-item entries."""

    if not path.is_file():
        errors.append(f"open-items document does not exist: {path}")
        return

    lines = path.read_text(encoding="utf-8").splitlines()
    issue_starts: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = ISSUE_HEADING_RE.match(line)
        if match:
            issue_starts.append((index, int(match.group(1)), match.group(2)))

    issue_ids = [number for _, number, _ in issue_starts]
    if len(issue_ids) != len(set(issue_ids)):
        errors.append(f"{path} contains duplicate issue IDs")
    if issue_ids and issue_ids != list(range(1, max(issue_ids) + 1)):
        errors.append(f"{path} issue IDs must be sequential from ISSUE-001")

    existing_references = {f"ISSUE-{number:03d}" for number in issue_ids}
    for task in tasks:
        task_text = f"{task.description}\n{task.verification}"
        references = set(ISSUE_REFERENCE_RE.findall(task_text))
        for reference in references:
            normalized = f"ISSUE-{int(reference.partition('-')[2]):03d}"
            if normalized not in existing_references:
                errors.append(f"task {task.number} references missing open item {reference}")
        if PLACEHOLDER_RE.search(task_text) and not references:
            errors.append(
                f"task {task.number} contains an unresolved placeholder without an ISSUE reference"
            )

    for issue_index, (start, _, title) in enumerate(issue_starts):
        phase_match = re.search(r"\bPhase\s+0*(\d+)\b", title, re.IGNORECASE)
        if not phase_match or int(phase_match.group(1)) not in selected_phases:
            continue
        end = issue_starts[issue_index + 1][0] if issue_index + 1 < len(issue_starts) else len(lines)
        block = lines[start + 1 : end]
        type_line = next((line for line in block if line.startswith("Type:")), None)
        status_line = next((line for line in block if line.startswith("Status:")), None)
        if type_line is None or not type_line.partition(":")[2].strip():
            errors.append(f"phase open item at line {start + 1} has no Type value")
        if status_line is None:
            errors.append(f"phase open item at line {start + 1} has no Status value")
        else:
            status = status_line.partition(":")[2].strip()
            if status not in ALLOWED_ISSUE_STATUSES:
                errors.append(
                    f"phase open item at line {start + 1} has invalid Status {status!r}"
                )

        subsection_indices = [
            index for index, line in enumerate(block) if line.startswith("### ")
        ]
        for subsection_position, subsection_start in enumerate(subsection_indices):
            heading = block[subsection_start][4:].strip()
            if heading not in ALLOWED_OPEN_ITEM_HEADINGS:
                errors.append(
                    f"phase open item at line {start + subsection_start + 2} has unsupported heading {heading!r}"
                )
                continue
            subsection_end = (
                subsection_indices[subsection_position + 1]
                if subsection_position + 1 < len(subsection_indices)
                else len(block)
            )
            if not any(
                line.strip() for line in block[subsection_start + 1 : subsection_end]
            ):
                errors.append(
                    f"phase open-item heading {heading!r} at line {start + subsection_start + 2} is empty"
                )


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
    parser.add_argument("--plan", type=Path, help="phase plan path")
    parser.add_argument("--tasks", type=Path, help="task-list path")
    parser.add_argument("--open-items", type=Path, help="open-items path")
    parser.add_argument(
        "--phase",
        type=int,
        action="append",
        help="validate only this phase; repeat for multiple phases",
    )
    return parser.parse_args()


def main() -> int:
    """Run all planning checks and return a process exit status."""

    args = parse_args()
    repo_root = args.repo_root.resolve()
    plan_path = resolve_path(repo_root, args.plan, "docs/implementation/plan.md")
    task_path = resolve_path(repo_root, args.tasks, "docs/implementation/task-list.md")
    open_items_path = resolve_path(
        repo_root, args.open_items, "docs/implementation/issue-tracker.md"
    )

    errors: list[str] = []
    phases = parse_plan(plan_path, errors)
    tasks, phase_titles, phases_with_tables = parse_tasks(task_path, errors)
    validate_identifiers_and_dependencies(tasks, errors)
    validate_task_links(tasks, task_path, repo_root, errors)

    selected_phases = set(args.phase or phase_titles)
    if not selected_phases:
        errors.append(f"no phase sections found in {task_path}")
    for selected_phase in selected_phases:
        if selected_phase <= 0:
            errors.append(f"phase numbers must be positive: {selected_phase}")
        if selected_phase not in phase_titles:
            errors.append(f"selected Phase {selected_phase} is absent from {task_path}")

    gate_count, requirement_count = validate_phase_coverage(
        phases,
        tasks,
        phase_titles,
        phases_with_tables,
        selected_phases,
        errors,
    )
    validate_open_items(open_items_path, tasks, selected_phases, errors)

    if errors:
        print(f"Phase-plan validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Phase-plan validation passed: "
        f"{len(tasks)} task(s), {len(selected_phases)} phase(s), "
        f"{gate_count} gate criterion/criteria, {requirement_count} requirement reference(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
