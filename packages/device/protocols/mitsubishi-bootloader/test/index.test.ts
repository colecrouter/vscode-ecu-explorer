import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import { MitsubishiBootloaderProtocol } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal mock DeviceConnection for testing.
 *
 * @param transportName - The transport name to report (e.g. "openport2")
 * @param sendFrameImpl - Optional custom sendFrame implementation
 */
function makeMockConnection(
	transportName: string,
	sendFrameImpl?: (data: Uint8Array) => Promise<Uint8Array>,
): DeviceConnection {
	const deviceInfo: DeviceInfo = {
		id: "test-device-001",
		name: "Test Device",
		transportName,
		connected: true,
	};

	return {
		deviceInfo,
		sendFrame: sendFrameImpl ?? vi.fn().mockResolvedValue(new Uint8Array([])),
		startStream: vi.fn(),
		stopStream: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Build a sendFrame mock that simulates the full Mitsubishi bootloader handshake
 * in bench/recovery mode (bootMode=true, CHALLENGE_A, kernel init response 0x11).
 *
 * Call sequence expected by readRom():
 *   1. Break signal frame (2 bytes: baud rate low/high)  → empty response
 *   2. Sync byte 0x55                                    → [0xAA]
 *   3. Challenge A (6 bytes)                             → [0x00] (any)
 *   4. Kernel init 0x40                                  → [0x11]
 *   5..N. ROM block reads (4 bytes each)                 → 128-byte blocks
 */
function makeBootloaderMock(): (data: Uint8Array) => Promise<Uint8Array> {
	let callIndex = 0;
	const ROM_SIZE = 0x080000; // 512 KB (SH7055 / EVO 9)
	const BLOCK_SIZE = 0x80; // 128 bytes
	const totalBlocks = ROM_SIZE / BLOCK_SIZE;

	return async (data: Uint8Array): Promise<Uint8Array> => {
		const call = callIndex++;

		if (call === 0) {
			// Break signal / baud rate frame
			return new Uint8Array([]);
		}
		if (call === 1) {
			// Sync byte 0x55 → respond with 0xAA
			expect(data[0]).toBe(0x55);
			return new Uint8Array([0xaa]);
		}
		if (call === 2) {
			// Challenge A (6 bytes) — bench/recovery mode
			expect(data.length).toBe(6);
			expect(Array.from(data)).toEqual([0x9a, 0x88, 0x01, 0x08, 0xa0, 0x03]);
			return new Uint8Array([0x00]);
		}
		if (call === 3) {
			// Kernel init 0x40 → respond with 0x11 (bench/recovery mode)
			expect(data[0]).toBe(0x40);
			return new Uint8Array([0x11]);
		}
		// ROM block reads: return a 128-byte block filled with the block index
		const blockIndex = call - 4;
		if (blockIndex < totalBlocks) {
			return new Uint8Array(BLOCK_SIZE).fill(blockIndex & 0xff);
		}
		throw new Error(`Unexpected sendFrame call #${call}`);
	};
}

/**
 * Build a sendFrame mock that simulates the full Mitsubishi bootloader handshake
 * in in-car/normal mode (bootMode=false, CHALLENGE_B, kernel init response 0x1C).
 *
 * Call sequence expected by readRom(connection, undefined, undefined, false):
 *   1. Break signal frame (2 bytes: baud rate low/high)  → empty response
 *   2. Sync byte 0x55                                    → [0xAA]
 *   3. Challenge B (6 bytes)                             → [0x00] (any)
 *   4. Kernel init 0x40                                  → [0x1C]
 *   5..N. ROM block reads (4 bytes each)                 → 128-byte blocks
 */
function makeBootloaderMockNormalMode(): (
	data: Uint8Array,
) => Promise<Uint8Array> {
	let callIndex = 0;
	const ROM_SIZE = 0x080000; // 512 KB (SH7055 / EVO 9)
	const BLOCK_SIZE = 0x80; // 128 bytes
	const totalBlocks = ROM_SIZE / BLOCK_SIZE;

	return async (data: Uint8Array): Promise<Uint8Array> => {
		const call = callIndex++;

		if (call === 0) {
			// Break signal / baud rate frame
			return new Uint8Array([]);
		}
		if (call === 1) {
			// Sync byte 0x55 → respond with 0xAA
			expect(data[0]).toBe(0x55);
			return new Uint8Array([0xaa]);
		}
		if (call === 2) {
			// Challenge B (6 bytes) — in-car/normal mode
			expect(data.length).toBe(6);
			expect(Array.from(data)).toEqual([0x9b, 0xec, 0x2b, 0x8b, 0xd4, 0x86]);
			return new Uint8Array([0x00]);
		}
		if (call === 3) {
			// Kernel init 0x40 → respond with 0x1C (in-car/normal mode)
			expect(data[0]).toBe(0x40);
			return new Uint8Array([0x1c]);
		}
		// ROM block reads: return a 128-byte block filled with the block index
		const blockIndex = call - 4;
		if (blockIndex < totalBlocks) {
			return new Uint8Array(BLOCK_SIZE).fill(blockIndex & 0xff);
		}
		throw new Error(`Unexpected sendFrame call #${call}`);
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MitsubishiBootloaderProtocol", () => {
	// ── canHandle ────────────────────────────────────────────────────────────

	describe("canHandle()", () => {
		it("returns true for openport2 connections", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns false for non-openport2 connections", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("elm327");
			expect(await protocol.canHandle(connection)).toBe(false);
		});

		it("returns false for empty transport name", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("");
			expect(await protocol.canHandle(connection)).toBe(false);
		});
	});

	// ── Protocol name ────────────────────────────────────────────────────────

	describe("name", () => {
		it("has a human-readable name", () => {
			const protocol = new MitsubishiBootloaderProtocol();
			expect(protocol.name).toBe("Mitsubishi SH705x Bootloader");
		});
	});

	// ── Challenge/response sequence — boot mode (CHALLENGE_A) ────────────────

	describe("readRom() — handshake sequence (bootMode=true, default)", () => {
		it("sends BOOT_SYNC_SEND (0x55) as the second frame", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([]); // break signal
				if (call === 1) return new Uint8Array([0xaa]); // sync response
				if (call === 2) return new Uint8Array([0x00]); // challenge response
				if (call === 3) return new Uint8Array([0x11]); // kernel init response
				// ROM blocks
				return new Uint8Array(0x80).fill(0x00);
			});

			await protocol.readRom(connection);

			// Frame index 1 is the sync byte
			expect(frames[1]).toEqual(new Uint8Array([0x55]));
		});

		it("sends CHALLENGE_A (9A 88 01 08 A0 03) as the third frame in boot mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]);
				return new Uint8Array(0x80).fill(0x00);
			});

			await protocol.readRom(connection); // bootMode defaults to true

			expect(Array.from(frames[2]!)).toEqual([
				0x9a, 0x88, 0x01, 0x08, 0xa0, 0x03,
			]);
		});

		it("sends KERNEL_INIT_SEND (0x40) as the fourth frame", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]);
				return new Uint8Array(0x80).fill(0x00);
			});

			await protocol.readRom(connection);

			expect(frames[3]).toEqual(new Uint8Array([0x40]));
		});

		it("accepts 0x11 as a valid kernel init response in boot mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			// Should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});

		it("throws if sync response is not 0xAA", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0x55]); // wrong response
				return new Uint8Array([]);
			});
			await expect(protocol.readRom(connection)).rejects.toThrow(
				/sync failed/i,
			);
		});

		it("throws if sync response is empty", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([]); // empty response
				return new Uint8Array([]);
			});
			await expect(protocol.readRom(connection)).rejects.toThrow(
				/sync failed/i,
			);
		});

		it("throws if kernel init response is unexpected in boot mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0xff]); // unexpected
				return new Uint8Array([]);
			});
			await expect(protocol.readRom(connection)).rejects.toThrow(
				/kernel init failed/i,
			);
		});

		it("throws if kernel init response is 0x1C in boot mode (wrong mode response)", async () => {
			// In boot mode (bootMode=true), only 0x11 is accepted; 0x1C is the normal-mode response
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x1c]); // normal-mode response in boot mode
				return new Uint8Array([]);
			});
			await expect(
				protocol.readRom(connection, undefined, undefined, true),
			).rejects.toThrow(/kernel init failed/i);
		});
	});

	// ── Challenge/response sequence — normal mode (CHALLENGE_B) ──────────────

	describe("readRom() — handshake sequence (bootMode=false, in-car/normal mode)", () => {
		it("sends CHALLENGE_B (9B EC 2B 8B D4 86) as the third frame in normal mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x1c]); // normal mode response
				return new Uint8Array(0x80).fill(0x00);
			});

			await protocol.readRom(connection, undefined, undefined, false); // bootMode=false

			expect(Array.from(frames[2]!)).toEqual([
				0x9b, 0xec, 0x2b, 0x8b, 0xd4, 0x86,
			]);
		});

		it("accepts 0x1C as a valid kernel init response in normal mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection(
				"openport2",
				makeBootloaderMockNormalMode(),
			);
			await expect(
				protocol.readRom(connection, undefined, undefined, false),
			).resolves.toBeInstanceOf(Uint8Array);
		});

		it("throws if kernel init response is 0x11 in normal mode (wrong mode response)", async () => {
			// In normal mode (bootMode=false), only 0x1C is accepted; 0x11 is the boot-mode response
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]); // boot-mode response in normal mode
				return new Uint8Array([]);
			});
			await expect(
				protocol.readRom(connection, undefined, undefined, false),
			).rejects.toThrow(/kernel init failed/i);
		});

		it("throws if kernel init response is unexpected in normal mode", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0xff]); // unexpected
				return new Uint8Array([]);
			});
			await expect(
				protocol.readRom(connection, undefined, undefined, false),
			).rejects.toThrow(/kernel init failed/i);
		});

		it("reads full ROM in normal mode (bootMode=false)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection(
				"openport2",
				makeBootloaderMockNormalMode(),
			);
			const rom = await protocol.readRom(
				connection,
				undefined,
				undefined,
				false,
			);
			expect(rom).toBeInstanceOf(Uint8Array);
			expect(rom.length).toBe(0x080000); // 512 KB
		});
	});

	// ── ROM read ─────────────────────────────────────────────────────────────

	describe("readRom() — ROM data", () => {
		it("returns a Uint8Array of exactly 512 KB (0x080000 bytes)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const rom = await protocol.readRom(connection);
			expect(rom).toBeInstanceOf(Uint8Array);
			expect(rom.length).toBe(0x080000);
		});

		it("assembles ROM blocks in correct order", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const rom = await protocol.readRom(connection);

			// Block 0 should be filled with 0x00, block 1 with 0x01, etc.
			// (makeBootloaderMock fills each block with blockIndex & 0xFF)
			expect(rom[0]).toBe(0x00); // block 0, byte 0
			expect(rom[0x80]).toBe(0x01); // block 1, byte 0
			expect(rom[0x100]).toBe(0x02); // block 2, byte 0
		});
	});

	// ── Progress reporting ────────────────────────────────────────────────────

	describe("readRom() — progress reporting", () => {
		it("calls onProgress for each block read", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const progressCalls: number[] = [];

			await protocol.readRom(connection, (p) => {
				progressCalls.push(p.percentComplete);
			});

			// 512 KB / 128 bytes = 4096 blocks → 4096 progress calls
			expect(progressCalls.length).toBe(4096);
		});

		it("reports phase as 'reading'", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const phases = new Set<string>();

			await protocol.readRom(connection, (p) => {
				phases.add(p.phase);
			});

			expect(phases).toEqual(new Set(["reading"]));
		});

		it("reports totalBytes as 512 KB (0x080000)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const totalBytesValues = new Set<number>();

			await protocol.readRom(connection, (p) => {
				totalBytesValues.add(p.totalBytes);
			});

			expect(totalBytesValues).toEqual(new Set([0x080000]));
		});

		it("reports percentComplete from ~0 to 100", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			let firstPercent = -1;
			let lastPercent = -1;

			await protocol.readRom(connection, (p) => {
				if (firstPercent === -1) firstPercent = p.percentComplete;
				lastPercent = p.percentComplete;
			});

			expect(firstPercent).toBeGreaterThan(0);
			expect(firstPercent).toBeLessThan(1);
			expect(lastPercent).toBe(100);
		});

		it("reports bytesProcessed increasing monotonically", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			let prevBytes = 0;
			let monotonic = true;

			await protocol.readRom(connection, (p) => {
				if (p.bytesProcessed <= prevBytes) monotonic = false;
				prevBytes = p.bytesProcessed;
			});

			expect(monotonic).toBe(true);
		});

		it("does not throw if onProgress is not provided", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			// No onProgress callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});
	});

	// ── writeRom ─────────────────────────────────────────────────────────────

	describe("writeRom()", () => {
		it("writes the full 512 KB ROM in 128-byte blocks (no originalRom — full flash)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const BLOCK_SIZE = 0x80;
			const SECTOR_SIZE = 0x10000;
			const NUM_SECTORS = ROM_SIZE / SECTOR_SIZE;
			const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;
			const romToWrite = new Uint8Array(ROM_SIZE).fill(0x55);

			const eraseFrames: Uint8Array[] = [];
			const writeFrames: Uint8Array[] = [];
			let verifyCount = 0;

			let callIndex = 0;
			const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge
				if (call === 3) return new Uint8Array([0x11]); // Kernel init
				// After handshake: 8 sectors × (1 erase + 512 write blocks) + 1 verify
				if (data[0] === 0x20) {
					eraseFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x40) {
					writeFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x50) {
					verifyCount++;
					return new Uint8Array([0x06]);
				}
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", sendFrame);
			const onProgress = vi.fn();

			await protocol.writeRom(connection, romToWrite, onProgress);

			// All 8 sectors should be erased (512 KB / 64 KB = 8 sectors)
			expect(eraseFrames.length).toBe(NUM_SECTORS);
			// All blocks should be written
			expect(writeFrames.length).toBe(NUM_SECTORS * BLOCKS_PER_SECTOR);
			// Verify should be called once
			expect(verifyCount).toBe(1);

			expect(onProgress).toHaveBeenCalledWith(
				expect.objectContaining({ phase: "erasing" }),
			);
			expect(onProgress).toHaveBeenCalledWith(
				expect.objectContaining({ phase: "writing" }),
			);
			expect(onProgress).toHaveBeenCalledWith(
				expect.objectContaining({ phase: "verifying" }),
			);
		});

		it("only erases and writes changed sectors when originalRom is provided", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const SECTOR_SIZE = 0x10000;
			const BLOCK_SIZE = 0x80;
			const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;

			// Create original ROM (all zeros) and modified ROM with only sector 2 changed
			const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
			const modifiedRom = new Uint8Array(ROM_SIZE).fill(0x00);
			modifiedRom[0x20000] = 0xff; // change one byte in sector 2

			const eraseFrames: Uint8Array[] = [];
			const writeFrames: Uint8Array[] = [];

			let callIndex = 0;
			const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge
				if (call === 3) return new Uint8Array([0x11]); // Kernel init
				if (data[0] === 0x20) {
					eraseFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x40) {
					writeFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x50) {
					return new Uint8Array([0x06]);
				}
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", sendFrame);

			await protocol.writeRom(connection, modifiedRom, vi.fn(), {
				originalRom,
			});

			// Only sector 2 should be erased (1 erase frame)
			expect(eraseFrames.length).toBe(1);
			// Erase frame should contain sector 2 address (0x020000)
			expect(eraseFrames[0]![0]).toBe(0x20); // CMD_ERASE
			expect(eraseFrames[0]![1]).toBe(0x02); // addr byte 0 (0x020000 >> 16)
			expect(eraseFrames[0]![2]).toBe(0x00); // addr byte 1
			expect(eraseFrames[0]![3]).toBe(0x00); // addr byte 2

			// Only blocks in sector 2 should be written
			expect(writeFrames.length).toBe(BLOCKS_PER_SECTOR);
		});

		it("skips all sectors when originalRom is identical to modified ROM", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const identicalRom = new Uint8Array(ROM_SIZE).fill(0xaa);

			const eraseFrames: Uint8Array[] = [];
			const writeFrames: Uint8Array[] = [];

			let callIndex = 0;
			const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge
				if (call === 3) return new Uint8Array([0x11]); // Kernel init
				if (data[0] === 0x20) {
					eraseFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x40) {
					writeFrames.push(data);
					return new Uint8Array([0x06]);
				}
				if (data[0] === 0x50) {
					return new Uint8Array([0x06]);
				}
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", sendFrame);

			await protocol.writeRom(connection, identicalRom, vi.fn(), {
				originalRom: identicalRom,
			});

			// No sectors should be erased or written
			expect(eraseFrames.length).toBe(0);
			expect(writeFrames.length).toBe(0);
		});

		it("performs a dry run without erasing or writing", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);

			let callIndex = 0;
			const bootMock = async (_data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]);
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", bootMock);
			const onProgress = vi.fn();

			await protocol.writeRom(connection, romToWrite, onProgress, {
				dryRun: true,
			});

			// Should only have 4 calls for handshake, no erase/write/verify
			expect(callIndex).toBe(4);
			expect(onProgress).toHaveBeenCalledWith(
				expect.objectContaining({ phase: "writing", percentComplete: 100 }),
			);
		});

		it("dryRun still works when originalRom is also provided", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
			const modifiedRom = new Uint8Array(ROM_SIZE).fill(0xff);

			let callIndex = 0;
			const bootMock = async (_data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]);
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", bootMock);
			const onProgress = vi.fn();

			await protocol.writeRom(connection, modifiedRom, onProgress, {
				dryRun: true,
				originalRom,
			});

			// dryRun short-circuits before diff — only 4 handshake calls
			expect(callIndex).toBe(4);
			expect(onProgress).toHaveBeenCalledWith(
				expect.objectContaining({ phase: "writing", percentComplete: 100 }),
			);
		});

		it("throws if ROM size is incorrect", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const wrongSizeRom = new Uint8Array(0x100000); // 1 MB instead of 512 KB
			const connection = makeMockConnection("openport2");

			await expect(
				protocol.writeRom(connection, wrongSizeRom, vi.fn()),
			).rejects.toThrow(/invalid rom size/i);
		});

		it("uses CHALLENGE_B in normal mode (bootMode=false) during writeRom", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const romToWrite = new Uint8Array(ROM_SIZE).fill(0x55);
			const frames: Uint8Array[] = [];

			let callIndex = 0;
			const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
				frames.push(data);
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge B response
				if (call === 3) return new Uint8Array([0x1c]); // Kernel init (normal mode)
				if (data[0] === 0x20) return new Uint8Array([0x06]); // Erase
				if (data[0] === 0x40) return new Uint8Array([0x06]); // Write
				if (data[0] === 0x50) return new Uint8Array([0x06]); // Verify
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", sendFrame);

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				undefined,
				false, // bootMode=false → CHALLENGE_B
			);

			// Frame index 2 should be CHALLENGE_B
			expect(Array.from(frames[2]!)).toEqual([
				0x9b, 0xec, 0x2b, 0x8b, 0xd4, 0x86,
			]);
		});
	});

	// ── onEvent callbacks ─────────────────────────────────────────────────────

	describe("readRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			// No onEvent callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});

		it("emits BOOT_MODE_ENTERED after sync is confirmed", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "BOOT_MODE_ENTERED" }),
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED during challenge/response", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED after challenge response is received", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});

		it("emits BOOT_MODE_ENTERED before SECURITY_ACCESS_REQUESTED", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const eventOrder: string[] = [];

			await protocol.readRom(connection, undefined, (event) => {
				eventOrder.push(event.type);
			});

			const bootIdx = eventOrder.indexOf("BOOT_MODE_ENTERED");
			const requestedIdx = eventOrder.indexOf("SECURITY_ACCESS_REQUESTED");
			expect(bootIdx).toBeGreaterThanOrEqual(0);
			expect(requestedIdx).toBeGreaterThan(bootIdx);
		});

		it("emits SECURITY_ACCESS_REQUESTED before SECURITY_ACCESS_GRANTED", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const eventOrder: string[] = [];

			await protocol.readRom(connection, undefined, (event) => {
				eventOrder.push(event.type);
			});

			const requestedIdx = eventOrder.indexOf("SECURITY_ACCESS_REQUESTED");
			const grantedIdx = eventOrder.indexOf("SECURITY_ACCESS_GRANTED");
			expect(requestedIdx).toBeGreaterThanOrEqual(0);
			expect(grantedIdx).toBeGreaterThan(requestedIdx);
		});

		it("emits events with a numeric timestamp", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection("openport2", makeBootloaderMock());
			const events: { type: string; timestamp: number }[] = [];

			await protocol.readRom(connection, undefined, (event) => {
				events.push({ type: event.type, timestamp: event.timestamp });
			});

			for (const event of events) {
				expect(typeof event.timestamp).toBe("number");
				expect(event.timestamp).toBeGreaterThan(0);
			}
		});

		it("emits BOOT_MODE_ENTERED in normal mode (bootMode=false)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection(
				"openport2",
				makeBootloaderMockNormalMode(),
			);
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent, false);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "BOOT_MODE_ENTERED" }),
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED in normal mode (bootMode=false)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection(
				"openport2",
				makeBootloaderMockNormalMode(),
			);
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent, false);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED in normal mode (bootMode=false)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const connection = makeMockConnection(
				"openport2",
				makeBootloaderMockNormalMode(),
			);
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent, false);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});
	});

	describe("writeRom() — onEvent", () => {
		function makeWriteRomMock(): (data: Uint8Array) => Promise<Uint8Array> {
			let callIndex = 0;
			return async (data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge
				if (call === 3) return new Uint8Array([0x11]); // Kernel init
				if (data[0] === 0x20) return new Uint8Array([0x06]); // Erase
				if (data[0] === 0x40) return new Uint8Array([0x06]); // Write
				if (data[0] === 0x50) return new Uint8Array([0x06]); // Verify
				return new Uint8Array([]);
			};
		}

		function makeWriteRomMockNormalMode(): (
			data: Uint8Array,
		) => Promise<Uint8Array> {
			let callIndex = 0;
			return async (data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]); // Break
				if (call === 1) return new Uint8Array([0xaa]); // Sync
				if (call === 2) return new Uint8Array([0x00]); // Challenge B response
				if (call === 3) return new Uint8Array([0x1c]); // Kernel init (normal mode)
				if (data[0] === 0x20) return new Uint8Array([0x06]); // Erase
				if (data[0] === 0x40) return new Uint8Array([0x06]); // Write
				if (data[0] === 0x50) return new Uint8Array([0x06]); // Verify
				return new Uint8Array([]);
			};
		}

		it("does not throw when onEvent is not provided", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			// No onEvent callback — should not throw
			await expect(
				protocol.writeRom(connection, romToWrite, vi.fn()),
			).resolves.toBeUndefined();
		});

		it("emits SECURITY_ACCESS_REQUESTED during challenge/response", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				onEvent,
			);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED after challenge response is received", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				onEvent,
			);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});

		it("emits SECTOR_ERASE_STARTED before each sector erase", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				onEvent,
			);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECTOR_ERASE_STARTED" }),
			);
		});

		it("emits SECTOR_ERASE_COMPLETE after each sector erase", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				onEvent,
			);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECTOR_ERASE_COMPLETE" }),
			);
		});

		it("emits SECTOR_ERASE_STARTED and SECTOR_ERASE_COMPLETE for each sector (8 sectors)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const ROM_SIZE = 0x080000;
			const SECTOR_SIZE = 0x10000;
			const NUM_SECTORS = ROM_SIZE / SECTOR_SIZE;
			const romToWrite = new Uint8Array(ROM_SIZE).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const eraseStarted: unknown[] = [];
			const eraseComplete: unknown[] = [];

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				(event) => {
					if (event.type === "SECTOR_ERASE_STARTED") eraseStarted.push(event);
					if (event.type === "SECTOR_ERASE_COMPLETE") eraseComplete.push(event);
				},
			);

			expect(eraseStarted.length).toBe(NUM_SECTORS);
			expect(eraseComplete.length).toBe(NUM_SECTORS);
		});

		it("emits SECTOR_ERASE_STARTED before SECTOR_ERASE_COMPLETE for each sector", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const eventOrder: string[] = [];

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				(event) => {
					if (
						event.type === "SECTOR_ERASE_STARTED" ||
						event.type === "SECTOR_ERASE_COMPLETE"
					) {
						eventOrder.push(event.type);
					}
				},
			);

			// Events should alternate: STARTED, COMPLETE, STARTED, COMPLETE, ...
			for (let i = 0; i < eventOrder.length; i += 2) {
				expect(eventOrder[i]).toBe("SECTOR_ERASE_STARTED");
				expect(eventOrder[i + 1]).toBe("SECTOR_ERASE_COMPLETE");
			}
		});

		it("onProgress includes a non-empty message string during erasing phase", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const progressMessages: string[] = [];

			await protocol.writeRom(connection, romToWrite, (p) => {
				if (p.message) progressMessages.push(p.message);
			});

			expect(progressMessages.length).toBeGreaterThan(0);
			expect(progressMessages[0]).toBeTruthy();
		});

		it("emits only security events during dryRun (no sector events)", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);

			let callIndex = 0;
			const dryRunMock = async (_data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([]);
				if (call === 1) return new Uint8Array([0xaa]);
				if (call === 2) return new Uint8Array([0x00]);
				if (call === 3) return new Uint8Array([0x11]);
				return new Uint8Array([]);
			};

			const connection = makeMockConnection("openport2", dryRunMock);
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				{ dryRun: true },
				onEvent,
			);

			// Security events should be emitted
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
			// No sector events during dry run
			const calls = onEvent.mock.calls.map((c) => c[0].type);
			expect(calls).not.toContain("SECTOR_ERASE_STARTED");
			expect(calls).not.toContain("SECTOR_ERASE_COMPLETE");
		});

		it("emits SECURITY_ACCESS_REQUESTED in normal mode (bootMode=false) during writeRom", async () => {
			const protocol = new MitsubishiBootloaderProtocol();
			const romToWrite = new Uint8Array(0x080000).fill(0x55);
			const connection = makeMockConnection(
				"openport2",
				makeWriteRomMockNormalMode(),
			);
			const onEvent = vi.fn();

			await protocol.writeRom(
				connection,
				romToWrite,
				vi.fn(),
				undefined,
				onEvent,
				false, // bootMode=false
			);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});
	});
});
