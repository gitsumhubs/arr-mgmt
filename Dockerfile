# syntax=docker/dockerfile:1.7

# Grab the docker CLI from the official image (no daemon, just the client binary)
FROM docker:27-cli AS docker-cli

FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/gitsumhubs/arr-mgmt"
LABEL org.opencontainers.image.description="Flask web UI for managing Sonarr and Radarr"
LABEL org.opencontainers.image.licenses="MIT"

# Docker CLI — needed for restart + log-viewer features (paired with /var/run/docker.sock mount)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY templates/ templates/
COPY static/ static/

ENV ARR_MGMT_DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 7664

CMD ["python", "-u", "app.py"]
