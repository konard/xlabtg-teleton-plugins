/**
 * Memory Plugin — Persistent memory with advanced filtering
 *
 * Provides tag-based, entity-based, and composite-query memory storage and retrieval.
 * All entries are stored in an isolated SQLite database via sdk.db.
 *
 * Tools:
 *   memory_store   — Save a memory entry with optional tags and detected entities
 *   memory_search  — Search entries by tags, entity, date range, or free text
 *   memory_delete  — Delete a specific memory entry by ID
 *   memory_list_tags — List all tags in use with counts
 */

export const manifest = {
  name: "memory",
  version: "1.0.0",
  sdkVersion: ">=1.0.0",
  description: "Persistent memory with tag-based and entity-based advanced filtering",
};

// ─── Database Migration ────────────────────────────────────────────────────────

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      user_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_tags (
      entry_id INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      tag      TEXT    NOT NULL,
      PRIMARY KEY (entry_id, tag)
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      entry_id    INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
      entity_type TEXT    NOT NULL,
      entity_name TEXT    NOT NULL,
      PRIMARY KEY (entry_id, entity_type, entity_name)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory_entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag   ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_memory_entities   ON memory_entities(entity_name);
  `);
}

// ─── Entity Extraction ────────────────────────────────────────────────────────

/**
 * Extract entities from text using simple pattern matching.
 * Returns an array of { entity_type, entity_name } objects.
 */
function extractEntities(text) {
  const entities = [];
  const seen = new Set();

  const add = (type, name) => {
    const key = `${type}:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ entity_type: type, entity_name: name.toLowerCase() });
    }
  };

  // @mentions → people
  for (const m of text.matchAll(/@([\w.-]+)/g)) {
    add("person", m[1]);
  }

  // #hashtags → tags (also treated as entities for traversal)
  for (const m of text.matchAll(/#([\w-]+)/g)) {
    add("tag", m[1]);
  }

  // Domains (e.g. ton.org, github.com)
  for (const m of text.matchAll(/\b([\w-]+\.(org|com|io|net|app|dev|xyz|ton))\b/gi)) {
    add("domain", m[1].toLowerCase());
  }

  // Capitalized multi-word names (e.g. "Anton Petrov", "TON AI Agent")
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g)) {
    add("name", m[1]);
  }

  return entities;
}

// ─── Helper: parse tags from content and explicit list ───────────────────────

function parseTags(content, extraTags) {
  const tags = new Set();

  // Inline #hashtags from content
  for (const m of content.matchAll(/#([\w-]+)/g)) {
    tags.add(m[1].toLowerCase());
  }

  // Explicitly provided tags
  if (Array.isArray(extraTags)) {
    for (const t of extraTags) {
      if (typeof t === "string" && t.trim()) {
        tags.add(t.replace(/^#/, "").toLowerCase().trim());
      }
    }
  }

  return [...tags];
}

// ─── Helper: format entry for output ─────────────────────────────────────────

function formatEntry(entry, tags, entities) {
  return {
    id: entry.id,
    content: entry.content,
    created_at: new Date(entry.created_at * 1000).toISOString(),
    user_id: entry.user_id ?? null,
    tags: tags.map((r) => `#${r.tag}`),
    entities: entities.map((r) => ({ type: r.entity_type, name: r.entity_name })),
  };
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const tools = (sdk) => [
  // ── memory_store ──────────────────────────────────────────────────────────
  {
    name: "memory_store",
    description:
      "Save a memory entry with optional tags and auto-detected entities (people, projects, domains). " +
      "Tags can be inline (#work, #urgent) or passed via the tags parameter. " +
      "Use this whenever the user wants to remember something for later.",
    category: "action",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The text to remember. May include inline #tags and @mentions.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of tags to attach (e.g. [\"work\", \"urgent\"]). #prefix is optional.",
        },
      },
      required: ["content"],
    },
    execute: async (params, context) => {
      const { content, tags: extraTags } = params;
      if (!content || !content.trim()) {
        return { success: false, error: "content must not be empty" };
      }

      const userId = String(context.senderId ?? "");
      const allTags = parseTags(content, extraTags);
      const entities = extractEntities(content);

      const result = sdk.db
        .prepare(
          `INSERT INTO memory_entries (content, user_id) VALUES (?, ?)`
        )
        .run(content.trim(), userId || null);

      const entryId = result.lastInsertRowid;

      const insertTag = sdk.db.prepare(
        `INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)`
      );
      const insertEntity = sdk.db.prepare(
        `INSERT OR IGNORE INTO memory_entities (entry_id, entity_type, entity_name) VALUES (?, ?, ?)`
      );

      for (const tag of allTags) {
        insertTag.run(entryId, tag);
      }
      for (const { entity_type, entity_name } of entities) {
        insertEntity.run(entryId, entity_type, entity_name);
      }

      sdk.log.info(`memory_store: saved entry #${entryId} with ${allTags.length} tags, ${entities.length} entities`);

      return {
        success: true,
        data: {
          id: entryId,
          tags: allTags.map((t) => `#${t}`),
          entities: entities.map((e) => ({ type: e.entity_type, name: e.entity_name })),
          message: `Memory saved (id ${entryId})`,
        },
      };
    },
  },

  // ── memory_search ─────────────────────────────────────────────────────────
  {
    name: "memory_search",
    description:
      "Search saved memory entries with advanced filtering. " +
      "Supports: free text search, tag filter (one or more), entity filter (person/project/domain), " +
      "date range (start_date / end_date in YYYY-MM-DD), and result limit. " +
      "All filters are optional and can be combined (AND logic). " +
      "Examples: search({ tags: [\"work\"] }), search({ entity: \"anton\" }), " +
      "search({ query: \"TON\", start_date: \"2026-03-01\" })",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search within memory content (case-insensitive substring match).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter entries that have ALL of the specified tags.",
        },
        entity: {
          type: "string",
          description: "Filter entries mentioning this entity (person @mention, project name, domain, etc.).",
        },
        start_date: {
          type: "string",
          description: "Start of date range (YYYY-MM-DD), inclusive.",
        },
        end_date: {
          type: "string",
          description: "End of date range (YYYY-MM-DD), inclusive.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results to return (default 20, max 100).",
          minimum: 1,
          maximum: 100,
        },
      },
    },
    execute: async (params, _context) => {
      const {
        query,
        tags: filterTags,
        entity,
        start_date,
        end_date,
        limit = 20,
      } = params;

      const maxLimit = Math.min(Number(limit) || 20, 100);

      // Build the WHERE conditions
      const conditions = [];
      const bindings = [];

      if (query && query.trim()) {
        conditions.push(`e.content LIKE ?`);
        bindings.push(`%${query.trim()}%`);
      }

      if (start_date) {
        const ts = Math.floor(new Date(start_date).getTime() / 1000);
        if (!isNaN(ts)) {
          conditions.push(`e.created_at >= ?`);
          bindings.push(ts);
        }
      }

      if (end_date) {
        // end of that day
        const ts = Math.floor(new Date(`${end_date}T23:59:59Z`).getTime() / 1000);
        if (!isNaN(ts)) {
          conditions.push(`e.created_at <= ?`);
          bindings.push(ts);
        }
      }

      if (entity && entity.trim()) {
        const eName = entity.trim().replace(/^@/, "").toLowerCase();
        conditions.push(
          `e.id IN (SELECT entry_id FROM memory_entities WHERE entity_name LIKE ?)`
        );
        bindings.push(`%${eName}%`);
      }

      // Tag filtering: entry must have ALL requested tags
      const normalizedTags =
        Array.isArray(filterTags)
          ? filterTags.map((t) => t.replace(/^#/, "").toLowerCase().trim()).filter(Boolean)
          : [];

      for (const tag of normalizedTags) {
        conditions.push(
          `e.id IN (SELECT entry_id FROM memory_tags WHERE tag = ?)`
        );
        bindings.push(tag);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const entries = sdk.db
        .prepare(
          `SELECT e.id, e.content, e.created_at, e.user_id
           FROM memory_entries e
           ${whereClause}
           ORDER BY e.created_at DESC
           LIMIT ?`
        )
        .all(...bindings, maxLimit);

      if (entries.length === 0) {
        return {
          success: true,
          data: { results: [], count: 0, message: "No matching memory entries found." },
        };
      }

      // Fetch tags and entities for each entry
      const getTagsStmt = sdk.db.prepare(
        `SELECT tag FROM memory_tags WHERE entry_id = ?`
      );
      const getEntitiesStmt = sdk.db.prepare(
        `SELECT entity_type, entity_name FROM memory_entities WHERE entry_id = ?`
      );

      const results = entries.map((entry) => {
        const tags = getTagsStmt.all(entry.id);
        const entities = getEntitiesStmt.all(entry.id);
        return formatEntry(entry, tags, entities);
      });

      sdk.log.info(`memory_search: returned ${results.length} entries`);

      return {
        success: true,
        data: { results, count: results.length },
      };
    },
  },

  // ── memory_delete ─────────────────────────────────────────────────────────
  {
    name: "memory_delete",
    description:
      "Delete a specific memory entry by its ID. " +
      "Use memory_search first to find the entry ID. " +
      "Tags and entities associated with the entry are removed automatically.",
    category: "action",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "The ID of the memory entry to delete.",
        },
      },
      required: ["id"],
    },
    execute: async (params, _context) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id < 1) {
        return { success: false, error: "id must be a positive integer" };
      }

      const entry = sdk.db
        .prepare(`SELECT id FROM memory_entries WHERE id = ?`)
        .get(id);

      if (!entry) {
        return { success: false, error: `Memory entry #${id} not found` };
      }

      sdk.db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(id);

      sdk.log.info(`memory_delete: removed entry #${id}`);

      return {
        success: true,
        data: { message: `Memory entry #${id} deleted successfully.` },
      };
    },
  },

  // ── memory_list_tags ──────────────────────────────────────────────────────
  {
    name: "memory_list_tags",
    description:
      "List all tags currently in use across all memory entries, with usage counts. " +
      "Useful for discovering what tags exist before filtering with memory_search.",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (_params, _context) => {
      const rows = sdk.db
        .prepare(
          `SELECT tag, COUNT(*) AS count
           FROM memory_tags
           GROUP BY tag
           ORDER BY count DESC, tag ASC`
        )
        .all();

      const entities = sdk.db
        .prepare(
          `SELECT entity_type, entity_name, COUNT(*) AS count
           FROM memory_entities
           GROUP BY entity_type, entity_name
           ORDER BY count DESC, entity_name ASC
           LIMIT 50`
        )
        .all();

      return {
        success: true,
        data: {
          tags: rows.map((r) => ({ tag: `#${r.tag}`, count: r.count })),
          entities: entities.map((r) => ({
            type: r.entity_type,
            name: r.entity_name,
            count: r.count,
          })),
          tag_count: rows.length,
        },
      };
    },
  },
];
