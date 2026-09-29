# The prod Python worker image (amd64, as deployed) plus what the attach step would add; the size
# difference between the two is the image delta.
ARG BASE=seanfloyd-hetzner.tail739266.ts.net:5443/digest-python:latest
FROM ghcr.io/astral-sh/uv:0.12.17 AS uv
FROM ${BASE}
USER root
COPY --from=uv /uv /usr/local/bin/
RUN uv pip install --python /app/.venv/bin/python --no-cache onnxruntime==1.30.0 tokenizers==0.23.2 numpy==2.5.3 && rm /usr/local/bin/uv
USER appuser
WORKDIR /poc
