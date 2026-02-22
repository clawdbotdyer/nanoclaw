#!/bin/bash
# SigmaBoy hourly scan
# Runs regime watch, funding anomaly scan, and healthcheck ping

set -e

# Source environment variables
source /home/openclaw/nanoclaw/.env

WORKSPACE="/workspace/group"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== Hourly scan started: $TIMESTAMP ==="

# 1. Run health check first
node "$WORKSPACE/scripts/health.js"

# 2. Self-assess tier
STATE=$(cat "$WORKSPACE/state.json")
TIER=$(echo "$STATE" | grep -o '"tier"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
KILLED=$(echo "$STATE" | grep -o '"killed"[[:space:]]*:[[:space:]]*[^,}]*' | awk '{print $NF}')

echo "Current tier: $TIER"
echo "Killed flag: $KILLED"

if [ "$KILLED" = "true" ]; then
  echo "Killed flag is true, stopping immediately"
  exit 0
fi

# 3. Check open paper trades for stop conditions
# TODO: implement when first paper trade exists

# 4. Fetch regime-basic for active tickers
echo "Fetching regime data..."
TICKERS="SPY QQQ NVDA TSLA"

for TICKER in $TICKERS; do
  RESPONSE=$(curl -s -H "Authorization: Bearer $SIGMAGRID_API_KEY" \
    "https://api.sigmagrid.app/v1/regime-basic/$TICKER")

  # Check for error responses
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "$TICKER: ⚠ No data available (market likely closed)"
    # Don't overwrite cached data if API has no data
    # Instead, mark it as stale but preserve the last known value
    if [ -f "$WORKSPACE/signals/regime-$TICKER-latest.json" ]; then
      echo "  → Using cached regime data"
    else
      echo "  → No cached data available"
    fi
  else
    echo "$TICKER: ✓ Updated"
    # Cache response with timestamp
    echo "{\"ticker\": \"$TICKER\", \"fetched_at\": \"$TIMESTAMP\", \"data\": $RESPONSE}" \
      > "$WORKSPACE/signals/regime-$TICKER-latest.json"
  fi
done

# 5. Fetch funding data for active tickers
echo "Fetching funding data..."

for TICKER in $TICKERS; do
  RESPONSE=$(curl -s -H "Authorization: Bearer $SIGMAGRID_API_KEY" \
    "https://api.sigmagrid.app/v1/funding/$TICKER")

  # Check for error responses
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "$TICKER funding: ⚠ No data available (market likely closed)"
    # Preserve cached funding data if API has no data
    if [ -f "$WORKSPACE/signals/funding-$TICKER-latest.json" ]; then
      echo "  → Using cached funding data"
    else
      echo "  → No cached data available"
    fi
  else
    echo "$TICKER funding: ✓ Updated"
    # Cache response
    echo "{\"ticker\": \"$TICKER\", \"fetched_at\": \"$TIMESTAMP\", \"data\": $RESPONSE}" \
      > "$WORKSPACE/signals/funding-$TICKER-latest.json"
  fi
done

# 6. Ping healthcheck if URL is set
if [ -n "$HEALTHCHECK_URL" ]; then
  echo "Pinging healthcheck..."
  if curl -s -o /dev/null -w "%{http_code}" "$HEALTHCHECK_URL" | grep -q "^2"; then
    echo "Healthcheck: ✓"
  else
    echo "Healthcheck: ⚠ Failed (will retry next hour)"
  fi
else
  echo "HEALTHCHECK_URL not set, skipping ping"
fi

echo "=== Hourly scan complete: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "If market is closed: Cached data will be used by the agent"
echo ""
