#!/bin/sh
if [ "$ROLE" = "CLIENT" ]; then
  echo "Starting ShareList21 in CLIENT Mode..."
  exec node dist-server/client.js
else
  echo "Starting ShareList21 in SERVER Mode..."
  exec node dist-server/server.js
fi