import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { fetchAzureToken } from "./api";

let cachedToken: { token: string; region: string; fetchedAt: number } | null = null;

export async function assessPronunciation(referenceText: string, audioBlob: Blob): Promise<unknown> {
  const token = await getToken();
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token.token, token.region);
  speechConfig.speechRecognitionLanguage = "en-US";
  speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;

  const file = new File([audioBlob], "attempt.wav", { type: "audio/wav" });
  const audioConfig = SpeechSDK.AudioConfig.fromWavFileInput(file);
  const pronunciationConfig = new SpeechSDK.PronunciationAssessmentConfig(
    referenceText,
    SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
    SpeechSDK.PronunciationAssessmentGranularity.Phoneme,
    true
  );

  const configWithProsody = pronunciationConfig as SpeechSDK.PronunciationAssessmentConfig & {
    enableProsodyAssessment?: () => void;
  };
  configWithProsody.enableProsodyAssessment?.();
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
  pronunciationConfig.applyTo(recognizer);
  return new Promise((resolve, reject) => {
    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();
        if (result.reason === SpeechSDK.ResultReason.Canceled) {
          const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
          reject(new Error(cancellation.errorDetails || "Azure recognition canceled"));
          return;
        }
        const rawJson = result.properties.getProperty(
          SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult
        );
        if (!rawJson) {
          reject(new Error("Azure returned no detailed pronunciation JSON"));
          return;
        }
        resolve(JSON.parse(rawJson));
      },
      (error) => {
        recognizer.close();
        reject(new Error(String(error)));
      }
    );
  });
}

async function getToken(): Promise<{ token: string; region: string }> {
  const now = Date.now();
  if (cachedToken && now - cachedToken.fetchedAt < 8 * 60 * 1000) {
    return cachedToken;
  }
  const token = await fetchAzureToken();
  cachedToken = { ...token, fetchedAt: now };
  return cachedToken;
}
