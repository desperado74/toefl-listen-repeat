from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BANK_PATH = ROOT / "data" / "reading" / "reading_bank.json"
EXPECTED_SECTION_TYPES = {"complete_words", "daily_life", "academic_passage"}


def main() -> None:
    bank = _load_bank()
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()

    sets = bank.get("sets")
    if not isinstance(sets, list) or not sets:
        errors.append("Top-level 'sets' must be a non-empty list.")
        sets = []

    source_policy = bank.get("sourcePolicy")
    if not isinstance(source_policy, str) or not source_policy.strip():
        warnings.append("Top-level 'sourcePolicy' is missing or empty.")

    total_questions = 0
    for set_index, reading_set in enumerate(sets, start=1):
        set_label = _label(reading_set, f"set[{set_index}]")
        _require_id(reading_set, set_label, seen_ids, errors)
        _require_text(reading_set, "title", set_label, errors)
        _require_text(reading_set, "descriptionZh", set_label, errors)

        sections = reading_set.get("sections")
        if not isinstance(sections, list) or not sections:
            errors.append(f"{set_label}: sections must be a non-empty list.")
            continue

        section_types = {section.get("type") for section in sections if isinstance(section, dict)}
        missing_types = EXPECTED_SECTION_TYPES - section_types
        if missing_types:
            errors.append(f"{set_label}: missing section type(s): {', '.join(sorted(missing_types))}.")

        for section_index, section in enumerate(sections, start=1):
            section_label = _label(section, f"{set_label}.section[{section_index}]")
            _require_id(section, section_label, seen_ids, errors)
            section_type = section.get("type")
            if section_type not in EXPECTED_SECTION_TYPES:
                errors.append(f"{section_label}: unknown section type {section_type!r}.")
            _require_text(section, "title", section_label, errors)
            _require_text(section, "instructionsZh", section_label, errors)
            _require_text(section, "passage", section_label, errors)

            if section_type == "complete_words":
                blanks = section.get("blanks")
                if not isinstance(blanks, list) or not blanks:
                    errors.append(f"{section_label}: complete_words sections must contain non-empty blanks.")
                    continue
                if len(blanks) != 10:
                    warnings.append(f"{section_label}: expected 10 blanks for Complete the Words, found {len(blanks)}.")
                total_questions += len(blanks)
                _validate_complete_word_template(section, section_label, blanks, errors)
                for blank_index, blank in enumerate(blanks, start=1):
                    blank_label = _label(blank, f"{section_label}.blank[{blank_index}]")
                    _validate_blank(blank, blank_label, seen_ids, errors, warnings)
                continue

            questions = section.get("questions")
            if not isinstance(questions, list) or not questions:
                errors.append(f"{section_label}: questions must be a non-empty list.")
                continue
            if section_type == "daily_life" and len(questions) > 3:
                errors.append(f"{section_label}: daily_life sections must have no more than 3 questions.")

            total_questions += len(questions)
            for question_index, question in enumerate(questions, start=1):
                question_label = _label(question, f"{section_label}.question[{question_index}]")
                _validate_question(question, question_label, seen_ids, errors, warnings)

    if errors:
        print(f"Reading bank validation failed for {BANK_PATH}:")
        for error in errors:
            print(f"- ERROR: {error}")
        for warning in warnings:
            print(f"- WARNING: {warning}")
        raise SystemExit(1)

    print(
        "Reading bank validation OK: "
        f"{len(sets)} sets, {total_questions} questions, {len(warnings)} warning(s)."
    )
    for warning in warnings:
        print(f"- WARNING: {warning}")


def _load_bank() -> dict[str, Any]:
    try:
        data = json.loads(BANK_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"Reading bank not found: {BANK_PATH}") from None
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Reading bank JSON is invalid: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("Reading bank root must be an object.")
    return data


def _validate_question(
    question: dict[str, Any],
    label: str,
    seen_ids: set[str],
    errors: list[str],
    warnings: list[str],
) -> None:
    _require_id(question, label, seen_ids, errors)
    for field in ("type", "prompt", "explanationZh", "evidence"):
        _require_text(question, field, label, errors)

    options = question.get("options")
    if not isinstance(options, list) or len(options) < 2:
        errors.append(f"{label}: options must contain at least two choices.")
    elif any(not isinstance(option, str) or not option.strip() for option in options):
        errors.append(f"{label}: every option must be non-empty text.")

    answer = question.get("answer")
    if not isinstance(answer, int) or isinstance(answer, bool):
        errors.append(f"{label}: answer must be an integer option index.")
    elif isinstance(options, list) and not 0 <= answer < len(options):
        errors.append(f"{label}: answer index {answer} is outside options length {len(options)}.")

    for field in ("skillTags", "errorTags"):
        tags = question.get(field)
        if not isinstance(tags, list) or not tags:
            errors.append(f"{label}: {field} must be a non-empty list.")
        elif any(not isinstance(tag, str) or not tag.strip() for tag in tags):
            errors.append(f"{label}: {field} contains an empty or non-text tag.")

    if len(str(question.get("explanationZh", "")).strip()) < 12:
        warnings.append(f"{label}: explanationZh is very short.")
    if len(str(question.get("evidence", "")).strip()) < 5:
        warnings.append(f"{label}: evidence is very short.")


def _validate_blank(
    blank: dict[str, Any],
    label: str,
    seen_ids: set[str],
    errors: list[str],
    warnings: list[str],
) -> None:
    _require_id(blank, label, seen_ids, errors)
    for field in ("prefix", "answer", "fullWord", "explanationZh", "evidence"):
        _require_text(blank, field, label, errors)

    prefix = str(blank.get("prefix", ""))
    answer = str(blank.get("answer", ""))
    full_word = str(blank.get("fullWord", ""))
    if prefix and answer and full_word and f"{prefix}{answer}".lower() != full_word.lower():
        errors.append(f"{label}: prefix + answer must equal fullWord.")

    for field in ("skillTags", "errorTags"):
        tags = blank.get(field)
        if not isinstance(tags, list) or not tags:
            errors.append(f"{label}: {field} must be a non-empty list.")
        elif any(not isinstance(tag, str) or not tag.strip() for tag in tags):
            errors.append(f"{label}: {field} contains an empty or non-text tag.")

    if len(answer) < 2:
        warnings.append(f"{label}: answer suffix is very short.")


def _validate_complete_word_template(
    section: dict[str, Any],
    label: str,
    blanks: list[Any],
    errors: list[str],
) -> None:
    passage = section.get("passage")
    if not isinstance(passage, str):
        return
    for blank in blanks:
        if not isinstance(blank, dict):
            continue
        blank_id = blank.get("id")
        if isinstance(blank_id, str) and f"{{{{{blank_id}}}}}" not in passage:
            errors.append(f"{label}: passage is missing template marker for {blank_id!r}.")


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


if __name__ == "__main__":
    main()
