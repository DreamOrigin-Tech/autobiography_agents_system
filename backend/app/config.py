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
    access_password: str = ""  # 为空则跳过认证（单用户部署）

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

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


settings = Settings()
