# Workspace Settings Specification

## Overview

This specification describes the VSCode workspace settings contributed by ECU Explorer. Settings allow users to configure definition search paths, enable/disable providers, and set the log file output folder on a per-workspace basis.

### Current State

- No `contributes.configuration` block exists in [`apps/vscode/package.json`](../apps/vscode/package.json).
- `EcuFlashProvider` constructor already accepts `searchPaths: string[]` and searches them.
- `activate()` in [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) already passes workspace folders to the provider.
- Definition paths and provider enable/disable cannot be configured per workspace.
- Log folder location is hardcoded to the workspace root (no subfolder).

### User Value Proposition

- Store ECUFlash definition files in a custom location (e.g., a shared network drive or a project-specific subfolder).
- Disable unused providers to speed up ROM matching.
- Configure where log files are saved without modifying source code.

---

## Settings Schema

All settings are contributed under the `ecuExplorer` namespace. They are workspace-scoped (`"scope": "resource"`) so they can differ per workspace folder.

### `ecuExplorer.definitions.paths`

**Type**: `string[]`  
**Default**: `[]`  
**Scope**: `resource`  
**Description**: Additional folders to search for ROM definition files of any supported format. These paths are searched in addition to the built-in default locations for each provider. Relative paths are resolved relative to the workspace root.

**Example**:
```json
{
  "ecuExplorer.definitions.paths": [
    "./definitions",
    "/shared/ecu-definitions"
  ]
}
```

### `ecuExplorer.definitions.ecuflash.paths`

**Type**: `string[]`  
**Default**: `[]`  
**Scope**: `resource`  
**Description**: Additional folders to search specifically for ECUFlash XML definition files. These are merged with `ecuExplorer.definitions.paths` when constructing the ECUFlash provider's search path list. Relative paths are resolved relative to the workspace root.

**Example**:
```json
{
  "ecuExplorer.definitions.ecuflash.paths": [
    "./ecuflash-defs",
    "C:\\Users\\user\\Documents\\EcuFlash\\roms"
  ]
}
```

### `ecuExplorer.providers.enabled`

**Type**: `string[]`  
**Default**: `["ecuflash"]`  
**Scope**: `resource`  
**Description**: List of definition provider IDs that are active. Providers not in this list are not instantiated and do not contribute to ROM matching. Valid values: `"ecuflash"`. Additional provider IDs will be added as new providers are implemented.

**Example**:
```json
{
  "ecuExplorer.providers.enabled": ["ecuflash"]
}
```

### `ecuExplorer.logsFolder`

**Type**: `string`  
**Default**: `"logs"`  
**Scope**: `resource`  
**Description**: The folder where live data log files are saved. A relative path is resolved relative to the workspace root. An absolute path is used as-is. The folder is created automatically if it does not exist.

**Example**:
```json
{
  "ecuExplorer.logsFolder": "data/logs"
}
```

### `ecuExplorer.logging.columns`

**Type**: `string[] | "all"`  
**Default**: `"all"`  
**Scope**: `resource`  
**Description**: Which PID columns to include in log CSV files. `"all"` includes every streamed PID. An array of PID names (matching `PidDescriptor.name`) includes only those PIDs. Unknown names are silently ignored.

**Example**:
```json
{
  "ecuExplorer.logging.columns": ["Engine RPM", "Coolant Temp", "Throttle Position"]
}
```

---

## `contributes.configuration` Block

The following JSON is added to [`apps/vscode/package.json`](../apps/vscode/package.json) under `contributes`:

```json
"configuration": {
  "title": "ECU Explorer",
  "properties": {
    "ecuExplorer.definitions.paths": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "Additional folders to search for ROM definition files (any provider). Relative paths are resolved from the workspace root."
    },
    "ecuExplorer.definitions.ecuflash.paths": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "scope": "resource",
      "description": "Additional folders to search for ECUFlash XML definition files. Merged with ecuExplorer.definitions.paths."
    },
    "ecuExplorer.providers.enabled": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["ecuflash"]
      },
      "default": ["ecuflash"],
      "scope": "resource",
      "description": "List of active definition provider IDs. Providers not listed are not loaded."
    },
    "ecuExplorer.logsFolder": {
      "type": "string",
      "default": "logs",
      "scope": "resource",
      "description": "Folder where live data log CSV files are saved. Relative paths are resolved from the workspace root."
    },
    "ecuExplorer.logging.columns": {
      "type": ["array", "string"],
      "items": { "type": "string" },
      "default": "all",
      "scope": "resource",
      "description": "PID columns to include in log CSV files. Use 'all' to include every streamed PID, or an array of PID names."
    }
  }
}
```

---

## Reading Settings at Activation

Settings are read in `activate()` in [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) using `vscode.workspace.getConfiguration("ecuExplorer")`.

### Path Resolution Helper

A helper function resolves setting paths relative to the workspace root:

```typescript
function resolveSettingPaths(
  paths: string[],
  workspaceRoot: vscode.Uri | undefined
): string[] {
  if (!workspaceRoot) return paths.filter(p => path.isAbsolute(p));
  return paths.map(p =>
    path.isAbsolute(p) ? p : vscode.Uri.joinPath(workspaceRoot, p).fsPath
  );
}
```

### Provider Instantiation

```typescript
const config = vscode.workspace.getConfiguration("ecuExplorer");
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

const commonPaths = resolveSettingPaths(
  config.get<string[]>("definitions.paths", []),
  workspaceRoot
);
const ecuflashPaths = resolveSettingPaths(
  config.get<string[]>("definitions.ecuflash.paths", []),
  workspaceRoot
);
const enabledProviders = config.get<string[]>("providers.enabled", ["ecuflash"]);

// Merge common + ecuflash-specific paths
const allEcuflashPaths = [...commonPaths, ...ecuflashPaths];

// Only instantiate if enabled
if (enabledProviders.includes("ecuflash")) {
  const ecuflashProvider = new EcuFlashProvider(allEcuflashPaths);
  // register provider...
}
```

---

## Reacting to Configuration Changes

The extension subscribes to `vscode.workspace.onDidChangeConfiguration` to react to settings changes without requiring a reload.

```typescript
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("ecuExplorer.definitions.paths") ||
      event.affectsConfiguration("ecuExplorer.definitions.ecuflash.paths") ||
      event.affectsConfiguration("ecuExplorer.providers.enabled")
    ) {
      reinitializeProviders();
    }

    if (event.affectsConfiguration("ecuExplorer.logsFolder")) {
      // LoggingManager reads the setting lazily on next startLog(), no action needed.
    }

    if (event.affectsConfiguration("ecuExplorer.logging.columns")) {
      // LoggingManager reads the setting lazily on next startLog(), no action needed.
    }
  })
);
```

### `reinitializeProviders()`

```
1. Read the updated configuration values.
2. Dispose existing provider instances (call provider.dispose() if applicable).
3. Instantiate new provider instances with the updated search paths.
4. Re-register providers with the ROM definition resolver.
5. Invalidate any cached ROM definition matches (clear the resolver's cache).
6. If a ROM is currently open, re-run definition matching and update the tree view.
```

---

## Cache Invalidation for `EcuFlashProvider`

When `ecuExplorer.definitions.paths` or `ecuExplorer.definitions.ecuflash.paths` changes:

1. The existing `EcuFlashProvider` instance is disposed.
2. A new instance is created with the updated path list.
3. The `RomDefinitionResolver` (in [`apps/vscode/src/rom-definition-resolver.ts`](../apps/vscode/src/rom-definition-resolver.ts)) is updated to use the new provider.
4. Any in-memory cache of parsed definitions is cleared.
5. Open ROM documents are re-matched against the new provider.

> **Note**: `EcuFlashProvider` does not currently implement a `dispose()` method. One should be added that clears any internal caches.

---

## Settings UI

VSCode automatically generates a settings UI from the `contributes.configuration` schema. No additional UI work is required. Users can edit settings via:

- The Settings editor (`Ctrl+,` / `Cmd+,`) under the "ECU Explorer" section.
- Directly in `.vscode/settings.json` for workspace-scoped settings.

---

## Implementation Notes

### Files to Modify

- **[`apps/vscode/package.json`](../apps/vscode/package.json)** — Add `contributes.configuration` block with all five settings.
- **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)** — Read settings at activation; subscribe to `onDidChangeConfiguration`; implement `reinitializeProviders()`; add `resolveSettingPaths()` helper.
- **[`packages/definitions/ecuflash/src/index.ts`](../packages/definitions/ecuflash/src/index.ts)** — Add `dispose()` method to `EcuFlashProvider` that clears internal caches.
- **[`apps/vscode/src/rom-definition-resolver.ts`](../apps/vscode/src/rom-definition-resolver.ts)** — Add method to swap out the active provider and clear cached matches.

### No New Files Required

All changes are to existing files. No new source files are needed for this feature.

### Relative Path Handling

Relative paths in settings are resolved at the time the setting is read, not stored as absolute paths. This ensures that if the workspace is moved, the relative paths continue to work correctly.

### Multi-Root Workspaces

For multi-root workspaces, settings are read from the first workspace folder (`workspaceFolders[0]`). Full per-folder configuration support is deferred to a future release.

---

## Acceptance Criteria

1. After adding `contributes.configuration` to `package.json`, the ECU Explorer settings section appears in the VSCode Settings editor with all five settings listed.
2. When `ecuExplorer.definitions.paths` is set to `["./my-defs"]`, the ECUFlash provider searches `<workspaceRoot>/my-defs` in addition to its default locations.
3. When `ecuExplorer.definitions.ecuflash.paths` is set, those paths are merged with `ecuExplorer.definitions.paths` and passed to the ECUFlash provider.
4. When `ecuExplorer.providers.enabled` does not include `"ecuflash"`, the ECUFlash provider is not instantiated and no ECUFlash definitions are loaded.
5. When `ecuExplorer.providers.enabled` is set to `["ecuflash"]` (the default), the ECUFlash provider is instantiated normally.
6. When `ecuExplorer.definitions.paths` or `ecuExplorer.definitions.ecuflash.paths` is changed in settings, the provider is re-instantiated with the new paths without requiring a VSCode reload.
7. When `ecuExplorer.providers.enabled` is changed in settings, providers are re-instantiated accordingly without requiring a VSCode reload.
8. When a provider is re-instantiated due to a settings change, any cached definition matches are cleared and open ROMs are re-matched.
9. When `ecuExplorer.logsFolder` is set to a relative path (e.g., `"data/logs"`), log files are saved to `<workspaceRoot>/data/logs/`.
10. When `ecuExplorer.logsFolder` is set to an absolute path, log files are saved to that absolute path.
11. When `ecuExplorer.logsFolder` is not set, log files are saved to `<workspaceRoot>/logs/` (the default).
12. When `ecuExplorer.logging.columns` is set to an array of PID names, only those PIDs appear as columns in the CSV log.
13. When `ecuExplorer.logging.columns` is `"all"` (the default), all streamed PIDs appear as columns in the CSV log.
14. Relative paths in `ecuExplorer.definitions.paths` and `ecuExplorer.definitions.ecuflash.paths` are resolved relative to the workspace root, not the extension install directory.
15. Absolute paths in any path setting are used as-is without modification.
16. When no workspace folder is open, relative paths in settings are ignored and only absolute paths are used.
