from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Chapter,
    ChapterStatus,
    CommunityComment,
    CommunityPost,
    DirectMessage,
    Project,
    User,
    UserFollow,
)


def _community_user(user: User) -> dict:
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}


def _excerpt_from_project(project: Project) -> str:
    chapters = sorted(project.chapters, key=lambda chapter: chapter.order)
    for chapter in chapters:
        content = (chapter.summary or chapter.content_md or "").strip()
        if content:
            return " ".join(content.split())[:180]
    return "这本自传还没有摘要，欢迎进入阅读。"


async def _chapter_count(db: AsyncSession, project_id: str) -> int:
    result = await db.execute(
        select(func.count(Chapter.id)).where(
            Chapter.project_id == project_id,
            Chapter.status == ChapterStatus.DONE,
            Chapter.content_md.isnot(None),
        )
    )
    return int(result.scalar_one() or 0)


async def _comment_count(db: AsyncSession, post_id: str) -> int:
    result = await db.execute(
        select(func.count(CommunityComment.id)).where(CommunityComment.post_id == post_id)
    )
    return int(result.scalar_one() or 0)


async def _follower_count(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(func.count(UserFollow.id)).where(UserFollow.following_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def _following_count(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(func.count(UserFollow.id)).where(UserFollow.follower_id == user_id)
    )
    return int(result.scalar_one() or 0)


async def is_following(db: AsyncSession, follower_id: str, following_id: str) -> bool:
    if follower_id == following_id:
        return False
    result = await db.execute(
        select(UserFollow.id).where(
            UserFollow.follower_id == follower_id,
            UserFollow.following_id == following_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def post_to_response(
    db: AsyncSession,
    post: CommunityPost,
    current_user_id: str,
) -> dict:
    return {
        "id": post.id,
        "project_id": post.project_id,
        "title": post.title,
        "excerpt": post.excerpt,
        "author": _community_user(post.user),
        "share_token": post.project.share_token or "",
        "published_at": post.project.published_at,
        "chapter_count": await _chapter_count(db, post.project_id),
        "comment_count": await _comment_count(db, post.id),
        "follower_count": await _follower_count(db, post.user_id),
        "is_following_author": await is_following(db, current_user_id, post.user_id),
        "created_at": post.created_at,
        "updated_at": post.updated_at,
    }


async def list_posts(db: AsyncSession, current_user_id: str) -> list[dict]:
    result = await db.execute(
        select(CommunityPost)
        .join(Project, Project.id == CommunityPost.project_id)
        .where(Project.is_published.is_(True))
        .options(selectinload(CommunityPost.user), selectinload(CommunityPost.project))
        .order_by(CommunityPost.updated_at.desc(), CommunityPost.created_at.desc())
    )
    posts = list(result.scalars().all())
    return [await post_to_response(db, post, current_user_id) for post in posts]


async def get_post(db: AsyncSession, post_id: str, current_user_id: str) -> dict | None:
    result = await db.execute(
        select(CommunityPost)
        .join(Project, Project.id == CommunityPost.project_id)
        .where(CommunityPost.id == post_id, Project.is_published.is_(True))
        .options(
            selectinload(CommunityPost.user),
            selectinload(CommunityPost.project),
            selectinload(CommunityPost.comments).selectinload(CommunityComment.user),
        )
    )
    post = result.scalar_one_or_none()
    if not post:
        return None
    payload = await post_to_response(db, post, current_user_id)
    payload["comments"] = [
        {
            "id": comment.id,
            "post_id": comment.post_id,
            "author": _community_user(comment.user),
            "content": comment.content,
            "created_at": comment.created_at,
        }
        for comment in post.comments
    ]
    return payload


async def publish_project_to_community(
    db: AsyncSession,
    project: Project,
    current_user_id: str,
) -> tuple[dict, bool]:
    if project.user_id != current_user_id:
        raise ValueError("只能发布自己的自传")
    if not project.is_published or not project.share_token:
        raise ValueError("请先发布自传，再发布到社区")

    existing = await db.execute(
        select(CommunityPost)
        .where(CommunityPost.project_id == project.id)
        .options(selectinload(CommunityPost.user), selectinload(CommunityPost.project))
    )
    post = existing.scalar_one_or_none()
    created = post is None
    if post is None:
        post = CommunityPost(
            project_id=project.id,
            user_id=current_user_id,
            title=project.title,
            excerpt=_excerpt_from_project(project),
        )
        db.add(post)
    else:
        post.title = project.title
        post.excerpt = _excerpt_from_project(project)
        post.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(post, attribute_names=["user", "project"])
    return await post_to_response(db, post, current_user_id), created


async def add_comment(
    db: AsyncSession,
    post_id: str,
    user: User,
    content: str,
) -> dict | None:
    post_result = await db.execute(
        select(CommunityPost.id)
        .join(Project, Project.id == CommunityPost.project_id)
        .where(CommunityPost.id == post_id, Project.is_published.is_(True))
    )
    if not post_result.scalar_one_or_none():
        return None
    comment = CommunityComment(post_id=post_id, user_id=user.id, content=content.strip())
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "author": _community_user(user),
        "content": comment.content,
        "created_at": comment.created_at,
    }


async def follow_user(db: AsyncSession, follower_id: str, following_id: str) -> None:
    if follower_id == following_id:
        raise ValueError("不能关注自己")
    target = await db.get(User, following_id)
    if not target:
        raise LookupError("用户不存在")
    exists = await is_following(db, follower_id, following_id)
    if not exists:
        db.add(UserFollow(follower_id=follower_id, following_id=following_id))
        await db.commit()


async def unfollow_user(db: AsyncSession, follower_id: str, following_id: str) -> None:
    result = await db.execute(
        select(UserFollow).where(
            UserFollow.follower_id == follower_id,
            UserFollow.following_id == following_id,
        )
    )
    follow = result.scalar_one_or_none()
    if follow:
        await db.delete(follow)
        await db.commit()


async def user_follow_status(db: AsyncSession, user_id: str, current_user_id: str) -> dict | None:
    user = await db.get(User, user_id)
    if not user:
        return None
    return {
        "user": _community_user(user),
        "follower_count": await _follower_count(db, user_id),
        "following_count": await _following_count(db, user_id),
        "is_following": await is_following(db, current_user_id, user_id),
    }


async def send_message(db: AsyncSession, sender: User, recipient_id: str, content: str) -> dict:
    if sender.id == recipient_id:
        raise ValueError("不能给自己发私信")
    recipient = await db.get(User, recipient_id)
    if not recipient:
        raise LookupError("用户不存在")
    message = DirectMessage(sender_id=sender.id, recipient_id=recipient_id, content=content.strip())
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return _message_response(message, sender, recipient)


async def list_thread(db: AsyncSession, current_user: User, other_user_id: str) -> list[dict]:
    other = await db.get(User, other_user_id)
    if not other:
        raise LookupError("用户不存在")
    result = await db.execute(
        select(DirectMessage)
        .where(
            or_(
                (DirectMessage.sender_id == current_user.id)
                & (DirectMessage.recipient_id == other_user_id),
                (DirectMessage.sender_id == other_user_id)
                & (DirectMessage.recipient_id == current_user.id),
            )
        )
        .options(selectinload(DirectMessage.sender), selectinload(DirectMessage.recipient))
        .order_by(DirectMessage.created_at)
    )
    messages = list(result.scalars().all())
    now = datetime.now(UTC)
    changed = False
    for message in messages:
        if message.recipient_id == current_user.id and message.read_at is None:
            message.read_at = now
            changed = True
    if changed:
        await db.commit()
    return [_message_response(message, message.sender, message.recipient) for message in messages]


async def list_conversations(db: AsyncSession, current_user: User) -> list[dict]:
    result = await db.execute(
        select(DirectMessage)
        .where(
            or_(
                DirectMessage.sender_id == current_user.id,
                DirectMessage.recipient_id == current_user.id,
            )
        )
        .options(selectinload(DirectMessage.sender), selectinload(DirectMessage.recipient))
        .order_by(DirectMessage.created_at.desc())
    )
    summaries: dict[str, dict] = {}
    for message in result.scalars().all():
        other = message.recipient if message.sender_id == current_user.id else message.sender
        if other.id not in summaries:
            summaries[other.id] = {
                "user": _community_user(other),
                "last_message": _message_response(message, message.sender, message.recipient),
                "unread_count": 0,
            }
        if message.recipient_id == current_user.id and message.read_at is None:
            summaries[other.id]["unread_count"] += 1
    return list(summaries.values())


def _message_response(message: DirectMessage, sender: User, recipient: User) -> dict:
    return {
        "id": message.id,
        "sender": _community_user(sender),
        "recipient": _community_user(recipient),
        "content": message.content,
        "read_at": message.read_at,
        "created_at": message.created_at,
    }
