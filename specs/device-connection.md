# Device Connection Specification

## Overview

This specification describes the persistent device connection model for ECU Explorer. The goal is to replace the current transient per-command connection pattern with a single, shared active connection that is established once and reused across all device operations (Read ROM, Write ROM, Live Data streaming).

### Current State

- Each command (`ecuExplorer.readRomFromDevice`, `ecuExplorer.writeRomToDevice`, `ecuExplorer.startLiveData`) independently calls `selectDeviceAndProtocol()` and closes the connection in a `finally` block.
- `DeviceManagerImpl` in [`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts) stores only registered transports and protocols — no active connection state.
- `selectDeviceAndProtocol()` currently throws `"Method not implemented."`.
- No status bar items exist for device state.
- No `ecuExplorer.deviceConnected` VSCode context key exists.

### User Value Proposition

- Connect once, use for all operations without re-selecting the device each time.
- Clear visual feedback in the status bar showing connection state.
- Logging can be started/stopped independently from the live data panel.
- Read ROM and Write ROM reuse the active connection, avoiding repeated security handshakes.

---

## Status Bar States

The extension contributes up to three status bar items, all in the right-hand status bar group `ecuExplorer`. Their visibility changes based on connection and logging state.

### State 1: No Active Connection

| Item | Text | Tooltip | Command |
|------|------|---------|---------|
| Connect button | `$(plug) Connect` | `Connect to ECU device` | `ecuExplorer.connectDevice` |

The Connect button is **always visible** when no connection is active. The Disconnect and logging buttons are hidden.

### State 2: Connected, Not Logging

| Item | Text | Tooltip | Command |
|------|------|---------|---------|
| Disconnect button | `$(debug-disconnect) Disconnect` | `Disconnect from <device name>` | `ecuExplorer.disconnectDevice` |
| Start Log button | `$(record) Start Log` | `Start recording live data to CSV` | `ecuExplorer.startLog` |

The Connect button is hidden. Both Disconnect and Start Log are visible.

### State 3: Connected, Logging Active

| Item | Text | Tooltip | Command |
|------|------|---------|---------|
| Disconnect button | `$(debug-disconnect) Disconnect` | `Disconnect from <device name>` | `ecuExplorer.disconnectDevice` |
| Pause/Resume Log button | `$(debug-pause) Pause Log` (when running) or `$(debug-continue) Resume Log` (when paused) | `Pause log recording` / `Resume log recording` | `ecuExplorer.pauseLog` / `ecuExplorer.resumeLog` |
| Stop Log button | `$(primitive-square) Stop Log` | `Stop recording and save CSV` | `ecuExplorer.stopLog` |

When logging is active, the Start Log button is replaced by Pause/Resume and Stop Log buttons.

---

## Design

### `DeviceManagerImpl` Changes

`DeviceManagerImpl` in [`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts) gains three new fields and an event emitter:

```typescript
import * as vscode from "vscode";
import type { DeviceConnection, EcuProtocol } from "@repo/device";

export interface ActiveConnection {
  connection: DeviceConnection;
  protocol: EcuProtocol;
  deviceName: string;
}

export class DeviceManagerImpl implements DeviceManager {
  // ... existing fields ...

  /** The currently active connection, or undefined if not connected. */
  private _activeConnection: ActiveConnection | undefined;

  /** Fires whenever the active connection changes (connect or disconnect). */
  private _onDidChangeConnection = new vscode.EventEmitter<ActiveConnection | undefined>();
  readonly onDidChangeConnection = this._onDidChangeConnection.event;

  /** Returns the current active connection, or undefined. */
  get activeConnection(): ActiveConnection | undefined {
    return this._activeConnection;
  }

  /**
   * Implement selectDeviceAndProtocol():
   * 1. Show QuickPick of available devices (listAllDevices).
   * 2. Auto-detect protocol via EcuProtocol.canHandle().
   * 3. Store result in _activeConnection.
   * 4. Fire onDidChangeConnection.
   * 5. Return the connection and protocol.
   */
  async selectDeviceAndProtocol(): Promise<{ connection: DeviceConnection; protocol: EcuProtocol }>;

  /**
   * Disconnect the active connection.
   * Calls connection.close(), clears _activeConnection, fires onDidChangeConnection(undefined).
   */
  async disconnect(): Promise<void>;
}
```

### `selectDeviceAndProtocol()` Implementation

```
1. Call listAllDevices() to enumerate all devices across registered transports.
2. If no devices found, show vscode.window.showErrorMessage("No ECU devices found. Check USB connection.") and throw.
3. If exactly one device, use it directly. If multiple, show vscode.window.showQuickPick() with device names.
4. If user cancels QuickPick, throw a CancellationError (do not show error message).
5. Call transport.connect(deviceId) to open the DeviceConnection.
6. Iterate registered protocols, call protocol.canHandle(connection) for each.
7. If no protocol matches, close connection and show error: "No compatible ECU protocol found for this device."
8. If multiple protocols match, show QuickPick to let user choose.
9. Store { connection, protocol, deviceName } in _activeConnection.
10. Fire _onDidChangeConnection with the new ActiveConnection.
11. Return { connection, protocol }.
```

### `disconnect()` Implementation

```
1. If no active connection, return immediately.
2. Call _activeConnection.connection.close().
3. Set _activeConnection = undefined.
4. Fire _onDidChangeConnection(undefined).
```

### New Commands

#### `ecuExplorer.connectDevice`

Registered in [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts).

```
1. If deviceManager.activeConnection is already set, show information message:
   "Already connected to <deviceName>. Disconnect first."
   Return.
2. Call deviceManager.selectDeviceAndProtocol().
3. On success, the onDidChangeConnection event fires and updates status bar automatically.
4. On error (not CancellationError), show vscode.window.showErrorMessage with the error message.
```

#### `ecuExplorer.disconnectDevice`

```
1. If no active connection, return.
2. If logging is active, stop logging first (save CSV file).
3. Call deviceManager.disconnect().
4. Show information message: "Disconnected from <deviceName>."
```

### Read ROM / Write ROM Reuse Active Connection

The `ecuExplorer.readRomFromDevice` and `ecuExplorer.writeRomToDevice` command handlers in [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) are updated:

```
1. Check deviceManager.activeConnection.
2. If an active connection exists, use it directly (skip selectDeviceAndProtocol).
3. If no active connection, call selectDeviceAndProtocol() to establish one.
   - The new connection is stored as the active connection (persistent).
4. Proceed with the ROM read/write operation using the active connection.
5. Do NOT close the connection in a finally block — it remains open.
6. On connection error during the operation (e.g., device disconnected mid-read),
   call deviceManager.disconnect() to clean up state, then show error message.
```

### VSCode Context Key: `ecuExplorer.deviceConnected`

A boolean context key is set via `vscode.commands.executeCommand("setContext", ...)` whenever the connection state changes:

```typescript
deviceManager.onDidChangeConnection((conn) => {
  vscode.commands.executeCommand(
    "setContext",
    "ecuExplorer.deviceConnected",
    conn !== undefined
  );
});
```

This key is used in `package.json` `contributes.menus` and `contributes.commands` `enablement` fields to show/hide device-related commands.

### Status Bar Item Management

A `DeviceStatusBarManager` class (new file: [`apps/vscode/src/device-status-bar.ts`](../apps/vscode/src/device-status-bar.ts)) manages the status bar items:

```typescript
export class DeviceStatusBarManager implements vscode.Disposable {
  private connectItem: vscode.StatusBarItem;
  private disconnectItem: vscode.StatusBarItem;
  private startLogItem: vscode.StatusBarItem;
  private pauseLogItem: vscode.StatusBarItem;
  private stopLogItem: vscode.StatusBarItem;

  constructor(deviceManager: DeviceManagerImpl) {
    // Create status bar items with appropriate priorities
    // Subscribe to deviceManager.onDidChangeConnection
    // Subscribe to logging state changes
  }

  /** Called when logging state changes (started/paused/resumed/stopped). */
  updateLoggingState(state: "idle" | "recording" | "paused"): void;

  dispose(): void;
}
```

Status bar item priorities (higher = further right):
- Connect: priority 100
- Disconnect: priority 100
- Start Log / Stop Log: priority 99
- Pause/Resume Log: priority 98

---

## New Commands Summary

The following commands are added to `contributes.commands` in [`apps/vscode/package.json`](../apps/vscode/package.json):

| Command ID | Title | Enablement |
|---|---|---|
| `ecuExplorer.connectDevice` | `Connect to Device` | `!ecuExplorer.deviceConnected` |
| `ecuExplorer.disconnectDevice` | `Disconnect from Device` | `ecuExplorer.deviceConnected` |
| `ecuExplorer.startLog` | `Start Live Data Log` | `ecuExplorer.deviceConnected` |
| `ecuExplorer.pauseLog` | `Pause Live Data Log` | `ecuExplorer.deviceConnected && ecuExplorer.loggingActive` |
| `ecuExplorer.resumeLog` | `Resume Live Data Log` | `ecuExplorer.deviceConnected && ecuExplorer.loggingPaused` |
| `ecuExplorer.stopLog` | `Stop Live Data Log` | `ecuExplorer.deviceConnected && ecuExplorer.loggingActive` |

The existing `ecuExplorer.selectDevice` command is deprecated in favour of `ecuExplorer.connectDevice`.

---

## Error Handling

### Device Not Found

- `listAllDevices()` returns an empty array.
- Show: `"No ECU devices found. Check that your interface cable is connected and drivers are installed."`
- Status bar remains in "No Connection" state.

### Protocol Detection Failure

- No registered protocol returns `true` from `canHandle()`.
- Close the raw `DeviceConnection`.
- Show: `"Connected to device but no compatible ECU protocol was detected. Verify the correct protocol is registered."`
- Status bar remains in "No Connection" state.

### Connection Lost Mid-Operation

- A `sendFrame()` or streaming call throws an error during an active operation.
- The command handler catches the error, calls `deviceManager.disconnect()` to clear state.
- Show: `"Connection to <deviceName> was lost: <error message>. Reconnect and try again."`
- Status bar returns to "No Connection" state.

### User Cancels Device Selection

- User dismisses the QuickPick without selecting a device.
- No error message is shown (silent cancellation).
- Status bar remains unchanged.

### Disconnect While Logging

- If `ecuExplorer.disconnectDevice` is invoked while logging is active:
  1. Stop the logging session (flush and save the CSV file).
  2. Show: `"Log saved to <path>. Disconnected from <deviceName>."`
  3. Disconnect the device.

---

## Implementation Notes

### Files to Create

- **[`apps/vscode/src/device-status-bar.ts`](../apps/vscode/src/device-status-bar.ts)** — `DeviceStatusBarManager` class

### Files to Modify

- **[`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts)** — Add `activeConnection`, `onDidChangeConnection`, implement `selectDeviceAndProtocol()`, add `disconnect()`
- **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)** — Register new commands, instantiate `DeviceStatusBarManager`, update Read/Write ROM handlers to reuse active connection, set `ecuExplorer.deviceConnected` context key
- **[`apps/vscode/src/live-data-panel-manager.ts`](../apps/vscode/src/live-data-panel-manager.ts)** — Remove private `connection`/`protocol` fields; read from `deviceManager.activeConnection` instead
- **[`apps/vscode/package.json`](../apps/vscode/package.json)** — Add new commands, context key enablement conditions

### Dependency on Logging Spec

The `ecuExplorer.startLog`, `ecuExplorer.pauseLog`, `ecuExplorer.resumeLog`, and `ecuExplorer.stopLog` commands are defined here but their full implementation is described in [`specs/logging.md`](logging.md). The `DeviceStatusBarManager` subscribes to a `LoggingManager` event to update button states.

---

## Acceptance Criteria

1. When no device is connected, the status bar shows exactly one item: `$(plug) Connect` with command `ecuExplorer.connectDevice`.
2. When `ecuExplorer.connectDevice` is invoked and a device is found, `DeviceManagerImpl.activeConnection` is set to a non-undefined value.
3. When `ecuExplorer.connectDevice` succeeds, the status bar transitions to show `$(debug-disconnect) Disconnect` and `$(record) Start Log`; the Connect button is hidden.
4. When `ecuExplorer.connectDevice` is invoked while already connected, an information message is shown and no new connection is opened.
5. When `ecuExplorer.disconnectDevice` is invoked, `DeviceManagerImpl.activeConnection` becomes `undefined` and the status bar returns to the "No Connection" state.
6. The VSCode context key `ecuExplorer.deviceConnected` is `true` when `activeConnection` is set and `false` otherwise.
7. `ecuExplorer.readRomFromDevice` and `ecuExplorer.writeRomToDevice` use `deviceManager.activeConnection` if it exists, without calling `selectDeviceAndProtocol()` again.
8. If no active connection exists when Read/Write ROM is invoked, `selectDeviceAndProtocol()` is called and the resulting connection is stored as the persistent active connection.
9. If `listAllDevices()` returns an empty array, an error message is shown and the status bar remains in "No Connection" state.
10. If no protocol matches the connected device, the raw connection is closed, an error message is shown, and `activeConnection` remains `undefined`.
11. If the user cancels the device QuickPick, no error message is shown and no state changes occur.
12. If a connection error occurs during a ROM read or write, `deviceManager.disconnect()` is called, the status bar returns to "No Connection" state, and an error message is shown.
13. When `ecuExplorer.disconnectDevice` is invoked while logging is active, the log file is saved before the connection is closed.
14. `DeviceManagerImpl.onDidChangeConnection` fires exactly once when connecting and once when disconnecting.
15. `LiveDataPanelManager` reads the active connection from `deviceManager.activeConnection` rather than maintaining its own private connection field.
