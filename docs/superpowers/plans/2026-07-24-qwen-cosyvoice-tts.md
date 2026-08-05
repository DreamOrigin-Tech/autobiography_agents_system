# Qwen TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen `qwen-audio-3.0-tts-flash` speech synthesis for interview prompts with browser TTS fallback, plus Qwen `qwen3-asr-flash` transcription for user recordings.

**Architecture:** FastAPI exposes authenticated `/api/tts` and `/api/asr`. TTS calls DashScope SpeechSynthesizer over WebSocket and returns MP3 bytes. ASR accepts base64 browser recordings, calls Qwen-ASR through the OpenAI-compatible API, and returns text. The Next.js interview page requests remote audio first, records user answers with MediaRecorder, transcribes them through the backend, and falls back to the existing browser speech path for TTS errors.

**Tech Stack:** FastAPI, Pydantic settings, `httpx`, `websockets`, Next.js, browser `Audio`, MediaRecorder, Web Speech API fallback for TTS only.

---

### Task 1: Backend TTS API

**Files:**
- Create: `backend/app/services/tts_service.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/schemas/__init__.py`
- Modify: `backend/app/api/routes.py`
- Modify: `backend/pyproject.toml`
- Test: `backend/tests/test_tts_api.py`
- Test: `backend/tests/test_tts_service.py`

- [x] Write failing API tests for missing config and successful MP3 response.
- [x] Write failing protocol tests for `run-task`, `continue-task`, and `finish-task` payloads.
- [x] Add TTS settings and direct `websockets` dependency.
- [x] Implement DashScope TTS message builders and async synthesis.
- [x] Add `POST /api/tts`.
- [x] Run backend TTS tests.

### Task 2: Frontend Remote Playback

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/voice.ts`
- Modify: `frontend/src/lib/voice.test.ts`
- Modify: `frontend/src/app/project/[id]/interview/[chapterId]/page.tsx`

- [x] Write failing tests for remote-first voice playback and fallback.
- [x] Add `api.synthesizeSpeech(text)` returning an audio `Blob`.
- [x] Add `speakWithPreferredVoice`, `playSpeechBlob`, and remote playback cancellation.
- [x] Replace interview-page `speakChinese` calls with the remote-first helper.
- [x] Run frontend voice tests.

### Task 3: Verification

**Files:**
- Modify only if verification exposes defects.

- [x] Run backend focused tests.
- [x] Run frontend focused tests.
- [x] Run lint/type checks when dependency state allows.
- [x] Verify `/health` shows TTS configuration status.

### Task 4: Backend Qwen-ASR API

**Files:**
- Create: `backend/app/services/asr_service.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/schemas/__init__.py`
- Modify: `backend/app/api/routes.py`
- Test: `backend/tests/test_asr_api.py`
- Test: `backend/tests/test_asr_service.py`

- [x] Write failing service tests for Data URL creation, ASR payload construction, response parsing, missing config, and audio size validation.
- [x] Write failing API tests for auth, success, invalid base64, and upstream failure.
- [x] Add ASR settings and health-check status.
- [x] Implement Qwen-ASR service over the OpenAI-compatible API.
- [x] Add `POST /api/asr`.
- [x] Run backend ASR tests.

### Task 5: Frontend Recording Transcription

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/voice.ts`
- Modify: `frontend/src/lib/voice.test.ts`
- Modify: `frontend/src/app/project/[id]/interview/[chapterId]/page.tsx`

- [x] Write failing tests for backend-ASR recording support and recording MIME selection.
- [x] Add `api.transcribeSpeech(audio)` returning text.
- [x] Add MediaRecorder support detection and MIME selection helpers.
- [x] Replace browser speech recognition as the primary listening path with explicit recording plus Qwen-ASR transcription.
- [x] Run frontend voice tests and type checks.
