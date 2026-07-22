export type VoicePhase =
  | "idle"
  | "speaking"
  | "listening"
  | "submitting"
  | "paused"
  | "error";

export interface VoiceState {
  active: boolean;
  phase: VoicePhase;
  transcript: string;
  error: string;
}

export const initialVoiceState: VoiceState = {
  active: false,
  phase: "idle",
  transcript: "",
  error: "",
};

export type VoiceEvent =
  | { type: "start"; hasPrompt: boolean }
  | { type: "resume"; hasPrompt: boolean }
  | { type: "speech-started" }
  | { type: "speech-ended" }
  | { type: "listening-started" }
  | { type: "interim-transcript"; transcript: string }
  | { type: "final-transcript"; transcript: string }
  | { type: "submit-succeeded" }
  | { type: "submit-failed"; message: string }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "error"; message: string };

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "start":
    case "resume":
      return {
        active: true,
        phase: event.hasPrompt ? "speaking" : "listening",
        transcript: "",
        error: "",
      };
    case "speech-started":
      return state.active ? { ...state, phase: "speaking", error: "" } : state;
    case "speech-ended":
      return state.active && state.phase !== "paused" && state.phase !== "error"
        ? { ...state, phase: "listening", error: "" }
        : state;
    case "listening-started":
      return state.active ? { ...state, phase: "listening", error: "" } : state;
    case "interim-transcript":
      return state.active
        ? { ...state, phase: "listening", transcript: event.transcript, error: "" }
        : state;
    case "final-transcript":
      return state.active
        ? { ...state, phase: "submitting", transcript: event.transcript, error: "" }
        : state;
    case "submit-succeeded":
      return state.active ? { ...state, phase: "speaking", transcript: "", error: "" } : state;
    case "submit-failed":
      return { ...state, active: false, phase: "error", error: event.message };
    case "pause":
      return { ...state, active: false, phase: "paused", error: "" };
    case "stop":
      return initialVoiceState;
    case "error":
      return { ...state, active: false, phase: "error", error: event.message };
    default:
      return state;
  }
}

export interface VoiceSupport {
  recognition: boolean;
  synthesis: boolean;
  supported: boolean;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export interface SpeechSynthesisUtteranceLike {
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export type SpeechSynthesisUtteranceConstructor = new (
  text: string,
) => SpeechSynthesisUtteranceLike;

export interface SpeechSynthesisLike {
  getVoices: () => Array<{ lang?: string }>;
  speak: (utterance: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
}

export interface VoiceEnvironment {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceConstructor;
}

export function getVoiceSupport(environment?: VoiceEnvironment): VoiceSupport {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const recognition = Boolean(target.SpeechRecognition || target.webkitSpeechRecognition);
  const synthesis = Boolean(target.speechSynthesis && target.SpeechSynthesisUtterance);
  return {
    recognition,
    synthesis,
    supported: recognition && synthesis,
  };
}

export function createChineseRecognition(
  handlers: {
    onstart?: () => void;
    onresult?: (event: SpeechRecognitionEventLike) => void;
    onerror?: (event: SpeechRecognitionErrorEventLike) => void;
    onend?: () => void;
  },
  environment?: VoiceEnvironment,
): SpeechRecognitionLike | null {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const Constructor = target.SpeechRecognition || target.webkitSpeechRecognition;
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onstart = handlers.onstart ?? null;
  recognition.onresult = handlers.onresult ?? null;
  recognition.onerror = handlers.onerror ?? null;
  recognition.onend = handlers.onend ?? null;
  return recognition;
}

export function splitRecognitionResult(event: SpeechRecognitionEventLike): {
  finalText: string;
  interimText: string;
} {
  let finalText = "";
  let interimText = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result?.[0]?.transcript) continue;
    if (result.isFinal) {
      finalText += result[0].transcript;
    } else {
      interimText += result[0].transcript;
    }
  }
  return {
    finalText: finalText.trim(),
    interimText: interimText.trim(),
  };
}

export function voiceErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "麦克风权限没有打开。请在浏览器地址栏的权限设置里允许使用麦克风，再重新开始。";
    case "audio-capture":
      return "没有找到可用的麦克风。请检查设备连接或系统麦克风设置。";
    case "network":
      return "语音识别暂时连不上网络。可以重试，或切换回文字输入。";
    case "language-not-supported":
      return "当前浏览器暂不支持中文语音识别，可以切换回文字输入。";
    case "no-speech":
      return "这次没有听清，可以再说一遍。";
    default:
      return "语音对话暂时出了点问题，可以重试或切换回文字输入。";
  }
}

export function speakChinese(
  text: string,
  environment?: VoiceEnvironment,
): Promise<void> {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const synthesis = target.speechSynthesis;
  const Utterance = target.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance || !text.trim()) return Promise.resolve();

  return new Promise((resolve) => {
    const utterance = new Utterance(text.trim());
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    const chineseVoice = synthesis
      .getVoices()
      .find((voice) => voice.lang?.toLowerCase().startsWith("zh"));
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synthesis.speak(utterance);
  });
}

export function cancelSpeech(environment?: VoiceEnvironment): void {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  target.speechSynthesis?.cancel();
}
