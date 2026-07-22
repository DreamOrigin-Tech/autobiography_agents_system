from app.config import settings


def test_pytest_uses_an_isolated_database():
    assert "autobiography_pytest_" in settings.database_url
    assert not settings.database_url.endswith("/autobiography.db")
