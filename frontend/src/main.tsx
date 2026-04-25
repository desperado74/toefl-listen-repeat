import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, Check, Mic, Play, RotateCcw, Square, Target, TrendingUp } from "lucide-react";
import {
  fetchAppConfig,
  fetchAttempts,
  fetchReinforcementScenario,
  fetchScenarios,
  fetchSessionAnalytics,
  fetchTrainingPlan,
  loginWithPassword,
  saveAttempt,
} from "./api";
import { assessPronunciation } from "./azurePronunciation";
import { playPrompt } from "./tts";
import type { AppConfig, AttemptResult, PracticeSentence, ScenarioPack, SessionAnalytics, TrainingPlan } from "./types";
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
            <strong>托福听力跟读</strong>
            <span>Azure 发音评测</span>
          </div>
        </div>

        <label className="fieldLabel" htmlFor="scenario">
          练习场景
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

function levelLabel(level: ScenarioPack["level"]): string {
  if (level === "easy") return "简单";
  if (level === "hard") return "困难";
  return "中等";
}

createRoot(document.getElementById("root")!).render(<App />);
