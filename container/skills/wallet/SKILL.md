---
name: wallet
description: Manage cryptocurrency wallet operations for receiving payments from other agents and executing x402 protocol transactions. Use when you need to authenticate wallet, check balance, send USDC, trade tokens, or receive payments for your services. Essential for agent-to-agent commerce and monetizing your signals/data.
allowed-tools: Bash(npx awal@2.0.3 *)
---

# Cryptocurrency Wallet Management with awal

## Overview

This skill enables SigmaBoy to manage an Agentic Wallet for:
- Receiving payments from agents consuming SigmaGrid signals
- Sending USDC payments for external services
- Trading tokens on Base network
- Participating in x402 agent-to-agent commerce
- Monetizing signal data and paper trade performance

**Important**: SigmaBoy has free first-party access to SigmaGrid signals (no x402 payment needed for own queries). This wallet is for receiving payments FROM other agents who consume your data.

## Quick Start

```bash
# Check wallet status and authentication
npx awal@2.0.3 status

# Check balance
npx awal@2.0.3 balance

# Get wallet address (for receiving payments)
npx awal@2.0.3 address
```

## Core Commands

### Authentication

```bash
# Step 1: Initiate login (sends OTP to email)
npx awal@2.0.3 auth login <email>
# Returns: flowId

# Step 2: Verify OTP code
npx awal@2.0.3 auth verify <flowId> <otp>

# Check authentication status
npx awal@2.0.3 status
```

**Input Validation**:
- `email`: Must match `^[^\s;|&`]+@[^\s;|&`]+$`
- `flowId`: Must be alphanumeric `^[a-zA-Z0-9_-]+$`
- `otp`: Must be exactly 6 digits `^\d{6}$`

### Balance & Address

```bash
# Get USDC balance
npx awal@2.0.3 balance
npx awal@2.0.3 balance --json

# Get wallet address (for receiving payments)
npx awal@2.0.3 address
npx awal@2.0.3 address --json
```

### Sending USDC

```bash
# Send USDC to Ethereum address or ENS name
npx awal@2.0.3 send <amount> <recipient>
npx awal@2.0.3 send <amount> <recipient> --json

# Examples
npx awal@2.0.3 send 1.00 0x1234...abcd
npx awal@2.0.3 send 0.50 vitalik.eth
npx awal@2.0.3 send '$5.00' 0x1234...abcd  # Use quotes for $ prefix
```

**Input Validation**:
- `amount`: Must match `^\$?[\d.]+$`
- `recipient`: Must be valid 0x address `^0x[0-9a-fA-F]{40}$` or ENS name `^[a-zA-Z0-9.-]+\.eth$`

### Trading Tokens

```bash
# Swap tokens on Base network
npx awal@2.0.3 trade <amount> <from-token> <to-token>

# Examples
npx awal@2.0.3 trade 10 usdc eth      # Swap 10 USDC for ETH
npx awal@2.0.3 trade 0.01 eth usdc    # Swap 0.01 ETH for USDC
npx awal@2.0.3 trade 1 usdc weth      # Swap to wrapped ETH
```

Supported tokens on Base: `usdc`, `eth`, `weth`

### Funding Wallet

```bash
# Open Coinbase Onramp to add funds
npx awal@2.0.3 fund

# Specify amount (opens with pre-filled amount)
npx awal@2.0.3 fund --amount 10
```

### x402 Protocol Operations

#### Search for Paid Services

```bash
# Find paid API services in x402 bazaar
npx awal@2.0.3 x402 search <query>

# Examples
npx awal@2.0.3 x402 search "weather data"
npx awal@2.0.3 x402 search "market signals"
```

#### Pay for Service

```bash
# Execute paid API call through x402
npx awal@2.0.3 x402 pay <service-url> [--data <json>]

# Example
npx awal@2.0.3 x402 pay https://api.example.com/premium/signals --data '{"ticker":"NVDA"}'
```

#### Monetize Your Services

```bash
# Deploy your signals/data as paid API
npx awal@2.0.3 x402 monetize <service-endpoint> <price-usdc>

# Example: Monetize SigmaGrid signal access
npx awal@2.0.3 x402 monetize /api/signals/premium 0.01
```

### Utility Commands

```bash
# Show wallet in companion window
npx awal@2.0.3 show

# Get all commands help
npx awal@2.0.3 --help
```

## Workflow Examples

### Example 1: Initial Wallet Setup

```bash
# 1. Check if wallet exists
npx awal@2.0.3 status

# 2. Authenticate (if not signed in)
npx awal@2.0.3 auth login sigmaboy@example.com
# Wait for OTP code...
npx awal@2.0.3 auth verify abc123 123456

# 3. Get wallet address for receiving payments
npx awal@2.0.3 address

# 4. Check balance
npx awal@2.0.3 balance
```

### Example 2: Receiving Payment for Signals

```bash
# 1. Share wallet address with consumers
WALLET_ADDRESS=$(npx awal@2.0.3 address --json | jq -r '.address')
echo "Send payments to: $WALLET_ADDRESS"

# 2. Monitor balance periodically
npx awal@2.0.3 balance --json

# 3. Log incoming payments
# (Balance increases indicate payments received)
```

### Example 3: Paying for External Data

```bash
# 1. Check balance first
npx awal@2.0.3 balance

# 2. Search for service
npx awal@2.0.3 x402 search "premium market data"

# 3. Pay for service access
npx awal@2.0.3 x402 pay https://api.premium-data.com/v1/signals --data '{"ticker":"SPY"}'
```

### Example 4: Converting USDC to ETH

```bash
# 1. Check current USDC balance
npx awal@2.0.3 balance

# 2. Trade 10 USDC for ETH
npx awal@2.0.3 trade 10 usdc eth

# 3. Verify new balance
npx awal@2.0.3 balance
```

## JSON Output

All commands support `--json` flag for machine-readable output:

```bash
npx awal@2.0.3 status --json
npx awal@2.0.3 balance --json
npx awal@2.0.3 address --json
npx awal@2.0.3 send 1 vitalik.eth --json
```

## Error Handling

Common errors and solutions:

| Error | Solution |
|-------|----------|
| "Not authenticated" | Run `awal auth login <email>` first |
| "Insufficient balance" | Check balance with `awal balance`, fund with `awal fund` |
| "Could not resolve ENS name" | Verify ENS name exists on Ethereum mainnet |
| "Invalid recipient" | Must be valid 0x address or ENS name |
| "Trade failed" | Check token names, balance, and network status |

## Security Best Practices

1. **Input Validation**: Always validate user input before constructing commands
2. **Shell Injection**: Never pass unvalidated input to bash commands
3. **Amount Verification**: Confirm transaction amounts before executing
4. **ENS Resolution**: Verify resolved addresses match expected recipients
5. **Balance Checks**: Always check balance before sending/trading

## Network Information

- **Default Network**: Base (Layer 2 on Ethereum)
- **Native Token**: USDC (USD Coin)
- **Supported Tokens**: USDC, ETH, WETH
- **ENS Resolution**: Via Ethereum mainnet

## Installation

The `awal` CLI is installed via npx and does not require separate installation:

```bash
npx awal@2.0.3 status
```

## SigmaBoy-Specific Use Cases

### Receiving Payments for Signal Data

```bash
# Share your wallet address
npx awal@2.0.3 address

# Agents consuming your signals send USDC to this address
# Monitor incoming payments
npx awal@2.0.3 balance --json
```

### Monetizing Paper Trade Performance

```bash
# Deploy paper trade data as paid API
npx awal@2.0.3 x402 monetize /api/performance 0.05

# Agents can now pay to access your trade history
```

### Paying for Premium Data Sources

```bash
# If you need premium data beyond free sources
npx awal@2.0.3 x402 search "onchain data"
npx awal@2.0.3 x402 pay <service-url> --data '{"query":"..."}'
```

## Version

Current CLI version: `awal@2.0.3`

All commands are pinned to this version for consistency. Update across all commands if upgrading.

## References

- Coinbase Agentic Wallet Documentation: https://docs.cdp.coinbase.com/agentic-wallet/welcome
- x402 Protocol: Agent-to-agent payment protocol
- Base Network: https://base.org/
