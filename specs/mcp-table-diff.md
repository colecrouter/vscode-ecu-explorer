# MCP Table Diff Specification

## Overview

This specification adds a single MCP tool for comparing calibration tables across two ROMs.

The tool is designed for workflows where a user has a modified ROM of unknown or partially known origin and wants to identify which calibration changes may be worth reviewing or carrying forward into another ROM.

Typical use cases:

- compare a stock ROM against a modified ROM to discover changed calibrations
- identify which tables were likely edited intentionally
- inspect the exact differences for one named table before deciding whether to port it

This specification intentionally does **not** add byte-level or sector-level ROM diffing to the MCP surface.

## Goals

1. Add table-level ROM comparison without significantly expanding the MCP tool surface.
2. Support both discovery and detailed inspection through one intuitive tool.
3. Handle ROMs with different matched definitions conservatively and explicitly.
4. Help agents prioritize likely calibration changes over low-signal noise.

## Non-Goals

1. This spec does not expose raw byte diffs.
2. This spec does not expose flash-sector diffs.
3. This spec does not automatically port values between ROMs.
4. This spec does not attempt fuzzy table matching beyond exact table-name matching in v1.

## Tool Surface

Add one new MCP tool:

- `diff_tables`

This tool has two modes determined by whether `table` is provided.

### Summary Mode

When `table` is omitted, `diff_tables` returns a summary of changed/comparable tables across two ROMs.

This is the default discovery mode.

### Table Detail Mode

When `table` is provided, `diff_tables` returns the detailed diff result for that single named table.

This is the focused inspection mode.

## Why One Tool

The existing MCP surface keeps tool roles simple and discoverable. Adding a separate summary tool and per-table diff tool would increase surface area without improving intuition.

`diff_tables` remains easy to explain:

- omit `table` to discover changed tables
- include `table` to inspect one table in detail

## Tool Contract

### Name

`diff_tables`

### Description

Compare calibration tables across two ROMs. Omit `table` for a changed-table summary, or provide `table` to inspect one table in detail.

### Inputs

| Parameter | Type | Required | Description |
|---|---|---|---|
| `base_rom` | `string` | Yes | Absolute or workspace-relative path to the baseline ROM |
| `target_rom` | `string` | Yes | Absolute or workspace-relative path to the comparison ROM |
| `base_definition` | `string` | No | Optional explicit definition path for `base_rom` |
| `target_definition` | `string` | No | Optional explicit definition path for `target_rom` |
| `table` | `string` | No | Exact table name to inspect in detail; omit for summary mode |
| `query` | `string` | No | Metadata query over summary results; valid only when `table` is omitted |
| `page` | `number` | No | 1-based page number for summary mode |
| `page_size` | `number` | No | Maximum rows to return per page in summary mode |

### Input Rules

1. `query`, `page`, and `page_size` apply only to summary mode.
2. `table` switches the tool into table detail mode.
3. `table` matching SHALL use the same exact-name then case-insensitive fallback strategy used by `read_table` and `patch_table`.

## Behavior

## ROM Loading

The tool SHALL load both ROMs independently using the same ROM loading and definition resolution behavior already used by the MCP server.

Each ROM is resolved against:

- its explicit definition if provided
- otherwise, the existing definition discovery/matching flow

## Definition Handling

Different matched definitions are allowed.

The tool SHALL **not** require both ROMs to resolve to the same definition in order to run.

Instead, the tool SHALL:

1. load both definitions independently
2. compare tables by exact table name
3. classify each table relationship conservatively

### Table Relationship Statuses

Summary and detail responses SHALL use the following statuses where applicable:

- `unchanged`
- `changed`
- `axis_changed`
- `incompatible`
- `base_only`
- `target_only`

### Status Meanings

| Status | Meaning |
|---|---|
| `unchanged` | Table exists on both sides and decoded values are identical |
| `changed` | Table exists on both sides, is structurally compatible, and decoded cell values differ |
| `axis_changed` | Table exists on both sides and has compatible shape, but one or more axis breakpoint values differ |
| `incompatible` | Table exists on both sides by name, but kinds/shapes are not safely comparable |
| `base_only` | Table exists only in the base ROM definition |
| `target_only` | Table exists only in the target ROM definition |

## Compatibility Rules

V1 SHALL be conservative.

A table pair is structurally compatible only when all of the following are true:

1. both tables have the same kind
2. both tables have the same dimensions
3. both tables decode into the same logical grid shape
4. both tables expose the same axis count for their kind

Additional rules:

- If kinds differ, status is `incompatible`.
- If dimensions differ, status is `incompatible`.
- If one table is missing, status is `base_only` or `target_only`.
- If shapes match but axis breakpoint values differ, status is `axis_changed`.
- If axes match and cell values differ, status is `changed`.
- If axes and cell values both match, status is `unchanged`.

### Unit Handling

Displayed units SHOULD be included in output.

V1 SHOULD NOT attempt unit conversion between different definitions. If two same-named tables appear structurally compatible but expose materially different units or numeric interpretation, the implementation MAY classify them as `incompatible`.

## Summary Mode

### Purpose

Help an agent discover which tables differ across two ROMs and prioritize likely calibration changes.

### Matching Scope

Summary mode SHALL compare the union of tables from both resolved definitions using exact table-name matching.

### Query Scope

`query` SHALL search summary metadata only:

- table name
- category
- status
- kind
- unit

It SHALL NOT search cell contents.

### Output

Summary mode SHALL return YAML frontmatter plus a markdown table.

### Frontmatter Fields

Frontmatter SHALL include:

- `base_rom`
- `target_rom`
- `base_definition`
- `target_definition`
- `same_definition`
- `total_base_tables`
- `total_target_tables`
- `comparable_tables`
- `changed_tables`
- `axis_changed_tables`
- `incompatible_tables`
- `base_only_tables`
- `target_only_tables`
- `unchanged_tables`
- `page`
- `page_size`
- `total_pages`

If definitions differ, the output SHALL include an explicit warning field:

- `warning: definitions differ; only exact-name table matches are compared`

### Summary Table Columns

The markdown table SHALL include:

- `#`
- `name`
- `category`
- `kind`
- `status`
- `cells_changed`
- `max_abs_delta`
- `portability`

### Summary Metrics

`cells_changed` and `max_abs_delta` apply only when a table is structurally compatible and cell values were compared.

For `unchanged`, `base_only`, `target_only`, and `incompatible`, those fields MAY be blank.

### Portability Classification

Summary mode SHALL include a conservative portability hint:

- `safe`
- `review`
- `no`

Suggested mapping:

| Condition | Portability |
|---|---|
| `changed` with matching axes | `safe` |
| `axis_changed` | `review` |
| `incompatible` | `no` |
| `base_only` / `target_only` | `review` |
| `unchanged` | `safe` |

These are workflow hints only, not guarantees.

## Table Detail Mode

### Purpose

Help an agent inspect exactly how one named table differs across two ROMs.

### Resolution

When `table` is provided, the tool SHALL resolve that name independently in both ROM definitions.

Possible outcomes:

1. table present and comparable on both sides
2. table present on one side only
3. table present on both sides but incompatible
4. table missing on both sides

### Error Handling

If the named table is not found in either ROM definition, the tool SHALL return an error with close matches from both definitions when practical.

If the table is found on one side only or is incompatible, the tool SHALL return a non-error explanatory result rather than failing.

### Output

Table detail mode SHALL return YAML frontmatter plus a concise markdown body.

### Frontmatter Fields

Frontmatter SHALL include:

- `table`
- `base_rom`
- `target_rom`
- `base_definition`
- `target_definition`
- `status`
- `kind`
- `rows`
- `cols`
- `cells_changed`
- `max_abs_delta`
- `mean_abs_delta`
- `x_axis_changed`
- `y_axis_changed`
- `portability`

Fields that do not apply MAY be omitted.

### Detail Body for Compatible Tables

When the table is compatible, the response SHALL include:

1. a short summary line describing the diff
2. axis metadata
3. a markdown table showing changed cells only, unless the whole table changed and the result would remain reasonably compact

The changed-cell table SHOULD include:

- row axis value
- column axis value for 2D tables
- `base_value`
- `target_value`
- `delta`

For 1D tables, the detail table SHOULD include:

- axis value
- `base_value`
- `target_value`
- `delta`

### Detail Body for `axis_changed`

When axis breakpoint values differ, the response SHALL:

1. say that the table shape matched but axes changed
2. include the axis names
3. show the differing axis breakpoints
4. avoid pretending the cell delta is directly portable

### Detail Body for `incompatible`

When tables are incompatible, the response SHALL explain why, such as:

- different kind
- different dimensions
- missing axis data
- incompatible numeric interpretation

### Detail Body for `base_only` / `target_only`

When the table exists on only one side, the response SHALL say so explicitly and include the side on which the table was found.

## Prioritization Heuristic

Summary mode SHOULD sort rows to surface the most useful review targets first.

Recommended default ordering:

1. `changed`
2. `axis_changed`
3. `incompatible`
4. `base_only` / `target_only`
5. `unchanged`

Within `changed`, sort by:

1. descending `cells_changed`
2. descending `max_abs_delta`
3. table name

## Size and Noise Controls

The tool SHALL prefer concise outputs.

### Summary Mode

Use pagination.

### Table Detail Mode

Default to changed cells only.

If the changed-cell set is extremely large, the tool MAY:

- return only the first N changed cells plus a truncation note
- include aggregate metrics instead of dumping every changed cell

## Failure Conditions

The tool SHALL return an error when:

1. either ROM cannot be loaded
2. either explicit definition cannot be loaded
3. ROM sizes differ

### ROM Size Mismatch

If `base_rom` and `target_rom` differ in byte length, the tool SHALL fail with an explicit message. This protects against misleading comparisons across clearly different ROM images or ECU variants.

## Implementation Notes

The implementation SHOULD reuse existing MCP internals where practical:

- ROM loading from `packages/mcp/src/rom-loader.ts`
- table lookup behavior from `read_table` / `patch_table`
- table decoding utilities and formatting patterns from `packages/mcp/src/formatters/table-formatter.ts`

This tool SHOULD remain read-only.

## Examples

### Summary Mode

Input:

```json
{
  "base_rom": "./stock.hex",
  "target_rom": "./modded.hex"
}
```

Behavior:

- compares all exact-name tables across both ROMs
- returns paginated summary rows

### Table Detail Mode

Input:

```json
{
  "base_rom": "./stock.hex",
  "target_rom": "./modded.hex",
  "table": "Fuel Injector Scaling"
}
```

Behavior:

- resolves `Fuel Injector Scaling` in both ROMs
- returns detailed diff for that table if compatible
- otherwise returns an explanatory result

## Acceptance Criteria

- [ ] A single new MCP tool, `diff_tables`, is added
- [ ] Omitting `table` returns summary mode
- [ ] Providing `table` returns table detail mode
- [ ] ROMs with different resolved definitions are supported conservatively
- [ ] Table matching uses exact table names in v1
- [ ] Structurally incompatible tables are reported explicitly
- [ ] Summary mode reports `changed`, `axis_changed`, `incompatible`, `base_only`, `target_only`, and `unchanged`
- [ ] Summary mode includes pagination
- [ ] Table detail mode reports changed cells concisely
- [ ] ROM size mismatch returns an error
- [ ] The tool remains read-only
