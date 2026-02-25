import type { DeviceConnection, DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import {
	parseNegativeResponse,
	UDS_NEGATIVE_RESPONSE,
	UDS_NRC,
	UDS_SERVICES,
	UDS_SESSION_TYPES,
	UdsProtocol,
} from "../src/index.js";

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
 * Build a sendFrame mock that simulates the full generic UDS handshake.
 *
 * Call sequence expected by readRom():
 *   1. Diagnostic session control [0x10, 0x03]  → [0x50, 0x03] (positive response)
 *   2. Security access seed request [0x27, 0x01] → [0x67, 0x01, 0xAB, 0xCD] (seed)
 *   3. Security access key send [0x27, 0x02, key0, key1] → [0x67, 0x02] (positive response)
 *   4..N. ROM block reads [0x23, 0x14, addr2, addr1, addr0, 0x80] → [0x63, ...128 bytes]
 *
 * The default computeKey() XORs each seed byte with 0xFF:
 *   seed 0xAB → key 0x54 (0xAB ^ 0xFF)
 *   seed 0xCD → key 0x32 (0xCD ^ 0xFF)
 */
function makeUdsMock(
	options: {
		romSize?: number;
		blockSize?: number;
		sessionType?: number;
		securityLevel?: number;
		seedBytes?: number[];
	} = {},
): (data: Uint8Array) => Promise<Uint8Array> {
	const ROM_SIZE = options.romSize ?? 0x100000;
	const BLOCK_SIZE = options.blockSize ?? 0x80;
	const SESSION_TYPE = options.sessionType ?? 0x03;
	const SECURITY_LEVEL = options.securityLevel ?? 0x01;
	const SEED_BYTES = options.seedBytes ?? [0xab, 0xcd];
	const totalBlocks = ROM_SIZE / BLOCK_SIZE;
	let callIndex = 0;

	return async (data: Uint8Array): Promise<Uint8Array> => {
		const call = callIndex++;

		if (call === 0) {
			// Diagnostic session control
			expect(data[0]).toBe(0x10);
			expect(data[1]).toBe(SESSION_TYPE);
			return new Uint8Array([0x50, SESSION_TYPE]);
		}
		if (call === 1) {
			// Security access seed request
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(SECURITY_LEVEL);
			return new Uint8Array([0x67, SECURITY_LEVEL, ...SEED_BYTES]);
		}
		if (call === 2) {
			// Security access key send
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(SECURITY_LEVEL + 1);
			// Default XOR key: each seed byte XOR 0xFF
			for (let i = 0; i < SEED_BYTES.length; i++) {
				expect(data[2 + i]).toBe((SEED_BYTES[i]! ^ 0xff) & 0xff);
			}
			return new Uint8Array([0x67, SECURITY_LEVEL + 1]);
		}
		// ROM block reads
		const blockIndex = call - 3;
		if (blockIndex < totalBlocks) {
			const response = new Uint8Array(1 + BLOCK_SIZE);
			response[0] = 0x63; // positive response SID for ReadMemoryByAddress
			response.fill(blockIndex & 0xff, 1); // fill data with block index
			return response;
		}
		throw new Error(`Unexpected sendFrame call #${call}`);
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UdsProtocol", () => {
	// ── canHandle ────────────────────────────────────────────────────────────

	describe("canHandle()", () => {
		it("returns true for any connection (generic fallback)", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns true for elm327 connections", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("elm327");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns true for empty transport name", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns true for unknown transport names", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("some-unknown-transport");
			expect(await protocol.canHandle(connection)).toBe(true);
		});
	});

	// ── Protocol name ────────────────────────────────────────────────────────

	describe("name", () => {
		it("has a human-readable name", () => {
			const protocol = new UdsProtocol();
			expect(protocol.name).toBe("Generic UDS (ISO 14229)");
		});
	});

	// ── UDS session + security access sequence ────────────────────────────────

	describe("readRom() — UDS handshake sequence", () => {
		it("sends diagnostic session control [0x10, 0x03] as the first frame", async () => {
			const protocol = new UdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			expect(Array.from(frames[0]!)).toEqual([0x10, 0x03]);
		});

		it("sends security access seed request [0x27, 0x01] as the second frame", async () => {
			const protocol = new UdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			expect(Array.from(frames[1]!)).toEqual([0x27, 0x01]);
		});

		it("sends security access key [0x27, 0x02, key...] as the third frame", async () => {
			const protocol = new UdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				// Seed: 0xAB 0xCD → XOR key: 0x54 0x32
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
			// Default XOR key for seed 0xAB 0xCD: 0xAB^0xFF=0x54, 0xCD^0xFF=0x32
			expect(frames[2]![2]).toBe(0x54);
			expect(frames[2]![3]).toBe(0x32);
		});

		it("sends ROM block read [0x23, 0x14, addr2, addr1, addr0, 0x80] for first block", async () => {
			const protocol = new UdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Frame 3 is the first ROM block read (addr = 0x000000)
			expect(Array.from(frames[3]!)).toEqual([
				0x23, 0x14, 0x00, 0x00, 0x00, 0x80,
			]);
		});

		it("sends correct address for second ROM block", async () => {
			const protocol = new UdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Frame 4 is the second ROM block read (addr = 0x000080)
			expect(Array.from(frames[4]!)).toEqual([
				0x23, 0x14, 0x00, 0x00, 0x80, 0x80,
			]);
		});

		it("computes key from seed using default XOR algorithm", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			// Should not throw — the mock verifies the key bytes
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});
	});

	// ── ROM read ─────────────────────────────────────────────────────────────

	describe("readRom() — ROM data", () => {
		it("returns a Uint8Array of exactly 1 MB (0x100000 bytes)", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			const rom = await protocol.readRom(connection);
			expect(rom).toBeInstanceOf(Uint8Array);
			expect(rom.length).toBe(0x100000);
		});

		it("assembles ROM blocks in correct order", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			const rom = await protocol.readRom(connection);

			// makeUdsMock fills each block with blockIndex & 0xFF
			// Block 0 → 0x00, block 1 → 0x01, block 2 → 0x02
			expect(rom[0]).toBe(0x00); // block 0, byte 0
			expect(rom[0x80]).toBe(0x01); // block 1, byte 0
			expect(rom[0x100]).toBe(0x02); // block 2, byte 0
		});

		it("skips the first response byte (positive response SID 0x63)", async () => {
			const protocol = new UdsProtocol();
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async () => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
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
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			const progressCalls: number[] = [];

			await protocol.readRom(connection, (p) => {
				progressCalls.push(p.percentComplete);
			});

			// 1 MB / 128 bytes = 8192 blocks → 8192 progress calls
			expect(progressCalls.length).toBe(8192);
		});

		it("reports phase as 'reading'", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			const phases = new Set<string>();

			await protocol.readRom(connection, (p) => {
				phases.add(p.phase);
			});

			expect(phases).toEqual(new Set(["reading"]));
		});

		it("reports totalBytes as 1 MB (0x100000)", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			const totalBytesValues = new Set<number>();

			await protocol.readRom(connection, (p) => {
				totalBytesValues.add(p.totalBytes);
			});

			expect(totalBytesValues).toEqual(new Set([0x100000]));
		});

		it("reports percentComplete from ~0 to 100", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
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
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			let prevBytes = 0;
			let monotonic = true;

			await protocol.readRom(connection, (p) => {
				if (p.bytesProcessed <= prevBytes) monotonic = false;
				prevBytes = p.bytesProcessed;
			});

			expect(monotonic).toBe(true);
		});

		it("does not throw if onProgress is not provided", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeUdsMock());
			// No onProgress callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});
	});

	// ── Subclass overrides ────────────────────────────────────────────────────

	describe("subclass overrides", () => {
		it("subclass can override computeKey() with custom algorithm", async () => {
			class CustomUdsProtocol extends UdsProtocol {
				override readonly name = "Custom UDS";
				protected override computeKey(seed: Uint8Array): Uint8Array {
					// Custom algorithm: XOR with 0xAA instead of 0xFF
					const key = new Uint8Array(seed.length);
					for (let i = 0; i < seed.length; i++) {
						key[i] = (seed[i]! ^ 0xaa) & 0xff;
					}
					return key;
				}
			}

			const protocol = new CustomUdsProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				// Seed: 0x12 0x34
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x12, 0x34]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Custom XOR key for seed 0x12 0x34: 0x12^0xAA=0xB8, 0x34^0xAA=0x9E
			expect(frames[2]![2]).toBe(0xb8);
			expect(frames[2]![3]).toBe(0x9e);
		});

		it("subclass can override ROM_START, ROM_SIZE, BLOCK_SIZE", async () => {
			class SmallRomProtocol extends UdsProtocol {
				override readonly name = "Small ROM UDS";
				protected override readonly ROM_START = 0x010000;
				protected override readonly ROM_SIZE = 0x1000; // 4 KB
				protected override readonly BLOCK_SIZE = 0x40; // 64 bytes
			}

			const protocol = new SmallRomProtocol();
			const frames: Uint8Array[] = [];
			let callIndex = 0;
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = callIndex++;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x40);
				resp[0] = 0x63;
				return resp;
			});

			const rom = await protocol.readRom(connection);

			// ROM should be 4 KB
			expect(rom.length).toBe(0x1000);

			// First block read should use ROM_START = 0x010000
			// Frame format: [0x23, 0x14, addr2, addr1, addr0, 0x40]
			expect(Array.from(frames[3]!)).toEqual([
				0x23, 0x14, 0x01, 0x00, 0x00, 0x40,
			]);
		});

		it("subclass can override SESSION_TYPE", async () => {
			class ProgrammingSessionProtocol extends UdsProtocol {
				override readonly name = "Programming Session UDS";
				protected override readonly SESSION_TYPE =
					UDS_SESSION_TYPES.PROGRAMMING; // 0x02
			}

			const protocol = new ProgrammingSessionProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x02]);
				if (call === 1) return new Uint8Array([0x67, 0x01, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// First frame should use SESSION_TYPE = 0x02 (programming)
			expect(Array.from(frames[0]!)).toEqual([0x10, 0x02]);
		});

		it("subclass can override SECURITY_ACCESS_LEVEL", async () => {
			class Level3SecurityProtocol extends UdsProtocol {
				override readonly name = "Level 3 Security UDS";
				protected override readonly SECURITY_ACCESS_LEVEL = 0x03;
			}

			const protocol = new Level3SecurityProtocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				if (call === 1) return new Uint8Array([0x67, 0x03, 0x00, 0x00]);
				if (call === 2) return new Uint8Array([0x67, 0x04]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection);

			// Security access seed request should use level 0x03
			expect(Array.from(frames[1]!)).toEqual([0x27, 0x03]);
			// Security access key send should use level + 1 = 0x04
			expect(frames[2]![0]).toBe(0x27);
			expect(frames[2]![1]).toBe(0x04);
		});
	});
});

// ── parseNegativeResponse tests ───────────────────────────────────────────────

describe("parseNegativeResponse", () => {
	it("returns message for GENERAL_REJECT (0x10)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x10,
			UDS_NRC.GENERAL_REJECT,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("General reject");
		expect(msg).toContain("0x10");
	});

	it("returns message for SERVICE_NOT_SUPPORTED (0x11)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x22,
			UDS_NRC.SERVICE_NOT_SUPPORTED,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Service not supported");
		expect(msg).toContain("0x11");
	});

	it("returns message for SECURITY_ACCESS_DENIED (0x33)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x27,
			UDS_NRC.SECURITY_ACCESS_DENIED,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Security access denied");
		expect(msg).toContain("0x33");
	});

	it("returns message for INVALID_KEY (0x35)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x27,
			UDS_NRC.INVALID_KEY,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Invalid key");
		expect(msg).toContain("0x35");
	});

	it("returns message for RESPONSE_PENDING (0x78)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x23,
			UDS_NRC.RESPONSE_PENDING,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Response pending");
		expect(msg).toContain("0x78");
	});

	it("returns message for CONDITIONS_NOT_CORRECT (0x22)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x10,
			UDS_NRC.CONDITIONS_NOT_CORRECT,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Conditions not correct");
		expect(msg).toContain("0x22");
	});

	it("returns message for REQUEST_OUT_OF_RANGE (0x31)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x23,
			UDS_NRC.REQUEST_OUT_OF_RANGE,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Request out of range");
		expect(msg).toContain("0x31");
	});

	it("returns message for GENERAL_PROGRAMMING_FAILURE (0x72)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x36,
			UDS_NRC.GENERAL_PROGRAMMING_FAILURE,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("General programming failure");
		expect(msg).toContain("0x72");
	});

	it("returns message for SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION (0x7F)", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			0x10,
			UDS_NRC.SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION,
		]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Service not supported in active session");
		expect(msg).toContain("0x7F");
	});

	it("includes the request SID in the message", () => {
		const response = new Uint8Array([
			UDS_NEGATIVE_RESPONSE,
			UDS_SERVICES.READ_MEMORY_BY_ADDRESS,
			UDS_NRC.SECURITY_ACCESS_DENIED,
		]);
		const msg = parseNegativeResponse(response);
		// 0x23 = READ_MEMORY_BY_ADDRESS
		expect(msg).toContain("0x23");
	});

	it("returns unknown NRC message for unrecognized NRC code", () => {
		const response = new Uint8Array([UDS_NEGATIVE_RESPONSE, 0x10, 0x99]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Unknown NRC");
		expect(msg).toContain("0x99");
	});

	it("returns error message for non-negative response", () => {
		const response = new Uint8Array([0x50, 0x03]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Invalid negative response");
	});

	it("returns error message for empty response", () => {
		const response = new Uint8Array([]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Invalid negative response");
	});

	it("returns error message for too-short negative response (only 2 bytes)", () => {
		const response = new Uint8Array([UDS_NEGATIVE_RESPONSE, 0x10]);
		const msg = parseNegativeResponse(response);
		expect(msg).toContain("Invalid negative response");
	});

	it("returns a string for all known NRC codes", () => {
		const nrcCodes = Object.values(UDS_NRC);
		for (const nrc of nrcCodes) {
			const response = new Uint8Array([UDS_NEGATIVE_RESPONSE, 0x10, nrc]);
			const msg = parseNegativeResponse(response);
			expect(typeof msg).toBe("string");
			expect(msg.length).toBeGreaterThan(0);
			// Should not contain "Unknown NRC" for known codes
			expect(msg).not.toContain("Unknown NRC");
		}
	});
});

// ── UDS constants tests ───────────────────────────────────────────────────────

describe("UDS_SERVICES", () => {
	it("has correct service IDs", () => {
		expect(UDS_SERVICES.DIAGNOSTIC_SESSION_CONTROL).toBe(0x10);
		expect(UDS_SERVICES.ECU_RESET).toBe(0x11);
		expect(UDS_SERVICES.SECURITY_ACCESS).toBe(0x27);
		expect(UDS_SERVICES.READ_DATA_BY_IDENTIFIER).toBe(0x22);
		expect(UDS_SERVICES.READ_MEMORY_BY_ADDRESS).toBe(0x23);
		expect(UDS_SERVICES.WRITE_DATA_BY_IDENTIFIER).toBe(0x2e);
		expect(UDS_SERVICES.WRITE_MEMORY_BY_ADDRESS).toBe(0x3d);
		expect(UDS_SERVICES.REQUEST_DOWNLOAD).toBe(0x34);
		expect(UDS_SERVICES.TRANSFER_DATA).toBe(0x36);
		expect(UDS_SERVICES.REQUEST_TRANSFER_EXIT).toBe(0x37);
		expect(UDS_SERVICES.TESTER_PRESENT).toBe(0x3e);
	});
});

describe("UDS_SESSION_TYPES", () => {
	it("has correct session type values", () => {
		expect(UDS_SESSION_TYPES.DEFAULT).toBe(0x01);
		expect(UDS_SESSION_TYPES.PROGRAMMING).toBe(0x02);
		expect(UDS_SESSION_TYPES.EXTENDED_DIAGNOSTIC).toBe(0x03);
	});
});

describe("UDS_NEGATIVE_RESPONSE", () => {
	it("is 0x7F", () => {
		expect(UDS_NEGATIVE_RESPONSE).toBe(0x7f);
	});
});

describe("UDS_NRC", () => {
	it("has correct NRC values", () => {
		expect(UDS_NRC.GENERAL_REJECT).toBe(0x10);
		expect(UDS_NRC.SERVICE_NOT_SUPPORTED).toBe(0x11);
		expect(UDS_NRC.SECURITY_ACCESS_DENIED).toBe(0x33);
		expect(UDS_NRC.INVALID_KEY).toBe(0x35);
		expect(UDS_NRC.RESPONSE_PENDING).toBe(0x78);
	});
});

// ── UdsProtocol.writeRom tests ────────────────────────────────────────────────

describe("UdsProtocol.writeRom()", () => {
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
		const protocol = new UdsProtocol();
		const ROM_SIZE = 0x100000;
		const SECTOR_SIZE = 0x10000;
		const BLOCK_SIZE = 0x80;
		const NUM_SECTORS = ROM_SIZE / SECTOR_SIZE;
		const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;
		const romToWrite = new Uint8Array(ROM_SIZE).fill(0xaa);

		const downloadFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];
		const exitFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0x34) {
				downloadFrames.push(data);
				return new Uint8Array([0x74, 0x20]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76, data[1]!]);
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

		// All 16 sectors should be downloaded, transferred, and exited
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

	it("only downloads and writes changed sectors when originalRom is provided", async () => {
		const protocol = new UdsProtocol();
		const ROM_SIZE = 0x100000;
		const SECTOR_SIZE = 0x10000;
		const BLOCK_SIZE = 0x80;
		const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;

		// Create original ROM (all zeros) and modified ROM with only sector 3 changed
		const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
		const modifiedRom = new Uint8Array(ROM_SIZE).fill(0x00);
		modifiedRom[0x30000] = 0xff; // change one byte in sector 3

		const downloadFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];
		const exitFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0x34) {
				downloadFrames.push(data);
				return new Uint8Array([0x74, 0x20]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76, data[1]!]);
			}
			if (data[0] === 0x37) {
				exitFrames.push(data);
				return new Uint8Array([0x77]);
			}
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sendFrame);

		await protocol.writeRom(connection, modifiedRom, vi.fn(), { originalRom });

		// Only sector 3 should be downloaded
		expect(downloadFrames.length).toBe(1);
		// Only blocks in sector 3 should be transferred
		expect(transferFrames.length).toBe(BLOCKS_PER_SECTOR);
		// Only one exit
		expect(exitFrames.length).toBe(1);

		// Download frame should contain sector 3 address (0x030000)
		expect(downloadFrames[0]![0]).toBe(0x34); // REQUEST_DOWNLOAD
		expect(downloadFrames[0]![3]).toBe(0x03); // addr byte 0 (0x030000 >> 16)
		expect(downloadFrames[0]![4]).toBe(0x00); // addr byte 1
		expect(downloadFrames[0]![5]).toBe(0x00); // addr byte 2
	});

	it("skips all sectors when originalRom is identical to modified ROM", async () => {
		const protocol = new UdsProtocol();
		const ROM_SIZE = 0x100000;
		const identicalRom = new Uint8Array(ROM_SIZE).fill(0xaa);

		const downloadFrames: Uint8Array[] = [];
		const transferFrames: Uint8Array[] = [];

		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0x34) {
				downloadFrames.push(data);
				return new Uint8Array([0x74, 0x20]);
			}
			if (data[0] === 0x36) {
				transferFrames.push(data);
				return new Uint8Array([0x76, data[1]!]);
			}
			if (data[0] === 0x37) return new Uint8Array([0x77]);
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sendFrame);

		await protocol.writeRom(connection, identicalRom, vi.fn(), {
			originalRom: identicalRom,
		});

		// No sectors should be downloaded or written
		expect(downloadFrames.length).toBe(0);
		expect(transferFrames.length).toBe(0);
	});

	it("performs a dry run without writing", async () => {
		const protocol = new UdsProtocol();
		const romToWrite = new Uint8Array(0x100000).fill(0xaa);

		let callIndex = 0;
		const sessionMock = async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			return new Uint8Array([]);
		};

		const connection = makeMockConnection("openport2", sessionMock);
		const onProgress = vi.fn();

		await protocol.writeRom(connection, romToWrite, onProgress, {
			dryRun: true,
		});

		// Should only have 3 calls for session setup, no download/transfer
		expect(callIndex).toBe(3);
		expect(onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "writing", percentComplete: 100 }),
		);
	});

	it("dryRun still works when originalRom is also provided", async () => {
		const protocol = new UdsProtocol();
		const ROM_SIZE = 0x100000;
		const originalRom = new Uint8Array(ROM_SIZE).fill(0x00);
		const modifiedRom = new Uint8Array(ROM_SIZE).fill(0xff);

		let callIndex = 0;
		const sessionMock = async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
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
		const protocol = new UdsProtocol();
		const wrongSizeRom = new Uint8Array(0x80000); // 512 KB
		const connection = makeMockConnection("openport2");

		await expect(
			protocol.writeRom(connection, wrongSizeRom, vi.fn()),
		).rejects.toThrow(/invalid rom size/i);
	});

	it("sends correct block sequence counter in TransferData (resets per sector)", async () => {
		const protocol = new UdsProtocol();
		const ROM_SIZE = 0x100000;
		const SECTOR_SIZE = 0x10000;
		const BLOCK_SIZE = 0x80;
		const BLOCKS_PER_SECTOR = SECTOR_SIZE / BLOCK_SIZE;
		const romToWrite = new Uint8Array(ROM_SIZE).fill(0x55);
		const blockCounters: number[] = [];
		// Override to capture block counters
		let callIndex = 0;
		const sendFrame = async (data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]);
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
			if (call === 2) return new Uint8Array([0x67, 0x02]);
			if (data[0] === 0x34) return new Uint8Array([0x74, 0x20]);
			if (data[0] === 0x36) {
				blockCounters.push(data[1]!);
				return new Uint8Array([0x76, data[1]!]);
			}
			if (data[0] === 0x37) return new Uint8Array([0x77]);
			return new Uint8Array([]);
		};

		const conn = makeMockConnection("openport2", sendFrame);
		await protocol.writeRom(conn, romToWrite, vi.fn());

		// Block sequence counter resets to 1 for each sector
		// First block of first sector: counter = 1
		expect(blockCounters[0]).toBe(1);
		// Last block of first sector: counter = BLOCKS_PER_SECTOR
		expect(blockCounters[BLOCKS_PER_SECTOR - 1]).toBe(BLOCKS_PER_SECTOR & 0xff);
		// First block of second sector: counter resets to 1
		expect(blockCounters[BLOCKS_PER_SECTOR]).toBe(1);
	});
});

// ── UdsProtocol onEvent callback tests ───────────────────────────────────────

describe("UdsProtocol onEvent callbacks", () => {
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

	function makeReadRomMock(): (data: Uint8Array) => Promise<Uint8Array> {
		let callIndex = 0;
		return async (_data: Uint8Array): Promise<Uint8Array> => {
			const call = callIndex++;
			if (call === 0) return new Uint8Array([0x50, 0x03]); // session control
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
			if (call === 0) return new Uint8Array([0x50, 0x03]); // session control
			if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]); // seed
			if (call === 2) return new Uint8Array([0x67, 0x02]); // key accepted
			if (data[0] === 0x34) return new Uint8Array([0x74, 0x20]); // RequestDownload
			if (data[0] === 0x36) return new Uint8Array([0x76, data[1]!]); // TransferData
			if (data[0] === 0x37) return new Uint8Array([0x77]); // RequestTransferExit
			return new Uint8Array([]);
		};
	}

	// ── readRom onEvent ───────────────────────────────────────────────────────

	describe("readRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			// No onEvent callback — should not throw
			await expect(protocol.readRom(connection)).resolves.toBeInstanceOf(
				Uint8Array,
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED before the security handshake", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED after successful security handshake", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});

		it("emits BOOT_MODE_ENTERED after diagnostic session is established", async () => {
			const protocol = new UdsProtocol();
			const connection = makeMockConnection("openport2", makeReadRomMock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, undefined, onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "BOOT_MODE_ENTERED" }),
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED before SECURITY_ACCESS_GRANTED", async () => {
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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

		it("onProgress includes a non-empty message string during erasing phase in writeRom", async () => {
			const protocol = new UdsProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			const progressMessages: string[] = [];

			await protocol.writeRom(connection, romToWrite, (p) => {
				if (p.message) progressMessages.push(p.message);
			});

			expect(progressMessages.length).toBeGreaterThan(0);
			expect(progressMessages[0]).toBeTruthy();
		});
	});

	// ── writeRom onEvent ──────────────────────────────────────────────────────

	describe("writeRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new UdsProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);
			const connection = makeMockConnection("openport2", makeWriteRomMock());
			// No onEvent callback — should not throw
			await expect(
				protocol.writeRom(connection, romToWrite, vi.fn()),
			).resolves.toBeUndefined();
		});

		it("emits SECURITY_ACCESS_REQUESTED before the security handshake", async () => {
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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
			const protocol = new UdsProtocol();
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

		it("emits only security events during dryRun (no sector events)", async () => {
			const protocol = new UdsProtocol();
			const romToWrite = new Uint8Array(0x100000).fill(0xaa);

			let callIndex = 0;
			const dryRunMock = async (_data: Uint8Array): Promise<Uint8Array> => {
				const call = callIndex++;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
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
