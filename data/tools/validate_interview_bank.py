from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BANK_PATH = ROOT / "data" / "interview" / "interview_bank.json"
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?")
VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def main() -> None:
    bank = _load_bank()
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    prompt_counter: Counter[str] = Counter()

    sets = bank.get("sets")
    if not isinstance(sets, list) or not sets:
        errors.append("Top-level 'sets' must be a non-empty list.")
        sets = []

    if not isinstance(bank.get("sourcePolicy"), str) or not bank["sourcePolicy"].strip():
        warnings.append("Top-level sourcePolicy is missing or empty.")

    for set_index, interview_set in enumerate(sets, start=1):
        label = _label(interview_set, f"set[{set_index}]")
        _require_id(interview_set, label, seen_ids, errors)
        for field in ("title", "theme", "descriptionZh"):
            _require_text(interview_set, field, label, errors)

        if interview_set.get("difficulty") not in VALID_DIFFICULTIES:
            errors.append(f"{label}: difficulty must be one of {sorted(VALID_DIFFICULTIES)}.")
        if interview_set.get("answerSeconds") != 45:
            errors.append(f"{label}: answerSeconds must be exactly 45.")

        questions = interview_set.get("questions")
        if not isinstance(questions, list) or len(questions) != 4:
            errors.append(f"{label}: each Interview set must contain exactly 4 questions.")
            questions = questions if isinstance(questions, list) else []

        orders = [question.get("order") for question in questions if isinstance(question, dict)]
        if orders != [1, 2, 3, 4]:
            errors.append(f"{label}: question order must be [1, 2, 3, 4].")

        for question_index, question in enumerate(questions, start=1):
            question_label = _label(question, f"{label}.question[{question_index}]")
            _require_id(question, question_label, seen_ids, errors)
            for field in ("interviewerText", "focus", "reviewHintZh"):
                _require_text(question, field, question_label, errors)
            prompt = str(question.get("interviewerText", "")).strip()
            if prompt:
                prompt_counter[_normalize_prompt(prompt)] += 1
                words = len(WORD_RE.findall(prompt))
                if words < 14 or words > 34:
                    warnings.append(
                        f"{question_label}: interviewerText has {words} words; target is roughly 10-15 seconds."
                    )
                if len(prompt) > 240:
                    errors.append(f"{question_label}: interviewerText must stay under 240 characters for TTS API.")

    duplicates = [prompt for prompt, count in prompt_counter.items() if count > 1]
    if duplicates:
        errors.append(f"Found duplicate interviewer prompts: {duplicates[:5]}")

    if errors:
        print(f"Interview bank validation failed for {BANK_PATH}:")
        for error in errors:
            print(f"- ERROR: {error}")
        for warning in warnings:
            print(f"- WARNING: {warning}")
        raise SystemExit(1)

    print(
        "Interview bank validation OK: "
        f"{len(sets)} sets, {sum(len(item.get('questions', [])) for item in sets)} questions, "
        f"{len(warnings)} warning(s)."
    )
    for warning in warnings:
        print(f"- WARNING: {warning}")


def _load_bank() -> dict[str, Any]:
    try:
        data = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Interview bank not found: {BANK_PATH}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Interview bank JSON is invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("Interview bank root must be an object.")
    return data


def _require_id(item: dict[str, Any], label: str, seen_ids: set[str], errors: list[str]) -> None:
    item_id = item.get("id")
    if not isinstance(item_id, str) or not item_id.strip():
        errors.append(f"{label}: id is required.")
        return
    if item_id in seen_ids:
        errors.append(f"{label}: duplicate id {item_id!r}.")
    seen_ids.add(item_id)


def _require_text(item: dict[str, Any], field: str, label: str, errors: list[str]) -> None:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{label}: {field} is required.")


def _label(item: Any, fallback: str) -> str:
    if isinstance(item, dict):
        item_id = item.get("id")
        if isinstance(item_id, str) and item_id.strip():
            return item_id
    return fallback


def _normalize_prompt(text: str) -> str:
    return " ".join(text.lower().split())


if __name__ == "__main__":
    main()
