import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import {
	FLASH_ECU_RESET_HARD,
	FLASH_PREPARATION_SESSION,
	FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
	FLASH_PROGRAMMING_SESSION,
	FLASH_REQUEST_DOWNLOAD_STAGE1,
	FLASH_REQUEST_DOWNLOAD_STAGE2,
	FLASH_REQUEST_TRANSFER_EXIT,
	FLASH_ROUTINE_CONTROL_STAGE1,
	FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE,
	FLASH_ROUTINE_CONTROL_STAGE2,
	FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION,
	FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
	FLASH_TRANSFER_DATA_STAGE1_BA,
	FLASH_TRANSFER_DATA_STAGE1_D4,
	FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC,
	Mut3Protocol,
	SID_SECURITY_ACCESS,
	SID_VENDOR_SERVICE,
} from "../src/index.js";
import {
	formatHexBytes,
	OBSERVED_FLASH_SESSION_PAIRS,
} from "./flash-session-trace-fixtures.js";

const FLASH_PREPARE_DOWNLOAD_REQUEST = [
	SID_VENDOR_SERVICE,
	FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
	0x01,
	0x01,
	0x00,
	0x26,
	0x03,
	0x27,
	0x00,
	0x00,
	0x00,
	0x01,
];

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

describe("Mut3Protocol dryRunWrite() â€” traced flash session", () => {
	it("follows the observed 0x92 -> 0x85 -> 0x05 -> 0x06 -> 0x3B 0x9A handshake", async () => {
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
				[SID_SECURITY_ACCESS, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION],
				[0x67, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION, 0x8f, 0xb2, 0xce, 0xf1],
			)
			.addStep(
				[
					SID_SECURITY_ACCESS,
					FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
					0x48,
					0x14,
					0x20,
					0xcb,
				],
				[0x67, FLASH_SECURITY_SEND_KEY_SUBFUNCTION, 0x34],
			)
			.addStep(FLASH_PREPARE_DOWNLOAD_REQUEST, [0x7f, SID_VENDOR_SERVICE, 0x78])
			.addStep(FLASH_PREPARE_DOWNLOAD_REQUEST, [
				0x7b,
				FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
			])
			.addStep(Array.from(FLASH_REQUEST_DOWNLOAD_STAGE1), [0x74, 0x01, 0x01])
			.addStep(Array.from(FLASH_TRANSFER_DATA_STAGE1_BA), [0x76])
			.addStep(Array.from(FLASH_REQUEST_TRANSFER_EXIT), [0x77])
			.addStep(Array.from(FLASH_REQUEST_DOWNLOAD_STAGE2), [0x74, 0x01, 0x01])
			.addStep(Array.from(FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC), [0x76])
			.addStep(Array.from(FLASH_REQUEST_TRANSFER_EXIT), [0x77])
			.addStep(
				Array.from(FLASH_ROUTINE_CONTROL_STAGE1),
				[0x71, 0xe1, 0x00, 0xff, 0xff, 0xff],
			)
			.addStep(
				Array.from(FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE),
				[0x7f, 0x31, 0x78],
			);

		await expect(
			protocol.dryRunWrite(fake, rom, onProgress, onEvent),
		).resolves.toBeUndefined();

		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
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
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Sending traced MUT-III flash key",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing traced MUT-III pre-download vendor request",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing first traced MUT-III RequestDownload",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Sending first traced MUT-III TransferData block",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing first traced MUT-III RequestTransferExit",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing second traced MUT-III RequestDownload",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Sending first traced large MUT-III TransferData block",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message:
					"Issuing traced MUT-III RequestTransferExit after first bulk block",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing traced MUT-III RoutineControl after first bulk block",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing traced MUT-III BA continuation RoutineControl",
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

	it("keeps all observed 0x05/0x06 seed-key pairs available as committed fixtures", () => {
		expect(OBSERVED_FLASH_SESSION_PAIRS).toHaveLength(157);
		for (const pair of OBSERVED_FLASH_SESSION_PAIRS) {
			expect(pair.seed).toHaveLength(4);
			expect(pair.key).toHaveLength(4);
			expect(formatHexBytes(pair.seed)).not.toBe(formatHexBytes(pair.key));
		}
	});

	for (const pair of OBSERVED_FLASH_SESSION_PAIRS) {
		it(`sends the traced flash key from ${pair.capture}`, async () => {
			const protocol = new Mut3Protocol();
			const fake = new TranscriptDeviceFake();
			const rom = new Uint8Array(0x100000);

			fake
				.addStep(
					[0x10, FLASH_PREPARATION_SESSION],
					[0x50, FLASH_PREPARATION_SESSION],
				)
				.addStep(
					[0x10, FLASH_PROGRAMMING_SESSION],
					[0x50, FLASH_PROGRAMMING_SESSION],
				)
				.addStep(
					[SID_SECURITY_ACCESS, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION],
					[0x67, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION, ...pair.seed],
				)
				.addStep(
					[
						SID_SECURITY_ACCESS,
						FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
						...pair.key,
					],
					[0x67, FLASH_SECURITY_SEND_KEY_SUBFUNCTION, 0x34],
				)
				.addStep(FLASH_PREPARE_DOWNLOAD_REQUEST, [
					0x7b,
					FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
				])
				.addStep(Array.from(FLASH_REQUEST_DOWNLOAD_STAGE1), [0x74, 0x01, 0x01])
				.addStep(Array.from(FLASH_TRANSFER_DATA_STAGE1_BA), [0x76])
				.addStep(Array.from(FLASH_REQUEST_TRANSFER_EXIT), [0x77])
				.addStep(Array.from(FLASH_REQUEST_DOWNLOAD_STAGE2), [0x74, 0x01, 0x01])
				.addStep(Array.from(FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC), [0x76])
				.addStep(Array.from(FLASH_REQUEST_TRANSFER_EXIT), [0x77])
				.addStep(
					Array.from(FLASH_ROUTINE_CONTROL_STAGE1),
					[0x71, 0xe1, 0x00, 0xff, 0xff, 0xff],
				)
				.addStep(
					Array.from(FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE),
					[0x7f, 0x31, 0x78],
				);

			await expect(
				protocol.dryRunWrite(fake, rom, vi.fn()),
			).resolves.toBeUndefined();

			fake.verifyExhausted();
		});
	}

	it("keeps the alternate traced D4 mini-transfer branch available as a contract fixture", () => {
		expect(Array.from(FLASH_TRANSFER_DATA_STAGE1_D4)).toEqual([
			0x36, 0xd4, 0xd4,
		]);
	});

	it("keeps the traced BA continuation routine token available as a contract fixture", () => {
		expect(Array.from(FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE)).toEqual([
			0x31, 0xe0,
		]);
	});
});

describe("Mut3Protocol dryRunWriteResetBranch() — traced D4 reset branch", () => {
	it("follows the observed D4 -> 31 E1 02 -> 11 01 reset boundary", async () => {
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
				[SID_SECURITY_ACCESS, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION],
				[0x67, FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION, 0x8f, 0xb2, 0xce, 0xf1],
			)
			.addStep(
				[
					SID_SECURITY_ACCESS,
					FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
					0x48,
					0x14,
					0x20,
					0xcb,
				],
				[0x67, FLASH_SECURITY_SEND_KEY_SUBFUNCTION, 0x34],
			)
			.addStep(FLASH_PREPARE_DOWNLOAD_REQUEST, [0x7f, SID_VENDOR_SERVICE, 0x78])
			.addStep(FLASH_PREPARE_DOWNLOAD_REQUEST, [
				0x7b,
				FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
			])
			.addStep(Array.from(FLASH_REQUEST_DOWNLOAD_STAGE1), [0x74, 0x01, 0x01])
			.addStep(Array.from(FLASH_TRANSFER_DATA_STAGE1_D4), [0x76])
			.addStep(Array.from(FLASH_REQUEST_TRANSFER_EXIT), [0x77])
			.addStep(Array.from(FLASH_ROUTINE_CONTROL_STAGE2), [0x7f, 0x31, 0x78])
			.addStep(
				Array.from(FLASH_ROUTINE_CONTROL_STAGE2),
				[0x71, 0xe1, 0x00, 0xff, 0xff, 0xff],
			)
			.addStep(Array.from(FLASH_ECU_RESET_HARD), [0x7f, 0x11, 0x78])
			.addStep(Array.from(FLASH_ECU_RESET_HARD), [0x51]);

		await expect(
			protocol.dryRunWriteResetBranch(fake, rom, onProgress, onEvent),
		).resolves.toBeUndefined();

		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "ECU_RESET_REQUESTED" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "ECU_RESETTING" }),
		);
		expect(onEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "ECU_RESET_ACKNOWLEDGED" }),
		);

		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Sending traced MUT-III D4 reset-branch token",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing traced MUT-III reset-branch RoutineControl",
			}),
		);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "negotiating",
				message: "Issuing traced MUT-III hard reset request",
			}),
		);

		fake.verifyExhausted();
	});

	it("rejects ROMs that are not exactly 1 MB before attempting the reset branch", async () => {
		const protocol = new Mut3Protocol();
		const fake = new TranscriptDeviceFake();

		await expect(
			protocol.dryRunWriteResetBranch(fake, new Uint8Array(16), vi.fn()),
		).rejects.toThrow(
			"dryRunWriteResetBranch: expected 1048576-byte ROM, got 16 bytes",
		);

		fake.verifyExhausted();
	});
});
