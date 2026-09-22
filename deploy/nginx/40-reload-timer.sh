#!/bin/sh
# Runs from /docker-entrypoint.d before nginx starts: reload periodically so
# certificates renewed by the certbot container are picked up.
(
  while :; do
    sleep 6h
    nginx -s reload
  done
) &
