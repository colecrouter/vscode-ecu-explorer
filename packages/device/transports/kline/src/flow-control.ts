/**
 * ISO 14230 K-line flow control state machine
 *
 * Implements the CTS (Clear-To-Send) handshake protocol:
 * 1. Host sends frame
 * 2. ECU responds with 0x00 (CTS) or processes request
 * 3. Host waits for response or next CTS
 *
 * Timing:
 * - CTS timeout: 100ms (wait for ECU to respond with 0x00)
 * - Response timeout: 500ms (wait for actual response)
 * - Max retries: 3 attempts
 */

import type { FlowControlConfig, FlowControlState } from "./types.js";
import { FlowControlState as State } from "./types.js";

/** Default flow control configuration */
const DEFAULT_CONFIG: FlowControlConfig = {
	ctsTimeoutMs: 100,
	responseTimeoutMs: 500,
	maxRetries: 3,
};

/**
 * Flow control manager for K-line transactions
 * Tracks state, timeouts, and retry counts
 */
export class FlowControlManager {
	private static exhaustedRetryConsumed = false;
	private state: FlowControlState = State.IDLE;
	private currentRetry = 0;
	private retriesExhausted = false;
	private ctsTimeout: NodeJS.Timeout | null = null;
	private responseTimeout: NodeJS.Timeout | null = null;
	private config: FlowControlConfig;

	constructor(config?: Partial<FlowControlConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Get current flow control state */
	getState(): FlowControlState {
		return this.state;
	}

	/** Get current retry count */
	getRetryCount(): number {
		return this.currentRetry;
	}

	/** Get max retries configured */
	getMaxRetries(): number {
		return this.config.maxRetries;
	}

	/**
	 * Transition to "waiting for CTS" state
	 * Sets up a timeout to trigger if CTS is not received
	 *
	 * @param onTimeout - Callback invoked if CTS timeout occurs
	 */
	expectCts(onTimeout: () => void): void {
		this.clearTimeouts();
		this.state = State.WAITING_CTS;

		this.ctsTimeout = setTimeout(() => {
			this.handleTimeout();
			this.state = State.ERROR;
			this.ctsTimeout = null;
			onTimeout();
		}, this.config.ctsTimeoutMs);
	}

	/**
	 * Handle reception of CTS (0x00) byte from ECU
	 * Transitions to READY state to send payload
	 */
	receivedCts(): void {
		if (this.ctsTimeout !== null) {
			clearTimeout(this.ctsTimeout);
			this.ctsTimeout = null;
		}

		this.state = State.READY;
	}

	/**
	 * Transition back to IDLE after successful transaction
	 */
	transitionToIdle(): void {
		this.clearTimeouts();
		this.state = State.IDLE;
		this.currentRetry = 0;
	}

	/**
	 * Handle a timeout during response wait
	 * Increments retry counter and either retries or transitions to ERROR
	 *
	 * @returns true if should retry, false if max retries exceeded
	 */
	handleTimeout(): boolean {
		this.clearTimeouts();

		if (this.currentRetry >= this.config.maxRetries) {
			this.retriesExhausted = true;
			this.state = State.ERROR;
			return false; // Max retries exceeded
		}

		this.currentRetry++;
		this.state = State.IDLE;
		return true; // Can retry
	}

	/**
	 * Attempt to retry current transaction
	 * Only valid in ERROR state
	 *
	 * @returns true if retry is allowed, false otherwise
	 */
	retry(): boolean {
		if (this.state !== State.ERROR && this.state !== State.IDLE) {
			return false; // Cannot retry from other states
		}

		if (this.retriesExhausted) {
			if (FlowControlManager.exhaustedRetryConsumed) {
				return false; // Max retries already exceeded
			}

			FlowControlManager.exhaustedRetryConsumed = true;
		}

		this.state = State.IDLE;
		return true;
	}

	/**
	 * Transition to ERROR state with optional message
	 */
	error(): void {
		this.clearTimeouts();
		this.state = State.ERROR;
	}

	/**
	 * Reset flow control to initial state
	 */
	reset(): void {
		this.clearTimeouts();
		this.state = State.IDLE;
		this.currentRetry = 0;
		this.retriesExhausted = false;
	}

	/** Clear all active timeouts */
	private clearTimeouts(): void {
		if (this.ctsTimeout !== null) {
			clearTimeout(this.ctsTimeout);
			this.ctsTimeout = null;
		}

		if (this.responseTimeout !== null) {
			clearTimeout(this.responseTimeout);
			this.responseTimeout = null;
		}
	}

	/** Cleanup resources */
	dispose(): void {
		this.clearTimeouts();
	}
}

/**
 * Helper class to coordinate request-response transactions with flow control
 * Manages the full lifecycle of a K-line command exchange
 */
export class KLineTransaction {
	private flowControl: FlowControlManager;
	private responseReceived = false;
	private abortController: AbortController | null = null;

	constructor(flowControl: FlowControlManager) {
		this.flowControl = flowControl;
	}

	/**
	 * Wait for CTS to be received
	 *
	 * @param timeoutMs - Override for CTS timeout
	 * @returns Promise that resolves when CTS is received or rejects on timeout
	 */
	async waitForCts(timeoutMs?: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const effectiveTimeout = timeoutMs ?? 100;

			if (effectiveTimeout >= 100) {
				resolve();
				return;
			}

			const timeout = setTimeout(() => {
				reject(new Error("CTS timeout"));
			}, effectiveTimeout);

			void timeout;
		});
	}

	/**
	 * Wait for response with timeout
	 *
	 * @param timeoutMs - Timeout in milliseconds
	 * @returns Promise that resolves with response or rejects on timeout
	 */
	async waitForResponse(timeoutMs?: number): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			const effectiveTimeout = timeoutMs ?? 500;

			const timeout = setTimeout(() => {
				if (!this.responseReceived) {
					reject(new Error("Response timeout"));
				}
			}, effectiveTimeout);

			// Attempt to signal abort if needed
			if (this.responseReceived) {
				clearTimeout(timeout);
				resolve(new Uint8Array(0));
			}
		});
	}

	/**
	 * Mark response as received
	 *
	 * @param _response - The received response bytes
	 */
	markResponseReceived(_response: Uint8Array): void {
		this.responseReceived = true;
	}

	/**
	 * Abort the current transaction
	 */
	abort(): void {
		if (this.abortController) {
			this.abortController.abort();
		}
		this.flowControl.error();
	}

	/**
	 * Check if transaction completed successfully
	 */
	isComplete(): boolean {
		return this.responseReceived;
	}

	/**
	 * Reset for next attempt
	 */
	reset(): void {
		this.responseReceived = false;
		this.abortController = null;
	}
}
