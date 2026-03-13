import type {
	ConnectionState,
	DeviceConnection,
	DeviceInfo,
	DeviceManager,
	DeviceTransport,
	EcuProtocol,
	FailureCause,
} from "@ecu-explorer/device";
import * as vscode from "vscode";

/**
 * Reconnect configuration options.
 */
export interface ReconnectConfig {
	/** Maximum number of reconnection attempts (default: 5) */
	maxAttempts: number;
	/** Base delay in ms between attempts (default: 1000) */
	baseDelayMs: number;
	/** Maximum delay in ms (default: 10000) */
	maxDelayMs: number;
}

/**
 * Default reconnect configuration.
 */
const DEFAULT_RECONNECT_CONFIG = {
	maxAttempts: 5,
	baseDelayMs: 1000,
	maxDelayMs: 10000,
} satisfies ReconnectConfig;

/**
 * Represents an active device connection with its associated protocol.
 */
export interface ActiveConnection {
	connection: DeviceConnection;
	protocol: EcuProtocol;
	deviceName: string;
	/** Current connection state for reliability tracking */
	state: ConnectionState;
	/** Last failure cause if state is 'failed' */
	lastFailure?: FailureCause;
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

	/** Reconnect configuration */
	private _reconnectConfig: ReconnectConfig = DEFAULT_RECONNECT_CONFIG;

	/** Fires whenever the active connection changes (connect or disconnect). */
	private _onDidChangeConnection = new vscode.EventEmitter<
		ActiveConnection | undefined
	>();

	/** Fires whenever connection state changes. */
	private _onDidChangeState = new vscode.EventEmitter<{
		connection: ActiveConnection;
		state: ConnectionState;
		cause?: FailureCause;
	}>();

	/** Event that fires when the active connection changes. */
	readonly onDidChangeConnection: vscode.Event<ActiveConnection | undefined> =
		this._onDidChangeConnection.event;

	/** Event that fires when connection state changes. */
	readonly onDidChangeState: vscode.Event<{
		connection: ActiveConnection;
		state: ConnectionState;
		cause?: FailureCause;
	}> = this._onDidChangeState.event;

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
	async selectDeviceAndProtocol(preferredProtocolName?: string): Promise<{
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
			const device = devices[selected.index];
			if (!device) {
				throw new Error(
					"Selected device index is out of bounds for device list",
				);
			}
			selectedDevice = device;
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

		const probeOrder = this.selectProtocolOrder(preferredProtocolName);

		// Auto-detect the protocol by trying each registered protocol
		for (const protocol of probeOrder) {
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
	async connect(preferredProtocolName?: string): Promise<ActiveConnection> {
		if (this._activeConnection) {
			return this._activeConnection;
		}

		const { connection, protocol } = await this.selectDeviceAndProtocol(
			preferredProtocolName,
		);
		const deviceName = "ECU Device";

		this._activeConnection = {
			connection,
			protocol,
			deviceName,
			state: "connected",
		};
		this._onDidChangeConnection.fire(this._activeConnection);

		return this._activeConnection;
	}

	/**
	 * Build a probe order where a preferred protocol is checked first.
	 *
	 * @param preferredProtocolName - optional protocol selector
	 * @returns protocol list in probing order
	 * @throws when preferred protocol name is missing or ambiguous
	 */
	private selectProtocolOrder(preferredProtocolName?: string): EcuProtocol[] {
		if (!preferredProtocolName) {
			return [...this.protocols];
		}

		const normalizedPreferred = this.normalizeProtocolValue(
			preferredProtocolName,
		);
		const matches = this.protocols.filter((protocol) => {
			for (const token of this.buildProtocolMatchTokens(protocol.name)) {
				if (
					token === normalizedPreferred ||
					token.includes(normalizedPreferred) ||
					normalizedPreferred.includes(token)
				) {
					return true;
				}
			}
			return false;
		});

		if (matches.length === 0) {
			throw new Error(
				`Preferred protocol "${preferredProtocolName}" was not found. ` +
					`Supported protocols: ${this.protocols.map((p) => p.name).join(", ")}`,
			);
		}
		if (matches.length > 1) {
			throw new Error(
				`Protocol preference "${preferredProtocolName}" was ambiguous. ` +
					`Matches: ${matches.map((p) => p.name).join(", ")}`,
			);
		}

		const [preferredProtocol] = matches;
		if (preferredProtocol == null) {
			return [...this.protocols];
		}

		console.debug(`[ECU Protocol] Probe order: ${preferredProtocol.name}`);
		return [preferredProtocol];
	}

	/**
	 * Normalize protocol tokens for consistent matching.
	 *
	 * @param value - Raw protocol token
	 * @returns Normalized value
	 */
	private normalizeProtocolValue(value: string): string {
		return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
	}

	/**
	 * Build a small alias set for user-facing protocol overrides.
	 *
	 * @param protocolName - human-readable protocol name
	 * @returns normalized aliases
	 */
	private buildProtocolMatchTokens(protocolName: string): Set<string> {
		const normalizedName = this.normalizeProtocolValue(protocolName);
		const tokens = new Set<string>([normalizedName]);
		const addToken = (token: string) => {
			tokens.add(this.normalizeProtocolValue(token));
		};

		if (normalizedName.includes("mutii")) {
			addToken("mut2");
			addToken("mitsubishimut2");
			addToken("mitsu-mut2");
		}

		if (normalizedName.includes("mutiii")) {
			addToken("mut3");
			addToken("mitsubishimut3");
			addToken("mitsu-mut3");
		}

		if (normalizedName.includes("obd")) {
			addToken("obd2");
			addToken("obd-ii");
		}

		if (normalizedName.includes("bootloader")) {
			addToken("boot");
		}

		if (normalizedName.includes("subaru")) {
			addToken("ssm");
			addToken("ssm2");
			addToken("kwp2000");
			addToken("kwp");
		}

		if (normalizedName.includes("uds")) {
			addToken("universaldiagnosticservices");
			addToken("universal");
		}

		return tokens;
	}

	/**
	 * Update the connection state and emit state change event.
	 *
	 * @param state - New connection state
	 * @param cause - Optional failure cause
	 */
	private setConnectionState(
		state: ConnectionState,
		cause?: FailureCause,
	): void {
		if (!this._activeConnection) return;

		this._activeConnection.state = state;
		if (cause) {
			this._activeConnection.lastFailure = cause;
		}

		// Build event payload, omitting cause if undefined
		const eventPayload: {
			connection: ActiveConnection;
			state: ConnectionState;
			cause?: FailureCause;
		} = {
			connection: this._activeConnection,
			state,
		};
		if (cause) {
			eventPayload.cause = cause;
		}

		this._onDidChangeState.fire(eventPayload);
	}

	/**
	 * Attempt to reconnect the active connection.
	 * Uses exponential backoff with jitter.
	 *
	 * @param operationType - Type of operation (read/logging vs write)
	 * @returns True if reconnection successful
	 */
	async reconnectActiveConnection(
		operationType: "read" | "logging" | "write",
	): Promise<boolean> {
		if (!this._activeConnection) {
			return false;
		}

		// For write operations, fail fast - no reconnect
		if (operationType === "write") {
			this.setConnectionState("failed", "TRANSPORT_ERROR");
			return false;
		}

		const { maxAttempts, baseDelayMs, maxDelayMs } = this._reconnectConfig;
		const deviceId = this._activeConnection.connection.deviceInfo.id;
		const transportName =
			this._activeConnection.connection.deviceInfo.transportName;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			this.setConnectionState("reconnecting");

			// Emit reconnect attempt event
			this._onDidChangeState.fire({
				connection: this._activeConnection,
				state: "reconnecting",
			});

			try {
				// Get the transport
				const transport = this.transports.get(transportName);
				if (!transport) {
					throw new Error(`Transport ${transportName} not found`);
				}

				// Attempt to reconnect
				const newConnection = await transport.connect(deviceId);

				// Update the connection
				this._activeConnection.connection = newConnection;
				this.setConnectionState("connected");

				// Emit success event
				this._onDidChangeState.fire({
					connection: this._activeConnection,
					state: "connected",
				});

				return true;
			} catch {
				// Wait with exponential backoff + jitter
				if (attempt < maxAttempts) {
					const delay = Math.min(
						baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500,
						maxDelayMs,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		// All attempts failed
		this.setConnectionState("failed", "TRANSPORT_ERROR");
		return false;
	}

	/**
	 * Get the current connection state.
	 */
	getConnectionState(): ConnectionState | undefined {
		return this._activeConnection?.state;
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
		this._onDidChangeState.dispose();
		this.transports.clear();
		this.protocols = [];
	}
}
