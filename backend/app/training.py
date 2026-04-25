from __future__ import annotations

from collections import Counter
from datetime import datetime
import json
import re
from typing import Any


def build_training_plan(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    prepared = [_prepare_attempt(attempt) for attempt in attempts]
    if not prepared:
        return {
            "headline": "还没有训练记录。先完成一组听力跟读练习。",
            "focus": [],
            "recommendedSentenceIds": [],
            "weakWords": [],
            "weakPhonemes": [],
            "reviewQueue": [],
            "reviewSummary": {
                "dueNowCount": 0,
                "dueSoonCount": 0,
                "scheduledCount": 0,
                "stableCount": 0,
                "headline": "先完成一组练习后，系统会安排回练节奏。",
            },
        }

    sentence_history: dict[str, list[dict[str, Any]]] = {}
    weak_words: Counter[str] = Counter()
    weak_phonemes: Counter[str] = Counter()
    focus: Counter[str] = Counter()

    for attempt in prepared:
        sentence_id = attempt["sentenceId"]
        sentence_history.setdefault(sentence_id, []).append(attempt)

        for word in attempt["omissions"]:
            weak_words[word] += 2
            focus["补全漏读词"] += 1
        for word in attempt["lowWords"]:
            weak_words[word] += 1
            focus["打磨低分词"] += 1
        for label in attempt["lowPhonemes"]:
            weak_phonemes[label] += 1
            focus["修正音素"] += 1
        if attempt["fluency"] is not None and attempt["fluency"] < 80:
            focus["减少停顿"] += 1
        if attempt["prosody"] is not None and attempt["prosody"] < 80:
            focus["模仿重音和语调"] += 1
        if attempt["completeness"] is not None and attempt["completeness"] < 85:
            focus["提升完整度"] += 1

    review_queue: list[dict[str, Any]] = []
    for sentence_id, history in sentence_history.items():
        ordered = sorted(history, key=lambda item: item["createdAt"])
        latest = ordered[-1]
        previous = ordered[-2] if len(ordered) >= 2 else None
        average_repeat = _average([item["repeatAccuracy"] for item in ordered])
        delta = None
        if previous is not None and latest["repeatAccuracy"] is not None and previous["repeatAccuracy"] is not None:
            delta = round(latest["repeatAccuracy"] - previous["repeatAccuracy"], 1)

        priority_score = _review_priority_score(latest, average_repeat, delta, len(ordered))
        priority = _priority_bucket(priority_score)
        stage = _review_stage(latest, average_repeat, delta, len(ordered))
        target_gap_days = _target_gap_days(stage, priority, latest)
        days_since_latest = _days_since(latest["createdAt"])
        due_in_days = round(target_gap_days - days_since_latest, 1)
        due_status = _due_status(due_in_days, priority)
        focus_words = _distinct_list(latest["omissions"] + latest["lowWords"])[:3]
        focus_phonemes = _distinct_list(latest["lowPhonemes"])[:2]
        review_queue.append(
            {
                "sentenceId": sentence_id,
                "priority": priority,
                "priorityLabel": _priority_label(priority),
                "priorityScore": priority_score,
                "reviewStage": stage,
                "reviewStageLabel": _review_stage_label(stage),
                "targetGapDays": target_gap_days,
                "daysSinceLatest": days_since_latest,
                "dueInDays": due_in_days,
                "dueStatus": due_status,
                "dueLabel": _due_label(due_status, due_in_days),
                "lastAttemptAt": latest["createdAt"],
                "reason": _review_reason(latest, delta),
                "suggestedAction": _suggested_action(latest),
                "latestRepeatAccuracy": latest["repeatAccuracy"],
                "averageRepeatAccuracy": average_repeat,
                "deltaFromPrevious": delta,
                "attempts": len(ordered),
                "focusWords": focus_words,
                "focusPhonemes": focus_phonemes,
            }
        )

    review_queue.sort(
        key=lambda item: (
            -item["priorityScore"],
            _priority_order(item["priority"]),
            item["latestRepeatAccuracy"] if item["latestRepeatAccuracy"] is not None else -1,
            item["sentenceId"],
        )
    )

    top_focus = [label for label, _ in focus.most_common(3)]
    recommended = [item["sentenceId"] for item in review_queue[:5]]
    review_summary = _review_summary(review_queue)

    return {
        "headline": _headline(top_focus, review_queue, review_summary),
        "focus": top_focus,
        "recommendedSentenceIds": recommended,
        "weakWords": [{"text": text, "count": count} for text, count in weak_words.most_common(10) if text],
        "weakPhonemes": [{"text": text, "count": count} for text, count in weak_phonemes.most_common(10) if text],
        "reviewQueue": review_queue[:6],
        "reviewSummary": review_summary,
    }


def build_reinforcement_scenario(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    prepared = [_prepare_attempt(attempt) for attempt in attempts]
    sentence_history: dict[str, list[dict[str, Any]]] = {}
    for attempt in prepared:
        sentence_history.setdefault(attempt["sentenceId"], []).append(attempt)

    ranked_candidates: list[tuple[float, str, dict[str, Any]]] = []
    for sentence_id, history in sentence_history.items():
        ordered = sorted(history, key=lambda item: item["createdAt"])
        latest = ordered[-1]
        previous = ordered[-2] if len(ordered) >= 2 else None
        average_repeat = _average([item["repeatAccuracy"] for item in ordered])
        delta = None
        if previous is not None and latest["repeatAccuracy"] is not None and previous["repeatAccuracy"] is not None:
            delta = round(latest["repeatAccuracy"] - previous["repeatAccuracy"], 1)
        ranked_candidates.append(
            (_review_priority_score(latest, average_repeat, delta, len(ordered)), sentence_id, latest)
        )

    ranked_candidates.sort(key=lambda item: (-item[0], item[1]))

    selected_sentences: list[str] = []
    selected_ids: set[str] = set()
    focus_labels: list[str] = []
    for _, sentence_id, latest in ranked_candidates:
        reference_text = latest["referenceText"]
        if not reference_text or sentence_id in selected_ids:
            continue
        selected_sentences.append(reference_text)
        selected_ids.add(sentence_id)
        focus_labels.append(_reinforcement_focus_label(latest))
        if len(selected_sentences) >= 7:
            break

    filler = [
        "Take one breath and complete the whole sentence without stopping.",
        "Keep every short function word clear while maintaining a steady pace.",
        "Repeat the sentence once slowly, then repeat it again at a natural pace.",
        "Keep the final consonant sounds clear at the end of each word.",
        "Maintain sentence stress without repeating the same word twice.",
        "Reduce long pauses and keep your voice steady through the full sentence.",
        "Speak clearly enough that each word stays easy to recognize.",
    ]
    for line in filler:
        if len(selected_sentences) >= 7:
            break
        selected_sentences.append(line)

    unique_focus = _distinct_list(focus_labels)
    context_focus = "、".join(unique_focus[:3]) if unique_focus else "补漏读、修音素、提流利度"

    return {
        "id": "reinforcement-pack",
        "title": "个性化强化练习包",
        "context": f"优先回练最近不稳定的原句，重点处理：{context_focus}。",
        "level": "medium",
        "sentences": [
            {
                "id": f"reinforcement-pack-{index + 1:02d}",
                "order": index + 1,
                "text": text,
                "audioUrl": "",
            }
            for index, text in enumerate(selected_sentences[:7])
        ],
    }


def build_session_analytics(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    if not attempts:
        return {
            "summary": {
                "totalAttempts": 0,
                "practicedSentences": 0,
                "averageRepeatAccuracy": None,
                "bestRepeatAccuracy": None,
            },
            "recentTrend": [],
            "weakestSentences": [],
            "improvingSentences": [],
            "focusBreakdown": [],
        }

    prepared = [_prepare_attempt(attempt) for attempt in attempts]
    sentence_scores: dict[str, list[dict[str, Any]]] = {}
    focus: Counter[str] = Counter()

    for attempt in prepared:
        sentence_scores.setdefault(attempt["sentenceId"], []).append(attempt)
        if attempt["omissions"]:
            focus["补漏读"] += len(attempt["omissions"])
        if attempt["lowWords"]:
            focus["磨低分词"] += len(attempt["lowWords"])
        if attempt["lowPhonemes"]:
            focus["修音素"] += len(attempt["lowPhonemes"])
        if attempt["fluency"] is not None and attempt["fluency"] < 80:
            focus["提流利度"] += 1
        if attempt["completeness"] is not None and attempt["completeness"] < 85:
            focus["保完整度"] += 1
        if attempt["prosody"] is not None and attempt["prosody"] < 80:
            focus["练语调"] += 1

    repeat_scores = [item["repeatAccuracy"] for item in prepared if item["repeatAccuracy"] is not None]
    weakest_sentences: list[dict[str, Any]] = []
    improving_sentences: list[dict[str, Any]] = []

    for sentence_id, items in sentence_scores.items():
        ordered = sorted(items, key=lambda item: item["createdAt"])
        latest = ordered[-1]
        previous = ordered[-2] if len(ordered) >= 2 else None
        average_repeat = _average([item["repeatAccuracy"] for item in ordered])
        delta = None
        if previous is not None and latest["repeatAccuracy"] is not None and previous["repeatAccuracy"] is not None:
            delta = round(latest["repeatAccuracy"] - previous["repeatAccuracy"], 1)

        insight = {
            "sentenceId": sentence_id,
            "referenceText": latest["referenceText"],
            "attempts": len(ordered),
            "averageRepeatAccuracy": average_repeat,
            "latestRepeatAccuracy": latest["repeatAccuracy"],
            "deltaFromPrevious": delta,
            "lastAttemptAt": latest["createdAt"],
        }
        weakest_sentences.append(insight)
        if delta is not None and delta > 0:
            improving_sentences.append(insight)

    weakest_sentences.sort(
        key=lambda item: (
            item["averageRepeatAccuracy"] if item["averageRepeatAccuracy"] is not None else 999,
            -item["attempts"],
            item["sentenceId"],
        )
    )
    improving_sentences.sort(
        key=lambda item: (
            -(item["deltaFromPrevious"] if item["deltaFromPrevious"] is not None else 0),
            item["latestRepeatAccuracy"] if item["latestRepeatAccuracy"] is not None else 999,
        )
    )

    recent_trend = sorted(prepared[:8], key=lambda item: item["createdAt"])

    return {
        "summary": {
            "totalAttempts": len(prepared),
            "practicedSentences": len(sentence_scores),
            "averageRepeatAccuracy": _average(repeat_scores),
            "bestRepeatAccuracy": max(repeat_scores) if repeat_scores else None,
        },
        "recentTrend": [
            {
                "attemptId": item["id"],
                "sentenceId": item["sentenceId"],
                "referenceText": item["referenceText"],
                "createdAt": item["createdAt"],
                "repeatAccuracy": item["repeatAccuracy"],
            }
            for item in recent_trend
        ],
        "weakestSentences": weakest_sentences[:5],
        "improvingSentences": improving_sentences[:3],
        "focusBreakdown": [{"label": label, "count": count} for label, count in focus.most_common(5)],
    }


def _prepare_attempt(attempt: dict[str, Any]) -> dict[str, Any]:
    normalized = attempt.get("normalized_json", {})
    if isinstance(normalized, str):
        normalized = json.loads(normalized)
    scores = normalized.get("scores", {})
    issues = normalized.get("issues", {})
    low_word_items = issues.get("low_score_words", [])
    low_phoneme_items = issues.get("low_score_phonemes", [])
    omissions = [_normalize_token(item) for item in issues.get("omissions", []) if _normalize_token(item)]
    low_words = [
        _normalize_token(item.get("word", ""))
        for item in low_word_items
        if _normalize_token(item.get("word", ""))
    ]
    low_phonemes = [
        _phoneme_label(item.get("word", ""), item.get("phoneme", ""))
        for item in low_phoneme_items
        if _phoneme_label(item.get("word", ""), item.get("phoneme", ""))
    ]

    return {
        "id": attempt.get("id"),
        "sentenceId": str(attempt.get("sentence_id", "")),
        "referenceText": str(attempt.get("reference_text", "")),
        "createdAt": str(attempt.get("created_at", "")),
        "repeatAccuracy": _as_float(scores.get("repeatAccuracy") or scores.get("overall")),
        "accuracy": _as_float(scores.get("accuracy")),
        "fluency": _as_float(scores.get("fluency")),
        "completeness": _as_float(scores.get("completeness")),
        "prosody": _as_float(scores.get("prosody")),
        "omissions": omissions,
        "insertions": [_normalize_token(item) for item in issues.get("insertions", []) if _normalize_token(item)],
        "mispronunciations": [
            _normalize_token(item) for item in issues.get("mispronunciations", []) if _normalize_token(item)
        ],
        "repetitions": [_normalize_token(item) for item in issues.get("repetitions", []) if _normalize_token(item)],
        "lowWords": low_words,
        "lowPhonemes": low_phonemes,
    }


def _headline(
    focus: list[str], review_queue: list[dict[str, Any]], review_summary: dict[str, Any]
) -> str:
    if not review_queue:
        return "最近表现稳定。下一组可以增加句长或提高复述速度。"
    urgent_count = review_summary["dueNowCount"]
    due_soon_count = review_summary["dueSoonCount"]
    focus_text = "、".join(focus[:3]) if focus else "稳定输出"
    if urgent_count:
        return f"下一轮优先训练：{focus_text}。现在先处理 {urgent_count} 句到期回练内容。"
    if due_soon_count:
        return f"下一轮优先训练：{focus_text}。还有 {due_soon_count} 句很快会到复习窗口。"
    return f"下一轮优先训练：{focus_text}。建议按回练队列完成 3 到 5 句。"


def _review_priority_score(
    latest: dict[str, Any],
    average_repeat: float | None,
    delta: float | None,
    attempt_count: int,
) -> float:
    repeat = latest["repeatAccuracy"] if latest["repeatAccuracy"] is not None else 50
    score = max(0.0, 100.0 - repeat)
    score += len(latest["omissions"]) * 8
    score += len(latest["lowWords"]) * 3
    score += len(latest["lowPhonemes"]) * 2
    score += len(latest["mispronunciations"]) * 2.5
    score += len(latest["insertions"]) * 2
    score += len(latest["repetitions"]) * 2
    if latest["completeness"] is not None and latest["completeness"] < 80:
        score += 6
    if latest["fluency"] is not None and latest["fluency"] < 80:
        score += 5
    if latest["prosody"] is not None and latest["prosody"] < 78:
        score += 3
    if average_repeat is not None and average_repeat < 78:
        score += 4
    if delta is None:
        score += 2
    elif delta <= 0:
        score += 6
    elif delta >= 6:
        score -= 3
    if attempt_count >= 3:
        score += 2
    return round(score, 1)


def _priority_bucket(score: float) -> str:
    if score >= 38:
        return "now"
    if score >= 24:
        return "next"
    return "later"


def _priority_label(priority: str) -> str:
    mapping = {
        "now": "立即回练",
        "next": "下一组回练",
        "later": "稍后巩固",
    }
    return mapping.get(priority, "稍后巩固")


def _priority_order(priority: str) -> int:
    mapping = {"now": 0, "next": 1, "later": 2}
    return mapping.get(priority, 99)


def _review_stage(
    latest: dict[str, Any],
    average_repeat: float | None,
    delta: float | None,
    attempt_count: int,
) -> str:
    repeat = latest["repeatAccuracy"] if latest["repeatAccuracy"] is not None else 0
    if repeat < 75 or latest["omissions"] or latest["completeness"] is not None and latest["completeness"] < 80:
        return "repair"
    if repeat < 85 or latest["lowPhonemes"] or latest["lowWords"] or delta is None or delta <= 0:
        return "stabilize"
    if attempt_count >= 3 and average_repeat is not None and average_repeat >= 88 and delta is not None and delta >= 0:
        return "retain"
    return "build"


def _review_stage_label(stage: str) -> str:
    mapping = {
        "repair": "修复阶段",
        "build": "建立阶段",
        "stabilize": "稳固阶段",
        "retain": "保持阶段",
    }
    return mapping.get(stage, "稳固阶段")


def _target_gap_days(stage: str, priority: str, latest: dict[str, Any]) -> float:
    base = {
        "repair": 0.0,
        "build": 0.5,
        "stabilize": 1.0,
        "retain": 3.0,
    }.get(stage, 1.0)
    if priority == "now":
        return 0.0
    if priority == "next":
        return min(base, 1.0)
    if latest["repeatAccuracy"] is not None and latest["repeatAccuracy"] >= 90 and stage == "retain":
        return 4.0
    return base


def _days_since(value: str) -> float:
    timestamp = _parse_created_at(value)
    if timestamp is None:
        return 0.0
    delta = datetime.now() - timestamp
    return max(0.0, round(delta.total_seconds() / 86400, 1))


def _parse_created_at(value: str) -> datetime | None:
    if not value:
        return None
    normalized = value.replace(" ", "T")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _due_status(due_in_days: float, priority: str) -> str:
    if priority == "now" or due_in_days <= 0:
        return "due_now"
    if due_in_days <= 1:
        return "due_soon"
    if due_in_days <= 3:
        return "scheduled"
    return "stable"


def _due_label(due_status: str, due_in_days: float) -> str:
    if due_status == "due_now":
        return "现在复习"
    if due_status == "due_soon":
        return "24 小时内复习"
    if due_status == "scheduled":
        return f"{max(1, int(round(due_in_days)))} 天内复习"
    return "先保持"


def _review_summary(review_queue: list[dict[str, Any]]) -> dict[str, Any]:
    due_now_count = sum(1 for item in review_queue if item["dueStatus"] == "due_now")
    due_soon_count = sum(1 for item in review_queue if item["dueStatus"] == "due_soon")
    scheduled_count = sum(1 for item in review_queue if item["dueStatus"] == "scheduled")
    stable_count = sum(1 for item in review_queue if item["dueStatus"] == "stable")

    if due_now_count:
        headline = f"今天先完成 {due_now_count} 句到期回练，再处理高优先级新问题。"
    elif due_soon_count:
        headline = f"现在先练最靠前的句子，另外有 {due_soon_count} 句会在 24 小时内进入复习窗口。"
    elif scheduled_count:
        headline = f"当前没有立刻到期项，未来 3 天内还有 {scheduled_count} 句要按计划回练。"
    else:
        headline = "大部分句子处于保持阶段，可以把精力放在新的薄弱点上。"

    return {
        "dueNowCount": due_now_count,
        "dueSoonCount": due_soon_count,
        "scheduledCount": scheduled_count,
        "stableCount": stable_count,
        "headline": headline,
    }


def _review_reason(latest: dict[str, Any], delta: float | None) -> str:
    if latest["omissions"]:
        return f"最近这句仍有 {len(latest['omissions'])} 处漏读，完整度不稳。"
    if latest["lowPhonemes"]:
        labels = "、".join(latest["lowPhonemes"][:2])
        return f"这句的音素薄弱点仍集中在 {labels}。"
    if latest["lowWords"]:
        words = "、".join(latest["lowWords"][:3])
        return f"这句里的低分词还没有稳住：{words}。"
    if delta is not None and delta <= 0:
        return "这句最近没有明显进步，建议尽快回练巩固。"
    if latest["fluency"] is not None and latest["fluency"] < 80:
        return "这句主要卡在流利度，容易中途停顿或重启。"
    if latest["prosody"] is not None and latest["prosody"] < 80:
        return "这句发音大体可追踪，但重音和语调还不稳定。"
    return "这句分数还不够稳，建议再做一轮回练确认。"


def _suggested_action(latest: dict[str, Any]) -> str:
    if latest["omissions"]:
        words = "、".join(latest["omissions"][:2])
        return f"先慢速补全 {words}，确认每个词都说出来，再整句重录。"
    if latest["lowPhonemes"]:
        label = latest["lowPhonemes"][0]
        return f"先单独练 {label}，再回到原句里一次说完整句。"
    if latest["lowWords"]:
        words = "、".join(latest["lowWords"][:2])
        return f"把 {words} 单独读顺，再把它们放回原句里练。"
    if latest["fluency"] is not None and latest["fluency"] < 80:
        return "听完先吸一口气，再整句一次说完，避免中途重新启动。"
    if latest["prosody"] is not None and latest["prosody"] < 80:
        return "先跟着原音模仿重音和句尾语调，再正常速度复述。"
    return "这句再练一遍，目标是稳定保持当前分数以上。"


def _reinforcement_focus_label(latest: dict[str, Any]) -> str:
    if latest["omissions"]:
        return "补漏读"
    if latest["lowPhonemes"]:
        return "修音素"
    if latest["lowWords"]:
        return "磨低分词"
    if latest["fluency"] is not None and latest["fluency"] < 80:
        return "提流利度"
    if latest["prosody"] is not None and latest["prosody"] < 80:
        return "练语调"
    return "稳输出"


def _normalize_token(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9'-]", "", str(value)).strip().lower()
    return cleaned


def _phoneme_label(word: str, phoneme: str) -> str:
    cleaned_word = _normalize_token(word)
    cleaned_phoneme = _normalize_token(phoneme)
    if not cleaned_word or not cleaned_phoneme:
        return ""
    return f"{cleaned_word} /{cleaned_phoneme}/"


def _distinct_list(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        output.append(item)
    return output


def _average(values: list[float | None]) -> float | None:
    usable = [value for value in values if value is not None]
    if not usable:
        return None
    return round(sum(usable) / len(usable), 1)


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
