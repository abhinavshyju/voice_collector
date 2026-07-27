#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🎙️  Voice Collector — Starting..."

# Start backend
echo "→ Starting FastAPI backend on :8000..."
(cd "$DIR/backend" && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &
BACKEND_PID=$!

# Start frontend
echo "→ Starting Vite dev server on :5173..."
(cd "$DIR/frontend" && npm run dev -- --host) &
FRONTEND_PID=$!

# Trap to kill both on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM EXIT

echo ""
echo "✅ Backend:  http://localhost:8000"
echo "✅ Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
