from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ProjectStatusSchema(StrEnum):
    PLANNING = "planning"
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


class PlanRequest(BaseModel):
    author_background: str = Field(
        default="",
        description="作者背景信息，如年龄段、职业、想写自传的原因",
    )


class InterviewAnswerRequest(BaseModel):
    content: str = Field(min_length=1)


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


class OutlinePlanResult(BaseModel):
    chapters: list[OutlineChapterPlan]
