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
#   hive-resync --watch [--interval SEC] [--idle-min MIN]
#                                  daemon mode: every SEC seconds, close
#                                  dispatches submitted more than MIN minutes
#                                  ago with no recent worker activity.
#                                  Defaults: interval=60, idle-min=3.
#   hive-resync --help             this message
#
# The DB is backed up to runtime.sqlite.bak.<ts> before any --fix write.
# Honors HIVE_DB env var (default: ~/.config/hive/runtime.sqlite).

set -euo pipefail

DB="${HIVE_DB:-$HOME/.config/hive/runtime.sqlite}"
APPLY=false
RESTART=false
WATCH=false
INTERVAL=60
IDLE_MIN=3

while [ $# -gt 0 ]; do
    case "$1" in
        --fix) APPLY=true; shift ;;
        --restart) RESTART=true; shift ;;
        --watch) WATCH=true; shift ;;
        --interval) INTERVAL="$2"; shift 2 ;;
        --idle-min) IDLE_MIN="$2"; shift 2 ;;
        -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

if [ ! -f "$DB" ]; then
    echo "DB not found: $DB" >&2
    exit 1
fi

# Watch mode: daemon loop closing idle dispatches based on last worker message.
if [ "$WATCH" = true ]; then
    # Don't exit on individual command errors; the daemon must survive
    # transient sqlite "database is locked" errors when the Hive runtime
    # is actively writing.
    set +e
    echo "hive-resync watchdog started (interval=${INTERVAL}s, idle-min=${IDLE_MIN}m)"
    echo "DB: $DB"
    echo "Press Ctrl-C to stop"
    # Use sqlite -cmd to retry busy database for up to 5s on each query.
    SQLITE_OPTS=(-cmd ".timeout 5000")
    while true; do
        # Hang detection: dispatch with NO follow-up activity from worker
        # for longer than HANG_MIN minutes. Likely PTY stuck (opencode/codex
        # loop, LLM hang, blocked on prompt). We do NOT auto-close — user
        # decides whether to interrupt. Just log loudly so user notices.
        HANG_MIN=10
        HUNG=$(sqlite3 "${SQLITE_OPTS[@]}" "$DB" "
          SELECT d.id || ' | worker=' || w.name || ' | submitted=' ||
                 datetime(d.created_at/1000,'unixepoch','localtime') ||
                 ' | minutes_silent=' ||
                 CAST((strftime('%s','now') * 1000 - d.created_at) / 60000 AS INTEGER)
          FROM dispatches d
          JOIN workers w ON w.id = d.to_agent_id
          LEFT JOIN (
            SELECT worker_id, MAX(created_at) AS last_at
            FROM messages
            WHERE type IN ('report','status')
            GROUP BY worker_id
          ) m ON m.worker_id = d.to_agent_id
          WHERE d.status NOT IN ('reported','cancelled','failed')
            AND (m.last_at IS NULL OR m.last_at < d.created_at)
            AND (strftime('%s','now') * 1000 - d.created_at) > ${HANG_MIN} * 60 * 1000
          ORDER BY d.created_at ASC;
        " 2>/dev/null)
        if [ -n "$HUNG" ]; then
            echo "$(date '+%H:%M:%S') ⚠ HUNG dispatch(es) — worker may need manual interrupt:"
            echo "$HUNG" | sed 's/^/    /'
        fi

        # For each non-terminal dispatch, check if its worker has a more
        # recent report/status message after the dispatch was created. If
        # yes AND that activity is older than idle-min minutes, close the
        # dispatch. This catches the common case of workers reporting via
        # team status (which does not auto-close) or reporting without
        # --dispatch in a way that leaked stale rows.
        CLOSED=$(sqlite3 "${SQLITE_OPTS[@]}" "$DB" "
          WITH stale_dispatches AS (
            SELECT d.id AS dispatch_id, d.to_agent_id, d.created_at
            FROM dispatches d
            WHERE d.status NOT IN ('reported', 'cancelled', 'failed')
          ),
          last_worker_activity AS (
            SELECT s.dispatch_id,
                   (SELECT MAX(m.created_at)
                    FROM messages m
                    WHERE m.worker_id = s.to_agent_id
                      AND m.created_at > s.created_at
                      AND m.type IN ('report', 'status'))
                   AS last_msg_at
            FROM stale_dispatches s
          )
          SELECT s.dispatch_id
          FROM stale_dispatches s
          JOIN last_worker_activity a ON a.dispatch_id = s.dispatch_id
          WHERE a.last_msg_at IS NOT NULL
            AND (strftime('%s','now') * 1000 - a.last_msg_at) > ${IDLE_MIN} * 60 * 1000;
        ")
        if [ -n "$CLOSED" ]; then
            COUNT=$(echo "$CLOSED" | wc -l | tr -d ' ')
            echo "$(date '+%H:%M:%S') closing $COUNT stale dispatch(es):"
            echo "$CLOSED" | sed 's/^/    /'
            for id in $CLOSED; do
                sqlite3 "${SQLITE_OPTS[@]}" "$DB" "
                  UPDATE dispatches
                  SET status='reported',
                      reported_at=strftime('%s','now') * 1000,
                      report_text=COALESCE(report_text, 'auto-closed by hive-resync watchdog after ${IDLE_MIN}m idle')
                  WHERE id='$id' AND status NOT IN ('reported','cancelled','failed');
                " 2>/dev/null || echo "$(date '+%H:%M:%S') warn: failed to close $id (db locked, will retry next tick)"
            done
        fi
        sleep "$INTERVAL"
    done
fi

# One-shot mode (default + --fix + --restart)
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

if [ "$APPLY" = false ] && [ "$RESTART" = false ] && [ "$WATCH" = false ]; then
    echo
    echo "Dry run. Pass --fix to mark these as reported, --restart to kill"
    echo "the daemon, or --watch to run as a background watchdog daemon."
    echo "Typical one-shot recovery: hive-resync --fix --restart"
    echo "Typical always-on usage:  hive-resync --watch &  (run on session start)"
fi
