import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, BookOpen, Check, Clock, MessageSquare, Mic, Play, RotateCcw, Square, Target, TrendingUp } from "lucide-react";
import {
  fetchAppConfig,
  fetchAttempts,
  fetchInterviewAttempts,
  fetchInterviewSet,
  fetchInterviewSets,
  generateInterviewReferenceAnswer,
  fetchReadingSet,
  fetchReadingSets,
  fetchReinforcementScenario,
  fetchScenarios,
  fetchSessionAnalytics,
  fetchTrainingPlan,
  loginWithPassword,
  saveAttempt,
  saveDeepSeekConfig,
  saveInterviewAttempt,
  submitReadingAttempt,
} from "./api";
import { assessPronunciation } from "./azurePronunciation";
import { playPrompt } from "./tts";
import type {
  AppConfig,
  AttemptResult,
  InterviewAttempt,
  InterviewQuestion,
  InterviewReferenceAnswer,
  InterviewSet,
  InterviewSetSummary,
  PracticeSentence,
  ReadingAttemptResult,
  ReadingSection,
  ReadingSet,
  ReadingSetSummary,
  ScenarioPack,
  SessionAnalytics,
  TrainingPlan,
} from "./types";
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

type AppModule = "speaking" | "reading";
type SpeakingMode = "listen" | "interview";

function App() {
  const [module, setModule] = useState<AppModule>("speaking");
  const [speakingMode, setSpeakingMode] = useState<SpeakingMode>("listen");
  const [scenarios, setScenarios] = useState<ScenarioPack[]>([]);
  const [readingSets, setReadingSets] = useState<ReadingSetSummary[]>([]);
  const [interviewSets, setInterviewSets] = useState<InterviewSetSummary[]>([]);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [state, setState] = useState<RecordingState>("idle");
  const [status, setStatus] = useState("正在加载练习内容...");
  const [attempts, setAttempts] = useState<Record<string, AttemptResult>>({});
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [analytics, setAnalytics] = useState<SessionAnalytics | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");
  const [micHint, setMicHint] = useState("");
  const [buildingReinforcement, setBuildingReinforcement] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [readingLoadError, setReadingLoadError] = useState("");
  const [interviewLoadError, setInterviewLoadError] = useState("");
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
          setStatus("需要先解锁");
          return;
        }
        await loadPracticeData(disposed);
        await loadReadingData(disposed);
        await loadInterviewData(disposed);
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
    const [scenarioItems, planData, attemptItems, analyticsData] = await Promise.all([
      fetchScenarios(),
      fetchTrainingPlan(),
      fetchAttempts(),
      fetchSessionAnalytics(),
    ]);
    if (disposed) return;
    setScenarios(scenarioItems);
    setPlan(planData);
    setAttempts(mapAttemptsBySentence(attemptItems));
    setAnalytics(analyticsData);
    setStatus("准备就绪");
  }

  async function loadReadingData(disposed = false) {
    try {
      const readingItems = await fetchReadingSets();
      if (disposed) return;
      setReadingSets(readingItems);
      setReadingLoadError("");
    } catch (err) {
      if (disposed) return;
      setReadingLoadError(errorMessage(err));
    }
  }

  async function loadInterviewData(disposed = false) {
    try {
      const interviewItems = await fetchInterviewSets();
      if (disposed) return;
      setInterviewSets(interviewItems);
      setInterviewLoadError("");
    } catch (err) {
      if (disposed) return;
      setInterviewLoadError(errorMessage(err));
    }
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
  const reviewQueueEntries = useMemo(() => {
    if (!plan?.reviewQueue) return [];
    return plan.reviewQueue
      .map((item) => {
        const located = locateSentence(item.sentenceId, scenarios);
        return {
          ...item,
          label: located ? `${located.scenarioTitle} · S${located.order}` : item.sentenceId,
        };
      })
      .filter((item) => item.label);
  }, [plan, scenarios]);

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
    setStatus("正在播放提示音...");
    try {
      await playPrompt(sentence);
      setState("readyToRecord");
      setStatus("可以开始录音了");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  }

  async function startRecording() {
    setError("");
    setMicHint("");
    setState("requestingMic");
    setStatus("正在请求麦克风权限...");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持在这个页面上进行麦克风录音。");
      }
      recorderRef.current = new WavRecorder();
      await recorderRef.current.start();
      setState("recording");
      setStatus("正在录下你的复述...");
      setMicHint("麦克风已开启。");
    } catch (err) {
      const message = microphoneErrorMessage(err);
      setError(message);
      setMicHint(message);
      setState("readyToRecord");
      setStatus("麦克风未成功启动");
      void refreshMicrophoneHint();
    }
  }

  async function stopAndScore() {
    if (!sentence || !scenario || !recorderRef.current) return;
    setState("scoring");
    setStatus(appConfig?.azureConfigured ? "正在使用 Azure 发音评测打分..." : "Azure 评分尚未配置");
    setError("");
    try {
      const recorded = await recorderRef.current.stop();
      if (appConfig && !appConfig.azureConfigured) {
        throw new Error(
          `Azure 评分尚未配置。请在 ${appConfig.envPath} 中填写 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION，然后重启后端。`
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
      const [nextPlan, nextAnalytics] = await Promise.all([fetchTrainingPlan(), fetchSessionAnalytics()]);
      setPlan(nextPlan);
      setAnalytics(nextAnalytics);
      setState("scored");
      setStatus("评分完成");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
      setStatus("评分失败");
    }
  }

  function nextSentence() {
    if (!scenario) return;
    setError("");
    if (sentenceIndex < scenario.sentences.length - 1) {
      setSentenceIndex((value) => value + 1);
      setState("idle");
      setStatus("准备就绪");
      return;
    }
    setStatus("本组完成，可以查看训练计划。");
  }

  function resetCurrent() {
    setError("");
    setMicHint("");
    setState("idle");
    setStatus("准备就绪");
  }

  function selectScenario(index: number) {
    setScenarioIndex(index);
    setSentenceIndex(0);
    setState("idle");
    setStatus("准备就绪");
    setError("");
  }

  async function buildReinforcementPack() {
    setBuildingReinforcement(true);
    setError("");
    setStatus("正在生成强化练习包...");
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
      setStatus("强化练习包已生成");
    } catch (err) {
      setError(errorMessage(err));
      setStatus("强化练习包生成失败");
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
        throw new Error("密码验证通过，但会话没有成功建立。");
      }
      await loadPracticeData(false);
      await loadReadingData(false);
      await loadInterviewData(false);
      setAuthPassword("");
      setStatus("准备就绪");
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
    setStatus(attempts[sentenceId] ? "评分完成" : "准备就绪");
    setError("");
  }

  if (appConfig?.requiresPassword && !appConfig.authenticated) {
    return (
      <main className="authShell">
        <section className="authCard">
          <h1>训练器已加锁</h1>
          <p>请输入访问密码后继续使用。</p>
          <input
            type="password"
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
            placeholder="请输入访问密码"
          />
          <button disabled={authLoading || !authPassword.trim()} onClick={unlockApp}>
            {authLoading ? "正在解锁..." : "解锁进入"}
          </button>
          {authError ? <div className="errorBox">{authError}</div> : null}
        </section>
      </main>
    );
  }

  if (module === "reading") {
    return (
      <ReadingPractice
        appModule={module}
        onSwitchModule={setModule}
        readingSets={readingSets}
        loadError={readingLoadError}
        onReload={() => loadReadingData(false)}
      />
    );
  }

  if (speakingMode === "interview") {
    return (
      <InterviewPractice
        appModule={module}
        onSwitchModule={setModule}
        activeMode={speakingMode}
        onSwitchMode={setSpeakingMode}
        interviewSets={interviewSets}
        appConfig={appConfig}
        onAppConfigChange={setAppConfig}
        loadError={interviewLoadError}
        onReload={() => loadInterviewData(false)}
      />
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
          <strong>托福口语训练</strong>
          <span>Speaking · Listen & Interview</span>
          </div>
        </div>

        <ModuleSwitcher activeModule={module} onSwitch={setModule} />
        <SpeakingModeSwitcher activeMode={speakingMode} onSwitch={setSpeakingMode} />

        <label className="fieldLabel" htmlFor="scenario">
          Listen and Repeat 套题
        </label>
        <select id="scenario" value={scenarioIndex} onChange={(event) => selectScenario(Number(event.target.value))}>
          {scenarios.map((item, index) => (
            <option value={index} key={item.id}>
              {scenarioLabel(item, index)}
            </option>
          ))}
        </select>

        <div className="progressBlock">
          <div className="progressTop">
            <span>已评分 {completedCount}/{scenario.sentences.length}</span>
            <span>{levelLabel(scenario.level)}</span>
          </div>
          <div className="progressTrack">
            <div style={{ width: `${(completedCount / scenario.sentences.length) * 100}%` }} />
          </div>
        </div>

        <div className="sentenceRail">
          {scenario.sentences.map((item, index) => (
            <button
              className={`railItem ${item.difficultyStage || ""}${index === sentenceIndex ? " active" : ""}`}
              key={item.id}
              onClick={() => {
                setSentenceIndex(index);
                setState(attempts[item.id] ? "scored" : "idle");
              }}
            >
              <span>{item.order}</span>
              <small>{sentenceStageLabel(item.difficultyStage)}</small>
              {attempts[item.id] ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <section className="planPanel">
          <div className="panelTitle">
            <BarChart3 size={16} />
            训练计划
          </div>
          <p>{plan?.headline ?? "先完成一句练习，系统会生成训练计划。"}</p>
          {plan?.reviewSummary ? <div className="reviewSummary">{plan.reviewSummary.headline}</div> : null}
          <div className="tagList">
            {plan?.focus.map((item) => <span key={item}>{item}</span>)}
          </div>
          <button onClick={buildReinforcementPack} disabled={buildingReinforcement}>
            {buildingReinforcement ? "生成中..." : "生成强化练习包"}
          </button>
          {reviewQueueEntries.length ? (
            <div className="planGroup">
              <h3>执行型回练队列</h3>
              <div className="reviewQueue">
                {reviewQueueEntries.map((item) => (
                  <button key={item.sentenceId} className="reviewCard" onClick={() => jumpToSentence(item.sentenceId)}>
                    <div className="reviewCardTop">
                      <strong>{item.label}</strong>
                      <span className={`priorityBadge ${item.priority}`}>{item.priorityLabel}</span>
                    </div>
                    <small>
                      最近 {scoreText(item.latestRepeatAccuracy)} · 平均 {scoreText(item.averageRepeatAccuracy)} ·
                      尝试 {item.attempts} 次
                    </small>
                    <div className="tagList compactTags">
                      <span>{item.reviewStageLabel}</span>
                      <span>{item.dueLabel}</span>
                    </div>
                    <p>{item.reason}</p>
                    <p className="reviewAction">{item.suggestedAction}</p>
                    {item.focusWords.length || item.focusPhonemes.length ? (
                      <div className="tagList compactTags">
                        {item.focusWords.map((word) => (
                          <span key={`${item.sentenceId}-${word}`}>{word}</span>
                        ))}
                        {item.focusPhonemes.map((phoneme) => (
                          <span key={`${item.sentenceId}-${phoneme}`}>{phoneme}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {recommendedEntries.length ? (
            <div className="planGroup">
              <h3>推荐回练队列</h3>
              <div className="drillQueue">
                {recommendedEntries.map((entry) => (
                  <button key={entry.sentenceId} onClick={() => jumpToSentence(entry.sentenceId)}>
                    {entry.label}
                    <small>{entry.score == null ? "-" : `复述分 ${Math.round(entry.score)}`}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {plan?.weakWords.length ? (
            <div className="planGroup">
              <h3>薄弱词</h3>
              <div className="tagList">
                {plan.weakWords.slice(0, 8).map((item) => <span key={item.text}>{item.text} ×{item.count}</span>)}
              </div>
            </div>
          ) : null}
          {plan?.weakPhonemes.length ? (
            <div className="planGroup">
              <h3>薄弱音素</h3>
              <div className="tagList">
                {plan.weakPhonemes.slice(0, 6).map((item) => <span key={item.text}>{item.text} ×{item.count}</span>)}
              </div>
            </div>
          ) : null}
        </section>

        <AnalyticsPanel analytics={analytics} scenarios={scenarios} onJumpToSentence={jumpToSentence} />
      </aside>

      <section className="practice">
        <header className="practiceHeader">
          <div>
            <span className="eyebrow">{scenario.context}</span>
            <h1>句子 {sentence.order}</h1>
            <div className="sentenceMeta">
              <span>{sentenceStageLabel(sentence.difficultyStage)}</span>
              {sentence.estimatedSyllables ? <span>{sentence.estimatedSyllables} 音节</span> : null}
            </div>
          </div>
          <div className={`statePill ${state}`}>
            <Activity size={15} />
            {status}
          </div>
        </header>

        {appConfig && !appConfig.azureConfigured ? <AzureSetupBanner envPath={appConfig.envPath} /> : null}

        <section className="examSurface">
          <div className="hiddenPrompt">
            {attempt ? sentence.text : "这句的英文原文会在评分后显示。"}
          </div>
          <div className="controls">
            <button onClick={play} disabled={state === "playing" || state === "recording" || state === "scoring"}>
              <Play size={18} />
              播放提示音
            </button>
            <button
              onClick={startRecording}
              disabled={state === "playing" || state === "recording" || state === "scoring" || state === "requestingMic"}
            >
              <Mic size={18} />
              {state === "requestingMic" ? "等待麦克风" : "开始录音"}
            </button>
            <button onClick={stopAndScore} disabled={state !== "recording"}>
              <Square size={18} />
              停止并评分
            </button>
            <button onClick={resetCurrent} disabled={state === "recording" || state === "scoring" || state === "requestingMic"}>
              <RotateCcw size={18} />
              重置
            </button>
            <button onClick={nextSentence} disabled={state !== "scored"}>
              下一句
            </button>
          </div>
          <div className="keyboardHints">空格：下一步操作 · Enter：下一句 · R：重置</div>
          {state === "readyToRecord" || state === "requestingMic" ? (
            <div className="readyNotice">
              <Mic size={18} />
              {state === "requestingMic"
                ? "正在等待浏览器弹出麦克风授权窗口..."
                : "现在请复述这句，完成后停止并评分。"}
            </div>
          ) : null}
          {micHint && micHint !== error ? <div className="micHint">{micHint}</div> : null}
          {state === "recording" ? (
            <div className="recordingNotice">
              <Mic size={18} />
              正在录音
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
      <Metric label="复述分" value={score.repeatAccuracy} />
      <Metric label="发音准确度" value={score.accuracy} />
      <Metric label="流利度" value={score.fluency} />
      <Metric label="完整度" value={score.completeness} />
      <Metric label="韵律" value={score.prosody} fallbackLabel={diagnostics.prosodyAvailable ? "-" : "无"} />

      <section className="widePanel">
        <h2>即时反馈 / Immediate Feedback</h2>
        <audio controls src={playbackUrl} preload="metadata" />
        <p><strong>识别结果 Recognized:</strong> {attempt.normalized.recognizedText || "（空）"}</p>
        <p>{attempt.normalized.summary}</p>
        <p>{attempt.normalized.nextAction}</p>
        <div className="tagList">
          <span>总词数 {diagnostics.totalWords}</span>
          <span>漏读 {diagnostics.omissionCount}</span>
          <span>多读 {diagnostics.insertionCount}</span>
          <span>发音偏差 {diagnostics.mispronunciationCount}</span>
          <span>低分音素 {diagnostics.lowPhonemeCount}</span>
        </div>
      </section>

      <section className="widePanel">
        <h2>详细建议 / Coaching</h2>
        <ul className="feedbackList">
          {attempt.normalized.detailedFeedback.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="widePanel">
        <h2>词级详情 / Word Detail</h2>
        <div className="wordStrip">
          {attempt.normalized.words.map((word, index) => (
            <span className={wordClass(word.errorType, word.accuracy)} key={`${word.word}-${index}`}>
              {word.word}
              <small>{word.accuracy ?? "-"}</small>
            </span>
          ))}
        </div>
      </section>

      <IssuePanel title="漏读" items={issues.omissions} />
      <IssuePanel title="多读" items={issues.insertions} />
      <IssuePanel title="发音偏差" items={issues.mispronunciations} />
      <IssuePanel
        title="低分词"
        items={issues.low_score_words.slice(0, 8).map((item) => `${item.word} ${Math.round(item.accuracy)}`)}
      />
      <IssuePanel
        title="低分音素"
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
        <p>没有明显问题。</p>
      )}
    </section>
  );
}

function Placeholder() {
  return (
    <section className="placeholder">
      听一遍，复述一遍，再评分。正式英文原句会在评分完成后显示。
    </section>
  );
}

function ModuleSwitcher({ activeModule, onSwitch }: { activeModule: AppModule; onSwitch: (module: AppModule) => void }) {
  return (
    <div className="moduleSwitcher">
      <button className={activeModule === "speaking" ? "active" : ""} onClick={() => onSwitch("speaking")}>
        <Target size={15} />
        口语
      </button>
      <button className={activeModule === "reading" ? "active" : ""} onClick={() => onSwitch("reading")}>
        <BookOpen size={15} />
        阅读
      </button>
    </div>
  );
}

function SpeakingModeSwitcher({
  activeMode,
  onSwitch,
}: {
  activeMode: SpeakingMode;
  onSwitch: (mode: SpeakingMode) => void;
}) {
  return (
    <div className="speakingModeSwitcher">
      <button className={activeMode === "listen" ? "active" : ""} onClick={() => onSwitch("listen")}>
        <Target size={15} />
        Listen and Repeat
      </button>
      <button className={activeMode === "interview" ? "active" : ""} onClick={() => onSwitch("interview")}>
        <MessageSquare size={15} />
        Interview
      </button>
    </div>
  );
}

function InterviewPractice({
  appModule,
  onSwitchModule,
  activeMode,
  onSwitchMode,
  interviewSets,
  appConfig,
  onAppConfigChange,
  loadError,
  onReload,
}: {
  appModule: AppModule;
  onSwitchModule: (module: AppModule) => void;
  activeMode: SpeakingMode;
  onSwitchMode: (mode: SpeakingMode) => void;
  interviewSets: InterviewSetSummary[];
  appConfig: AppConfig | null;
  onAppConfigChange: (config: AppConfig) => void;
  loadError: string;
  onReload: () => Promise<void>;
}) {
  const [selectedSetId, setSelectedSetId] = useState("");
  const [interviewSet, setInterviewSet] = useState<InterviewSet | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [state, setState] = useState<RecordingState>("idle");
  const [status, setStatus] = useState("准备就绪");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(45);
  const [attempts, setAttempts] = useState<Record<string, InterviewAttempt>>({});
  const recorderRef = useRef<WavRecorder | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const localAudioUrlsRef = useRef<Record<string, string>>({});

  const activeSetId = selectedSetId || interviewSets[0]?.id || "";
  const question = interviewSet?.questions[questionIndex] ?? null;
  const currentAttempt = question ? attempts[question.id] : null;
  const completedCount = interviewSet?.questions.filter((item) => attempts[item.id]).length ?? 0;
  const answerSeconds = question?.answerSeconds ?? interviewSet?.answerSeconds ?? 45;

  useEffect(() => {
    if (!selectedSetId && interviewSets[0]) {
      setSelectedSetId(interviewSets[0].id);
    }
  }, [interviewSets, selectedSetId]);

  useEffect(() => {
    if (!activeSetId) return;
    let disposed = false;
    async function loadSet() {
      setLoading(true);
      setError("");
      try {
        const [setDetail, recentAttempts] = await Promise.all([
          fetchInterviewSet(activeSetId),
          fetchInterviewAttempts(),
        ]);
        if (disposed) return;
        setInterviewSet(setDetail);
        setAttempts(mapInterviewAttemptsByQuestion(recentAttempts.filter((item) => item.setId === activeSetId)));
        setQuestionIndex(0);
        setState("idle");
        setStatus("准备就绪");
        setRemainingSeconds(setDetail.answerSeconds);
      } catch (err) {
        if (disposed) return;
        setError(errorMessage(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadSet();
    return () => {
      disposed = true;
    };
  }, [activeSetId]);

  useEffect(() => {
    if (state !== "recording") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemainingSeconds(Math.max(answerSeconds - elapsed, 0));
    }, 250);
    return () => window.clearInterval(timer);
  }, [answerSeconds, state]);

  useEffect(() => {
    return () => {
      if (autoStopRef.current) {
        window.clearTimeout(autoStopRef.current);
      }
      void recorderRef.current?.stop().catch(() => null);
      for (const url of Object.values(localAudioUrlsRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  async function playQuestionAndRecord() {
    if (!question) return;
    setError("");
    setState("playing");
    setStatus("正在播放 interviewer 提问...");
    try {
      await playPrompt(interviewPromptAsSentence(question));
      await startInterviewRecording();
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
      setStatus("播放失败");
    }
  }

  async function startInterviewRecording() {
    if (!question) return;
    setError("");
    setState("requestingMic");
    setStatus("正在请求麦克风权限...");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持在这个页面上进行麦克风录音。");
      }
      recorderRef.current = new WavRecorder();
      await recorderRef.current.start();
      setRemainingSeconds(answerSeconds);
      setState("recording");
      setStatus("正在录制 45 秒回答...");
      if (autoStopRef.current) {
        window.clearTimeout(autoStopRef.current);
      }
      autoStopRef.current = window.setTimeout(() => {
        void stopInterviewRecording();
      }, answerSeconds * 1000);
    } catch (err) {
      setError(microphoneErrorMessage(err));
      setState("idle");
      setStatus("麦克风未成功启动");
    }
  }

  async function stopInterviewRecording() {
    if (!question || !interviewSet || !recorderRef.current) return;
    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    setSaving(true);
    setState("scoring");
    setStatus("正在保存并生成训练反馈...");
    setError("");
    try {
      const recorded = await recorderRef.current.stop();
      recorderRef.current = null;
      const saved = await saveInterviewAttempt({
        setId: interviewSet.id,
        questionId: question.id,
        durationMs: recorded.durationMs,
        audioBlob: recorded.blob,
      });
      const localAudioUrl = URL.createObjectURL(recorded.blob);
      setAttempts((current) => {
        const previousLocal = current[question.id]?.localAudioUrl;
        if (previousLocal) {
          URL.revokeObjectURL(previousLocal);
          delete localAudioUrlsRef.current[question.id];
        }
        localAudioUrlsRef.current[question.id] = localAudioUrl;
        return { ...current, [question.id]: { ...saved, localAudioUrl } };
      });
      setState("scored");
      setStatus(interviewStatusLabel(saved.scoringStatus));
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
      setStatus("保存失败");
    } finally {
      setSaving(false);
    }
  }

  function selectQuestion(index: number) {
    setQuestionIndex(index);
    setState(attempts[interviewSet?.questions[index]?.id ?? ""] ? "scored" : "idle");
    setStatus(attempts[interviewSet?.questions[index]?.id ?? ""] ? "回答已保存" : "准备就绪");
    setError("");
    setRemainingSeconds(interviewSet?.questions[index]?.answerSeconds ?? interviewSet?.answerSeconds ?? 45);
  }

  function nextQuestion() {
    if (!interviewSet) return;
    if (questionIndex < interviewSet.questions.length - 1) {
      selectQuestion(questionIndex + 1);
      return;
    }
    setStatus("这套 Interview 已完成，可以复盘四段回答。");
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Target size={22} />
          <div>
            <strong>托福口语训练</strong>
            <span>Speaking · Listen & Interview</span>
          </div>
        </div>
        <ModuleSwitcher activeModule={appModule} onSwitch={onSwitchModule} />
        <SpeakingModeSwitcher activeMode={activeMode} onSwitch={onSwitchMode} />

        <label className="fieldLabel" htmlFor="interview-set">
          Interview 套题
        </label>
        <select
          id="interview-set"
          value={activeSetId}
          onChange={(event) => setSelectedSetId(event.target.value)}
          disabled={!interviewSets.length || state === "recording"}
        >
          {interviewSets.map((item, index) => (
            <option value={item.id} key={item.id}>
              {interviewSetLabel(item, index)}
            </option>
          ))}
        </select>

        <div className="progressBlock">
          <div className="progressTop">
            <span>已完成 {completedCount}/4</span>
            <span>{levelLabel((interviewSet?.difficulty || interviewSets[0]?.difficulty || "medium") as ScenarioPack["level"])}</span>
          </div>
          <div className="progressTrack">
            <div style={{ width: `${(completedCount / 4) * 100}%` }} />
          </div>
        </div>

        <div className="interviewRail">
          {interviewSet?.questions.map((item, index) => (
            <button
              className={`interviewRailItem${index === questionIndex ? " active" : ""}`}
              key={item.id}
              onClick={() => selectQuestion(index)}
              disabled={state === "recording" || state === "scoring"}
            >
              <span>Q{item.order}</span>
              <small>{interviewFocusLabel(item.focus)}</small>
              {attempts[item.id] ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <section className="planPanel">
          <div className="panelTitle">
            <MessageSquare size={16} />
            Interview 计划
          </div>
          <p>{interviewSet?.descriptionZh || "选择一套模拟面试，按 4 段完成回答。"}</p>
          <div className="tagList">
            <span>4 问</span>
            <span>每题 45 秒</span>
            <span>{interviewSet?.theme || interviewSets[0]?.theme || "campus"}</span>
          </div>
          <button onClick={() => void onReload()}>刷新题库</button>
        </section>

        <DeepSeekSettingsPanel appConfig={appConfig} onAppConfigChange={onAppConfigChange} />
      </aside>

      <section className="practice interviewPractice">
        <header className="practiceHeader">
          <div>
            <span className="eyebrow">Take an Interview · 4 responses · 45 seconds each</span>
            <h1>{interviewSet?.title || "Interview"}</h1>
          </div>
          <div className={`statePill ${state}`}>
            <Activity size={15} />
            {state === "recording" ? `剩余 ${remainingSeconds}s` : status}
          </div>
        </header>

        {loadError ? <div className="errorBox">{loadError}</div> : null}
        {error ? <div className="errorBox">{error}</div> : null}
        {loading ? <section className="emptyState">正在加载 Interview 题库...</section> : null}
        {!loading && !interviewSet ? <section className="emptyState">还没有可用 Interview 题库。</section> : null}

        {question ? (
          <section className="examSurface interviewSurface">
            <div className="interviewPromptTop">
              <span>Question {question.order}</span>
              <span>{interviewFocusLabel(question.focus)}</span>
            </div>
            <div className="interviewerPrompt hiddenInterviewPrompt">
              正式练习中不显示 interviewer 原文。请先听问题，再作答；完成后会在复盘里显示文字。
            </div>
            <div className="controls">
              <button onClick={playQuestionAndRecord} disabled={state === "playing" || state === "recording" || state === "scoring" || state === "requestingMic"}>
                <Play size={18} />
                播放并开始回答
              </button>
              <button onClick={startInterviewRecording} disabled={state === "playing" || state === "recording" || state === "scoring" || state === "requestingMic"}>
                <Mic size={18} />
                直接开始录音
              </button>
              <button onClick={stopInterviewRecording} disabled={state !== "recording" || saving}>
                <Square size={18} />
                结束并保存
              </button>
              <button onClick={nextQuestion} disabled={!currentAttempt || state === "recording" || state === "scoring"}>
                下一题
              </button>
            </div>
            <div className="keyboardHints">Interview v2 会生成非官方训练反馈，不代表 ETS 官方评分。</div>
            {state === "recording" ? (
              <div className="recordingNotice">
                <Mic size={18} />
                正在录制回答，45 秒后自动结束
              </div>
            ) : null}
          </section>
        ) : null}

        {interviewSet ? (
          <>
            <InterviewSetSummaryPanel interviewSet={interviewSet} attempts={attempts} />
            <section className="feedbackGrid interviewReviewGrid">
              {interviewSet.questions.map((item) => (
                <InterviewReviewCard key={item.id} question={item} attempt={attempts[item.id]} />
              ))}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function InterviewSetSummaryPanel({
  interviewSet,
  attempts,
}: {
  interviewSet: InterviewSet;
  attempts: Record<string, InterviewAttempt>;
}) {
  const completed = interviewSet.questions
    .map((item) => attempts[item.id])
    .filter((item): item is InterviewAttempt => Boolean(item));
  if (!completed.length) {
    return (
      <section className="widePanel interviewSummaryPanel">
        <h2>整套复盘</h2>
        <p className="mutedText">完成至少一题后，这里会汇总四维训练反馈。</p>
      </section>
    );
  }
  const scoreKeys = ["delivery", "languageUse", "topicDevelopment", "organization"];
  const scored = completed.filter((item) =>
    scoreKeys.some((key) => Number(item.rubricScores?.[key]) > 0)
  );
  if (!scored.length) {
    return (
      <section className="widePanel interviewSummaryPanel">
        <div className="interviewReviewHeader">
          <div>
            <span className="eyebrow">Interview Summary</span>
            <h2>非官方训练反馈</h2>
          </div>
          <span className="priorityBadge later">已完成 {completed.length}/4</span>
        </div>
        <p className="mutedText">这些是 v2 前保存的旧记录；重新录一题后会生成 transcript、WPM 和四维训练反馈。</p>
      </section>
    );
  }
  const averages = Object.fromEntries(
    scoreKeys.map((key) => [
      key,
      Math.round(
        scored.reduce((sum, item) => sum + (Number(item.rubricScores?.[key]) || 0), 0) / scored.length
      ),
    ])
  ) as Record<string, number>;
  const weakest = scoreKeys.reduce((lowest, key) => (averages[key] < averages[lowest] ? key : lowest), scoreKeys[0]);
  return (
    <section className="widePanel interviewSummaryPanel">
      <div className="interviewReviewHeader">
        <div>
          <span className="eyebrow">Interview Summary</span>
          <h2>非官方训练反馈</h2>
        </div>
        <span className="priorityBadge later">已反馈 {scored.length}/4</span>
      </div>
      <p>
        当前最该优先打磨：{interviewDimensionLabel(weakest)}。这些数字是训练参考，不是官方分数。
      </p>
      <div className="tagList">
        {scoreKeys.map((key) => (
          <span key={key}>
            {interviewDimensionLabel(key)} {averages[key]}/5
          </span>
        ))}
      </div>
    </section>
  );
}

function DeepSeekSettingsPanel({
  appConfig,
  onAppConfigChange,
}: {
  appConfig: AppConfig | null;
  onAppConfigChange: (config: AppConfig) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(appConfig?.deepSeekModel || "deepseek-v4-flash");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (appConfig?.deepSeekModel) {
      setModel(appConfig.deepSeekModel);
    }
  }, [appConfig?.deepSeekModel]);

  async function saveConfig() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await saveDeepSeekConfig({
        apiKey,
        model,
        enable: true,
      });
      onAppConfigChange({
        ...(appConfig as AppConfig),
        ...result,
      });
      setApiKey("");
      setMessage("DeepSeek 评分已启用。新录的 Interview 会使用综合评分。");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="planPanel deepSeekPanel">
      <div className="panelTitle">
        <MessageSquare size={16} />
        DeepSeek 评分
      </div>
      <p>
        {appConfig?.deepSeekConfigured
          ? "已配置。新回答会使用 DeepSeek 综合评分，参考答案也会优先用 DeepSeek 生成。"
          : "粘贴 API key 后启用综合评分和贴题参考答案。"}
      </p>
      <input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder="sk-..."
        autoComplete="off"
      />
      <select value={model} onChange={(event) => setModel(event.target.value)}>
        <option value="deepseek-v4-flash">deepseek-v4-flash</option>
        <option value="deepseek-chat">deepseek-chat</option>
        <option value="deepseek-reasoner">deepseek-reasoner</option>
      </select>
      <button onClick={saveConfig} disabled={saving || !apiKey.trim()}>
        {saving ? "保存中..." : "保存并启用"}
      </button>
      {message ? <div className="micHint">{message}</div> : null}
      {error ? <div className="errorBox">{error}</div> : null}
    </section>
  );
}

function InterviewReviewCard({ question, attempt }: { question: InterviewQuestion; attempt?: InterviewAttempt }) {
  const playbackUrl = attempt?.localAudioUrl || attempt?.audioUrl || "";
  const feedback = attempt?.aiFeedback;
  const metrics = feedback?.metrics;
  const dimensions = feedback?.dimensions;
  const [referenceAnswer, setReferenceAnswer] = useState<InterviewReferenceAnswer | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceError, setReferenceError] = useState("");

  useEffect(() => {
    setReferenceAnswer(null);
    setReferenceError("");
  }, [attempt?.id]);

  async function loadReferenceAnswer(force = false) {
    if (!attempt) return;
    setReferenceLoading(true);
    setReferenceError("");
    try {
      const generated = await generateInterviewReferenceAnswer({
        setId: attempt.setId,
        questionId: question.id,
        attemptId: attempt.id,
        force,
      });
      setReferenceAnswer(generated);
    } catch (err) {
      setReferenceError(errorMessage(err));
    } finally {
      setReferenceLoading(false);
    }
  }

  return (
    <section className="widePanel interviewReviewCard">
      <div className="interviewReviewHeader">
        <div>
          <span className="eyebrow">Question {question.order}</span>
          <h2>{interviewFocusLabel(question.focus)}</h2>
        </div>
        <span className={`priorityBadge ${attempt ? "later" : ""}`}>
          {attempt ? interviewStatusLabel(attempt.scoringStatus) : "未完成"}
        </span>
      </div>
      <p>{question.reviewHintZh}</p>
      {attempt ? (
        <>
          <div className="reviewPromptText">
            <strong>Interviewer Prompt</strong>
            <p>{question.interviewerText}</p>
          </div>
          <audio controls src={playbackUrl} preload="metadata" />
          {typeof feedback?.overallScore === "number" ? (
            <div className="interviewScorePanel">
              <span>DeepSeek 综合训练分</span>
              <strong>{feedback.overallScore.toFixed(1)}/5</strong>
              <small>{feedback.noticeZh || "非官方训练评分，仅用于复盘。"}</small>
            </div>
          ) : null}
          <div className="tagList compactTags">
            <span>回答 {Math.round(attempt.durationMs / 1000)} 秒</span>
            <span>{interviewDurationLabel(attempt.durationMs)}</span>
            <span>{metrics?.wpm ? `${metrics.wpm} WPM` : "WPM -"}</span>
            <span>{metrics?.wordCount ?? 0} 词</span>
            <span>{feedback?.provider === "deepseek-rubric-v1" ? "DeepSeek 评分" : "本地规则反馈"}</span>
          </div>
          <div className="transcriptBox">
            <strong>Transcript</strong>
            <p>{attempt.transcript || "暂时没有可用转写。录音已保存，可以继续复盘或稍后重试。"}</p>
          </div>
          {feedback?.summaryZh ? <p className="interviewFeedbackSummary">{feedback.summaryZh}</p> : null}
          {feedback?.strengthsZh?.length ? (
            <div className="aiFeedbackList">
              <strong>做得好的地方</strong>
              <ul>{feedback.strengthsZh.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          {feedback?.prioritiesZh?.length ? (
            <div className="aiFeedbackList priority">
              <strong>优先改进</strong>
              <ul>{feedback.prioritiesZh.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
          {feedback?.nextPracticeZh ? <p className="reviewAction">{feedback.nextPracticeZh}</p> : null}
          {feedback?.stt?.error ? <div className="errorBox compactError">转写提示：{feedback.stt.error}</div> : null}
          {dimensions ? (
            <div className="interviewDimensionGrid">
              {(["delivery", "languageUse", "topicDevelopment", "organization"] as const).map((key) => (
                <div className="interviewDimensionCard" key={key}>
                  <div className="interviewDimensionTop">
                    <strong>{interviewDimensionLabel(key)}</strong>
                    <span className={`dimensionLevel ${dimensions[key].level}`}>{interviewLevelLabel(dimensions[key].level)}</span>
                  </div>
                  <ul>
                    {dimensions[key].messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <section className="referenceAnswerPanel">
            <div className="interviewReviewHeader">
              <div>
                <span className="eyebrow">Reference Answer</span>
                <h2>4.5/5 训练目标</h2>
              </div>
              {referenceAnswer ? <span className="priorityBadge later">{referenceAnswer.provider}</span> : null}
            </div>
            <p className="mutedText">完成回答后再看参考答案。目标是清楚、自然、简单，而不是背复杂范文。</p>
            {referenceAnswer ? (
              <>
                <div className="referenceAnswerText">{referenceAnswer.answerText}</div>
                <div className="tagList compactTags">
                  <span>{referenceAnswer.wordCount} 词</span>
                  <span>{referenceAnswer.targetLevel}</span>
                  <span>{referenceAnswer.model}</span>
                </div>
                {referenceAnswer.learningPoints.length ? (
                  <ul className="referencePointList">
                    {referenceAnswer.learningPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                ) : null}
                <button onClick={() => void loadReferenceAnswer(true)} disabled={referenceLoading}>
                  {referenceLoading ? "生成中..." : "重新生成"}
                </button>
              </>
            ) : (
              <button onClick={() => void loadReferenceAnswer(false)} disabled={referenceLoading}>
                {referenceLoading ? "生成中..." : "生成参考答案"}
              </button>
            )}
            {referenceError ? <div className="errorBox compactError">{referenceError}</div> : null}
          </section>
        </>
      ) : (
        <p className="mutedText">完成本题后这里会显示录音回放和回答时长。</p>
      )}
    </section>
  );
}

function ReadingPractice({
  appModule,
  onSwitchModule,
  readingSets,
  loadError,
  onReload,
}: {
  appModule: AppModule;
  onSwitchModule: (module: AppModule) => void;
  readingSets: ReadingSetSummary[];
  loadError: string;
  onReload: () => Promise<void>;
}) {
  const [selectedSetId, setSelectedSetId] = useState("");
  const [readingSet, setReadingSet] = useState<ReadingSet | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [result, setResult] = useState<ReadingAttemptResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const activeSetId = selectedSetId || readingSets[0]?.id || "";

  useEffect(() => {
    if (!selectedSetId && readingSets[0]) {
      setSelectedSetId(readingSets[0].id);
    }
  }, [readingSets, selectedSetId]);

  useEffect(() => {
    if (!activeSetId) return;
    let disposed = false;
    async function loadSet() {
      setLoading(true);
      setError("");
      try {
        const item = await fetchReadingSet(activeSetId);
        if (disposed) return;
        setReadingSet(item);
        setAnswers({});
        setResult(null);
        setElapsedMs(0);
        setStartedAt(Date.now());
      } catch (err) {
        if (disposed) return;
        setError(errorMessage(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadSet();
    return () => {
      disposed = true;
    };
  }, [activeSetId]);

  useEffect(() => {
    if (startedAt == null || result) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [result, startedAt]);

  const totalQuestions = useMemo(() => readingSet?.sections.reduce((sum, section) => sum + readingSectionItemCount(section), 0) ?? 0, [readingSet]);
  const answeredCount = useMemo(() => countReadingAnswers(readingSet, answers), [answers, readingSet]);
  const remainingCount = Math.max(totalQuestions - answeredCount, 0);

  async function submit() {
    if (!readingSet) return;
    if (remainingCount > 0) {
      setError(`还有 ${remainingCount} 题未完成，请答完后再提交。`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const scored = await submitReadingAttempt({
        setId: readingSet.id,
        answers,
        elapsedMs,
      });
      setResult(scored);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="appShell readingShell">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={22} />
          <div>
            <strong>托福阅读训练</strong>
            <span>2026 新制题型</span>
          </div>
        </div>
        <ModuleSwitcher activeModule={appModule} onSwitch={onSwitchModule} />

        <label className="fieldLabel" htmlFor="reading-set">
          阅读套题
        </label>
        <select
          id="reading-set"
          value={activeSetId}
          onChange={(event) => setSelectedSetId(event.target.value)}
          disabled={!readingSets.length}
        >
          {readingSets.map((item, index) => (
            <option value={item.id} key={item.id}>
              {readingSetLabel(item, index)}
            </option>
          ))}
        </select>

        <section className="planPanel">
          <div className="panelTitle">
            <Clock size={16} />
            阅读计划
          </div>
          <p>{readingSet?.descriptionZh || "先选择一套阅读短练，完成后查看技能拆解。"}</p>
          <div className="tagList">
            <span>{totalQuestions || readingSets[0]?.questionCount || 0} 题</span>
            <span>{readingSet?.estimatedMinutes || readingSets[0]?.estimatedMinutes || 10} 分钟</span>
            <span>{levelLabel((readingSet?.difficulty || readingSets[0]?.difficulty || "medium") as ScenarioPack["level"])}</span>
          </div>
          <div className="progressBlock">
            <div className="progressTop">
              <span>已作答 {answeredCount}/{totalQuestions}</span>
              <span>{formatDuration(elapsedMs)}</span>
            </div>
            <div className="progressTrack">
              <div style={{ width: totalQuestions ? `${(answeredCount / totalQuestions) * 100}%` : "0%" }} />
            </div>
          </div>
          <button onClick={() => void onReload()}>刷新题库</button>
        </section>
      </aside>

      <section className="practice readingPractice">
        <header className="practiceHeader">
          <div>
            <span className="eyebrow">Complete the Words · Daily Life · Academic Passage</span>
            <h1>{readingSet?.title || "阅读短练"}</h1>
          </div>
          <div className="statePill">
            <Activity size={15} />
            {result ? `正确率 ${result.accuracy}%` : formatDuration(elapsedMs)}
          </div>
        </header>

        {loadError ? <div className="errorBox">{loadError}</div> : null}
        {error ? <div className="errorBox">{error}</div> : null}
        {loading ? <section className="emptyState">正在加载阅读题...</section> : null}
        {!loading && !readingSet ? <section className="emptyState">还没有可用阅读题库。</section> : null}

        {readingSet?.sections.map((section) => (
          <section className="readingSection" key={section.id}>
            <div className="readingSectionHeader">
              <div>
                <span className="eyebrow">{sectionTypeLabel(section.type)}</span>
                <h2>{section.title}</h2>
              </div>
              <span>{section.instructionsZh}</span>
            </div>
            {section.type === "complete_words" ? (
              <CompleteWordsSection
                answers={answers}
                result={result}
                section={section}
                onAnswer={(blankId, value) => setAnswers((current) => ({ ...current, [blankId]: value }))}
              />
            ) : (
              <>
                <div className="readingPassage">{section.passage}</div>
                <div className="readingQuestions">
                  {section.questions.map((question, questionIndex) => (
                    <div className="readingQuestion" key={question.id}>
                      <h3>
                        {questionIndex + 1}. {question.prompt}
                      </h3>
                      <div className="optionGrid">
                        {question.options.map((option, optionIndex) => {
                          const selected = answers[question.id] === optionIndex;
                          const revealed = result != null;
                          const isAnswer = question.answer === optionIndex;
                          return (
                            <button
                              key={option}
                              className={`answerOption${selected ? " selected" : ""}${revealed && isAnswer ? " correct" : ""}${revealed && selected && !isAnswer ? " wrong" : ""}`}
                              onClick={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                              disabled={revealed}
                            >
                              <strong>{String.fromCharCode(65 + optionIndex)}</strong>
                              <span>{option}</span>
                            </button>
                          );
                        })}
                      </div>
                      {result ? (
                        <div className="explanationBox">
                          <strong>解析：</strong>
                          {question.explanationZh}
                          <p>证据：{question.evidence}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        ))}

        {readingSet ? (
          <section className="readingSubmitBar">
            <div>
              <strong>{result ? "已完成" : `已作答 ${answeredCount}/${totalQuestions}`}</strong>
              <span>{result ? result.summaryZh : remainingCount ? `还差 ${remainingCount} 题，答完后可提交复盘。` : "已答完，可以提交复盘。"}</span>
            </div>
            <button onClick={submit} disabled={submitting || result != null || remainingCount > 0}>
              {submitting ? "提交中..." : "提交并复盘"}
            </button>
          </section>
        ) : null}

        {result ? <ReadingResult result={result} /> : null}
      </section>
    </main>
  );
}

function CompleteWordsSection({
  section,
  answers,
  result,
  onAnswer,
}: {
  section: ReadingSection;
  answers: Record<string, number | string>;
  result: ReadingAttemptResult | null;
  onAnswer: (blankId: string, value: string) => void;
}) {
  const blanks = section.blanks ?? [];
  const blankMap = new Map(blanks.map((blank, index) => [blank.id, { ...blank, index }]));
  const parts = section.passage.split(/(\{\{[^}]+\}\})/g).filter(Boolean);

  return (
    <>
      <div className="readingPassage completeWordsPassage">
        {parts.map((part, index) => {
          const match = part.match(/^\{\{([^}]+)\}\}$/);
          if (!match) {
            return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
          }
          const blank = blankMap.get(match[1]);
          if (!blank) {
            return <React.Fragment key={part}>____</React.Fragment>;
          }
          const rawValue = answers[blank.id];
          const value = typeof rawValue === "string" ? rawValue : "";
          const revealed = result != null;
          const isCorrect = normalizeWordCompletion(value) === normalizeWordCompletion(blank.answer);
          return (
            <span className="wordBlank" key={blank.id}>
              <span className="blankIndex">{blank.index + 1}</span>
              <span className="blankPrefix">{blank.prefix}</span>
              <input
                aria-label={`补全单词 ${blank.index + 1}`}
                className={`${revealed ? (isCorrect ? "correct" : "wrong") : ""}`}
                disabled={revealed}
                maxLength={Math.max(blank.answer.length + 4, 8)}
                onChange={(event) => onAnswer(blank.id, event.target.value)}
                value={value}
              />
            </span>
          );
        })}
      </div>
      <div className="blankHintGrid">
        {blanks.map((blank, index) => {
          const revealed = result != null;
          return (
            <div className="blankHint" key={blank.id}>
              <strong>{index + 1}</strong>
              <span>
                {blank.prefix}
                {revealed ? <mark>{blank.answer}</mark> : "_".repeat(Math.max(blank.answer.length, 2))}
              </span>
              {revealed ? <small>{blank.explanationZh}</small> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ReadingResult({ result }: { result: ReadingAttemptResult }) {
  const weakestSkills = Object.entries(result.skillBreakdown)
    .sort((a, b) => a[1].accuracy - b[1].accuracy)
    .slice(0, 5);

  return (
    <section className="feedbackGrid readingResults">
      <Metric label="阅读正确率" value={result.accuracy} />
      <Metric label="答对题数" value={result.correct} />
      <div className="metric">
        <span>训练等级参考</span>
        <strong>{result.estimatedBand}</strong>
      </div>
      <div className="metric">
        <span>用时</span>
        <strong>{formatDuration(result.elapsedMs)}</strong>
      </div>

      <section className="widePanel">
        <h2>复盘总结</h2>
        <p>{result.summaryZh}</p>
        <div className="tagList">
          {Object.entries(result.sectionBreakdown).map(([key, value]) => (
            <span key={key}>
              {sectionTypeLabel(key)}：{value.correct}/{value.total}（{value.accuracy}%）
            </span>
          ))}
        </div>
      </section>

      {weakestSkills.length ? (
        <section className="widePanel">
          <h2>优先回练技能</h2>
          <div className="tagList">
            {weakestSkills.map(([key, value]) => (
              <span key={key}>
                {skillLabel(key)}：{value.correct}/{value.total}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {result.missed.length ? (
        <section className="widePanel">
          <h2>错题清单</h2>
          <div className="missedList">
            {result.missed.map((item) => (
              <div className="missedCard" key={item.questionId}>
                <strong>{item.prompt}</strong>
                <p>
                  你的答案：{item.submittedText ?? readingAnswerText(item.submitted)} / 正确答案：{item.answerText ?? readingAnswerText(item.answer)}
                  {item.fullAnswer ? `（${item.fullAnswer}）` : ""}
                </p>
                <p>{item.explanationZh}</p>
                <small>证据：{item.evidence}</small>
                <div className="tagList compactTags">
                  {item.skillTags.map((tag) => <span key={`${item.questionId}-${tag}`}>{skillLabel(tag)}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function AnalyticsPanel({
  analytics,
  scenarios,
  onJumpToSentence,
}: {
  analytics: SessionAnalytics | null;
  scenarios: ScenarioPack[];
  onJumpToSentence: (sentenceId: string) => void;
}) {
  if (!analytics) {
    return null;
  }

  const recentItems = analytics.recentTrend.map((item) => ({
    ...item,
    location: locateSentence(item.sentenceId, scenarios),
  }));
  const weakestItems = analytics.weakestSentences.map((item) => ({
    ...item,
    location: locateSentence(item.sentenceId, scenarios),
  }));
  const improvingItems = analytics.improvingSentences.map((item) => ({
    ...item,
    location: locateSentence(item.sentenceId, scenarios),
  }));

  return (
    <section className="analyticsPanel">
      <div className="panelTitle">
        <TrendingUp size={16} />
        训练分析
      </div>

      <div className="analyticsSummary">
        <div className="miniMetric">
          <span>总尝试次数</span>
          <strong>{analytics.summary.totalAttempts}</strong>
        </div>
        <div className="miniMetric">
          <span>已练句数</span>
          <strong>{analytics.summary.practicedSentences}</strong>
        </div>
        <div className="miniMetric">
          <span>平均复述分</span>
          <strong>{scoreText(analytics.summary.averageRepeatAccuracy)}</strong>
        </div>
        <div className="miniMetric">
          <span>最高分</span>
          <strong>{scoreText(analytics.summary.bestRepeatAccuracy)}</strong>
        </div>
      </div>

      {recentItems.length ? (
        <div className="planGroup">
          <h3>最近趋势</h3>
          <div className="trendList">
            {recentItems.map((item) => (
              <button key={item.attemptId} className="trendItem" onClick={() => onJumpToSentence(item.sentenceId)}>
                <div>
                  <strong>{item.location ? `${item.location.scenarioTitle} · S${item.location.order}` : item.referenceText}</strong>
                  <small>{formatAttemptTime(item.createdAt)}</small>
                </div>
                <span>{scoreText(item.repeatAccuracy)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {weakestItems.length ? (
        <div className="planGroup">
          <h3>最该回练</h3>
          <div className="drillQueue analyticsQueue">
            {weakestItems.map((item) => (
              <button key={item.sentenceId} onClick={() => onJumpToSentence(item.sentenceId)}>
                <span>{item.location ? `${item.location.scenarioTitle} · S${item.location.order}` : item.referenceText}</span>
                <small>
                  平均 {scoreText(item.averageRepeatAccuracy)} · 最近 {scoreText(item.latestRepeatAccuracy)}
                </small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {improvingItems.length ? (
        <div className="planGroup">
          <h3>正在进步</h3>
          <div className="tagList">
            {improvingItems.map((item) => (
              <button key={item.sentenceId} className="analyticsChip" onClick={() => onJumpToSentence(item.sentenceId)}>
                <span>{item.location ? `S${item.location.order}` : item.sentenceId}</span>
                <small>+{Math.round(item.deltaFromPrevious ?? 0)}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {analytics.focusBreakdown.length ? (
        <div className="planGroup">
          <h3>训练重点分布</h3>
          <div className="tagList">
            {analytics.focusBreakdown.map((item) => (
              <span key={item.label}>
                {item.label} ×{item.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AzureSetupBanner({ envPath }: { envPath: string }) {
  return (
    <section className="setupBanner">
      <strong>Azure 评分尚未配置。</strong>
      <span>
        现在可以录音，但要启用评分，需要在 <code>{envPath}</code> 中配置 <code>AZURE_SPEECH_KEY</code> 和{" "}
        <code>AZURE_SPEECH_REGION</code>，保存后重启后端。
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
    return "麦克风权限被拦截了。点击浏览器地址栏里的麦克风图标，允许访问后再试一次。";
  }
  if (message.includes("NotFoundError") || message.includes("DevicesNotFoundError")) {
    return "没有检测到麦克风。请检查输入设备以及 macOS 的麦克风权限设置。";
  }
  if (message.includes("NotReadableError")) {
    return "麦克风正在被其他程序占用，或被系统阻止。请关闭其他录音应用后再试。";
  }
  return `麦克风启动失败：${message}`;
}

async function refreshMicrophoneHint(): Promise<void> {
  try {
    const permissions = navigator.permissions as Permissions & {
      query(permissionDesc: { name: "microphone" }): Promise<PermissionStatus>;
    };
    const status = await permissions.query({ name: "microphone" });
    if (status.state === "denied") {
      // Keep this as a console warning so it does not clutter first-run UI.
      console.warn("当前站点的麦克风权限被拒绝。");
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

function mapInterviewAttemptsByQuestion(items: InterviewAttempt[]): Record<string, InterviewAttempt> {
  const mapped: Record<string, InterviewAttempt> = {};
  for (const item of items) {
    if (!mapped[item.questionId]) {
      mapped[item.questionId] = item;
    }
  }
  return mapped;
}

function interviewPromptAsSentence(question: InterviewQuestion): PracticeSentence {
  return {
    id: question.id,
    order: question.order,
    text: question.interviewerText,
    audioUrl: question.audioUrl,
  };
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
          scenarioTitle: scenarioLabel(scenario, scenarioIndex),
          order: sentence.order,
        };
      }
    }
  }
  return null;
}

function scenarioLabel(scenario: ScenarioPack, index: number): string {
  return `第 ${String(index + 1).padStart(3, "0")} 套 · ${levelLabel(scenario.level)}`;
}

function scoreText(value: number | null): string {
  return value == null ? "-" : String(Math.round(value));
}

function formatAttemptTime(value: string): string {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readingSectionItemCount(section: ReadingSection): number {
  if (section.type === "complete_words") {
    return section.blanks?.length ?? 0;
  }
  return section.questions.length;
}

function countReadingAnswers(readingSet: ReadingSet | null, answers: Record<string, number | string>): number {
  if (!readingSet) return 0;
  let count = 0;
  for (const section of readingSet.sections) {
    if (section.type === "complete_words") {
      for (const blank of section.blanks ?? []) {
        if (typeof answers[blank.id] === "string" && String(answers[blank.id]).trim()) {
          count += 1;
        }
      }
      continue;
    }
    for (const question of section.questions) {
      if (typeof answers[question.id] === "number") {
        count += 1;
      }
    }
  }
  return count;
}

function normalizeWordCompletion(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function readingAnswerText(value: number | string | null): string {
  if (value == null || value === "") return "未作答";
  if (typeof value === "number") return String.fromCharCode(65 + value);
  return value;
}

function levelLabel(level: ScenarioPack["level"]): string {
  if (level === "easy") return "简单";
  if (level === "hard") return "困难";
  return "中等";
}

function sentenceStageLabel(stage?: PracticeSentence["difficultyStage"]): string {
  if (stage === "easy") return "简单";
  if (stage === "hard") return "困难";
  return "中等";
}

function readingSetLabel(readingSet: ReadingSetSummary, index: number): string {
  return `阅读 ${String(index + 1).padStart(2, "0")} · ${levelLabel(readingSet.difficulty)}`;
}

function interviewSetLabel(interviewSet: InterviewSetSummary, index: number): string {
  return `Interview ${String(index + 1).padStart(2, "0")} · ${levelLabel(interviewSet.difficulty)}`;
}

function interviewFocusLabel(focus: string): string {
  const labels: Record<string, string> = {
    "personal experience": "个人经历",
    "personal role": "个人角色",
    "personal improvement": "个人提升",
    "personal routine": "个人习惯",
    "personal interest": "个人兴趣",
    "personal goal": "个人目标",
    preference: "偏好选择",
    evaluation: "评价判断",
    recommendation: "建议方案",
    advice: "建议表达",
    "cause and solution": "原因与方案",
    "cause and effect": "因果分析",
    "problem solving": "问题解决",
    "problem analysis": "问题分析",
    "policy evaluation": "政策评价",
    "solution design": "方案设计",
    "specific explanation": "具体解释",
    "specific habit": "具体行为",
    "resource description": "资源描述",
  };
  return labels[focus] ?? focus;
}

function interviewDurationLabel(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 25) return "偏短，建议补足例子";
  if (seconds <= 38) return "可再展开一点";
  if (seconds <= 46) return "接近目标时长";
  return "已到自动截止";
}

function interviewStatusLabel(status: InterviewAttempt["scoringStatus"]): string {
  const labels: Record<InterviewAttempt["scoringStatus"], string> = {
    not_scored: "未评分",
    pending: "处理中",
    scored: "已评分",
    failed: "处理失败",
    feedback_ready: "反馈完成",
    empty_transcript: "无转写",
    failed_transcription: "转写失败",
    stt_not_configured: "待配置 STT",
  };
  return labels[status] ?? status;
}

function interviewDimensionLabel(key: string): string {
  const labels: Record<string, string> = {
    delivery: "Delivery",
    languageUse: "Language Use",
    topicDevelopment: "Topic Development",
    organization: "Organization",
  };
  return labels[key] ?? key;
}

function interviewLevelLabel(level: "on_track" | "developing" | "needs_work"): string {
  if (level === "on_track") return "稳定";
  if (level === "developing") return "发展中";
  return "需加强";
}

function sectionTypeLabel(type: string): string {
  if (type === "complete_words") return "补全单词";
  if (type === "daily_life") return "日常文本";
  if (type === "academic_passage") return "学术短文";
  return type;
}

function skillLabel(skill: string): string {
  const labels: Record<string, string> = {
    vocabulary_in_context: "上下文词汇",
    "vocabulary-in-context": "上下文词汇",
    detail_location: "细节定位",
    detail: "细节定位",
    scanning: "信息定位",
    main_idea: "主旨",
    "main-idea": "主旨",
    inference: "推断",
    reference: "指代",
    sentence_function: "句子功能",
    text_structure: "文本结构",
    author_purpose: "作者目的",
    purpose: "作者目的",
    transition_logic: "转折逻辑",
    "cause-effect": "因果关系",
    "conditional-logic": "条件逻辑",
    "rhetorical-purpose": "修辞目的",
    "academic-vocabulary": "学术词汇",
    "context-clue": "上下文线索",
    "phrasal-pattern": "固定搭配",
    collocation: "固定搭配",
    synthesis: "综合理解",
    application: "应用判断",
    "author-view": "作者观点",
    prediction: "结果预测",
    "campus-notice": "校园通知",
  };
  return labels[skill] ?? skill;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const rootHost = window as Window & { __toeflTrainerRoot?: ReturnType<typeof createRoot> };
rootHost.__toeflTrainerRoot ??= createRoot(document.getElementById("root")!);
rootHost.__toeflTrainerRoot.render(<App />);
