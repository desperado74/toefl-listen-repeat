from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class ScoringProvider(Protocol):
    name: str

    def normalize(self, raw: dict[str, Any], reference_text: str) -> dict[str, Any]:
        ...


@dataclass
class AzurePronunciationProvider:
    name: str = "azure-pronunciation-assessment"

    def normalize(self, raw: dict[str, Any], reference_text: str) -> dict[str, Any]:
        nbest = raw.get("NBest") or []
        best = nbest[0] if nbest else raw
        assessment = best.get("PronunciationAssessment") or {}
        words = best.get("Words") or []

        issues = {
            "omissions": [],
            "insertions": [],
            "mispronunciations": [],
            "repetitions": [],
            "low_score_words": [],
            "low_score_phonemes": [],
        }
        normalized_words: list[dict[str, Any]] = []

        for word in words:
            word_text = word.get("Word", "")
            word_assessment = word.get("PronunciationAssessment") or {}
            error_type = (word_assessment.get("ErrorType") or "None").lower()
            accuracy = _to_float(word_assessment.get("AccuracyScore"))

            normalized_word = {
                "word": word_text,
                "accuracy": accuracy,
                "errorType": word_assessment.get("ErrorType", "None"),
                "offset": word.get("Offset"),
                "duration": word.get("Duration"),
                "phonemes": _extract_phonemes(word),
            }
            normalized_words.append(normalized_word)

            if error_type == "omission":
                issues["omissions"].append(word_text)
            elif error_type == "insertion":
                issues["insertions"].append(word_text)
            elif error_type == "mispronunciation":
                issues["mispronunciations"].append(word_text)
            elif error_type == "repetition":
                issues["repetitions"].append(word_text)

            if accuracy is not None and accuracy < 70:
                issues["low_score_words"].append({"word": word_text, "accuracy": accuracy})

            for phoneme in normalized_word["phonemes"]:
                phoneme_accuracy = phoneme.get("accuracy")
                if phoneme_accuracy is not None and phoneme_accuracy < 70:
                    issues["low_score_phonemes"].append(
                        {
                            "word": word_text,
                            "phoneme": phoneme.get("phoneme"),
                            "accuracy": phoneme_accuracy,
                        }
                    )

        scores = {
            # Azure responses can use PronunciationScore or PronScore depending on SDK response shape.
            "overall": _to_float(assessment.get("PronunciationScore") or assessment.get("PronScore")),
            "accuracy": _to_float(assessment.get("AccuracyScore")),
            "fluency": _to_float(assessment.get("FluencyScore")),
            "completeness": _to_float(assessment.get("CompletenessScore")),
            "prosody": _to_float(assessment.get("ProsodyScore")),
        }
        scores["repeatAccuracy"] = _repeat_accuracy(scores, issues)
        diagnostics = {
            "totalWords": len(normalized_words),
            "omissionCount": len(issues["omissions"]),
            "insertionCount": len(issues["insertions"]),
            "mispronunciationCount": len(issues["mispronunciations"]),
            "repetitionCount": len(issues["repetitions"]),
            "lowWordCount": len(issues["low_score_words"]),
            "lowPhonemeCount": len(issues["low_score_phonemes"]),
            "prosodyAvailable": scores.get("prosody") is not None,
        }
        detailed_feedback = _detailed_feedback(scores, issues)

        return {
            "provider": self.name,
            "referenceText": reference_text,
            "recognizedText": best.get("Display") or raw.get("DisplayText") or "",
            "scores": scores,
            "issues": issues,
            "diagnostics": diagnostics,
            "detailedFeedback": detailed_feedback,
            "words": normalized_words,
            "summary": _summarize(scores, issues),
            "nextAction": _next_action(scores, issues),
        }


def _extract_phonemes(word: dict[str, Any]) -> list[dict[str, Any]]:
    phonemes: list[dict[str, Any]] = []
    direct_phonemes = word.get("Phonemes") or []
    syllables = word.get("Syllables") or []

    for phoneme in direct_phonemes:
        assessment = phoneme.get("PronunciationAssessment") or {}
        phonemes.append(
            {
                "phoneme": phoneme.get("Phoneme"),
                "accuracy": _to_float(assessment.get("AccuracyScore")),
            }
        )

    for syllable in syllables:
        for phoneme in syllable.get("Phonemes") or []:
            assessment = phoneme.get("PronunciationAssessment") or {}
            phonemes.append(
                {
                    "phoneme": phoneme.get("Phoneme"),
                    "accuracy": _to_float(assessment.get("AccuracyScore")),
                    "syllable": syllable.get("Syllable"),
                }
            )

    return phonemes


def _repeat_accuracy(scores: dict[str, float | None], issues: dict[str, list[Any]]) -> float | None:
    accuracy = scores.get("accuracy")
    completeness = scores.get("completeness")
    fluency = scores.get("fluency")

    if accuracy is None and completeness is None:
        return None

    base = (
        (accuracy or 0) * 0.45
        + (completeness or accuracy or 0) * 0.45
        + (fluency or accuracy or 0) * 0.10
    )
    penalty = (
        len(issues["omissions"]) * 4
        + len(issues["insertions"]) * 2
        + len(issues["repetitions"]) * 2
        + len(issues["mispronunciations"]) * 1.5
    )
    return max(0, round(base - penalty, 1))


def _summarize(scores: dict[str, float | None], issues: dict[str, list[Any]]) -> str:
    if issues["omissions"]:
        return f"优先补全漏读词：{', '.join(issues['omissions'][:3])}。"
    if issues["low_score_words"]:
        words = ", ".join(item["word"] for item in issues["low_score_words"][:3])
        return f"优先打磨这些低分词：{words}。"
    if scores.get("fluency") is not None and scores["fluency"] < 75:
        return "复述内容基本可追踪，下一次重点减少停顿并保持连续输出。"
    if scores.get("prosody") is not None and scores["prosody"] < 75:
        return "准确度不错，下一次重点模仿原音的重音、停顿和语调。"
    return "这句整体稳定，下一次可以提高速度或进入更长句。"


def _detailed_feedback(scores: dict[str, float | None], issues: dict[str, list[Any]]) -> list[str]:
    messages: list[str] = []
    if issues["omissions"]:
        messages.append(f"漏读 {len(issues['omissions'])} 处，优先补全：{', '.join(issues['omissions'][:4])}。")
    if issues["insertions"]:
        messages.append(f"多读 {len(issues['insertions'])} 处，注意不要重复或补词。")
    if issues["mispronunciations"]:
        messages.append(f"发音偏差词：{', '.join(issues['mispronunciations'][:4])}。")
    if issues["low_score_phonemes"]:
        top = issues["low_score_phonemes"][:3]
        labels = ", ".join(f"{item['word']} /{item['phoneme']}/" for item in top)
        messages.append(f"音素薄弱点：{labels}。")
    if scores.get("fluency") is not None and scores["fluency"] < 80:
        messages.append("流利度偏低，尽量一口气完成整句，减少中途停顿。")
    if scores.get("completeness") is not None and scores["completeness"] < 80:
        messages.append("完整度偏低，先慢速确保全词覆盖，再追求速度。")
    if scores.get("prosody") is None:
        messages.append("本次 Azure 未返回韵律分；可继续参考准确度和流利度训练。")
    elif scores["prosody"] < 80:
        messages.append("韵律还有提升空间，重点模仿重音和句尾语调。")
    if not messages:
        messages.append("整体表现稳定，可提升语速并尝试更长句。")
    return messages


def _next_action(scores: dict[str, float | None], issues: dict[str, list[Any]]) -> str:
    if scores.get("completeness") is not None and scores["completeness"] < 80:
        return "先慢速复述，确保每个词都出现，再追求自然速度。"
    if issues["low_score_phonemes"]:
        first = issues["low_score_phonemes"][0]
        return f"单独练 {first['word']} 里的 /{first['phoneme']}/，再整句重录。"
    if scores.get("fluency") is not None and scores["fluency"] < 80:
        return "听完后先吸气，整句一次说完，避免中途重新启动。"
    return "下一轮尝试只听一遍后立刻复述，保持考试节奏。"


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
