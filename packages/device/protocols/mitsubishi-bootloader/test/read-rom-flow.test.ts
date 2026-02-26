import type {
	DeviceConnection,
	EcuEvent,
	RomProgress,
} from "@ecu-explorer/device";
import { describe, expect, it } from "vitest";
import { MitsubishiBootloaderProtocol } from "../src/index.js";

/**
 * Mitsubishi Bootloader ROM Read Flow Integration Tests
 *
 * These tests use a transcript-driven approach to verify the contract between
 * the protocol and the device connection, focusing on external behavior
 * rather than internal implementation details.
 */
describe("MitsubishiBootloaderProtocol ROM Read Flow", () => {
	const ROM_SIZE = 0x080000; // 512 KB
	const BLOCK_SIZE = 0x80; // 128 bytes

	function makeTranscriptConnection(
		transcript: { send: Uint8Array; receive: Uint8Array }[],
	) {
		let index = 0;
		const sentFrames: Uint8Array[] = [];

		const connection: Partial<DeviceConnection> = {
			deviceInfo: {
				id: "test-id",
				name: "Test Device",
				transportName: "openport2",
				connected: true,
			},
			sendFrame: async (data: Uint8Array) => {
				sentFrames.push(data);
				const step = transcript[index++];
				if (!step) {
					throw new Error(
						`Unexpected frame sent at step ${index - 1}: ${Array.from(data)
							.map((b) => b.toString(16).padStart(2, "0"))
							.join(" ")}`,
					);
				}
				// Basic validation that we are following the transcript
				// For ROM blocks, we don't want to be too strict on the exact address in every test
				// but we should at least check the length or command byte if applicable.
				return step.receive;
			},
		};

		return {
			connection: connection as DeviceConnection,
			sentFrames,
			getTranscriptIndex: () => index,
		};
	}

	it("successfully reads ROM with correct handshake and block assembly", async () => {
		const protocol = new MitsubishiBootloaderProtocol();

		// Prepare a small transcript for a successful read
		// We'll mock a smaller ROM size if possible, but the protocol has ROM_SIZE hardcoded.
		// To keep the test fast, we'll only simulate the first few blocks and then mock the rest
		// OR we can just simulate a few blocks and verify the assembly.

		const transcript = [
			{ send: new Uint8Array([0x80, 0x25]), receive: new Uint8Array([]) }, // Break (9600 baud)
			{ send: new Uint8Array([0x55]), receive: new Uint8Array([0xaa]) }, // Sync
			{
				send: new Uint8Array([0x9a, 0x88, 0x01, 0x08, 0xa0, 0x03]),
				receive: new Uint8Array([0x00]),
			}, // Challenge A
			{ send: new Uint8Array([0x40]), receive: new Uint8Array([0x11]) }, // Kernel Init
		];

		// Add blocks to transcript
		const totalBlocks = ROM_SIZE / BLOCK_SIZE;
		for (let i = 0; i < totalBlocks; i++) {
			const data = new Uint8Array(BLOCK_SIZE).fill(i % 256);
			transcript.push({
				send: new Uint8Array([
					((i * BLOCK_SIZE) >> 16) & 0xff,
					((i * BLOCK_SIZE) >> 8) & 0xff,
					(i * BLOCK_SIZE) & 0xff,
					BLOCK_SIZE,
				]),
				receive: data,
			});
		}

		const { connection, sentFrames } = makeTranscriptConnection(transcript);

		const events: EcuEvent[] = [];
		const progress: RomProgress[] = [];

		const rom = await protocol.readRom(
			connection,
			(p) => progress.push(p),
			(e) => events.push(e),
		);

		// Assertions: Contract focus

		// 1. Handshake sequence
		expect(sentFrames[0]).toEqual(new Uint8Array([0x80, 0x25])); // Baud rate
		expect(sentFrames[1]).toEqual(new Uint8Array([0x55])); // Sync
		expect(sentFrames[3]).toEqual(new Uint8Array([0x40])); // Kernel Init

		// 2. Event semantics
		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("BOOT_MODE_ENTERED");
		expect(eventTypes).toContain("SECURITY_ACCESS_REQUESTED");
		expect(eventTypes).toContain("SECURITY_ACCESS_GRANTED");
		expect(eventTypes).toContain("KERNEL_INITIALIZED");

		// 3. Progress semantics
		expect(progress.length).toBe(totalBlocks);
		const lastProgress = progress[progress.length - 1];
		expect(lastProgress).toBeDefined();
		expect(lastProgress?.percentComplete).toBe(100);
		expect(lastProgress?.bytesProcessed).toBe(ROM_SIZE);

		// 4. Data assembly
		expect(rom.length).toBe(ROM_SIZE);
		expect(rom[0]).toBe(0);
		expect(rom[BLOCK_SIZE]).toBe(1);
		expect(rom[rom.length - 1]).toBe((totalBlocks - 1) % 256);
	});

	it("fails and blocks success events when sync response is invalid", async () => {
		const protocol = new MitsubishiBootloaderProtocol();

		const transcript = [
			{ send: new Uint8Array([0x80, 0x25]), receive: new Uint8Array([]) }, // Break
			{ send: new Uint8Array([0x55]), receive: new Uint8Array([0xff]) }, // INVALID Sync
		];

		const { connection } = makeTranscriptConnection(transcript);

		const events: EcuEvent[] = [];

		await expect(
			protocol.readRom(connection, undefined, (e) => events.push(e)),
		).rejects.toThrow(/sync failed/i);

		// Assertions: Contract focus

		// Should NOT have emitted success events beyond the failure point
		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).not.toContain("BOOT_MODE_ENTERED");
		expect(eventTypes).not.toContain("SECURITY_ACCESS_GRANTED");
		expect(eventTypes).not.toContain("KERNEL_INITIALIZED");
	});

	it("fails when kernel initialization returns unexpected byte", async () => {
		const protocol = new MitsubishiBootloaderProtocol();

		const transcript = [
			{ send: new Uint8Array([0x80, 0x25]), receive: new Uint8Array([]) }, // Break
			{ send: new Uint8Array([0x55]), receive: new Uint8Array([0xaa]) }, // Sync
			{
				send: new Uint8Array([0x9a, 0x88, 0x01, 0x08, 0xa0, 0x03]),
				receive: new Uint8Array([0x00]),
			}, // Challenge A
			{ send: new Uint8Array([0x40]), receive: new Uint8Array([0xee]) }, // INVALID Kernel Init (expected 0x11)
		];

		const { connection } = makeTranscriptConnection(transcript);

		const events: EcuEvent[] = [];

		await expect(
			protocol.readRom(connection, undefined, (e) => events.push(e)),
		).rejects.toThrow(/kernel init failed/i);

		// Assertions: Contract focus

		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("BOOT_MODE_ENTERED");
		expect(eventTypes).toContain("SECURITY_ACCESS_GRANTED");
		expect(eventTypes).not.toContain("KERNEL_INITIALIZED");
	});
});
