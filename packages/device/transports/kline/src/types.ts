/**
 * K-line transport types and enums for ISO 14230 framing
 */

/** Flow control states in the K-line protocol */
export enum FlowControlState {
	/** Idle, ready to send a new frame */
	IDLE = "IDLE",
	/** Waiting for CTS (0x00) clear-to-send from ECU */
	WAITING_CTS = "WAITING_CTS",
	/** Ready to send next frame, CTS received */
	READY = "READY",
	/** Error state, recovery needed */
	ERROR = "ERROR",
}

/** Represents a frame with payload and checksum information */
export interface Frame {
	/** The raw frame data including PCI, payload, and checksum */
	data: Uint8Array;
	/** The payload portion (without PCI and checksum) */
	payload: Uint8Array;
	/** Whether the frame has a valid checksum */
	isValid: boolean;
}

/** K-line flow control timing configuration */
export interface FlowControlConfig {
	/** Maximum time to wait for CTS (clear-to-send) byte in milliseconds */
	ctsTimeoutMs: number;
	/** Maximum time to wait for a response frame in milliseconds */
	responseTimeoutMs: number;
	/** Maximum number of retries for failed transmissions */
	maxRetries: number;
}

/** Health statistics for K-line connection */
export interface KLineHealth {
	/** Number of frames successfully sent */
	framesSent: number;
	/** Number of frames successfully received */
	framesReceived: number;
	/** Number of checksum validation failures */
	checksumErrors: number;
	/** Number of timeout errors */
	timeoutErrors: number;
	/** Number of retries performed */
	retries: number;
	/** Last error message, if any */
	lastError?: string;
}
