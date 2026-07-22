from pathlib import Path

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _read_env_file(key: str) -> str:
    if not ENV_FILE.exists():
        return ""
    return dotenv_values(ENV_FILE).get(key, "") or ""


def _is_valid_key(value: str) -> bool:
    return bool(value) and value.upper() != "EMPTY"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    litellm_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./autobiography.db"
    cors_origins: str = "http://localhost:6985"
    access_password: str = ""
    frontend_url: str = "http://localhost:6985"
    public_api_url: str = "http://localhost:6986"
    session_cookie_name: str = "autobiography_session"
    oauth_state_cookie_name: str = "autobiography_oauth_state"
    session_ttl_days: int = 30
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    wechat_redirect_uri: str = ""
    oauth_state_ttl_minutes: int = 10

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def cors_origin_regex(self) -> str:
        return r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    @property
    def effective_deepseek_api_key(self) -> str:
        if _is_valid_key(self.deepseek_api_key):
            return self.deepseek_api_key
        return _read_env_file("DEEPSEEK_API_KEY")

    @property
    def effective_openai_api_key(self) -> str:
        if _is_valid_key(self.openai_api_key):
            return self.openai_api_key
        return _read_env_file("OPENAI_API_KEY")

    @property
    def resolved_model(self) -> str:
        model = self.litellm_model.strip()
        if "deepseek" in model.lower() and not model.startswith("deepseek/"):
            return f"deepseek/{model}"
        return model

    @property
    def is_deepseek(self) -> bool:
        return "deepseek" in self.resolved_model.lower()

    @property
    def wechat_login_enabled(self) -> bool:
        return not self.wechat_configuration_issues

    @property
    def wechat_configuration_issues(self) -> list[str]:
        issues: list[str] = []
        if not self.wechat_app_id.strip():
            issues.append("未配置 WECHAT_APP_ID")
        if not self.wechat_app_secret.strip():
            issues.append("未配置 WECHAT_APP_SECRET")
        if not self.resolved_wechat_redirect_uri:
            issues.append("未配置 WECHAT_REDIRECT_URI 或 PUBLIC_API_URL")
        return issues

    @property
    def resolved_wechat_redirect_uri(self) -> str:
        if self.wechat_redirect_uri.strip():
            return self.wechat_redirect_uri.strip()
        return f"{self.public_api_url.rstrip('/')}/api/auth/wechat/callback"


settings = Settings()
