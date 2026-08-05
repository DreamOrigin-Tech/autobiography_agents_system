"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type {
  AnswerQuality,
  ChapterCoverage,
  InterviewAssistantResponse,
  InterviewAssistantRole,
  InterviewMessage,
  ProjectDetail,
  WriteReadiness,
} from "@/lib/types";
import { ChatBubble } from "@/components/ChatBubble";
import { BottomNav } from "@/components/BottomNav";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { ChatSkeleton } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";
import { shouldOfferWrite, shouldShowDetailNudge } from "@/lib/interviewUi";
import {
  cancelSpeech,
  createChineseRecognition,
  getVoiceSupport,
  initialVoiceState,
  playSpeechBlob,
  selectAudioRecordingMimeType,
  speakChinese,
  speakWithPreferredVoice,
  splitRecognitionResult,
  type SpeechRecognitionLike,
  type VoiceSupport,
  voiceErrorMessage,
  voiceReducer,
} from "@/lib/voice";

const INTERVIEW_DRAFT_PREFIX = "interview_draft:";

export default function InterviewChatPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const chapterId = params.chapterId as string;
  const draftKey = `${INTERVIEW_DRAFT_PREFIX}${chapterId}`;
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [writing, setWriting] = useState(false);
  const [suggestedAction, setSuggestedAction] = useState<string>("continue");
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [readiness, setReadiness] = useState<WriteReadiness | null>(null);
  const [coverage, setCoverage] = useState<ChapterCoverage | null>(null);
  const [lastAnswerQuality, setLastAnswerQuality] = useState<AnswerQuality | null>(null);
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState("");
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [workMode, setWorkMode] = useState<"ai" | "assistant">("ai");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantRole, setAssistantRole] = useState<InterviewAssistantRole>("user");
  const [assistantAdvice, setAssistantAdvice] = useState<InterviewAssistantResponse | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"text" | "voice">("text");
  const [voiceSupport, setVoiceSupport] = useState<VoiceSupport>({
    recognition: false,
    recording: false,
    synthesis: false,
    supported: false,
  });
  const [voiceState, dispatchVoice] = useReducer(voiceReducer, initialVoiceState);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingShouldSubmitRef = useRef(false);
  const recordingSessionRef = useRef(0);
  const voiceActiveRef = useRef(false);
  const voicePhaseRef = useRef(voiceState.phase);
  const sendingRef = useRef(false);
  const speechRunRef = useRef(0);
  const voiceTimerRef = useRef<number | null>(null);
  const { toast } = useToast();

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    const timer = window.setTimeout(() => setVoiceSupport(getVoiceSupport()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    voicePhaseRef.current = voiceState.phase;
  }, [voiceState.phase]);

  function clearVoiceTimer() {
    if (voiceTimerRef.current !== null) {
      window.clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function stopRecognition() {
    stopRecording(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      // The browser may already have ended recognition.
    }
  }

  function stopRecording(shouldSubmit: boolean) {
    recordingShouldSubmitRef.current = shouldSubmit;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    if (!shouldSubmit) cleanupRecording();
  }

  function cleanupRecording() {
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    recordingChunksRef.current = [];
    recordingShouldSubmitRef.current = false;
  }

  function startListening() {
    if (!voiceActiveRef.current || sendingRef.current) return;
    clearVoiceTimer();
    stopRecognition();
    setError("");

    if (voiceSupport.recording && typeof navigator !== "undefined" && navigator.mediaDevices) {
      void startBackendAsrRecording();
      return;
    }

    const recognition = createChineseRecognition({
      onstart: () => {
        voicePhaseRef.current = "listening";
        dispatchVoice({ type: "listening-started" });
      },
      onresult: (event) => {
        const { finalText, interimText } = splitRecognitionResult(event);
        if (finalText) {
          voicePhaseRef.current = "reviewing";
          setInput(finalText);
          dispatchVoice({ type: "transcript-ready", transcript: finalText });
          try {
            recognition?.stop();
          } catch {
            // The final result can arrive just as the browser ends listening.
          }
          return;
        }
        if (interimText) {
          setInput(interimText);
          dispatchVoice({ type: "interim-transcript", transcript: interimText });
        }
      },
      onerror: (event) => {
        if (!voiceActiveRef.current || event.error === "aborted") return;
        const message = voiceErrorMessage(event.error);
        if (event.error === "no-speech") {
          setError(message);
          return;
        }
        voiceActiveRef.current = false;
        voicePhaseRef.current = "error";
        dispatchVoice({ type: "error", message });
        setError(message);
      },
      onend: () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (
          voiceActiveRef.current &&
          !sendingRef.current &&
          voicePhaseRef.current === "listening"
        ) {
          voiceTimerRef.current = window.setTimeout(() => {
            voiceTimerRef.current = null;
            startListening();
          }, 500);
        }
      },
    });

    if (!recognition) {
      const message = "当前浏览器不支持中文语音识别，可以切换回文字输入。";
      voiceActiveRef.current = false;
      voicePhaseRef.current = "error";
      dispatchVoice({ type: "error", message });
      setError(message);
      return;
    }

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      const message = "麦克风暂时无法启动，请检查权限后再试。";
      voiceActiveRef.current = false;
      voicePhaseRef.current = "error";
      dispatchVoice({ type: "error", message });
      setError(message);
    }
  }

  async function startBackendAsrRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!voiceActiveRef.current || sendingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = selectAudioRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const session = recordingSessionRef.current + 1;
      const chunks: Blob[] = [];
      recordingSessionRef.current = session;
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = chunks;
      recordingShouldSubmitRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!voiceActiveRef.current) return;
        const message = "麦克风录音失败。请检查权限或切换回文字输入。";
        voiceActiveRef.current = false;
        voicePhaseRef.current = "error";
        cleanupRecording();
        dispatchVoice({ type: "error", message });
        setError(message);
      };
      recorder.onstop = () => {
        const isCurrentSession = recordingSessionRef.current === session;
        const shouldSubmit = isCurrentSession && recordingShouldSubmitRef.current;
        const type = mimeType || chunks[0]?.type || "audio/webm";
        if (isCurrentSession) {
          cleanupRecording();
        } else {
          stream.getTracks().forEach((track) => track.stop());
        }
        if (!shouldSubmit || !voiceActiveRef.current || sendingRef.current) return;
        const audio = new Blob(chunks, { type });
        void transcribeAndReviewRecording(audio);
      };

      recorder.start();
      voicePhaseRef.current = "listening";
      dispatchVoice({ type: "listening-started" });
    } catch {
      const message = "麦克风暂时无法启动，请检查权限后再试。";
      voiceActiveRef.current = false;
      voicePhaseRef.current = "error";
      cleanupRecording();
      dispatchVoice({ type: "error", message });
      setError(message);
    }
  }

  async function transcribeAndReviewRecording(audio: Blob) {
    if (audio.size === 0) {
      const message = "这次没有听清，可以再说一遍。";
      setError(message);
      return;
    }

    voicePhaseRef.current = "submitting";
    dispatchVoice({ type: "submit-started" });
    setError("");
    try {
      const transcript = (await api.transcribeSpeech(audio)).trim();
      if (!transcript) {
        throw new Error("这次没有听清，可以再说一遍。");
      }
      setInput(transcript);
      voicePhaseRef.current = "reviewing";
      dispatchVoice({ type: "transcript-ready", transcript });
    } catch (error) {
      const message = error instanceof Error ? error.message : "语音识别服务暂时不可用";
      voiceActiveRef.current = false;
      voicePhaseRef.current = "error";
      dispatchVoice({ type: "error", message });
      setError(message);
    }
  }

  function submitReviewedVoiceAnswer() {
    const transcript = (input || voiceState.transcript).trim();
    if (!transcript || sendingRef.current) return;
    voicePhaseRef.current = "submitting";
    dispatchVoice({ type: "submit-started" });
    void submitAnswerContent(transcript, "voice");
  }

  function retryVoiceRecording() {
    if (!voiceActiveRef.current || sendingRef.current) return;
    setInput("");
    setError("");
    voicePhaseRef.current = "listening";
    dispatchVoice({ type: "listening-started" });
    startListening();
  }

  function finishVoiceRecording() {
    if (mediaRecorderRef.current) {
      stopRecording(true);
      return;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      // The browser may already have ended recognition.
    }
  }

  async function speakPromptAndListen(prompt: string) {
    if (!voiceActiveRef.current || !prompt.trim()) {
      if (voiceActiveRef.current) startListening();
      return;
    }

    stopRecognition();
    const run = speechRunRef.current + 1;
    speechRunRef.current = run;
    voicePhaseRef.current = "speaking";
    dispatchVoice({ type: "speech-started" });
    await speakAgentPrompt(prompt);
    if (run !== speechRunRef.current || !voiceActiveRef.current) return;
    voicePhaseRef.current = "listening";
    dispatchVoice({ type: "speech-ended" });
    startListening();
  }

  async function speakAgentPrompt(prompt: string) {
    await speakWithPreferredVoice(
      prompt,
      async (text) => {
        const audio = await api.synthesizeSpeech(text);
        await playSpeechBlob(audio);
      },
      speakChinese,
    );
  }

  async function submitAnswerContent(content: string, source: "text" | "voice") {
    const trimmed = content.trim();
    if (!trimmed || sendingRef.current) return;
    if (source === "text") stopRecognition();

    setLastSubmittedAnswer(trimmed);
    setInput("");
    setDraftRestored(false);
    setSending(true);
    sendingRef.current = true;
    setError("");
    window.localStorage.removeItem(draftKey);
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, role: "user", content: trimmed, created_at: new Date().toISOString() },
    ]);
    try {
      const result = await api.submitAnswer(chapterId, trimmed);
      setSuggestedAction(result.suggested_action || "continue");
      setLastAnswerQuality(result.answer_quality || null);
      if (result.memory_updated) {
        setProject((prev) => prev ? { ...prev, memory_notes: result.memory_notes } : prev);
        toast("已记住新的采访偏好，可在设置中修改", "success");
      }
      const [refreshed, refreshedProject, refreshedReadiness, refreshedCoverage] = await Promise.all([
        api.getInterviewMessages(chapterId),
        api.getProject(projectId),
        api.getWriteReadiness(chapterId),
        api.getChapterCoverage(chapterId),
      ]);
      setMessages(refreshed);
      setProject(refreshedProject);
      setPreferenceDraft(refreshedProject.preference_notes || "");
      setReadiness(refreshedReadiness);
      setCoverage(refreshedCoverage);

      if (voiceActiveRef.current) {
        setSending(false);
        sendingRef.current = false;
        const question = result.question || latestAgentMessage(refreshed);
        if (question) {
          voicePhaseRef.current = "speaking";
          dispatchVoice({ type: "submit-succeeded" });
          if (result.suggested_action === "write_chapter") {
            const run = speechRunRef.current + 1;
            speechRunRef.current = run;
            await speakAgentPrompt(question);
            if (run === speechRunRef.current) stopVoiceConversation();
          } else {
            await speakPromptAndListen(question);
          }
        } else {
          stopVoiceConversation();
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "发送失败";
      setError(message);
      if (voiceActiveRef.current) {
        voiceActiveRef.current = false;
        voicePhaseRef.current = "error";
        dispatchVoice({ type: "submit-failed", message });
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  function startVoiceConversation() {
    if (!voiceSupport.supported) {
      setError("当前浏览器不支持完整语音对话，可以切换回文字输入。");
      return;
    }
    setError("");
    voiceActiveRef.current = true;
    const prompt = latestAgentMessage(messages);
    voicePhaseRef.current = prompt ? "speaking" : "listening";
    dispatchVoice({ type: "start", hasPrompt: Boolean(prompt) });
    if (prompt) void speakPromptAndListen(prompt);
    else startListening();
  }

  function pauseVoiceConversation() {
    voiceActiveRef.current = false;
    clearVoiceTimer();
    speechRunRef.current += 1;
    stopRecognition();
    cancelSpeech();
    voicePhaseRef.current = "paused";
    dispatchVoice({ type: "pause" });
  }

  function resumeVoiceConversation() {
    if (!voiceSupport.supported) return;
    setError("");
    voiceActiveRef.current = true;
    const prompt = latestAgentMessage(messages);
    voicePhaseRef.current = prompt ? "speaking" : "listening";
    dispatchVoice({ type: "resume", hasPrompt: Boolean(prompt) });
    if (prompt) void speakPromptAndListen(prompt);
    else startListening();
  }

  function stopVoiceConversation() {
    voiceActiveRef.current = false;
    clearVoiceTimer();
    speechRunRef.current += 1;
    stopRecognition();
    cancelSpeech();
    voicePhaseRef.current = "idle";
    dispatchVoice({ type: "stop" });
  }

  function interruptSpeech() {
    if (!voiceActiveRef.current) return;
    speechRunRef.current += 1;
    cancelSpeech();
    voicePhaseRef.current = "listening";
    dispatchVoice({ type: "speech-ended" });
    startListening();
  }

  useEffect(() => {
    return () => {
      voiceActiveRef.current = false;
      if (voiceTimerRef.current !== null) {
        window.clearTimeout(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
      speechRunRef.current += 1;
      const recorder = mediaRecorderRef.current;
      recordingShouldSubmitRef.current = false;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      recordingChunksRef.current = [];
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      try {
        recognition?.abort();
      } catch {
        // The browser may already have ended recognition.
      }
      cancelSpeech();
    };
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const [data, proj, ready, chapterCoverage] = await Promise.all([
        api.getInterviewMessages(chapterId),
        api.getProject(projectId),
        api.getWriteReadiness(chapterId),
        api.getChapterCoverage(chapterId),
      ]);
      setProject(proj); setMessages(data); setReadiness(ready); setCoverage(chapterCoverage);
      setPreferenceDraft(proj.preference_notes || "");
      if (data.length === 0) {
        const result = await api.startInterview(chapterId);
        setSuggestedAction(result.suggested_action || "continue");
        const [refreshed, refreshedProject, refreshedReadiness, refreshedCoverage] = await Promise.all([
          api.getInterviewMessages(chapterId),
          api.getProject(projectId),
          api.getWriteReadiness(chapterId),
          api.getChapterCoverage(chapterId),
        ]);
        setMessages(refreshed);
        setProject(refreshedProject);
        setPreferenceDraft(refreshedProject.preference_notes || "");
        setReadiness(refreshedReadiness);
        setCoverage(refreshedCoverage);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, [chapterId, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMessages(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedDraft = window.localStorage.getItem(draftKey);
      if (savedDraft) {
        setInput(savedDraft);
        setDraftRestored(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = input.trim();
      if (draft) {
        window.localStorage.setItem(draftKey, input);
      } else {
        window.localStorage.removeItem(draftKey);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftKey, input]);

  useEffect(() => { scrollToBottom(); }, [messages, lastAnswerQuality]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sendingRef.current) return;
    void submitAnswerContent(input, "text");
  }

  function handleWrite() {
    if (readiness && !readiness.ready) {
      setError(readiness.message);
      return;
    }
    setWriting(true); setError(""); router.push(`/project/${projectId}/chapter/${chapterId}?writing=1`);
  }

  async function handleSavePreferences() {
    setSavingPreferences(true); setError("");
    try {
      const updated = await api.updateProject(projectId, { preference_notes: preferenceDraft.trim() });
      setProject(updated);
      setPreferenceDraft(updated.preference_notes || "");
      setEditingPreferences(false);
      toast("采访偏好已更新", "success");
    } catch (e) { setError(e instanceof Error ? e.message : "保存偏好失败"); }
    finally { setSavingPreferences(false); }
  }

  async function refreshAssistantGuidance() {
    setAssistantLoading(true); setError("");
    try {
      const advice = await api.getInterviewAssistantGuidance(chapterId);
      setAssistantAdvice(advice);
      setCoverage(advice.chapter_coverage);
      setSuggestedAction(advice.suggested_action);
    } catch (e) { setError(e instanceof Error ? e.message : "生成采访提示失败"); }
    finally { setAssistantLoading(false); }
  }

  async function handleRecordAssistantTurn(e: React.FormEvent) {
    e.preventDefault();
    const content = assistantInput.trim();
    if (!content || assistantLoading) return;
    setAssistantLoading(true); setError("");
    setAssistantInput("");
    try {
      const advice = await api.recordInterviewAssistantTurn(chapterId, assistantRole, content);
      const [refreshed, refreshedReadiness] = await Promise.all([
        api.getInterviewMessages(chapterId),
        api.getWriteReadiness(chapterId),
      ]);
      setMessages(refreshed);
      setReadiness(refreshedReadiness);
      setCoverage(advice.chapter_coverage);
      setSuggestedAction(advice.suggested_action);
      setAssistantAdvice(advice);
    } catch (e) {
      setAssistantInput(content);
      setError(e instanceof Error ? e.message : "记录失败");
    } finally { setAssistantLoading(false); }
  }

  if (loading) return (<div className="mx-auto max-w-6xl pt-4"><ChatSkeleton /></div>);

  const currentChapter = project?.chapters.find((c) => c.id === chapterId);
  const preferenceItems = toMemoryItems(project?.preference_notes);
  const learnedItems = toMemoryItems(project?.memory_notes);
  const canOfferWrite = shouldOfferWrite(Boolean(readiness?.ready), suggestedAction);

  return (
    <main className="page-enter mx-auto flex min-h-screen max-w-6xl">
      {project && <ChapterSidebar projectId={projectId} chapters={project.chapters} activeChapterId={chapterId} />}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-[#dfe5eb] bg-white/95 px-5 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#667085] transition hover:text-[#0f766e]">
                <ArrowLeftIcon /> 章节列表
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-[#1f2937]">{workMode === "assistant" ? "采访助理模式" : "AI 记者采访"}</h1>
                {currentChapter && <span className="rounded-full bg-[#f0fdfa] px-2.5 py-1 text-xs font-medium text-[#0f766e]">第 {currentChapter.order} 章</span>}
              </div>
              {currentChapter && <p className="mt-1 truncate text-sm text-[#667085]">{currentChapter.title}</p>}
            </div>
            <Link href={`/project/${projectId}/settings`} className="hidden shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#667085] transition hover:bg-[#f2f4f7] hover:text-[#1f2937] sm:inline-flex">
              <SettingsIcon /> 设置
            </Link>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="order-2 min-w-0 px-4 py-5 pb-56 sm:px-7 md:order-1 md:max-w-3xl md:justify-self-center md:w-full">
            {error && !(voiceMode === "voice" && voiceState.error) && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
            <div className="mb-5 inline-flex rounded-lg border border-[#dfe5eb] bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => { setWorkMode("ai"); setError(""); }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${workMode === "ai" ? "bg-[#0f766e] text-white" : "text-[#667085] hover:bg-[#f7f8fa] hover:text-[#1f2937]"}`}
              >
                AI 采访
              </button>
              <button
                type="button"
                onClick={() => { stopVoiceConversation(); setVoiceMode("text"); setWorkMode("assistant"); setError(""); if (!assistantAdvice) void refreshAssistantGuidance(); }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${workMode === "assistant" ? "bg-[#0f766e] text-white" : "text-[#667085] hover:bg-[#f7f8fa] hover:text-[#1f2937]"}`}
              >
                采访助理
              </button>
            </div>
            <div className="mb-5 rounded-xl border border-[#dfe5eb] bg-[#f7f8fa] px-4 py-3 text-xs leading-relaxed text-[#667085]">
              <span className="font-medium text-[#344054]">{workMode === "assistant" ? "现场记录：" : "慢慢说就好："}</span> {workMode === "assistant" ? "采访员可以边聊边记录，系统会帮你整理下一问和遗漏事实。" : "不必一次讲完整，想到什么片段就从哪里开始。"}
            </div>
            {workMode === "assistant" && (
              <AssistantGuidancePanel
                advice={assistantAdvice}
                loading={assistantLoading}
                onRefresh={refreshAssistantGuidance}
              />
            )}
            {messages.map((msg) => <ChatBubble key={msg.id} role={msg.role} content={msg.content} />)}
            {lastAnswerQuality && shouldShowDetailNudge(lastAnswerQuality.is_substantive, lastSubmittedAnswer) && (
              <div className="animate-fade-up my-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm text-[#b54708]">
                <p className="font-medium text-[#93370d]">可以继续聊这一点</p>
                <p className="mt-1 leading-relaxed">不用补齐所有细节，顺着刚才的回答再说一个画面，就已经很有帮助了。</p>
              </div>
            )}
            {sending && (
              <div className="mb-4 flex items-end gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f766e] text-xs font-bold text-white shadow-sm">AI</div>
                <div className="flex gap-1.5 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#5eead4]" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#d97706]" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#0f766e]" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            {canOfferWrite && (
              <div className="animate-fade-up my-5 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] p-5 text-center">
                <p className="text-sm font-medium text-[#047857]">采访素材已充足，可以开始写作了</p>
                <button onClick={handleWrite} disabled={writing} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0f9d73] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#087f5b] disabled:opacity-50">
                  {writing ? "跳转中..." : "AI 开始写作"} <ArrowRightIcon />
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </section>

          <aside className="order-1 border-b border-[#dfe5eb] bg-[#f7f8fa] px-4 py-4 md:order-2 md:border-b-0 md:border-l md:px-5 md:py-6">
            {project && (
              <div className="space-y-4 md:sticky md:top-20">
                <section className="rounded-xl border border-[#dfe5eb] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[#1f2937]">采访偏好</p>
                      <p className="mt-1 text-[11px] text-[#98a2b3]">让聊天更像你喜欢的方式</p>
                    </div>
                    <button type="button" onClick={() => setEditingPreferences((value) => !value)} className="text-xs font-medium text-[#0f766e] hover:underline">
                      {editingPreferences ? "收起" : "编辑"}
                    </button>
                  </div>
                  {preferenceItems.length > 0 || learnedItems.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {preferenceItems.slice(0, 4).map((item) => <span key={`p-${item}`} className="rounded-full bg-[#f7f8fa] px-2.5 py-1 text-xs text-[#667085]">{item}</span>)}
                      {learnedItems.slice(0, 4).map((item) => <span key={`m-${item}`} className="rounded-full bg-[#f0fdfa] px-2.5 py-1 text-xs text-[#115e59]">{item}</span>)}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs leading-relaxed text-[#667085]">还没有特别偏好，可以告诉我想要的追问方式、写作语气或隐私边界。</p>
                  )}
                  {editingPreferences && (
                    <div className="mt-3 space-y-2">
                      <textarea value={preferenceDraft} onChange={(e) => setPreferenceDraft(e.target.value)} rows={4} placeholder="例如：不要写真实姓名；多问家庭细节；语气朴素" className="input min-h-24 w-full resize-y text-sm leading-relaxed" />
                      <div className="flex gap-2">
                        <button type="button" onClick={handleSavePreferences} disabled={savingPreferences} className="btn-primary px-3 py-2 text-xs">{savingPreferences ? "保存中" : "保存偏好"}</button>
                        <button type="button" onClick={() => { setPreferenceDraft(project.preference_notes || ""); setEditingPreferences(false); }} disabled={savingPreferences} className="btn-outline px-3 py-2 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </section>

                {readiness && (
                  <details className="rounded-xl border border-[#dfe5eb] bg-white p-4" open={canOfferWrite}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[#1f2937]">
                      <span>写作准备</span>
                      <span className="font-medium text-[#667085]">{canOfferWrite ? "可以开始" : readiness.ready ? "继续聊也可以" : "继续聊聊"}</span>
                    </summary>
                    <p className="mt-3 text-xs leading-relaxed text-[#667085]">{readinessMessage(readiness, canOfferWrite)}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eaecf0]">
                      <div className={`h-full rounded-full transition-all ${readiness.ready ? "bg-[#0f9d73]" : "bg-[#0f766e]"}`} style={{ width: `${readinessProgress(readiness)}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] text-[#98a2b3]">已记录 {readiness.user_answers} 轮回答 · {readiness.user_chars} 字</p>
                    {canOfferWrite && <button onClick={handleWrite} disabled={writing} className="mt-4 w-full rounded-lg bg-[#0f9d73] px-3 py-2.5 text-xs font-medium text-white transition hover:bg-[#087f5b] disabled:opacity-50">{writing ? "跳转中" : "去写作"}</button>}
                  </details>
                )}

                {coverage && (
                  <details className="rounded-xl border border-[#dbe4ea] bg-[#f0f9f7] p-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-[#115e59]">
                      <span>本章进度</span>
                      <span className="font-medium text-[#0f766e]">{coverage.percent}%</span>
                    </summary>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${coverage.percent}%` }} />
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-[#115e59]">{coverage.message}</p>
                    <p className="mt-3 text-xs leading-relaxed text-[#667085]">{coverage.next_suggestion}</p>
                  </details>
                )}
              </div>
            )}
          </aside>
        </div>

        <form onSubmit={workMode === "assistant" ? handleRecordAssistantTurn : handleSend} className="fixed bottom-16 inset-x-0 z-20 border-t border-[#dfe5eb] bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl md:bottom-0 md:left-72 md:px-7">
          <div className="mx-auto max-w-3xl">
            {workMode === "assistant" ? (
              <>
                <div role="tablist" aria-label="记录类型" className="mb-3 inline-flex rounded-lg border border-[#dfe5eb] bg-[#f7f8fa] p-1">
                  {assistantRoleOptions.map((option) => (
                    <button
                      key={option.role}
                      type="button"
                      role="tab"
                      aria-selected={assistantRole === option.role}
                      onClick={() => setAssistantRole(option.role)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${assistantRole === option.role ? "bg-white text-[#1f2937] shadow-sm" : "text-[#667085] hover:text-[#1f2937]"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={assistantInput}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                    placeholder={assistantPlaceholder(assistantRole)}
                    rows={2}
                    disabled={assistantLoading}
                    aria-label="采访记录"
                    className="input max-h-40 min-h-14 flex-1 resize-y text-base leading-relaxed"
                  />
                  <button type="submit" aria-label="记录并生成提示" disabled={assistantLoading || !assistantInput.trim()} title="记录并生成提示" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0f766e] text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-40 active:scale-95">
                    <SendIcon />
                  </button>
                </div>
              </>
            ) : (
              <>
            <div role="tablist" aria-label="回答方式" className="mb-3 inline-flex rounded-lg border border-[#dfe5eb] bg-[#f7f8fa] p-1">
              <button
                type="button"
                role="tab"
                aria-selected={voiceMode === "text"}
                onClick={() => { if (voiceMode === "voice") stopVoiceConversation(); setError(""); setVoiceMode("text"); }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${voiceMode === "text" ? "bg-white text-[#1f2937] shadow-sm" : "text-[#667085] hover:text-[#1f2937]"}`}
              >
                <KeyboardIcon /> 文字
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={voiceMode === "voice"}
                onClick={() => { setError(""); setVoiceMode("voice"); }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${voiceMode === "voice" ? "bg-white text-[#1f2937] shadow-sm" : "text-[#667085] hover:text-[#1f2937]"}`}
              >
                <MicIcon /> 语音
              </button>
            </div>

            {voiceMode === "voice" ? (
              <div className="rounded-2xl border border-[#b8dcd7] bg-[#f0fdfa] px-4 py-3 shadow-[0_4px_18px_-12px_rgba(15,118,110,0.55)]">
                <div className="flex flex-wrap items-center gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${voiceState.active ? "bg-[#0f766e] text-white ai-glow" : "bg-white text-[#0f766e]"}`}>
                    {voiceState.phase === "speaking" ? <SoundIcon /> : <MicIcon />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#115e59]">{voiceStatusTitle(voiceState.phase)}</p>
                    <p className="mt-0.5 truncate text-xs text-[#667085]">{voiceStatusHint(voiceState.phase, voiceSupport.supported)}</p>
                  </div>
                  {voiceState.active && voiceState.phase === "speaking" && (
                    <button type="button" onClick={interruptSpeech} className="btn-outline inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                      <MicIcon /> 打断并说话
                    </button>
                  )}
                  {voiceState.active && voiceState.phase === "listening" && (
                    <button type="button" onClick={finishVoiceRecording} className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                      <CheckIcon /> 说完了
                    </button>
                  )}
                  {voiceState.active && voiceState.phase === "listening" && (
                    <button type="button" onClick={pauseVoiceConversation} className="btn-outline hidden shrink-0 items-center gap-1.5 px-3 py-2 text-xs sm:inline-flex">
                      <PauseIcon /> 暂停
                    </button>
                  )}
                  {voiceState.active && voiceState.phase === "reviewing" && (
                    <button type="button" onClick={submitReviewedVoiceAnswer} disabled={!input.trim() || sendingRef.current} className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50">
                      <SendIcon /> 发送
                    </button>
                  )}
                  {voiceState.active && voiceState.phase === "reviewing" && (
                    <button type="button" onClick={retryVoiceRecording} className="btn-outline inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                      <MicIcon /> 重录
                    </button>
                  )}
                  {!voiceState.active && voiceState.phase !== "submitting" && (
                    <button type="button" onClick={voiceState.phase === "paused" ? resumeVoiceConversation : startVoiceConversation} disabled={!voiceSupport.supported} className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs">
                      <MicIcon /> {voiceState.phase === "paused" ? "继续" : voiceState.phase === "error" ? "重新开始" : "开始语音对话"}
                    </button>
                  )}
                  {voiceState.active && (
                    <button type="button" onClick={stopVoiceConversation} aria-label="停止语音对话" title="停止语音对话" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#667085] transition hover:bg-white hover:text-[#b42318]">
                      <StopIcon />
                    </button>
                  )}
                </div>
                {voiceState.phase === "reviewing" ? (
                  <div className="mt-3 rounded-xl bg-white/80 px-3 py-2">
                    <label className="mb-1 block text-xs font-medium text-[#0f766e]" htmlFor="voice-transcript-review">识别文字</label>
                    <textarea
                      id="voice-transcript-review"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      rows={3}
                      className="input max-h-32 min-h-20 w-full resize-y bg-white text-sm leading-relaxed"
                    />
                  </div>
                ) : voiceState.transcript && (
                  <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm leading-relaxed text-[#344054]">
                    <span className="mr-1 text-xs font-medium text-[#0f766e]">正在听：</span>{voiceState.transcript}
                  </div>
                )}
                {!voiceSupport.supported && (
                  <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs leading-relaxed text-[#667085]">
                    当前浏览器没有同时提供麦克风录音和语音朗读，您仍然可以使用文字采访。
                  </p>
                )}
                {voiceSupport.supported && voiceState.phase === "idle" && (
                  <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs leading-relaxed text-[#667085]">
                    首次使用时，请允许浏览器访问麦克风。AI 会先读出问题，之后开始录音。
                  </p>
                )}
                {voiceState.error && (
                  <p className="mt-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs leading-relaxed text-[#b42318]">{voiceState.error}</p>
                )}
              </div>
            ) : (
              <>
                {(draftRestored || input.trim().length > 0) && <p className="mb-2 text-xs text-[#98a2b3]">{draftRestored ? "已恢复上次未发送的草稿" : "草稿已自动保存"}</p>}
                <div className="flex items-end gap-2">
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="想到什么，就从这里说起..." rows={2} disabled={sending} aria-label="文字回答" className="input max-h-40 min-h-14 flex-1 resize-y text-base leading-relaxed" />
                  <button type="submit" aria-label="发送回答" disabled={sending || !input.trim()} title="发送回答" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0f766e] text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-40 active:scale-95">
                    <SendIcon />
                  </button>
                </div>
              </>
            )}
              </>
            )}
          </div>
        </form>
        <BottomNav projectId={projectId} activeChapterId={chapterId} />
      </div>
    </main>
  );
}

const assistantRoleOptions: Array<{ role: InterviewAssistantRole; label: string }> = [
  { role: "user", label: "受访者" },
  { role: "interviewer", label: "采访员" },
  { role: "note", label: "备注" },
];

function AssistantGuidancePanel({
  advice,
  loading,
  onRefresh,
}: {
  advice: InterviewAssistantResponse | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="animate-fade-up mb-5 rounded-xl border border-[#b8dcd7] bg-[#f0fdfa] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#115e59]">采访员提示</p>
          <p className="mt-1 text-xs leading-relaxed text-[#667085]">
            {advice?.live_summary || "记录一段受访者回答后，我会给你下一问、追问重点和需要补齐的事实。"}
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="btn-outline shrink-0 px-3 py-2 text-xs">
          {loading ? "生成中" : "刷新"}
        </button>
      </div>
      {advice && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <GuidanceList title="下一问" items={advice.next_questions} tone="strong" />
          <GuidanceList title="追问重点" items={advice.followup_focus} />
          <GuidanceList title="待补事实" items={advice.missing_facts} />
        </div>
      )}
      {advice?.caution && (
        <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs leading-relaxed text-[#667085]">{advice.caution}</p>
      )}
    </section>
  );
}

function GuidanceList({ title, items, tone = "normal" }: { title: string; items: string[]; tone?: "normal" | "strong" }) {
  return (
    <div className="rounded-lg bg-white/85 p-3">
      <p className={`text-xs font-semibold ${tone === "strong" ? "text-[#0f766e]" : "text-[#344054]"}`}>{title}</p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#667085]">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}

function assistantPlaceholder(role: InterviewAssistantRole): string {
  if (role === "interviewer") return "记录采访员刚问了什么...";
  if (role === "note") return "记录现场观察、情绪、待核实事项...";
  return "记录受访者刚才说的话...";
}

function toMemoryItems(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\n|；|;/)
    .map((item) => item.replace(/^- /, "").trim())
    .filter(Boolean)
    .map((item) => item.length > 32 ? `${item.slice(0, 32)}...` : item);
}

function readinessProgress(readiness: WriteReadiness): number {
  const answerRatio = readiness.min_user_answers > 0 ? readiness.user_answers / readiness.min_user_answers : 1;
  const charRatio = readiness.min_user_chars > 0 ? readiness.user_chars / readiness.min_user_chars : 1;
  return Math.max(0, Math.min(100, Math.min(answerRatio, charRatio) * 100));
}

function readinessMessage(readiness: WriteReadiness, canOfferWrite: boolean): string {
  return readiness.ready && canOfferWrite
    ? "这一章的故事已经比较清楚，可以先把它整理成正文。"
    : readiness.ready
      ? "素材已经比较充分，顺着当前问题继续聊也可以。"
    : "不急，我们再聊一两轮，把记忆里的画面慢慢补完整。";
}

function latestAgentMessage(messages: InterviewMessage[]): string {
  return [...messages].reverse().find((message) => message.role === "agent")?.content || "";
}

function voiceStatusTitle(phase: typeof initialVoiceState.phase): string {
  const labels = {
    idle: "像聊天一样说",
    speaking: "AI 正在说",
    listening: "请您说话",
    reviewing: "请确认文字",
    submitting: "正在记下这段回忆",
    paused: "语音对话已暂停",
    error: "语音暂时不可用",
  };
  return labels[phase];
}

function voiceStatusHint(phase: typeof initialVoiceState.phase, supported: boolean): string {
  if (!supported) return "可以继续使用文字回答";
  const hints = {
    idle: "AI 会先读出刚才的问题",
    speaking: "想现在回答，可以直接打断",
    listening: "说完后点一下“说完了”",
    reviewing: "确认后再发送给 AI",
    submitting: "稍等片刻",
    paused: "准备好后再继续",
    error: "检查权限后可以重新开始",
  };
  return hints[phase];
}

function ArrowLeftIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}

function ArrowRightIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
}

function SendIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
}

function KeyboardIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M8 13h.01M12 13h.01M16 13h.01M8 16h8" /></svg>;
}

function MicIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg>;
}

function SoundIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
}

function PauseIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>;
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}

function StopIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}

function SettingsIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5v.1a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3 1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8 1.7 1.7 0 001.5 1h.1a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>;
}
