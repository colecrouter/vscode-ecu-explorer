# Skills

This repository is prepared to host multiple companion agent skills alongside
the MCP server.

## Goals

- Keep MCP tools small and structured.
- Keep richer workflow guidance in installable skills.
- Let skills work without MCP, using MCP as an enhancement when available.

## Layout

Skills live under [`skills/`](/Users/colecrouter/Repositories/vscode-ecu-explorer/skills/README.md).

Each skill should have:

- `SKILL.md`
- optional `examples/`
- optional `assets/`

## Installation

If you are using the `skills` CLI, install a specific skill from this repo:

```bash
npx skills add https://github.com/colecrouter/vscode-ecu-explorer --skill ecu-log-analysis
```

Check for updates later with:

```bash
npx skills check
npx skills update
```

## Design Rules

- Skills should be narrowly scoped.
- Skills should include enough guidance to function without MCP.
- Skills may reference MCP resources such as:
  - `ecu-explorer://docs/query-syntax`
  - `ecu-explorer://docs/log-format`
  - `ecu-explorer://docs/log-analysis`
- Critical facts should remain available in repo docs and MCP resources.

## Planned Skills

- `ecu-log-analysis`
- `rom-tuning`
- `definition-authoring`
