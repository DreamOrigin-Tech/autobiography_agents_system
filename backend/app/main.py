from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import settings
from app.db.session import init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info(
        "LLM ready: model=%s deepseek_key=%s auth=%s",
        settings.resolved_model,
        bool(settings.effective_deepseek_api_key),
        bool(settings.access_password),
    )
    yield


app = FastAPI(title="Autobiography Agent API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试" if not isinstance(exc, ValueError) else str(exc)},
    )


app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": settings.resolved_model,
        "llm_configured": bool(
            settings.effective_deepseek_api_key if settings.is_deepseek else settings.effective_openai_api_key
        ),
        "auth_enabled": bool(settings.access_password),
    }
