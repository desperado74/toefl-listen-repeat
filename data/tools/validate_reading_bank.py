from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BANK_PATH = ROOT / "data" / "reading" / "reading_bank.json"
EXPECTED_SECTION_TYPES = {"complete_words", "daily_life", "academic_passage"}
EXPECTED_SOURCE_POLICY = "original_toefl_style_no_official_items"
ADAPTIVE_ITEM_TOTAL = 50
ADAPTIVE_COMPLETE_WORDS_TOTAL = 30


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
    elif source_policy != EXPECTED_SOURCE_POLICY:
        errors.append(f"Top-level sourcePolicy must be {EXPECTED_SOURCE_POLICY!r}.")

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

        total_questions += _validate_sections(sections, set_label, seen_ids, errors, warnings, strict_official_lengths=False)

    adaptive_summary = _validate_adaptive_bank(bank, seen_ids, errors, warnings)

    if errors:
        print(f"Reading bank validation failed for {BANK_PATH}:")
        for error in errors:
            print(f"- ERROR: {error}")
        for warning in warnings:
            print(f"- WARNING: {warning}")
        raise SystemExit(1)

    print(
        "Reading bank validation OK: "
        f"{len(sets)} sets, {total_questions} short-practice questions, "
        f"{adaptive_summary['modules']} adaptive modules, {adaptive_summary['sessions']} adaptive session(s), "
        f"{len(warnings)} warning(s)."
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


def _validate_adaptive_bank(
    bank: dict[str, Any],
    seen_ids: set[str],
    errors: list[str],
    warnings: list[str],
) -> dict[str, int]:
    modules = bank.get("adaptiveModules", [])
    sessions = bank.get("adaptiveSessions", [])
    if not isinstance(modules, list) or not modules:
        errors.append("Top-level 'adaptiveModules' must be a non-empty list.")
        modules = []
    if not isinstance(sessions, list) or not sessions:
        errors.append("Top-level 'adaptiveSessions' must be a non-empty list.")
        sessions = []

    module_by_id: dict[str, dict[str, Any]] = {}
    for module_index, module in enumerate(modules, start=1):
        module_label = _label(module, f"adaptiveModules[{module_index}]")
        _require_id(module, module_label, seen_ids, errors)
        _require_text(module, "title", module_label, errors)
        _require_policy(module, module_label, errors)
        stage = module.get("stage")
        path = module.get("path")
        if stage not in {"router", "second"}:
            errors.append(f"{module_label}: stage must be 'router' or 'second'.")
        if path not in {"router", "lower", "upper"}:
            errors.append(f"{module_label}: path must be 'router', 'lower', or 'upper'.")
        if stage == "router" and path != "router":
            errors.append(f"{module_label}: router modules must use path 'router'.")
        if stage == "second" and path not in {"lower", "upper"}:
            errors.append(f"{module_label}: second modules must use lower/upper path.")
        sections = module.get("sections")
        if not isinstance(sections, list) or not sections:
            errors.append(f"{module_label}: sections must be a non-empty list.")
            continue
        _validate_sections(sections, module_label, seen_ids, errors, warnings, strict_official_lengths=True)
        module_by_id[str(module.get("id"))] = module

    for session_index, session in enumerate(sessions, start=1):
        session_label = _label(session, f"adaptiveSessions[{session_index}]")
        _require_id(session, session_label, seen_ids, errors)
        _require_text(session, "title", session_label, errors)
        _require_policy(session, session_label, errors)
        router = module_by_id.get(str(session.get("routerModuleId", "")))
        lower = module_by_id.get(str(session.get("lowerModuleId", "")))
        upper = module_by_id.get(str(session.get("upperModuleId", "")))
        if router is None or lower is None or upper is None:
            errors.append(f"{session_label}: routerModuleId, lowerModuleId, and upperModuleId must reference adaptive modules.")
            continue
        if router.get("path") != "router" or lower.get("path") != "lower" or upper.get("path") != "upper":
            errors.append(f"{session_label}: referenced modules must be router/lower/upper respectively.")
        _validate_adaptive_combo(session_label, router, lower, errors)
        _validate_adaptive_combo(session_label, router, upper, errors)
    return {"modules": len(modules), "sessions": len(sessions)}


def _validate_adaptive_combo(
    session_label: str,
    router: dict[str, Any],
    second: dict[str, Any],
    errors: list[str],
) -> None:
    router_ids = _question_ids(router)
    second_ids = _question_ids(second)
    overlap = router_ids & second_ids
    if overlap:
        errors.append(f"{session_label}: router and {second.get('path')} module share item IDs: {', '.join(sorted(overlap)[:5])}.")
    counts = _section_counts(router)
    second_counts = _section_counts(second)
    for key, value in second_counts.items():
        counts[key] = counts.get(key, 0) + value
    total = sum(counts.values())
    if total != ADAPTIVE_ITEM_TOTAL:
        errors.append(f"{session_label}: router + {second.get('path')} must total {ADAPTIVE_ITEM_TOTAL} items, found {total}.")
    if counts.get("complete_words", 0) != ADAPTIVE_COMPLETE_WORDS_TOTAL:
        errors.append(f"{session_label}: router + {second.get('path')} must contain {ADAPTIVE_COMPLETE_WORDS_TOTAL} Complete the Words items.")
    for section_type in ("daily_life", "academic_passage"):
        value = counts.get(section_type, 0)
        if not 5 <= value <= 15:
            errors.append(f"{session_label}: router + {second.get('path')} has {value} {section_type} items; expected 5-15.")


def _validate_sections(
    sections: list[Any],
    parent_label: str,
    seen_ids: set[str],
    errors: list[str],
    warnings: list[str],
    *,
    strict_official_lengths: bool,
) -> int:
    total_questions = 0
    for section_index, section in enumerate(sections, start=1):
        section_label = _label(section, f"{parent_label}.section[{section_index}]")
        if not isinstance(section, dict):
            errors.append(f"{section_label}: section must be an object.")
            continue
        _require_id(section, section_label, seen_ids, errors)
        _require_policy(section, section_label, errors)
        section_type = section.get("type")
        if section_type not in EXPECTED_SECTION_TYPES:
            errors.append(f"{section_label}: unknown section type {section_type!r}.")
        _require_text(section, "title", section_label, errors)
        _require_text(section, "instructionsZh", section_label, errors)
        _require_text(section, "passage", section_label, errors)

        passage_word_count = _word_count(str(section.get("passage", "")))
        if strict_official_lengths and section_type == "daily_life" and not 15 <= passage_word_count <= 150:
            errors.append(f"{section_label}: daily_life passage has {passage_word_count} words; expected 15-150.")
        if strict_official_lengths and section_type == "academic_passage" and not 180 <= passage_word_count <= 220:
            errors.append(f"{section_label}: academic_passage has {passage_word_count} words; expected 180-220.")

        if section_type == "complete_words":
            blanks = section.get("blanks")
            if not isinstance(blanks, list) or not blanks:
                errors.append(f"{section_label}: complete_words sections must contain non-empty blanks.")
                continue
            if len(blanks) != 10:
                errors.append(f"{section_label}: Complete the Words tasks must have exactly 10 blanks, found {len(blanks)}.")
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
        if section_type == "academic_passage" and len(questions) > 5:
            errors.append(f"{section_label}: academic_passage sections must have no more than 5 questions.")

        total_questions += len(questions)
        for question_index, question in enumerate(questions, start=1):
            question_label = _label(question, f"{section_label}.question[{question_index}]")
            _validate_question(question, question_label, seen_ids, errors, warnings)
    return total_questions


def _validate_question(
    question: dict[str, Any],
    label: str,
    seen_ids: set[str],
    errors: list[str],
    warnings: list[str],
) -> None:
    _require_id(question, label, seen_ids, errors)
    _require_policy(question, label, errors)
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
    _require_policy(blank, label, errors)
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


def _require_policy(item: dict[str, Any], label: str, errors: list[str]) -> None:
    policy = item.get("sourcePolicy")
    if policy != EXPECTED_SOURCE_POLICY:
        errors.append(f"{label}: sourcePolicy must be {EXPECTED_SOURCE_POLICY!r}.")
    source = str(item.get("source", "")).lower()
    if "official" in source or "copied" in source:
        errors.append(f"{label}: official/copied source markers are not allowed in public bank.")


def _word_count(text: str) -> int:
    return len([part for part in text.replace("{{", " ").replace("}}", " ").split() if any(ch.isalpha() for ch in part)])


def _section_counts(module: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for section in module.get("sections", []):
        section_type = str(section.get("type", ""))
        if section_type == "complete_words":
            counts[section_type] = counts.get(section_type, 0) + len(section.get("blanks", []))
        else:
            counts[section_type] = counts.get(section_type, 0) + len(section.get("questions", []))
    return counts


def _question_ids(module: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for section in module.get("sections", []):
        if section.get("type") == "complete_words":
            ids.update(str(blank.get("id")) for blank in section.get("blanks", []))
        else:
            ids.update(str(question.get("id")) for question in section.get("questions", []))
    return ids


def _label(item: Any, fallback: str) -> str:
    if isinstance(item, dict):
        item_id = item.get("id")
        if isinstance(item_id, str) and item_id.strip():
            return item_id
    return fallback


if __name__ == "__main__":
    main()
