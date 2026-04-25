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
  difficultyStage?: "easy" | "medium" | "hard";
  estimatedSyllables?: number;
};

export type AzureToken = {
  token: string;
  region: string;
};

export type AppConfig = {
  azureConfigured: boolean;
  azureRegion: string | null;
  deepSeekConfigured: boolean;
  interviewAiProvider: string;
  deepSeekModel: string;
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

export type ReadingSetSummary = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number;
  descriptionZh: string;
  questionCount: number;
  sectionTypes: ReadingSectionType[];
};

export type ReadingSectionType = "complete_words" | "daily_life" | "academic_passage";

export type ReadingSet = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number;
  descriptionZh: string;
  sections: ReadingSection[];
};

export type ReadingSection = {
  id: string;
  type: ReadingSectionType;
  title: string;
  instructionsZh: string;
  passage: string;
  blanks?: ReadingWordBlank[];
  questions: ReadingQuestion[];
};

export type ReadingWordBlank = {
  id: string;
  prefix: string;
  answer: string;
  fullWord: string;
  explanationZh: string;
  evidence: string;
  skillTags: string[];
  errorTags: string[];
  difficulty: "easy" | "medium" | "hard";
};

export type ReadingQuestion = {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  answer: number;
  explanationZh: string;
  evidence: string;
  skillTags: string[];
  errorTags: string[];
  difficulty: "easy" | "medium" | "hard";
};

export type ReadingAttemptResult = {
  setId: string;
  title: string;
  correct: number;
  total: number;
  accuracy: number;
  estimatedBand: string;
  elapsedMs: number;
  sectionBreakdown: Record<string, ReadingBreakdown>;
  skillBreakdown: Record<string, ReadingBreakdown>;
  missed: ReadingMissedQuestion[];
  summaryZh: string;
};

export type ReadingBreakdown = {
  correct: number;
  total: number;
  accuracy: number;
};

export type ReadingMissedQuestion = {
  questionId: string;
  sectionType: ReadingSectionType;
  prompt: string;
  submitted: number | string | null;
  submittedText?: string;
  answer: number | string;
  answerText?: string;
  fullAnswer?: string;
  explanationZh: string;
  evidence: string;
  skillTags: string[];
  errorTags: string[];
};

export type InterviewSetSummary = {
  id: string;
  title: string;
  theme: string;
  difficulty: "easy" | "medium" | "hard";
  descriptionZh: string;
  questionCount: number;
  answerSeconds: number;
};

export type InterviewSet = {
  id: string;
  title: string;
  theme: string;
  difficulty: "easy" | "medium" | "hard";
  descriptionZh: string;
  answerSeconds: number;
  questions: InterviewQuestion[];
};

export type InterviewQuestion = {
  id: string;
  order: number;
  interviewerText: string;
  audioUrl: string;
  answerSeconds: number;
  focus: string;
  reviewHintZh: string;
};

export type InterviewAttempt = {
  id: string;
  setId: string;
  questionId: string;
  durationMs: number;
  transcript: string;
  aiFeedback: InterviewFeedback;
  rubricScores: Record<string, number>;
  scoringStatus:
    | "not_scored"
    | "pending"
    | "scored"
    | "failed"
    | "feedback_ready"
    | "empty_transcript"
    | "failed_transcription"
    | "stt_not_configured";
  audioPath: string;
  audioUrl: string;
  localAudioUrl?: string;
  createdAt?: string;
};

export type InterviewFeedback = {
  provider?: string;
  aiProvider?: string;
  aiProviderStatus?: string;
  model?: string;
  isOfficialScore?: boolean;
  noticeZh?: string;
  summaryZh?: string;
  overallScore?: number;
  strengthsZh?: string[];
  prioritiesZh?: string[];
  nextPracticeZh?: string;
  metrics?: {
    durationSeconds?: number;
    wordCount?: number;
    wpm?: number;
    uniqueWordRatio?: number;
    fillerCount?: number;
    structureMarkerCount?: number;
    promptKeywordOverlap?: number;
    recognitionConfidence?: number | null;
  };
  dimensions?: Record<
    "delivery" | "languageUse" | "topicDevelopment" | "organization",
    {
      level: "on_track" | "developing" | "needs_work";
      messages: string[];
    }
  >;
  rubricScores?: Record<string, number>;
  stt?: {
    provider?: string;
    configured?: boolean;
    confidence?: number | null;
    recognitionStatus?: string;
    error?: string;
  };
};

export type InterviewReferenceAnswer = {
  id: string;
  setId: string;
  questionId: string;
  provider: "local" | "deepseek" | "openai" | "qwen" | string;
  model: string;
  answerText: string;
  learningPoints: string[];
  targetLevel: string;
  wordCount: number;
  createdAt: string;
};
