from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ProjectStatusSchema(StrEnum):
    PLANNING = "planning"
    GENERATING = "generating"
    INTERVIEWING = "interviewing"
    WRITING = "writing"
    REVIEWING = "reviewing"
    COMPLETED = "completed"


class ChapterStatusSchema(StrEnum):
    PENDING = "pending"
    INTERVIEWING = "interviewing"
    DRAFTING = "drafting"
    DONE = "done"


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class AuthUserResponse(BaseModel):
    id: str
    name: str
    auth_provider: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class AuthProvidersResponse(BaseModel):
    wechat_enabled: bool
    password_enabled: bool
    auth_required: bool = True
    dev_auth_bypass: bool = False
    wechat_redirect_uri: str | None = None
    wechat_issues: list[str] = Field(default_factory=list)


class LoginResponse(BaseModel):
    user: AuthUserResponse
    message: str


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    style_notes: str | None = None
    preference_notes: str | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    style_notes: str | None = None
    preference_notes: str | None = None
    memory_notes: str | None = None


class ChapterBrief(BaseModel):
    id: str
    order: int
    title: str
    status: ChapterStatusSchema
    summary: str | None = None

    model_config = {"from_attributes": True}


class ChapterDetail(ChapterBrief):
    content_md: str | None = None
    interview_topics: str | None = None
    created_at: datetime
    updated_at: datetime


class ProjectBrief(BaseModel):
    id: str
    title: str
    status: ProjectStatusSchema
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectDetail(ProjectBrief):
    style_notes: str | None = None
    preference_notes: str | None = None
    memory_notes: str | None = None
    is_published: bool = False
    share_token: str | None = None
    published_at: datetime | None = None
    chapters: list[ChapterBrief] = []


class PublishedChapter(BaseModel):
    order: int
    title: str
    content_md: str


class PublishedProject(BaseModel):
    title: str
    published_at: datetime | None
    chapters: list[PublishedChapter]


class PublishResponse(BaseModel):
    is_published: bool
    share_token: str
    published_at: datetime | None
    published_chapter_count: int


class PublishReadinessChapter(BaseModel):
    chapter_id: str
    order: int
    title: str
    status: str
    quality_score: int
    quality_status: str
    message: str
    risks: list[str]
    suggestions: list[str]


class PublishReadinessResponse(BaseModel):
    ready: bool
    publishable_chapter_count: int
    risky_chapter_count: int
    message: str
    chapters: list[PublishReadinessChapter]


class CommunityUser(BaseModel):
    id: str
    name: str
    avatar_url: str | None = None


class CommunityCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class CommunityCommentResponse(BaseModel):
    id: str
    post_id: str
    author: CommunityUser
    content: str
    created_at: datetime


class CommunityPostResponse(BaseModel):
    id: str
    project_id: str
    title: str
    excerpt: str | None = None
    author: CommunityUser
    share_token: str
    published_at: datetime | None = None
    chapter_count: int
    comment_count: int
    follower_count: int
    is_following_author: bool = False
    created_at: datetime
    updated_at: datetime


class CommunityPostDetail(CommunityPostResponse):
    comments: list[CommunityCommentResponse] = Field(default_factory=list)


class CommunityPublishResponse(BaseModel):
    post: CommunityPostResponse
    message: str


class FollowStatusResponse(BaseModel):
    user: CommunityUser
    follower_count: int
    following_count: int
    is_following: bool = False


class DirectMessageCreate(BaseModel):
    recipient_id: str = Field(min_length=1, max_length=36)
    content: str = Field(min_length=1, max_length=4000)


class DirectMessageResponse(BaseModel):
    id: str
    sender: CommunityUser
    recipient: CommunityUser
    content: str
    read_at: datetime | None = None
    created_at: datetime


class ConversationSummary(BaseModel):
    user: CommunityUser
    last_message: DirectMessageResponse
    unread_count: int


class PlanRequest(BaseModel):
    author_background: str = Field(
        default="",
        description="作者背景信息，如年龄段、职业、想写自传的原因",
    )


class OutlineInterviewMessage(BaseModel):
    role: str
    content: str


class OutlineInterviewState(BaseModel):
    messages: list[OutlineInterviewMessage]
    ready: bool
    answer_count: int
    min_answers: int
    can_generate: bool


class OutlineInterviewAnswerRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class NextChapterRequest(BaseModel):
    direction: str = Field(min_length=1, max_length=2000)


class InterviewAnswerRequest(BaseModel):
    content: str = Field(min_length=1)


class InterviewAssistantRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    role: str = Field(default="user", pattern="^(user|interviewer|note)$")


class InterviewAssistantCallAudioRequest(BaseModel):
    audio_base64: str = Field(min_length=1, max_length=10_000_000)
    mime_type: str = Field(min_length=1, max_length=100)


class InterviewAssistantResponse(BaseModel):
    next_questions: list[str]
    followup_focus: list[str]
    missing_facts: list[str]
    live_summary: str
    caution: str
    suggested_action: str
    reason: str
    session_id: str
    chapter_coverage: dict
    transcript_stats: dict
    transcript: str | None = None
    detected_role: str | None = None
    role_confidence: float | None = None
    role_reason: str | None = None


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AsrRequest(BaseModel):
    audio_base64: str = Field(min_length=1, max_length=10_000_000)
    mime_type: str = Field(min_length=1, max_length=100)


class AsrResponse(BaseModel):
    text: str


class EditRequest(BaseModel):
    instruction: str = Field(min_length=1)


class EditApplyRequest(BaseModel):
    revision_id: str


class ChapterManualUpdate(BaseModel):
    content_md: str = Field(min_length=0)


class WriteReadinessResponse(BaseModel):
    ready: bool
    user_answers: int
    user_chars: int
    min_user_answers: int
    min_user_chars: int
    message: str


class ChapterCoverageResponse(BaseModel):
    score: int
    max_score: int
    percent: int
    covered_dimensions: list[str]
    missing_dimensions: list[str]
    message: str
    next_suggestion: str


class ChapterQualityResponse(BaseModel):
    score: int
    max_score: int
    status: str
    checks: list[dict[str, str | bool]]
    risks: list[str]
    suggestions: list[str]
    message: str


class PatchOperation(BaseModel):
    paragraph_id: str
    operation: str
    new_text: str | None = None


class EditPreviewResponse(BaseModel):
    revision_id: str
    instruction: str
    content_before: str
    content_after: str
    diff_text: str
    patches: list[PatchOperation]


class InterviewMessageSchema(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RevisionSchema(BaseModel):
    id: str
    instruction: str
    diff_json: str
    content_before: str | None
    content_after: str | None
    applied: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class OutlineChapterPlan(BaseModel):
    order: int
    title: str
    interview_topics: list[str]
