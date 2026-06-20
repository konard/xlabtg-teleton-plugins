/**
 * The 10 LLM tools exposed by the polymarket plugin.
 *
 * Every tool returns the plugin contract { success, data? , error? }. Money-
 * moving tools (place_order, deposit, withdraw) enforce hard limits from the
 * resolved config and a two-step confirmation above a configurable threshold.
 */

import { ok, fail, toNumber } from "./util.js";
import { baseUnitsToUsdc, usdcToBaseUnits } from "./evm-rpc.js";

const TON = "ton";
const USDC = "usdc";

/** Wrap a handler in the success/error contract with sanitised errors. */
function createTool(sdk, definition, handler) {
  return {
    category: "data-bearing",
    ...definition,
    execute: async (params = {}, context = {}) => {
      try {
        return ok(await handler(params, context));
      } catch (err) {
        const result = fail(err);
        sdk?.log?.warn?.(`${definition.name} failed: ${result.error}`);
        return result;
      }
    },
  };
}

function requirePositive(value, label) {
  const n = toNumber(value);
  if (n === undefined || n <= 0) throw new Error(`${label} must be a positive number`);
  return n;
}

export function buildTools(runtime) {
  const sdk = runtime.sdk;
  const cfg = runtime.config;

  return [
    // ── 1. Market discovery ────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_list_markets",
        description:
          "List active Polymarket prediction markets ordered by volume. Optionally filter by tag (e.g. politics, crypto, sports).",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max markets to return (1-100, default 20)." },
            tag: { type: "string", description: "Optional tag slug filter." },
            active: { type: "boolean", description: "Only active markets (default true)." },
            closed: { type: "boolean", description: "Include closed markets (default false)." },
          },
        },
      },
      async (p) => {
        const markets = await runtime.markets.listMarkets({
          limit: p.limit,
          tag: p.tag,
          active: p.active ?? true,
          closed: p.closed ?? false,
        });
        return { count: markets.length, markets };
      }
    ),

    // ── 2. Single market ───────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_get_market",
        description: "Get a single Polymarket market by its slug, including outcomes, prices, and CLOB token ids.",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Market slug, e.g. will-btc-hit-100k." },
          },
          required: ["slug"],
        },
      },
      async (p) => {
        if (!p.slug) throw new Error("slug is required");
        const market = await runtime.markets.getMarket(p.slug);
        if (!market) throw new Error(`Market not found for slug "${p.slug}"`);
        return market;
      }
    ),

    // ── 3. Order book ──────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_get_orderbook",
        description:
          "Get the live CLOB order book (bids/asks) for an outcome token. Provide either token_id directly, or market slug + outcome.",
        parameters: {
          type: "object",
          properties: {
            token_id: { type: "string", description: "CLOB outcome token id." },
            slug: { type: "string", description: "Market slug (used with outcome to resolve token_id)." },
            outcome: { type: "string", description: 'Outcome name, e.g. "Yes" or "No".' },
          },
        },
      },
      async (p) => {
        const tokenId = await resolveTokenId(runtime, p);
        const book = await runtime.clobPublic().getOrderbook(tokenId);
        return { token_id: tokenId, book };
      }
    ),

    // ── 4. Place order ─────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_place_order",
        description:
          "Place a limit order on a Polymarket outcome. Provide token_id (or slug+outcome), side (BUY/SELL), price (0-1), and size (shares). " +
          "Orders whose notional (price*size) exceeds the confirmation threshold require confirm=true.",
        category: "action",
        scope: "dm-only",
        parameters: {
          type: "object",
          properties: {
            token_id: { type: "string", description: "CLOB outcome token id." },
            slug: { type: "string", description: "Market slug (with outcome to resolve token_id)." },
            outcome: { type: "string", description: 'Outcome name, e.g. "Yes".' },
            side: { type: "string", enum: ["BUY", "SELL", "buy", "sell"] },
            price: { type: "number", description: "Limit price between 0 and 1." },
            size: { type: "number", description: "Order size in outcome shares." },
            order_type: { type: "string", enum: ["GTC", "FOK", "GTD"], description: "Default GTC." },
            confirm: { type: "boolean", description: "Set true to confirm a large order." },
          },
          required: ["side", "price", "size"],
        },
      },
      async (p) => {
        const side = String(p.side || "").toUpperCase();
        if (side !== "BUY" && side !== "SELL") throw new Error('side must be "BUY" or "SELL"');
        const price = requirePositive(p.price, "price");
        if (price >= 1) throw new Error("price must be between 0 and 1");
        const size = requirePositive(p.size, "size");
        const notional = price * size;

        if (notional > cfg.max_order_usdc) {
          throw new Error(
            `Order notional ${notional.toFixed(2)} USDC exceeds max_order_usdc limit ${cfg.max_order_usdc}`
          );
        }

        const tokenId = await resolveTokenId(runtime, p);

        if (notional > cfg.require_confirmation_above_usdc && p.confirm !== true) {
          return {
            confirmation_required: true,
            message: `This order is worth ${notional.toFixed(2)} USDC. Re-run with confirm=true to place it.`,
            preview: { token_id: tokenId, side, price, size, notional_usdc: notional },
          };
        }

        const clob = await runtime.clob();
        const creds = await runtime.creds();
        const data = await clob.placeOrder({
          tokenId,
          side,
          price,
          size,
          orderType: p.order_type || "GTC",
          creds,
        });
        const orderId = data?.orderID ?? data?.orderId ?? data?.id ?? null;
        if (orderId) {
          runtime.store.recordOrder({
            orderId,
            tokenId,
            marketSlug: p.slug ?? null,
            side,
            price,
            size,
            status: "open",
          });
        }
        return { order_id: orderId, side, price, size, notional_usdc: notional, raw: data };
      }
    ),

    // ── 5. Cancel order ────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_cancel_order",
        description: "Cancel an open Polymarket order by its order id.",
        category: "action",
        scope: "dm-only",
        parameters: {
          type: "object",
          properties: {
            order_id: { type: "string", description: "Order id to cancel." },
          },
          required: ["order_id"],
        },
      },
      async (p) => {
        if (!p.order_id) throw new Error("order_id is required");
        const clob = await runtime.clob();
        const creds = await runtime.creds();
        const data = await clob.cancelOrder({ orderId: p.order_id, creds });
        runtime.store.updateOrderStatus(p.order_id, "cancelled");
        return { order_id: p.order_id, cancelled: true, raw: data };
      }
    ),

    // ── 6. Positions ───────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_get_positions",
        description: "Get current Polymarket positions held by the plugin's EVM wallet.",
        parameters: { type: "object", properties: {} },
      },
      async () => {
        const wallet = await runtime.wallet();
        const positions = await runtime.clobPublic().getPositions(wallet.address);
        return { address: wallet.address, positions };
      }
    ),

    // ── 7. Balance ─────────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_get_balance",
        description:
          "Get the trading balance: USDC on Polygon held by the plugin's EVM wallet plus the linked TON wallet balance.",
        parameters: { type: "object", properties: {} },
      },
      async () => {
        const wallet = await runtime.wallet();
        const usdcUnits = await runtime.rpc.getUsdcBalance(wallet.address);
        let tonBalance = null;
        try {
          tonBalance = await sdk.ton?.getBalance?.();
        } catch {
          tonBalance = null;
        }
        return {
          evm_address: wallet.address,
          usdc_polygon: baseUnitsToUsdc(usdcUnits),
          ton_address: sdk.ton?.getAddress?.() ?? null,
          ton_balance: tonBalance,
        };
      }
    ),

    // ── 8. Deposit (TON → USDC Polygon) ────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_deposit",
        description:
          "Bridge TON to USDC on Polygon (into the plugin's EVM wallet) via ChangeNOW, funding Polymarket trading. " +
          "Requires confirm=true to actually send TON.",
        category: "action",
        scope: "dm-only",
        parameters: {
          type: "object",
          properties: {
            amount_ton: { type: "number", description: "Amount of TON to bridge." },
            confirm: { type: "boolean", description: "Set true to execute the swap and send TON." },
          },
          required: ["amount_ton"],
        },
      },
      async (p) => {
        const amountTon = requirePositive(p.amount_ton, "amount_ton");
        if (amountTon > cfg.max_swap_ton) {
          throw new Error(`amount_ton ${amountTon} exceeds max_swap_ton limit ${cfg.max_swap_ton}`);
        }

        const wallet = await runtime.wallet();
        const bridge = await runtime.bridge();
        const pair = {
          fromCurrency: TON,
          toCurrency: USDC,
          fromNetwork: cfg.changenow_from_network,
          toNetwork: cfg.changenow_to_network,
        };

        const min = await bridge.minAmount(pair);
        const minAmount = toNumber(min?.minAmount);
        if (minAmount !== undefined && amountTon < minAmount) {
          throw new Error(`amount_ton ${amountTon} is below ChangeNOW minimum ${minAmount}`);
        }

        const est = await bridge.estimate({ ...pair, fromAmount: amountTon });
        const estimatedUsdc = toNumber(est?.toAmount ?? est?.estimatedAmount);

        if (p.confirm !== true) {
          return {
            confirmation_required: true,
            message: `Bridging ${amountTon} TON ≈ ${estimatedUsdc ?? "?"} USDC to ${wallet.address}. Re-run with confirm=true.`,
            preview: { amount_ton: amountTon, estimated_usdc: estimatedUsdc, min_amount: minAmount, destination: wallet.address },
          };
        }

        const tonAddress = sdk.ton?.getAddress?.() ?? null;
        const swap = await bridge.createExchange({
          ...pair,
          fromAmount: amountTon,
          address: wallet.address,
          refundAddress: tonAddress ?? undefined,
        });

        const payinAddress = swap?.payinAddress;
        if (!payinAddress) throw new Error("ChangeNOW did not return a payin address");

        // Send TON to the bridge payin address (the memo/tag, if any, must be included).
        const sendResult = await sdk.ton.sendTON(payinAddress, amountTon, swap?.payinExtraId || undefined);

        runtime.store.recordSwap({
          id: swap.id,
          direction: "deposit",
          status: "sent",
          fromCurrency: TON,
          toCurrency: USDC,
          amount: amountTon,
          address: wallet.address,
          payinAddress,
          tonTxRef: sendResult?.txRef ?? null,
          raw: swap,
        });

        return {
          swap_id: swap.id,
          status: "sent",
          amount_ton: amountTon,
          estimated_usdc: estimatedUsdc,
          payin_address: payinAddress,
          destination: wallet.address,
          ton_tx_ref: sendResult?.txRef ?? null,
        };
      }
    ),

    // ── 9. Withdraw (USDC Polygon → TON) ───────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_withdraw",
        description:
          "Bridge USDC on Polygon (from the plugin's EVM wallet) back to TON via ChangeNOW. Requires MATIC for gas and confirm=true.",
        category: "action",
        scope: "dm-only",
        parameters: {
          type: "object",
          properties: {
            amount_usdc: { type: "number", description: "Amount of USDC to withdraw." },
            ton_address: { type: "string", description: "Destination TON address (default: linked TON wallet)." },
            confirm: { type: "boolean", description: "Set true to execute the on-chain transfer + swap." },
          },
          required: ["amount_usdc"],
        },
      },
      async (p) => {
        const amountUsdc = requirePositive(p.amount_usdc, "amount_usdc");
        const tonAddress = p.ton_address || sdk.ton?.getAddress?.();
        if (!tonAddress) throw new Error("ton_address is required (no linked TON wallet found)");

        const wallet = await runtime.wallet();
        const units = usdcToBaseUnits(amountUsdc);
        const balanceUnits = await runtime.rpc.getUsdcBalance(wallet.address);
        if (units > balanceUnits) {
          throw new Error(
            `Insufficient USDC: requested ${amountUsdc}, available ${baseUnitsToUsdc(balanceUnits)}`
          );
        }

        const bridge = await runtime.bridge();
        const pair = {
          fromCurrency: USDC,
          toCurrency: TON,
          fromNetwork: cfg.changenow_to_network, // USDC lives on Polygon (matic)
          toNetwork: cfg.changenow_from_network, // payout in TON
        };
        const est = await bridge.estimate({ ...pair, fromAmount: amountUsdc });
        const estimatedTon = toNumber(est?.toAmount ?? est?.estimatedAmount);

        if (amountUsdc > cfg.require_confirmation_above_usdc && p.confirm !== true) {
          return {
            confirmation_required: true,
            message: `Withdrawing ${amountUsdc} USDC ≈ ${estimatedTon ?? "?"} TON to ${tonAddress}. Re-run with confirm=true.`,
            preview: { amount_usdc: amountUsdc, estimated_ton: estimatedTon, destination: tonAddress },
          };
        }
        if (p.confirm !== true) {
          return {
            confirmation_required: true,
            message: `Re-run with confirm=true to withdraw ${amountUsdc} USDC to ${tonAddress}.`,
            preview: { amount_usdc: amountUsdc, estimated_ton: estimatedTon, destination: tonAddress },
          };
        }

        const swap = await bridge.createExchange({
          ...pair,
          fromAmount: amountUsdc,
          address: tonAddress,
          refundAddress: wallet.address,
        });
        const payinAddress = swap?.payinAddress;
        if (!payinAddress) throw new Error("ChangeNOW did not return a payin address");

        // Broadcast the ERC-20 USDC transfer to the bridge payin address.
        const txHash = await sendUsdc(runtime, wallet, payinAddress, units);

        runtime.store.recordSwap({
          id: swap.id,
          direction: "withdraw",
          status: "sent",
          fromCurrency: USDC,
          toCurrency: TON,
          amount: amountUsdc,
          address: tonAddress,
          payinAddress,
          tonTxRef: txHash,
          raw: swap,
        });

        return {
          swap_id: swap.id,
          status: "sent",
          amount_usdc: amountUsdc,
          estimated_ton: estimatedTon,
          payin_address: payinAddress,
          destination: tonAddress,
          polygon_tx: txHash,
        };
      }
    ),

    // ── 10. Swap status ────────────────────────────────────────────────────
    createTool(
      sdk,
      {
        name: "polymarket_swap_status",
        description: "Check the status of a ChangeNOW bridge swap (deposit or withdraw) by its swap id.",
        parameters: {
          type: "object",
          properties: {
            swap_id: { type: "string", description: "ChangeNOW swap id returned by deposit/withdraw." },
          },
          required: ["swap_id"],
        },
      },
      async (p) => {
        if (!p.swap_id) throw new Error("swap_id is required");
        const bridge = await runtime.bridge();
        const status = await bridge.getStatus(p.swap_id);
        const statusStr = status?.status ?? "unknown";
        runtime.store.updateSwapStatus(p.swap_id, statusStr, status);
        const local = runtime.store.getSwap(p.swap_id);
        return {
          swap_id: p.swap_id,
          status: statusStr,
          from: status?.fromCurrency ?? local?.from_currency ?? null,
          to: status?.toCurrency ?? local?.to_currency ?? null,
          amount_received: status?.amountReceive ?? null,
          payout_hash: status?.payoutHash ?? null,
          raw: status,
        };
      }
    ),
  ];
}

/** Resolve an outcome token id from either token_id or slug+outcome. */
async function resolveTokenId(runtime, p) {
  if (p.token_id) return String(p.token_id);
  if (p.slug && p.outcome) {
    const resolved = await runtime.markets.resolveToken(p.slug, p.outcome);
    return resolved.tokenId;
  }
  throw new Error("Provide token_id, or slug + outcome");
}

/** Sign and broadcast an ERC-20 USDC transfer on Polygon. */
async function sendUsdc(runtime, wallet, to, amountUnits) {
  const rpc = runtime.rpc;
  const [nonce, gasPrice] = await Promise.all([
    rpc.getTransactionCount(wallet.address),
    rpc.getGasPrice(),
  ]);
  const maxPriorityFeePerGas = gasPrice > 0n ? gasPrice : 30_000_000_000n; // 30 gwei fallback
  const maxFeePerGas = (gasPrice > 0n ? gasPrice : 30_000_000_000n) * 2n;
  const raw = wallet.signTransaction({
    chainId: rpc.chainId,
    nonce,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit: 120_000n,
    to: runtime.endpoints.usdcAddress,
    value: 0n,
    data: rpc.buildTransferData(to, amountUnits),
  });
  return rpc.sendRawTransaction(raw);
}
