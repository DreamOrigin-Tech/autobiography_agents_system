from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def init_db() -> None:
    from app.models import (  # noqa: F401
        agent_run,
        auth_session,
        chapter,
        interview,
        oauth_state,
        project,
        revision,
        user,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_schema)


def _migrate_schema(connection) -> None:
    if connection.dialect.name != "sqlite":
        return

    # ── users table ──
    user_cols = {
        row[1]
        for row in connection.exec_driver_sql("PRAGMA table_info(users)").fetchall()
    }
    _add_column_if_missing(
        connection, "users", "auth_provider", "VARCHAR(32) NOT NULL DEFAULT 'local'", user_cols
    )
    _add_column_if_missing(connection, "users", "provider_subject", "VARCHAR(255)", user_cols)
    _add_column_if_missing(connection, "users", "wechat_openid", "VARCHAR(128)", user_cols)
    _add_column_if_missing(connection, "users", "wechat_unionid", "VARCHAR(128)", user_cols)
    _add_column_if_missing(connection, "users", "avatar_url", "VARCHAR(1024)", user_cols)
    _add_column_if_missing(connection, "users", "last_login_at", "DATETIME", user_cols)
    connection.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_wechat_openid ON users (wechat_openid)"
    )
    connection.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_wechat_unionid ON users (wechat_unionid)"
    )

    # ── projects table ──
    proj_cols = {
        row[1]
        for row in connection.exec_driver_sql("PRAGMA table_info(projects)").fetchall()
    }
    _add_column_if_missing(connection, "projects", "is_published", "BOOLEAN NOT NULL DEFAULT 0", proj_cols)
    _add_column_if_missing(connection, "projects", "share_token", "VARCHAR(64)", proj_cols)
    _add_column_if_missing(connection, "projects", "published_at", "DATETIME", proj_cols)
    _add_column_if_missing(connection, "projects", "timeline_json", "TEXT", proj_cols)
    _add_column_if_missing(connection, "projects", "preference_notes", "TEXT", proj_cols)
    _add_column_if_missing(connection, "projects", "memory_notes", "TEXT", proj_cols)

    # ── chapters table ──
    ch_cols = {
        row[1]
        for row in connection.exec_driver_sql("PRAGMA table_info(chapters)").fetchall()
    }
    _add_column_if_missing(connection, "chapters", "reflection_notes", "TEXT", ch_cols)
    _add_column_if_missing(connection, "chapters", "topic_coverage", "TEXT", ch_cols)


def _add_column_if_missing(connection, table: str, column: str, col_type: str, existing: set) -> None:
    if column not in existing:
        connection.exec_driver_sql(
            f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
        )
