# Qwen TTS Design

## Goal

Use Qwen `qwen-audio-3.0-tts-flash` to provide more natural Chinese speech for interview prompts, and use Qwen `qwen3-asr-flash` to transcribe user recordings without relying on browser speech recognition services.

## Architecture

The FastAPI backend owns the DashScope API key and connects to DashScope APIs. The frontend requests synthesized audio from the backend and plays the returned MP3. For user answers, the browser records a short audio blob and sends base64 audio to the backend, which calls Qwen-ASR and returns text. If remote TTS playback fails, the existing browser `speechSynthesis` path remains available.

## Backend

- Add TTS settings for `DASHSCOPE_API_KEY`, `TTS_MODEL`, `TTS_VOICE`, format, sample rate, speaking rate, pitch, and timeout.
- Add ASR settings for `ASR_MODEL`, language, ITN, timeout, max audio size, and compatible API URL.
- Add `app.services.tts_service` to build DashScope TTS WebSocket messages and collect binary audio until `task-finished`.
- Add `app.services.asr_service` to build OpenAI-compatible Qwen-ASR requests with Data URL audio input and parse transcription responses.
- Add `POST /api/tts` with the normal user auth dependency and paid-service rate limiting.
- Add `POST /api/asr` with the normal user auth dependency and paid-service rate limiting.
- Return `503` when the DashScope key is missing and `502` when upstream synthesis fails.
- Return `503` when ASR configuration is missing, `400` for invalid audio input, and `502` when upstream transcription fails.

## Frontend

- Add an audio request helper that returns a `Blob` instead of JSON.
- Add an ASR request helper that uploads browser-recorded audio as base64 JSON and returns transcribed text.
- Add a small voice orchestration helper that tries remote audio first and falls back to browser speech.
- Update the interview page to use remote audio for agent prompts, record user answers with `MediaRecorder`, transcribe recordings through Qwen-ASR, and cancel playback/recording when pausing, stopping, or interrupting.

## Constraints

- First release synthesizes a complete MP3 before playback. Streaming playback can be added later.
- Default model is `qwen-audio-3.0-tts-flash`, default voice is `longanhuan_v3.6`. Format is `mp3`, sample rate is `22050`, speaking rate is `0.95`, pitch is `1.0`.
- Default ASR model is `qwen3-asr-flash`, language is `zh`, ITN is disabled, and source audio is capped before base64 expansion.
- Text submitted to TTS is capped in the API schema to avoid accidental long paid requests.

## Verification

- Backend tests cover missing configuration, missing voice id, auth, upstream failure, successful audio response, DashScope TTS protocol message construction, ASR request construction, base64 validation, and transcription parsing.
- Frontend tests cover remote-first playback, browser fallback, and backend-ASR recording support detection.
- Manual verification uses `/api/tts` and `/api/asr` only when `DASHSCOPE_API_KEY` is configured.
