import type {
	DeviceInfo,
	DtcCode,
	EcuEvent,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataSession,
	PidDescriptor,
	RomProgress,
	WriteOptions,
} from "./types.js";

/**
 * Abstracts a physical USB/Serial hardware interface.
 *
 * Implementations:
 * - OpenPort2Transport: Tactrix OpenPort 2.0 via navigator.usb
 * - (future) ELM327Transport: ELM327 adapters via navigator.serial
 * - (future) BluetoothTransport: Bluetooth OBD-II adapters
 */
export interface DeviceTransport {
	/** Human-readable name, e.g. "Tactrix OpenPort 2.0" */
	readonly name: string;

	/**
	 * Enumerate connected devices of this type.
	 * On first call, triggers the browser USB device picker via
	 * `workbench.experimental.requestUsbDevice`.
	 */
	listDevices(): Promise<DeviceInfo[]>;

	/** Open a connection to a specific device by ID */
	connect(deviceId: string): Promise<DeviceConnection>;
}

/**
 * An open, active connection to a hardware device.
 * Exposes raw frame-level send/receive for use by EcuProtocol implementations.
 */
export interface DeviceConnection {
	readonly deviceInfo: DeviceInfo;

	/**
	 * Send a protocol frame and wait for a response.
	 * The frame format is transport-specific (e.g., AT command for OpenPort 2.0).
	 */
	sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;

	/**
	 * Start receiving frames asynchronously (for live data streaming).
	 * Calls onFrame for each received frame until stopStream() is called.
	 */
	startStream(onFrame: (frame: Uint8Array) => void): void;
	stopStream(): void;

	close(): Promise<void>;
}

/**
 * Abstracts an ECU diagnostic protocol.
 *
 * All methods are optional — implementations declare which capabilities
 * they support. The extension checks for method presence before showing
 * related commands.
 *
 * Implementations:
 * - Mut3Protocol: MUT-III for Mitsubishi ECUs (ref: libmut)
 * - Obd2Protocol: Generic OBD-II Mode 01 (live data only, no security)
 * - (future) SsmProtocol: Subaru Select Monitor
 * - (future) Kwp2000Protocol: KWP2000 for older Mitsubishi/European ECUs
 */
export interface EcuProtocol {
	/** Human-readable name, e.g. "MUT-III (Mitsubishi)" */
	readonly name: string;

	/**
	 * Probe the connection to determine if this protocol can communicate
	 * with the connected ECU. Used for auto-detection.
	 */
	canHandle(connection: DeviceConnection): Promise<boolean>;

	// ── ROM Operations ──────────────────────────────────────────────────────

	/**
	 * Read the full ROM binary from the ECU.
	 * Requires security access (seed/key handshake) for most ECUs.
	 * Reports progress via onProgress callback.
	 */
	readRom?(
		connection: DeviceConnection,
		onProgress: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<Uint8Array>;

	/**
	 * Write a ROM binary to the ECU.
	 * HIGH RISK: A failed or interrupted flash can brick the ECU.
	 * Implementations must verify checksum before erasing flash.
	 */
	writeRom?(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress: (progress: RomProgress) => void,
		options?: WriteOptions,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void>;

	/**
	 * Perform a "Dry Run" of the write process.
	 * Simulates the communication without actually erasing or writing flash.
	 * Used to verify connection stability and security access.
	 */
	dryRunWrite?(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void>;

	// ── Diagnostics ─────────────────────────────────────────────────────────

	/** Read stored diagnostic trouble codes (DTCs) */
	readDtcs?(connection: DeviceConnection): Promise<DtcCode[]>;

	/** Clear all stored DTCs */
	clearDtcs?(connection: DeviceConnection): Promise<void>;

	// ── Live Data ────────────────────────────────────────────────────────────

	/**
	 * Return the list of PIDs (parameter IDs) supported by this ECU.
	 * Used to populate the live data PID selector UI.
	 */
	getSupportedPids?(connection: DeviceConnection): Promise<PidDescriptor[]>;

	/**
	 * Begin streaming live data for the specified PIDs.
	 * Returns a LiveDataSession that can be used to stop streaming
	 * and optionally record the session to a file.
	 */
	streamLiveData?(
		connection: DeviceConnection,
		pids: number[],
		onFrame: (frame: LiveDataFrame) => void,
		onHealth?: (health: LiveDataHealth) => void,
	): LiveDataSession;
}

/**
 * Registered in the extension host. Manages transport and protocol registries.
 */
export interface DeviceManager {
	registerTransport(id: string, transport: DeviceTransport): void;
	registerProtocol(protocol: EcuProtocol): void;

	/** List all connected devices across all registered transports */
	listAllDevices(): Promise<DeviceInfo[]>;

	/**
	 * Show a QuickPick to select a device, then auto-detect the ECU protocol.
	 * Returns the matched protocol and open connection.
	 */
	selectDeviceAndProtocol(): Promise<{
		connection: DeviceConnection;
		protocol: EcuProtocol;
	}>;

	dispose(): void;
}

export * from "./diff.js";
export * from "./types.js";
