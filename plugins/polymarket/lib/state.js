/**
 * Persistence layer over the plugin's isolated SQLite database (sdk.db).
 *
 * Tracks bridge swaps (deposit / withdraw) and placed orders so the agent can
 * poll status later. All methods are null-safe: if the host didn't provision a
 * database, they degrade gracefully instead of throwing.
 */

export const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS polymarket_swaps (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    from_currency TEXT,
    to_currency TEXT,
    amount TEXT,
    address TEXT,
    payin_address TEXT,
    ton_tx_ref TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    raw TEXT
  );

  CREATE TABLE IF NOT EXISTS polymarket_orders (
    order_id TEXT PRIMARY KEY,
    token_id TEXT,
    market_slug TEXT,
    side TEXT,
    price REAL,
    size REAL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export class Store {
  /** @param {object|null} db better-sqlite3 instance or null */
  constructor(db) {
    this.db = db ?? null;
  }

  get enabled() {
    return this.db !== null;
  }

  recordSwap(swap) {
    if (!this.enabled) return;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO polymarket_swaps
         (id, direction, status, from_currency, to_currency, amount, address, payin_address, ton_tx_ref, created_at, updated_at, raw)
         VALUES (@id, @direction, @status, @from_currency, @to_currency, @amount, @address, @payin_address, @ton_tx_ref, @created_at, @updated_at, @raw)`
      )
      .run({
        id: swap.id,
        direction: swap.direction,
        status: swap.status ?? "pending",
        from_currency: swap.fromCurrency ?? null,
        to_currency: swap.toCurrency ?? null,
        amount: swap.amount != null ? String(swap.amount) : null,
        address: swap.address ?? null,
        payin_address: swap.payinAddress ?? null,
        ton_tx_ref: swap.tonTxRef ?? null,
        created_at: now,
        updated_at: now,
        raw: swap.raw ? JSON.stringify(swap.raw) : null,
      });
  }

  updateSwapStatus(id, status, raw) {
    if (!this.enabled) return;
    this.db
      .prepare(
        `UPDATE polymarket_swaps SET status = ?, updated_at = ?, raw = COALESCE(?, raw) WHERE id = ?`
      )
      .run(status, Date.now(), raw ? JSON.stringify(raw) : null, id);
  }

  getSwap(id) {
    if (!this.enabled) return null;
    return this.db.prepare(`SELECT * FROM polymarket_swaps WHERE id = ?`).get(id) ?? null;
  }

  listSwaps(limit = 50) {
    if (!this.enabled) return [];
    return this.db
      .prepare(`SELECT * FROM polymarket_swaps ORDER BY created_at DESC LIMIT ?`)
      .all(Math.max(1, Math.min(200, limit)));
  }

  recordOrder(order) {
    if (!this.enabled) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO polymarket_orders
         (order_id, token_id, market_slug, side, price, size, status, created_at)
         VALUES (@order_id, @token_id, @market_slug, @side, @price, @size, @status, @created_at)`
      )
      .run({
        order_id: order.orderId,
        token_id: order.tokenId ?? null,
        market_slug: order.marketSlug ?? null,
        side: order.side ?? null,
        price: order.price ?? null,
        size: order.size ?? null,
        status: order.status ?? "open",
        created_at: Date.now(),
      });
  }

  updateOrderStatus(orderId, status) {
    if (!this.enabled) return;
    this.db
      .prepare(`UPDATE polymarket_orders SET status = ? WHERE order_id = ?`)
      .run(status, orderId);
  }
}
