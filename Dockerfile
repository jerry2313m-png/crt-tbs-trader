FROM node:20-alpine AS mobile-builder
WORKDIR /app/mobile
COPY mobile/package*.json ./
RUN npm install -g serve 2>/dev/null || true
COPY mobile/ ./

FROM python:3.11-slim AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/health || exit 1
CMD ["python", "-m", "backend.server"]
