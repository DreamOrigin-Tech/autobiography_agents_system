"""Add multi-user authentication

Revision ID: 002
Revises: 001
Create Date: 2026-07-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "auth_provider",
                sa.String(32),
                nullable=False,
                server_default="local",
            )
        )
        batch_op.add_column(sa.Column("provider_subject", sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("wechat_openid", sa.String(128), nullable=True))
        batch_op.add_column(sa.Column("wechat_unionid", sa.String(128), nullable=True))
        batch_op.add_column(sa.Column("avatar_url", sa.String(1024), nullable=True))
        batch_op.add_column(sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(
            "ix_users_wechat_openid",
            ["wechat_openid"],
            unique=True,
        )
        batch_op.create_index(
            "ix_users_wechat_unionid",
            ["wechat_unionid"],
            unique=True,
        )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index(
        "ix_auth_sessions_token_hash",
        "auth_sessions",
        ["token_hash"],
        unique=True,
    )

    op.create_table(
        "oauth_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("state_hash", sa.String(64), nullable=False),
        sa.Column("next_path", sa.String(1024), nullable=False, server_default="/"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_oauth_states_state_hash",
        "oauth_states",
        ["state_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_oauth_states_state_hash", table_name="oauth_states")
    op.drop_table("oauth_states")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_wechat_unionid")
        batch_op.drop_index("ix_users_wechat_openid")
        batch_op.drop_column("last_login_at")
        batch_op.drop_column("avatar_url")
        batch_op.drop_column("wechat_unionid")
        batch_op.drop_column("wechat_openid")
        batch_op.drop_column("provider_subject")
        batch_op.drop_column("auth_provider")
