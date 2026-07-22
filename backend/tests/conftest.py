import os
import tempfile
from pathlib import Path


TEST_DATABASE_PATH = (
    Path(tempfile.gettempdir()) / f"autobiography_pytest_{os.getpid()}.db"
)

for suffix in ("", "-journal", "-shm", "-wal"):
    Path(f"{TEST_DATABASE_PATH}{suffix}").unlink(missing_ok=True)

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DATABASE_PATH}"
os.environ["ACCESS_PASSWORD"] = "test-password"
os.environ["FRONTEND_URL"] = "http://frontend.test"
os.environ["PUBLIC_API_URL"] = "http://test"
os.environ["WECHAT_APP_ID"] = "test-wechat-app"
os.environ["WECHAT_APP_SECRET"] = "test-wechat-secret"
os.environ["WECHAT_REDIRECT_URI"] = "http://test/api/auth/wechat/callback"


async def login_test_user(client) -> None:
    response = await client.post(
        "/api/auth/login",
        json={"password": os.environ["ACCESS_PASSWORD"]},
    )
    assert response.status_code == 200, response.text


def pytest_sessionfinish() -> None:
    for suffix in ("", "-journal", "-shm", "-wal"):
        Path(f"{TEST_DATABASE_PATH}{suffix}").unlink(missing_ok=True)
