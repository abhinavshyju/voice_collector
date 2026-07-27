#!/bin/bash
set -e

mkdir -p /etc/nginx/ssl /var/www/certbot

SSL_DOMAIN="${SSL_DOMAIN:-vc.ratcat.in}"
LE_CERT="/etc/letsencrypt/live/${SSL_DOMAIN}/fullchain.pem"
LE_KEY="/etc/letsencrypt/live/${SSL_DOMAIN}/privkey.pem"

if [ -f "$LE_CERT" ] && [ -f "$LE_KEY" ]; then
  echo "Using Let's Encrypt cert for ${SSL_DOMAIN}"
  cp -L "$LE_CERT" /etc/nginx/ssl/cert.pem
  cp -L "$LE_KEY" /etc/nginx/ssl/key.pem
elif [ ! -f /etc/nginx/ssl/cert.pem ]; then
  SSL_SAN="${SSL_SAN:-DNS:localhost,IP:127.0.0.1}"
  echo "Generating self-signed TLS cert (SAN: ${SSL_SAN})"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/key.pem \
    -out /etc/nginx/ssl/cert.pem \
    -subj "/CN=${SSL_DOMAIN}" \
    -addext "subjectAltName=${SSL_SAN}"
fi

cd /app/backend

# Use pre-built venv from Docker build (avoid uv re-sync on startup)
/app/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
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
