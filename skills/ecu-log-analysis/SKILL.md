---
name: ecu-log-analysis
description: Analyze ECU log CSVs, especially for tuning workflows like MAF scaling, using a lean MCP-first workflow with shell-native fallbacks.
---

# ECU Log Analysis

Use this skill for ECU log inspection and tuning-oriented analysis.

Prefer concise, auditable workflows. Do not invent missing channels, units, or
ECU strategy details. When prerequisites are unknown, determine them first or
stop and explain what is missing.

## Preferred Workflow

1. Use `list_logs` to discover candidate logs.
2. Use `read_log(file)` to inspect schema, units, and simple slices.
3. For complex temporal analysis:
   - use PowerShell with `Import-Csv` on Windows
   - use Python with `csv.DictReader` on macOS/Linux
   - use `awk` for simple scans and summaries

## MAF Scaling

When the task is MAF scaling or MAF-related fueling analysis, read
[`references/maf-scaling.md`](references/maf-scaling.md) before proceeding.

Use that reference to:

- determine whether the log is usable for MAF analysis
- map source channels into canonical concepts
- choose the appropriate analysis mode
- decide whether to refuse or proceed cautiously
- format findings and proposed changes for review

When the task depends on whether closed-loop, open-loop, or mixed fueling logic
applies, read [`references/fueling-modes.md`](references/fueling-modes.md).

When making tuning recommendations from incomplete or conflicting evidence, read
[`references/tuning-safety.md`](references/tuning-safety.md).

When diagnosing boost behavior, wastegate behavior, or boost-control tables,
read [`references/boost-control.md`](references/boost-control.md).

## MCP Resources

If the ECU Explorer MCP server is available, consult:

- `ecu-explorer://docs/query-syntax`
- `ecu-explorer://docs/log-format`
- `ecu-explorer://docs/log-analysis`

## Operating Rules

- Native ECU Explorer logs are expected to have numeric-only data rows.
- Prefer MCP for discovery and simple structured queries.
- Prefer shell-native analysis for sequence detection or multi-row reasoning.
- Treat skills as workflow guidance and MCP resources as supporting reference.
- If MCP is unavailable, continue with shell-native workflows instead of failing.
- For tuning recommendations, state confidence, assumptions, and missing inputs.
