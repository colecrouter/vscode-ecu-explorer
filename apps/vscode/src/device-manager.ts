import type {
	DeviceConnection,
	DeviceInfo,
	DeviceManager,
	DeviceTransport,
	EcuProtocol,
} from "@ecu-explorer/device";
import * as vscode from "vscode";

/**
 * Represents an active device connection with its associated protocol.
 */
export interface ActiveConnection {
	connection: DeviceConnection;
	protocol: EcuProtocol;
	deviceName: string;
}

/**
 * Implementation of DeviceManager.
 * Manages registration of transports and protocols, and provides
 * device enumeration and protocol auto-detection.
 */
export class DeviceManagerImpl implements DeviceManager {
	private transports = new Map<string, DeviceTransport>();
	private protocols: EcuProtocol[] = [];

	/** The currently active connection, or undefined if not connected. */
	private _activeConnection: ActiveConnection | undefined;

	/** Fires whenever the active connection changes (connect or disconnect). */
	private _onDidChangeConnection = new vscode.EventEmitter<
		ActiveConnection | undefined
	>();

	/** Event that fires when the active connection changes. */
	readonly onDidChangeConnection: vscode.Event<ActiveConnection | undefined> =
		this._onDidChangeConnection.event;

	/**
	 * Returns the current active connection, or undefined if not connected.
	 */
	get activeConnection(): ActiveConnection | undefined {
		return this._activeConnection;
	}

	/**
	 * Register a transport by name.
	 *
	 * @param id - Unique identifier for the transport (e.g. "openport2")
	 * @param transport - The DeviceTransport implementation to register
	 */
	registerTransport(id: string, transport: DeviceTransport): void {
		this.transports.set(id, transport);
	}

	/**
	 * Register an ECU protocol.
	 *
	 * @param protocol - The EcuProtocol implementation to register
	 */
	registerProtocol(protocol: EcuProtocol): void {
		this.protocols.push(protocol);
	}

	/**
	 * Retrieve a registered transport by name.
	 *
	 * @param name - The transport identifier used during registration
	 * @returns The registered DeviceTransport, or undefined if not found
	 */
	getTransport(name: string): DeviceTransport | undefined {
		return this.transports.get(name);
	}

	/**
	 * Return all registered ECU protocols.
	 *
	 * @returns Array of all registered EcuProtocol instances
	 */
	getProtocols(): EcuProtocol[] {
		return [...this.protocols];
	}

	/**
	 * List all connected devices across all registered transports.
	 * Queries each transport in parallel and aggregates results.
	 *
	 * @returns Array of DeviceInfo for all discovered devices
	 */
	async listAllDevices(): Promise<DeviceInfo[]> {
		const allDevices: DeviceInfo[] = [];
		for (const transport of this.transports.values()) {
			try {
				const devices = await transport.listDevices();
				allDevices.push(...devices);
			} catch {
				// Ignore errors from individual transports (e.g. no USB access)
			}
		}
		return allDevices;
	}

	/**
	 * Select a device and auto-detect protocol.
	 * Stores the result as the active connection and fires onDidChangeConnection.
	 *
	 * Auto-detection tries all registered protocols in order, returning the first
	 * that reports `canHandle() === true` for the selected device and transport.
	 *
	 * @returns The connection and matched protocol
	 * @throws If no devices found, user cancels, or no protocol matches
	 */
	async selectDeviceAndProtocol(): Promise<{
		connection: DeviceConnection;
		protocol: EcuProtocol;
	}> {
		// List all available devices across all transports
		const devices = await this.listAllDevices();
		if (devices.length === 0) {
			throw new Error(
				"No devices found. Ensure device is connected and transport is available.",
			);
		}

		// Create a list of device options for the user to select from
		const deviceQuickPicks = devices.map((device, index) => ({
			label: `${device.name} (${device.transportName})`,
			description: `ID: ${device.id}`,
			index,
		}));

		// If only one device, select it automatically
		let selectedDevice: DeviceInfo | undefined = devices[0];
		if (devices.length > 1) {
			const selected = await vscode.window.showQuickPick(deviceQuickPicks, {
				placeHolder: "Select a device to connect",
			});
			if (!selected) {
				throw new Error("Device selection cancelled by user");
			}
			selectedDevice = devices[selected.index]!;
		}

		if (!selectedDevice) {
			throw new Error("No device selected");
		}

		// Get the transport for this device
		const transport = this.getTransport(selectedDevice.transportName);
		if (!transport) {
			throw new Error(
				`Transport "${selectedDevice.transportName}" not registered`,
			);
		}

		// Open a connection to the device
		const connection = await transport.connect(selectedDevice.id);

		// Auto-detect the protocol by trying each registered protocol
		for (const protocol of this.protocols) {
			try {
				if (await protocol.canHandle(connection)) {
					vscode.window.showInformationMessage(
						`Connected using ${protocol.name}`,
					);
					return { connection, protocol };
				}
			} catch {
				// Continue to next protocol if canHandle fails
			}
		}

		// No protocol matched
		await connection.close();
		throw new Error(
			`No protocol matched for device "${selectedDevice.name}". ` +
				`Supported protocols: ${this.protocols.map((p) => p.name).join(", ")}`,
		);
	}

	/**
	 * Connect to a device by selecting it and auto-detecting the protocol.
	 * If already connected, returns the existing connection.
	 * Stores the result as the active connection and fires onDidChangeConnection.
	 *
	 * @returns The active connection
	 * @throws If no devices found, user cancels, or no protocol matches
	 */
	async connect(): Promise<ActiveConnection> {
		if (this._activeConnection) {
			return this._activeConnection;
		}

		const { connection, protocol } = await this.selectDeviceAndProtocol();
		const deviceName = "ECU Device";

		this._activeConnection = { connection, protocol, deviceName };
		this._onDidChangeConnection.fire(this._activeConnection);

		return this._activeConnection;
	}

	/**
	 * Disconnect the active connection.
	 * Calls connection.close(), clears _activeConnection, fires onDidChangeConnection(undefined).
	 */
	async disconnect(): Promise<void> {
		if (!this._activeConnection) {
			return;
		}

		await this._activeConnection.connection.close();
		this._activeConnection = undefined;
		this._onDidChangeConnection.fire(undefined);
	}

	/**
	 * Dispose the device manager, disconnecting any active connection and clearing state.
	 */
	dispose(): void {
		// Disconnect asynchronously (fire and forget)
		this.disconnect().catch(() => {
			// Ignore errors during dispose
		});
		this._onDidChangeConnection.dispose();
		this.transports.clear();
		this.protocols = [];
	}
}
