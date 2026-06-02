#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE="interzone-dispatcher"
COMPOSE_FILE="docker-compose.yml"

usage() {
  echo "Usage: $0 [up|down|restart|build|logs|status]"
  echo ""
  echo "  up        Build image (if needed) and start the stack (default)"
  echo "  down      Stop and remove containers"
  echo "  restart   down + up"
  echo "  build     Force rebuild the Docker image"
  echo "  logs      Follow container logs"
  echo "  status    Show running containers and healthz"
  exit 1
}

cmd="${1:-up}"

case "$cmd" in
  up)
    echo "→ Starting interzone-dispatcher..."
    docker compose -f "$COMPOSE_FILE" up -d --build
    echo ""
    echo "Waiting for dispatcher to be ready..."
    for i in $(seq 1 15); do
      if curl -sf http://localhost:4242/healthz > /dev/null 2>&1; then
        echo "✓ Dispatcher is up"
        curl -s http://localhost:4242/healthz | python3 -m json.tool 2>/dev/null || \
          curl -s http://localhost:4242/healthz
        echo ""
        echo "  API:       http://localhost:4242/v1/chat/completions"
        echo "  Dashboard: http://localhost:4242/dashboard"
        echo "  Admin:     http://localhost:4242/admin/stats"
        echo "  Metrics:   http://localhost:4242/metrics"
        exit 0
      fi
      sleep 1
    done
    echo "⚠ Dispatcher did not respond within 15s — check logs:"
    echo "  $0 logs"
    exit 1
    ;;
  down)
    echo "→ Stopping interzone-dispatcher..."
    docker compose -f "$COMPOSE_FILE" down
    ;;
  restart)
    "$0" down
    "$0" up
    ;;
  build)
    echo "→ Rebuilding image..."
    docker compose -f "$COMPOSE_FILE" build --no-cache
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f
    ;;
  status)
    echo "=== Containers ==="
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "=== Health ==="
    curl -sf http://localhost:4242/healthz | python3 -m json.tool 2>/dev/null || echo "(dispatcher not responding)"
    ;;
  *)
    usage
    ;;
esac
