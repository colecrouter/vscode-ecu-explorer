import type * as vscode from "vscode";

export interface DeviceInfo {
	id: string;
	name: string; // e.g. "Tactrix OpenPort 2.0 (USB)"
	transportName: string; // e.g. "openport2"
	connected: boolean;
}

export interface RomProgress {
	phase: "reading" | "writing" | "erasing" | "verifying" | "negotiating";
	bytesProcessed: number;
	totalBytes: number;
	percentComplete: number;
	estimatedSecondsRemaining?: number;
	/** Human-readable status message for the current phase */
	message?: string;
}

export type EcuEventType =
	| "SECURITY_ACCESS_REQUESTED"
	| "SECURITY_ACCESS_GRANTED"
	| "SECURITY_ACCESS_DENIED"
	| "ECU_RESETTING"
	| "BOOT_MODE_ENTERED"
	| "SECTOR_ERASE_STARTED"
	| "SECTOR_ERASE_COMPLETE"
	| "KERNEL_INITIALIZED";

export interface EcuEvent {
	type: EcuEventType;
	timestamp: number;
	data?: unknown;
}

export interface LiveDataHealth {
	samplesPerSecond: number;
	droppedFrames: number;
	latencyMs: number;
	status: "healthy" | "degraded" | "stalled";
}

export interface DtcCode {
	code: string; // e.g. "P0300"
	description?: string;
	status: "stored" | "pending" | "permanent";
}

export interface PidDescriptor {
	pid: number;
	name: string; // e.g. "Engine RPM"
	unit: string; // e.g. "rpm"
	minValue: number;
	maxValue: number;
}

export interface LiveDataFrame {
	timestamp: number; // ms since session start
	pid: number;
	value: number;
	unit: string;
}

export interface WriteOptions {
	/** If true, skip the actual flash erase/write but perform all other steps */
	dryRun?: boolean;
	/** Verify checksums in the ROM before writing */
	verifyChecksums?: boolean;
	/**
	 * The original ROM image read from the ECU before modification.
	 * When provided, only sectors that differ between originalRom and the
	 * ROM being written will be erased and rewritten. Unchanged sectors
	 * are skipped entirely.
	 *
	 * Must be the same length as the ROM being written.
	 * If not provided, all sectors are erased and rewritten (full flash).
	 */
	originalRom?: Uint8Array;
}

export interface LiveDataSession {
	stop(): void;
	/** Save the recorded session to a file (CSV or binary) */
	saveRecording?(uri: vscode.Uri): Promise<void>;
}
