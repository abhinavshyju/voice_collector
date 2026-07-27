#!/usr/bin/env bash
set -euo pipefail

DOMAIN="vc.ratcat.in"
EC2_IP="13.60.215.83"
EMAIL="${SSL_EMAIL:-admin@ratcat.in}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Checking DNS for ${DOMAIN}..."
RESOLVED_IP="$(getent ahosts "${DOMAIN}" 2>/dev/null | awk '/STREAM/ {print $1; exit}')"
if [ -z "${RESOLVED_IP}" ]; then
  RESOLVED_IP="$(python3 -c "import socket; print(socket.gethostbyname('${DOMAIN}'))" 2>/dev/null || true)"
fi
if [ "${RESOLVED_IP}" != "${EC2_IP}" ]; then
  echo "ERROR: ${DOMAIN} must point to ${EC2_IP} (currently: ${RESOLVED_IP:-not set})"
  echo ""
  echo "Add this record in Cloudflare for ratcat.in:"
  echo "  Type: A"
  echo "  Name: vc"
  echo "  Content: ${EC2_IP}"
  echo "  Proxy: DNS only (grey cloud)"
  exit 1
fi

cd "${DIR}"

echo "Requesting Let's Encrypt certificate..."
sudo docker-compose --profile tools run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --non-interactive

echo "Restarting app with new certificate..."
sudo docker-compose up -d --build --force-recreate

echo ""
echo "Done: https://${DOMAIN}"
