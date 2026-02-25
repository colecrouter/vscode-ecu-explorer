import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import { Mut3Protocol } from "../src/index.js";
import { computeSecurityKey } from "../src/security.js";

/**
 * A transcript-driven boundary fake for DeviceConnection.
 * Instead of mocking individual calls with logic, it follows a predefined
 * sequence of expected requests and provides corresponding responses.
 */
class TranscriptDeviceFake implements DeviceConnection {
	deviceInfo: DeviceInfo = {
		id: "fake-mut3-device",
		name: "MUT3 Fake Device",
		transportName: "openport2",
		connected: true,
	};

	private transcript: Array<{
		expectedRequest: number[];
		response: number[];
		error?: Error;
	}> = [];
	private currentStep = 0;

	addStep(expectedRequest: number[], response: number[]): this {
		this.transcript.push({ expectedRequest, response });
		return this;
	}

	addErrorStep(expectedRequest: number[], error: Error): this {
		this.transcript.push({ expectedRequest, response: [], error });
		return this;
	}

	async sendFrame(data: Uint8Array): Promise<Uint8Array> {
		const step = this.transcript[this.currentStep];
		if (!step) {
			throw new Error(
				`Unexpected request at step ${this.currentStep}: [${Array.from(data)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		// Verify request matches transcript
		const actualRequest = Array.from(data);
		try {
			expect(actualRequest).toEqual(step.expectedRequest);
		} catch (_e) {
			throw new Error(
				`Transcript mismatch at step ${this.currentStep}.\nExpected: [${step.expectedRequest.map((b) => `0x${b.toString(16)}`).join(", ")}]\nActual:   [${actualRequest.map((b) => `0x${b.toString(16)}`).join(", ")}]`,
			);
		}

		this.currentStep++;

		if (step.error) {
			throw step.error;
		}

		return new Uint8Array(step.response);
	}

	// Unused for ROM read flow tests
	startStream = vi.fn();
	stopStream = vi.fn();
	async close(): Promise<void> {}

	verifyExhausted() {
		if (this.currentStep < this.transcript.length) {
			throw new Error(
				`Transcript not exhausted. Remaining steps: ${this.transcript.length - this.currentStep}`,
			);
		}
	}
}

describe("Mut3Protocol ROM Read Flow (Integration)", () => {
	it("completes a successful ROM read handshake and first blocks", async () => {
		const protocol = new Mut3Protocol();
		const fake = new TranscriptDeviceFake();

		const seed = [0x12, 0x34];
		const expectedKey = Array.from(computeSecurityKey(new Uint8Array(seed)));

		// 1. Extended Session
		fake.addStep([0x10, 0x03], [0x50, 0x03]);
		// 2. Request Seed
		fake.addStep([0x27, 0x01], [0x67, 0x01, ...seed]);
		// 3. Send Key
		fake.addStep([0x27, 0x02, ...expectedKey], [0x67, 0x02]);

		// 4. Read first few blocks (128 bytes each)
		// Block 0: Address 0x000000
		const block0Data = new Array(128).fill(0xaa);
		fake.addStep([0x23, 0x14, 0x00, 0x00, 0x00, 0x80], [0x63, ...block0Data]);

		// Block 1: Address 0x000080
		const block1Data = new Array(128).fill(0xbb);
		fake.addStep([0x23, 0x14, 0x00, 0x00, 0x80, 0x80], [0x63, ...block1Data]);

		fake.addErrorStep(
			[0x23, 0x14, 0x00, 0x01, 0x00, 0x80],
			new Error("Stop test after 2 blocks"),
		);

		const onProgress = vi.fn();
		const onEvent = vi.fn();

		await expect(protocol.readRom(fake, onProgress, onEvent)).rejects.toThrow(
			"Stop test after 2 blocks",
		);

		// Verify events
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
		);

		// Verify progress for 2 blocks
		expect(onProgress).toHaveBeenCalledTimes(2);
		expect(onProgress).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				bytesProcessed: 128,
				phase: "reading",
			}),
		);
		expect(onProgress).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				bytesProcessed: 256,
				phase: "reading",
			}),
		);

		fake.verifyExhausted();
	});

	it("yields a meaningful error when security access is denied", async () => {
		const protocol = new Mut3Protocol();
		const fake = new TranscriptDeviceFake();

		const seed = [0x11, 0x22];
		const expectedKey = Array.from(computeSecurityKey(new Uint8Array(seed)));

		// 1. Extended Session
		fake.addStep([0x10, 0x03], [0x50, 0x03]);
		// 2. Request Seed
		fake.addStep([0x27, 0x01], [0x67, 0x01, ...seed]);
		// 3. Send Key - ECU returns Negative Response (0x7F) for Security Access (0x27)
		// 0x33 is "Security Access Denied" or "Invalid Key"
		fake.addStep([0x27, 0x02, ...expectedKey], [0x7f, 0x27, 0x33]);

		const onEvent = vi.fn();

		await expect(protocol.readRom(fake, vi.fn(), onEvent)).rejects.toThrow(
			"Security access denied",
		);

		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
		);
		// Should NOT have granted access
		expect(onEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
		);

		fake.verifyExhausted();
	});
});
