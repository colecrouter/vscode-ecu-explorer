import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
	EcuProtocol,
} from "./index.js";
import type {
	EcuEvent,
	LiveDataFrame,
	LiveDataHealth,
	RomProgress,
} from "./types.js";

import { createTraceCallback, type TraceWriter } from "./trace.js";

/**
 * Diagnostic workflow stages.
 */
export enum DiagnosticStage {
	ENUMERATE = "enumerate",
	CONNECT = "connect",
	INITIALIZE = "initialize",
	PROBE = "probe",
	OPERATION = "operation",
}

/**
 * Diagnostic workflow status.
 */
export enum DiagnosticStatus {
	START = "start",
	SUCCESS = "success",
	FAILURE = "failure",
}

/**
 * Event emitted during diagnostics.
 */
export interface DiagnosticEvent {
	stage: DiagnosticStage;
	status: DiagnosticStatus;
	timestamp: number;
	duration?: number;
	summary: string;
	details?: Record<string, unknown>;
}

/**
 * Options for running diagnostics.
 */
export interface DiagnosticOptions {
	/** Specific device ID, or first available if not provided */
	deviceId?: string;
	/** Protocols to probe */
	protocols: EcuProtocol[];
	/** Optional operation to run */
	operation?: "none" | "log" | "read-rom";
	/** PIDs for log operations */
	logPids?: number[];
	/** Duration in ms for log probe */
	logDuration?: number;
	/** Read-ROM dry-run mode */
	readRomDryRun?: boolean;
	/** Optional note for where ROM output was written */
	readRomOutPath?: string;
	/** Callback for diagnostic events */
	onEvent?: (event: DiagnosticEvent) => void;
	/** Optional trace writer for capturing structured events */
	traceWriter?: TraceWriter | null;
}

/**
 * Result of diagnostics.
 */
export interface DiagnosticResult {
	device: DeviceInfo | null;
	connection: DeviceConnection | null;
	protocol: EcuProtocol | null;
	operationResult?: {
		type: "none" | "log" | "read-rom";
		data: Record<string, unknown>;
		rom?: Uint8Array;
	};
	events: DiagnosticEvent[];
	error?: Error;
}

/**
 * Extended DeviceConnection interface that includes optional initialize method.
 */
interface InitializableConnection extends DeviceConnection {
	initialize?(): Promise<void>;
}

/**
 * Emits a diagnostic event and calls the callback if provided.
 */
function emitEvent(
	events: DiagnosticEvent[],
	options: DiagnosticOptions,
	stage: DiagnosticStage,
	status: DiagnosticStatus,
	summary: string,
	details?: Record<string, unknown>,
): void {
	const timestamp = Date.now();
	const event: DiagnosticEvent = {
		stage,
		status,
		timestamp,
		summary,
	};
	// Only add details if provided (handles exactOptionalPropertyTypes)
	if (details !== undefined) {
		event.details = details;
	}
	events.push(event);
	options.onEvent?.(event);
}

/**
 * Run a staged device diagnostic workflow.
 *
 * This function performs the following stages:
 * 1. Enumerate devices from the transport
 * 2. Select a device by explicit ID or first available
 * 3. Connect and initialize the transport
 * 4. Probe registered protocols through canHandle()
 * 5. Run optional operation stages (log or read-rom)
 *
 * @param transport - The device transport to use
 * @param options - Diagnostic configuration options
 * @returns DiagnosticResult with device, connection, protocol, events, and optional error
 */
export async function runDiagnostic(
	transport: DeviceTransport,
	options: DiagnosticOptions,
): Promise<DiagnosticResult> {
	const events: DiagnosticEvent[] = [];
	const LOG_FRAME_SAMPLE_LIMIT = 12;

	// Create trace callback if trace writer is provided
	const traceCallback = createTraceCallback(options.traceWriter ?? null);
	const effectiveOptions: DiagnosticOptions = {
		...options,
		onEvent: (event: DiagnosticEvent) => {
			// Call original callback if provided
			options.onEvent?.(event);
			// Also write to trace if available
			traceCallback?.(event);
		},
	};

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 1: Enumerate devices
	// ─────────────────────────────────────────────────────────────────────────────
	let stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.ENUMERATE,
		DiagnosticStatus.START,
		"Enumerating devices...",
	);

	let devices: DeviceInfo[];
	try {
		devices = await transport.listDevices();
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.SUCCESS,
			`Found ${devices.length} device(s)`,
			{ deviceCount: devices.length, duration },
		);
	} catch (error) {
		const duration = Date.now() - stageStartTime;
		const err = error instanceof Error ? error : new Error(String(error));
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.FAILURE,
			`Failed to enumerate devices: ${err.message}`,
			{ duration },
		);
		return {
			device: null,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 2: Select device
	// ─────────────────────────────────────────────────────────────────────────────
	let selectedDevice: DeviceInfo | null = null;

	if (options.deviceId) {
		// Use explicit device ID
		selectedDevice = devices.find((d) => d.id === options.deviceId) ?? null;
		if (!selectedDevice) {
			const err = new Error(`Device not found: ${options.deviceId}`);
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.ENUMERATE,
				DiagnosticStatus.FAILURE,
				err.message,
			);
			return {
				device: null,
				connection: null,
				protocol: null,
				events,
				error: err,
			};
		}
	} else {
		// Use first available device
		selectedDevice = devices[0] ?? null;
	}

	if (!selectedDevice) {
		const err = new Error("No devices available");
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.FAILURE,
			err.message,
		);
		return {
			device: null,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 3: Connect to device
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.CONNECT,
		DiagnosticStatus.START,
		`Connecting to ${selectedDevice.name}...`,
		{ deviceId: selectedDevice.id },
	);

	let connection: InitializableConnection | null = null;
	try {
		connection = (await transport.connect(
			selectedDevice.id,
		)) as InitializableConnection;
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.CONNECT,
			DiagnosticStatus.SUCCESS,
			`Connected to ${selectedDevice.name}`,
			{ deviceId: selectedDevice.id, duration },
		);
	} catch (error) {
		const duration = Date.now() - stageStartTime;
		const err = error instanceof Error ? error : new Error(String(error));
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.CONNECT,
			DiagnosticStatus.FAILURE,
			`Failed to connect: ${err.message}`,
			{ deviceId: selectedDevice.id, duration },
		);
		return {
			device: selectedDevice,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 4: Initialize connection (if available)
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();

	if (typeof connection.initialize === "function") {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.INITIALIZE,
			DiagnosticStatus.START,
			"Initializing connection...",
		);

		try {
			await connection.initialize();
			const duration = Date.now() - stageStartTime;
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.INITIALIZE,
				DiagnosticStatus.SUCCESS,
				"Connection initialized",
				{ duration },
			);
		} catch (error) {
			const duration = Date.now() - stageStartTime;
			const err = error instanceof Error ? error : new Error(String(error));
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.INITIALIZE,
				DiagnosticStatus.FAILURE,
				`Failed to initialize: ${err.message}`,
				{ duration },
			);
			// Close connection on initialization failure
			await connection.close();
			return {
				device: selectedDevice,
				connection: null,
				protocol: null,
				events,
				error: err,
			};
		}
	} else {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.INITIALIZE,
			DiagnosticStatus.SUCCESS,
			"Initialization skipped (not supported)",
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 5: Probe protocols
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.PROBE,
		DiagnosticStatus.START,
		"Probing protocols...",
		{ protocolCount: options.protocols.length },
	);

	let matchedProtocol: EcuProtocol | null = null;

	for (const protocol of options.protocols) {
		try {
			const canHandle = await protocol.canHandle(connection);
			if (canHandle) {
				matchedProtocol = protocol;
				const duration = Date.now() - stageStartTime;
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.PROBE,
					DiagnosticStatus.SUCCESS,
					`Matched protocol: ${protocol.name}`,
					{ protocol: protocol.name, duration },
				);
				break;
			}
		} catch (error) {
			// Continue probing other protocols on error
			const err = error instanceof Error ? error : new Error(String(error));
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.PROBE,
				DiagnosticStatus.FAILURE,
				`Protocol ${protocol.name} probe failed: ${err.message}`,
				{ protocol: protocol.name },
			);
		}
	}

	if (!matchedProtocol) {
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.PROBE,
			DiagnosticStatus.FAILURE,
			"No matching protocol found",
			{ duration },
		);
		// Don't return here - allow operation stage to run even without protocol
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 6: Run optional operation
	// ─────────────────────────────────────────────────────────────────────────────
	const operation = options.operation ?? "none";

	if (operation === "none") {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.OPERATION,
			DiagnosticStatus.SUCCESS,
			"No operation requested",
		);
	} else if (operation === "log") {
		stageStartTime = Date.now();
		const pids = options.logPids ?? [0x0c];
		const duration = options.logDuration ?? 1000;

		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.OPERATION,
			DiagnosticStatus.START,
			`Starting log probe for ${duration}ms`,
			{ operation, duration, pids },
		);

		if (!matchedProtocol?.streamLiveData) {
			const duration = Date.now() - stageStartTime;
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.FAILURE,
				"Protocol does not support live data streaming",
				{ operation, duration, pids },
			);
			return {
				device: selectedDevice,
				connection,
				protocol: matchedProtocol,
				events,
				error: new Error(
					`Protocol ${matchedProtocol?.name ?? "none"} does not support live data streaming`,
				),
			};
		}

		let frames = 0;
		let lastHealth: LiveDataHealth | null = null;
		const sampledFrames: LiveDataFrame[] = [];

		try {
			const session = matchedProtocol.streamLiveData(
				connection,
				pids,
				(frame) => {
					frames += 1;
					if (sampledFrames.length < LOG_FRAME_SAMPLE_LIMIT) {
						sampledFrames.push(frame);
					}
				},
				(health) => {
					lastHealth = health;
				},
			);

			await new Promise((resolve) => setTimeout(resolve, duration));
			session.stop();

			const summary = {
				type: "log",
				operation,
				pids,
				duration,
				frames,
				sampledFrames,
				sampleLimit: LOG_FRAME_SAMPLE_LIMIT,
				health: lastHealth ?? undefined,
			};

			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.SUCCESS,
				`Log probe completed (${frames} frames)`,
				summary,
			);

			return {
				device: selectedDevice,
				connection,
				protocol: matchedProtocol,
				operationResult: {
					type: "log",
					data: summary,
				},
				events,
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const elapsed = Date.now() - stageStartTime;
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.FAILURE,
				`Log probe failed: ${err.message}`,
				{ operation, duration, frames, pids, elapsed },
			);
			return {
				device: selectedDevice,
				connection,
				protocol: matchedProtocol,
				events,
				error: err,
			};
		}
	} else if (matchedProtocol) {
		stageStartTime = Date.now();

		if (operation === "read-rom") {
			// Run ROM read dry-run or full read
			const isDryRun = options.readRomDryRun ?? false;
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.START,
				isDryRun
					? "Starting ROM dry-run path"
					: "Starting ROM read",
				{
					operation,
					dryRun: isDryRun,
				},
			);

			const progressState: RomProgress = {
				phase: "reading",
				bytesProcessed: 0,
				totalBytes: 0,
				percentComplete: 0,
			};
			const eventTypes = new Set<string>();
			const onProgress = (progress: RomProgress) => {
				progressState.phase = progress.phase;
				progressState.bytesProcessed = progress.bytesProcessed;
				progressState.totalBytes = progress.totalBytes;
				progressState.percentComplete = progress.percentComplete;
				if (progress.estimatedSecondsRemaining !== undefined) {
					progressState.estimatedSecondsRemaining = progress.estimatedSecondsRemaining;
				}
				if (progress.message !== undefined) {
					progressState.message = progress.message;
				}
			};
			const onEvent = (event: EcuEvent) => {
				eventTypes.add(event.type);
			};

			if (isDryRun) {
				if (!matchedProtocol.dryRunWrite) {
					const err = new Error(
						`${matchedProtocol.name} does not expose a dry-run path; run without --dry-run`,
					);
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.FAILURE,
						err.message,
						{
							operation,
							dryRun: isDryRun,
							protocol: matchedProtocol.name,
						},
					);
					return {
						device: selectedDevice,
						connection,
						protocol: matchedProtocol,
						events,
						error: err,
					};
				}

				try {
					const fakeRom = new Uint8Array(256);
					await matchedProtocol.dryRunWrite(
						connection,
						fakeRom,
						onProgress,
						onEvent,
					);
					const duration = Date.now() - stageStartTime;
					const summary = {
						type: "read-rom",
						operation,
						protocol: matchedProtocol.name,
						dryRun: true,
						duration,
						...progressState,
						ecuEvents: [...eventTypes],
					};

					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.SUCCESS,
						"ROM dry-run completed",
						summary,
					);
					return {
						device: selectedDevice,
						connection,
						protocol: matchedProtocol,
						operationResult: { type: "read-rom", data: summary },
						events,
					};
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					const duration = Date.now() - stageStartTime;
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.FAILURE,
						`ROM dry-run failed: ${err.message}`,
						{
							operation,
							dryRun: isDryRun,
							duration,
							...progressState,
							ecuEvents: [...eventTypes],
						},
					);
					return {
						device: selectedDevice,
						connection,
						protocol: matchedProtocol,
						events,
						error: err,
					};
				}
			}

			if (!matchedProtocol.readRom) {
				const err = new Error("Protocol does not support ROM read");
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.OPERATION,
					DiagnosticStatus.FAILURE,
					err.message,
					{ operation, protocol: matchedProtocol.name },
				);
				return {
					device: selectedDevice,
					connection,
					protocol: matchedProtocol,
					events,
					error: err,
				};
			}

			try {
				const rom = await matchedProtocol.readRom(
					connection,
					onProgress,
					onEvent,
				);
				const duration = Date.now() - stageStartTime;
				const summary = {
					type: "read-rom",
					operation,
					protocol: matchedProtocol.name,
					dryRun: false,
					duration,
					bytesRead: rom.byteLength,
					...progressState,
					ecuEvents: [...eventTypes],
					out: options.readRomOutPath,
				};
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.OPERATION,
					DiagnosticStatus.SUCCESS,
					`ROM read completed (${rom.byteLength} bytes)`,
					summary,
				);
				return {
					device: selectedDevice,
					connection,
					protocol: matchedProtocol,
					operationResult: {
						type: "read-rom",
						data: summary,
						rom,
					},
					events,
				};
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				const duration = Date.now() - stageStartTime;
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.OPERATION,
					DiagnosticStatus.FAILURE,
					`ROM read failed: ${err.message}`,
					{
						operation,
						dryRun: isDryRun,
						duration,
						...progressState,
						ecuEvents: [...eventTypes],
					},
				);
				return {
					device: selectedDevice,
					connection,
					protocol: matchedProtocol,
					events,
					error: err,
				};
			}
		}
	} else {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.OPERATION,
			DiagnosticStatus.FAILURE,
			`Operation '${operation}' requires a matched protocol`,
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Return result
	// ─────────────────────────────────────────────────────────────────────────────
	return {
		device: selectedDevice,
		connection,
		protocol: matchedProtocol,
		events,
	};
}
