import type { PracticeSentence } from "./types";

export async function playPrompt(sentence: PracticeSentence): Promise<void> {
  if (sentence.audioUrl) {
    await playAudio(sentence.audioUrl);
    return;
  }
  await speak(sentence.text);
}

function playAudio(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Unable to play prompt audio"));
    audio.play().catch(reject);
  });
}

function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error("No local TTS available. Add an audioUrl for this sentence."));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.voice = chooseStableVoice();
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Local TTS failed"));
    window.speechSynthesis.speak(utterance);
  });
}

function chooseStableVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const preferredNames = ["Samantha", "Alex", "Ava", "Daniel", "Google US English"];
  for (const name of preferredNames) {
    const voice = voices.find((item) => item.name.includes(name) && item.lang.startsWith("en"));
    if (voice) return voice;
  }
  return voices.find((item) => item.lang === "en-US") ?? voices.find((item) => item.lang.startsWith("en")) ?? null;
}
