import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, Check, Mic, Play, RotateCcw, Square, Target } from "lucide-react";
import {
  fetchAppConfig,
  fetchAttempts,
  fetchReinforcementScenario,
  fetchScenarios,
  fetchTrainingPlan,
  loginWithPassword,
  saveAttempt,
} from "./api";
import { assessPronunciation } from "./azurePronunciation";
import { playPrompt } from "./tts";
import type { AppConfig, AttemptResult, PracticeSentence, ScenarioPack, TrainingPlan } from "./types";
import { WavRecorder } from "./wavRecorder";
import "./styles.css";

type RecordingState =
  | "idle"
  | "playing"
  | "readyToRecord"
  | "requestingMic"
  | "recording"
  | "scoring"
  | "scored"
  | "error";

function App() {
  const [scenarios, setScenarios] = useState<ScenarioPack[]>([]);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [state, setState] = useState<RecordingState>("idle");
  const [status, setStatus] = useState("Loading scenarios...");
  const [attempts, setAttempts] = useState<Record<string, AttemptResult>>({});
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");
  const [micHint, setMicHint] = useState("");
  const [buildingReinforcement, setBuildingReinforcement] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const recorderRef = useRef<WavRecorder | null>(null);
  const localAudioUrlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let disposed = false;
    async function boot() {
      try {
        const config = await fetchAppConfig();
        if (disposed) return;
        setAppConfig(config);
        if (config.requiresPassword && !config.authenticated) {
          setStatus("Unlock required");
          return;
        }
        await loadPracticeData(disposed);
      } catch (err) {
        if (disposed) return;
        setError(errorMessage(err));
        setState("error");
      }
    }
    void boot();
    refreshMicrophoneHint();
    return () => {
      disposed = true;
      for (const url of Object.values(localAudioUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  async function loadPracticeData(disposed = false) {
    const [scenarioItems, planData, attemptItems] = await Promise.all([
      fetchScenarios(),
      fetchTrainingPlan(),
      fetchAttempts(),
    ]);
    if (disposed) return;
    setScenarios(scenarioItems);
    setPlan(planData);
    setAttempts(mapAttemptsBySentence(attemptItems));
    setStatus("Ready");
  }

  const scenario = scenarios[scenarioIndex];
  const sentence = scenario?.sentences[sentenceIndex];
  const attempt = sentence ? attempts[sentence.id] : null;
  const completedCount = useMemo(
    () => scenario?.sentences.filter((item) => attempts[item.id]).length ?? 0,
    [attempts, scenario]
  );
  const recommendedEntries = useMemo(() => {
    if (!plan) return [];
    const entries: { sentenceId: string; label: string; score: number | null }[] = [];
    for (const sentenceId of plan.recommendedSentenceIds) {
      const located = locateSentence(sentenceId, scenarios);
      if (!located) continue;
      const attemptForSentence = attempts[sentenceId];
      entries.push({
        sentenceId,
        label: `${located.scenarioTitle} · S${located.order}`,
        score: attemptForSentence?.normalized.scores.repeatAccuracy ?? null,
      });
    }
    return entries;
  }, [attempts, plan, scenarios]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!sentence || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (state === "recording") {
          void stopAndScore();
        } else if (state === "readyToRecord") {
          void startRecording();
        } else if (state === "idle" || state === "scored") {
          void play();
        }
      }
      if (event.key === "Enter" && state === "scored") {
        nextSentence();
      }
      if (
        event.key.toLowerCase() === "r" &&
        state !== "recording" &&
        state !== "scoring" &&
        state !== "requestingMic"
      ) {
        resetCurrent();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  async function play() {
    if (!sentence) return;
    setError("");
    setState("playing");
    setStatus("Playing prompt...");
    try {
      await playPrompt(sentence);
      setState("readyToRecord");
      setStatus("Ready to record");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  async function startRecording() {
    setError("");
    setMicHint("");
    setState("requestingMic");
    setStatus("Requesting microphone permission...");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose microphone recording for this page.");
      }
      recorderRef.current = new WavRecorder();
      await recorderRef.current.start();
      setState("recording");
      setStatus("Recording your repeat...");
      setMicHint("Microphone is active.");
    } catch (err) {
      const message = microphoneErrorMessage(err);
      setError(message);
      setMicHint(message);
      setState("readyToRecord");
      setStatus("Microphone was not started");
      void refreshMicrophoneHint();
    }
  }

  async function stopAndScore() {
    if (!sentence || !scenario || !recorderRef.current) return;
    setState("scoring");
    setStatus(appConfig?.azureConfigured ? "Scoring with Azure Pronunciation Assessment..." : "Azure is not configured");
    setError("");
    try {
      const recorded = await recorderRef.current.stop();
      if (appConfig && !appConfig.azureConfigured) {
        throw new Error(
          `Azure scoring is not configured. Create ${appConfig.envPath} with AZURE_SPEECH_KEY and AZURE_SPEECH_REGION, then restart the backend.`
        );
      }
      const azureRaw = await assessPronunciation(sentence.text, recorded.blob);
      const saved = await saveAttempt({
        scenarioId: scenario.id,
        sentenceId: sentence.id,
        referenceText: sentence.text,
        durationMs: recorded.durationMs,
        azureRaw,
        audioBlob: recorded.blob
      });
      const localAudioUrl = URL.createObjectURL(recorded.blob);
      setAttempts((prev) => {
        const previousLocal = prev[sentence.id]?.localAudioUrl;
        if (previousLocal) {
          URL.revokeObjectURL(previousLocal);
          delete localAudioUrlsRef.current[sentence.id];
        }
        localAudioUrlsRef.current[sentence.id] = localAudioUrl;
        return { ...prev, [sentence.id]: { ...saved, localAudioUrl } };
      });
      setPlan(await fetchTrainingPlan());
      setState("scored");
      setStatus("Scored");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
      setStatus("Scoring failed");
    }
  }

  function nextSentence() {
    if (!scenario) return;
    setError("");
    if (sentenceIndex < scenario.sentences.length - 1) {
      setSentenceIndex((value) => value + 1);
      setState("idle");
      setStatus("Ready");
      return;
    }
    setStatus("Set complete. Review the training plan.");
  }

  function resetCurrent() {
    setError("");
    setMicHint("");
    setState("idle");
    setStatus("Ready");
  }

  function selectScenario(index: number) {
    setScenarioIndex(index);
    setSentenceIndex(0);
    setState("idle");
    setStatus("Ready");
    setError("");
  }

  async function buildReinforcementPack() {
    setBuildingReinforcement(true);
    setError("");
    setStatus("Building reinforcement pack...");
    try {
      const reinforcement = await fetchReinforcementScenario();
      setScenarios((current) => {
        const existingIndex = current.findIndex((item) => item.id === reinforcement.id);
        if (existingIndex >= 0) {
          const updated = [...current];
          updated[existingIndex] = reinforcement;
          setScenarioIndex(existingIndex);
          return updated;
        }
        const updated = [...current, reinforcement];
        setScenarioIndex(updated.length - 1);
        return updated;
      });
      setSentenceIndex(0);
      setState("idle");
      setStatus("Reinforcement pack ready");
    } catch (err) {
      setError(errorMessage(err));
      setStatus("Failed to build reinforcement pack");
    } finally {
      setBuildingReinforcement(false);
    }
  }

  async function unlockApp() {
    setAuthLoading(true);
    setAuthError("");
    try {
      await loginWithPassword(authPassword);
      const config = await fetchAppConfig();
      setAppConfig(config);
      if (config.requiresPassword && !config.authenticated) {
        throw new Error("Password accepted but session was not established.");
      }
      await loadPracticeData(false);
      setAuthPassword("");
      setStatus("Ready");
    } catch (err) {
      setAuthError(errorMessage(err));
    } finally {
      setAuthLoading(false);
    }
  }

  function jumpToSentence(sentenceId: string) {
    const located = locateSentence(sentenceId, scenarios);
    if (!located) return;
    setScenarioIndex(located.scenarioIndex);
    setSentenceIndex(located.sentenceIndex);
    setState(attempts[sentenceId] ? "scored" : "idle");
    setStatus(attempts[sentenceId] ? "Scored" : "Ready");
    setError("");
  }

  if (appConfig?.requiresPassword && !appConfig.authenticated) {
    return (
      <main className="authShell">
        <section className="authCard">
          <h1>Protected Trainer</h1>
          <p>Enter the shared access password to use this app.</p>
          <input
            type="password"
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
            placeholder="Access password"
          />
          <button disabled={authLoading || !authPassword.trim()} onClick={unlockApp}>
            {authLoading ? "Unlocking..." : "Unlock"}
          </button>
          {authError ? <div className="errorBox">{authError}</div> : null}
        </section>
      </main>
    );
  }

  if (!scenario || !sentence) {
    return (
      <main className="appShell">
        <section className="emptyState">{error || status}</section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Target size={22} />
          <div>
            <strong>Listen and Repeat</strong>
            <span>Azure pronunciation assessment</span>
          </div>
        </div>

        <label className="fieldLabel" htmlFor="scenario">
          Scenario
        </label>
        <select id="scenario" value={scenarioIndex} onChange={(event) => selectScenario(Number(event.target.value))}>
          {scenarios.map((item, index) => (
            <option value={index} key={item.id}>
              {item.title}
            </option>
          ))}
        </select>

        <div className="progressBlock">
          <div className="progressTop">
            <span>{completedCount}/7 scored</span>
            <span>{scenario.level}</span>
          </div>
          <div className="progressTrack">
            <div style={{ width: `${(completedCount / scenario.sentences.length) * 100}%` }} />
          </div>
        </div>

        <div className="sentenceRail">
          {scenario.sentences.map((item, index) => (
            <button
              className={index === sentenceIndex ? "railItem active" : "railItem"}
              key={item.id}
              onClick={() => {
                setSentenceIndex(index);
                setState(attempts[item.id] ? "scored" : "idle");
              }}
            >
              <span>{item.order}</span>
              {attempts[item.id] ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <section className="planPanel">
          <div className="panelTitle">
            <BarChart3 size={16} />
            Training Plan
          </div>
          <p>{plan?.headline ?? "Complete one sentence to build your plan."}</p>
          <div className="tagList">
            {plan?.focus.map((item) => <span key={item}>{item}</span>)}
          </div>
          <button onClick={buildReinforcementPack} disabled={buildingReinforcement}>
            {buildingReinforcement ? "Building..." : "Build Reinforcement Pack"}
          </button>
          {recommendedEntries.length ? (
            <div className="planGroup">
              <h3>Recommended Drill Queue</h3>
              <div className="drillQueue">
                {recommendedEntries.map((entry) => (
                  <button key={entry.sentenceId} onClick={() => jumpToSentence(entry.sentenceId)}>
                    {entry.label}
                    <small>{entry.score == null ? "-" : `Repeat ${Math.round(entry.score)}`}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {plan?.weakWords.length ? (
            <div className="planGroup">
              <h3>Weak Words</h3>
              <div className="tagList">
                {plan.weakWords.slice(0, 8).map((item) => <span key={item.text}>{item.text} ×{item.count}</span>)}
              </div>
            </div>
          ) : null}
          {plan?.weakPhonemes.length ? (
            <div className="planGroup">
              <h3>Weak Phonemes</h3>
              <div className="tagList">
                {plan.weakPhonemes.slice(0, 6).map((item) => <span key={item.text}>{item.text} ×{item.count}</span>)}
              </div>
            </div>
          ) : null}
        </section>
      </aside>

      <section className="practice">
        <header className="practiceHeader">
          <div>
            <span className="eyebrow">{scenario.context}</span>
            <h1>Sentence {sentence.order}</h1>
          </div>
          <div className={`statePill ${state}`}>
            <Activity size={15} />
            {status}
          </div>
        </header>

        {appConfig && !appConfig.azureConfigured ? <AzureSetupBanner envPath={appConfig.envPath} /> : null}

        <section className="examSurface">
          <div className="hiddenPrompt">
            {attempt ? sentence.text : "Prompt text is hidden until this sentence is scored."}
          </div>
          <div className="controls">
            <button onClick={play} disabled={state === "playing" || state === "recording" || state === "scoring"}>
              <Play size={18} />
              Play Prompt
            </button>
            <button
              onClick={startRecording}
              disabled={state === "playing" || state === "recording" || state === "scoring" || state === "requestingMic"}
            >
              <Mic size={18} />
              {state === "requestingMic" ? "Waiting for Mic" : "Start Recording"}
            </button>
            <button onClick={stopAndScore} disabled={state !== "recording"}>
              <Square size={18} />
              Stop & Score
            </button>
            <button onClick={resetCurrent} disabled={state === "recording" || state === "scoring" || state === "requestingMic"}>
              <RotateCcw size={18} />
              Reset
            </button>
            <button onClick={nextSentence} disabled={state !== "scored"}>
              Next
            </button>
          </div>
          <div className="keyboardHints">Space: next action · Enter: next sentence · R: reset</div>
          {state === "readyToRecord" || state === "requestingMic" ? (
            <div className="readyNotice">
              <Mic size={18} />
              {state === "requestingMic"
                ? "Waiting for the browser microphone permission prompt..."
                : "Say the sentence now, then stop and score."}
            </div>
          ) : null}
          {micHint && micHint !== error ? <div className="micHint">{micHint}</div> : null}
          {state === "recording" ? (
            <div className="recordingNotice">
              <Mic size={18} />
              Recording now
            </div>
          ) : null}
          {error ? <div className="errorBox">{error}</div> : null}
        </section>

        {attempt ? <Feedback sentence={sentence} attempt={attempt} /> : <Placeholder />}
      </section>
    </main>
  );
}

function Feedback({ attempt }: { sentence: PracticeSentence; attempt: AttemptResult }) {
  const score = attempt.normalized.scores;
  const issues = attempt.normalized.issues;
  const diagnostics = attempt.normalized.diagnostics;
  const playbackUrl = attempt.localAudioUrl || attempt.audioUrl;
  return (
    <section className="feedbackGrid">
      <Metric label="Repeat" value={score.repeatAccuracy} />
      <Metric label="Pronunciation" value={score.accuracy} />
      <Metric label="Fluency" value={score.fluency} />
      <Metric label="Completeness" value={score.completeness} />
      <Metric label="Prosody" value={score.prosody} fallbackLabel={diagnostics.prosodyAvailable ? "-" : "N/A"} />

      <section className="widePanel">
        <h2>Immediate Feedback</h2>
        <audio controls src={playbackUrl} preload="metadata" />
        <p><strong>Recognized:</strong> {attempt.normalized.recognizedText || "(empty)"}</p>
        <p>{attempt.normalized.summary}</p>
        <p>{attempt.normalized.nextAction}</p>
        <div className="tagList">
          <span>Total words {diagnostics.totalWords}</span>
          <span>Omissions {diagnostics.omissionCount}</span>
          <span>Insertions {diagnostics.insertionCount}</span>
          <span>Mispronunciations {diagnostics.mispronunciationCount}</span>
          <span>Low phonemes {diagnostics.lowPhonemeCount}</span>
        </div>
      </section>

      <section className="widePanel">
        <h2>Detailed Coaching</h2>
        <ul className="feedbackList">
          {attempt.normalized.detailedFeedback.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="widePanel">
        <h2>Word Detail</h2>
        <div className="wordStrip">
          {attempt.normalized.words.map((word, index) => (
            <span className={wordClass(word.errorType, word.accuracy)} key={`${word.word}-${index}`}>
              {word.word}
              <small>{word.accuracy ?? "-"}</small>
            </span>
          ))}
        </div>
      </section>

      <IssuePanel title="Missing" items={issues.omissions} />
      <IssuePanel title="Inserted" items={issues.insertions} />
      <IssuePanel title="Mispronounced" items={issues.mispronunciations} />
      <IssuePanel
        title="Low words"
        items={issues.low_score_words.slice(0, 8).map((item) => `${item.word} ${Math.round(item.accuracy)}`)}
      />
      <IssuePanel
        title="Low phonemes"
        items={issues.low_score_phonemes.slice(0, 8).map((item) => `${item.word} /${item.phoneme}/ ${item.accuracy}`)}
      />
    </section>
  );
}

function Metric({ label, value, fallbackLabel = "-" }: { label: string; value: number | null; fallbackLabel?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value == null ? fallbackLabel : Math.round(value)}</strong>
    </div>
  );
}

function IssuePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="issuePanel">
      <h2>{title}</h2>
      {items.length ? (
        <div className="tagList">{items.map((item) => <span key={item}>{item}</span>)}</div>
      ) : (
        <p>No major issue.</p>
      )}
    </section>
  );
}

function Placeholder() {
  return (
    <section className="placeholder">
      Listen once, repeat once, then score. The source sentence stays hidden until scoring finishes.
    </section>
  );
}

function AzureSetupBanner({ envPath }: { envPath: string }) {
  return (
    <section className="setupBanner">
      <strong>Azure scoring is not configured.</strong>
      <span>
        Recording works, but scoring needs <code>AZURE_SPEECH_KEY</code> and <code>AZURE_SPEECH_REGION</code> in{" "}
        <code>{envPath}</code>. Restart the backend after saving the file.
      </span>
    </section>
  );
}

function wordClass(errorType: string, accuracy: number | null): string {
  const type = errorType.toLowerCase();
  if (type !== "none") return `wordToken ${type}`;
  if (accuracy != null && accuracy < 70) return "wordToken low";
  if (accuracy != null && accuracy >= 85) return "wordToken good";
  return "wordToken";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function microphoneErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("Permission denied") || message.includes("NotAllowedError")) {
    return "Microphone permission was blocked. Click the microphone icon in the browser address bar, allow access, then try again.";
  }
  if (message.includes("NotFoundError") || message.includes("DevicesNotFoundError")) {
    return "No microphone was found. Check your input device and macOS microphone settings.";
  }
  if (message.includes("NotReadableError")) {
    return "The microphone is busy or blocked by the operating system. Close other recording apps and try again.";
  }
  return `Microphone could not start: ${message}`;
}

async function refreshMicrophoneHint(): Promise<void> {
  try {
    const permissions = navigator.permissions as Permissions & {
      query(permissionDesc: { name: "microphone" }): Promise<PermissionStatus>;
    };
    const status = await permissions.query({ name: "microphone" });
    if (status.state === "denied") {
      // Keep this as a console warning so it does not clutter first-run UI.
      console.warn("Microphone permission is currently denied for this origin.");
    }
  } catch {
    // Some browsers do not support querying microphone permission state.
  }
}

function mapAttemptsBySentence(items: AttemptResult[]): Record<string, AttemptResult> {
  const mapped: Record<string, AttemptResult> = {};
  for (const item of items) {
    const sentenceId = item.sentence_id;
    if (!sentenceId) continue;
    if (!mapped[sentenceId]) {
      mapped[sentenceId] = item;
    }
  }
  return mapped;
}

function locateSentence(
  sentenceId: string,
  scenarios: ScenarioPack[]
): { scenarioIndex: number; sentenceIndex: number; scenarioTitle: string; order: number } | null {
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    for (let sentenceIndex = 0; sentenceIndex < scenario.sentences.length; sentenceIndex += 1) {
      const sentence = scenario.sentences[sentenceIndex];
      if (sentence.id === sentenceId) {
        return {
          scenarioIndex,
          sentenceIndex,
          scenarioTitle: scenario.title,
          order: sentence.order,
        };
      }
    }
  }
  return null;
}

createRoot(document.getElementById("root")!).render(<App />);
