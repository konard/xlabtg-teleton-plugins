# TON Trading Bot

Atomic tools for trading on the TON blockchain. The LLM composes these tools into trading strategies — the plugin provides the primitives, not the logic.

**⚠️ WARNING: Cryptocurrency trading involves significant financial risk. Do not trade with funds you cannot afford to lose. This plugin does not provide financial advice.**

**Developed by Tony (AI Agent) under supervision of Anton Poroshin**
**Studio:** https://github.com/xlabtg

## Architecture

This plugin follows the Teleton tool-provider pattern:

- **Plugin = atomic tools** (fetch data, validate, simulate, execute)
- **Agent = strategy** (when to buy, when to sell, how much)

Each tool does exactly one thing. The LLM composes them:

```
1. ton_trading_get_market_data   → see current prices and DEX quotes
2. ton_trading_get_portfolio     → see wallet balance and open positions
3. ton_trading_validate_trade    → check risk before acting
4. ton_trading_simulate_trade    → paper-trade without real funds
5. ton_trading_execute_swap      → execute a real DEX swap (DM-only)
6. ton_trading_record_trade      → close a trade and log PnL
```

## Tools

| Tool | Description | Category |
|------|-------------|----------|
| `ton_trading_get_market_data` | Fetch TON price and DEX swap quotes for a pair | data-bearing |
| `ton_trading_get_portfolio` | Wallet balance, jetton holdings, trade history | data-bearing |
| `ton_trading_validate_trade` | Check balance and risk limits before a trade | data-bearing |
| `ton_trading_simulate_trade` | Paper-trade using virtual balance (no real funds) | action |
| `ton_trading_execute_swap` | Execute a real swap on STON.fi or DeDust (DM-only) | action |
| `ton_trading_record_trade` | Close a trade and record final output / PnL | action |

## Installation

```bash
mkdir -p ~/.teleton/plugins
cp -r plugins/ton-trading-bot ~/.teleton/plugins/
```

## Configuration

```yaml
# ~/.teleton/config.yaml
plugins:
  ton-trading-bot:
    maxTradePercent: 10        # max single trade as % of balance (default: 10)
    minBalanceTON: 1           # minimum TON to keep (default: 1)
    defaultSlippage: 0.05      # DEX slippage tolerance (default: 5%)
    simulationBalance: 1000    # starting virtual balance (default: 1000 TON)
```

## Usage Examples

### Check the market

```
Get market data for swapping 1 TON to EQCxE6...
```

### Paper-trade workflow

```
1. Get market data for TON → USDT
2. Validate trading 5 TON in simulation mode
3. Simulate buying USDT with 5 TON
4. [later] Record the simulated trade closed at price X
```

### Real swap workflow (DM only)

```
1. Get portfolio overview
2. Get market data for TON → USDT pair
3. Validate trading 2 TON in real mode
4. Execute swap: 2 TON → USDT with 5% slippage
5. [later] Record trade closed
```

## Risk Management

Risk parameters are enforced by `ton_trading_validate_trade` before any trade:

- **maxTradePercent** (default 10%) — no single trade can exceed this percentage of the balance
- **minBalanceTON** (default 1 TON) — trading blocked if balance falls below this floor
- **scope: dm-only** on `ton_trading_execute_swap` — real trades only in direct messages

The LLM reads the validation result and decides whether to proceed.

## Database Tables

- `trade_journal` — every executed and simulated trade with PnL
- `sim_balance` — virtual balance history for paper trading

## Legal Disclaimer

**THIS PLUGIN IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. THE DEVELOPERS DO NOT PROVIDE FINANCIAL ADVICE. CRYPTOCURRENCY TRADING IS HIGHLY VOLATILE AND RISKY. YOU ARE RESPONSIBLE FOR YOUR OWN FINANCIAL DECISIONS. USE THIS TOOL AT YOUR OWN RISK.**

---

**Developed by:** Tony (AI Agent)
**Supervisor:** Anton Poroshin
**Studio:** https://github.com/xlabtg
