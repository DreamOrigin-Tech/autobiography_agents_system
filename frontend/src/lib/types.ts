export type ProjectStatus =
  | "planning"
  | "generating"
  | "interviewing"
  | "writing"
  | "reviewing"
  | "completed";

export type ChapterStatus = "pending" | "interviewing" | "drafting" | "done";

export interface ChapterBrief {
  id: string;
  order: number;
  title: string;
  status: ChapterStatus;
  summary?: string | null;
}

export interface ChapterDetail extends ChapterBrief {
  content_md?: string | null;
  interview_topics?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBrief {
  id: string;
  title: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectBrief {
  style_notes?: string | null;
  preference_notes?: string | null;
  memory_notes?: string | null;
  is_published?: boolean;
  share_token?: string | null;
  published_at?: string | null;
  chapters: ChapterBrief[];
}

export interface OutlineInterviewMessage {
  role: "agent" | "user";
  content: string;
}

export interface OutlineInterviewState {
  messages: OutlineInterviewMessage[];
  ready: boolean;
  answer_count: number;
  min_answers: number;
  can_generate: boolean;
}

export interface AuthUser {
  id: string;
  name: string;
  auth_provider: "local" | "wechat" | string;
  avatar_url?: string | null;
}

export interface AuthProviders {
  wechat_enabled: boolean;
  password_enabled: boolean;
  auth_required?: boolean;
  dev_auth_bypass?: boolean;
  wechat_redirect_uri?: string | null;
  wechat_issues?: string[];
}

export interface PublishedChapter {
  order: number;
  title: string;
  content_md: string;
}

export interface PublishedProject {
  title: string;
  published_at?: string | null;
  chapters: PublishedChapter[];
}

export interface PublishResponse {
  is_published: boolean;
  share_token: string;
  published_at?: string | null;
  published_chapter_count: number;
}

export interface PublishReadiness {
  ready: boolean;
  publishable_chapter_count: number;
  risky_chapter_count: number;
  message: string;
  chapters: Array<{
    chapter_id: string;
    order: number;
    title: string;
    status: string;
    quality_score: number;
    quality_status: "good" | "needs_review" | "risky";
    message: string;
    risks: string[];
    suggestions: string[];
  }>;
}

export interface CommunityUser {
  id: string;
  name: string;
  avatar_url?: string | null;
}

export interface CommunityComment {
  id: string;
  post_id: string;
  author: CommunityUser;
  content: string;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  project_id: string;
  title: string;
  excerpt?: string | null;
  author: CommunityUser;
  share_token: string;
  published_at?: string | null;
  chapter_count: number;
  comment_count: number;
  follower_count: number;
  is_following_author: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommunityPostDetail extends CommunityPost {
  comments: CommunityComment[];
}

export interface CommunityPublishResponse {
  post: CommunityPost;
  message: string;
}

export interface FollowStatus {
  user: CommunityUser;
  follower_count: number;
  following_count: number;
  is_following: boolean;
}

export interface DirectMessage {
  id: string;
  sender: CommunityUser;
  recipient: CommunityUser;
  content: string;
  read_at?: string | null;
  created_at: string;
}

export interface ConversationSummary {
  user: CommunityUser;
  last_message: DirectMessage;
  unread_count: number;
}

export interface InterviewMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface InterviewResult {
  question: string;
  intent?: string;
  suggested_action?: "continue" | "write_chapter";
  reason?: string;
  session_id?: string;
  memory_updated?: boolean;
  memory_notes?: string | null;
  answer_quality?: AnswerQuality;
}

export type InterviewAssistantRole = "user" | "interviewer" | "note";

export interface InterviewAssistantResponse {
  next_questions: string[];
  followup_focus: string[];
  missing_facts: string[];
  live_summary: string;
  caution: string;
  suggested_action: "continue" | "write_chapter";
  reason: string;
  session_id: string;
  chapter_coverage: ChapterCoverage;
  transcript_stats: {
    interviewee_turns: number;
    interviewer_turns: number;
    note_turns: number;
    interviewee_chars: number;
  };
  transcript?: string | null;
  detected_role?: InterviewAssistantRole | null;
  role_confidence?: number | null;
  role_reason?: string | null;
}

export interface AnswerQuality {
  is_substantive: boolean;
  score: number;
  char_count: number;
  missing_dimensions: string[];
  reason: string;
}

export interface WriteReadiness {
  ready: boolean;
  user_answers: number;
  user_chars: number;
  min_user_answers: number;
  min_user_chars: number;
  message: string;
}

export interface ChapterCoverage {
  score: number;
  max_score: number;
  percent: number;
  covered_dimensions: string[];
  missing_dimensions: string[];
  message: string;
  next_suggestion: string;
}

export interface ChapterQuality {
  score: number;
  max_score: number;
  status: "good" | "needs_review" | "risky";
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  risks: string[];
  suggestions: string[];
  message: string;
}

export interface EditPreview {
  revision_id: string;
  instruction: string;
  content_before: string;
  content_after: string;
  diff_text: string;
  patches: Array<{
    paragraph_id: string;
    operation: string;
    new_text?: string | null;
  }>;
}

export interface Revision {
  id: string;
  instruction: string;
  diff_json: string;
  content_before?: string | null;
  content_after?: string | null;
  applied: boolean;
  created_at: string;
}
