# SigmaBoy Trading Swarm Setup

Complete idempotent setup for the SigmaBoy four-agent trading swarm with fair value signal processing, risk evaluation, and paper trade execution across two venues.

## Directory Structure

```
~/nanoclaw/
├── workspace/swarm-state/
│   ├── signal.json              # Signal Agent output (WRITE ONLY)
│   ├── risk-verdict.json        # Risk Agent output (WRITE ONLY)
│   ├── positions.json           # Execution Agent output (READ/WRITE)
│   ├── trade-log.json           # Execution Agent output (WRITE append)
│   ├── risk-log.json            # Risk Agent output (WRITE append)
│   ├── decision-log.json        # Orchestrator output (READ/WRITE)
│   └── venue-comparison.json    # Execution Agent output (WRITE append)
├── groups/sigmaboy-orchestrator/
│   └── CLAUDE.md                # Orchestrator agent instructions
├── groups/sigmaboy-signal/
│   └── CLAUDE.md                # Signal agent instructions
├── groups/sigmaboy-risk/
│   └── CLAUDE.md                # Risk agent instructions
├── groups/sigmaboy-execution/
│   └── CLAUDE.md                # Execution agent instructions
├── .config/nanoclaw/
│   ├── mount-allowlist.json     # Container mount security config
│   └── sigmaboy-scheduler-config.json  # Scheduled task reference
└── .env                         # Environment variables
```

## Agent Roles

### Agent 1: Signal Agent (`groups/sigmaboy-signal/`)
Fetches fresh SigmaGrid fair value signals and writes normalized output to `signal.json`. Validates API responses and applies mean-reversion direction logic.
- **Triggered by:** Orchestrator at start of each cycle
- **Reads:** SIGMAGRID_API_KEY, SIGMAGRID_ENDPOINT (environment)
- **Writes:** workspace/swarm-state/signal.json
- **Output:** Fair value, premium, regime, confidence, derived direction
- **Reports to:** Orchestrator with signal summary

### Agent 2: Risk Agent (`groups/sigmaboy-risk/`)
Evaluates signals against 6 hard risk rules: freshness, regime gate, minimum edge, funding alignment, position limits, daily drawdown.
- **Triggered by:** Orchestrator after signal validation
- **Reads:** signal.json, positions.json
- **Writes:** risk-verdict.json (APPROVE or REJECT), risk-log.json (append)
- **Output:** Binary verdict with reason and rule evaluation count
- **Reports to:** Orchestrator with verdict and first-fail rule

### Agent 3: Execution Agent (`groups/sigmaboy-execution/`)
Records paper trades for both venues (Ostium/Arbitrum, Avantis/Base) with accurate fee modeling. Handles position opens and closes.
- **Triggered by:** Orchestrator only if Risk Agent approves
- **Reads:** signal.json, risk-verdict.json
- **Writes:** positions.json (append), trade-log.json (append), venue-comparison.json (append)
- **Output:** Position records for both venues with entry prices and session data
- **Reports to:** Orchestrator with execution confirmation

### Agent 4: Orchestrator (`groups/sigmaboy-orchestrator/`)
Central coordinator. Generates cycle IDs, sequences the pipeline, validates each stage, and logs outcomes. Only agent with read visibility across all state files.
- **Triggered by:** Scheduler every 5 minutes
- **Reads:** All swarm-state files (read-only)
- **Writes:** decision-log.json
- **Output:** Cycle records with status, outcomes, and timestamps
- **Reports to:** Telegram (status queries)

## Swarm State Files

All files are JSON-based and located in `workspace/swarm-state/`:

### signal.json (Signal Agent Write)
```json
{
  "cycle_id": "SB-20260222-143200-UTC",
  "status": "OK",
  "asset": "SPY",
  "direction": "SHORT",
  "fair_value": 590.42,
  "current_perp_price": 591.10,
  "premium": 0.68,
  "premium_pct": 0.115,
  "signal_age_seconds": 47,
  "regime": "NORMAL",
  "sigmagrid_confidence": 0.82,
  "funding_rate_8h": 0.0012,
  "signal_timestamp": "2026-02-22T14:31:13Z",
  "fetched_at_utc": "2026-02-22T14:32:03Z",
  "api_endpoint": "sigmagrid",
  "operator_access": true
}
```

### risk-verdict.json (Risk Agent Write)
```json
{
  "cycle_id": "SB-20260222-143200-UTC",
  "verdict": "APPROVE",
  "timestamp_utc": "2026-02-22T14:32:15Z",
  "signal_asset": "SPY",
  "signal_direction": "SHORT",
  "signal_premium_pct": 0.115,
  "signal_regime": "NORMAL",
  "signal_confidence": 0.82,
  "reason": "All 6 risk rules passed...",
  "rules_evaluated": 6,
  "first_fail_rule": null
}
```

### positions.json (Execution Agent Read/Write)
```json
[
  {
    "id": "uuid",
    "cycle_id": "SB-20260222-143200-UTC",
    "venue": "ostium",
    "asset": "SPY",
    "direction": "SHORT",
    "entry_price_raw": 591.10,
    "entry_price_net": 590.80,
    "opening_fee_bps": 5,
    "size_usdc": 100,
    "leverage": 1,
    "opened_at_utc": "2026-02-22T14:32:30Z",
    "market_session": "regular",
    "status": "OPEN",
    "unrealised_pnl": 0.00,
    "realised_pnl": null,
    "closed_at_utc": null,
    "execution_mode": "paper",
    "chain": "arbitrum"
  }
]
```

### decision-log.json (Orchestrator Write)
Array of cycle outcome records, one entry per cycle:
```json
[
  {
    "cycle_id": "SB-20260222-143200-UTC",
    "started_at_utc": "2026-02-22T14:32:00Z",
    "completed_at_utc": "2026-02-22T14:32:47Z",
    "status": "COMPLETED",
    "signal_outcome": "VALID",
    "risk_outcome": "APPROVE",
    "execution_outcome": "RECORDED-BOTH-VENUES",
    "notes": []
  }
]
```

### trade-log.json (Execution Agent Append)
Complete audit log of every trade submitted, including signal data and regime at submission.

### risk-log.json (Risk Agent Append)
Complete audit log of every risk verdict evaluated, including all 6 rule checks.

### venue-comparison.json (Execution Agent Append)
Comparative analysis of closed positions across venues, tracking fee costs and profitability differences.

## Mount Allowlist Schema

NanoClaw supports **directory-level mounts only** (not file-level). The mount allowlist is stored at `~/.config/nanoclaw/mount-allowlist.json`:

```json
{
  "allowedRoots": [
    {
      "path": "~/nanoclaw/workspace",
      "allowReadWrite": true,
      "description": "SigmaBoy swarm state and workspace"
    }
  ],
  "blockedPatterns": [
    "password",
    "secret",
    "token"
  ],
  "nonMainReadOnly": false
}
```

**Important:** All four agents mount the full `workspace/swarm-state` directory. File-level permissions (read-only vs read-write) are enforced through CLAUDE.md instructions only, not through container mount settings. Each agent's CLAUDE.md specifies exactly which files it may read and write.

## Environment Variables

Add to `.env`:

```bash
# SigmaGrid API (operator access — no payment required)
SIGMAGRID_API_KEY=sgk_cff25bd3_63a9842920563c4e4364699dbe0f1abe
SIGMAGRID_ENDPOINT=https://api.sigmagrid.com/v1

# Paper trading configuration
SIGMABOY_PAPER_CAPITAL_USDC=1000
SIGMABOY_MAX_RISK_PERCENT=2.0
```

**Action required before first cycle:**
1. Confirm SIGMAGRID_API_KEY is populated (operator-level access, no payment)
2. Confirm SIGMAGRID_ENDPOINT is set to correct SigmaGrid API base URL
3. Verify SIGMABOY_PAPER_CAPITAL_USDC matches intended paper capital pool
4. Verify SIGMABOY_MAX_RISK_PERCENT is the daily drawdown limit (currently 2.0%)

## Scheduled Task

The Orchestrator is triggered every 5 minutes by NanoClaw's scheduler.

**Task Configuration:**
- **Group:** sigmaboy-orchestrator
- **Schedule:** Every 5 minutes, 24/7
- **Max Runtime:** 4 minutes (240 seconds)
- **Overlap Protection:** If a cycle is in progress when the next trigger fires, skip that trigger entirely. Do not queue.
- **Timeout Action:** Log ABORTED-SCHEDULER-TIMEOUT to decision-log.json and release lock

**How to Register:**

Option 1 (via Claude Code):
```
/register-task sigmaboy-orchestrator \
  --schedule "interval:5m" \
  --context "group" \
  --max-runtime 240 \
  --name "SigmaBoy-5min-Cycle"
```

Option 2 (manual database entry):
Insert into NanoClaw's SQLite database (`~/.local/share/nanoclaw/messages.db`):
```sql
INSERT INTO scheduled_tasks (
  id, group_folder, chat_jid, prompt, schedule_type,
  schedule_value, context_mode, next_run, status, created_at
) VALUES (
  'sigmaboy-5min-cycle',
  'groups/sigmaboy-orchestrator',
  'nanoclaw-scheduler',
  'Run the SigmaBoy 5-minute trading cycle...',
  'interval',
  '5m',
  'group',
  datetime('now'),
  'active',
  datetime('now')
);
```

**Cycle Flow:**
1. Scheduler triggers Orchestrator every 5 minutes
2. Orchestrator checks if previous cycle is in progress (query decision-log.json)
3. If in progress: log SKIPPED-CYCLE-IN-PROGRESS and exit
4. If not: generate cycle_id (SB-YYYYMMDD-HHMMSS-UTC) and begin sequence
5. Stage 1: Initialize cycle, log start to decision-log.json
6. Stage 2: Trigger Signal Agent, wait 60s for signal.json update, validate
7. Stage 3: Trigger Risk Agent, wait 60s for risk-verdict.json, validate
8. Stage 4 (if APPROVE): Trigger Execution Agent, wait 60s for positions update
9. Stage 5: Update decision-log.json with final status and complete cycle

## Rebuild Order (Zero State)

Execute in this order to set up from scratch:

1. **Create state directory:**
   ```bash
   mkdir -p workspace/swarm-state
   echo '{}' > workspace/swarm-state/signal.json
   echo '{}' > workspace/swarm-state/risk-verdict.json
   echo '[]' > workspace/swarm-state/positions.json
   echo '[]' > workspace/swarm-state/trade-log.json
   echo '[]' > workspace/swarm-state/risk-log.json
   echo '[]' > workspace/swarm-state/decision-log.json
   echo '[]' > workspace/swarm-state/venue-comparison.json
   ```

2. **Create agent group directories and CLAUDE.md files:**
   - `groups/sigmaboy-orchestrator/CLAUDE.md`
   - `groups/sigmaboy-signal/CLAUDE.md`
   - `groups/sigmaboy-risk/CLAUDE.md`
   - `groups/sigmaboy-execution/CLAUDE.md`

3. **Create mount allowlist:**
   - `~/.config/nanoclaw/mount-allowlist.json` with workspace/swarm-state as allowed root

4. **Add environment variables:**
   - SIGMAGRID_API_KEY (populate with actual key)
   - SIGMAGRID_ENDPOINT (populate with actual endpoint)
   - SIGMABOY_PAPER_CAPITAL_USDC=1000
   - SIGMABOY_MAX_RISK_PERCENT=2.0

5. **Register scheduled task:**
   - Use Claude Code `/register-task` command or manual database entry
   - Set to 5-minute interval, group context, 4-minute timeout

6. **Verify:**
   - All four CLAUDE.md files are readable and match instruction specs
   - Mount allowlist allows workspace/swarm-state with read-write access
   - Environment variables populated before first scheduler trigger
   - Scheduled task is registered and next_run is set

## Key Constraints

- **No file-level mounts:** NanoClaw supports directory mounts only. Access control is via CLAUDE.md instructions.
- **Trading mode:** Execution agent runs in PAPER mode only. No exchange credentials are mounted.
- **Cycle isolation:** Each cycle_id is unique and fully tracked. Failed cycles are logged, not retried.
- **Binary verdicts:** Risk agent can only output APPROVE or REJECT, no intermediate states.
- **Operator access:** SigmaGrid API requires no payment (operator-level access included).
- **Overlap protection:** Scheduler cannot queue pending triggers; only skips if in progress.

## Manual Task Creation (if using database directly)

Using sqlite3 CLI:

```bash
sqlite3 ~/.local/share/nanoclaw/messages.db

INSERT INTO scheduled_tasks (
  id, group_folder, chat_jid, prompt, schedule_type,
  schedule_value, context_mode, next_run, status, created_at
) VALUES (
  'sigmaboy-orchestrator-5min',
  'groups/sigmaboy-orchestrator',
  'nanoclaw-scheduler',
  'Execute the full SigmaBoy 5-minute trading cycle as described in CLAUDE.md.',
  'interval',
  '5m',
  'group',
  datetime('now'),
  'active',
  datetime('now')
);

-- Verify insertion
SELECT id, group_folder, schedule_type, schedule_value, status FROM scheduled_tasks
WHERE group_folder LIKE '%sigmaboy%';
```

## Confirmation Checklist

Before declaring the setup complete, verify:

✓ All 7 JSON files exist in workspace/swarm-state/ (initialized with {} or [])
✓ All 4 CLAUDE.md files exist in groups/sigmaboy-{orchestrator,signal,risk,execution}/
✓ Mount allowlist exists at ~/.config/nanoclaw/mount-allowlist.json
✓ Mount allowlist includes workspace/swarm-state with allowReadWrite: true
✓ .env contains SIGMAGRID_API_KEY, SIGMAGRID_ENDPOINT, SIGMABOY_PAPER_CAPITAL_USDC, SIGMABOY_MAX_RISK_PERCENT
✓ Scheduled task is registered and active in NanoClaw database
✓ Scheduled task uses 5-minute interval with 4-minute max runtime
✓ Overlap protection is enabled (skip if in progress)
✓ All CLAUDE.md instructions reviewed by Matt and Steve
✓ SigmaGrid credentials confirmed as operator-level (no payment)

## Testing the Setup

After registration:

1. **Wait for first scheduler trigger** (up to 5 minutes)
2. **Check Telegram** for Orchestrator report
3. **Verify decision-log.json** was updated with first cycle attempt
4. **Review any error logs** in decision-log.json notes field
5. **Check signal.json** status (OK or ERROR)
6. **Check risk-verdict.json** for verdict outcome
7. **Check positions.json** for trade records if verdict was APPROVE

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No scheduler trigger | Task not registered or schedule_value malformed | Re-register task with correct interval format |
| Signal fetch fails | SIGMAGRID_API_KEY or SIGMAGRID_ENDPOINT missing | Populate both environment variables |
| Risk verdict never appears | Risk Agent crashed or timed out | Check agent container logs, verify positions.json exists |
| Positions not recorded | Execution Agent blocked by activation conditions | Verify risk-verdict verdict is APPROVE and cycle_id matches |
| Overlapping cycles | Overlap protection failing | Check decision-log.json for stuck IN-PROGRESS cycle, reset manually if needed |

## References

- Agent Instructions: See individual CLAUDE.md files for full behavioral specs
- Mount Security: See src/mount-security.ts for allowlist validation logic
- Task Scheduler: See src/task-scheduler.ts for trigger and timeout behavior
- State Schema: See this file for complete JSON structure documentation
