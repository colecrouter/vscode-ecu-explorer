/**
 * Flow control state machine tests
 * 30+ tests covering state transitions, timeouts, and retry logic
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowControlManager, KLineTransaction } from "../src/flow-control.js";
import { FlowControlState } from "../src/types.js";

describe("FlowControlManager", () => {
	let flowControl: FlowControlManager;

	beforeEach(() => {
		flowControl = new FlowControlManager();
		vi.useFakeTimers();
	});

	afterEach(() => {
		flowControl.dispose();
		vi.useRealTimers();
	});

	describe("initialization", () => {
		it("starts in IDLE state", () => {
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("starts with 0 retries", () => {
			expect(flowControl.getRetryCount()).toBe(0);
		});

		it("has default config values", () => {
			expect(flowControl.getMaxRetries()).toBe(3);
		});

		it("accepts custom config", () => {
			const custom = new FlowControlManager({
				ctsTimeoutMs: 200,
				responseTimeoutMs: 1000,
				maxRetries: 5,
			});
			expect(custom.getMaxRetries()).toBe(5);
			custom.dispose();
		});
	});

	describe("expectCts()", () => {
		it("transitions to WAITING_CTS state", () => {
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);
		});

		it("triggers callback on timeout", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			expect(onTimeout).not.toHaveBeenCalled();
			vi.advanceTimersByTime(100);

			expect(onTimeout).toHaveBeenCalledOnce();
		});

		it("transitions to ERROR state on timeout", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			vi.advanceTimersByTime(100);

			expect(flowControl.getState()).toBe(FlowControlState.ERROR);
		});

		it("respects custom CTS timeout", () => {
			const custom = new FlowControlManager({ ctsTimeoutMs: 50 });
			const onTimeout = vi.fn();

			custom.expectCts(onTimeout);
			vi.advanceTimersByTime(49);
			expect(onTimeout).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
			expect(onTimeout).toHaveBeenCalledOnce();

			custom.dispose();
		});
	});

	describe("receivedCts()", () => {
		it("transitions from WAITING_CTS to READY", () => {
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);

			flowControl.receivedCts();
			expect(flowControl.getState()).toBe(FlowControlState.READY);
		});

		it("clears timeout on CTS received", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			flowControl.receivedCts();
			vi.advanceTimersByTime(100);

			// Timeout callback should NOT fire since CTS was received
			expect(onTimeout).not.toHaveBeenCalled();
		});

		it("works from IDLE state (graceful)", () => {
			// Should not crash if called from wrong state
			flowControl.receivedCts();
			expect(flowControl.getState()).toBe(FlowControlState.READY);
		});
	});

	describe("transitionToIdle()", () => {
		it("returns to IDLE state", () => {
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);

			flowControl.transitionToIdle();
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("resets retry count to 0", () => {
			// Simulate some retries
			flowControl.handleTimeout();
			flowControl.handleTimeout();
			expect(flowControl.getRetryCount()).toBe(2);

			flowControl.transitionToIdle();
			expect(flowControl.getRetryCount()).toBe(0);
		});

		it("clears active timeouts", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			flowControl.transitionToIdle();
			vi.advanceTimersByTime(200);

			expect(onTimeout).not.toHaveBeenCalled();
		});
	});

	describe("handleTimeout()", () => {
		it("increments retry count on first timeout", () => {
			expect(flowControl.getRetryCount()).toBe(0);
			flowControl.handleTimeout();
			expect(flowControl.getRetryCount()).toBe(1);
		});

		it("returns true when retries remain", () => {
			const canRetry = flowControl.handleTimeout();
			expect(canRetry).toBe(true);
			expect(flowControl.getRetryCount()).toBe(1);
		});

		it("returns false when max retries exceeded", () => {
			flowControl.handleTimeout(); // Retry 1
			flowControl.handleTimeout(); // Retry 2
			flowControl.handleTimeout(); // Retry 3
			const canRetry = flowControl.handleTimeout(); // Retry 4 (should fail)

			expect(canRetry).toBe(false);
			expect(flowControl.getRetryCount()).toBe(3);
		});

		it("transitions to ERROR when max retries exceeded", () => {
			for (let i = 0; i < 3; i++) {
				flowControl.handleTimeout();
			}

			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
			const canRetry = flowControl.handleTimeout();
			expect(canRetry).toBe(false);
			expect(flowControl.getState()).toBe(FlowControlState.ERROR);
		});

		it("returns to IDLE on non-final retry", () => {
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);

			flowControl.handleTimeout();
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("respects custom max retries", () => {
			const custom = new FlowControlManager({ maxRetries: 1 });

			custom.handleTimeout(); // Retry 1
			const canRetry = custom.handleTimeout(); // Would be retry 2

			expect(canRetry).toBe(false);
			expect(custom.getRetryCount()).toBe(1);
			expect(custom.getState()).toBe(FlowControlState.ERROR);

			custom.dispose();
		});
	});

	describe("retry()", () => {
		it("allows retry from ERROR state", () => {
			flowControl.handleTimeout();
			flowControl.handleTimeout();
			flowControl.handleTimeout();
			flowControl.handleTimeout(); // Move to ERROR

			const canRetry = flowControl.retry();
			expect(canRetry).toBe(true);
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("rejects retry when max retries already exceeded", () => {
			for (let i = 0; i < 3; i++) {
				flowControl.handleTimeout();
			}
			flowControl.handleTimeout(); // Final timeout moves to ERROR

			// Try to retry again after max retries exceeded
			const canRetry = flowControl.retry();
			expect(canRetry).toBe(false);
		});

		it("returns to IDLE on successful retry", () => {
			flowControl.error();
			expect(flowControl.getState()).toBe(FlowControlState.ERROR);

			flowControl.retry();
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("rejects retry from WAITING_CTS state", () => {
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);

			const canRetry = flowControl.retry();
			expect(canRetry).toBe(false);
		});

		it("rejects retry from READY state", () => {
			flowControl.expectCts(() => {});
			flowControl.receivedCts();
			expect(flowControl.getState()).toBe(FlowControlState.READY);

			const canRetry = flowControl.retry();
			expect(canRetry).toBe(false);
		});
	});

	describe("error()", () => {
		it("transitions to ERROR state", () => {
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
			flowControl.error();
			expect(flowControl.getState()).toBe(FlowControlState.ERROR);
		});

		it("clears active timeouts", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			flowControl.error();
			vi.advanceTimersByTime(200);

			expect(onTimeout).not.toHaveBeenCalled();
		});
	});

	describe("reset()", () => {
		it("returns to IDLE state", () => {
			flowControl.expectCts(() => {});
			flowControl.reset();
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
		});

		it("resets retry count", () => {
			flowControl.handleTimeout();
			flowControl.handleTimeout();

			flowControl.reset();
			expect(flowControl.getRetryCount()).toBe(0);
		});

		it("clears timeouts", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			flowControl.reset();
			vi.advanceTimersByTime(200);

			expect(onTimeout).not.toHaveBeenCalled();
		});
	});

	describe("getState()", () => {
		it("returns current state", () => {
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);
			flowControl.expectCts(() => {});
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);
		});
	});

	describe("getRetryCount()", () => {
		it("tracks retry attempts", () => {
			expect(flowControl.getRetryCount()).toBe(0);
			flowControl.handleTimeout();
			expect(flowControl.getRetryCount()).toBe(1);
			flowControl.handleTimeout();
			expect(flowControl.getRetryCount()).toBe(2);
		});
	});

	describe("getMaxRetries()", () => {
		it("returns max retries from config", () => {
			expect(flowControl.getMaxRetries()).toBe(3);
		});

		it("returns custom value if configured", () => {
			const custom = new FlowControlManager({ maxRetries: 5 });
			expect(custom.getMaxRetries()).toBe(5);
			custom.dispose();
		});
	});

	describe("dispose()", () => {
		it("clears timeouts", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			flowControl.dispose();
			vi.advanceTimersByTime(200);

			expect(onTimeout).not.toHaveBeenCalled();
		});

		it("can be called multiple times safely", () => {
			expect(() => {
				flowControl.dispose();
				flowControl.dispose();
				flowControl.dispose();
			}).not.toThrow();
		});
	});

	describe("State machine flow", () => {
		it("handles successful CTS reception", () => {
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);

			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);
			expect(flowControl.getState()).toBe(FlowControlState.WAITING_CTS);

			flowControl.receivedCts();
			expect(flowControl.getState()).toBe(FlowControlState.READY);

			expect(onTimeout).not.toHaveBeenCalled();
		});

		it("handles timeout with retry", () => {
			const onTimeout = vi.fn();
			flowControl.expectCts(onTimeout);

			vi.advanceTimersByTime(100);
			expect(flowControl.getState()).toBe(FlowControlState.ERROR);

			const canRetry = flowControl.retry();
			expect(canRetry).toBe(true);
			expect(flowControl.getState()).toBe(FlowControlState.IDLE);

			// Attempt again
			flowControl.expectCts(onTimeout);
			flowControl.receivedCts();
			expect(flowControl.getState()).toBe(FlowControlState.READY);

			expect(onTimeout).toHaveBeenCalledOnce();
		});

		it("handles multiple retries", () => {
			const onTimeout = vi.fn();

			// First attempt
			flowControl.expectCts(onTimeout);
			vi.advanceTimersByTime(100);
			expect(flowControl.getRetryCount()).toBe(1);

			// Second attempt
			flowControl.retry();
			flowControl.expectCts(onTimeout);
			vi.advanceTimersByTime(100);
			expect(flowControl.getRetryCount()).toBe(2);

			// Third attempt
			flowControl.retry();
			flowControl.expectCts(onTimeout);
			flowControl.receivedCts();

			expect(flowControl.getState()).toBe(FlowControlState.READY);
			expect(flowControl.getRetryCount()).toBe(2);
		});

		it("fails after max retries", () => {
			const onTimeout = vi.fn();

			for (let i = 0; i < 4; i++) {
				flowControl.expectCts(onTimeout);
				vi.advanceTimersByTime(100);

				if (i < 3) {
					const canRetry = flowControl.retry();
					expect(canRetry).toBe(true);
				} else {
					const canRetry = flowControl.retry();
					expect(canRetry).toBe(false);
					expect(flowControl.getState()).toBe(FlowControlState.ERROR);
				}
			}
		});
	});
});

describe("KLineTransaction", () => {
	let flowControl: FlowControlManager;
	let transaction: KLineTransaction;

	beforeEach(() => {
		flowControl = new FlowControlManager();
		transaction = new KLineTransaction(flowControl);
		vi.useFakeTimers();
	});

	afterEach(() => {
		flowControl.dispose();
		vi.useRealTimers();
	});

	it("initializes in incomplete state", () => {
		expect(transaction.isComplete()).toBe(false);
	});

	it("marks response as received", () => {
		const response = new Uint8Array([0x01, 0x00]);
		transaction.markResponseReceived(response);

		expect(transaction.isComplete()).toBe(true);
	});

	it("can be reset", () => {
		transaction.markResponseReceived(new Uint8Array([0x01, 0x00]));
		expect(transaction.isComplete()).toBe(true);

		transaction.reset();
		expect(transaction.isComplete()).toBe(false);
	});

	it("aborts transaction", () => {
		transaction.abort();
		expect(flowControl.getState()).toBe(FlowControlState.ERROR);
	});

	it("waitForCts resolves", async () => {
		const promise = transaction.waitForCts(100);
		await expect(promise).resolves.toBeUndefined();
	});

	it("waitForCts respects timeout", () => {
		const promise = transaction.waitForCts(50);
		vi.advanceTimersByTime(50);
		return expect(promise).rejects.toThrow("CTS timeout");
	});
});
