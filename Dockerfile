FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Playwright browsers (optional; runtime works in simulated mode without them)
RUN pip install playwright==1.49.1 && playwright install chromium --with-deps || true

# Backend + built frontend (build frontend first: npm --prefix frontend install && npm --prefix frontend run build)
COPY backend/ ./backend/
COPY frontend/dist/ ./frontend/dist/

RUN mkdir -p /app/backend/data /app/data

ENV PYTHONPATH=/app/backend
ENV DB_PATH=/app/data/runtime.db
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
