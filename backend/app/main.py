from __future__ import annotations

from pathlib import Path
import hashlib
import html
import json
import shutil
import subprocess
import tempfile
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
        return await call_next(request)
    if not _path_requires_auth(request.url.path):
        return await call_next(request)
    if _is_authenticated(request):
        return await call_next(request)
    return JSONResponse({"detail": "Access password required."}, status_code=401)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def config_status(request: Request) -> dict[str, object]:
    return {
        "azureConfigured": settings.azure_configured,
        "azureRegion": settings.azure_speech_region or None,
        "envPath": str(Path(".env").resolve()),
        "frontendServing": settings.frontend_dist_dir.exists(),
        "frontendDistDir": str(settings.frontend_dist_dir.resolve()),
        "requiresPassword": settings.access_protection_enabled,
        "authenticated": _is_authenticated(request),
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


@app.get("/api/reinforcement-scenario")
def reinforcement_scenario() -> dict[str, object]:
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            ORDER BY created_at DESC
            LIMIT 600
            """
        ).fetchall()
    scenario = build_reinforcement_scenario([row_to_dict(row) for row in rows])
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
                azure_raw_json, normalized_json, tags_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
def attempts(limit: int = 100) -> dict[str, object]:
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            "SELECT * FROM attempts ORDER BY created_at DESC LIMIT ?",
            (min(limit, 500),),
        ).fetchall()
    items = [row_to_dict(row) for row in rows]
    for item in items:
        normalized = json.loads(item.pop("normalized_json"))
        item["normalized"] = _upgrade_normalized(normalized)
        item["tags"] = json.loads(item.pop("tags_json"))
        item.pop("azure_raw_json", None)
        item["audioUrl"] = f"/recordings/{item['scenario_id']}/{item['id']}.wav"
    return {"attempts": items}


@app.get("/api/training-plan")
def training_plan(limit: int = 200) -> dict[str, object]:
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (min(limit, 1000),),
        ).fetchall()
    return build_training_plan([row_to_dict(row) for row in rows])


@app.get("/api/session-analytics")
def session_analytics(limit: int = 120) -> dict[str, object]:
    with connect(settings.database_path) as conn:
        rows = conn.execute(
            """
            SELECT id, sentence_id, reference_text, normalized_json, created_at
            FROM attempts
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (min(limit, 500),),
        ).fetchall()
    return build_session_analytics([row_to_dict(row) for row in rows])


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
