#!/usr/bin/env python3
"""Run the Living Image compiler over a versioned validation manifest.

The suite runner deliberately treats the compiler as a subprocess. This keeps
model loading and download/offline policy in ``compiler.compile_character`` and
lets one broken input fail without aborting the remaining validation cases.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


OUTCOMES = ("full", "limited", "reject", "error")
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


class ValidationManifestError(ValueError):
    """The validation manifest is unsafe or does not match version 1."""


@dataclass(frozen=True)
class ValidationCase:
    id: str
    category: str
    source: str
    source_path: Path
    expected: str


@dataclass(frozen=True)
class CompilerResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


CompilerRunner = Callable[[Path, Path, Path, bool, bool], CompilerResult]


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationManifestError(f"{label} must be a non-empty string")
    return value


def load_manifest(manifest_path: Path) -> list[ValidationCase]:
    """Load and fully validate a suite before any compiler process is started."""

    manifest_path = manifest_path.resolve()
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationManifestError(f"could not read manifest: {error}") from error

    if not isinstance(document, dict):
        raise ValidationManifestError("manifest root must be an object")
    if document.get("version") != 1 or isinstance(document.get("version"), bool):
        raise ValidationManifestError("manifest version must be 1")
    raw_cases = document.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValidationManifestError("manifest cases must be a non-empty array")

    manifest_root = manifest_path.parent
    seen_ids: set[str] = set()
    cases: list[ValidationCase] = []
    for index, raw_case in enumerate(raw_cases):
        label = f"cases[{index}]"
        if not isinstance(raw_case, dict):
            raise ValidationManifestError(f"{label} must be an object")

        case_id = _require_string(raw_case.get("id"), f"{label}.id")
        if not _SAFE_ID.fullmatch(case_id):
            raise ValidationManifestError(
                f"{label}.id must match [A-Za-z0-9][A-Za-z0-9_-]{{0,127}}"
            )
        if case_id in seen_ids:
            raise ValidationManifestError(f"duplicate case id: {case_id}")
        seen_ids.add(case_id)

        category = _require_string(raw_case.get("category"), f"{label}.category")
        source = _require_string(raw_case.get("source"), f"{label}.source")
        source_value = Path(source)
        if source_value.is_absolute() or "\\" in source or ".." in source_value.parts:
            raise ValidationManifestError(
                f"{label}.source must be a relative path contained by the manifest directory"
            )
        source_path = (manifest_root / source_value).resolve()
        try:
            source_path.relative_to(manifest_root)
        except ValueError as error:
            raise ValidationManifestError(
                f"{label}.source resolves outside the manifest directory"
            ) from error
        if not source_path.is_file():
            raise ValidationManifestError(f"{label}.source is not a file: {source}")

        expected = _require_string(raw_case.get("expected"), f"{label}.expected")
        if expected not in OUTCOMES:
            raise ValidationManifestError(
                f"{label}.expected must be one of: {', '.join(OUTCOMES)}"
            )
        cases.append(ValidationCase(case_id, category, source, source_path, expected))
    return cases


def _run_compiler(
    source_path: Path,
    artifact_dir: Path,
    overlay_dir: Path,
    offline: bool,
    flip_test: bool,
) -> CompilerResult:
    command = [
        sys.executable,
        "-m",
        "compiler.compile_character",
        str(source_path),
        "--output-dir",
        str(artifact_dir),
        "--overlay-dir",
        str(overlay_dir),
    ]
    if offline:
        command.append("--offline")
    if flip_test:
        command.append("--flip-test")
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    return CompilerResult(completed.returncode, completed.stdout, completed.stderr)


def _error_message(result: CompilerResult) -> str:
    # Child stderr can contain tracebacks, virtualenv/cache paths, and other
    # machine-specific details. Keep the checked report deterministic; callers
    # can reproduce the failing case directly when full diagnostics are needed.
    return f"compiler exited with status {result.returncode}"


def _relative_artifact(path: Path, output_dir: Path) -> str:
    return path.resolve().relative_to(output_dir.resolve()).as_posix()


def _extract_quality(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("compiler artifact root is not an object")
    quality = document.get("quality", document)
    if not isinstance(quality, dict):
        raise ValueError("compiler artifact has no quality object")
    status = quality.get("status")
    if status not in OUTCOMES[:-1]:
        raise ValueError("compiler artifact has an invalid quality status")
    return quality


def _read_artifact(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read compiler artifact {path.name}: {error}") from error


def _clean_expected_outputs(source_path: Path, artifact_dir: Path, overlay_dir: Path) -> None:
    """Remove only files this case's compiler invocation can regenerate."""

    for path in (
        artifact_dir / f"{source_path.stem}.limg",
        artifact_dir / f"{source_path.stem}.diagnostic.json",
        overlay_dir / f"{source_path.stem}.png",
    ):
        if path.is_file():
            path.unlink()


def _prepare_output_directory(output_dir: Path, relative: Path) -> Path:
    """Create one case directory without following pre-existing symlinks."""

    current = output_dir
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise RuntimeError(f"validation output contains a symlink: {relative}")
    current.mkdir(parents=True, exist_ok=True)
    resolved = current.resolve()
    try:
        resolved.relative_to(output_dir)
    except ValueError as error:
        raise RuntimeError("validation output resolves outside the selected directory") from error
    if resolved != current:
        raise RuntimeError(f"validation output contains a symlink: {relative}")
    return current


def _case_result(
    case: ValidationCase,
    output_dir: Path,
    runner: CompilerRunner,
    offline: bool,
    flip_test: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": case.id,
        "category": case.category,
        "source": case.source,
        "expected": case.expected,
    }
    try:
        artifact_dir = _prepare_output_directory(
            output_dir, Path("artifacts") / case.id
        )
        overlay_dir = _prepare_output_directory(
            output_dir, Path("overlays") / case.id
        )
        _clean_expected_outputs(case.source_path, artifact_dir, overlay_dir)
        process = runner(case.source_path, artifact_dir, overlay_dir, offline, flip_test)
        limg_path = artifact_dir / f"{case.source_path.stem}.limg"
        diagnostic_path = artifact_dir / f"{case.source_path.stem}.diagnostic.json"

        if process.returncode not in (0, 2):
            raise RuntimeError(_error_message(process))
        artifact_path = limg_path if limg_path.is_file() else diagnostic_path
        if not artifact_path.is_file():
            raise RuntimeError("compiler did not produce a .limg or diagnostic artifact")
        document = _read_artifact(artifact_path)
        quality = _extract_quality(document)
        actual = quality["status"]
        expected_returncode = 2 if actual == "reject" else 0
        if process.returncode != expected_returncode:
            raise RuntimeError(
                f"compiler exit status {process.returncode} disagrees with {actual} artifact"
            )

        artifacts = {
            "limg" if artifact_path.suffix == ".limg" else "diagnostic":
                _relative_artifact(artifact_path, output_dir)
        }
        overlay_path = overlay_dir / f"{case.source_path.stem}.png"
        if overlay_path.is_file():
            artifacts["overlay"] = _relative_artifact(overlay_path, output_dir)
        result["result"] = actual
        result["artifacts"] = artifacts

        quality_report: dict[str, Any] = {}
        score = quality.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score):
            quality_report["score"] = score
        metrics = quality.get("metrics")
        if isinstance(metrics, dict):
            try:
                json.dumps(metrics, allow_nan=False)
            except (TypeError, ValueError):
                pass
            else:
                quality_report["metrics"] = metrics
        for field in ("warnings", "rejectionReasons"):
            messages = quality.get(field)
            if isinstance(messages, list) and all(isinstance(item, str) for item in messages):
                quality_report[field] = messages
        if quality_report:
            result["quality"] = quality_report
        disabled = quality.get("disabledCapabilities")
        if isinstance(disabled, list) and all(isinstance(item, str) for item in disabled):
            result["capabilities"] = {"disabled": sorted(set(disabled))}
    except Exception as error:  # Continue the suite after compiler and artifact failures.
        message = str(error) or error.__class__.__name__
        message = message.replace(str(case.source_path), case.source)
        message = message.replace(str(output_dir), ".")
        result["result"] = "error"
        result["message"] = message

    result["matched"] = result["result"] == case.expected
    return result


def _summary(results: Sequence[dict[str, Any]]) -> dict[str, Any]:
    outcomes = {outcome: 0 for outcome in OUTCOMES}
    expectations = {outcome: 0 for outcome in OUTCOMES}
    categories: dict[str, dict[str, Any]] = {}
    for result in results:
        outcomes[result["result"]] += 1
        expectations[result["expected"]] += 1
        category = categories.setdefault(
            result["category"],
            {"total": 0, "matched": 0, "outcomes": {outcome: 0 for outcome in OUTCOMES}},
        )
        category["total"] += 1
        category["matched"] += int(result["matched"])
        category["outcomes"][result["result"]] += 1
    matched = sum(int(result["matched"]) for result in results)
    return {
        "total": len(results),
        "matched": matched,
        "mismatched": len(results) - matched,
        **outcomes,
        "outcomes": outcomes,
        "expectations": expectations,
        "categories": categories,
    }


def validate_suite(
    manifest_path: Path,
    output_dir: Path,
    *,
    runner: CompilerRunner = _run_compiler,
    offline: bool = False,
    flip_test: bool = False,
) -> dict[str, Any]:
    """Validate every case and write ``report.json`` deterministically."""

    cases = load_manifest(manifest_path)
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results = [
        _case_result(case, output_dir, runner, offline, flip_test)
        for case in cases
    ]
    report = {
        "version": 1,
        "generatedAt": "reproducible-validation-does-not-store-wall-clock",
        "summary": _summary(results),
        "cases": results,
    }
    report_path = output_dir / "report.json"
    report_path.write_text(
        json.dumps(
            report,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        ) + "\n",
        encoding="utf-8",
    )
    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="version 1 validation manifest")
    parser.add_argument("--output-dir", type=Path, default=Path("validation-output"))
    parser.add_argument("--offline", action="store_true", help="pass --offline to the compiler")
    parser.add_argument("--flip-test", action="store_true", help="pass --flip-test to the compiler")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = validate_suite(
            args.manifest,
            args.output_dir,
            offline=args.offline,
            flip_test=args.flip_test,
        )
    except ValidationManifestError as error:
        print(f"validation manifest error: {error}", file=sys.stderr)
        return 2
    report_path = args.output_dir.resolve() / "report.json"
    summary = report["summary"]
    print(
        f"{report_path}: {summary['matched']}/{summary['total']} expected outcomes matched"
    )
    return 0 if summary["mismatched"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
