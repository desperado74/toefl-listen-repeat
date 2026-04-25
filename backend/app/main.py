from __future__ import annotations

from pathlib import Path
import hashlib
import html
import json
import re
import shutil
import subprocess
import tempfile
from typing import Any
from urllib.parse import quote
import uuid

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import requests

from .config import get_settings
from .db import connect, init_db, row_to_dict
from .scoring import AzurePronunciationProvider
from .training import build_reinforcement_scenario, build_session_analytics, build_training_plan


settings = get_settings()
provider = AzurePronunciationProvider()

app = FastAPI(title="TOEFL Listen and Repeat Local Trainer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

settings.attempts_dir.mkdir(parents=True, exist_ok=True)
settings.prompt_audio_dir.mkdir(parents=True, exist_ok=True)
app.mount("/recordings", StaticFiles(directory=settings.attempts_dir), name="recordings")
app.mount("/prompt-audio", StaticFiles(directory=settings.prompt_audio_dir), name="prompt-audio")


@app.on_event("startup")
def startup() -> None:
    init_db(settings.database_path)
    settings.attempts_dir.mkdir(parents=True, exist_ok=True)
    settings.prompt_audio_dir.mkdir(parents=True, exist_ok=True)


@app.middleware("http")
async def access_guard(request: Request, call_next):
    if not settings.access_protection_enabled:
        _ensure_visitor_id(request)
        response = await call_next(request)
        _set_visitor_cookie(response, request)
        return response
    if not _path_requires_auth(request.url.path):
        return await call_next(request)
    if _is_authenticated(request):
        _ensure_visitor_id(request)
        response = await call_next(request)
        _set_visitor_cookie(response, request)
        return response
    return JSONResponse({"detail": "Access password required."}, status_code=401)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def config_status(request: Request) -> dict[str, object]:
    return {
        "azureConfigured": settings.azure_configured,
        "azureRegion": settings.azure_speech_region or None,
        "deepSeekConfigured": bool(settings.deepseek_api_key.strip()),
        "interviewAiProvider": settings.interview_ai_provider,
        "deepSeekModel": settings.deepseek_model,
        "envPath": str(Path(".env").resolve()),
        "frontendServing": settings.frontend_dist_dir.exists(),
        "frontendDistDir": str(settings.frontend_dist_dir.resolve()),
        "requiresPassword": settings.access_protection_enabled,
        "authenticated": _is_authenticated(request),
    }


@app.post("/api/config/deepseek")
async def save_deepseek_config(request: Request) -> dict[str, object]:
    payload = await request.json()
    api_key = str(payload.get("apiKey", "")).strip()
    model = str(payload.get("model", settings.deepseek_model)).strip() or settings.deepseek_model
    enable = bool(payload.get("enable", True))
    if enable and not api_key:
        raise HTTPException(status_code=400, detail="DeepSeek API key is required.")
    if model not in {"deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"}:
        raise HTTPException(status_code=400, detail="Unsupported DeepSeek model.")

    updates = {
        "INTERVIEW_AI_PROVIDER": "deepseek" if enable else "none",
        "INTERVIEW_REFERENCE_PROVIDER": "deepseek" if enable else "local",
        "DEEPSEEK_MODEL": model,
        "DEEPSEEK_BASE_URL": settings.deepseek_base_url,
    }
    if api_key:
        updates["DEEPSEEK_API_KEY"] = api_key
    _update_env_file(Path(".env"), updates)

    settings.interview_ai_provider = updates["INTERVIEW_AI_PROVIDER"]
    settings.interview_reference_provider = updates["INTERVIEW_REFERENCE_PROVIDER"]
    settings.deepseek_model = model
    if api_key:
        settings.deepseek_api_key = api_key

    return {
        "ok": True,
        "deepSeekConfigured": bool(settings.deepseek_api_key.strip()),
        "interviewAiProvider": settings.interview_ai_provider,
        "deepSeekModel": settings.deepseek_model,
    }


@app.post("/api/auth/login")
async def auth_login(request: Request) -> JSONResponse:
    payload = await request.json()
    password = str(payload.get("password", "")).strip()
    if not settings.access_protection_enabled:
        return JSONResponse({"ok": True, "message": "Access protection disabled."})
    if password != settings.access_password:
        raise HTTPException(status_code=401, detail="Invalid access password")

    response = JSONResponse({"ok": True})
    response.set_cookie(
        key=settings.session_cookie_name,
        value=settings.access_session_token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
        path="/",
    )
    return response


@app.post("/api/auth/logout")
def auth_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.session_cookie_name, path="/")
    return response


@app.get("/api/scenarios")
def scenarios() -> dict[str, object]:
    if not settings.scenarios_path.exists():
        raise HTTPException(status_code=404, detail="Scenario file not found")
    data = _load_scenarios()
    data["scenarios"] = [_hydrate_scenario_defaults(scenario) for scenario in data["scenarios"]]
    return data


@app.get("/api/reading/sets")
def reading_sets() -> dict[str, object]:
    bank = _load_reading_bank()
    sets = [
        {
            "id": item["id"],
            "title": item["title"],
            "difficulty": item.get("difficulty", "medium"),
            "estimatedMinutes": item.get("estimatedMinutes", 10),
            "descriptionZh": item.get("descriptionZh", ""),
            "questionCount": _reading_question_count(item),
            "sectionTypes": [section.get("type", "") for section in item.get("sections", [])],
        }
        for item in bank.get("sets", [])
    ]
    return {
        "source": bank.get("source", "original"),
        "policyZh": bank.get("policyZh", "原创 TOEFL-style 阅读训练内容。"),
        "sets": sets,
    }


@app.get("/api/reading/sets/{set_id}")
def reading_set(set_id: str) -> dict[str, object]:
    item = _find_reading_set(set_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Reading set not found")
    return {"set": item}


@app.get("/api/interview/sets")
def interview_sets() -> dict[str, object]:
    bank = _load_interview_bank()
    sets = [
        {
            "id": item["id"],
            "title": item["title"],
            "theme": item.get("theme", ""),
            "difficulty": item.get("difficulty", "medium"),
            "descriptionZh": item.get("descriptionZh", ""),
            "questionCount": len(item.get("questions", [])),
            "answerSeconds": item.get("answerSeconds", 45),
        }
        for item in bank.get("sets", [])
    ]
    return {
        "source": bank.get("source", "original"),
        "policyZh": bank.get("policyZh", "原创 TOEFL-style Interview 训练内容。"),
        "sets": sets,
    }


@app.get("/api/interview/sets/{set_id}")
def interview_set(set_id: str) -> dict[str, object]:
    item = _find_interview_set(set_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Interview set not found")
    return {"set": _hydrate_interview_set(item)}


@app.post("/api/interview/attempts")
async def create_interview_attempt(
    request: Request,
    set_id: str = Form(...),
    question_id: str = Form(...),
    duration_ms: int = Form(...),
    transcript: str = Form(""),
    scoring_status: str = Form("not_scored"),
    ai_feedback_json: str = Form("{}"),
    rubric_scores_json: str = Form("{}"),
    audio: UploadFile = File(...),
) -> dict[str, object]:
    item = _find_interview_question(set_id, question_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Interview question not found")

    try:
        client_ai_feedback = json.loads(ai_feedback_json)
        client_rubric_scores = json.loads(rubric_scores_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Feedback fields must be valid JSON") from exc

    attempt_id = str(uuid.uuid4())
    attempt_dir = settings.attempts_dir / "interview" / set_id
    attempt_dir.mkdir(parents=True, exist_ok=True)
    audio_path = attempt_dir / f"{attempt_id}.wav"
    audio_bytes = await audio.read()
    if len(audio_bytes) < 512:
        raise HTTPException(status_code=400, detail="Recording is empty or too short.")
    audio_path.write_bytes(audio_bytes)

    transcript_text = transcript.strip()
    stt_detail: dict[str, object] = {"provider": "azure-speech-rest", "configured": settings.azure_configured}
    status_value = _coerce_interview_status(scoring_status)
    if settings.azure_configured:
        try:
            stt_result = _transcribe_interview_audio(audio_bytes)
            transcript_text = stt_result["transcript"] or transcript_text
            stt_detail.update(stt_result)
            status_value = "feedback_ready" if transcript_text else "empty_transcript"
        except RuntimeError as exc:
            stt_detail["error"] = str(exc)
            status_value = "failed_transcription"
    elif status_value == "not_scored":
        status_value = "stt_not_configured"

    generated_feedback = _build_interview_feedback(
        question=item,
        transcript=transcript_text,
        duration_ms=duration_ms,
        stt_detail=stt_detail,
    )
    generated_feedback = _maybe_upgrade_interview_feedback_with_ai(
        question=item,
        transcript=transcript_text,
        duration_ms=duration_ms,
        stt_detail=stt_detail,
        baseline_feedback=generated_feedback,
    )
    if isinstance(client_ai_feedback, dict):
        generated_feedback["clientFeedback"] = client_ai_feedback
    rubric_scores = generated_feedback["rubricScores"]
    if isinstance(client_rubric_scores, dict) and client_rubric_scores:
        generated_feedback["clientRubricScores"] = client_rubric_scores

    with connect(settings.database_path) as conn:
        conn.execute(
            """
            INSERT INTO interview_attempts (
                id, set_id, question_id, audio_path, duration_ms, transcript,
                ai_feedback_json, rubric_scores_json, scoring_status, client_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                attempt_id,
                set_id,
                question_id,
                str(audio_path),
                duration_ms,
                transcript_text,
                json.dumps(generated_feedback, ensure_ascii=False),
                json.dumps(rubric_scores, ensure_ascii=False),
                status_value,
                _visitor_id(request),
            ),
        )

    return {
        "attempt": {
            "id": attempt_id,
            "setId": set_id,
            "questionId": question_id,
            "durationMs": duration_ms,
            "transcript": transcript_text,
            "aiFeedback": generated_feedback,
            "rubricScores": rubric_scores,
            "scoringStatus": status_value,
            "audioPath": str(audio_path),
            "audioUrl": f"/recordings/interview/{set_id}/{attempt_id}.wav",
        }
    }


@app.get("/api/interview/attempts")
def interview_attempts(request: Request, limit: int = 80) -> dict[str, object]:
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            "SELECT * FROM interview_attempts WHERE client_id = ? ORDER BY created_at DESC LIMIT ?",
            (_visitor_id(request), min(limit, 300)),
        ).fetchall()
    attempts = []
    for row in rows:
        item = row_to_dict(row)
        item["setId"] = item.pop("set_id")
        item["questionId"] = item.pop("question_id")
        item["durationMs"] = item.pop("duration_ms")
        item["audioPath"] = item.pop("audio_path")
        item.pop("client_id", None)
        item["aiFeedback"] = json.loads(item.pop("ai_feedback_json") or "{}")
        item["rubricScores"] = json.loads(item.pop("rubric_scores_json") or "{}")
        item["scoringStatus"] = item.pop("scoring_status")
        item["createdAt"] = item.pop("created_at")
        item["audioUrl"] = f"/recordings/interview/{item['setId']}/{item['id']}.wav"
        attempts.append(item)
    return {"attempts": attempts}


@app.post("/api/interview/reference-answer")
async def interview_reference_answer(request: Request) -> dict[str, object]:
    payload = await request.json()
    set_id = str(payload.get("setId", "")).strip()
    question_id = str(payload.get("questionId", "")).strip()
    attempt_id = str(payload.get("attemptId", "")).strip()
    target_level = str(payload.get("targetLevel", "4.5/5")).strip() or "4.5/5"
    force = bool(payload.get("force", False))
    if not set_id or not question_id or not attempt_id:
        raise HTTPException(status_code=400, detail="setId, questionId, and attemptId are required")

    question = _find_interview_question(set_id, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Interview question not found")

    with connect(settings.database_path) as conn:
        attempt = conn.execute(
            """
            SELECT id FROM interview_attempts
            WHERE id = ? AND set_id = ? AND question_id = ? AND client_id = ?
            """,
            (attempt_id, set_id, question_id, _visitor_id(request)),
        ).fetchone()
        if attempt is None:
            raise HTTPException(status_code=403, detail="Complete this question before viewing a reference answer.")

        provider = _reference_provider_name()
        model = _reference_model_name(provider)
        if not force:
            cached = conn.execute(
                """
                SELECT * FROM interview_reference_answers
                WHERE set_id = ? AND question_id = ? AND provider = ? AND model = ? AND target_level = ?
                """,
                (set_id, question_id, provider, model, target_level),
            ).fetchone()
            if cached is not None:
                return {"referenceAnswer": _reference_answer_row(cached), "cached": True}

        generated = _generate_reference_answer(question, provider, model, target_level)
        reference_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT OR REPLACE INTO interview_reference_answers (
                id, set_id, question_id, provider, model, answer_text,
                learning_points_json, target_level, word_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                reference_id,
                set_id,
                question_id,
                provider,
                model,
                generated["answerText"],
                json.dumps(generated["learningPoints"], ensure_ascii=False),
                target_level,
                generated["wordCount"],
            ),
        )
        row = conn.execute(
            "SELECT * FROM interview_reference_answers WHERE id = ?",
            (reference_id,),
        ).fetchone()
    return {"referenceAnswer": _reference_answer_row(row), "cached": False}


@app.post("/api/reading/attempts")
async def create_reading_attempt(request: Request) -> dict[str, object]:
    payload = await request.json()
    set_id = str(payload.get("setId", ""))
    answers = payload.get("answers", {})
    elapsed_ms = int(payload.get("elapsedMs", 0) or 0)
    if not set_id:
        raise HTTPException(status_code=400, detail="setId is required")
    if not isinstance(answers, dict):
        raise HTTPException(status_code=400, detail="answers must be an object")

    item = _find_reading_set(set_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Reading set not found")

    result = _score_reading_attempt(item, answers, elapsed_ms)
    attempt_id = str(uuid.uuid4())
    with connect(settings.database_path) as conn:
        conn.execute(
            """
            INSERT INTO reading_attempts (id, set_id, answers_json, result_json, elapsed_ms, client_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                attempt_id,
                set_id,
                json.dumps(answers, ensure_ascii=False),
                json.dumps(result, ensure_ascii=False),
                elapsed_ms,
                _visitor_id(request),
            ),
        )
    return {"id": attempt_id, "result": result}


@app.get("/api/reinforcement-scenario")
def reinforcement_scenario(request: Request) -> dict[str, object]:
    current_sentence_ids = _current_sentence_ids()
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            WHERE client_id = ?
            ORDER BY created_at DESC
            LIMIT 600
            """,
            (_visitor_id(request),),
        ).fetchall()
    scenario = build_reinforcement_scenario(_current_attempt_dicts(rows, current_sentence_ids))
    for sentence in scenario["sentences"]:
        encoded = quote(sentence["text"], safe="")
        sentence["audioUrl"] = f"/api/prompt-audio-text.mp3?text={encoded}"
    return {"scenario": scenario}


@app.get("/api/prompt-audio/{sentence_id}.mp3")
def prompt_audio(sentence_id: str) -> dict[str, str]:
    sentence = _find_sentence(sentence_id)
    if sentence is None:
        raise HTTPException(status_code=404, detail="Sentence not found")

    target = settings.prompt_audio_dir / f"{sentence_id}.mp3"
    if not target.exists():
        _generate_prompt_audio(sentence["text"], target)
    return {"url": f"/api/prompt-audio-file/{sentence_id}.mp3"}


@app.get("/api/prompt-audio-file/{sentence_id}.mp3")
def prompt_audio_file(sentence_id: str):
    sentence = _find_sentence(sentence_id)
    if sentence is None:
        raise HTTPException(status_code=404, detail="Sentence not found")

    target = settings.prompt_audio_dir / f"{sentence_id}.mp3"
    if not target.exists():
        try:
            _generate_prompt_audio(sentence["text"], target)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return FileResponse(target, media_type="audio/mpeg")


@app.get("/api/prompt-audio-text.mp3")
def prompt_audio_text(text: str = Query(..., min_length=1, max_length=240)):
    safe_text = " ".join(text.split())
    signature = hashlib.sha1(safe_text.encode("utf-8")).hexdigest()[:16]
    target = settings.prompt_audio_dir / f"text-{signature}.mp3"
    if not target.exists():
        try:
            _generate_prompt_audio(safe_text, target)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return FileResponse(target, media_type="audio/mpeg")


@app.get("/api/azure-token")
def azure_token() -> dict[str, str]:
    if not settings.azure_configured:
        raise HTTPException(
            status_code=400,
            detail="Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env before scoring.",
        )

    url = f"https://{settings.azure_speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    response = requests.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=10,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Azure token request failed: {response.text}")
    return {"token": response.text, "region": settings.azure_speech_region}


@app.post("/api/attempts")
async def create_attempt(
    request: Request,
    scenario_id: str = Form(...),
    sentence_id: str = Form(...),
    reference_text: str = Form(...),
    duration_ms: int = Form(...),
    azure_raw_json: str = Form(...),
    audio: UploadFile = File(...),
) -> dict[str, object]:
    attempt_id = str(uuid.uuid4())
    scenario_dir = settings.attempts_dir / scenario_id
    scenario_dir.mkdir(parents=True, exist_ok=True)
    audio_path = scenario_dir / f"{attempt_id}.wav"

    audio_bytes = await audio.read()
    if len(audio_bytes) < 512:
        raise HTTPException(status_code=400, detail="Recording is empty or too short.")
    audio_path.write_bytes(audio_bytes)

    try:
        raw = json.loads(azure_raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="azure_raw_json is not valid JSON") from exc

    normalized = provider.normalize(raw, reference_text)
    tags = _tags_for(normalized)

    with connect(settings.database_path) as conn:
        conn.execute(
            """
            INSERT INTO attempts (
                id, scenario_id, sentence_id, reference_text, audio_path, duration_ms,
                azure_raw_json, normalized_json, tags_json, client_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                attempt_id,
                scenario_id,
                sentence_id,
                reference_text,
                str(audio_path),
                duration_ms,
                json.dumps(raw, ensure_ascii=False),
                json.dumps(normalized, ensure_ascii=False),
                json.dumps(tags, ensure_ascii=False),
                _visitor_id(request),
            ),
        )

    return {
        "id": attempt_id,
        "normalized": normalized,
        "tags": tags,
        "audioPath": str(audio_path),
        "audioUrl": f"/recordings/{scenario_id}/{attempt_id}.wav",
    }


@app.get("/api/attempts")
def attempts(request: Request, limit: int = 100) -> dict[str, object]:
    current_sentence_ids = _current_sentence_ids()
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            "SELECT * FROM attempts WHERE client_id = ? ORDER BY created_at DESC LIMIT ?",
            (_visitor_id(request), min(limit, 500)),
        ).fetchall()
    items = _current_attempt_dicts(rows, current_sentence_ids)
    for item in items:
        normalized = json.loads(item.pop("normalized_json"))
        item["normalized"] = _upgrade_normalized(normalized)
        item["tags"] = json.loads(item.pop("tags_json"))
        item.pop("azure_raw_json", None)
        item.pop("client_id", None)
        item["audioUrl"] = f"/recordings/{item['scenario_id']}/{item['id']}.wav"
    return {"attempts": items}


@app.get("/api/training-plan")
def training_plan(request: Request, limit: int = 200) -> dict[str, object]:
    current_sentence_ids = _current_sentence_ids()
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            WHERE client_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (_visitor_id(request), min(limit, 1000)),
        ).fetchall()
    return build_training_plan(_current_attempt_dicts(rows, current_sentence_ids))


@app.get("/api/session-analytics")
def session_analytics(request: Request, limit: int = 120) -> dict[str, object]:
    current_sentence_ids = _current_sentence_ids()
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT id, sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            WHERE client_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (_visitor_id(request), min(limit, 500)),
        ).fetchall()
    return build_session_analytics(_current_attempt_dicts(rows, current_sentence_ids))


def _tags_for(normalized: dict[str, object]) -> list[str]:
    scores = normalized.get("scores", {})
    issues = normalized.get("issues", {})
    tags: list[str] = []
    if isinstance(scores, dict):
        if scores.get("completeness") is not None and scores["completeness"] < 85:
            tags.append("low-completeness")
        if scores.get("fluency") is not None and scores["fluency"] < 80:
            tags.append("low-fluency")
        if scores.get("prosody") is not None and scores["prosody"] < 80:
            tags.append("low-prosody")
    if isinstance(issues, dict):
        if issues.get("omissions"):
            tags.append("omission")
        if issues.get("insertions"):
            tags.append("insertion")
        if issues.get("low_score_phonemes"):
            tags.append("phoneme")
    return tags


def _load_scenarios() -> dict[str, object]:
    return json.loads(settings.scenarios_path.read_text(encoding="utf-8"))


def _load_reading_bank() -> dict[str, object]:
    if not settings.reading_bank_path.exists():
        raise HTTPException(status_code=404, detail="Reading bank file not found")
    try:
        return json.loads(settings.reading_bank_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Reading bank file is not valid JSON") from exc


def _load_interview_bank() -> dict[str, object]:
    if not settings.interview_bank_path.exists():
        raise HTTPException(status_code=404, detail="Interview bank file not found")
    try:
        return json.loads(settings.interview_bank_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Interview bank file is not valid JSON") from exc


def _find_reading_set(set_id: str) -> dict[str, object] | None:
    bank = _load_reading_bank()
    for item in bank.get("sets", []):
        if item.get("id") == set_id:
            return item
    return None


def _find_interview_set(set_id: str) -> dict[str, object] | None:
    bank = _load_interview_bank()
    for item in bank.get("sets", []):
        if item.get("id") == set_id:
            return item
    return None


def _find_interview_question(set_id: str, question_id: str) -> dict[str, object] | None:
    interview_set = _find_interview_set(set_id)
    if interview_set is None:
        return None
    for question in interview_set.get("questions", []):
        if question.get("id") == question_id:
            return question
    return None


def _hydrate_interview_set(interview_set: dict[str, object]) -> dict[str, object]:
    hydrated = dict(interview_set)
    answer_seconds = int(hydrated.get("answerSeconds", 45) or 45)
    questions = []
    for question in hydrated.get("questions", []):
        item = dict(question)
        item.setdefault("answerSeconds", answer_seconds)
        if not item.get("audioUrl") and item.get("interviewerText"):
            encoded = quote(str(item["interviewerText"]), safe="")
            item["audioUrl"] = f"/api/prompt-audio-text.mp3?text={encoded}"
        questions.append(item)
    hydrated["questions"] = questions
    return hydrated


def _reading_question_count(reading_set: dict[str, object]) -> int:
    total = 0
    for section in reading_set.get("sections", []):
        if section.get("type") == "complete_words":
            total += len(section.get("blanks", []))
        else:
            total += len(section.get("questions", []))
    return total


def _score_reading_attempt(
    reading_set: dict[str, object],
    answers: dict[str, object],
    elapsed_ms: int,
) -> dict[str, object]:
    total = 0
    correct = 0
    by_section: dict[str, dict[str, int]] = {}
    by_skill: dict[str, dict[str, int]] = {}
    missed: list[dict[str, object]] = []

    for section in reading_set.get("sections", []):
        section_type = str(section.get("type", "unknown"))
        by_section.setdefault(section_type, {"correct": 0, "total": 0})
        if section_type == "complete_words":
            for blank in section.get("blanks", []):
                blank_id = str(blank.get("id", ""))
                expected = str(blank.get("answer", ""))
                submitted = _coerce_text_answer(answers.get(blank_id))
                is_correct = _normalize_word_answer(submitted) == _normalize_word_answer(expected)

                total += 1
                by_section[section_type]["total"] += 1
                if is_correct:
                    correct += 1
                    by_section[section_type]["correct"] += 1
                else:
                    missed.append(
                        {
                            "questionId": blank_id,
                            "sectionType": section_type,
                            "prompt": f"{blank.get('prefix', '')}___",
                            "submitted": submitted or None,
                            "answer": expected,
                            "fullAnswer": blank.get("fullWord", ""),
                            "explanationZh": blank.get("explanationZh", ""),
                            "evidence": blank.get("evidence", ""),
                            "skillTags": blank.get("skillTags", []),
                            "errorTags": blank.get("errorTags", []),
                        }
                    )

                for skill in blank.get("skillTags", []):
                    skill_key = str(skill)
                    by_skill.setdefault(skill_key, {"correct": 0, "total": 0})
                    by_skill[skill_key]["total"] += 1
                    if is_correct:
                        by_skill[skill_key]["correct"] += 1
            continue

        for question in section.get("questions", []):
            question_id = str(question.get("id", ""))
            expected = int(question.get("answer", -1))
            submitted_raw = answers.get(question_id)
            submitted = _coerce_answer_index(submitted_raw)
            is_correct = submitted == expected

            total += 1
            by_section[section_type]["total"] += 1
            if is_correct:
                correct += 1
                by_section[section_type]["correct"] += 1
            else:
                options = question.get("options", [])
                submitted_text = options[submitted] if submitted is not None and 0 <= submitted < len(options) else None
                answer_text = options[expected] if 0 <= expected < len(options) else None
                missed.append(
                    {
                        "questionId": question_id,
                        "sectionType": section_type,
                        "prompt": question.get("prompt", ""),
                        "submitted": submitted,
                        "submittedText": submitted_text,
                        "answer": expected,
                        "answerText": answer_text,
                        "explanationZh": question.get("explanationZh", ""),
                        "evidence": question.get("evidence", ""),
                        "skillTags": question.get("skillTags", []),
                        "errorTags": question.get("errorTags", []),
                    }
                )

            for skill in question.get("skillTags", []):
                skill_key = str(skill)
                by_skill.setdefault(skill_key, {"correct": 0, "total": 0})
                by_skill[skill_key]["total"] += 1
                if is_correct:
                    by_skill[skill_key]["correct"] += 1

    accuracy = round((correct / total) * 100) if total else 0
    return {
        "setId": reading_set.get("id"),
        "title": reading_set.get("title"),
        "correct": correct,
        "total": total,
        "accuracy": accuracy,
        "estimatedBand": _estimated_reading_band(accuracy),
        "elapsedMs": elapsed_ms,
        "sectionBreakdown": _with_accuracy(by_section),
        "skillBreakdown": _with_accuracy(by_skill),
        "missed": missed,
        "summaryZh": _reading_summary(correct, total, accuracy),
    }


INTERVIEW_WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
INTERVIEW_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "by",
    "can",
    "could",
    "do",
    "for",
    "from",
    "have",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "me",
    "more",
    "my",
    "of",
    "on",
    "or",
    "our",
    "students",
    "that",
    "the",
    "their",
    "them",
    "this",
    "to",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "while",
    "why",
    "with",
    "would",
    "you",
    "your",
}
INTERVIEW_FILLERS = {"um", "uh", "like", "actually", "basically", "maybe", "just"}
STRUCTURE_MARKERS = {
    "because",
    "for example",
    "for instance",
    "first",
    "second",
    "also",
    "another",
    "so",
    "therefore",
    "that's why",
    "as a result",
}


def _transcribe_interview_audio(audio_bytes: bytes) -> dict[str, object]:
    url = (
        f"https://{settings.azure_speech_region}.stt.speech.microsoft.com/"
        "speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed"
    )
    response = requests.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
            "Content-Type": "audio/wav",
            "Accept": "application/json",
        },
        data=audio_bytes,
        timeout=25,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Azure STT failed: {response.status_code} {response.text[:160]}")
    payload = response.json()
    status = str(payload.get("RecognitionStatus", ""))
    if status and status not in {"Success", "EndOfDictation"}:
        raise RuntimeError(f"Azure STT recognition status: {status}")

    nbest = payload.get("NBest") or []
    best = nbest[0] if nbest else {}
    transcript = str(best.get("Display") or payload.get("DisplayText") or "").strip()
    lexical = str(best.get("Lexical") or "").strip()
    confidence = _to_float(best.get("Confidence"))
    return {
        "transcript": transcript,
        "lexical": lexical,
        "confidence": confidence,
        "recognitionStatus": status or "Success",
        "raw": payload,
    }


def _build_interview_feedback(
    question: dict[str, object],
    transcript: str,
    duration_ms: int,
    stt_detail: dict[str, object],
) -> dict[str, object]:
    words = _interview_words(transcript)
    duration_seconds = max(0, round(duration_ms / 1000))
    minutes = max(duration_ms / 60000, 0.01)
    wpm = round(len(words) / minutes) if words else 0
    confidence = _to_float(stt_detail.get("confidence"))
    focus = str(question.get("focus", ""))
    prompt = str(question.get("interviewerText", ""))
    relevance = _topic_overlap(prompt, transcript)
    filler_count = sum(1 for word in words if word in INTERVIEW_FILLERS)
    unique_ratio = round(len(set(words)) / len(words), 2) if words else 0
    marker_count = _structure_marker_count(transcript)

    delivery_score = _delivery_score(duration_seconds, wpm, confidence, bool(transcript))
    language_score = _language_score(words, unique_ratio, filler_count)
    topic_score = _topic_score(words, relevance)
    organization_score = _organization_score(words, marker_count)

    rubric_scores = {
        "delivery": delivery_score,
        "languageUse": language_score,
        "topicDevelopment": topic_score,
        "organization": organization_score,
    }
    metrics = {
        "durationSeconds": duration_seconds,
        "wordCount": len(words),
        "wpm": wpm,
        "uniqueWordRatio": unique_ratio,
        "fillerCount": filler_count,
        "structureMarkerCount": marker_count,
        "promptKeywordOverlap": relevance,
        "recognitionConfidence": confidence,
    }

    dimensions = {
        "delivery": _delivery_feedback(duration_seconds, wpm, confidence, bool(transcript)),
        "languageUse": _language_feedback(words, unique_ratio, filler_count),
        "topicDevelopment": _topic_feedback(words, relevance, focus),
        "organization": _organization_feedback(words, marker_count),
    }
    return {
        "provider": "local-rule-v1",
        "aiProvider": settings.interview_ai_provider,
        "isOfficialScore": False,
        "noticeZh": "非官方训练反馈，仅用于复盘，不代表 ETS 官方评分。",
        "summaryZh": _interview_summary(dimensions, rubric_scores),
        "metrics": metrics,
        "dimensions": dimensions,
        "rubricScores": rubric_scores,
        "stt": {key: value for key, value in stt_detail.items() if key != "raw"},
    }


def _maybe_upgrade_interview_feedback_with_ai(
    question: dict[str, object],
    transcript: str,
    duration_ms: int,
    stt_detail: dict[str, object],
    baseline_feedback: dict[str, object],
) -> dict[str, object]:
    provider_name = settings.interview_ai_provider
    if provider_name != "deepseek":
        return baseline_feedback
    if not settings.deepseek_api_key.strip():
        upgraded = dict(baseline_feedback)
        upgraded["aiProviderStatus"] = "deepseek_not_configured"
        return upgraded
    try:
        return _generate_deepseek_interview_score(
            question=question,
            transcript=transcript,
            duration_ms=duration_ms,
            stt_detail=stt_detail,
            baseline_feedback=baseline_feedback,
        )
    except RuntimeError as exc:
        upgraded = dict(baseline_feedback)
        upgraded["aiProviderStatus"] = "deepseek_failed"
        upgraded["aiProviderError"] = str(exc)
        return upgraded


def _generate_deepseek_interview_score(
    question: dict[str, object],
    transcript: str,
    duration_ms: int,
    stt_detail: dict[str, object],
    baseline_feedback: dict[str, object],
) -> dict[str, object]:
    prompt = str(question.get("interviewerText", "")).strip()
    focus = str(question.get("focus", "")).strip()
    metrics = baseline_feedback.get("metrics", {})
    local_dimensions = baseline_feedback.get("dimensions", {})
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.deepseek_model,
        "stream": False,
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a TOEFL 2026 Speaking Interview training evaluator. "
                    "Score the student's open response using BOTH content and speech/STT metrics. "
                    "Do not claim to provide an official ETS score. Return strict JSON only."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Interview question: {prompt}\n"
                    f"Question focus: {focus}\n"
                    f"Student transcript: {transcript or '[empty transcript]'}\n"
                    f"Audio/STT metrics JSON: {json.dumps(metrics, ensure_ascii=False)}\n"
                    f"STT detail JSON: {json.dumps({k: v for k, v in stt_detail.items() if k != 'raw'}, ensure_ascii=False)}\n"
                    f"Baseline rule feedback JSON: {json.dumps(local_dimensions, ensure_ascii=False)}\n\n"
                    "Evaluate four dimensions on a 0-5 scale with one decimal allowed:\n"
                    "1. completeness: how fully the response answers the question and addresses the task.\n"
                    "2. delivery: fluency, pace, pauses, intelligibility, and speech confidence based on metrics.\n"
                    "3. languageUse: vocabulary, grammar, clarity, and sentence control based on transcript.\n"
                    "4. topicDevelopment: reasons, examples, details, and organization.\n"
                    "Then compute overallScore as a weighted training score: "
                    "completeness 30%, delivery 25%, languageUse 20%, topicDevelopment 25%.\n"
                    "Be practical and slightly strict. A short or unclear answer should not score high even if it is on topic.\n"
                    "Return JSON schema exactly: "
                    "{\"overallScore\": number, \"scores\": {\"completeness\": number, \"delivery\": number, "
                    "\"languageUse\": number, \"topicDevelopment\": number}, "
                    "\"summaryZh\": \"...\", \"strengthsZh\": [\"...\"], \"prioritiesZh\": [\"...\"], "
                    "\"nextPracticeZh\": \"...\", \"isOfficialScore\": false}"
                ),
            },
        ],
        "temperature": 0.2,
        "max_tokens": 650,
    }
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=35,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"DeepSeek scoring failed: {response.status_code} {response.text[:180]}")
    data = response.json()
    content = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("DeepSeek scoring response was not valid JSON") from exc

    scores = parsed.get("scores") if isinstance(parsed, dict) else {}
    if not isinstance(scores, dict):
        raise RuntimeError("DeepSeek scoring response did not include scores")

    normalized_scores = {
        "completeness": _clamp_score(scores.get("completeness")),
        "delivery": _clamp_score(scores.get("delivery")),
        "languageUse": _clamp_score(scores.get("languageUse")),
        "topicDevelopment": _clamp_score(scores.get("topicDevelopment")),
    }
    overall = _clamp_score(parsed.get("overallScore"))
    if overall == 0:
        overall = round(
            normalized_scores["completeness"] * 0.30
            + normalized_scores["delivery"] * 0.25
            + normalized_scores["languageUse"] * 0.20
            + normalized_scores["topicDevelopment"] * 0.25,
            1,
        )
    upgraded = dict(baseline_feedback)
    upgraded.update(
        {
            "provider": "deepseek-rubric-v1",
            "aiProvider": "deepseek",
            "aiProviderStatus": "scored",
            "model": settings.deepseek_model,
            "isOfficialScore": False,
            "noticeZh": "DeepSeek 非官方训练评分，仅用于复盘，不代表 ETS 官方评分。",
            "summaryZh": str(parsed.get("summaryZh") or baseline_feedback.get("summaryZh") or ""),
            "overallScore": overall,
            "rubricScores": normalized_scores,
            "strengthsZh": _clean_string_list(parsed.get("strengthsZh")),
            "prioritiesZh": _clean_string_list(parsed.get("prioritiesZh")),
            "nextPracticeZh": str(parsed.get("nextPracticeZh") or ""),
            "rawAiFeedback": parsed,
        }
    )
    return upgraded


def _clamp_score(value: object) -> float:
    score = _to_float(value)
    if score is None:
        return 0.0
    return round(max(0.0, min(5.0, score)), 1)


def _clean_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(str(item).split()) for item in value if str(item).strip()][:5]


def _reference_provider_name() -> str:
    provider_name = settings.interview_reference_provider
    if provider_name == "deepseek" and not settings.deepseek_api_key.strip():
        return "local"
    if provider_name in {"local", "deepseek", "openai", "qwen"}:
        return provider_name
    return "local"


def _reference_model_name(provider_name: str) -> str:
    if provider_name == "deepseek":
        return settings.deepseek_model
    if provider_name == "local":
        return "local-reference-v2"
    return "not-configured"


def _generate_reference_answer(
    question: dict[str, object],
    provider_name: str,
    model: str,
    target_level: str,
) -> dict[str, object]:
    if provider_name == "deepseek":
        try:
            return _generate_reference_answer_deepseek(question, model, target_level)
        except RuntimeError:
            # Keep the learning flow usable if a paid provider is temporarily unavailable.
            return _generate_reference_answer_local(question, target_level)
    return _generate_reference_answer_local(question, target_level)


def _generate_reference_answer_deepseek(
    question: dict[str, object],
    model: str,
    target_level: str,
) -> dict[str, object]:
    prompt = str(question.get("interviewerText", "")).strip()
    focus = str(question.get("focus", "")).strip()
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "stream": False,
        "thinking": {"type": "disabled"},
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You generate TOEFL-style spoken reference answers. "
                    "Use clear, natural, simple English. Do not use advanced vocabulary just to sound impressive. "
                    "Return strict JSON with answerText and learningPoints."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Question: {prompt}\n"
                    f"Focus: {focus}\n"
                    f"Target level: about {target_level}, not a perfect memorized answer.\n"
                    "Write one answer for about 45 seconds of speech, 80-110 words. "
                    "Structure: direct answer, one or two reasons, one small example, short closing. "
                    "Use simple sentences and practical phrases.\n"
                    "JSON schema: {\"answerText\":\"...\", \"learningPoints\":[\"...\", \"...\", \"...\"]}"
                ),
            },
        ],
        "temperature": 0.4,
        "max_tokens": 360,
    }
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"DeepSeek reference answer failed: {response.status_code} {response.text[:160]}")
    data = response.json()
    content = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("DeepSeek reference answer was not valid JSON") from exc
    answer_text = _clean_reference_answer(str(parsed.get("answerText", "")))
    learning_points = _clean_learning_points(parsed.get("learningPoints"))
    if not answer_text:
        raise RuntimeError("DeepSeek reference answer was empty")
    return {
        "answerText": answer_text,
        "learningPoints": learning_points,
        "wordCount": len(INTERVIEW_WORD_RE.findall(answer_text)),
    }


def _generate_reference_answer_local(question: dict[str, object], target_level: str) -> dict[str, object]:
    prompt = str(question.get("interviewerText", ""))
    focus = str(question.get("focus", ""))
    lowered = f"{prompt} {focus}".lower()
    if "study" in lowered and ("place" in lowered or "library" in lowered or "cafe" in lowered):
        answer_text = (
            "One place I usually study is a quiet area in the library. I like it because it is calm, "
            "and there are fewer distractions than in my room. For example, when I have a reading assignment, "
            "I can sit there for an hour, take notes, and finish the work without checking my phone too much. "
            "The library also has good lighting and enough space for my books. So for me, it is a simple but "
            "effective place to study."
        )
    elif "office hour" in lowered or "professor" in lowered or "teacher" in lowered:
        answer_text = (
            "I think meeting a teacher in person is usually more helpful for me. The main reason is that I can "
            "ask follow-up questions right away if I still feel confused. For example, if I do not understand a "
            "concept from class, I can show my notes and let the teacher point out the exact problem. Email is "
            "convenient, but it can be too brief. So when the topic is difficult, I prefer a short face-to-face meeting."
        )
    elif "group" in lowered or "team" in lowered or "project" in lowered:
        answer_text = (
            "For a group project, I think the best approach is to communicate early and divide the work clearly. "
            "This helps everyone know what they are responsible for. For example, the group can make a shared plan, "
            "set small deadlines, and check progress before the final week. If one person has a problem, the team can "
            "adjust instead of waiting until the last minute. This keeps the project organized and reduces stress."
        )
    elif "recommend" in lowered or "advice" in lowered or "suggest" in lowered:
        answer_text = (
            "I would recommend a simple and realistic solution. The school should make the service easy to use and "
            "clearly explain how it helps students. For example, it could offer short appointments, online sign-up, "
            "and a brief checklist so students know what to prepare. This would save time and make students more willing "
            "to try it. In my opinion, a small practical change is often more useful than a complicated new system."
        )
    elif "problem" in lowered or "why" in lowered or "should" in lowered:
        answer_text = (
            "I think the main issue is that students often need a clear reason to change their habits. If a rule or "
            "service feels confusing, they may ignore it even if it is useful. For example, students may skip a workshop "
            "if they do not understand how it helps their classes or daily life. A better solution is to explain the benefit "
            "with simple examples. That makes the idea easier to accept."
        )
    else:
        answer_text = (
            "My answer is that this can be useful if it is simple and practical. The main reason is that students are busy, "
            "so they need something that helps them quickly. For example, if a campus service gives clear steps and a useful "
            "example, students can apply it right away. It should not be too complicated or take too much time. Overall, I "
            "think a clear and realistic approach would help students more than a perfect but difficult plan."
        )
    answer_text = _trim_reference_answer(answer_text)
    return {
        "answerText": answer_text,
        "learningPoints": [
            "Start with a direct answer before giving reasons.",
            "Use simple reason phrases like 'The main reason is that...'.",
            "Add one concrete example so the answer feels developed.",
            f"Target: about {target_level}, clear and natural rather than memorized.",
        ],
        "wordCount": len(INTERVIEW_WORD_RE.findall(answer_text)),
    }
def _clean_reference_answer(text: str) -> str:
    return " ".join(text.split())


def _clean_learning_points(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    points = [" ".join(str(item).split()) for item in value if str(item).strip()]
    return points[:5]


def _trim_reference_answer(text: str) -> str:
    words = text.split()
    if len(words) <= 110:
        return text
    return " ".join(words[:110]).rstrip(" ,;:") + "."


def _reference_answer_row(row: object) -> dict[str, object]:
    if row is None:
        raise HTTPException(status_code=500, detail="Reference answer was not saved")
    item = row_to_dict(row)
    return {
        "id": item["id"],
        "setId": item["set_id"],
        "questionId": item["question_id"],
        "provider": item["provider"],
        "model": item["model"],
        "answerText": item["answer_text"],
        "learningPoints": json.loads(item["learning_points_json"] or "[]"),
        "targetLevel": item["target_level"],
        "wordCount": item["word_count"],
        "createdAt": item["created_at"],
    }


def _interview_words(text: str) -> list[str]:
    return [word.lower() for word in INTERVIEW_WORD_RE.findall(text)]


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _topic_overlap(prompt: str, transcript: str) -> float:
    prompt_words = {word for word in _interview_words(prompt) if word not in INTERVIEW_STOPWORDS and len(word) > 2}
    answer_words = {word for word in _interview_words(transcript) if word not in INTERVIEW_STOPWORDS and len(word) > 2}
    if not prompt_words or not answer_words:
        return 0.0
    return round(len(prompt_words & answer_words) / max(len(prompt_words), 1), 2)


def _structure_marker_count(text: str) -> int:
    lowered = text.lower()
    return sum(1 for marker in STRUCTURE_MARKERS if marker in lowered)


def _training_level(score: int) -> str:
    if score >= 4:
        return "on_track"
    if score >= 3:
        return "developing"
    return "needs_work"


def _delivery_score(duration_seconds: int, wpm: int, confidence: float | None, has_transcript: bool) -> int:
    score = 2 if has_transcript else 1
    if 35 <= duration_seconds <= 46:
        score += 1
    if 90 <= wpm <= 165:
        score += 1
    if confidence is not None and confidence >= 0.72:
        score += 1
    return min(score, 5)


def _language_score(words: list[str], unique_ratio: float, filler_count: int) -> int:
    if not words:
        return 1
    score = 2
    if len(words) >= 45:
        score += 1
    if unique_ratio >= 0.62:
        score += 1
    if filler_count <= 2:
        score += 1
    return min(score, 5)


def _topic_score(words: list[str], relevance: float) -> int:
    if not words:
        return 1
    score = 2
    if len(words) >= 35:
        score += 1
    if relevance >= 0.12:
        score += 1
    if len(words) >= 60:
        score += 1
    return min(score, 5)


def _organization_score(words: list[str], marker_count: int) -> int:
    if not words:
        return 1
    score = 2
    if len(words) >= 35:
        score += 1
    if marker_count >= 1:
        score += 1
    if marker_count >= 2:
        score += 1
    return min(score, 5)


def _delivery_feedback(
    duration_seconds: int,
    wpm: int,
    confidence: float | None,
    has_transcript: bool,
) -> dict[str, object]:
    messages: list[str] = []
    if not has_transcript:
        messages.append("没有得到可用转写；先确认麦克风音量和录音环境。")
    if duration_seconds < 25:
        messages.append("回答偏短，建议至少撑到 35 秒以上。")
    elif duration_seconds <= 46:
        messages.append("回答时长接近考试目标。")
    else:
        messages.append("回答到达或超过 45 秒，注意更早进入结论。")
    if wpm == 0:
        messages.append("语速暂时无法估算。")
    elif wpm < 85:
        messages.append("语速偏慢，可能有较多停顿。")
    elif wpm > 170:
        messages.append("语速偏快，注意清晰度和句间停顿。")
    else:
        messages.append("语速处在可训练区间。")
    if confidence is not None and confidence < 0.65:
        messages.append("识别置信度偏低，可能存在发音、音量或背景噪声问题。")
    return {"level": _training_level(_delivery_score(duration_seconds, wpm, confidence, has_transcript)), "messages": messages}


def _language_feedback(words: list[str], unique_ratio: float, filler_count: int) -> dict[str, object]:
    messages: list[str] = []
    if len(words) < 35:
        messages.append("语言量偏少，建议补充一个具体例子。")
    else:
        messages.append("语言量可以支撑基本回答。")
    if unique_ratio < 0.5 and words:
        messages.append("词汇重复较多，可以换用更具体的动词和名词。")
    else:
        messages.append("词汇重复度可接受。")
    if filler_count > 3:
        messages.append("填充词较多，下一次先想好第一句再开始。")
    return {"level": _training_level(_language_score(words, unique_ratio, filler_count)), "messages": messages}


def _topic_feedback(words: list[str], relevance: float, focus: str) -> dict[str, object]:
    messages: list[str] = []
    if not words:
        messages.append("还没有可分析的回答内容。")
    elif relevance < 0.08:
        messages.append("回答和题干关键词关联较弱，开头先直接回应问题。")
    else:
        messages.append("回答与题目主题有明确关联。")
    if len(words) < 45:
        messages.append("展开不足，建议加入原因、例子或结果。")
    else:
        messages.append("内容展开长度较合适。")
    if focus:
        messages.append(f"本题重点是 {focus}，复盘时检查是否围绕这个任务展开。")
    return {"level": _training_level(_topic_score(words, relevance)), "messages": messages}


def _organization_feedback(words: list[str], marker_count: int) -> dict[str, object]:
    messages: list[str] = []
    if not words:
        messages.append("还没有可分析的组织结构。")
    elif marker_count == 0:
        messages.append("结构信号不明显，建议使用 because / for example / so 连接回答。")
    elif marker_count == 1:
        messages.append("已有基本连接词，可以再加一个例子或总结。")
    else:
        messages.append("回答结构较清楚。")
    messages.append("推荐结构：answer → reason → example/detail → tie-back。")
    return {"level": _training_level(_organization_score(words, marker_count)), "messages": messages}


def _interview_summary(dimensions: dict[str, dict[str, object]], scores: dict[str, int]) -> str:
    if not scores:
        return "本次回答已保存，等待进一步复盘。"
    weakest = min(scores, key=scores.get)
    labels = {
        "delivery": "表达连续性",
        "languageUse": "语言使用",
        "topicDevelopment": "内容展开",
        "organization": "组织结构",
    }
    if scores[weakest] >= 4:
        return "这段回答整体稳定，下一轮可以追求更自然的表达和更具体的例子。"
    return f"优先改进{labels.get(weakest, weakest)}，下一次先把这一维做好。"


def _coerce_interview_status(value: str) -> str:
    allowed = {
        "not_scored",
        "pending",
        "scored",
        "failed",
        "feedback_ready",
        "empty_transcript",
        "failed_transcription",
        "stt_not_configured",
    }
    return value if value in allowed else "not_scored"


def _update_env_file(path: Path, updates: dict[str, str]) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    seen: set[str] = set()
    updated_lines: list[str] = []
    for line in existing:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            updated_lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            updated_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            updated_lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            updated_lines.append(f"{key}={value}")
    path.write_text("\n".join(updated_lines).rstrip() + "\n", encoding="utf-8")


def _coerce_answer_index(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _coerce_text_answer(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return ""


def _normalize_word_answer(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalpha())


def _with_accuracy(items: dict[str, dict[str, int]]) -> dict[str, dict[str, int]]:
    return {
        key: {
            **value,
            "accuracy": round((value["correct"] / value["total"]) * 100) if value["total"] else 0,
        }
        for key, value in items.items()
    }


def _estimated_reading_band(accuracy: int) -> str:
    if accuracy >= 90:
        return "5.5–6.0"
    if accuracy >= 80:
        return "5.0–5.5"
    if accuracy >= 70:
        return "4.0–5.0"
    if accuracy >= 60:
        return "3.0–4.0"
    if accuracy >= 45:
        return "2.0–3.0"
    return "1.0–2.0"


def _reading_summary(correct: int, total: int, accuracy: int) -> str:
    if total == 0:
        return "这套题还没有可评分题目。"
    if accuracy >= 85:
        return f"完成 {total} 题，答对 {correct} 题。整体表现稳定，下一步重点提高速度和难题判断。"
    if accuracy >= 70:
        return f"完成 {total} 题，答对 {correct} 题。基础理解不错，建议重点复盘错题证据和干扰项。"
    return f"完成 {total} 题，答对 {correct} 题。先放慢速度，优先训练定位关键词和句间逻辑。"


def _hydrate_scenario_defaults(scenario: dict[str, object]) -> dict[str, object]:
    hydrated = dict(scenario)
    hydrated.setdefault("topic", "general")
    hydrated.setdefault("sourceType", "curated")
    sentences = []
    for sentence in hydrated.get("sentences", []):
        sentence_item = dict(sentence)
        if not sentence_item.get("audioUrl"):
            sentence_item["audioUrl"] = f"/api/prompt-audio-file/{sentence_item['id']}.mp3"
        sentences.append(sentence_item)
    hydrated["sentences"] = sentences
    return hydrated


def _find_sentence(sentence_id: str) -> dict[str, str] | None:
    data = _load_scenarios()
    for scenario in data["scenarios"]:
        for sentence in scenario["sentences"]:
            if sentence["id"] == sentence_id:
                return sentence
    return None


def _current_sentence_ids() -> set[str]:
    data = _load_scenarios()
    return {
        str(sentence["id"])
        for scenario in data["scenarios"]
        for sentence in scenario.get("sentences", [])
        if sentence.get("id")
    }


def _current_attempt_dicts(rows: list[object], sentence_ids: set[str]) -> list[dict[str, object]]:
    return [item for row in rows if (item := row_to_dict(row)).get("sentence_id") in sentence_ids]


def _generate_prompt_audio(text: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    provider = settings.prompt_tts_provider
    errors: list[str] = []

    if provider in {"azure", "auto"} and settings.azure_configured:
        try:
            _generate_prompt_audio_azure(text, target)
            return
        except RuntimeError as exc:
            errors.append(f"azure: {exc}")
            if provider == "azure":
                raise RuntimeError(f"Prompt audio generation failed ({'; '.join(errors)})") from exc

    if provider in {"local", "auto"}:
        try:
            _generate_prompt_audio_local(text, target)
            return
        except RuntimeError as exc:
            errors.append(f"local: {exc}")
            if provider == "local":
                raise RuntimeError(f"Prompt audio generation failed ({'; '.join(errors)})") from exc

    if not errors:
        errors.append(f"unsupported provider '{provider}'")
    raise RuntimeError(f"Prompt audio generation failed ({'; '.join(errors)})")


def _generate_prompt_audio_azure(text: str, target: Path) -> None:
    escaped = html.escape(text)
    ssml = (
        "<speak version='1.0' xml:lang='en-US'>"
        f"<voice xml:lang='en-US' name='{settings.prompt_azure_voice}'>{escaped}</voice>"
        "</speak>"
    )
    url = f"https://{settings.azure_speech_region}.tts.speech.microsoft.com/cognitiveservices/v1"
    response = requests.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
            "User-Agent": "toefl-listen-repeat",
        },
        data=ssml.encode("utf-8"),
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Azure TTS request failed: {response.status_code} {response.text[:200]}")
    target.write_bytes(response.content)


def _generate_prompt_audio_local(text: str, target: Path) -> None:
    if shutil.which("say") is None:
        raise RuntimeError("macOS 'say' command is unavailable")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("'ffmpeg' is unavailable")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        aiff_path = tmp / "prompt.aiff"
        subprocess.run(
            ["say", "-v", settings.prompt_voice, "-r", settings.prompt_rate, "-o", str(aiff_path), text],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(aiff_path),
                "-ar",
                "24000",
                "-ac",
                "1",
                "-b:a",
                "96k",
                str(target),
            ],
            check=True,
            capture_output=True,
            text=True,
        )


def _path_requires_auth(path: str) -> bool:
    open_api_paths = {"/api/health", "/api/config", "/api/auth/login"}
    if path in open_api_paths:
        return False
    if path.startswith("/api/"):
        return True
    if path.startswith("/recordings/"):
        return True
    if path.startswith("/prompt-audio/"):
        return True
    return False


def _is_authenticated(request: Request) -> bool:
    if not settings.access_protection_enabled:
        return True
    token = request.cookies.get(settings.session_cookie_name, "")
    return token == settings.access_session_token


def _ensure_visitor_id(request: Request) -> str:
    existing = getattr(request.state, "visitor_id", None)
    if isinstance(existing, str) and existing:
        return existing
    candidate = request.cookies.get(settings.visitor_cookie_name, "")
    if not _is_valid_visitor_id(candidate):
        candidate = str(uuid.uuid4())
        request.state.visitor_cookie_needs_set = True
    request.state.visitor_id = candidate
    return candidate


def _set_visitor_cookie(response, request: Request) -> None:
    visitor_id = _ensure_visitor_id(request)
    if not getattr(request.state, "visitor_cookie_needs_set", False):
        return
    response.set_cookie(
        key=settings.visitor_cookie_name,
        value=visitor_id,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=60 * 60 * 24 * 365,
        path="/",
    )


def _visitor_id(request: Request) -> str:
    return _ensure_visitor_id(request)


def _is_valid_visitor_id(value: str) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def _upgrade_normalized(normalized: dict[str, object]) -> dict[str, object]:
    issues = normalized.get("issues", {})
    words = normalized.get("words", [])
    scores = normalized.get("scores", {})
    if not isinstance(issues, dict):
        issues = {}
    if not isinstance(words, list):
        words = []
    if not isinstance(scores, dict):
        scores = {}

    if "diagnostics" not in normalized:
        normalized["diagnostics"] = {
            "totalWords": len(words),
            "omissionCount": len(issues.get("omissions", [])),
            "insertionCount": len(issues.get("insertions", [])),
            "mispronunciationCount": len(issues.get("mispronunciations", [])),
            "repetitionCount": len(issues.get("repetitions", [])),
            "lowWordCount": len(issues.get("low_score_words", [])),
            "lowPhonemeCount": len(issues.get("low_score_phonemes", [])),
            "prosodyAvailable": scores.get("prosody") is not None,
        }
    if "detailedFeedback" not in normalized:
        summary = str(normalized.get("summary", "")).strip()
        next_action = str(normalized.get("nextAction", "")).strip()
        fallback = [item for item in [summary, next_action] if item]
        normalized["detailedFeedback"] = fallback or ["继续练习当前句，目标是提高准确度和完整度。"]
    return normalized


def _frontend_index_file() -> Path | None:
    index_file = settings.frontend_dist_dir / "index.html"
    if index_file.exists():
        return index_file
    return None


@app.get("/", include_in_schema=False)
def frontend_index():
    index_file = _frontend_index_file()
    if index_file is None:
        raise HTTPException(status_code=404, detail="Frontend dist not found. Build frontend first.")
    return FileResponse(index_file)


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_spa(full_path: str):
    protected_prefixes = ("api/", "recordings/", "prompt-audio/")
    if full_path.startswith(protected_prefixes):
        raise HTTPException(status_code=404, detail="Not Found")

    dist_dir = settings.frontend_dist_dir
    candidate = (dist_dir / full_path).resolve()
    try:
        candidate.relative_to(dist_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found")

    if candidate.exists() and candidate.is_file():
        return FileResponse(candidate)

    index_file = _frontend_index_file()
    if index_file is None:
        raise HTTPException(status_code=404, detail="Frontend dist not found. Build frontend first.")
    return FileResponse(index_file)
