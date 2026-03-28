import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import {
	FLASH_PREPARATION_SESSION,
	FLASH_PROGRAMMING_SESSION,
	FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION,
	Mut3Protocol,
} from "../src/index.js";

class TranscriptDeviceFake implements DeviceConnection {
	deviceInfo: DeviceInfo = {
		id: "fake-mut3-flash-device",
		name: "MUT3 Flash Fake Device",
		transportName: "openport2",
		connected: true,
	};

	private transcript: Array<{
		expectedRequest: number[];
		response: number[];
	}> = [];
	private currentStep = 0;

	addStep(expectedRequest: number[], response: number[]): this {
		this.transcript.push({ expectedRequest, response });
		return this;
	}

	async sendFrame(data: Uint8Array): Promise<Uint8Array> {
		const step = this.transcript[this.currentStep];
		if (!step) {
			throw new Error(
				`Unexpected request at step ${this.currentStep}: [${Array.from(data).join(", ")}]`,
			);
		}

		expect(Array.from(data)).toEqual(step.expectedRequest);
		this.currentStep++;
		return new Uint8Array(step.response);
	}

	startStream = vi.fn();
	stopStream = vi.fn();
	async close(): Promise<void> {}

	verifyExhausted() {
		expect(this.currentStep).toBe(this.transcript.length);
	}
}

describe("Mut3Protocol dryRunWrite() — traced flash session", () => {
	it("follows the observed 0x92 -> 0x85 -> 0x05 seed handshake and stops before sendKey", async () => {
		const protocol = new Mut3Protocol();
		const fake = new TranscriptDeviceFake();
		const rom = new Uint8Array(0x100000);
		const onProgress = vi.fn();
		const onEvent = vi.fn();

		fake
			.addStep(
				[0x10, FLASH_PREPARATION_SESSION],
				[0x50, FLASH_PREPARATION_SESSION],
			)
			.addStep([0x10, FLASH_PROGRAMMING_SESSION], [0x7f, 0x10, 0x78])
			.addStep(
				[0x10, FLASH_PROGRAMMING_SESSION],
				[0x50, FLASH_PROGRAMMING_SESSION],
			)
			.addStep(
				[0x27, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION],
				[0x67, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION, 0x8f, 0xb2, 0xce, 0xf1],
			);

		await expect(
			protocol.dryRunWrite(fake, rom, onProgress, onEvent),
		).rejects.toThrow(
			"MUT-III flash-session key algorithm for subfunction 0x6 is not implemented yet; captured seed=8F B2 CE F1",
		);

		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
		);
		expect(onEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
		);

		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Entering traced MUT-III flash preparation session",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Entering traced MUT-III flash programming session",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Requesting traced MUT-III flash seed",
			}),
		);

		fake.verifyExhausted();
	});

	it("rejects ROMs that are not exactly 1 MB before attempting the traced flash flow", async () => {
		const protocol = new Mut3Protocol();
		const fake = new TranscriptDeviceFake();

		await expect(
			protocol.dryRunWrite(fake, new Uint8Array(16), vi.fn()),
		).rejects.toThrow("dryRunWrite: expected 1048576-byte ROM, got 16 bytes");

		fake.verifyExhausted();
	});
});
