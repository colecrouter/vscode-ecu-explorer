/**
 * Trace support for device diagnostics.
 *
 * Provides structured event capture and raw transfer logging in JSON Lines format
 * for field debugging and replay analysis.
 */

import {
	type DiagnosticEvent,
	DiagnosticStage,
	DiagnosticStatus,
} from "./diagnostic-workflow.js";

/**
 * Trace-specific event types for capturing raw transfers and protocol details.
 */
export type TraceEventType =
	| "trace"
	| "raw_transfer"
	| "protocol_probe"
	| "initialization"
	| "logging_frame"
	| "health_event";

/**
 * Direction of data transfer.
 */
export type TransferDirection = "in" | "out";

/**
 * Trace event payload containing raw transfer data and decoded text.
 */
export interface TracePayload {
	/** Hex-encoded raw bytes */
	raw?: string;
	/** Decoded textual representation */
	decoded?: string;
	/** Transfer direction */
	direction?: TransferDirection;
	/** Additional protocol-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Extended diagnostic event with trace-specific fields.
 * Extends DiagnosticEvent with type information and payload data.
 */
export interface TraceEvent extends DiagnosticEvent {
	/** Event type for trace categorization */
	type: TraceEventType;
	/** Trace-specific payload data */
	payload?: TracePayload;
}

/**
 * JSON Lines record structure for trace output.
 * Each line is a valid JSON object with consistent fields.
 */
export interface TraceRecord {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Unix timestamp in milliseconds */
	timestamp_ms: number;
	/** Diagnostic workflow stage */
	stage: DiagnosticStage;
	/** Event status */
	status: DiagnosticStatus;
	/** Event type for trace categorization */
	event_type: TraceEventType;
	/** Duration in milliseconds (if applicable) */
	duration_ms?: number;
	/** Human-readable summary */
	summary: string;
	/** Additional details */
	details?: Record<string, unknown>;
	/** Raw transfer payload (hex-encoded) */
	raw?: string;
	/** Decoded payload text */
	decoded?: string;
	/** Transfer direction */
	direction?: TransferDirection;
}

/**
 * Options for creating a TraceWriter.
 */
export interface TraceWriterOptions {
	/** Output file path */
	outputPath: string;
	/** Whether to sync writes to disk immediately (default: false for performance) */
	sync?: boolean;
	/** Include raw transfer data in trace (default: true) */
	includeRaw?: boolean;
}

/**
 * Writes trace events in JSON Lines format.
 *
 * Each line is a valid JSON object, making it easy to:
 * - Stream and process incrementally
 * - Filter with tools like jq
 * - Replay with log replay tools
 * - Archive and diff
 *
 * @example
 * ```typescript
 * const trace = new TraceWriter("./diagnostic.trace");
 * await trace.write({
 *   stage: DiagnosticStage.PROBE,
 *   status: DiagnosticStatus.START,
 *   type: "protocol_probe",
 *   timestamp: Date.now(),
 *   summary: "Probing protocols..."
 * });
 * await trace.writeRawTransfer("out", new Uint8Array([0x01, 0x02, 0x03]));
 * await trace.close();
 * ```
 */
export class TraceWriter {
	private readonly outputPath: string;
	private readonly includeRaw: boolean;
	private readonly lines: string[] = [];
	private closed = false;

	/**
	 * Creates a new TraceWriter.
	 *
	 * @param outputPath - Path to write the trace file
	 * @param options - Optional configuration
	 */
	constructor(outputPath: string, options?: TraceWriterOptions) {
		this.outputPath = outputPath;
		this.includeRaw = options?.includeRaw ?? true;
	}

	/**
	 * Writes a trace event to the output.
	 *
	 * @param event - The diagnostic event to trace
	 */
	async write(event: TraceEvent): Promise<void> {
		if (this.closed) {
			throw new Error("TraceWriter is closed");
		}

		const record = this.eventToRecord(event);
		this.lines.push(JSON.stringify(record));
	}

	/**
	 * Writes a raw transfer event (send or receive).
	 *
	 * @param direction - Transfer direction (in = from device, out = to device)
	 * @param data - Raw byte array
	 * @param stage - Current diagnostic stage
	 * @param summary - Human-readable description
	 */
	async writeRawTransfer(
		direction: TransferDirection,
		data: Uint8Array,
		stage: DiagnosticStage,
		summary: string,
	): Promise<void> {
		if (this.closed) {
			throw new Error("TraceWriter is closed");
		}

		const timestamp = Date.now();
		const record: TraceRecord = {
			timestamp: new Date(timestamp).toISOString(),
			timestamp_ms: timestamp,
			stage,
			status: DiagnosticStatus.START,
			event_type: "raw_transfer",
			summary,
			direction,
		};

		if (this.includeRaw) {
			record.raw = this.bytesToHex(data);
		}

		this.lines.push(JSON.stringify(record));
	}

	/**
	 * Writes an initialization command flow event.
	 *
	 * @param command - Command name
	 * @param data - Command bytes
	 * @param response - Optional response bytes
	 * @param stage - Current diagnostic stage
	 */
	async writeInitializationFlow(
		command: string,
		data: Uint8Array,
		response: Uint8Array | null,
		stage: DiagnosticStage,
	): Promise<void> {
		if (this.closed) {
			throw new Error("TraceWriter is closed");
		}

		const timestamp = Date.now();
		const record: TraceRecord = {
			timestamp: new Date(timestamp).toISOString(),
			timestamp_ms: timestamp,
			stage,
			status: response ? DiagnosticStatus.SUCCESS : DiagnosticStatus.START,
			event_type: "initialization",
			summary: `Initialization: ${command}`,
			direction: "out",
			details: { command },
		};

		if (this.includeRaw) {
			record.raw = this.bytesToHex(data);
			if (response) {
				record.details = {
					...record.details,
					response_raw: this.bytesToHex(response),
				};
			}
		}

		this.lines.push(JSON.stringify(record));
	}

	/**
	 * Writes a protocol probe outcome event.
	 *
	 * @param protocolName - Name of the protocol being probed
	 * @param success - Whether the probe succeeded
	 * @param details - Additional probe details
	 * @param stage - Current diagnostic stage
	 */
	async writeProtocolProbe(
		protocolName: string,
		success: boolean,
		details?: Record<string, unknown>,
		stage: DiagnosticStage = DiagnosticStage.PROBE,
	): Promise<void> {
		if (this.closed) {
			throw new Error("TraceWriter is closed");
		}

		const timestamp = Date.now();
		const record: TraceRecord = {
			timestamp: new Date(timestamp).toISOString(),
			timestamp_ms: timestamp,
			stage,
			status: success ? DiagnosticStatus.SUCCESS : DiagnosticStatus.FAILURE,
			event_type: "protocol_probe",
			summary: `Protocol probe: ${protocolName} - ${success ? "matched" : "no match"}`,
			details: {
				protocol: protocolName,
				...details,
			},
		};

		this.lines.push(JSON.stringify(record));
	}

	/**
	 * Writes a logging frame or health event.
	 *
	 * @param frameType - Type of event (logging_frame or health_event)
	 * @param data - Frame or health data
	 * @param summary - Human-readable description
	 * @param stage - Current diagnostic stage
	 */
	async writeLoggingEvent(
		frameType: "logging_frame" | "health_event",
		data: Uint8Array | Record<string, unknown>,
		summary: string,
		stage: DiagnosticStage = DiagnosticStage.OPERATION,
	): Promise<void> {
		if (this.closed) {
			throw new Error("TraceWriter is closed");
		}

		const timestamp = Date.now();
		const record: TraceRecord = {
			timestamp: new Date(timestamp).toISOString(),
			timestamp_ms: timestamp,
			stage,
			status: DiagnosticStatus.START,
			event_type: frameType,
			summary,
		};

		if (
			frameType === "logging_frame" &&
			data instanceof Uint8Array &&
			this.includeRaw
		) {
			record.raw = this.bytesToHex(data);
		} else if (frameType === "health_event" && typeof data === "object") {
			record.details = data as Record<string, unknown>;
		}

		this.lines.push(JSON.stringify(record));
	}

	/**
	 * Closes the trace writer and writes all pending lines to the output file.
	 *
	 * @returns Promise that resolves when the file is written
	 */
	async close(): Promise<void> {
		if (this.closed) {
			return;
		}

		this.closed = true;

		// Write to file using Node.js fs/promises
		const fs = await import("node:fs/promises");
		const content = this.lines.join("\n") + (this.lines.length > 0 ? "\n" : "");
		await fs.writeFile(this.outputPath, content, "utf-8");
	}

	/**
	 * Gets the output file path.
	 */
	getOutputPath(): string {
		return this.outputPath;
	}

	/**
	 * Converts a DiagnosticEvent to a TraceRecord.
	 */
	private eventToRecord(event: TraceEvent): TraceRecord {
		const record: TraceRecord = {
			timestamp: new Date(event.timestamp).toISOString(),
			timestamp_ms: event.timestamp,
			stage: event.stage,
			status: event.status,
			event_type: event.type,
			summary: event.summary,
		};

		if (event.duration !== undefined) {
			record.duration_ms = event.duration;
		}

		if (event.details) {
			record.details = event.details;
		}

		if (event.payload) {
			if (event.payload.raw) {
				record.raw = event.payload.raw;
			}
			if (event.payload.decoded) {
				record.decoded = event.payload.decoded;
			}
			if (event.payload.direction) {
				record.direction = event.payload.direction;
			}
		}

		return record;
	}

	/**
	 * Converts a Uint8Array to a hex string.
	 */
	private bytesToHex(bytes: Uint8Array): string {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ");
	}
}

/**
 * Creates a callback function that writes diagnostic events to a trace writer.
 *
 * @param writer - The trace writer to use
 * @returns A callback function compatible with DiagnosticOptions.onEvent
 */
export function createTraceCallback(
	writer: TraceWriter | null,
): ((event: DiagnosticEvent) => void) | undefined {
	if (!writer) {
		return undefined;
	}

	return (event: DiagnosticEvent) => {
		// Convert to trace event and write
		const traceEvent: TraceEvent = {
			...event,
			type: "trace",
		};
		writer.write(traceEvent).catch((err) => {
			// Log to console but don't throw - we don't want to break diagnostics
			console.error("Failed to write trace event:", err);
		});
	};
}

/**
 * Hex-encodes a Uint8Array for trace output.
 *
 * @param data - Byte array to encode
 * @returns Space-separated hex string
 */
export function hexEncode(data: Uint8Array): string {
	return Array.from(data)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join(" ");
}

/**
 * Decodes a hex string back to a Uint8Array.
 *
 * @param hex - Space-separated hex string
 * @returns Decoded byte array
 */
export function hexDecode(hex: string): Uint8Array {
	const bytes: number[] = [];
	const cleanHex = hex.replace(/\s+/g, "");
	for (let i = 0; i < cleanHex.length; i += 2) {
		bytes.push(parseInt(cleanHex.substr(i, 2), 16));
	}
	return new Uint8Array(bytes);
}
