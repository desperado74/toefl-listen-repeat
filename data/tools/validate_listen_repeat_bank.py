from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SCENARIO_PATH = ROOT / "data" / "scenarios" / "listen_repeat.json"
REPORT_PATH = ROOT / "data" / "reports" / "listen_repeat_bank_report.json"
EXPECTED_LEVELS = {"easy": 45, "medium": 90, "hard": 45}
SYLLABLE_TARGETS = {
    1: ("easy", 9, 11),
    2: ("easy", 9, 11),
    3: ("medium", 14, 16),
    4: ("medium", 14, 16),
    5: ("medium", 14, 16),
    6: ("hard", 19, 23),
    7: ("hard", 19, 23),
}
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?")
SYLLABLE_EXCEPTIONS = {
    "a": 1,
    "the": 1,
    "your": 1,
    "our": 1,
    "you": 1,
    "are": 1,
    "campus": 2,
    "advising": 3,
    "library": 2,
    "housing": 2,
    "career": 2,
    "transit": 2,
    "finance": 2,
    "global": 2,
    "research": 2,
    "service": 2,
    "safety": 2,
    "dining": 2,
    "office": 2,
    "kiosk": 2,
    "session": 2,
    "ticket": 2,
    "event": 2,
    "request": 2,
    "application": 4,
    "student": 2,
    "email": 2,
    "reminder": 3,
    "unclear": 2,
    "confirm": 2,
    "number": 2,
    "busy": 2,
    "hallway": 2,
    "until": 2,
    "before": 2,
    "deadline": 2,
    "planner": 2,
    "changes": 2,
    "update": 2,
    "tomorrow's": 3,
    "easier": 3,
}


def count_word_syllables(word: str) -> int:
    cleaned = re.sub(r"[^a-z']", "", word.lower())
    if not cleaned:
        return 0
    if cleaned in SYLLABLE_EXCEPTIONS:
        return SYLLABLE_EXCEPTIONS[cleaned]
    if cleaned.endswith("'s"):
        cleaned = cleaned[:-2]
    groups = re.findall(r"[aeiouy]+", cleaned)
    count = len(groups)
    if cleaned.endswith("e") and not cleaned.endswith(("le", "ue")) and count > 1:
        count -= 1
    if cleaned.endswith("ed") and count > 1 and not cleaned.endswith(("ted", "ded")):
        count -= 1
    return max(count, 1)


def estimate_syllables(text: str) -> int:
    return sum(count_word_syllables(word) for word in WORD_RE.findall(text))


def word_count(text: str) -> int:
    return len(WORD_RE.findall(text))


def load_bank() -> dict[str, Any]:
    return json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))


def validate_bank(bank: dict[str, Any]) -> dict[str, Any]:
    scenarios = bank.get("scenarios", [])
    sentence_counts = [len(item.get("sentences", [])) for item in scenarios]
    level_counts = Counter(item.get("level", "unknown") for item in scenarios)
    topic_counts = Counter(item.get("topic", "unknown") for item in scenarios)
    source_counts = Counter(item.get("sourceType", "unknown") for item in scenarios)

    sentence_texts: Counter[str] = Counter()
    sentence_locations: defaultdict[str, list[str]] = defaultdict(list)
    scenario_ids: Counter[str] = Counter()
    syllable_distribution: defaultdict[str, list[int]] = defaultdict(list)
    word_count_distribution: defaultdict[str, list[int]] = defaultdict(list)
    syllable_errors: list[str] = []
    metadata_errors: list[str] = []
    word_count_warnings: list[str] = []
    order_errors: list[str] = []

    for scenario in scenarios:
        scenario_id = scenario.get("id", "")
        scenario_ids[scenario_id] += 1
        previous_order = 0
        previous_syllables = 0
        for sentence in scenario.get("sentences", []):
            text = str(sentence.get("text", "")).strip()
            sentence_texts[text] += 1
            sentence_locations[text].append(str(sentence.get("id", "")))
            order = int(sentence.get("order", 0))
            if order <= previous_order:
                order_errors.append(f"{scenario_id}: sentence order {order} is not strictly increasing.")
            previous_order = order
            if order in SYLLABLE_TARGETS:
                expected_stage, low, high = SYLLABLE_TARGETS[order]
                estimated = estimate_syllables(text)
                words = word_count(text)
                syllable_distribution[expected_stage].append(estimated)
                word_count_distribution[expected_stage].append(words)
                if not (low <= estimated <= high):
                    syllable_errors.append(
                        f"{sentence.get('id', '')}: order {order} has {estimated} syllables, expected {low}-{high}. Text: {text}"
                    )
                if sentence.get("difficultyStage") != expected_stage:
                    metadata_errors.append(
                        f"{sentence.get('id', '')}: difficultyStage={sentence.get('difficultyStage')!r}, expected {expected_stage!r}."
                    )
                if sentence.get("estimatedSyllables") != estimated:
                    metadata_errors.append(
                        f"{sentence.get('id', '')}: estimatedSyllables={sentence.get('estimatedSyllables')!r}, expected {estimated}."
                    )
                if words > 16:
                    word_count_warnings.append(f"{sentence.get('id', '')}: {words} words; review manually. Text: {text}")
                if previous_syllables and order in {3, 6} and estimated <= previous_syllables:
                    syllable_errors.append(
                        f"{sentence.get('id', '')}: order {order} should step up from the previous stage."
                    )
                previous_syllables = estimated
            else:
                metadata_errors.append(f"{sentence.get('id', '')}: invalid order {order}.")

    duplicate_sentences = {
        text: locations for text, locations in sentence_locations.items() if text and len(locations) > 1
    }
    duplicate_scenarios = [scenario_id for scenario_id, count in scenario_ids.items() if count > 1]

    report = {
        "scenarioCount": len(scenarios),
        "levelCounts": dict(level_counts),
        "topicCounts": dict(sorted(topic_counts.items())),
        "sourceTypeCounts": dict(source_counts),
        "sentenceCountDistribution": dict(Counter(sentence_counts)),
        "duplicateScenarioIds": duplicate_scenarios,
        "duplicateSentenceCount": len(duplicate_sentences),
        "sampleDuplicateSentences": dict(list(duplicate_sentences.items())[:10]),
        "missingTopicCount": sum(1 for item in scenarios if not item.get("topic")),
        "missingSourceTypeCount": sum(1 for item in scenarios if not item.get("sourceType")),
        "syllableDistribution": {
            stage: {"min": min(values), "max": max(values), "count": len(values)}
            for stage, values in sorted(syllable_distribution.items())
            if values
        },
        "wordCountDistribution": {
            stage: {"min": min(values), "max": max(values), "count": len(values)}
            for stage, values in sorted(word_count_distribution.items())
            if values
        },
        "maxSameLevelRun": _max_same_level_run(scenarios),
        "wordCountWarnings": word_count_warnings[:20],
    }

    errors: list[str] = []
    if len(scenarios) != 180:
        errors.append(f"Expected 180 scenarios, found {len(scenarios)}.")
    if dict(level_counts) != EXPECTED_LEVELS:
        errors.append(f"Expected level counts {EXPECTED_LEVELS}, found {dict(level_counts)}.")
    if duplicate_scenarios:
        errors.append(f"Found duplicate scenario ids: {duplicate_scenarios[:10]}")
    if duplicate_sentences:
        errors.append(f"Found {len(duplicate_sentences)} exact duplicate sentence texts.")
    if any(count != 7 for count in sentence_counts):
        errors.append("Every scenario must contain exactly 7 sentences.")
    if order_errors:
        errors.extend(order_errors[:20])
    if syllable_errors:
        errors.extend(syllable_errors[:20])
    if metadata_errors:
        errors.extend(metadata_errors[:20])
    if report["maxSameLevelRun"] > 2:
        errors.append(f"Scenario order is too blocky; max same-level run is {report['maxSameLevelRun']}.")
    if report["missingTopicCount"]:
        errors.append(f"Found {report['missingTopicCount']} scenarios without topic.")
    if report["missingSourceTypeCount"]:
        errors.append(f"Found {report['missingSourceTypeCount']} scenarios without sourceType.")

    report["errors"] = errors
    return report


def _max_same_level_run(scenarios: list[dict[str, Any]]) -> int:
    max_run = 0
    current_level = None
    current_run = 0
    for scenario in scenarios:
        level = scenario.get("level")
        if level == current_level:
            current_run += 1
        else:
            current_level = level
            current_run = 1
        max_run = max(max_run, current_run)
    return max_run


def main() -> None:
    report = validate_bank(load_bank())
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
