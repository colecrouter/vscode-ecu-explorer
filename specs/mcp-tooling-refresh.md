# MCP Tooling Refresh Specification

## Overview

This specification refines the ECU Explorer MCP surface so the tools more closely match real tuning workflows and are easier for LLMs to use reliably.

This spec supersedes the relevant portions of [`specs/mcp-server.md`](./mcp-server.md) for:

- log discovery and inspection
- table discovery and selection
- table read/patch targeting
- open-documents context exposure
- query/selector syntax exposure
- ROM cache behavior

## Goals

1. Make discovery tools distinct from inspection tools.
2. Replace index-oriented table targeting with value-oriented targeting.
3. Reuse one query/selector model across logs and tables.
4. Expose enough schema/context to let an agent discover valid fields before using `where`.
5. Keep outputs concise and operationally useful.

## Non-Goals

1. This spec does not add domain-specific "smart tuning" tools such as MAF auto-tuning.
2. This spec does not add live closed-loop tuning or direct ECU write workflows through MCP.
3. This spec does not define default "important channels" for logs.

## High-Level Changes

### Tool Roles

| Tool | Role |
|---|---|
| `read_log` | Inspect a single selected log file |
| `list_logs` | Discover log files and their metadata |
| `list_tables` | Discover tables and their metadata |
| `read_table` | Read a full table or selected slice |
| `patch_table` | Modify a full table or selected slice |

### Design Rules

1. `list_*` tools are discovery tools.
2. `read_*` tools are inspection tools.
3. `where` is the single selector/filter field everywhere it appears.
4. Table selection is value-based using real axis names, not row/column indices.
5. When schema/context is empty, omit it from MCP resources rather than returning empty noise.

## Shared Query / Selector Syntax

### Purpose

The same expression model SHALL be reused for:

- `read_log.where`
- `read_table.where`
- `patch_table.where`

The implementation SHALL use a shared rewrite/alias utility so field names with spaces or punctuation can be used directly in expressions.

### Supported Operators

- equality: `==`, `!=`
- comparisons: `>`, `>=`, `<`, `<=`
- boolean: `&&`, `||`
- grouping: `(`
- grouping close: `)`

### Supported Values

- numeric literals only
- field names exposed by the relevant tool output

### Field Name Handling

Expressions SHALL accept field names exactly as exposed to the agent, even when names contain spaces, parentheses, slashes, or other punctuation.

Examples:

```text
Engine RPM > 3000 && Knock Sum > 0
RPM (rpm) >= 3000 && Load (g/rev) <= 2.0
Coolant Temp (C) >= 60 && Coolant Temp (C) <= 90
```

The parser implementation SHALL rewrite exposed field names to safe internal identifiers before evaluation.

### Error Handling

If an expression references an unknown field, the tool SHALL return:

- the unknown field name(s)
- the available field names
- close matches when practical

## Query Syntax Resource

A new MCP resource SHALL be added:

- `ecu-explorer://docs/query-syntax`

The resource SHALL document:

- supported operators
- field-name matching rules
- log examples
- table examples
- exact-match behavior for table equality selectors

This resource is the canonical MCP-visible reference for query/selector syntax.

## `list_logs`

### Purpose

`list_logs` is a discovery tool. It helps an agent find the right log file before inspecting its contents.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Free-text / metadata query across log metadata and channel metadata |
| `page` | `number` | No | 1-based page number |
| `page_size` | `number` | No | Maximum rows to return per page |

### Query Scope

`list_logs.query` SHALL only search metadata-level information:

- filename
- channel names
- date/time metadata
- duration
- row count
- sample rate

It SHALL NOT search row telemetry values or row conditions such as `RPM > 3000`.

### Output

YAML frontmatter plus a markdown table.

Frontmatter SHALL include:

- `logs_dir`
- `total_files`
- `page`
- `page_size`
- `total_pages`

Markdown table columns SHALL include:

- `#`
- `filename`
- `date`
- `duration_s`
- `rows`
- `sample_rate_hz`
- `channels`

### Notes

Pagination belongs here because discovery lists can be long.

## `read_log`

### Purpose

`read_log` inspects one selected log file.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | `string` | Yes | Filename from `list_logs` or an explicit path to a supported log file |
| `where` | `string` | No | Row filter expression using fields from the selected log |
| `channels` | `string[]` | No | Restrict returned columns to the listed channels |
| `start_s` | `number` | No | Start time in seconds |
| `end_s` | `number` | No | End time in seconds |
| `before_ms` | `number` | No | Include this much context before each match |
| `after_ms` | `number` | No | Include this much context after each match |
| `step_ms` | `number` | No | Return at most one row every N milliseconds; no averaging |

### Behavior

#### Schema / Detail Mode

When `read_log` is called with only `file`, it SHALL return log schema/details instead of rows.

The response SHALL include:

- available channels
- units
- row count
- duration
- sample rate
- time column name if present

This is the authoritative source of valid field names for `read_log.where`.

If `file` resolves outside the configured `logs_dir`, `read_log` SHALL still inspect the file but SHALL include a warning in the output noting that `list_logs` only discovers files under the configured logs directory.

#### Row Mode

When additional inputs are provided, `read_log` SHALL return rows from the selected file only.

Semantics:

1. select candidate rows using `where` and/or `start_s` / `end_s`
2. expand windows using `before_ms` / `after_ms` if present
3. merge overlapping windows
4. apply `step_ms` last

`step_ms` SHALL mean thinning by time spacing only. It SHALL NOT average, resample, or aggregate values.

### Output

Row mode SHALL return YAML frontmatter plus a markdown table.

Frontmatter SHALL include:

- `file`
- `rows_returned`
- `time_range_s`
- `channels`

If no rows match, the tool SHALL still return metadata and an explicit empty-result message.

## `list_tables`

### Purpose

`list_tables` is a discovery tool. It helps an agent find relevant tables without guessing categories.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | ROM path |
| `definition` | `string` | No | Optional explicit definition path |
| `query` | `string` | No | Free-text / metadata query |
| `page` | `number` | No | 1-based page number |
| `page_size` | `number` | No | Maximum rows to return per page |

### Query Scope

`list_tables.query` SHALL search table metadata:

- table name
- category
- dimensions
- unit
- axis names

Dedicated category-guessing SHALL no longer be the primary discovery mechanism.

### Output

YAML frontmatter plus a markdown table.

Frontmatter SHALL include:

- `rom`
- `definition`
- `total_tables`
- `page`
- `page_size`
- `total_pages`

Markdown table columns SHALL include:

- `name`
- `category`
- `dimensions`
- `unit`
- `x_axis`
- `y_axis` when applicable

Including axes is required so the agent can transition directly into `read_table.where`.

## `read_table`

### Purpose

`read_table` reads a full table or a selected slice.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | ROM path |
| `definition` | `string` | No | Optional explicit definition path |
| `table` | `string` | Yes | Table name from `list_tables` |
| `where` | `string` | No | Selector expression using the table's real axis names |

### Behavior

- omit `where` => return full table
- provide `where` => return the smallest slice that contains all matched cells

Examples:

```text
RPM (rpm) == 4000 && Load (g/rev) == 1.8
Load (g/rev) == 2.0
RPM (rpm) >= 3000 && RPM (rpm) <= 5000 && Load (g/rev) >= 1.6 && Load (g/rev) <= 2.2
Coolant Temp (C) >= 60 && Coolant Temp (C) <= 90
```

### Output

Frontmatter SHALL include:

- `table`
- `category`
- `unit`
- `dimensions`
- `x_axis`
- `y_axis` when applicable
- `selector_axes`

`selector_axes` SHALL list the exact axis names valid for `where`.

The markdown output SHALL be:

- the full table when `where` is omitted
- the matching slice when `where` is present

## `patch_table`

### Purpose

`patch_table` modifies a full table or selected slice using the same selector model as `read_table`.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | ROM path |
| `definition` | `string` | No | Optional explicit definition path |
| `table` | `string` | Yes | Table name from `list_tables` |
| `op` | `"set" \| "add" \| "multiply" \| "clamp" \| "smooth"` | Yes | Operation to apply |
| `value` | `number` | Conditional | Required for `set`, `add`, `multiply` |
| `min` | `number` | Conditional | Required for `clamp` |
| `max` | `number` | Conditional | Required for `clamp` |
| `where` | `string` | No | Selector expression using the table's real axis names |

### Targeting Model

`patch_table` SHALL no longer expose row/column indices in the MCP surface.

Selection rules:

- omit `where` => whole table
- equality selectors match exact axis breakpoint values only
- range selectors match all cells whose breakpoints fall within the range

If equality selectors do not match an axis breakpoint exactly, the tool SHALL return nearby breakpoint suggestions.

### Output

The output SHALL be concise.

Return:

- compact frontmatter summary
- affected slice after the patch

The default response SHALL NOT dump a verbose per-cell diff or the whole table unless the whole table was affected.

Frontmatter SHALL include:

- `table`
- `op`
- `cells_changed`
- `where` when provided

### Notes

The tool SHALL continue to:

- update checksum automatically when supported
- write atomically to disk
- return values in physical units

## Open Documents Context Resource

The existing open-documents context resource SHALL remain, but it SHALL be tightened to avoid empty noise.

### Required Behavior

- omit empty sections rather than returning empty arrays or empty objects when there is no relevant ROM/table context
- include active/focused state when available
- include dirty/saved state for open ROMs
- include recently focused tables/ROMs when available

If the user is not editing a ROM or table, the resource SHOULD remain minimal.

Current implementation status:

- empty `roms` / `tables` sections are omitted from the MCP resource payload
- ROM dirty state is included
- focus timestamps are included when the extension records them
- explicit boolean focused state is wired for ROM and table editors

## ROM Loader Cache

The ROM byte cache SHALL be removed.

Rationale:

- correctness matters more than read-speed here
- unsaved editor state already creates one consistency boundary
- removing cache eliminates stale on-disk ROM reads caused by process-global caching

Definition parsing remains the expensive operation worth optimizing separately.

## Tool Workflow Contract

The intended discovery/inspection flow is:

### Logs

1. `list_logs`
2. `read_log(file)` to learn available fields
3. `read_log(file, where=...)`

### Tables

1. `list_tables`
2. `read_table` to inspect a full table or slice and confirm selector axes
3. `patch_table(where=...)`

Tools SHALL still fail helpfully if the agent skips a step.

## Compatibility

`query_logs` is removed from the MCP surface. Agents must use `read_log`.

## Acceptance Criteria

1. A new MCP resource exists for query/selector syntax documentation.
2. `list_logs` supports metadata query plus pagination.
3. `query_logs` is removed and replaced by `read_log`.
4. `read_log(file)` returns log schema/details without requiring a separate tool.
5. `read_log` row output operates on a single selected file only.
6. `read_log` uses `step_ms` instead of `sample_rate`.
7. `list_tables` supports metadata query plus pagination.
8. `list_tables` includes axis names in its table rows.
9. `read_table` supports `where`.
10. `patch_table` supports `where`.
11. `patch_table` no longer exposes row/column index targeting in the public MCP surface.
12. Table selectors use exact exposed axis names, including names with spaces/punctuation.
13. Unknown fields in any `where` expression produce helpful errors with available fields and suggestions.
14. The open-documents context resource omits empty/no-op sections.
15. The ROM loader no longer caches ROM byte loads across MCP calls.
