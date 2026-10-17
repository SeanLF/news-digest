# syntax=docker/dockerfile:1
# CI for the operator scripts in bin/ (docker-compose.yml ci-scripts): pytest over bin/tests and ruff.
# The repo is bind-mounted at /app, so the image holds only the tools; make for test_make_deploy.py.
# Base images pinned like digest/python's.
FROM ghcr.io/astral-sh/uv:0.13.1@sha256:4a1f3666816dafadd20ceb71eac9a7d56d7ef30279f7d64048519ab901ada336 AS uv
FROM python:3.15-slim@sha256:2da676046630d7bf14c6764ae1143dc7fa0377a53f94bf5a642f0b214aca5bce
RUN apt-get update && apt-get install -y --no-install-recommends git make && rm -rf /var/lib/apt/lists/*
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --break-system-packages pytest==9.1.1 pytest-xdist==3.8.0 ruff==0.16.9
WORKDIR /app
