# MCP Server Specification — ECU Explorer

> [!IMPORTANT]
> Tool contract details in this document are partially outdated.
> The current MCP surface is defined by [specs/mcp-tooling-refresh.md](./mcp-tooling-refresh.md).
> In particular: `query_logs` has been removed in favor of `read_log`, `list_tables` and `list_logs` are queryable/paginated discovery tools, and `read_table` / `patch_table` use value-based `where` selectors instead of public row/column targeting.

## Overview

The ECU Explorer MCP server exposes ROM calibration data and live-data logs to LLM agents. It enables AI-assisted ECU tuning workflows: reading and writing calibration tables, querying logged sensor data, and correlating table values with measured behavior.

The server runs as a standalone Node.js process. It accesses ROM data by reading files directly from disk (using the same definition-resolution logic as the extension) and reads log files from the configured logs directory. It does **not** require the VSCode extension to be running, but it does require a ROM file and a matched definition to be present on disk.

### Design Principles

1. **Minimal tools, maximum surface area** — combine related operations into single flexible tools.
2. **LLM-friendly output** — markdown tables for numeric grid data; YAML frontmatter for metadata.
3. **Concise descriptions** — tool descriptions are written to be token-efficient without sacrificing clarity.
4. **Common workflows first** — tools are shaped around the most frequent ECU tuning tasks.

---

## Configuration

The server is configured at startup via CLI arguments or environment variables — **not** per-tool parameters.

| CLI Argument | Environment Variable | `.vscode/settings.json` key | Description |
|---|---|---|---|
| `--definitions-path` | `ECU_DEFINITIONS_PATH` | `ecuExplorer.definitionsPath` | Path to ECUFlash XML definitions directory |
| `--logs-dir` | `ECU_LOGS_DIR` | `ecuExplorer.logsDir` | Path to log files directory |

**Resolution order**: CLI args → environment variables → `.vscode/settings.json`.

---

## Tool Reference

### 1. `list_tables`

**Description**: List calibration tables in a ROM. Supports metadata search and pagination. Call this first to discover table names and selector axes before reading or patching.

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | Absolute or workspace-relative path to the ROM binary |
| `query` | `string` | No | Metadata search across table name, category, dimensions, units, and axes |
| `page` | `number` | No | 1-based page number |
| `page_size` | `number` | No | Number of rows per page |

#### Output Format

YAML frontmatter with ROM metadata, followed by a markdown table listing all matching calibration tables.

**Columns**: `name`, `category`, `dimensions` (e.g. `16x16`), `unit`, `x_axis`, `y_axis`

```
---
rom: /path/to/rom.bin
definition: 56890009 2011 USDM Lancer Evolution X 5MT
table_count: 142
---

| Name                        | Category  | Dimensions | Unit    |
|-----------------------------|-----------|------------|---------|
| Injector Duty Cycle Base Map | Fuel      | 16x16      | ms      |
| Ignition Timing Base Map     | Ignition  | 20x18      | degrees |
| Boost Target                 | Boost     | 10x12      | psi     |
| Idle Speed Target            | Idle      | 1x8        | rpm     |
...
```

---

### 2. `read_table`

**Description**: Read a calibration table from a ROM. Returns axis breakpoints and cell values. Accepts an optional value-based `where` selector using the table axis names and returns the matching slice.

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | Absolute or workspace-relative path to the ROM binary |
| `table` | `string` | Yes | Exact table name (from `list_tables` output) |
| `where` | `string` | No | Selector expression using the table axis names, e.g. `RPM (rpm) >= 3000 && Load (g/rev) >= 1.6` |

#### Output Format

YAML frontmatter with table metadata, followed by a markdown table with axis breakpoints as headers.

**YAML frontmatter fields**:

| Field | Description |
|---|---|
| `table` | Table name |
| `category` | Table category |
| `unit` | Value unit |
| `dimensions` | e.g. `16x16` or `1x8` |
| `x_axis` | X-axis name and unit, e.g. `RPM (rpm)` |
| `y_axis` | Y-axis name and unit (2D tables only) |

**1D table** — two-column layout: `| axis_unit | value_unit |`

```
---
table: Idle Speed Target
category: Idle
unit: rpm
dimensions: 1x8
x_axis: Coolant Temp (C)
---

| Coolant Temp (C) | Idle Speed (rpm) |
|-----------------|-----------------|
| -20             | 1400            |
| -10             | 1300            |
| 0               | 1200            |
| 10              | 1100            |
| 20              | 1000            |
| 40              | 900             |
| 60              | 850             |
| 80              | 800             |
```

**2D table** — grid with `Y\X` corner cell, Y-axis breakpoints as row headers, X-axis breakpoints as column headers:

```
---
table: Injector Duty Cycle Base Map
category: Fuel
unit: ms
dimensions: 16x16
x_axis: RPM (rpm)
y_axis: Load (g/rev)
---

| Y\X  | 500  | 1000 | 1500 | 2000 | ...  |
|------|------|------|------|------|------|
| 0.10 | 1.23 | 1.45 | 1.67 | 1.89 | ...  |
| 0.20 | 2.34 | 2.56 | 2.78 | 3.00 | ...  |
| 0.40 | 3.45 | 3.67 | 3.89 | 4.11 | ...  |
...
```

This tool is **read-only** — use `patch_table` to modify values.

---

### 3. `patch_table`

**Description**: Apply a math operation to a calibration table and save to ROM. Returns the affected post-patch slice for verification. Targeting is value-based via an optional `where` selector using the table axis names.

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | Absolute or workspace-relative path to the ROM binary |
| `table` | `string` | Yes | Exact table name (from `list_tables` output) |
| `op` | `"set" \| "add" \| "multiply" \| "clamp" \| "smooth"` | Yes | Math operation to apply |
| `value` | `number` | Conditional | Required for `set`, `add`, `multiply` |
| `min` | `number` | Conditional | Required for `clamp` — lower bound |
| `max` | `number` | Conditional | Required for `clamp` — upper bound |
| `where` | `string` | No | Selector expression using the table axis names; omit to target the whole table |

#### Operations

| Operation | `value` | `min`/`max` | Description |
|---|---|---|---|
| `set` | Required | — | Replace cell(s) with `value` |
| `add` | Required | — | Add `value` to cell(s). Use a negative number to subtract. |
| `multiply` | Required | — | Multiply cell(s) by `value`. Use a value < 1 to divide. |
| `clamp` | — | Required | Clamp cell(s) to `[min, max]` |
| `smooth` | — | — | Box-filter average with neighbors. 2D tables only. No `value` needed. |

#### Targeting

Omit `where` to target the entire table. Provide a selector expression to target a cell, row, column, or rectangular region using axis values.

Examples:

- Single cell: `RPM (rpm) == 4000 && Load (g/rev) == 1.8`
- Row: `Load (g/rev) == 2.0`
- Column: `RPM (rpm) == 4500`
- Region: `RPM (rpm) >= 3000 && RPM (rpm) <= 5000 && Load (g/rev) >= 1.6 && Load (g/rev) <= 2.2`

#### Output Format

Same format as `read_table` — the updated table after the operation is applied. Verify the returned values before proceeding.

**Writes to ROM and updates checksum automatically.**

---

### 4. `rom_info`

**Description**: Get ROM metadata: matched definition, vehicle info, and checksum validity. Check `checksum_valid` before recommending a flash — a `false` value means the ROM has been modified without a checksum update (this should not happen if edits were made via `patch_table`).

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rom` | `string` | Yes | Absolute or workspace-relative path to the ROM binary |

#### Output Format

YAML document with ROM metadata.

| Field | Type | Description |
|---|---|---|
| `file` | `string` | Filename (basename only) |
| `size_kb` | `number` | File size in kilobytes |
| `definition` | `string \| null` | Matched definition name, or `null` if unrecognized |
| `vehicle` | `string \| null` | Vehicle description from definition, or `null` |
| `ecu_id` | `string \| null` | ECU identifier from definition, or `null` |
| `checksum_valid` | `boolean \| null` | `true` if checksum is correct, `false` if invalid, `null` if no checksum defined |
| `checksum_algorithm` | `string \| null` | Algorithm name (e.g. `mitsucan`), or `null` |

```yaml
file: rom.bin
size_kb: 1024
definition: 56890009 2011 USDM Lancer Evolution X 5MT
vehicle: 2011 Mitsubishi Lancer Evolution X 5MT
ecu_id: Renesas M32186F8
checksum_valid: true
checksum_algorithm: mitsucan
```

This tool reads from disk only — it does not reflect any unsaved in-memory state from the VSCode extension.

---

### 5. `list_logs`

**Description**: List available log files. Supports metadata search and pagination. Use this to discover the session you want before calling `read_log`.

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Metadata search across filename, date text, channels, duration, row count, and sample rate |
| `page` | `number` | No | 1-based page number |
| `page_size` | `number` | No | Number of rows per page |

#### Output Format

YAML frontmatter with directory metadata, followed by a markdown table of log files.

**YAML frontmatter fields**:

| Field | Description |
|---|---|
| `logs_dir` | Absolute path to the logs directory |
| `total_files` | Total number of log files found |

**Markdown table columns**: `#` (1-based recency index, 1 = most recent), `filename`, `date`, `duration_s`, `rows`, `sample_rate_hz`, `channels` (comma-separated list)

```
---
logs_dir: /path/to/logs
total_files: 12
---

| # | Filename                              | Date                | Duration (s) | Rows  | Sample Rate (Hz) | Channels                        |
|---|---------------------------------------|---------------------|-------------|-------|------------------|---------------------------------|
| 1 | log-2026-02-22T14-30-00-000Z.csv      | 2026-02-22 14:30 UTC | 45.2        | 4523  | 100              | RPM, Load, Knock, Throttle, MAP |
| 2 | log-2026-02-22T10-15-00-000Z.csv      | 2026-02-22 10:15 UTC | 120.5       | 12050 | 100              | RPM, Load, Knock, Throttle, MAP |
| 3 | log-2026-02-21T18-00-00-000Z.csv      | 2026-02-21 18:00 UTC | 30.1        | 3010  | 100              | RPM, Load                       |
...
```

---

### 6. `read_log`

**Description**: Read one selected log file. `read_log(file)` returns schema/details. Add `where` and optional range/window parameters to return a log slice. Field names come from the selected log’s schema.

#### Input Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | `string` | Yes | Filename from `list_logs` output |
| `where` | `string` | No | Row filter expression using channel names from `read_log(file)` |
| `channels` | `string[]` | No | Exact channels to include in row output |
| `start_s` | `number` | No | Start time in seconds |
| `end_s` | `number` | No | End time in seconds |
| `before_ms` | `number` | No | Expand matched rows backward into a continuous time window |
| `after_ms` | `number` | No | Expand matched rows forward into a continuous time window |
| `step_ms` | `number` | No | Keep at most one row every N milliseconds after selection |

#### Output Format

`read_log(file)` returns schema/details for the selected log. `read_log` with row-selection options returns YAML frontmatter plus a markdown table with `Time (s)` as the first column when a time field is available.

**YAML frontmatter fields**:

| Field | Description |
|---|---|
| `file` | Selected filename |
| `rows_returned` | Total rows returned in the slice |
| `time_range_s` | Start/end time for returned rows |
| `time_column` | Time field name, if available |
| `channels` | List of channel names in the output table |
| `where` | Selector expression used, or `null` |
| `referenced_fields` | Fields referenced in the selector |

```
---
file: log-2026-02-22T14-30-00-000Z.csv
rows_returned: 4
time_range_s: [0, 0.3]
time_column: Timestamp (ms)
channels: [RPM, Load, Knock]
where: RPM > 3000 && Knock > 0
referenced_fields: [RPM, Knock]
---

| Time (s) | RPM  | Load | Knock |
|----------|------|------|-------|
| 0.00     | 800  | 0.12 | 0.0   |
| 0.10     | 850  | 0.13 | 0.0   |
| 0.20     | 3120 | 0.45 | 0.0   |
| 0.30     | 4250 | 0.62 | 1.5   |
...
```

---

## Data Formats

### Table Output (`read_table` / `patch_table`)

Calibration tables are rendered as markdown tables because:
- Numeric grid data is naturally tabular
- LLMs can accurately read and reason about markdown tables
- Row/column headers provide axis context inline with values
- Markdown tables are compact and token-efficient

**YAML frontmatter** precedes every table output and contains: `table`, `category`, `unit`, `dimensions`, `x_axis`, and (for 2D tables) `y_axis`.

**1D table layout** — two columns: axis label with unit | value with unit:

```
| RPM (rpm) | Timing (°) |
|-----------|------------|
| 500       | 8.0        |
| 1000      | 12.0       |
| 2000      | 16.0       |
| 3000      | 20.0       |
```

**2D table layout** — `Y\X` corner cell, Y-axis breakpoints as row headers, X-axis breakpoints as column headers:

```
| Y\X  | 500  | 1000 | 1500 | ...  |
|------|------|------|------|------|
| 0.10 | 1.23 | 1.45 | 1.67 | ...  |
| 0.20 | 2.34 | 2.56 | 2.78 | ...  |
```

All values are in **physical units** (scaled, not raw binary). Table selection and patching use `where` expressions over the exposed axis names.

### Log Output (`read_log`)

```
---
file: log-2026-02-22T14-30-00-000Z.csv
rows_returned: 4
time_range_s: [0, 0.3]
time_column: Timestamp (ms)
channels: [RPM, Load, Knock]
where: RPM > 3000 && Knock > 0
referenced_fields: [RPM, Knock]
---

| Time (s) | RPM  | Load | Knock |
|----------|------|------|-------|
| 0.00     | 800  | 0.12 | 0.0   |
| 0.10     | 850  | 0.13 | 0.0   |
```

---

## System Prompt / Problem-Solving Framework

The following system prompt is recommended for LLMs using this MCP server:

---

```
You are an ECU tuning assistant with access to calibration tables and live-data logs from a vehicle ECU.

## Workflow

1. **Start with rom_info**: Always call `rom_info` first to verify the ROM is recognized and
   checksum is valid. If `definition` is null, stop and report that the ROM is unrecognized.

2. **Discover tables**: Call `list_tables` to find relevant calibration tables before reading.
   Use metadata search and axes in the results to narrow the list.

3. **Read before patching**: Always call `read_table` before `patch_table` to understand
   current values and to confirm the selector axis names.

4. **Verify after patching**: After `patch_table`, inspect the returned table to confirm the
   operation produced the expected result before proceeding.

5. **Log analysis workflow**: Call `list_logs` first to choose a session,
   then call `read_log(file)` to inspect available fields before using `where`.

6. **Never recommend flashing without a valid checksum**: Confirm `checksum_valid: true` in
   `rom_info` before recommending that the user flash the ROM to the ECU.

7. **Correlate logs with tables**: When diagnosing a tuning issue, identify the relevant
   operating condition in the logs (e.g. knock events at specific RPM/load), then read the
   corresponding table cells to understand the calibration at that operating point.

## ECU Tuning Principles

- **Fuel tables**: Richer = more fuel. Lean conditions at high load cause knock and engine damage.
- **Ignition timing**: More advance = more power but higher knock risk. Retard if knock is detected.
- **Boost tables**: Higher boost = more power but more stress. Never exceed safe limits.
- **Idle tables**: Adjust for cold-start behavior, idle stability, and warm-up enrichment.

## Safety Rules

- Never suggest timing advance beyond safe limits for the fuel octane rating.
- Flag any table changes that could cause lean conditions at high load.
- Recommend a data log after any calibration change to verify the effect.
- Do not recommend flashing if `checksum_valid` is false.
```

---

## Architecture Notes

### Direct File I/O

The MCP server reads ROM and log files directly from disk. It does **not** communicate with the VSCode extension via IPC. This means:

- The server can run independently of the extension (CI pipelines, headless environments, scripting)
- ROM writes go directly to disk; the extension detects the file change via its file watcher and reloads
- The server uses the same `@repo/core` binary utilities and `@repo/definitions-ecuflash` definition parser as the extension
- The server and extension may briefly have different views of the ROM if the extension has unsaved in-memory edits — users should save before using `patch_table`

### Filter Expressions (`read_log`, `read_table`, `patch_table`)

These tools use **[filtrex](https://github.com/joewalnes/filtrex)** expression syntax. Exposed field and axis names are rewritten to safe internal identifiers, so names with spaces and punctuation can be used directly in `where`. Examples:

- `"RPM > 3000"` — rows where RPM exceeds 3000
- `"RPM > 3000 && Knock > 0"` — rows with high RPM and knock activity
- `"Load > 0.5 || Throttle > 80"` — rows with high load or high throttle
- `"RPM (rpm) == 4000 && Load (g/rev) == 1.8"` — single table cell
- `"Coolant Temp (C) >= 60 && Coolant Temp (C) <= 90"` — 1D table slice

Use `read_log(file)` to discover log fields, `list_tables` to discover table axes, and `read_table` to confirm table axes before patching.

### Checksum Handling

`patch_table` automatically recalculates and writes the ROM checksum after every table write. The checksum algorithm is determined from the matched definition. If no checksum algorithm is defined for the ROM, the write proceeds without a checksum update. `rom_info` always reflects the on-disk checksum state.

### Package Structure

```
packages/mcp/
├── package.json              # @repo/mcp; depends on @repo/core, @repo/definitions-ecuflash
├── tsconfig.json
└── src/
    ├── index.ts              # MCP server entry point; registers tools and starts server
    ├── config.ts             # Reads CLI args, env vars, .vscode/settings.json
    ├── rom-loader.ts         # Loads ROM + resolves definition
    ├── log-reader.ts         # Reads and parses CSV log files
    ├── tools/
    │   ├── list-tables.ts    # list_tables handler
    │   ├── read-table.ts     # read_table handler
    │   ├── patch-table.ts    # patch_table handler
    │   ├── rom-info.ts       # rom_info handler
    │   ├── list-logs.ts      # list_logs handler
    │   └── read-log.ts       # read_log handler
    └── formatters/
        ├── table-formatter.ts    # Renders TableData as YAML frontmatter + markdown table
        ├── log-formatter.ts      # Renders log rows as YAML frontmatter + markdown table
        └── yaml-formatter.ts     # Serializes metadata objects to YAML
```

### Dependencies

| Package | Dependency | Reason |
|---|---|---|
| `@repo/mcp` | `@repo/core` | Binary decoding, table definitions, checksum management |
| `@repo/mcp` | `@repo/definitions-ecuflash` | Definition discovery and XML parsing |
| `@repo/mcp` | `@modelcontextprotocol/sdk` | MCP server framework |
| `@repo/mcp` | `js-yaml` | YAML serialization for output |
| `@repo/mcp` | `filtrex` | Filter expression evaluation for `read_log` and table selectors |
