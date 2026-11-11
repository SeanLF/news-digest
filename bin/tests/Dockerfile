# syntax=docker/dockerfile:1
# CI for the operator scripts in bin/ (docker-compose.yml ci-scripts): pytest over bin/tests and ruff.
# The repo is bind-mounted at /app, so the image holds only the tools; make for test_make_deploy.py.
# Base images pinned like digest/python's.
FROM ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 AS uv
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928
RUN apt-get update && apt-get install -y --no-install-recommends git make && rm -rf /var/lib/apt/lists/*
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --break-system-packages pytest==9.2.0 pytest-xdist==3.8.0 ruff==0.17.4
WORKDIR /app
