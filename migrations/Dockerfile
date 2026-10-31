FROM python:3.14-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.14-slim
RUN groupadd --gid 10001 migrations && useradd --uid 10001 --gid migrations --no-create-home migrations
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
ENTRYPOINT ["curves-migrate"]
