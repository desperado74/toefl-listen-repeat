from __future__ import annotations

from collections import Counter
import json
import re
from typing import Any


def build_training_plan(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    if not attempts:
        return {
            "headline": "还没有训练记录。先完成一组 Listen and Repeat。",
            "focus": [],
            "recommendedSentenceIds": [],
            "weakWords": [],
            "weakPhonemes": [],
        }

    sentence_scores: dict[str, list[float]] = {}
    weak_words: Counter[str] = Counter()
    weak_phonemes: Counter[str] = Counter()
    focus: Counter[str] = Counter()

    for attempt in attempts:
        normalized = json.loads(attempt["normalized_json"])
        scores = normalized.get("scores", {})
        repeat_score = scores.get("repeatAccuracy") or scores.get("overall") or 0
        sentence_id = attempt["sentence_id"]
        sentence_scores.setdefault(sentence_id, []).append(float(repeat_score))

        issues = normalized.get("issues", {})
        for word in issues.get("omissions", []):
            weak_words[word.lower()] += 2
            focus["补全漏读词"] += 1
        for item in issues.get("low_score_words", []):
            weak_words[item.get("word", "").lower()] += 1
            focus["打磨低分词"] += 1
        for item in issues.get("low_score_phonemes", []):
            label = f"{item.get('word')} /{item.get('phoneme')}/"
            weak_phonemes[label] += 1
            focus["修正音素"] += 1

        if scores.get("fluency") is not None and scores["fluency"] < 80:
            focus["减少停顿"] += 1
        if scores.get("prosody") is not None and scores["prosody"] < 80:
            focus["模仿重音和语调"] += 1
        if scores.get("completeness") is not None and scores["completeness"] < 85:
            focus["提升完整度"] += 1

    ranked_sentences: list[tuple[str, float]] = []
    for sentence_id, scores_for_sentence in sentence_scores.items():
        # Prioritize sentences that keep showing weak scores across attempts.
        average_score = sum(scores_for_sentence) / len(scores_for_sentence)
        ranked_sentences.append((sentence_id, average_score))
    ranked_sentences.sort(key=lambda item: item[1])
    recommended = [sentence_id for sentence_id, _ in ranked_sentences[:5]]
    top_focus = [label for label, _ in focus.most_common(3)]

    return {
        "headline": _headline(top_focus),
        "focus": top_focus,
        "recommendedSentenceIds": recommended,
        "weakWords": [{"text": text, "count": count} for text, count in weak_words.most_common(10) if text],
        "weakPhonemes": [
            {"text": text, "count": count} for text, count in weak_phonemes.most_common(10) if text
        ],
    }


def _headline(focus: list[str]) -> str:
    if not focus:
        return "最近表现稳定。下一组可以增加句长或提高复述速度。"
    return f"下一轮优先训练：{'、'.join(focus)}。"


def build_reinforcement_scenario(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    weak_words: Counter[str] = Counter()
    weak_phonemes: Counter[tuple[str, str]] = Counter()

    for attempt in attempts:
        normalized = json.loads(attempt["normalized_json"])
        issues = normalized.get("issues", {})
        for word in issues.get("omissions", []):
            cleaned = _normalize_token(word)
            if cleaned:
                weak_words[cleaned] += 2
        for item in issues.get("low_score_words", []):
            cleaned = _normalize_token(item.get("word", ""))
            if cleaned:
                weak_words[cleaned] += 1
        for item in issues.get("low_score_phonemes", []):
            word = _normalize_token(item.get("word", ""))
            phoneme = _normalize_token(item.get("phoneme", ""))
            if word and phoneme:
                weak_phonemes[(word, phoneme)] += 1

    sentences: list[str] = []
    for word, _ in weak_words.most_common(4):
        sentences.append(_word_reinforcement_sentence(word))
        sentences.append(f"Repeat this sentence and keep the word {word} fully articulated.")
        if len(sentences) >= 7:
            break

    for (word, phoneme), _ in weak_phonemes.most_common(4):
        sentences.append(f"Focus on the {phoneme} sound in {word} and say it smoothly.")
        if len(sentences) >= 7:
            break

    filler = [
        "Take one breath and complete the whole sentence without stopping.",
        "Keep short function words clear while maintaining a steady speaking pace.",
        "Repeat once slowly, then repeat again at a natural exam speed.",
        "Pay attention to sentence endings and avoid dropping final consonant sounds.",
        "Maintain sentence stress and avoid repeating the same word twice.",
        "Reduce long pauses and keep your voice stable through the full sentence.",
        "Speak clearly with enough volume so every word stays intelligible.",
    ]
    for line in filler:
        if len(sentences) >= 7:
            break
        sentences.append(line)

    generated = sentences[:7]
    return {
        "id": "reinforcement-pack",
        "title": "Personalized Reinforcement Pack",
        "context": "Generated from your recent weak words, phonemes, and fluency patterns.",
        "level": "medium",
        "sentences": [
            {
                "id": f"reinforcement-pack-{index + 1:02d}",
                "order": index + 1,
                "text": text,
                "audioUrl": "",
            }
            for index, text in enumerate(generated)
        ],
    }


def _normalize_token(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9'-]", "", str(value)).strip().lower()
    return cleaned


def _word_reinforcement_sentence(word: str) -> str:
    function_words = {"the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "at"}
    if word in function_words or len(word) <= 2:
        return f"Keep small function words like {word} clear while maintaining natural speed."
    return f"Please pronounce {word} clearly and keep the rhythm natural."
