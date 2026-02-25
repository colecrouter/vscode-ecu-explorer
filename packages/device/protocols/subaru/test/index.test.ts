import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import { SubaruProtocol } from "../src/index.js";
import { computeSubaruKey } from "../src/security.js";

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
	const deviceInfo = {
		id: "test-device-001",
		name: "Test Device",
		transportName,
		connected: true,
	} as const satisfies DeviceInfo;

	return {
		deviceInfo,
		sendFrame: sendFrameImpl ?? vi.fn().mockResolvedValue(new Uint8Array([])),
		startStream: vi.fn(),
		stopStream: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Build a sendFrame mock that simulates the full Subaru KWP2000 handshake.
 *
 * Call sequence expected by readRom():
 *   1. Start diagnostic session [0x10, 0x85]  → [0x50, 0x85] (positive response)
 *   2. Security access seed request [0x27, 0x01] → [0x67, 0x01, 0xAB, 0xCD] (seed)
 *   3. Security access key send [0x27, 0x02, key0, key1] → [0x67, 0x02] (positive response)
 *   4..N. ROM block reads [0x23, addr2, addr1, addr0, 0x80] → [0x63, ...128 bytes]
 *
 * The seed 0xAB 0xCD produces key 0xCE 0xE8 via the S-box algorithm:
 *   - 0xAB: high=0xA→SBOX_A[10]=12=0xC, low=0xB→0xB^5=0xE → 0xCE
 *   - 0xCD: high=0xC→SBOX_A[12]=14=0xE, low=0xD→0xD^5=8   → 0xE8
 */
function makeKwp2000Mock(): (data: Uint8Array) => Promise<Uint8Array> {
	let callIndex = 0;
	const ROM_SIZE = 0x100000; // 1 MB
	const BLOCK_SIZE = 0x80; // 128 bytes
	const totalBlocks = ROM_SIZE / BLOCK_SIZE;

	return async (data: Uint8Array): Promise<Uint8Array> => {
		const call = callIndex++;

		if (call === 0) {
			// Start diagnostic session [0x10, 0x85]
			expect(data[0]).toBe(0x10);
			expect(data[1]).toBe(0x85);
			return new Uint8Array([0x50, 0x85]);
		}
		if (call === 1) {
			// Security access seed request [0x27, 0x01]
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(0x01);
			// Return seed 0xAB 0xCD
			return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
		}
		if (call === 2) {
			// Security access key send [0x27, 0x02, key0, key1]
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(0x02);
			// Verify key matches expected S-box output for seed 0xAB 0xCD
			expect(data[2]).toBe(0xce); // key byte 0
			expect(data[3]).toBe(0xe8); // key byte 1
			return new Uint8Array([0x67, 0x02]);
		}
		// ROM block reads: return a 129-byte response (1 SID byte + 128 data bytes)
		const blockIndex = call - 3;
		if (blockIndex < totalBlocks) {
			const response = new Uint8Array(1 + BLOCK_SIZE);
			response[0] = 0x63; // positive response SID for readMemoryByAddress
			response.fill(blockIndex & 0xff, 1); // fill data with block index
			return response;
		}
		throw new Error(`Unexpected sendFrame call #${call}`);
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SubaruProtocol", () => {
	// ── canHandle ────────────────────────────────────────────────────────────

	describe("canHandle()", () => {
		it("returns true for openport2 connections", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns false for non-openport2 connections", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("elm327");
			expect(await protocol.canHandle(connection)).toBe(false);
		});

		it("returns false for empty transport name", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("");
			expect(await protocol.canHandle(connection)).toBe(false);
		});

		it("returns false for ssm transport name", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("ssm");
			expect(await protocol.canHandle(connection)).toBe(false);
		});
	});

	// ── Protocol name ────────────────────────────────────────────────────────

	describe("name", () => {
		it("has a human-readable name", () => {
			const protocol = new SubaruProtocol();
			expect(protocol.name).toBe("Subaru/Denso KWP2000 (CAN)");
		});
	});

	// ── KWP2000 SecurityAccess sequence ──────────────────────────────────────

	describe("readRom() — KWP2000 handshake sequence", () => {
		it("sends start diagnostic session [0x10, 0x85] as the first frame", async () => {
			const protocol = new SubaruProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				// ROM blocks
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			expect(Array.from(frames[0]!)).toEqual([0x10, 0x85]);
		});

		it("sends security access seed request [0x27, 0x01] as the second frame", async () => {
			const protocol = new SubaruProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			expect(Array.from(frames[1]!)).toEqual([0x27, 0x01]);
		});

		it("sends security access key [0x27, 0x02, key0, key1] as the third frame", async () => {
			const protocol = new SubaruProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				// Seed: 0xAB 0xCD → key: 0xCE 0xE8
				if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Frame 2: [0x27, 0x02, key0, key1]
			expect(frames[2]![0]).toBe(0x27);
			expect(frames[2]![1]).toBe(0x02);
			// Key for seed 0xAB 0xCD
			expect(frames[2]![2]).toBe(0xce);
			expect(frames[2]![3]).toBe(0xe8);
		});

		it("computes key from seed using S-box algorithm", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			// Should not throw — the mock verifies the key bytes
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});

		it("sends ROM block read [0x23, addr2, addr1, addr0, 0x80] for first block", async () => {
			const protocol = new SubaruProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Frame 3 is the first ROM block read (addr = 0x000000)
			expect(Array.from(frames[3]!)).toEqual([0x23, 0x00, 0x00, 0x00, 0x80]);
		});

		it("sends correct address for second ROM block", async () => {
			const protocol = new SubaruProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Frame 4 is the second ROM block read (addr = 0x000080)
			expect(Array.from(frames[4]!)).toEqual([0x23, 0x00, 0x00, 0x80, 0x80]);
		});
	});

	// ── ROM read ─────────────────────────────────────────────────────────────

	describe("readRom() — ROM data", () => {
		it("returns a Uint8Array of exactly 1 MB (0x100000 bytes)", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			const rom = await protocol.readRom(connection);
			expect(rom).toBeInstanceOf(Uint8Array);
			expect(rom.length).toBe(0x100000);
		});

		it("assembles ROM blocks in correct order", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			const rom = await protocol.readRom(connection);

			// makeKwp2000Mock fills each block with blockIndex & 0xFF
			// Block 0 → 0x00, block 1 → 0x01, block 2 → 0x02
			expect(rom[0]).toBe(0x00); // block 0, byte 0
			expect(rom[0x80]).toBe(0x01); // block 1, byte 0
			expect(rom[0x100]).toBe(0x02); // block 2, byte 0
		});

		it("skips the first response byte (positive response SID 0x63)", async () => {
			const protocol = new SubaruProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				// ROM block: [0x63, 0xAA, 0xAA, ...] — first byte is SID, rest is data
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				resp.fill(0xaa, 1);
				return resp;
			});

			const rom = await protocol.readRom(connection);

			// All ROM bytes should be 0xAA (the data), not 0x63 (the SID)
			expect(rom[0]).toBe(0xaa);
			expect(rom[0x7f]).toBe(0xaa);
		});
	});

	// ── Progress reporting ────────────────────────────────────────────────────

	describe("readRom() — progress reporting", () => {
		it("calls onProgress for each block read", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			const progressCalls: number[] = [];

			await protocol.readRom(connection, (p) => {
				progressCalls.push(p.percentComplete);
			});

			// 1 MB / 128 bytes = 8192 blocks → 8192 progress calls
			expect(progressCalls.length).toBe(8192);
		});

		it("reports phase as 'reading'", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			const phases = new Set<string>();

			await protocol.readRom(connection, (p) => {
				phases.add(p.phase);
			});

			expect(phases).toEqual(new Set(["reading"]));
		});

		it("reports totalBytes as 1 MB (0x100000)", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			const totalBytesValues = new Set<number>();

			await protocol.readRom(connection, (p) => {
				totalBytesValues.add(p.totalBytes);
			});

			expect(totalBytesValues).toEqual(new Set([0x100000]));
		});

		it("reports percentComplete from ~0 to 100", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
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
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			let prevBytes = 0;
			let monotonic = true;

			await protocol.readRom(connection, (p) => {
				if (p.bytesProcessed <= prevBytes) monotonic = false;
				prevBytes = p.bytesProcessed;
			});

			expect(monotonic).toBe(true);
		});

		it("does not throw if onProgress is not provided", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeKwp2000Mock());
			// No onProgress callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});
	});
});

// ── computeSubaruKey tests ────────────────────────────────────────────────────

describe("computeSubaruKey", () => {
	// ── Known seed/key pairs from S-box algorithm ────────────────────────────
	//
	// SBOX_A = [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11]
	// For each byte: new_high = SBOX_A[byte >> 4], new_low = (byte & 0xF) ^ 0x5
	// result = (new_high << 4) | new_low
	//
	// Ref: HANDSHAKE_ANALYSIS.md — §4.5 densoecu::transform_kernel_block02 (0x1510a)

	it("all-zeros seed: 0x00 → 0xA5 (high=0→10=0xA, low=0→0^5=5)", () => {
		// 0x00: high=0→SBOX_A[0]=10=0xA, low=0→0^5=5 → 0xA5
		const key = computeSubaruKey(new Uint8Array([0x00, 0x00]));
		expect(Array.from(key)).toEqual([0xa5, 0xa5]);
	});

	it("all-0xFF seed: 0xFF → 0xBA (high=0xF→11=0xB, low=0xF→0xF^5=0xA)", () => {
		// 0xFF: high=0xF→SBOX_A[15]=11=0xB, low=0xF→0xF^5=0xA → 0xBA
		const key = computeSubaruKey(new Uint8Array([0xff, 0xff]));
		expect(Array.from(key)).toEqual([0xba, 0xba]);
	});

	it("seed 0x12 0x34 produces correct key", () => {
		// 0x12: high=1→SBOX_A[1]=5, low=2→2^5=7 → 0x57
		// 0x34: high=3→SBOX_A[3]=7, low=4→4^5=1 → 0x71
		const key = computeSubaruKey(new Uint8Array([0x12, 0x34]));
		expect(Array.from(key)).toEqual([0x57, 0x71]);
	});

	it("seed 0xAB 0xCD produces correct key", () => {
		// 0xAB: high=0xA→SBOX_A[10]=12=0xC, low=0xB→0xB^5=0xE → 0xCE
		// 0xCD: high=0xC→SBOX_A[12]=14=0xE, low=0xD→0xD^5=8   → 0xE8
		const key = computeSubaruKey(new Uint8Array([0xab, 0xcd]));
		expect(Array.from(key)).toEqual([0xce, 0xe8]);
	});

	it("seed 0x00 0xFF produces correct key", () => {
		// 0x00 → 0xA5, 0xFF → 0xBA
		const key = computeSubaruKey(new Uint8Array([0x00, 0xff]));
		expect(Array.from(key)).toEqual([0xa5, 0xba]);
	});

	it("seed 0x80 0x00 produces correct key (high-bit set)", () => {
		// 0x80: high=8→SBOX_A[8]=2, low=0→0^5=5 → 0x25
		// 0x00: high=0→SBOX_A[0]=10=0xA, low=0→0^5=5 → 0xA5
		const key = computeSubaruKey(new Uint8Array([0x80, 0x00]));
		expect(Array.from(key)).toEqual([0x25, 0xa5]);
	});

	it("seed 0x55 0xAA produces correct key", () => {
		// 0x55: high=5→SBOX_A[5]=1, low=5→5^5=0 → 0x10
		// 0xAA: high=0xA→SBOX_A[10]=12=0xC, low=0xA→0xA^5=0xF → 0xCF
		const key = computeSubaruKey(new Uint8Array([0x55, 0xaa]));
		expect(Array.from(key)).toEqual([0x10, 0xcf]);
	});

	// ── Output format ───────────────────────────────────────────────────────

	it("returns a Uint8Array of exactly 2 bytes", () => {
		const key = computeSubaruKey(new Uint8Array([0x00, 0x00]));
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(2);
	});

	it("returns a different Uint8Array instance from the input", () => {
		const seed = new Uint8Array([0x12, 0x34]);
		const key = computeSubaruKey(seed);
		expect(key).not.toBe(seed);
	});

	// ── Algorithm properties ────────────────────────────────────────────────

	it("is deterministic — same seed always produces same key", () => {
		const seed = new Uint8Array([0xde, 0xad]);
		const key1 = computeSubaruKey(seed);
		const key2 = computeSubaruKey(seed);
		expect(Array.from(key1)).toEqual(Array.from(key2));
	});

	it("different seeds produce different keys (non-trivial mapping)", () => {
		const key1 = computeSubaruKey(new Uint8Array([0x00, 0x00]));
		const key2 = computeSubaruKey(new Uint8Array([0x00, 0x01]));
		expect(Array.from(key1)).not.toEqual(Array.from(key2));
	});

	it("is not a simple XOR of the seed (not a trivial algorithm)", () => {
		// Verify the S-box algorithm differs from a simple XOR for a known seed
		const seed = new Uint8Array([0x12, 0x34]);
		const key = computeSubaruKey(seed);
		const xorKey = [0x12 ^ 0xff, 0x34 ^ 0xff]; // [0xED, 0xCB]
		expect(Array.from(key)).not.toEqual(xorKey);
	});

	it("S-box maps all 16 high nibbles to distinct values (bijective)", () => {
		// SBOX_A = [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11]
		// All 16 values should be distinct (it's a permutation)
		const SBOX_A = [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11];
		const uniqueValues = new Set(SBOX_A);
		expect(uniqueValues.size).toBe(16);
	});

	// ── Error handling ──────────────────────────────────────────────────────

	it("throws RangeError for empty seed", () => {
		expect(() => computeSubaruKey(new Uint8Array([]))).toThrow(RangeError);
	});

	it("throws RangeError for 1-byte seed", () => {
		expect(() => computeSubaruKey(new Uint8Array([0x42]))).toThrow(RangeError);
	});

	it("throws RangeError for 3-byte seed", () => {
		expect(() => computeSubaruKey(new Uint8Array([0x01, 0x02, 0x03]))).toThrow(
			RangeError,
		);
	});

	it("throws RangeError for 4-byte seed", () => {
		expect(() =>
			computeSubaruKey(new Uint8Array([0x01, 0x02, 0x03, 0x04])),
		).toThrow(RangeError);
	});

	it("error message includes the actual seed length", () => {
		expect(() => computeSubaruKey(new Uint8Array([0x01, 0x02, 0x03]))).toThrow(
			/3 bytes/,
		);
	});
});

// ── writeRom tests ────────────────────────────────────────────────────────────

describe("SubaruProtocol.writeRom()", () => {
	/**
	 * Build a generic sendFrame mock for Subaru write operations.
	 * Handles session setup (3 calls) and then responds to any SID.
	 */
	function makeMockConnection(
		transportName: string,
		sendFrameImpl?: (data: Uint8Array) => Promise<Uint8Array>,
	) {
		return {
			deviceInfo: {
				id: "test-device-001",
				name: "Test Device",
				transportName,
				connected: true,
			},
			sendFrame: sendFrameImpl ?? vi.fn().mockResolvedValue(new Uint8Array([])),
			startStream: vi.fn(),
			stopStream: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		};
	}

	it("writes the full 1 MB ROM with progress reporting (no originalRom — full flash)", async () => {
		const protocol = new SubaruProtocol();
		const ROM_SIZE = 0x100000;
		const SECTOR_SIZE = 0x10000;
		const BLOCK_SIZE = 0x80;
		const NUM_SECTORS = ROM_SIZE / SECTOR_SIZE;
		const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;
		const romToWrite = new Uint8Array(ROM_SIZE).fill(0xaa);

		const eraseFrames: Uint8Array[] = [];
		const downloadFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];
		const exitFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0xff) {
				eraseFrames.push(data);
				return new Uint8Array([0x00]);
			}
			if (data[0] === 0x34) {
				downloadFrames.push(data);
				return new Uint8Array([0x74]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76]);
			}
			if (data[0] === 0x37) {
				exitFrames.push(data);
				return new Uint8Array([0x77]);
			}
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sendFrame);
		const onProgress = vi.fn();

		await protocol.writeRom(connection, romToWrite, onProgress);

		// All 16 sectors should be erased, downloaded, transferred, and exited
		expect(eraseFrames.length).toBe(NUM_SECTORS);
		expect(downloadFrames.length).toBe(NUM_SECTORS);
		expect(transferFrames.length).toBe(NUM_SECTORS * BLOCKS_PER_SECTOR);
		expect(exitFrames.length).toBe(NUM_SECTORS);

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
		const protocol = new SubaruProtocol();
		const ROM_SIZE = 0x100000;
		const SECTOR_SIZE = 0x10000;
		const BLOCK_SIZE = 0x80;
		const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;

		// Create original ROM (all zeros) and modified ROM with only sector 5 changed
		const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
		const modifiedRom = new Uint8Array(ROM_SIZE).fill(0x00);
		modifiedRom[0x50000] = 0xff; // change one byte in sector 5

		const eraseFrames: Uint8Array[] = [];
		const downloadFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0xff) {
				eraseFrames.push(data);
				return new Uint8Array([0x00]);
			}
			if (data[0] === 0x34) {
				downloadFrames.push(data);
				return new Uint8Array([0x74]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76]);
			}
			if (data[0] === 0x37) return new Uint8Array([0x77]);
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sendFrame);

		await protocol.writeRom(connection, modifiedRom, vi.fn(), { originalRom });

		// Only sector 5 should be erased and downloaded
		expect(eraseFrames.length).toBe(1);
		expect(downloadFrames.length).toBe(1);
		// Only blocks in sector 5 should be transferred
		expect(transferFrames.length).toBe(BLOCKS_PER_SECTOR);

		// Erase frame should contain sector 5 address (0x050000)
		expect(eraseFrames[0]![0]).toBe(0xff); // SID_ERASE_MEMORY
		expect(eraseFrames[0]![2]).toBe(0x05); // addr byte 0 (0x050000 >> 16)
		expect(eraseFrames[0]![3]).toBe(0x00); // addr byte 1
		expect(eraseFrames[0]![4]).toBe(0x00); // addr byte 2
	});

	it("skips all sectors when originalRom is identical to modified ROM", async () => {
		const protocol = new SubaruProtocol();
		const ROM_SIZE = 0x100000;
		const identicalRom = new Uint8Array(ROM_SIZE).fill(0xaa);

		const eraseFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0xff) {
				eraseFrames.push(data);
				return new Uint8Array([0x00]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76]);
			}
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sendFrame);

		await protocol.writeRom(connection, identicalRom, vi.fn(), {
			originalRom: identicalRom,
		});

		// No sectors should be erased or written
		expect(eraseFrames.length).toBe(0);
		expect(transferFrames.length).toBe(0);
	});

	it("performs a dry run without writing", async () => {
		const protocol = new SubaruProtocol();
		const romToWrite = new Uint8Array(0x100000).fill(0xaa);

		let callIndex = 0;
		const sessionMock = async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sessionMock);
		const onProgress = vi.fn();

		await protocol.writeRom(connection, romToWrite, onProgress, {
			dryRun: true,
		});

		// Should only have 3 calls for session setup, no erase/write
		expect(callIndex).toBe(3);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "writing", percentComplete: 100 }),
		);
	});

	it("dryRun still works when originalRom is also provided", async () => {
		const protocol = new SubaruProtocol();
		const ROM_SIZE = 0x100000;
		const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
		const modifiedRom = new Uint8Array(ROM_SIZE).fill(0xff);

		let callIndex = 0;
		const sessionMock = async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sessionMock);
		const onProgress = vi.fn();

		await protocol.writeRom(connection, modifiedRom, onProgress, {
			dryRun: true,
			originalRom,
		});

		// dryRun short-circuits before diff — only 3 session setup calls
		expect(callIndex).toBe(3);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "writing", percentComplete: 100 }),
		);
	});

	it("throws if ROM size is incorrect", async () => {
		const protocol = new SubaruProtocol();
		const wrongSizeRom = new Uint8Array(0x80000); // 512 KB
		const connection = makeMockConnection("openport2");

		await expect(
			protocol.writeRom(connection, wrongSizeRom, vi.fn()),
		).rejects.toThrow(/invalid rom size/i);
	});
});

// ── SubaruProtocol onEvent callback tests ─────────────────────────────────────

describe("SubaruProtocol onEvent callbacks", () => {
	function makeReadRomMock(): (data: Uint8Array) => Promise<Uint8Array> {
		let callIndex = 0;
		return async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]); // session control
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]); // seed
			if (call === 2) return new Uint8Array([0x67, 0x02]); // key accepted
			// ROM block reads
			const resp = new Uint8Array(1 + 0x80);
			resp[0] = 0x63;
			return resp;
		};
	}

	function makeWriteRomMock(): (data: Uint8Array) => Promise<Uint8Array> {
		let callIndex = 0;
		return async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x85]); // session control
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]); // seed
			if (call === 2) return new Uint8Array([0x67, 0x02]); // key accepted
			if (data[0] === 0xff) return new Uint8Array([0x00]); // erase memory
			if (data[0] === 0x34) return new Uint8Array([0x74, 0x20]); // RequestDownload
			if (data[0] === 0x36) return new Uint8Array([0x76, data[1]!]); // TransferData
			if (data[0] === 0x37) return new Uint8Array([0x77]); // RequestTransferExit
			return new Uint8Array([]);
		};
	}

	// ── readRom onEvent ───────────────────────────────────────────────────────

	describe("readRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			// No onEvent callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED before the security handshake", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED after successful security handshake", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED before SECURITY_ACCESS_GRANTED", async () => {
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
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
			const protocol = new SubaruProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const events: { type: string; timestamp: number }[] = [];

			await protocol.readRom(connection, undefined, (event) => {
				events.push({ type: event.type, timestamp: event.timestamp });
			});

			for (const event of events) {
				expect(typeof event.timestamp).toBe("number");
				expect(event.timestamp).toBeGreaterThan(0);
			}
		});
	});

	// ── writeRom onEvent ──────────────────────────────────────────────────────

	describe("writeRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			// No onEvent callback — should not throw
			await expect(
				protocol.writeRom(connection, romToWrite, vi.fn()),
			).resolves.toBeUndefined();
		});

		it("emits SECURITY_ACCESS_REQUESTED before the security handshake", async () => {
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
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

		it("emits SECURITY_ACCESS_GRANTED after successful security handshake", async () => {
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
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
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
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
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
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

		it("emits SECTOR_ERASE_STARTED and SECTOR_ERASE_COMPLETE for each sector (16 sectors)", async () => {
			const protocol = new SubaruProtocol();
			const ROM_SIZE = 0x100000;
			const SECTOR_SIZE = 0x10000;
			const NUM_SECTORS = ROM_SIZE / SECTOR_SIZE;
			const romToWrite = new Uint8Array(ROM_SIZE).fill(0xaa);
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
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
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
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const progressMessages: string[] = [];

			await protocol.writeRom(connection, romToWrite, (p) => {
				if (p.message) progressMessages.push(p.message);
			});

			expect(progressMessages.length).toBeGreaterThan(0);
			expect(progressMessages[0]).toBeTruthy();
		});

		it("emits only security events during dryRun (no sector events)", async () => {
			const protocol = new SubaruProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);

			let callIndex = 0;
			const dryRunMock = async (_data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([0x50, 0x85]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
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
	});
});
