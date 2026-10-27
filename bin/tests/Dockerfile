# syntax=docker/dockerfile:1
# CI for the operator scripts in bin/ (docker-compose.yml ci-scripts): pytest over bin/tests and ruff.
# The repo is bind-mounted at /app, so the image holds only the tools; make for test_make_deploy.py.
# Base images pinned like digest/python's.
FROM ghcr.io/astral-sh/uv:0.13.5@sha256:32a7bb39b496babbd997b0a39a4d66c126bdaf5661b302bf6f06abda8deca6ff AS uv
FROM python:3.15-slim@sha256:490c3463f3766091067a01528e6be3208104eebcca11a306beab5de9672ee893
RUN apt-get update && apt-get install -y --no-install-recommends git make && rm -rf /var/lib/apt/lists/*
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --break-system-packages pytest==9.1.1 pytest-xdist==3.8.0 ruff==0.16.9
WORKDIR /app
