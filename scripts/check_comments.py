#!/usr/bin/env python3
"""Check comment length in supported handwritten source files."""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_EXTENSIONS = (".go", ".ts", ".svelte")
IGNORED_DIRECTORY_NAMES = frozenset(
    {
        ".bun-install",
        ".cache",
        ".bun-tmp",
        ".git",
        ".go-cache",
        ".go-mod-cache",
        ".svelte-kit",
        ".vite",
        ".venv",
        "__pycache__",
        "coverage",
        "dist",
        "node_modules",
        "package",
        "playwright-report",
        "test-results",
    }
)
IGNORED_DIRECTORY_PREFIXES = (".go-mod-cache-",)
IGNORED_REPOSITORY_PATHS = (
    Path("backend/internal/transport/suggestions.gen.go"),
    Path("frontend/src/client"),
)
IGNORED_FILE_SUFFIXES = (".gen.go",)


@dataclass(frozen=True)
class ParsedComment:
    """One syntax comment with an absolute source range."""

    start_byte: int
    end_byte: int
    start_line: int
    finish_line: int
    content_lines: int
    is_line_comment: bool


class ParserFailure(Exception):
    """A source file cannot be parsed with its configured grammar."""


def positive_integer(value: str) -> int:
    """Parse a positive command-line integer."""

    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse and validate the command-line interface."""

    parser = argparse.ArgumentParser(
        description="Check normalized source-comment line counts."
    )
    parser.add_argument("directory", type=Path, help="directory to scan")
    parser.add_argument(
        "--extension",
        required=True,
        choices=SUPPORTED_EXTENSIONS,
        help="source extension to scan",
    )
    parser.add_argument(
        "--max-comment-lines",
        required=True,
        type=positive_integer,
        help="maximum normalized content lines per comment",
    )
    args = parser.parse_args(argv)
    if not args.directory.is_dir():
        parser.error(f"directory does not exist or is not a directory: {args.directory}")
    return args


def is_ignored(path: Path) -> bool:
    """Return whether a repository path is generated or tool output."""

    if any(part in IGNORED_DIRECTORY_NAMES for part in path.parts):
        return True
    if any(
        part.startswith(prefix)
        for part in path.parts
        for prefix in IGNORED_DIRECTORY_PREFIXES
    ):
        return True
    if path.name.endswith(IGNORED_FILE_SUFFIXES):
        return True

    absolute_path = Path(os.path.abspath(path))
    try:
        repository_path = absolute_path.relative_to(REPO_ROOT)
    except ValueError:
        return False
    return any(
        repository_path == ignored_path or ignored_path in repository_path.parents
        for ignored_path in IGNORED_REPOSITORY_PATHS
    )


def source_files(directory: Path, extension: str) -> tuple[list[Path], list[OSError]]:
    """Return every matching nonignored file in deterministic order."""

    files: list[Path] = []
    errors: list[OSError] = []

    def record_error(error: OSError) -> None:
        errors.append(error)

    for root_text, directory_names, file_names in os.walk(
        directory, topdown=True, onerror=record_error, followlinks=False
    ):
        root = Path(root_text)
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not is_ignored(root / name)
        )
        for name in sorted(file_names):
            path = root / name
            if name.endswith(extension) and not is_ignored(path):
                files.append(path)
    files.sort(key=lambda path: path.as_posix())
    return files, errors


def load_parsers(extension: str) -> dict[str, Any]:
    """Load only the pinned tree-sitter grammars needed for one scan."""

    try:
        from tree_sitter import Language, Parser

        if extension == ".go":
            import tree_sitter_go

            return {"primary": Parser(Language(tree_sitter_go.language()))}
        if extension == ".ts":
            import tree_sitter_typescript

            return {
                "primary": Parser(
                    Language(tree_sitter_typescript.language_typescript())
                )
            }

        import tree_sitter_css
        import tree_sitter_svelte
        import tree_sitter_typescript

        return {
            "primary": Parser(Language(tree_sitter_svelte.language())),
            "typescript": Parser(
                Language(tree_sitter_typescript.language_typescript())
            ),
            "css": Parser(Language(tree_sitter_css.language())),
        }
    except ImportError as error:
        raise ParserFailure(
            "pinned parser packages are not installed; run `uv sync --locked` "
            "and invoke the checker with `uv run python`"
        ) from error


def walk_nodes(root: Any) -> Iterator[Any]:
    """Yield all syntax nodes in source order."""

    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


def normalized_content_line_count(raw_comment: bytes) -> int:
    """Count nonempty content lines after comment decoration is removed."""

    if raw_comment.startswith(b"//"):
        body = raw_comment[2:]
        block_comment = False
    elif raw_comment.startswith(b"<!--") and raw_comment.endswith(b"-->"):
        body = raw_comment[4:-3]
        block_comment = True
    elif raw_comment.startswith(b"/*") and raw_comment.endswith(b"*/"):
        body = raw_comment[2:-2]
        block_comment = True
    else:
        raise ParserFailure("parser returned an unrecognized comment form")

    count = 0
    for line in body.splitlines() or [body]:
        content = line.strip()
        if block_comment and content.startswith(b"*"):
            content = content[1:].lstrip()
        if content:
            count += 1
    return count


def comment_from_node(
    node: Any, source: bytes, *, byte_offset: int = 0, row_offset: int = 0
) -> ParsedComment:
    """Convert one tree-sitter comment node to an absolute source range."""

    raw_comment = source[node.start_byte : node.end_byte]
    return ParsedComment(
        start_byte=byte_offset + node.start_byte,
        end_byte=byte_offset + node.end_byte,
        start_line=row_offset + node.start_point.row + 1,
        finish_line=row_offset + node.end_point.row + 1,
        content_lines=normalized_content_line_count(raw_comment),
        is_line_comment=raw_comment.startswith(b"//"),
    )


def comments_from_tree(
    root: Any, source: bytes, *, byte_offset: int = 0, row_offset: int = 0
) -> list[ParsedComment]:
    """Extract comment nodes from one parsed syntax tree."""

    return [
        comment_from_node(
            node, source, byte_offset=byte_offset, row_offset=row_offset
        )
        for node in walk_nodes(root)
        if node.type == "comment"
    ]


def parse_embedded_comments(
    parser: Any,
    container: Any,
    source: bytes,
    *,
    require_valid_syntax: bool,
    grammar_name: str,
) -> list[ParsedComment]:
    """Parse comments from one Svelte script, style, or expression node."""

    embedded_source = source[container.start_byte : container.end_byte]
    tree = parser.parse(embedded_source)
    if require_valid_syntax and tree.root_node.has_error:
        raise ParserFailure(f"invalid {grammar_name} syntax in Svelte content")
    return comments_from_tree(
        tree.root_node,
        embedded_source,
        byte_offset=container.start_byte,
        row_offset=container.start_point.row,
    )


def parse_svelte_comments(source: bytes, parsers: dict[str, Any]) -> list[ParsedComment]:
    """Parse markup and embedded-language comments from one Svelte file."""

    tree = parsers["primary"].parse(source)
    if tree.root_node.has_error:
        raise ParserFailure("invalid Svelte syntax")

    comments = comments_from_tree(tree.root_node, source)
    for node in walk_nodes(tree.root_node):
        if node.type == "raw_text" and node.parent is not None:
            if node.parent.type == "script_element":
                comments.extend(
                    parse_embedded_comments(
                        parsers["typescript"],
                        node,
                        source,
                        require_valid_syntax=True,
                        grammar_name="TypeScript",
                    )
                )
            elif node.parent.type == "style_element":
                comments.extend(
                    parse_embedded_comments(
                        parsers["css"],
                        node,
                        source,
                        require_valid_syntax=True,
                        grammar_name="CSS",
                    )
                )
        elif node.type == "svelte_raw_text":
            comments.extend(
                parse_embedded_comments(
                    parsers["typescript"],
                    node,
                    source,
                    require_valid_syntax=False,
                    grammar_name="TypeScript expression",
                )
            )
    return sorted(comments, key=lambda comment: comment.start_byte)


def parse_comments(
    source: bytes, extension: str, parsers: dict[str, Any]
) -> list[ParsedComment]:
    """Parse all comments from one supported source file."""

    if extension == ".svelte":
        return parse_svelte_comments(source, parsers)

    tree = parsers["primary"].parse(source)
    if tree.root_node.has_error:
        raise ParserFailure(f"invalid {extension} syntax")
    return comments_from_tree(tree.root_node, source)


def violating_comment_ranges(
    comments: list[ParsedComment], source: bytes, maximum: int
) -> list[tuple[int, int, int]]:
    """Return ranges and counts for comments over the configured maximum."""

    violations: list[tuple[int, int, int]] = []
    index = 0
    while index < len(comments):
        first = comments[index]
        last = first
        observed = first.content_lines
        index += 1

        while index < len(comments):
            following = comments[index]
            gap = source[last.end_byte : following.start_byte]
            if not (
                last.is_line_comment
                and following.is_line_comment
                and following.start_line == last.finish_line + 1
                and not gap.strip()
            ):
                break
            last = following
            observed += following.content_lines
            index += 1

        if observed > maximum:
            violations.append((first.start_line, last.finish_line, observed))
    return violations


def display_path(path: Path) -> str:
    """Return a stable POSIX path relative to the current directory."""

    return Path(os.path.relpath(path, Path.cwd())).as_posix()


def check_file(
    path: Path, extension: str, maximum: int, parsers: dict[str, Any]
) -> list[str]:
    """Return every formatted policy violation in one source file."""

    source = path.read_bytes()
    try:
        source.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ParserFailure("source is not valid UTF-8") from error

    comments = parse_comments(source, extension, parsers)
    shown_path = display_path(path)
    return [
        f"{shown_path}:{start}:{finish}: "
        f"observed {observed} comment lines; allowed {maximum}"
        for start, finish, observed in violating_comment_ranges(
            comments, source, maximum
        )
    ]


def main(argv: list[str] | None = None) -> int:
    """Scan the requested directory and return the policy status."""

    args = parse_args(argv)
    try:
        parsers = load_parsers(args.extension)
    except ParserFailure as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    files, walk_errors = source_files(args.directory, args.extension)
    had_error = False
    for error in walk_errors:
        print(f"error: {error.filename}: {error.strerror}", file=sys.stderr)
        had_error = True

    violations: list[str] = []
    for path in files:
        try:
            violations.extend(
                check_file(path, args.extension, args.max_comment_lines, parsers)
            )
        except OSError as error:
            print(f"error: {display_path(path)}: {error}", file=sys.stderr)
            had_error = True
        except ParserFailure as error:
            print(f"error: {display_path(path)}: {error}", file=sys.stderr)
            had_error = True

    for violation in violations:
        print(violation)
    if had_error:
        return 2
    if violations:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
