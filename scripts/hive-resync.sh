#!/usr/bin/env bash
# hive-resync - Restore Hive worker pending counters by force-closing stuck
# dispatches in ~/.config/hive/runtime.sqlite, then optionally kill the
# runtime daemon so it re-hydrates clean on next launch.
#
# Pairs with the local patch in dispatch-ledger-store.{ts,js} that treats
# 'cancelled' and 'failed' as terminal during hydration.
#
# Usage:
#   hive-resync                    diagnose only (default, no writes)
#   hive-resync --fix              mark all non-terminal dispatches reported
#   hive-resync --restart          kill the Hive runtime (you re-launch in UI)
#   hive-resync --fix --restart    both - typical recovery flow
#   hive-resync --help             this message
#
# The DB is backed up to runtime.sqlite.bak.<ts> before any write.
# Honors HIVE_DB env var (default: ~/.config/hive/runtime.sqlite).

set -euo pipefail

DB="${HIVE_DB:-$HOME/.config/hive/runtime.sqlite}"
APPLY=false
RESTART=false

for arg in "$@"; do
    case "$arg" in
        --fix) APPLY=true ;;
        --restart) RESTART=true ;;
        -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
        *) echo "Unknown arg: $arg" >&2; exit 2 ;;
    esac
done

if [ ! -f "$DB" ]; then
    echo "DB not found: $DB" >&2
    exit 1
fi

echo "=== Hive runtime DB: $DB ==="
echo
echo "=== Non-terminal dispatches (status not in 'reported'/'cancelled'/'failed') ==="
sqlite3 -header -column "$DB" "
  SELECT d.id, w.name AS worker, d.status,
         substr(d.text, 1, 50) AS task_preview,
         datetime(d.created_at/1000, 'unixepoch', 'localtime') AS created
  FROM dispatches d
  LEFT JOIN workers w ON w.id = d.to_agent_id
  WHERE d.status NOT IN ('reported', 'cancelled', 'failed')
  ORDER BY d.sequence DESC
  LIMIT 50;
"

OPEN_COUNT=$(sqlite3 "$DB" "SELECT count(*) FROM dispatches WHERE status NOT IN ('reported','cancelled','failed');")
echo
echo "=== Non-terminal dispatch count: $OPEN_COUNT ==="
echo

HIVE_PID="$(lsof "$DB" 2>/dev/null | awk 'NR==2 {print $2}' || true)"
if [ -n "${HIVE_PID:-}" ]; then
    HIVE_ETIME="$(ps -p "$HIVE_PID" -o etime= 2>/dev/null | tr -d ' ' || echo unknown)"
    echo "Hive runtime: pid $HIVE_PID, uptime $HIVE_ETIME"
else
    echo "Hive runtime: not running (no process holds the DB)"
fi

if [ "$APPLY" = true ] && [ "$OPEN_COUNT" -gt 0 ]; then
    BACKUP="${DB}.bak.$(date +%Y%m%d-%H%M%S)"
    cp "$DB" "$BACKUP"
    echo "DB backed up to: $BACKUP"

    sqlite3 "$DB" "
      UPDATE dispatches
      SET status='reported',
          reported_at=COALESCE(reported_at, strftime('%s','now')*1000),
          report_text=COALESCE(report_text, 'force-closed by hive-resync')
      WHERE status NOT IN ('reported', 'cancelled', 'failed');
    "
    echo "Marked $OPEN_COUNT dispatches as reported."
elif [ "$APPLY" = true ]; then
    echo "Nothing to fix - no non-terminal dispatches."
fi

if [ "$RESTART" = true ]; then
    if [ -n "${HIVE_PID:-}" ]; then
        echo "Killing Hive runtime (pid $HIVE_PID)..."
        kill "$HIVE_PID"
        echo
        echo "Now restart the runtime, e.g.:"
        echo "  cd ~/development/hive && pnpm dev:runtime"
        echo "Then re-launch workers in the Hive UI."
    else
        echo "No Hive runtime process to kill."
    fi
fi

if [ "$APPLY" = false ] && [ "$RESTART" = false ]; then
    echo
    echo "Dry run. Pass --fix to mark these as reported, --restart to kill the daemon."
    echo "Typical recovery: hive-resync --fix --restart"
fi
