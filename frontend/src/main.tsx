import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  Clock,
  Eye,
  EyeOff,
  MessageSquare,
  Mic,
  Play,
  RotateCcw,
  Square,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  fetchAppConfig,
  fetchAttempts,
  fetchInterviewAttempts,
  fetchInterviewSet,
  fetchInterviewSets,
  completeReadingAdaptiveSession,
  generateInterviewReferenceAnswer,
  fetchReadingAdaptiveSessions,
  fetchReadingModule,
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
  submitReadingRouter,
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
  ReadingAdaptiveCompleteResult,
  ReadingAdaptiveSession,
  ReadingAttemptResult,
  ReadingModule,
  ReadingQuestion,
  ReadingRouterResult,
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
  const [readingAdaptiveSessions, setReadingAdaptiveSessions] = useState<ReadingAdaptiveSession[]>([]);
  const [interviewSets, setInterviewSets] = useState<InterviewSetSummary[]>([]);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [state, setState] = useState<RecordingState>("idle");
  const [status, setStatus] = useState("正在加载练习内容...");
  const [attempts, setAttempts] = useState<Record<string, AttemptResult>>({});
  const [reviewAttempts, setReviewAttempts] = useState<Record<string, AttemptResult>>({});
  const [reviewAttemptCounts, setReviewAttemptCounts] = useState<Record<string, number>>({});
  const [visibleSentenceText, setVisibleSentenceText] = useState<Record<string, boolean>>({});
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
    const attemptCollections = mapAttemptsBySentence(attemptItems);
    setAttempts(attemptCollections.primary);
    setReviewAttempts(attemptCollections.latestReview);
    setReviewAttemptCounts(attemptCollections.reviewCounts);
    setAnalytics(analyticsData);
    setStatus("准备就绪");
  }

  async function loadReadingData(disposed = false) {
    try {
      const [readingItems, adaptiveItems] = await Promise.all([
        fetchReadingSets(),
        fetchReadingAdaptiveSessions(),
      ]);
      if (disposed) return;
      setReadingSets(readingItems);
      setReadingAdaptiveSessions(adaptiveItems);
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
  const reviewAttempt = sentence ? reviewAttempts[sentence.id] : null;
  const reviewAttemptCount = sentence ? reviewAttemptCounts[sentence.id] ?? 0 : 0;
  const completedCount = useMemo(
    () => scenario?.sentences.filter((item) => attempts[item.id]).length ?? 0,
    [attempts, scenario]
  );
  const currentTextVisible = sentence ? visibleSentenceText[sentence.id] !== false : true;
  const suiteEvaluation = useMemo(
    () => (scenario ? buildSuiteEvaluation(scenario, attempts) : null),
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
      const savedWithContext: AttemptResult = {
        ...saved,
        scenario_id: scenario.id,
        sentence_id: sentence.id,
        localAudioUrl,
      };
      const existingPrimary = attempts[sentence.id];
      if (existingPrimary) {
        setReviewAttempts((prev) => {
          const previousLocal = prev[sentence.id]?.localAudioUrl;
          if (previousLocal) {
            URL.revokeObjectURL(previousLocal);
            delete localAudioUrlsRef.current[`review:${sentence.id}`];
          }
          localAudioUrlsRef.current[`review:${sentence.id}`] = localAudioUrl;
          return { ...prev, [sentence.id]: savedWithContext };
        });
        setReviewAttemptCounts((prev) => ({ ...prev, [sentence.id]: (prev[sentence.id] ?? 0) + 1 }));
      } else {
        setAttempts((prev) => {
          localAudioUrlsRef.current[`primary:${sentence.id}`] = localAudioUrl;
          return { ...prev, [sentence.id]: savedWithContext };
        });
      }
      setVisibleSentenceText((current) => ({ ...current, [sentence.id]: true }));
      const [nextPlan, nextAnalytics] = await Promise.all([fetchTrainingPlan(), fetchSessionAnalytics()]);
      setPlan(nextPlan);
      setAnalytics(nextAnalytics);
      setState("scored");
      setStatus(existingPrimary ? "复盘练习已保存" : "评分完成");
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

  function toggleCurrentSentenceText() {
    if (!sentence || !attempt) return;
    setVisibleSentenceText((current) => ({
      ...current,
      [sentence.id]: current[sentence.id] === false,
    }));
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
        adaptiveSessions={readingAdaptiveSessions}
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
          <div
            className={`hiddenPrompt ${attempt ? "toggleablePrompt" : ""} ${attempt && !currentTextVisible ? "maskedPrompt" : ""}`}
            onClick={attempt ? toggleCurrentSentenceText : undefined}
            role={attempt ? "button" : undefined}
            tabIndex={attempt ? 0 : undefined}
            title={attempt ? (currentTextVisible ? "点击隐藏原文" : "点击显示原文") : undefined}
            onKeyDown={(event) => {
              if (!attempt) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleCurrentSentenceText();
              }
            }}
          >
            <span>
              {attempt
                ? currentTextVisible
                  ? sentence.text
                  : "英文原文已隐藏。再次点击右侧按钮可显示。"
                : "这句的英文原文会在评分后显示。"}
            </span>
            {attempt ? (
              <span className="promptToggleIcon" aria-hidden="true">
                {currentTextVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </span>
            ) : null}
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
            <button
              onClick={nextSentence}
              disabled={state === "recording" || state === "scoring" || state === "requestingMic"}
            >
              {attempt ? "下一句" : "跳过本句"}
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

        {attempt ? (
          <Feedback
            sentence={sentence}
            attempt={attempt}
            reviewAttempt={reviewAttempt}
            reviewAttemptCount={reviewAttemptCount}
          />
        ) : <Placeholder />}
        {suiteEvaluation && suiteEvaluation.completed >= suiteEvaluation.total ? (
          <SuiteEvaluationPanel evaluation={suiteEvaluation} />
        ) : null}
      </section>
    </main>
  );
}

type SuiteEvaluation = {
  completed: number;
  total: number;
  averageRepeat: number | null;
  averageAccuracy: number | null;
  averageFluency: number | null;
  averageCompleteness: number | null;
  averageProsody: number | null;
  moduleScore: number | null;
  level: string;
  summary: string;
  priority: string;
  issues: SuiteIssue[];
  sentenceReviews: SuiteSentenceReview[];
};

type SuiteIssue = {
  label: string;
  count: number;
  examples: string[];
  action: string;
};

type SuiteSentenceReview = {
  order: number;
  text: string;
  audioUrl: string;
  itemScore: number | null;
  repeatAccuracy: number | null;
  issueLabels: string[];
};

function SuiteEvaluationPanel({ evaluation }: { evaluation: SuiteEvaluation }) {
  async function playOriginalSentence(sentence: SuiteSentenceReview) {
    await playPrompt({
      id: `suite-review-${sentence.order}`,
      order: sentence.order,
      text: sentence.text,
      audioUrl: sentence.audioUrl,
    });
  }

  return (
    <section className="suiteEvaluation">
      <div className="panelTitle">
        <Target size={16} />
        整套评价
      </div>
      <div className="suiteScore">
        <span>Listen & Repeat 模块分</span>
        <strong>{evaluation.moduleScore == null ? "--" : evaluation.moduleScore.toFixed(1)}</strong>
        <small>/ 5.0</small>
      </div>
      <p>{evaluation.summary}</p>
      <div className="tagList compactTags">
        <span>{evaluation.completed}/{evaluation.total} 句</span>
        <span>复述均分 {scoreText(evaluation.averageRepeat)}</span>
        <span>{evaluation.level}</span>
      </div>
      <div className="suiteBreakdown">
        <span>准确 {scoreText(evaluation.averageAccuracy)}</span>
        <span>流利 {scoreText(evaluation.averageFluency)}</span>
        <span>完整 {scoreText(evaluation.averageCompleteness)}</span>
        <span>韵律 {scoreText(evaluation.averageProsody)}</span>
      </div>
      <div className="suiteSentenceReview">
        <h3>原句复盘</h3>
        {evaluation.sentenceReviews.map((sentence) => (
          <div className="suiteSentenceCard" key={`suite-sentence-${sentence.order}`}>
            <button
              className="iconButton sentenceAudioButton"
              onClick={() => void playOriginalSentence(sentence)}
              title={`播放第 ${sentence.order} 句原音`}
              aria-label={`播放第 ${sentence.order} 句原音`}
            >
              <Play size={16} />
            </button>
            <div>
              <div className="suiteSentenceTop">
                <strong>S{sentence.order}</strong>
                <span>{sentence.itemScore == null ? "-" : sentence.itemScore.toFixed(1)}/5</span>
              </div>
              <p>{sentence.text}</p>
              <div className="tagList compactTags">
                <span>复述 {scoreText(sentence.repeatAccuracy)}</span>
                {sentence.issueLabels.length
                  ? sentence.issueLabels.map((label) => <span key={`S${sentence.order}-${label}`}>{label}</span>)
                  : <span>无明显集中问题</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="suiteIssueList">
        <h3>本套暴露的问题</h3>
        {evaluation.issues.length ? (
          evaluation.issues.map((issue) => (
            <div className="suiteIssueCard" key={issue.label}>
              <div className="suiteIssueTop">
                <strong>{issue.label}</strong>
                <span>{issue.count}</span>
              </div>
              <div className="tagList compactTags">
                {issue.examples.map((example) => <span key={`${issue.label}-${example}`}>{example}</span>)}
              </div>
              <p>{issue.action}</p>
            </div>
          ))
        ) : (
          <p>这套没有明显集中问题。下一轮可以提高语速稳定性和自然重音。</p>
        )}
      </div>
      <p className="reviewAction">{evaluation.priority}</p>
    </section>
  );
}

function buildSuiteEvaluation(scenario: ScenarioPack, attempts: Record<string, AttemptResult>): SuiteEvaluation | null {
  const sentenceEntries = scenario.sentences
    .map((sentence) => ({ sentence, attempt: attempts[sentence.id] }))
    .filter((item): item is { sentence: PracticeSentence; attempt: AttemptResult } => Boolean(item.attempt));
  if (!sentenceEntries.length) return null;

  const averageRepeat = averageScore(sentenceEntries.map((item) => item.attempt.normalized.scores.repeatAccuracy));
  const averageAccuracy = averageScore(sentenceEntries.map((item) => item.attempt.normalized.scores.accuracy));
  const averageFluency = averageScore(sentenceEntries.map((item) => item.attempt.normalized.scores.fluency));
  const averageCompleteness = averageScore(sentenceEntries.map((item) => item.attempt.normalized.scores.completeness));
  const averageProsody = averageScore(sentenceEntries.map((item) => item.attempt.normalized.scores.prosody));
  const itemScores = sentenceEntries
    .map((item) => repeatScoreToOfficialItemScore(item.attempt.normalized.scores.repeatAccuracy))
    .filter((value): value is number => value != null);
  const moduleScore = itemScores.length
    ? Math.round((itemScores.reduce((sum, value) => sum + value, 0) / itemScores.length) * 10) / 10
    : null;
  const completedAll = sentenceEntries.length >= scenario.sentences.length;
  const level = suiteLevel(moduleScore);
  const priority = suitePriority({
    averageAccuracy,
    averageFluency,
    averageCompleteness,
    averageProsody,
  });

  return {
    completed: sentenceEntries.length,
    total: scenario.sentences.length,
    averageRepeat,
    averageAccuracy,
    averageFluency,
    averageCompleteness,
    averageProsody,
    moduleScore,
    level,
    summary: completedAll
      ? `仅看 Listen and Repeat 这一套，当前折算为 ${level}。这是按官方每题 0-5 的量表做的本地模块评价，不等同于完整 Speaking 1-6 报告分。`
      : "先完成整套 7 句，系统会按官方每题 0-5 的量表汇总 Listen and Repeat。",
    priority,
    issues: buildSuiteIssues(sentenceEntries, {
      averageAccuracy,
      averageFluency,
      averageCompleteness,
      averageProsody,
    }),
    sentenceReviews: buildSuiteSentenceReviews(sentenceEntries),
  };
}

function buildSuiteSentenceReviews(entries: { sentence: PracticeSentence; attempt: AttemptResult }[]): SuiteSentenceReview[] {
  return entries.map(({ sentence, attempt }) => {
    const scores = attempt.normalized.scores;
    const issues = attempt.normalized.issues;
    const issueLabels: string[] = [];
    if (issues.omissions.length) issueLabels.push(`漏读 ${issues.omissions.length}`);
    if (issues.insertions.length) issueLabels.push(`多读 ${issues.insertions.length}`);
    if (issues.mispronunciations.length) issueLabels.push(`发音偏差 ${issues.mispronunciations.length}`);
    if (issues.repetitions.length) issueLabels.push(`重复 ${issues.repetitions.length}`);
    if (issues.low_score_words.length) issueLabels.push(`低分词 ${issues.low_score_words.length}`);
    if (issues.low_score_phonemes.length) issueLabels.push(`低分音素 ${issues.low_score_phonemes.length}`);
    if (scores.completeness != null && scores.completeness < 85) issueLabels.push("完整度低");
    if (scores.fluency != null && scores.fluency < 80) issueLabels.push("流利度低");
    if (scores.prosody != null && scores.prosody < 80) issueLabels.push("韵律不稳");
    return {
      order: sentence.order,
      text: sentence.text,
      audioUrl: sentence.audioUrl,
      itemScore: repeatScoreToOfficialItemScore(scores.repeatAccuracy),
      repeatAccuracy: scores.repeatAccuracy,
      issueLabels: issueLabels.slice(0, 5),
    };
  });
}

function buildSuiteIssues(
  entries: { sentence: PracticeSentence; attempt: AttemptResult }[],
  averages: {
    averageAccuracy: number | null;
    averageFluency: number | null;
    averageCompleteness: number | null;
    averageProsody: number | null;
  }
): SuiteIssue[] {
  const issueMap = new Map<string, SuiteIssue>();
  const ensureIssue = (label: string, action: string) => {
    const existing = issueMap.get(label);
    if (existing) return existing;
    const created: SuiteIssue = { label, count: 0, examples: [], action };
    issueMap.set(label, created);
    return created;
  };
  const addIssue = (label: string, action: string, examples: string[]) => {
    if (!examples.length) return;
    const issue = ensureIssue(label, action);
    issue.count += examples.length;
    for (const example of examples) {
      if (issue.examples.length < 8 && !issue.examples.includes(example)) {
        issue.examples.push(example);
      }
    }
  };

  for (const { sentence, attempt } of entries) {
    const sentenceLabel = `S${sentence.order}`;
    const scores = attempt.normalized.scores;
    const issues = attempt.normalized.issues;
    addIssue("漏读", "下一轮先不追求快，确保主干词完整复述。", issues.omissions.map((word) => `${sentenceLabel}: ${word}`));
    addIssue("多读", "回练时只复述一遍，不补解释、不重复启动句。", issues.insertions.map((word) => `${sentenceLabel}: ${word}`));
    addIssue("发音偏差", "把这些词单独慢读两遍，再放回整句。", issues.mispronunciations.map((word) => `${sentenceLabel}: ${word}`));
    addIssue("重复卡顿", "先用较慢但连续的节奏完成整句，减少回头重说。", issues.repetitions.map((word) => `${sentenceLabel}: ${word}`));
    addIssue(
      "低分词",
      "优先修这些词的重音和清晰度，它们最影响整句可懂度。",
      issues.low_score_words.slice(0, 4).map((item) => `${sentenceLabel}: ${item.word} ${Math.round(item.accuracy)}`)
    );
    addIssue(
      "低分音素",
      "把对应音素抽出来做 3-5 次短 drill，再回到原句。",
      issues.low_score_phonemes.slice(0, 4).map((item) => `${sentenceLabel}: ${item.word} /${item.phoneme}/ ${Math.round(item.accuracy)}`)
    );
    addIssue("完整度低", "这几句优先修漏词和句尾收束。", scores.completeness != null && scores.completeness < 85 ? [`${sentenceLabel}: ${Math.round(scores.completeness)}`] : []);
    addIssue("流利度低", "这几句用一次呼吸连完，先稳节奏再提速。", scores.fluency != null && scores.fluency < 80 ? [`${sentenceLabel}: ${Math.round(scores.fluency)}`] : []);
    addIssue("韵律不稳", "注意重音、停顿和句尾语调，不要逐词平读。", scores.prosody != null && scores.prosody < 80 ? [`${sentenceLabel}: ${Math.round(scores.prosody)}`] : []);
  }

  if (averages.averageCompleteness != null && averages.averageCompleteness < 85) {
    ensureIssue("整体完整度偏低", "先把 7 句主干完整复述出来，再打磨发音细节。").count += 1;
  }
  if (averages.averageFluency != null && averages.averageFluency < 80) {
    ensureIssue("整体流利度偏低", "下一轮把目标改成连续输出，不要在单词间频繁停顿。").count += 1;
  }
  if (averages.averageAccuracy != null && averages.averageAccuracy < 82) {
    ensureIssue("整体发音准确度偏低", "先集中回练低分词和低分音素，再整套重做。").count += 1;
  }
  if (averages.averageProsody != null && averages.averageProsody < 80) {
    ensureIssue("整体韵律偏平", "按意群读句子，避免每个词同样重。").count += 1;
  }

  return [...issueMap.values()]
    .filter((issue) => issue.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function averageScore(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

function repeatScoreToOfficialItemScore(score: number | null): number | null {
  if (score == null) return null;
  if (score >= 94) return 5.0;
  if (score >= 88) return 4.5;
  if (score >= 82) return 4.0;
  if (score >= 76) return 3.5;
  if (score >= 68) return 3.0;
  if (score >= 60) return 2.5;
  if (score >= 50) return 2.0;
  if (score >= 40) return 1.5;
  if (score >= 28) return 1.0;
  return 0.5;
}

function suiteLevel(score: number | null): string {
  if (score == null) return "暂无等级";
  if (score >= 4.5) return "高分表现";
  if (score >= 3.5) return "良好表现";
  if (score >= 2.5) return "中等表现";
  if (score >= 1.5) return "基础表现";
  return "低于基础";
}

function suitePriority(scores: {
  averageAccuracy: number | null;
  averageFluency: number | null;
  averageCompleteness: number | null;
  averageProsody: number | null;
}): string {
  const candidates = [
    { label: "完整度", value: scores.averageCompleteness, action: "优先保证每句不漏主干词，再追求速度。" },
    { label: "流利度", value: scores.averageFluency, action: "下一轮重点减少停顿，把 7 句都连成一个稳定节奏。" },
    { label: "发音准确度", value: scores.averageAccuracy, action: "下一轮先慢速修低分词，再恢复自然语速。" },
    { label: "韵律", value: scores.averageProsody, action: "下一轮注意重音、升降调和句尾收束。" },
  ].filter((item): item is { label: string; value: number; action: string } => item.value != null);
  if (!candidates.length) return "完成整套后，优先回练最低分的 2-3 句。";
  candidates.sort((a, b) => a.value - b.value);
  return `当前最该补的是${candidates[0].label}：${candidates[0].action}`;
}

function Feedback({
  attempt,
  reviewAttempt,
  reviewAttemptCount,
}: {
  sentence: PracticeSentence;
  attempt: AttemptResult;
  reviewAttempt: AttemptResult | null;
  reviewAttemptCount: number;
}) {
  const score = attempt.normalized.scores;
  const issues = attempt.normalized.issues;
  const diagnostics = attempt.normalized.diagnostics;
  const playbackUrl = attempt.localAudioUrl || attempt.audioUrl;
  const reviewScore = reviewAttempt?.normalized.scores;
  const reviewPlaybackUrl = reviewAttempt ? reviewAttempt.localAudioUrl || reviewAttempt.audioUrl : "";
  return (
    <section className="feedbackGrid">
      <Metric label="复述分" value={score.repeatAccuracy} />
      <Metric label="发音准确度" value={score.accuracy} />
      <Metric label="流利度" value={score.fluency} />
      <Metric label="完整度" value={score.completeness} />
      <Metric label="韵律" value={score.prosody} fallbackLabel={diagnostics.prosodyAvailable ? "-" : "无"} />

      <section className="widePanel">
        <h2>首轮考试记录 / First Attempt</h2>
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

      {reviewAttempt && reviewScore ? (
        <section className="widePanel reviewAttemptPanel">
          <div className="reviewAttemptHeader">
            <h2>最近复盘练习 / Review Practice</h2>
            <span>第 {reviewAttemptCount} 次复盘</span>
          </div>
          <audio controls src={reviewPlaybackUrl} preload="metadata" />
          <div className="suiteBreakdown">
            <span>复述 {scoreText(reviewScore.repeatAccuracy)}</span>
            <span>准确 {scoreText(reviewScore.accuracy)}</span>
            <span>流利 {scoreText(reviewScore.fluency)}</span>
            <span>完整 {scoreText(reviewScore.completeness)}</span>
          </div>
          <p><strong>识别结果 Recognized:</strong> {reviewAttempt.normalized.recognizedText || "（空）"}</p>
          <p>{reviewAttempt.normalized.summary}</p>
          <p className="reviewAction">这条记录只作为复盘练习，不覆盖上面的首轮考试结果，也不改变整套评价使用的首轮分数。</p>
        </section>
      ) : null}

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
  const [reviewUnlocked, setReviewUnlocked] = useState(false);
  const recorderRef = useRef<WavRecorder | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const localAudioUrlsRef = useRef<Record<string, string>>({});

  const activeSetId = selectedSetId || interviewSets[0]?.id || "";
  const question = interviewSet?.questions[questionIndex] ?? null;
  const currentAttempt = question ? attempts[question.id] : null;
  const completedCount = interviewSet?.questions.filter((item) => attempts[item.id]).length ?? 0;
  const answerSeconds = question?.answerSeconds ?? interviewSet?.answerSeconds ?? 45;
  const totalQuestions = interviewSet?.questions.length ?? 4;
  const reviewVisible = Boolean(interviewSet && (reviewUnlocked || completedCount >= totalQuestions));

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
        setReviewUnlocked(false);
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
      const savedQuestionIndex = questionIndex;
      const nextCompletedCount = interviewSet.questions.filter((item) => attempts[item.id] || item.id === question.id).length;
      setAttempts((current) => {
        const previousLocal = current[question.id]?.localAudioUrl;
        if (previousLocal) {
          URL.revokeObjectURL(previousLocal);
          delete localAudioUrlsRef.current[question.id];
        }
        localAudioUrlsRef.current[question.id] = localAudioUrl;
        return { ...current, [question.id]: { ...saved, localAudioUrl } };
      });
      if (nextCompletedCount >= interviewSet.questions.length || savedQuestionIndex >= interviewSet.questions.length - 1) {
        setReviewUnlocked(true);
        setState("scored");
        setStatus("四题完成，可以集中复盘。");
      } else {
        const next = savedQuestionIndex + 1;
        setQuestionIndex(next);
        setState("idle");
        setStatus(`第 ${next + 1} 题准备就绪`);
        setRemainingSeconds(interviewSet.questions[next]?.answerSeconds ?? interviewSet.answerSeconds);
      }
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
    setReviewUnlocked(false);
  }

  function nextQuestion() {
    if (!interviewSet) return;
    if (questionIndex < interviewSet.questions.length - 1) {
      selectQuestion(questionIndex + 1);
      return;
    }
    setReviewUnlocked(true);
    setStatus("这套 Interview 已结束，可以复盘四段回答。");
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
            <span>已完成 {completedCount}/{totalQuestions}</span>
            <span>{levelLabel((interviewSet?.difficulty || interviewSets[0]?.difficulty || "medium") as ScenarioPack["level"])}</span>
          </div>
          <div className="progressTrack">
            <div style={{ width: `${(completedCount / totalQuestions) * 100}%` }} />
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
              <small>{attempts[item.id] ? "已完成" : "未完成"}</small>
              {attempts[item.id] ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <section className="planPanel">
          <div className="panelTitle">
            <MessageSquare size={16} />
            Interview 计划
          </div>
          <p>选择一套模拟面试，听同一场景下的 4 个递进问题，每题回答 45 秒。</p>
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

        {!reviewVisible && interviewSet ? (
          <section className="interviewContextPanel">
            <span className="eyebrow">Scenario</span>
            <h2>{interviewSet.title}</h2>
            <p>场景主题：{interviewSet.theme}。你将听到同一主题下的四个递进问题；练习阶段只听题，不显示 interviewer 原文。</p>
          </section>
        ) : null}

        {question && !reviewVisible ? (
          <section className="examSurface interviewSurface">
            <div className="interviewPromptTop">
              <span>Question {question.order} / {totalQuestions}</span>
              <span>{answerSeconds} 秒回答</span>
            </div>
            <div className="interviewerPrompt hiddenInterviewPrompt">
              请先播放 interviewer 提问，然后直接回答。题目文字和参考答案会在整套完成后显示。
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
              <button onClick={nextQuestion} disabled={state === "recording" || state === "scoring" || state === "requestingMic"}>
                {currentAttempt
                  ? questionIndex < totalQuestions - 1
                    ? "下一题"
                    : "结束并复盘"
                  : questionIndex < totalQuestions - 1
                    ? "跳过本题"
                    : "结束并复盘"}
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

        {reviewVisible && interviewSet ? (
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
          <h2>回答复盘</h2>
        </div>
        <span className={`priorityBadge ${attempt ? "later" : ""}`}>
          {attempt ? interviewStatusLabel(attempt.scoringStatus) : "未完成"}
        </span>
      </div>
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
  adaptiveSessions,
  loadError,
  onReload,
}: {
  appModule: AppModule;
  onSwitchModule: (module: AppModule) => void;
  readingSets: ReadingSetSummary[];
  adaptiveSessions: ReadingAdaptiveSession[];
  loadError: string;
  onReload: () => Promise<void>;
}) {
  const [readingMode, setReadingMode] = useState<"adaptive" | "single">("single");
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

        <div className="modeTabs">
          <button className={readingMode === "adaptive" ? "active" : ""} onClick={() => setReadingMode("adaptive")}>
            Adaptive 模考
          </button>
          <button className={readingMode === "single" ? "active" : ""} onClick={() => setReadingMode("single")}>
            Single Set 练习
          </button>
        </div>

        {readingMode === "single" ? (
          <>
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
          </>
        ) : null}

        <section className="planPanel">
          <div className="panelTitle">
            <Clock size={16} />
            阅读计划
          </div>
          <p>{readingMode === "adaptive" ? adaptiveSessions[0]?.descriptionZh || "模拟考试模式：先完成 Router 模块，系统按正确率进入 Lower 或 Upper 第二模块。" : readingSet?.descriptionZh || "先选择一套阅读短练，完成后查看技能拆解。"}</p>
          <div className="tagList">
            <span>{readingMode === "adaptive" ? "50 题" : `${totalQuestions || readingSets[0]?.questionCount || 0} 题`}</span>
            <span>{readingMode === "adaptive" ? `${adaptiveSessions[0]?.estimatedMinutes || 30} 分钟` : `${readingSet?.estimatedMinutes || readingSets[0]?.estimatedMinutes || 10} 分钟`}</span>
            <span>{readingMode === "adaptive" ? "Router + Lower/Upper" : levelLabel((readingSet?.difficulty || readingSets[0]?.difficulty || "medium") as ScenarioPack["level"])}</span>
          </div>
          {readingMode === "single" ? <div className="progressBlock">
            <div className="progressTop">
              <span>已作答 {answeredCount}/{totalQuestions}</span>
              <span>{formatDuration(elapsedMs)}</span>
            </div>
            <div className="progressTrack">
              <div style={{ width: totalQuestions ? `${(answeredCount / totalQuestions) * 100}%` : "0%" }} />
            </div>
          </div> : <p className="miniNotice">Adaptive 是完整 50 题模拟，不会由 Single Set 自动触发；训练路由不是 ETS 官方算法。</p>}
          <button onClick={() => void onReload()}>刷新题库</button>
        </section>
      </aside>

      {readingMode === "adaptive" ? (
        <AdaptiveReadingPractice adaptiveSessions={adaptiveSessions} loadError={loadError} />
      ) : <section className="practice readingPractice">
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

        {readingSet ? (
          <ReadingModuleContent
            module={readingSet}
            answers={answers}
            result={result}
            onAnswer={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
          />
        ) : null}

        {readingSet ? (
          <section className="readingSubmitBar">
            <div>
              <strong>{result ? "已完成" : `已作答 ${answeredCount}/${totalQuestions}`}</strong>
              <span>{result ? result.summaryZh : remainingCount ? `还有 ${remainingCount} 题未答；提交后会按错题处理。` : "已答完，可以提交复盘。"}</span>
            </div>
            <button onClick={submit} disabled={submitting || result != null}>
              {submitting ? "提交中..." : "提交并复盘"}
            </button>
          </section>
        ) : null}

        {result ? <ReadingResult result={result} /> : null}
      </section>}
    </main>
  );
}

function AdaptiveReadingPractice({
  adaptiveSessions,
  loadError,
}: {
  adaptiveSessions: ReadingAdaptiveSession[];
  loadError: string;
}) {
  const session = adaptiveSessions[0] ?? null;
  const [routerModule, setRouterModule] = useState<ReadingModule | null>(null);
  const [secondModule, setSecondModule] = useState<ReadingModule | null>(null);
  const [routerAnswers, setRouterAnswers] = useState<Record<string, number | string>>({});
  const [secondAnswers, setSecondAnswers] = useState<Record<string, number | string>>({});
  const [routerResult, setRouterResult] = useState<ReadingAttemptResult | null>(null);
  const [routeInfo, setRouteInfo] = useState<ReadingRouterResult | null>(null);
  const [finalResult, setFinalResult] = useState<ReadingAdaptiveCompleteResult | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [secondStartedAt, setSecondStartedAt] = useState<number | null>(null);
  const [routerElapsedMs, setRouterElapsedMs] = useState(0);
  const [secondElapsedMs, setSecondElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.routerModule?.id) return;
    let disposed = false;
    async function loadRouter() {
      setLoading(true);
      setError("");
      try {
        const item = await fetchReadingModule(session.routerModule.id);
        if (disposed) return;
        setRouterModule(item);
        setSecondModule(null);
        setRouterAnswers({});
        setSecondAnswers({});
        setRouterResult(null);
        setRouteInfo(null);
        setFinalResult(null);
        setStartedAt(Date.now());
        setSecondStartedAt(null);
        setRouterElapsedMs(0);
        setSecondElapsedMs(0);
      } catch (err) {
        if (!disposed) setError(errorMessage(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void loadRouter();
    return () => {
      disposed = true;
    };
  }, [session?.routerModule?.id]);

  useEffect(() => {
    if (routerResult) return;
    const timer = window.setInterval(() => setRouterElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [routerResult, startedAt]);

  useEffect(() => {
    if (secondStartedAt == null || finalResult) return;
    const timer = window.setInterval(() => setSecondElapsedMs(Date.now() - secondStartedAt), 1000);
    return () => window.clearInterval(timer);
  }, [finalResult, secondStartedAt]);

  const activeModule = routerResult ? secondModule : routerModule;
  const activeAnswers = routerResult ? secondAnswers : routerAnswers;
  const activeResult = routerResult ? finalResult?.secondResult ?? null : routerResult;
  const adaptiveStep = finalResult ? "review" : routerResult ? "module2" : "router";
  const totalQuestions = useMemo(() => activeModule?.sections.reduce((sum, section) => sum + readingSectionItemCount(section), 0) ?? 0, [activeModule]);
  const answeredCount = useMemo(() => countReadingAnswers(activeModule, activeAnswers), [activeAnswers, activeModule]);
  const remainingCount = Math.max(totalQuestions - answeredCount, 0);

  async function submitRouterStep() {
    if (!session || !routerModule) return;
    setSubmitting(true);
    setError("");
    try {
      const routed = await submitReadingRouter({
        sessionId: session.id,
        moduleId: routerModule.id,
        answers: routerAnswers,
        elapsedMs: routerElapsedMs,
      });
      const next = await fetchReadingModule(routed.nextModule.id);
      setRouterResult(routed.result);
      setRouteInfo(routed);
      setSecondModule(next);
      setSecondStartedAt(Date.now());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFinalStep() {
    if (!session || !routerModule || !secondModule || !routeInfo) return;
    setSubmitting(true);
    setError("");
    try {
      const completed = await completeReadingAdaptiveSession({
        sessionId: session.id,
        routerModuleId: routerModule.id,
        secondModuleId: secondModule.id,
        routePath: routeInfo.routePath,
        routerAnswers,
        secondAnswers,
        routerElapsedMs,
        secondElapsedMs,
      });
      setFinalResult(completed);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) {
    return <section className="practice readingPractice"><section className="emptyState">还没有可用 Reading 自适应题库。</section></section>;
  }

  return (
    <section className="practice readingPractice">
      <header className="practiceHeader">
        <div>
          <span className="eyebrow">Two-stage adaptive · Router → Lower/Upper</span>
          <h1>{session.title}</h1>
        </div>
        <div className="statePill">
          <Activity size={15} />
          {finalResult ? `总正确率 ${finalResult.overallResult.accuracy}%` : routerResult ? `${routeInfo?.routePath === "upper" ? "Upper" : "Lower"} Module` : "Router Module"}
        </div>
      </header>

      {loadError ? <div className="errorBox">{loadError}</div> : null}
      {error ? <div className="errorBox">{error}</div> : null}
      {loading ? <section className="emptyState">正在加载 Reading Router...</section> : null}
      {routeInfo ? (
        <section className="widePanel">
          <h2>Router 结果</h2>
          <p>
            Router 正确率 {routeInfo.result.accuracy}%，训练路由进入 {routeInfo.routePath === "upper" ? "Upper Module" : "Lower Module"}。
            阈值为 {routeInfo.thresholdAccuracy}%。{routeInfo.disclaimerZh}
          </p>
          <div className="tagList">
            <span>Router {routeInfo.result.correct}/{routeInfo.result.total}</span>
            <span>{routeInfo.nextModule.title}</span>
          </div>
        </section>
      ) : null}

      <section className="adaptiveFlowPanel" aria-label="Adaptive 阅读流程">
        <div className={`adaptiveStep ${adaptiveStep === "router" ? "active" : "done"}`}>
          <strong>1</strong>
          <span>Router Module</span>
          <small>先完成 25 题入口模块</small>
        </div>
        <div className={`adaptiveStep ${adaptiveStep === "module2" ? "active" : finalResult ? "done" : ""}`}>
          <strong>2</strong>
          <span>{routeInfo?.routePath === "upper" ? "Upper Module" : routeInfo?.routePath === "lower" ? "Lower Module" : "Lower / Upper Module"}</span>
          <small>按 Router 正确率进入第二模块</small>
        </div>
        <div className={`adaptiveStep ${adaptiveStep === "review" ? "active done" : ""}`}>
          <strong>3</strong>
          <span>50 题复盘</span>
          <small>合并两个模块生成训练结果</small>
        </div>
      </section>

      {activeModule ? (
        <>
          <ReadingModuleContent
            module={activeModule}
            answers={activeAnswers}
            result={activeResult}
            onAnswer={(id, value) => {
              if (routerResult) {
                setSecondAnswers((current) => ({ ...current, [id]: value }));
              } else {
                setRouterAnswers((current) => ({ ...current, [id]: value }));
              }
            }}
          />
          <section className="readingSubmitBar">
            <div>
              <strong>{finalResult ? "自适应阅读已完成" : `已作答 ${answeredCount}/${totalQuestions}`}</strong>
              <span>{finalResult ? finalResult.overallResult.summaryZh : remainingCount ? `还有 ${remainingCount} 题未答；提交后会按错题处理。` : "已答完，可以提交当前模块。"}</span>
            </div>
            {!routerResult ? (
              <button onClick={submitRouterStep} disabled={submitting}>
                {submitting ? "提交中..." : "提交 Router 并路由"}
              </button>
            ) : (
              <button onClick={submitFinalStep} disabled={submitting || finalResult != null}>
                {submitting ? "提交中..." : "提交第二模块并复盘"}
              </button>
            )}
          </section>
        </>
      ) : null}

      {finalResult ? (
        <>
          <section className="widePanel">
            <h2>完整 50 题复盘</h2>
            <div className="tagList">
              <span>Router：{finalResult.routerResult.correct}/{finalResult.routerResult.total}</span>
              <span>Module 2：{finalResult.secondResult.correct}/{finalResult.secondResult.total}</span>
              <span>总分：{finalResult.overallResult.correct}/{finalResult.overallResult.total}</span>
              <span>路径：{finalResult.routePath === "upper" ? "Upper" : "Lower"}</span>
            </div>
          </section>
          <ReadingResult result={finalResult.overallResult} />
        </>
      ) : null}
    </section>
  );
}

function ReadingModuleContent({
  module,
  answers,
  result,
  onAnswer,
}: {
  module: ReadingSet | ReadingModule;
  answers: Record<string, number | string>;
  result: ReadingAttemptResult | null;
  onAnswer: (id: string, value: number | string) => void;
}) {
  const pages = useMemo(() => buildReadingPages(module), [module]);
  const [pageIndex, setPageIndex] = useState(0);
  const activePage = pages[Math.min(pageIndex, Math.max(pages.length - 1, 0))] ?? null;
  const currentPageIndex = activePage ? Math.min(pageIndex, pages.length - 1) : 0;
  const pageAnswered = activePage ? isReadingPageAnswered(activePage, answers) : false;
  const canGoNext = currentPageIndex < pages.length - 1;

  useEffect(() => {
    setPageIndex(0);
  }, [module.id]);

  return (
    <>
      <section className="widePanel">
        <h2>{module.title}</h2>
        <p>{module.descriptionZh}</p>
        <div className="tagList">
          <span>{module.sections.reduce((sum, section) => sum + readingSectionItemCount(section), 0)} 题</span>
          <span>{module.estimatedMinutes} 分钟</span>
          <span>{levelLabel(module.difficulty)}</span>
        </div>
      </section>
      {activePage ? (
        <section className="readingSection readingPageCard" key={activePage.key}>
          <div className="readingPageTop">
            <div>
              <span className="eyebrow">{sectionTypeLabel(activePage.section.type)}</span>
              <h2>{activePage.section.title}</h2>
            </div>
            <div className="readingPageCounter">
              第 {currentPageIndex + 1} / {pages.length} 页
            </div>
          </div>
          <div className="readingSectionHeader compact">
            <span>{activePage.section.instructionsZh}</span>
          </div>
          {activePage.kind === "complete_words" ? (
            <CompleteWordsSection answers={answers} result={result} section={activePage.section} onAnswer={(blankId, value) => onAnswer(blankId, value)} />
          ) : (
            <>
              <div className="readingPassage">{activePage.section.passage}</div>
              <div className="readingQuestions oneQuestion">
                <ReadingQuestionCard
                  answers={answers}
                  question={activePage.question}
                  questionIndex={activePage.questionIndex}
                  result={result}
                  onAnswer={onAnswer}
                />
              </div>
            </>
          )}
          <div className="readingPageNav">
            <button onClick={() => setPageIndex((current) => Math.max(current - 1, 0))} disabled={currentPageIndex === 0}>
              上一页
            </button>
            <div className="progressTrack" aria-label="阅读分页进度">
              <div style={{ width: pages.length ? `${((currentPageIndex + 1) / pages.length) * 100}%` : "0%" }} />
            </div>
            {!pageAnswered && canGoNext && result == null ? (
              <button className="ghostButton" onClick={() => setPageIndex((current) => Math.min(current + 1, pages.length - 1))}>
                跳过本页
              </button>
            ) : null}
            <button
              onClick={() => setPageIndex((current) => Math.min(current + 1, pages.length - 1))}
              disabled={!canGoNext}
            >
              下一页
            </button>
          </div>
          {!pageAnswered && result == null ? <p className="miniNotice">可以先跳过本页；提交时未答项目会按错题处理。</p> : null}
        </section>
      ) : null}
    </>
  );
}

function ReadingQuestionCard({
  question,
  questionIndex,
  answers,
  result,
  onAnswer,
}: {
  question: ReadingQuestion;
  questionIndex: number;
  answers: Record<string, number | string>;
  result: ReadingAttemptResult | null;
  onAnswer: (id: string, value: number | string) => void;
}) {
  return (
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
              onClick={() => onAnswer(question.id, optionIndex)}
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
                style={{ width: `${Math.max(4, Math.min(9, blank.answer.length + 1))}ch` }}
                value={value}
              />
            </span>
          );
        })}
      </div>
      {result ? <div className="blankHintGrid">
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
      </div> : null}
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

function mapAttemptsBySentence(items: AttemptResult[]): {
  primary: Record<string, AttemptResult>;
  latestReview: Record<string, AttemptResult>;
  reviewCounts: Record<string, number>;
} {
  const grouped: Record<string, AttemptResult[]> = {};
  for (const item of items) {
    const sentenceId = item.sentence_id;
    if (!sentenceId) continue;
    grouped[sentenceId] = [...(grouped[sentenceId] ?? []), item];
  }
  const primary: Record<string, AttemptResult> = {};
  const latestReview: Record<string, AttemptResult> = {};
  const reviewCounts: Record<string, number> = {};
  for (const [sentenceId, sentenceAttempts] of Object.entries(grouped)) {
    const ordered = [...sentenceAttempts].sort(compareAttemptsByCreatedAt);
    const [first, ...reviews] = ordered;
    if (!first) continue;
    primary[sentenceId] = first;
    reviewCounts[sentenceId] = reviews.length;
    if (reviews.length) {
      latestReview[sentenceId] = reviews[reviews.length - 1];
    }
  }
  return { primary, latestReview, reviewCounts };
}

function compareAttemptsByCreatedAt(left: AttemptResult, right: AttemptResult): number {
  const leftTime = Date.parse(left.created_at ?? "");
  const rightTime = Date.parse(right.created_at ?? "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
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

type ReadingPage =
  | {
      key: string;
      kind: "complete_words";
      section: ReadingSection;
    }
  | {
      key: string;
      kind: "question";
      section: ReadingSection;
      question: ReadingQuestion;
      questionIndex: number;
    };

function buildReadingPages(readingSet: ReadingSet | ReadingModule): ReadingPage[] {
  const pages: ReadingPage[] = [];
  for (const section of readingSet.sections) {
    if (section.type === "complete_words") {
      pages.push({ key: section.id, kind: "complete_words", section });
      continue;
    }
    section.questions.forEach((question, questionIndex) => {
      pages.push({
      key: question.id,
      kind: "question",
      section,
      question,
      questionIndex,
      });
    });
  }
  return pages;
}

function isReadingPageAnswered(page: ReadingPage, answers: Record<string, number | string>): boolean {
  if (page.kind === "complete_words") {
    return (page.section.blanks ?? []).every((blank) => {
      const value = answers[blank.id];
      return typeof value === "string" && value.trim().length > 0;
    });
  }
  return answers[page.question.id] != null;
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
