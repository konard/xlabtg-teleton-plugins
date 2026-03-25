# Persistent Memory Plugin

Store and retrieve memory entries with advanced filtering: tags, entities, date ranges, and free text — composable in any combination.

## Tools

### `memory_store`
Save a text entry. Tags can be embedded inline (`#work`, `#urgent`) or passed explicitly. Entities (people, domains, names) are auto-extracted.

**Parameters:**
| Parameter | Type     | Required | Description |
|-----------|----------|----------|-------------|
| `content` | string   | Yes      | Text to remember. May include `#tags` and `@mentions`. |
| `tags`    | string[] | No       | Extra tags to attach (e.g. `["work", "urgent"]`). |

**Example:**
```
memory_store("Meeting with @anton about TON AI Agent #work #important")
```

---

### `memory_search`
Query entries with any combination of filters (all optional, AND logic).

**Parameters:**
| Parameter    | Type     | Description |
|--------------|----------|-------------|
| `query`      | string   | Free-text substring match in content. |
| `tags`       | string[] | Entry must have ALL listed tags. |
| `entity`     | string   | Substring match on any extracted entity (person, domain, name). |
| `start_date` | string   | From date, inclusive (`YYYY-MM-DD`). |
| `end_date`   | string   | To date, inclusive (`YYYY-MM-DD`). |
| `limit`      | integer  | Max results (default 20, max 100). |

**Examples:**
```
# Show all work entries from last month
memory_search({ tags: ["work"], start_date: "2026-03-01", end_date: "2026-03-31" })

# What did I learn about @anton?
memory_search({ entity: "anton" })

# All entries tagged #important from this week
memory_search({ tags: ["important"], start_date: "2026-03-18" })

# Full-text search across all entries
memory_search({ query: "TON AI Agent" })

# Composite query
memory_search({ query: "meeting", tags: ["work"], entity: "anton", start_date: "2026-03-01" })
```

---

### `memory_delete`
Delete a single entry by its ID (obtained from `memory_search` or `memory_store`).

**Parameters:**
| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `id`      | integer | Yes      | ID of the entry to delete. |

---

### `memory_list_tags`
List all tags currently in use, along with extracted entity names, sorted by frequency.

No parameters required.

---

## Entity Extraction

Entities are automatically detected from entry content:

| Pattern | Entity Type | Example |
|---------|-------------|---------|
| `@name` | `person`    | `@anton` → person `anton` |
| `#tag`  | `tag`       | `#work` → tag `work` |
| `domain.tld` | `domain` | `ton.org` → domain `ton.org` |
| `Capitalized Names` | `name` | `TON AI Agent` → name `ton ai agent` |

---

## Storage

This plugin uses an isolated SQLite database (`sdk.db`) with three tables:

- `memory_entries` — the main entries (content, timestamp, user)
- `memory_tags` — tag → entry mapping
- `memory_entities` — entity → entry mapping (type + name)

All data is scoped to the plugin and persists across sessions.
