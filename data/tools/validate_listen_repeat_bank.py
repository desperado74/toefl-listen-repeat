from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SCENARIO_PATH = ROOT / "data" / "scenarios" / "listen_repeat.json"
REPORT_PATH = ROOT / "data" / "reports" / "listen_repeat_bank_report.json"
EXPECTED_LEVELS = {"easy": 45, "medium": 90, "hard": 45}


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

    for scenario in scenarios:
        scenario_id = scenario.get("id", "")
        scenario_ids[scenario_id] += 1
        for sentence in scenario.get("sentences", []):
            text = str(sentence.get("text", "")).strip()
            sentence_texts[text] += 1
            sentence_locations[text].append(str(sentence.get("id", "")))

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
    if report["missingTopicCount"]:
        errors.append(f"Found {report['missingTopicCount']} scenarios without topic.")
    if report["missingSourceTypeCount"]:
        errors.append(f"Found {report['missingSourceTypeCount']} scenarios without sourceType.")

    report["errors"] = errors
    return report


def main() -> None:
    report = validate_bank(load_bank())
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
