import * as vscode from "vscode";
import type { ActiveConnection, DeviceManagerImpl } from "./device-manager";

/**
 * Manages the ECU Explorer status bar items for device connection and logging state.
 *
 * Shows/hides items based on connection state:
 * - Disconnected: shows Connect button
 * - Connected: shows Disconnect button + Start Log button
 * - Connected + Logging: shows Disconnect button + Pause/Resume Log + Stop Log buttons
 */
export class DeviceStatusBarManager implements vscode.Disposable {
	private connectItem: vscode.StatusBarItem;
	private disconnectItem: vscode.StatusBarItem;
	private startLogItem: vscode.StatusBarItem;
	private pauseLogItem: vscode.StatusBarItem;
	private stopLogItem: vscode.StatusBarItem;

	private loggingState: "idle" | "recording" | "paused" = "idle";
	private disposables: vscode.Disposable[] = [];

	constructor(private deviceManager: DeviceManagerImpl) {
		// Create Connect button (shown when disconnected)
		this.connectItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.connectItem.text = "$(plug) Connect";
		this.connectItem.command = "ecuExplorer.connectDevice";
		this.connectItem.tooltip = "Connect to ECU device";

		// Create Disconnect button (shown when connected)
		this.disconnectItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.disconnectItem.text = "$(debug-disconnect) Disconnect";
		this.disconnectItem.command = "ecuExplorer.disconnectDevice";

		// Create Start Log button (shown when connected, not logging)
		this.startLogItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			99,
		);
		this.startLogItem.text = "$(record) Start Log";
		this.startLogItem.command = "ecuExplorer.startLog";
		this.startLogItem.tooltip = "Start recording live data to CSV";

		// Create Pause/Resume Log button (shown when logging)
		this.pauseLogItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			98,
		);

		// Create Stop Log button (shown when logging)
		this.stopLogItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			99,
		);
		this.stopLogItem.text = "$(primitive-square) Stop Log";
		this.stopLogItem.command = "ecuExplorer.stopLog";
		this.stopLogItem.tooltip = "Stop recording and save CSV";

		// Subscribe to connection changes
		this.disposables.push(
			deviceManager.onDidChangeConnection((conn) => {
				this.update(conn);
			}),
		);

		// Initial render
		this.update(deviceManager.activeConnection);
	}

	/**
	 * Update status bar items based on connection state.
	 *
	 * @param connection - The current active connection, or undefined if disconnected
	 */
	private update(connection: ActiveConnection | undefined): void {
		if (!connection) {
			// Disconnected state: show Connect, hide everything else
			this.connectItem.show();
			this.disconnectItem.hide();
			this.startLogItem.hide();
			this.pauseLogItem.hide();
			this.stopLogItem.hide();
			// Reset logging state
			this.loggingState = "idle";
		} else {
			// Connected state: hide Connect, show Disconnect
			this.connectItem.hide();
			this.disconnectItem.show();
			this.disconnectItem.tooltip = `Disconnect from ${connection.deviceName}`;

			// Show log items based on logging state
			this.updateLogItems();
		}
	}

	/**
	 * Update log-related status bar items based on current logging state.
	 */
	private updateLogItems(): void {
		if (this.loggingState === "idle") {
			// Not logging: show Start Log, hide Pause/Stop
			this.startLogItem.show();
			this.pauseLogItem.hide();
			this.stopLogItem.hide();
		} else if (this.loggingState === "recording") {
			// Recording: hide Start Log, show Pause + Stop
			this.startLogItem.hide();
			this.pauseLogItem.text = "$(debug-pause) Pause Log";
			this.pauseLogItem.command = "ecuExplorer.pauseLog";
			this.pauseLogItem.tooltip = "Pause log recording";
			this.pauseLogItem.show();
			this.stopLogItem.show();
		} else if (this.loggingState === "paused") {
			// Paused: hide Start Log, show Resume + Stop
			this.startLogItem.hide();
			this.pauseLogItem.text = "$(debug-continue) Resume Log";
			this.pauseLogItem.command = "ecuExplorer.resumeLog";
			this.pauseLogItem.tooltip = "Resume log recording";
			this.pauseLogItem.show();
			this.stopLogItem.show();
		}
	}

	/**
	 * Update the logging state and refresh status bar items.
	 * Called when logging state changes (started/paused/resumed/stopped).
	 *
	 * @param state - The new logging state
	 */
	updateLoggingState(state: "idle" | "recording" | "paused"): void {
		this.loggingState = state;
		if (this.deviceManager.activeConnection) {
			this.updateLogItems();
		}
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.connectItem.dispose();
		this.disconnectItem.dispose();
		this.startLogItem.dispose();
		this.pauseLogItem.dispose();
		this.stopLogItem.dispose();
	}
}
