---
name: ecu-log-analysis
description: Analyze ECU log CSVs with a lean MCP-first workflow and shell-native fallbacks.
---

# ECU Log Analysis

Use this skill for ECU log inspection and tuning-oriented analysis.

## Preferred Workflow

1. Use `list_logs` to discover candidate logs.
2. Use `read_log(file)` to inspect schema, units, and simple slices.
3. For complex temporal analysis:
   - use PowerShell with `Import-Csv` on Windows
   - use Python with `csv.DictReader` on macOS/Linux
   - use `awk` for simple scans and summaries

## MCP Resources

If the ECU Explorer MCP server is available, consult:

- `ecu-explorer://docs/query-syntax`
- `ecu-explorer://docs/log-format`
- `ecu-explorer://docs/log-analysis`

## Notes

- Native ECU Explorer logs are expected to have numeric-only data rows.
- Prefer MCP for discovery and simple structured queries.
- Prefer shell-native analysis for sequence detection or multi-row reasoning.
