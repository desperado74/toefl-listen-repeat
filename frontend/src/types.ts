export type ScenarioPack = {
  id: string;
  title: string;
  context: string;
  level: "easy" | "medium" | "hard";
  topic?: string;
  sourceType?: string;
  sentences: PracticeSentence[];
};

export type PracticeSentence = {
  id: string;
  order: number;
  text: string;
  audioUrl: string;
};

export type AzureToken = {
  token: string;
  region: string;
};

export type AppConfig = {
  azureConfigured: boolean;
  azureRegion: string | null;
  envPath: string;
  requiresPassword: boolean;
  authenticated: boolean;
};

export type ScoreSummary = {
  provider: string;
  referenceText: string;
  recognizedText: string;
  scores: {
    overall: number | null;
    accuracy: number | null;
    fluency: number | null;
    completeness: number | null;
    prosody: number | null;
    repeatAccuracy: number | null;
  };
  diagnostics: {
    totalWords: number;
    omissionCount: number;
    insertionCount: number;
    mispronunciationCount: number;
    repetitionCount: number;
    lowWordCount: number;
    lowPhonemeCount: number;
    prosodyAvailable: boolean;
  };
  detailedFeedback: string[];
  issues: {
    omissions: string[];
    insertions: string[];
    mispronunciations: string[];
    repetitions: string[];
    low_score_words: { word: string; accuracy: number }[];
    low_score_phonemes: { word: string; phoneme: string; accuracy: number }[];
  };
  words: {
    word: string;
    accuracy: number | null;
    errorType: string;
    phonemes: { phoneme: string; accuracy: number | null; syllable?: string }[];
  }[];
  summary: string;
  nextAction: string;
};

export type AttemptResult = {
  id: string;
  scenario_id?: string;
  sentence_id?: string;
  normalized: ScoreSummary;
  tags: string[];
  audioPath: string;
  audioUrl: string;
  localAudioUrl?: string;
};

export type TrainingPlan = {
  headline: string;
  focus: string[];
  recommendedSentenceIds: string[];
  weakWords: { text: string; count: number }[];
  weakPhonemes: { text: string; count: number }[];
  reviewQueue?: {
    sentenceId: string;
    priority: "now" | "next" | "later";
    priorityLabel: string;
    priorityScore: number;
    reviewStage: "repair" | "build" | "stabilize" | "retain";
    reviewStageLabel: string;
    targetGapDays: number;
    daysSinceLatest: number;
    dueInDays: number;
    dueStatus: "due_now" | "due_soon" | "scheduled" | "stable";
    dueLabel: string;
    lastAttemptAt: string;
    reason: string;
    suggestedAction: string;
    latestRepeatAccuracy: number | null;
    averageRepeatAccuracy: number | null;
    deltaFromPrevious: number | null;
    attempts: number;
    focusWords: string[];
    focusPhonemes: string[];
  }[];
  reviewSummary?: {
    dueNowCount: number;
    dueSoonCount: number;
    scheduledCount: number;
    stableCount: number;
    headline: string;
  };
};

export type SessionAnalytics = {
  summary: {
    totalAttempts: number;
    practicedSentences: number;
    averageRepeatAccuracy: number | null;
    bestRepeatAccuracy: number | null;
  };
  recentTrend: {
    attemptId: string;
    sentenceId: string;
    referenceText: string;
    createdAt: string;
    repeatAccuracy: number | null;
  }[];
  weakestSentences: {
    sentenceId: string;
    referenceText: string;
    attempts: number;
    averageRepeatAccuracy: number | null;
    latestRepeatAccuracy: number | null;
    deltaFromPrevious: number | null;
    lastAttemptAt: string;
  }[];
  improvingSentences: {
    sentenceId: string;
    referenceText: string;
    attempts: number;
    averageRepeatAccuracy: number | null;
    latestRepeatAccuracy: number | null;
    deltaFromPrevious: number | null;
    lastAttemptAt: string;
  }[];
  focusBreakdown: {
    label: string;
    count: number;
  }[];
};
