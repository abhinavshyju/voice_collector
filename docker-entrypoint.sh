#!/bin/bash
set -e

cd /app/backend

# Use pre-built venv from Docker build (avoid uv re-sync on startup)
/app/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/recordings/count > /dev/null 2>&1; then
    echo "Backend ready"
    break
  fi
  sleep 2
done

# Start nginx in foreground
nginx -g "daemon off;" &
NGINX_PID=$!

trap "kill $BACKEND_PID $NGINX_PID 2>/dev/null" SIGTERM SIGINT
wait $NGINX_PID
