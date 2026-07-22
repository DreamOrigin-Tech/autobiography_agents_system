FROM python:3.11-slim

WORKDIR /app

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=

COPY pyproject.toml .
RUN if [ -n "$PIP_TRUSTED_HOST" ]; then \
      pip install --no-cache-dir \
        --index-url "$PIP_INDEX_URL" \
        --trusted-host "$PIP_TRUSTED_HOST" \
        .; \
    else \
      pip install --no-cache-dir --index-url "$PIP_INDEX_URL" .; \
    fi

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6986"]
