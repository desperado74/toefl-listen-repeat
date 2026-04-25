import type {
  AppConfig,
  AttemptResult,
  AzureToken,
  InterviewAttempt,
  InterviewReferenceAnswer,
  InterviewSet,
  InterviewSetSummary,
  ReadingAttemptResult,
  ReadingAdaptiveCompleteResult,
  ReadingAdaptiveSession,
  ReadingModule,
  ReadingRouterResult,
  ReadingSet,
  ReadingSetSummary,
  ScenarioPack,
  SessionAnalytics,
  TrainingPlan,
} from "./types";

export async function fetchScenarios(): Promise<ScenarioPack[]> {
  const response = await fetch("/api/scenarios");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.scenarios;
}

export async function fetchAppConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function saveDeepSeekConfig(params: {
  apiKey: string;
  model: string;
  enable: boolean;
}): Promise<Pick<AppConfig, "deepSeekConfigured" | "interviewAiProvider" | "deepSeekModel">> {
  const response = await fetch("/api/config/deepseek", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "保存 DeepSeek 配置失败");
  }
  return response.json();
}

export async function fetchAzureToken(): Promise<AzureToken> {
  const response = await fetch("/api/azure-token");
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "获取 Azure token 失败");
  }
  return response.json();
}

export async function saveAttempt(params: {
  scenarioId: string;
  sentenceId: string;
  referenceText: string;
  durationMs: number;
  azureRaw: unknown;
  audioBlob: Blob;
}): Promise<AttemptResult> {
  const form = new FormData();
  form.set("scenario_id", params.scenarioId);
  form.set("sentence_id", params.sentenceId);
  form.set("reference_text", params.referenceText);
  form.set("duration_ms", String(params.durationMs));
  form.set("azure_raw_json", JSON.stringify(params.azureRaw));
  form.set("audio", params.audioBlob, `${params.sentenceId}.wav`);

  const response = await fetch("/api/attempts", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "保存练习记录失败");
  }
  return response.json();
}

export async function fetchTrainingPlan(): Promise<TrainingPlan> {
  const response = await fetch("/api/training-plan");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchSessionAnalytics(): Promise<SessionAnalytics> {
  const response = await fetch("/api/session-analytics");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function fetchAttempts(limit = 200): Promise<AttemptResult[]> {
  const response = await fetch(`/api/attempts?limit=${limit}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.attempts;
}

export async function fetchReinforcementScenario(): Promise<ScenarioPack> {
  const response = await fetch("/api/reinforcement-scenario");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.scenario;
}

export async function fetchReadingSets(): Promise<ReadingSetSummary[]> {
  const response = await fetch("/api/reading/sets");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.sets;
}

export async function fetchInterviewSets(): Promise<InterviewSetSummary[]> {
  const response = await fetch("/api/interview/sets");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.sets;
}

export async function fetchInterviewSet(setId: string): Promise<InterviewSet> {
  const response = await fetch(`/api/interview/sets/${setId}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.set;
}

export async function fetchInterviewAttempts(limit = 80): Promise<InterviewAttempt[]> {
  const response = await fetch(`/api/interview/attempts?limit=${limit}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.attempts;
}

export async function saveInterviewAttempt(params: {
  setId: string;
  questionId: string;
  durationMs: number;
  audioBlob: Blob;
  transcript?: string;
}): Promise<InterviewAttempt> {
  const form = new FormData();
  form.set("set_id", params.setId);
  form.set("question_id", params.questionId);
  form.set("duration_ms", String(params.durationMs));
  form.set("transcript", params.transcript ?? "");
  form.set("scoring_status", "not_scored");
  form.set("ai_feedback_json", "{}");
  form.set("rubric_scores_json", "{}");
  form.set("audio", params.audioBlob, `${params.questionId}.wav`);

  const response = await fetch("/api/interview/attempts", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "保存 Interview 练习记录失败");
  }
  const data = await response.json();
  return data.attempt;
}

export async function generateInterviewReferenceAnswer(params: {
  setId: string;
  questionId: string;
  attemptId: string;
  force?: boolean;
}): Promise<InterviewReferenceAnswer> {
  const response = await fetch("/api/interview/reference-answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      setId: params.setId,
      questionId: params.questionId,
      attemptId: params.attemptId,
      targetLevel: "4.5/5",
      force: params.force ?? false
    })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "生成参考答案失败");
  }
  const data = await response.json();
  return data.referenceAnswer;
}

export async function fetchReadingSet(setId: string): Promise<ReadingSet> {
  const response = await fetch(`/api/reading/sets/${setId}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.set;
}

export async function fetchReadingAdaptiveSessions(): Promise<ReadingAdaptiveSession[]> {
  const response = await fetch("/api/reading/adaptive");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.sessions;
}

export async function fetchReadingModule(moduleId: string): Promise<ReadingModule> {
  const response = await fetch(`/api/reading/modules/${moduleId}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const data = await response.json();
  return data.module;
}

export async function submitReadingRouter(params: {
  sessionId: string;
  moduleId: string;
  answers: Record<string, number | string>;
  elapsedMs: number;
}): Promise<ReadingRouterResult> {
  const response = await fetch("/api/reading/adaptive/router", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "提交 Router 失败");
  }
  return response.json();
}

export async function completeReadingAdaptiveSession(params: {
  sessionId: string;
  routerModuleId: string;
  secondModuleId: string;
  routePath: "lower" | "upper";
  routerAnswers: Record<string, number | string>;
  secondAnswers: Record<string, number | string>;
  routerElapsedMs: number;
  secondElapsedMs: number;
}): Promise<ReadingAdaptiveCompleteResult> {
  const response = await fetch("/api/reading/adaptive/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "提交自适应阅读失败");
  }
  return response.json();
}

export async function submitReadingAttempt(params: {
  setId: string;
  answers: Record<string, number | string>;
  elapsedMs: number;
}): Promise<ReadingAttemptResult> {
  const response = await fetch("/api/reading/attempts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "提交阅读练习失败");
  }
  const data = await response.json();
  return data.result;
}

export async function loginWithPassword(password: string): Promise<void> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "应用解锁失败");
  }
}
