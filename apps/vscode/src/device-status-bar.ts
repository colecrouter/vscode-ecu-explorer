import {
	formatWidebandReading,
	type WidebandReading,
} from "@ecu-explorer/wideband";
import * as vscode from "vscode";
import type { ActiveConnection, DeviceManagerImpl } from "./device-manager.js";
import {
	createHardwareCandidate,
	formatHardwareRuntime,
	type HardwareSelectionService,
} from "./hardware-selection.js";
import type { ActiveWidebandSession } from "./wideband-manager.js";

export interface WidebandStatusSource {
	readonly activeSession: ActiveWidebandSession | undefined;
	readonly latestReading: WidebandReading | undefined;
	onDidChangeSession(
		listener: (session: ActiveWidebandSession | undefined) => void,
	): vscode.Disposable;
	onDidChangeReading(
		listener: (reading: WidebandReading | undefined) => void,
	): vscode.Disposable;
}

/**
 * Manages the ECU Explorer status bar items for device connection and logging state.
 *
 * Shows/hides items based on connection state:
 * - Disconnected: shows Connect button
 * - Connected: shows Disconnect button + Start Log button
 * - Connected + Logging: shows Disconnect button + Pause/Resume Log + Stop Log buttons
 */
export class DeviceStatusBarManager implements vscode.Disposable {
	private hardwareItem: vscode.StatusBarItem;
	private widebandItem: vscode.StatusBarItem;
	private connectItem: vscode.StatusBarItem;
	private disconnectItem: vscode.StatusBarItem;
	private startLogItem: vscode.StatusBarItem;
	private pauseLogItem: vscode.StatusBarItem;
	private stopLogItem: vscode.StatusBarItem;

	private loggingState: "idle" | "recording" | "paused" = "idle";
	private activeWidebandSession: ActiveWidebandSession | undefined;
	private latestWidebandReading: WidebandReading | undefined;
	private disposables: vscode.Disposable[] = [];

	constructor(
		private deviceManager: DeviceManagerImpl,
		private hardwareSelectionService?: HardwareSelectionService,
		widebandManager?: WidebandStatusSource,
	) {
		this.hardwareItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			101,
		);
		this.hardwareItem.command = "ecuExplorer.manageHardware";
		this.widebandItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.widebandItem.command = "ecuExplorer.connectWideband";

		// Create Connect button (shown when disconnected)
		this.connectItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.connectItem.text = "$(plug)";
		this.connectItem.command = "ecuExplorer.connectDevice";
		this.connectItem.tooltip = "Connect ECU";

		// Create Disconnect button (shown when connected)
		this.disconnectItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.disconnectItem.text = "$(debug-disconnect)";
		this.disconnectItem.command = "ecuExplorer.disconnectDevice";
		this.disconnectItem.tooltip = "Disconnect ECU";

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
			deviceManager.onDidChangeState(({ connection }) => {
				this.update(connection);
			}),
		);
		if (widebandManager != null) {
			this.activeWidebandSession = widebandManager.activeSession;
			this.latestWidebandReading = widebandManager.latestReading;
			this.disposables.push(
				widebandManager.onDidChangeSession((session) => {
					this.activeWidebandSession = session;
					if (session == null) {
						this.latestWidebandReading = undefined;
					}
					this.update(this.deviceManager.activeConnection);
				}),
				widebandManager.onDidChangeReading((reading) => {
					this.latestWidebandReading = reading;
					this.updateWidebandItem();
				}),
			);
		}

		// Initial render
		this.update(deviceManager.activeConnection);
	}

	/**
	 * Update status bar items based on connection state.
	 *
	 * @param connection - The current active connection, or undefined if disconnected
	 */
	private update(connection: ActiveConnection | undefined): void {
		this.updateHardwareItem(connection);
		this.updateWidebandItem();
		if (!connection || connection.state === "failed") {
			// Disconnected state: show Connect, hide everything else
			this.connectItem.text =
				connection?.state === "failed" ? "$(plug)" : "$(plug)";
			this.connectItem.tooltip =
				connection?.state === "failed"
					? `Retry connection to ${connection.deviceName}`
					: "Connect ECU";
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

	private updateHardwareItem(connection: ActiveConnection | undefined): void {
		this.hardwareItem.show();
		if (connection != null) {
			const runtime = formatHardwareRuntime(
				createHardwareCandidate(
					connection.connection.deviceInfo,
					connection.locality,
				),
			);
			if (connection.state === "reconnecting") {
				this.hardwareItem.text = `$(sync~spin) ${runtime}`;
				this.hardwareItem.tooltip = `${connection.deviceName}\n${runtime}\nAttempting to reconnect`;
				return;
			}
			if (connection.state === "failed") {
				this.hardwareItem.text = `$(warning) ${runtime}`;
				this.hardwareItem.tooltip = `${connection.deviceName}\n${runtime}\nHardware is currently unavailable. Connect to retry or manage hardware devices.`;
				return;
			}
			if (connection.state === "degraded") {
				this.hardwareItem.text = `$(warning) ${runtime}`;
				this.hardwareItem.tooltip = `${connection.deviceName}\n${runtime}\nConnection is degraded but still active`;
				return;
			}
			this.hardwareItem.text = `$(chip) ${runtime}`;
			this.hardwareItem.tooltip = `${connection.deviceName}\n${runtime}\nManage remembered hardware devices`;
			return;
		}

		const rememberedSelection = this.hardwareSelectionService?.getSelection();
		if (rememberedSelection != null) {
			const runtime = formatHardwareRuntime(
				createHardwareCandidate(
					{
						id: rememberedSelection.id,
						name: rememberedSelection.name,
						transportName: rememberedSelection.transportName,
						connected: false,
					},
					rememberedSelection.locality ?? "extension-host",
				),
			);
			this.hardwareItem.text = `$(chip) ${rememberedSelection.name}`;
			this.hardwareItem.tooltip = `${runtime}\nRemembered hardware device\nManage remembered hardware devices`;
			return;
		}

		this.hardwareItem.text = "$(chip) Manage Hardware";
		this.hardwareItem.text = "$(chip)";
		this.hardwareItem.tooltip = "Manage Hardware";
	}

	private updateWidebandItem(): void {
		if (this.activeWidebandSession == null) {
			this.widebandItem.text = "$(dashboard)";
			this.widebandItem.tooltip = "Connect Wideband";
			this.widebandItem.command = "ecuExplorer.connectWideband";
			this.widebandItem.show();
			return;
		}

		const runtime = formatHardwareRuntime(this.activeWidebandSession.candidate);
		const deviceName = this.activeWidebandSession.candidate.device.name;
		if (this.latestWidebandReading != null) {
			this.widebandItem.text = `$(dashboard) ${formatWidebandReading(this.latestWidebandReading)}`;
			this.widebandItem.tooltip = `${deviceName}\n${runtime}\n${formatWidebandReading(this.latestWidebandReading)}\nDisconnect wideband`;
		} else {
			this.widebandItem.text = `$(dashboard) ${runtime}`;
			this.widebandItem.tooltip = `${deviceName}\n${runtime}\nWaiting for wideband readings`;
		}
		this.widebandItem.command = "ecuExplorer.disconnectWideband";
		this.widebandItem.show();
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
		this.hardwareItem.dispose();
		this.widebandItem.dispose();
		this.connectItem.dispose();
		this.disconnectItem.dispose();
		this.startLogItem.dispose();
		this.pauseLogItem.dispose();
		this.stopLogItem.dispose();
	}
}
