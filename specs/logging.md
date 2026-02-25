# Live Data Logging Specification

## Overview

This specification describes the CSV logging feature for ECU Explorer's live data streaming. Logging is **independent of the Live Data webview panel** — it is controlled entirely via status bar buttons and does not require the panel to be open. A user can connect to a device, start logging, and close the Live Data panel without interrupting the recording.

### Current State

- `LiveDataPanelManager` in [`apps/vscode/src/live-data-panel-manager.ts`](../apps/vscode/src/live-data-panel-manager.ts) records CSV when the webview sends a `startStreaming` message with `record: true`.
- Log files are saved to the workspace root (no subfolder): `log-<ISO-timestamp>.csv`.
- CSV format is narrow: `Timestamp (ms),PID,Value,Unit` — one row per data point, using numeric PID IDs only.
- All rows are accumulated in-memory as a string and written atomically on `stopStreaming`.
- No configurable log folder.
- No `ecuExplorer.openLogsFolder` command.
- No pause/resume support.

### Design Goals

1. Logging is controlled via status bar, not the webview.
2. Log files are saved to a `logs/` subfolder by default (configurable).
3. CSV uses a **wide format**: one column per PID, named by PID name, one row per timestamp.
4. Pause/resume: frames are dropped while paused; the file stays open.
5. `ecuExplorer.openLogsFolder` command reveals the logs folder in the OS file manager.

---

## Log File Location

### Default Location

Log files are saved to a `logs/` subfolder within the first workspace folder:

```
<workspaceRoot>/logs/log-<ISO-timestamp>.csv
```

The `logs/` directory is created automatically if it does not exist.

### Configurable Location

The log folder can be overridden via the `ecuExplorer.logsFolder` workspace setting (see [`specs/workspace-settings.md`](workspace-settings.md)):

- If the value is a **relative path** (e.g., `"logs"` or `"data/logs"`), it is resolved relative to the workspace root.
- If the value is an **absolute path**, it is used as-is.
- If the workspace has no open folder, logging is unavailable and an error message is shown: `"No workspace folder is open. Open a folder to enable logging."`

### File Naming

```
log-<ISO-timestamp>.csv

Examples:
  log-2026-02-22T03-31-12-013Z.csv
  log-2026-02-22T15-00-00-000Z.csv
```

The ISO timestamp uses `-` in place of `:` and `.` to produce a valid filename on all platforms. The timestamp is captured at the moment `ecuExplorer.startLog` is invoked.

---

## CSV Format

### Wide Format (One Column Per PID)

The CSV uses a **wide format** where each PID occupies its own column. This is more convenient for analysis in spreadsheet tools and plotting libraries.

**Header row**: `Timestamp (ms)` followed by one column per PID, named by the PID's human-readable name from `PidDescriptor.name`.

**Data rows**: Each row represents one polling cycle. The timestamp is milliseconds since the logging session started (not wall-clock time). Each PID column contains the numeric value for that PID in that cycle. If a PID was not received in a given cycle, the cell is left empty.

**Example** (three PIDs: Engine RPM, Coolant Temp, Throttle Position):

```csv
Timestamp (ms),Engine RPM,Coolant Temp,Throttle Position
0,850,82,3.2
100,855,82,3.2
200,860,83,4.1
300,875,83,12.5
400,890,83,18.0
```

### Column Selection

By default, all PIDs that are actively being streamed are included as columns. The user can restrict which PIDs appear in the log via the `ecuExplorer.logging.columns` setting (see [`specs/workspace-settings.md`](workspace-settings.md)):

- `"all"` (default): include every streamed PID.
- Array of PID names (e.g., `["Engine RPM", "Coolant Temp"]`): include only the listed PIDs. PIDs not in the list are still streamed to the Live Data panel but are not written to the CSV.

Unknown PID names in the `columns` array are silently ignored (no error).

### Units

Units are **not** included in the CSV data rows. They are written as a second header row (row 2) immediately after the column name row, prefixed with `Unit`:

```csv
Timestamp (ms),Engine RPM,Coolant Temp,Throttle Position
Unit,rpm,°C,%
0,850,82,3.2
100,855,82,3.2
```

The `Unit` row uses the `PidDescriptor.unit` value for each PID. The `Timestamp (ms)` column has no unit entry (empty cell in the Unit row).

---

## Logging Lifecycle

### Starting a Log

`ecuExplorer.startLog` is invoked from the status bar (only available when `ecuExplorer.deviceConnected` is `true`).

```
1. Resolve the log folder path (workspace setting or default "logs/").
2. Create the logs directory if it does not exist (vscode.workspace.fs.createDirectory).
3. Capture the start timestamp (Date.now()) for relative timing.
4. Determine the set of PIDs to log (all active PIDs, filtered by ecuExplorer.logging.columns).
5. Write the CSV header row and Unit row to an in-memory buffer.
6. Set logging state to "recording".
7. Update status bar: show Pause Log and Stop Log buttons.
8. Set VSCode context key ecuExplorer.loggingActive = true.
```

The log file is **not** opened for writing until `ecuExplorer.stopLog` is invoked (write-on-stop model, same as current behaviour). This avoids partial file writes and simplifies the implementation.

> **Note**: If the device is not currently streaming live data when `startLog` is invoked, the `LoggingManager` starts streaming automatically using the last-selected PID set (or all supported PIDs if none were previously selected).

### Receiving Frames

For each `LiveDataFrame` received while logging state is `"recording"`:

```
1. Compute relative timestamp: frame.timestamp - sessionStartTimestamp.
2. If the PID is in the column set, append the value to the current row buffer.
3. When all PIDs for a given timestamp have been received (or a new timestamp arrives),
   flush the current row to the in-memory CSV buffer.
```

While logging state is `"paused"`, incoming frames are forwarded to the Live Data panel but **not** written to the CSV buffer.

### Pausing a Log

`ecuExplorer.pauseLog` is invoked from the status bar.

```
1. Set logging state to "paused".
2. Update status bar: show Resume Log button (replace Pause Log).
3. Set VSCode context key ecuExplorer.loggingPaused = true, ecuExplorer.loggingActive = false.
```

Frames continue to be received and forwarded to the Live Data panel, but are not written to the CSV buffer.

### Resuming a Log

`ecuExplorer.resumeLog` is invoked from the status bar.

```
1. Set logging state to "recording".
2. Update status bar: show Pause Log button (replace Resume Log).
3. Set VSCode context key ecuExplorer.loggingActive = true, ecuExplorer.loggingPaused = false.
```

Frames received after resuming are written to the same in-memory buffer, continuing from where the log left off. There is no gap marker in the CSV for the paused period.

### Stopping a Log

`ecuExplorer.stopLog` is invoked from the status bar (or automatically when `ecuExplorer.disconnectDevice` is invoked while logging).

```
1. Set logging state to "idle".
2. Encode the in-memory CSV buffer as UTF-8.
3. Write the file to the resolved log path using vscode.workspace.fs.writeFile.
4. Show information message: "Log saved to <relative path from workspace root>."
   Include an "Open Folder" action button that invokes ecuExplorer.openLogsFolder.
5. Update status bar: hide Pause/Resume/Stop Log buttons, show Start Log button.
6. Set VSCode context key ecuExplorer.loggingActive = false, ecuExplorer.loggingPaused = false.
7. Clear the in-memory CSV buffer and recording URI.
```

---

## `LoggingManager` Class

A new `LoggingManager` class is introduced in [`apps/vscode/src/logging-manager.ts`](../apps/vscode/src/logging-manager.ts) to own all logging state. This decouples logging from `LiveDataPanelManager`.

```typescript
export type LoggingState = "idle" | "recording" | "paused";

export class LoggingManager implements vscode.Disposable {
  private state: LoggingState = "idle";
  private csvBuffer: string = "";
  private recordingUri: vscode.Uri | undefined;
  private sessionStartMs: number = 0;
  private columns: string[] | "all" = "all";
  private pidNames: Map<number, string> = new Map(); // pid -> name
  private pidUnits: Map<number, string> = new Map(); // pid -> unit

  private _onDidChangeState = new vscode.EventEmitter<LoggingState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(
    private context: vscode.ExtensionContext,
    private deviceManager: DeviceManagerImpl,
  ) {}

  /** Start a new logging session. Throws if no workspace folder is open. */
  async startLog(pids: PidDescriptor[]): Promise<void>;

  /** Pause the current session. No-op if not recording. */
  pauseLog(): void;

  /** Resume a paused session. No-op if not paused. */
  resumeLog(): void;

  /** Stop the session and write the CSV file. Returns the saved URI. */
  async stopLog(): Promise<vscode.Uri | undefined>;

  /** Feed a live data frame into the logger. */
  onFrame(frame: LiveDataFrame): void;

  get loggingState(): LoggingState;

  dispose(): void;
}
```

`LiveDataPanelManager` is updated to call `loggingManager.onFrame(frame)` for each received frame, in addition to forwarding the frame to the webview.

---

## `ecuExplorer.openLogsFolder` Command

Opens the resolved logs folder in the OS file manager using `vscode.commands.executeCommand("revealFileInOS", logsUri)`.

- If the logs folder does not exist, it is created first.
- If no workspace folder is open, show error: `"No workspace folder is open."`
- The command is always available (no enablement condition).

---

## Interaction with Live Data Panel

- The Live Data panel (`LiveDataPanelManager`) continues to display real-time data regardless of logging state.
- The panel's `startStreaming` / `stopStreaming` webview messages no longer control logging. The `record` field in the `startStreaming` message is **deprecated** and ignored.
- When the Live Data panel is closed, streaming continues if a device is connected (streaming is now owned by the connection, not the panel). The panel can be reopened and will resume displaying data.

> **Implementation note**: This requires `LiveDataPanelManager` to be refactored so that the streaming session is owned by `DeviceManagerImpl` (or a separate `StreamingManager`), not by the panel itself. The panel subscribes to a stream of frames rather than owning the `LiveDataSession`.

---

## Implementation Notes

### Files to Create

- **[`apps/vscode/src/logging-manager.ts`](../apps/vscode/src/logging-manager.ts)** — `LoggingManager` class

### Files to Modify

- **[`apps/vscode/src/live-data-panel-manager.ts`](../apps/vscode/src/live-data-panel-manager.ts)** — Remove `csvContent`, `recordingUri` fields; call `loggingManager.onFrame()` instead; deprecate `record` field in `startStreaming` message
- **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)** — Register `ecuExplorer.startLog`, `ecuExplorer.pauseLog`, `ecuExplorer.resumeLog`, `ecuExplorer.stopLog`, `ecuExplorer.openLogsFolder` commands; instantiate `LoggingManager`
- **[`apps/vscode/package.json`](../apps/vscode/package.json)** — Add new commands; add `ecuExplorer.logsFolder` and `ecuExplorer.logging.columns` to `contributes.configuration`

### In-Memory Write Model

All CSV data is accumulated in a string buffer and written to disk in a single `vscode.workspace.fs.writeFile` call when the session stops. This is consistent with the current implementation and avoids the complexity of streaming file writes via the VSCode FS API.

For very long sessions (hours of data), memory usage may become significant. A future improvement could flush the buffer to disk periodically, but this is out of scope for v1.

---

## Acceptance Criteria

1. When `ecuExplorer.startLog` is invoked with an active device connection, a `LoggingManager` session starts and the status bar shows Pause Log and Stop Log buttons.
2. When `ecuExplorer.stopLog` is invoked, a CSV file is written to `<logsFolder>/log-<timestamp>.csv` and an information message is shown with the file path.
3. The CSV file's first row is `Timestamp (ms),<PID Name 1>,<PID Name 2>,...` with one column per streamed PID.
4. The CSV file's second row is `Unit,<unit1>,<unit2>,...` with the unit for each PID column.
5. Each subsequent row contains a relative timestamp (ms since session start) and one value per PID column.
6. When `ecuExplorer.pauseLog` is invoked, frames received during the paused period are not written to the CSV buffer.
7. When `ecuExplorer.resumeLog` is invoked after a pause, subsequent frames are written to the same buffer, continuing the log without a gap marker.
8. When `ecuExplorer.logging.columns` is set to an array of PID names, only those PIDs appear as columns in the CSV; other PIDs are still streamed to the Live Data panel.
9. When `ecuExplorer.logging.columns` is `"all"` (or not set), all streamed PIDs appear as columns.
10. Log files are saved to the `logs/` subfolder of the workspace root by default.
11. When `ecuExplorer.logsFolder` is set to a relative path, log files are saved to that path relative to the workspace root.
12. When `ecuExplorer.logsFolder` is set to an absolute path, log files are saved to that absolute path.
13. The `logs/` directory (or configured folder) is created automatically if it does not exist.
14. When `ecuExplorer.openLogsFolder` is invoked, the logs folder is revealed in the OS file manager.
15. When `ecuExplorer.disconnectDevice` is invoked while logging is active, the log is stopped and saved before the device is disconnected.
16. When no workspace folder is open and `ecuExplorer.startLog` is invoked, an error message is shown and no log session is started.
17. The `record` field in the `startStreaming` webview message is ignored; logging is controlled exclusively via status bar commands.
18. Closing the Live Data panel does not stop an active logging session.
