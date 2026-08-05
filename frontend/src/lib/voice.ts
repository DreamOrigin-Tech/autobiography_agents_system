export type VoicePhase =
  | "idle"
  | "speaking"
  | "listening"
  | "reviewing"
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
  | { type: "transcript-ready"; transcript: string }
  | { type: "submit-started" }
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
      return state.active ? { ...state, phase: "listening", transcript: "", error: "" } : state;
    case "interim-transcript":
      return state.active
        ? { ...state, phase: "listening", transcript: event.transcript, error: "" }
        : state;
    case "final-transcript":
    case "transcript-ready":
      return state.active
        ? { ...state, phase: "reviewing", transcript: event.transcript, error: "" }
        : state;
    case "submit-started":
      return state.active ? { ...state, phase: "submitting", error: "" } : state;
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
  recording: boolean;
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

export interface MediaRecorderConstructorLike {
  new (stream: unknown, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
}

export interface MediaRecorderLike {
  state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface MediaDevicesLike {
  getUserMedia: (constraints: unknown) => Promise<unknown>;
}

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

export interface SpeechVoiceLike {
  name?: string;
  lang?: string;
  localService?: boolean;
  default?: boolean;
}

export interface SpeechSynthesisLike {
  getVoices: () => SpeechVoiceLike[];
  speak: (utterance: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
}

export interface VoiceEnvironment {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  MediaRecorder?: MediaRecorderConstructorLike;
  mediaDevices?: MediaDevicesLike;
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceConstructor;
}

let activeSpeechAudio: HTMLAudioElement | null = null;
let activeSpeechAudioUrl = "";

export function getVoiceSupport(environment?: VoiceEnvironment): VoiceSupport {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const recognition = Boolean(target.SpeechRecognition || target.webkitSpeechRecognition);
  const mediaDevices = target.mediaDevices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  const Recorder =
    target.MediaRecorder ??
    (typeof globalThis !== "undefined" && "MediaRecorder" in globalThis
      ? (globalThis.MediaRecorder as MediaRecorderConstructorLike)
      : undefined);
  const recording = Boolean(mediaDevices?.getUserMedia && Recorder);
  const synthesis = Boolean(target.speechSynthesis && target.SpeechSynthesisUtterance);
  return {
    recognition,
    recording,
    synthesis,
    supported: recording && synthesis,
  };
}

export function selectAudioRecordingMimeType(environment?: VoiceEnvironment): string {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const Recorder =
    target.MediaRecorder ??
    (typeof globalThis !== "undefined" && "MediaRecorder" in globalThis
      ? (globalThis.MediaRecorder as MediaRecorderConstructorLike)
      : undefined);
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/mpeg",
  ];
  if (!Recorder?.isTypeSupported) return "";
  return candidates.find((type) => Recorder.isTypeSupported?.(type)) || "";
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

export async function speakChinese(
  text: string,
  environment?: VoiceEnvironment,
): Promise<void> {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  const synthesis = target.speechSynthesis;
  const Utterance = target.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance || !text.trim()) return;

  let voices = synthesis.getVoices();
  if (voices.length === 0) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250));
    voices = synthesis.getVoices();
  }
  const voice = selectChineseVoice(voices);
  const segments = prepareSpeechSegments(text);
  synthesis.cancel();

  for (const segment of segments) {
    await speakSegment(segment, synthesis, Utterance, voice);
  }
}

export async function speakWithPreferredVoice(
  text: string,
  remoteSpeak: (text: string) => Promise<void>,
  browserSpeak: (text: string) => Promise<void>,
): Promise<"remote" | "browser" | "none"> {
  const cleaned = text.trim();
  if (!cleaned) return "none";

  try {
    await remoteSpeak(cleaned);
    return "remote";
  } catch {
    await browserSpeak(cleaned);
    return "browser";
  }
}

export function playSpeechBlob(blob: Blob): Promise<void> {
  if (
    typeof Audio === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return Promise.reject(new Error("当前浏览器不支持音频播放"));
  }

  cancelSpeechAudio();
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  activeSpeechAudio = audio;
  activeSpeechAudioUrl = objectUrl;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (activeSpeechAudio === audio) {
        activeSpeechAudio = null;
        activeSpeechAudioUrl = "";
      }
      URL.revokeObjectURL(objectUrl);
      if (error) reject(error);
      else resolve();
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("语音音频播放失败"));
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch((error) => finish(error));
    }
  });
}

export function selectChineseVoice(voices: SpeechVoiceLike[]): SpeechVoiceLike | undefined {
  return voices
    .map((voice, index) => ({ voice, index, score: chineseVoiceScore(voice) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice;
}

export function prepareSpeechSegments(text: string): string[] {
  const spoken = text
    .trim()
    .replace(/[「」『』“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[：:]/g, "，");
  return spoken
    .split(/(?<=[。！？!?])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function chineseVoiceScore(voice: SpeechVoiceLike): number {
  const lang = (voice.lang || "").toLowerCase().replace(/_/g, "-");
  const name = (voice.name || "").toLowerCase();
  let score = 0;

  if (lang === "zh-cn" || lang === "cmn-hans-cn") score += 100;
  else if (lang.startsWith("zh-hans")) score += 90;
  else if (lang === "zh-tw" || lang.startsWith("zh-hant-tw")) score += 45;
  else if (lang === "zh-hk" || lang.startsWith("yue")) score += 20;
  else if (lang.startsWith("zh") || lang.startsWith("cmn")) score += 55;
  else return 0;

  if (/natural|neural|premium|enhanced/.test(name)) score += 35;
  if (/xiaoxiao|xiaoyi|yunxi|yunyang|tingting|ting-ting|google.*(普通话|mandarin)/.test(name)) score += 25;
  if (/cantonese|粤语|廣東話/.test(name)) score -= 50;
  if (voice.localService) score += 3;
  if (voice.default) score += 1;
  return score;
}

function speakSegment(
  segment: string,
  synthesis: SpeechSynthesisLike,
  Utterance: SpeechSynthesisUtteranceConstructor,
  voice?: SpeechVoiceLike,
): Promise<void> {
  return new Promise((resolve) => {
    const utterance = new Utterance(segment);
    utterance.lang = "zh-CN";
    utterance.rate = 0.88;
    utterance.pitch = 0.97;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    utterance.onend = () => globalThis.setTimeout(resolve, 120);
    utterance.onerror = () => resolve();
    synthesis.speak(utterance);
  });
}

export function cancelSpeech(environment?: VoiceEnvironment): void {
  const target = (environment ?? (typeof window !== "undefined" ? window : {})) as VoiceEnvironment;
  target.speechSynthesis?.cancel();
  cancelSpeechAudio();
}

function cancelSpeechAudio(): void {
  const audio = activeSpeechAudio;
  if (audio) {
    audio.pause();
    audio.src = "";
  }
  if (activeSpeechAudioUrl && typeof URL !== "undefined") {
    URL.revokeObjectURL(activeSpeechAudioUrl);
  }
  activeSpeechAudio = null;
  activeSpeechAudioUrl = "";
}
