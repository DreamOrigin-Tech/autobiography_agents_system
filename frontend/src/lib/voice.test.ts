import assert from "node:assert/strict";
import test from "node:test";

import {
  initialVoiceState,
  voiceErrorMessage,
  voiceReducer,
} from "./voice.ts";

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
    type: "final-transcript",
    transcript: "我记得那年冬天很冷。",
  });
  assert.equal(submitting.phase, "submitting");
  assert.equal(submitting.transcript, "我记得那年冬天很冷。");

  const replying = voiceReducer(submitting, { type: "submit-succeeded" });
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
