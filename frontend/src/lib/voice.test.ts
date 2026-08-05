import assert from "node:assert/strict";
import test from "node:test";

import {
  initialVoiceState,
  prepareSpeechSegments,
  selectAudioRecordingMimeType,
  selectChineseVoice,
  speakWithPreferredVoice,
  voiceErrorMessage,
  voiceReducer,
  getVoiceSupport,
} from "./voice.ts";

class FakeMediaRecorder {
  state = "inactive" as const;
  ondataavailable = null;
  onerror = null;
  onstop = null;

  static isTypeSupported(type: string) {
    return type === "audio/webm;codecs=opus";
  }

  start() {}

  stop() {}
}

test("voice selection prefers a natural mainland Mandarin voice", () => {
  const cantonese = { name: "Sin-Ji", lang: "zh-HK", localService: true };
  const mandarin = { name: "Microsoft Xiaoxiao Online (Natural)", lang: "zh-CN" };
  const fallback = { name: "Generic Chinese", lang: "zh" };

  assert.equal(selectChineseVoice([cantonese, fallback, mandarin]), mandarin);
});

test("speech text removes written quotation marks and pauses by sentence", () => {
  assert.deepEqual(
    prepareSpeechSegments("说到「大院里的童年：票证和电影」，慢慢想。记不清也没关系。"),
    ["说到大院里的童年，票证和电影，慢慢想。", "记不清也没关系。"],
  );
});

test("voice conversation moves from prompt to listening to submission and back", () => {
  const started = voiceReducer(initialVoiceState, { type: "start", hasPrompt: true });
  assert.deepEqual(started, {
    active: true,
    phase: "speaking",
    transcript: "",
    error: "",
  });

  const listening = voiceReducer(started, { type: "speech-ended" });
  assert.equal(listening.phase, "listening");

  const submitting = voiceReducer(listening, {
    type: "transcript-ready",
    transcript: "我记得那年冬天很冷。",
  });
  assert.equal(submitting.phase, "reviewing");
  assert.equal(submitting.transcript, "我记得那年冬天很冷。");

  const sending = voiceReducer(submitting, { type: "submit-started" });
  assert.equal(sending.phase, "submitting");
  assert.equal(sending.transcript, "我记得那年冬天很冷。");

  const replying = voiceReducer(sending, { type: "submit-succeeded" });
  assert.equal(replying.phase, "speaking");
  assert.equal(replying.transcript, "");
});

test("pause ignores late speech events and resume returns to the latest prompt", () => {
  const started = voiceReducer(initialVoiceState, { type: "start", hasPrompt: true });
  const paused = voiceReducer(started, { type: "pause" });
  const lateSpeechEnd = voiceReducer(paused, { type: "speech-ended" });

  assert.equal(lateSpeechEnd.phase, "paused");
  assert.equal(lateSpeechEnd.active, false);

  const resumed = voiceReducer(lateSpeechEnd, { type: "resume", hasPrompt: true });
  assert.equal(resumed.phase, "speaking");
  assert.equal(resumed.active, true);
});

test("stopping clears transcript and errors", () => {
  const failed = voiceReducer(initialVoiceState, {
    type: "error",
    message: "没有麦克风权限",
  });
  const stopped = voiceReducer(failed, { type: "stop" });

  assert.deepEqual(stopped, initialVoiceState);
});

test("permission errors use an actionable Chinese explanation", () => {
  assert.match(voiceErrorMessage("not-allowed"), /麦克风权限/);
  assert.match(voiceErrorMessage("audio-capture"), /麦克风/);
  assert.match(voiceErrorMessage("network"), /网络/);
});

test("voice support allows backend ASR recording without browser speech recognition", () => {
  const support = getVoiceSupport({
    speechSynthesis: { getVoices: () => [], speak: () => {}, cancel: () => {} },
    SpeechSynthesisUtterance: class {
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice = null;
      onend = null;
      onerror = null;
    },
    MediaRecorder: FakeMediaRecorder,
    mediaDevices: {
      getUserMedia: async () => ({}),
    },
  });

  assert.equal(support.recognition, false);
  assert.equal(support.recording, true);
  assert.equal(support.supported, true);
});

test("audio recording mime type prefers webm opus when available", () => {
  const mimeType = selectAudioRecordingMimeType({
    MediaRecorder: FakeMediaRecorder,
  });

  assert.equal(mimeType, "audio/webm;codecs=opus");
});

test("preferred voice uses remote speech before browser fallback", async () => {
  const calls: string[] = [];

  const result = await speakWithPreferredVoice(
    "请讲讲那时候的一个画面。",
    async (text) => {
      calls.push(`remote:${text}`);
    },
    async (text) => {
      calls.push(`browser:${text}`);
    },
  );

  assert.equal(result, "remote");
  assert.deepEqual(calls, ["remote:请讲讲那时候的一个画面。"]);
});

test("preferred voice falls back to browser speech when remote speech fails", async () => {
  const calls: string[] = [];

  const result = await speakWithPreferredVoice(
    "请讲讲那时候的一个画面。",
    async (text) => {
      calls.push(`remote:${text}`);
      throw new Error("remote unavailable");
    },
    async (text) => {
      calls.push(`browser:${text}`);
    },
  );

  assert.equal(result, "browser");
  assert.deepEqual(calls, [
    "remote:请讲讲那时候的一个画面。",
    "browser:请讲讲那时候的一个画面。",
  ]);
});
