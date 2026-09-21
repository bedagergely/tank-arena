#!/usr/bin/env sh
# One-time bootstrap: obtain the first Let's Encrypt certificate.
# nginx refuses to start without a certificate, so a throwaway self-signed one is
# installed first, nginx is brought up to answer the ACME challenge, and the real
# certificate replaces it. Afterwards `docker compose up -d` is all that's needed.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Missing .env (copy .env.example and set DOMAIN and EMAIL)"; exit 1; }
set -a; . ./.env; set +a
: "${DOMAIN:?set DOMAIN in .env}" "${EMAIL:?set EMAIL in .env}"

live="/etc/letsencrypt/live/$DOMAIN"
if [ -e "deploy/certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
  echo "Certificate for $DOMAIN already exists; run 'docker compose up -d'."
  exit 0
fi

mkdir -p deploy/certbot/conf deploy/certbot/www

echo "==> Creating temporary self-signed certificate"
docker compose run --rm --entrypoint sh certbot -c \
  "mkdir -p '$live' && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
     -keyout '$live/privkey.pem' -out '$live/fullchain.pem' -subj '/CN=$DOMAIN'"

echo "==> Starting nginx"
docker compose up -d nginx

echo "==> Requesting certificate for $DOMAIN"
docker compose run --rm --entrypoint sh certbot -c \
  "rm -rf '$live' && certbot certonly --webroot -w /var/www/certbot \
     -d '$DOMAIN' --email '$EMAIL' --agree-tos --no-eff-email --non-interactive ${STAGING:+--staging}"

echo "==> Reloading nginx"
docker compose exec nginx nginx -s reload

echo "Done. Start everything with: docker compose up -d --build"
