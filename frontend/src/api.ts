import type { AppConfig, AttemptResult, AzureToken, ScenarioPack, SessionAnalytics, TrainingPlan } from "./types";

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
