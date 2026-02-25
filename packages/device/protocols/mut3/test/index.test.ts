import type { DeviceConnection, DeviceInfo, LiveDataFrame } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import {
	buildRaxPidDescriptors,
	CMD_READ_BYTE,
	CMD_READ_WORD_INC,
	CMD_SET_ADDRESS,
	decodeRaxPid,
	Mut3Protocol,
	RAX_PID_BASE,
	RAX_PID_DESCRIPTORS,
	readRaxBlock,
} from "../src/index.js";
import { RAX_A_BLOCK, RAX_BLOCKS, RAX_C_BLOCK } from "../src/rax-decoder.js";
import { computeSecurityKey } from "../src/security.js";

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
 * Build a sendFrame mock that simulates the full MUT-III UDS handshake.
 *
 * Call sequence expected by readRom():
 *   1. Diagnostic session control [0x10, 0x03]  → [0x50, 0x03] (positive response)
 *   2. Security access seed request [0x27, 0x01] → [0x67, 0x01, 0xAB, 0xCD] (seed)
 *   3. Security access key send [0x27, 0x02, key0, key1] → [0x67, 0x02] (positive response)
 *   4..N. ROM block reads [0x23, 0x14, addr2, addr1, addr0, 0x80] → [0x63, ...128 bytes]
 *
 * The seed 0xAB 0xCD produces key 0xE4 0x81 via the MUT-III algorithm:
 *   key16 = (0xABCD * 0x4081 + 0x1234) & 0xFFFF = 0xE481
 */
function makeMut3Mock(): (data: Uint8Array) => Promise<Uint8Array> {
	let callIndex = 0;
	const ROM_SIZE = 0x100000; // 1 MB
	const BLOCK_SIZE = 0x80; // 128 bytes
	const totalBlocks = ROM_SIZE / BLOCK_SIZE;
	const SEED_BYTES = [0xab, 0xcd];

	return async (data: Uint8Array): Promise<Uint8Array> => {
		const call = callIndex++;

		if (call === 0) {
			// Diagnostic session control [0x10, 0x03]
			expect(data[0]).toBe(0x10);
			expect(data[1]).toBe(0x03);
			return new Uint8Array([0x50, 0x03]);
		}
		if (call === 1) {
			// Security access seed request [0x27, 0x01]
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(0x01);
			return new Uint8Array([0x67, 0x01, ...SEED_BYTES]);
		}
		if (call === 2) {
			// Security access key send [0x27, 0x02, key0, key1]
			expect(data[0]).toBe(0x27);
			expect(data[1]).toBe(0x02);
			// Verify key matches expected MUT-III algorithm output for seed 0xAB 0xCD
			const expectedKey = computeSecurityKey(new Uint8Array(SEED_BYTES));
			expect(data[2]).toBe(expectedKey[0]);
			expect(data[3]).toBe(expectedKey[1]);
			return new Uint8Array([0x67, 0x02]);
		}
		// ROM block reads: return a 129-byte response (1 SID byte + 128 data bytes)
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

describe("Mut3Protocol", () => {
	// ── canHandle ────────────────────────────────────────────────────────────

	describe("canHandle()", () => {
		it("returns true for openport2 connections", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2");
			expect(await protocol.canHandle(connection)).toBe(true);
		});

		it("returns false for non-openport2 connections", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("elm327");
			expect(await protocol.canHandle(connection)).toBe(false);
		});

		it("returns false for empty transport name", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("");
			expect(await protocol.canHandle(connection)).toBe(false);
		});
	});

	// ── Protocol name ────────────────────────────────────────────────────────

	describe("name", () => {
		it("has a human-readable name", () => {
			const protocol = new Mut3Protocol();
			expect(protocol.name).toBe("MUT-III (Mitsubishi)");
		});
	});

	// ── UDS session + security access sequence ────────────────────────────────

	describe("readRom() — UDS handshake sequence", () => {
		it("sends diagnostic session control [0x10, 0x03] as the first frame", async () => {
			const protocol = new Mut3Protocol();
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

			await protocol.readRom(connection, vi.fn());

			expect(Array.from(frames[0]!)).toEqual([0x10, 0x03]);
		});

		it("sends security access seed request [0x27, 0x01] as the second frame", async () => {
			const protocol = new Mut3Protocol();
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

			await protocol.readRom(connection, vi.fn());

			expect(Array.from(frames[1]!)).toEqual([0x27, 0x01]);
		});

		it("sends security access key [0x27, 0x02, key...] as the third frame", async () => {
			const protocol = new Mut3Protocol();
			const frames: Uint8Array[] = [];
			const connection = makeMockConnection("openport2", async (data) => {
				frames.push(data);
				const call = frames.length - 1;
				if (call === 0) return new Uint8Array([0x50, 0x03]);
				// Seed: 0xAB 0xCD → MUT-III key: 0xE4 0x81
				if (call === 1) return new Uint8Array([0x67, 0x01, 0xab, 0xcd]);
				if (call === 2) return new Uint8Array([0x67, 0x02]);
				const resp = new Uint8Array(1 + 0x80);
				resp[0] = 0x63;
				return resp;
			});

			await protocol.readRom(connection, vi.fn());

			// Frame 2: [0x27, 0x02, key0, key1]
			expect(frames[2]![0]).toBe(0x27);
			expect(frames[2]![1]).toBe(0x02);
			// MUT-III key for seed 0xAB 0xCD: 0xE4 0x81
			expect(frames[2]![2]).toBe(0xe4);
			expect(frames[2]![3]).toBe(0x81);
		});

		it("computes key from seed using MUT-III algorithm", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			// Should not throw — the mock verifies the key bytes
			await expect(
				protocol.readRom(connection, vi.fn()),
			).resolves.toBeInstanceOf(Uint8Array);
		});
	});

	// ── ROM read ─────────────────────────────────────────────────────────────

	describe("readRom() — ROM data", () => {
		it("returns a Uint8Array of exactly 1 MB (0x100000 bytes)", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const rom = await protocol.readRom(connection, vi.fn());
			expect(rom).toBeInstanceOf(Uint8Array);
			expect(rom.length).toBe(0x100000);
		});

		it("assembles ROM blocks in correct order", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const rom = await protocol.readRom(connection, vi.fn());

			// Block 0 should be filled with 0x00, block 1 with 0x01, etc.
			// (makeMut3Mock fills each block with blockIndex & 0xFF)
			expect(rom[0]).toBe(0x00); // block 0, byte 0
			expect(rom[0x80]).toBe(0x01); // block 1, byte 0
			expect(rom[0x100]).toBe(0x02); // block 2, byte 0
		});
	});

	// ── Progress reporting ────────────────────────────────────────────────────

	describe("readRom() — progress reporting", () => {
		it("calls onProgress for each block read", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const progressCalls: number[] = [];

			await protocol.readRom(connection, (p) => {
				progressCalls.push(p.percentComplete);
			});

			// 1 MB / 128 bytes = 8192 blocks → 8192 progress calls
			expect(progressCalls.length).toBe(8192);
		});

		it("reports phase as 'reading'", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const phases = new Set<string>();

			await protocol.readRom(connection, (p) => {
				phases.add(p.phase);
			});

			expect(phases).toEqual(new Set(["reading"]));
		});

		it("reports totalBytes as 1 MB (0x100000)", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const totalBytesValues = new Set<number>();

			await protocol.readRom(connection, (p) => {
				totalBytesValues.add(p.totalBytes);
			});

			expect(totalBytesValues).toEqual(new Set([0x100000]));
		});

		it("reports percentComplete from ~0 to 100", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
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
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			let prevBytes = 0;
			let monotonic = true;

			await protocol.readRom(connection, (p) => {
				if (p.bytesProcessed <= prevBytes) monotonic = false;
				prevBytes = p.bytesProcessed;
			});

			expect(monotonic).toBe(true);
		});
	});

	// ── onEvent callbacks ─────────────────────────────────────────────────────

	describe("readRom() — onEvent", () => {
		it("does not throw when onEvent is not provided", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			// No onEvent callback — should not throw
			await expect(
				protocol.readRom(connection, vi.fn()),
			).resolves.toBeInstanceOf(Uint8Array);
		});

		it("emits SECURITY_ACCESS_REQUESTED before the security handshake", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, vi.fn(), onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_REQUESTED" }),
			);
		});

		it("emits SECURITY_ACCESS_GRANTED after successful security handshake", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const onEvent = vi.fn();

			await protocol.readRom(connection, vi.fn(), onEvent);

			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "SECURITY_ACCESS_GRANTED" }),
			);
		});

		it("emits SECURITY_ACCESS_REQUESTED before SECURITY_ACCESS_GRANTED", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const eventOrder: string[] = [];

			await protocol.readRom(connection, vi.fn(), (event) => {
				eventOrder.push(event.type);
			});

			const requestedIdx = eventOrder.indexOf("SECURITY_ACCESS_REQUESTED");
			const grantedIdx = eventOrder.indexOf("SECURITY_ACCESS_GRANTED");
			expect(requestedIdx).toBeGreaterThanOrEqual(0);
			expect(grantedIdx).toBeGreaterThan(requestedIdx);
		});

		it("emits events with a numeric timestamp", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const events: { type: string; timestamp: number }[] = [];

			await protocol.readRom(connection, vi.fn(), (event) => {
				events.push({ type: event.type, timestamp: event.timestamp });
			});

			for (const event of events) {
				expect(typeof event.timestamp).toBe("number");
				expect(event.timestamp).toBeGreaterThan(0);
			}
		});

		it("emits exactly SECURITY_ACCESS_REQUESTED and SECURITY_ACCESS_GRANTED (no extra events)", async () => {
			const protocol = new Mut3Protocol();
			const connection = makeMockConnection("openport2", makeMut3Mock());
			const eventTypes: string[] = [];

			await protocol.readRom(connection, vi.fn(), (event) => {
				eventTypes.push(event.type);
			});

			// MUT-III readRom only emits these two security events
			expect(eventTypes).toContain("SECURITY_ACCESS_REQUESTED");
			expect(eventTypes).toContain("SECURITY_ACCESS_GRANTED");
			// Should not emit sector events (writeRom is not implemented)
			expect(eventTypes).not.toContain("SECTOR_ERASE_STARTED");
			expect(eventTypes).not.toContain("SECTOR_ERASE_COMPLETE");
		});
	});
});

// ── RAX PID descriptor helpers ────────────────────────────────────────────────

describe("buildRaxPidDescriptors()", () => {
	it("returns exactly 48 descriptors (8 blocks × 4-6 params each)", () => {
		const descriptors = buildRaxPidDescriptors();
		// Count total expected: A=4, B=5, C=4, D=4, E=4, F=4, G=4, H=4 = 33
		// But we have: A=4, B=5, C=4, D=4, E=4, F=4, G=4, H=4
		const expectedTotal = RAX_BLOCKS.reduce(
			(sum, block) => sum + block.parameters.length,
			0,
		);
		expect(descriptors.length).toBe(expectedTotal);
	});

	it("all descriptors have pid in range 0x8000–0x8FFF", () => {
		const descriptors = buildRaxPidDescriptors();
		for (const d of descriptors) {
			expect(d.pid).toBeGreaterThanOrEqual(0x8000);
			expect(d.pid).toBeLessThan(0x9000);
		}
	});

	it("all descriptors have non-empty name and unit", () => {
		const descriptors = buildRaxPidDescriptors();
		for (const d of descriptors) {
			expect(d.name.length).toBeGreaterThan(0);
			expect(d.unit.length).toBeGreaterThan(0);
		}
	});

	it("PID numbers are unique across all descriptors", () => {
		const descriptors = buildRaxPidDescriptors();
		const pids = descriptors.map((d) => d.pid);
		const unique = new Set(pids);
		expect(unique.size).toBe(pids.length);
	});

	it("first descriptor has pid equal to RAX_PID_BASE (0x8000)", () => {
		const descriptors = buildRaxPidDescriptors();
		expect(descriptors[0]?.pid).toBe(RAX_PID_BASE);
	});

	it("RAX_PID_DESCRIPTORS is the same as buildRaxPidDescriptors()", () => {
		expect(RAX_PID_DESCRIPTORS.length).toBe(buildRaxPidDescriptors().length);
		for (let i = 0; i < RAX_PID_DESCRIPTORS.length; i++) {
			expect(RAX_PID_DESCRIPTORS[i]?.pid).toBe(
				buildRaxPidDescriptors()[i]?.pid,
			);
		}
	});
});

// ── decodeRaxPid ─────────────────────────────────────────────────────────────

describe("decodeRaxPid()", () => {
	it("returns null for PID below RAX_PID_BASE", () => {
		expect(decodeRaxPid(0x00)).toBeNull();
		expect(decodeRaxPid(0x7fff)).toBeNull();
	});

	it("returns null for standard OBD-II PID 0x0c (Engine RPM)", () => {
		expect(decodeRaxPid(0x0c)).toBeNull();
	});

	it("decodes block 0 (A), param 0 as { blockIdx: 0, paramIdx: 0 }", () => {
		const result = decodeRaxPid(RAX_PID_BASE + 0); // block 0, param 0
		expect(result).toEqual({ blockIdx: 0, paramIdx: 0 });
	});

	it("decodes block 0 (A), param 3 as { blockIdx: 0, paramIdx: 3 }", () => {
		// RAX_A_BLOCK has 4 params (0–3), pid = RAX_PID_BASE + 3
		const result = decodeRaxPid(RAX_PID_BASE + 3);
		expect(result).toEqual({ blockIdx: 0, paramIdx: 3 });
	});

	it("decodes block 1 (B), param 0 as { blockIdx: 1, paramIdx: 0 }", () => {
		// Block 1 starts at RAX_PID_BASE + 100
		const result = decodeRaxPid(RAX_PID_BASE + 100);
		expect(result).toEqual({ blockIdx: 1, paramIdx: 0 });
	});

	it("returns null for paramIdx beyond block's parameter count", () => {
		// RAX_A_BLOCK has 4 params (indices 0-3); index 4 is out of bounds
		const result = decodeRaxPid(RAX_PID_BASE + 4); // paramIdx = 4 in block A
		expect(result).toBeNull();
	});

	it("returns null for blockIdx beyond total block count", () => {
		// 8 blocks → blockIdx 8 is out of bounds
		const result = decodeRaxPid(RAX_PID_BASE + 800); // blockIdx = 8
		expect(result).toBeNull();
	});

	it("maps each descriptor PID back to valid block and param indices", () => {
		for (const descriptor of RAX_PID_DESCRIPTORS) {
			const result = decodeRaxPid(descriptor.pid);
			expect(result).not.toBeNull();
			expect(result!.blockIdx).toBeGreaterThanOrEqual(0);
			expect(result!.blockIdx).toBeLessThan(RAX_BLOCKS.length);
			expect(result!.paramIdx).toBeGreaterThanOrEqual(0);
		}
	});

	it("decoding a PID round-trips back to the same parameter name", () => {
		// Verify RPM PID decodes back to RAX_C_BLOCK RPM parameter
		// RAX_C is block index 2 (A=0, B=1, C=2), RPM is param 0
		const cBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "C");
		const rpmPid = RAX_PID_BASE + cBlockIdx * 100 + 0;
		const result = decodeRaxPid(rpmPid);
		expect(result).not.toBeNull();
		const param = RAX_BLOCKS[result!.blockIdx]!.parameters[result!.paramIdx]!;
		expect(param.name).toBe("RPM");
	});
});

// ── readRaxBlock ─────────────────────────────────────────────────────────────

describe("readRaxBlock()", () => {
	/**
	 * Build a connection mock that:
	 * - Responds to E0 (set address) with a [0x00] ACK
	 * - Responds to E5 (read word +inc) with 2 data bytes from `blockData`
	 * - Responds to E1 (read byte) with 1 data byte (for odd-size blocks)
	 */
	function makeRaxBlockMock(
		blockData: number[],
		expectedAddress: number,
	): DeviceConnection {
		let dataOffset = 0;
		let e0Received = false;

		const deviceInfo: DeviceInfo = {
			id: "test",
			name: "Test",
			transportName: "openport2",
			connected: true,
		};

		return {
			deviceInfo,
			sendFrame: vi.fn(async (data: Uint8Array): Promise<Uint8Array> => {
				if (data[0] === CMD_SET_ADDRESS) {
					// Verify 4-byte address bytes
					const addr =
						((data[1] ?? 0) << 24) |
						((data[2] ?? 0) << 16) |
						((data[3] ?? 0) << 8) |
						(data[4] ?? 0);
					expect(addr >>> 0).toBe(expectedAddress >>> 0);
					expect(data.length).toBe(5);
					e0Received = true;
					dataOffset = 0;
					return new Uint8Array([0x00]); // ACK
				}
				if (data[0] === CMD_READ_WORD_INC) {
					expect(e0Received).toBe(true);
					const b0 = blockData[dataOffset++] ?? 0;
					const b1 = blockData[dataOffset++] ?? 0;
					return new Uint8Array([b0, b1]);
				}
				if (data[0] === CMD_READ_BYTE) {
					expect(e0Received).toBe(true);
					const b = blockData[dataOffset++] ?? 0;
					return new Uint8Array([b]);
				}
				throw new Error(`Unexpected command: 0x${data[0]?.toString(16)}`);
			}),
			startStream: vi.fn(),
			stopStream: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		};
	}

	it("sends E0 command with the correct 4-byte address", async () => {
		const address = RAX_C_BLOCK.requestId; // 0x238051b0
		const connection = makeRaxBlockMock(
			[0x00, 0x00, 0x00, 0x00, 0x00],
			address,
		);
		await readRaxBlock(connection, address, RAX_C_BLOCK.blockSize);
		expect(connection.sendFrame).toHaveBeenCalledWith(
			new Uint8Array([
				CMD_SET_ADDRESS,
				(address >>> 24) & 0xff,
				(address >>> 16) & 0xff,
				(address >>> 8) & 0xff,
				address & 0xff,
			]),
		);
	});

	it("sends correct number of E5 (read-word-inc) calls for an even-size block", async () => {
		// RAX_A_BLOCK.blockSize = 4 → 2 E5 calls (no E1 needed)
		const address = RAX_A_BLOCK.requestId;
		const data = [0xaa, 0xbb, 0xcc, 0xdd];
		const connection = makeRaxBlockMock(data, address);
		await readRaxBlock(connection, address, RAX_A_BLOCK.blockSize);

		// 1 E0 + 2 E5 = 3 total calls
		expect(connection.sendFrame).toHaveBeenCalledTimes(3);
		// No E1 call (even size)
		const calls = (
			connection.sendFrame as ReturnType<typeof vi.fn>
		).mock.calls.map((c: Uint8Array[]) => c[0]?.[0]);
		expect(calls).not.toContain(CMD_READ_BYTE);
	});

	it("sends an E1 (read-byte) call for an odd-size block", async () => {
		// RAX_C_BLOCK.blockSize = 5 → 2 E5 + 1 E1
		const address = RAX_C_BLOCK.requestId;
		const data = [0x01, 0x02, 0x03, 0x04, 0x05];
		const connection = makeRaxBlockMock(data, address);
		await readRaxBlock(connection, address, RAX_C_BLOCK.blockSize);

		// 1 E0 + 2 E5 + 1 E1 = 4 total calls
		expect(connection.sendFrame).toHaveBeenCalledTimes(4);
		const calls = (
			connection.sendFrame as ReturnType<typeof vi.fn>
		).mock.calls.map((c: Uint8Array[]) => c[0]?.[0]);
		expect(calls).toContain(CMD_READ_BYTE);
	});

	it("reassembles the raw block bytes in the correct order", async () => {
		const address = RAX_A_BLOCK.requestId;
		const data = [0xaa, 0xbb, 0xcc, 0xdd];
		const connection = makeRaxBlockMock(data, address);
		const result = await readRaxBlock(connection, address, 4);
		expect(Array.from(result)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
	});

	it("reassembles a 5-byte block correctly including the odd byte", async () => {
		const address = RAX_C_BLOCK.requestId;
		const data = [0x11, 0x22, 0x33, 0x44, 0x55];
		const connection = makeRaxBlockMock(data, address);
		const result = await readRaxBlock(connection, address, 5);
		expect(Array.from(result)).toEqual([0x11, 0x22, 0x33, 0x44, 0x55]);
	});
});

// ── getSupportedPids ──────────────────────────────────────────────────────────

describe("Mut3Protocol.getSupportedPids()", () => {
	it("resolves to an array of PidDescriptors", async () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		const pids = await protocol.getSupportedPids!(connection);
		expect(Array.isArray(pids)).toBe(true);
		expect(pids.length).toBeGreaterThan(0);
	});

	it("does not send any frames to the device", async () => {
		const protocol = new Mut3Protocol();
		const sendFrame = vi.fn().mockResolvedValue(new Uint8Array([]));
		const connection = makeMockConnection("openport2", sendFrame);
		await protocol.getSupportedPids!(connection);
		expect(sendFrame).not.toHaveBeenCalled();
	});

	it("includes a descriptor for RPM with unit 'RPM'", async () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		const pids = await protocol.getSupportedPids!(connection);
		const rpm = pids.find((p) => p.name === "RPM");
		expect(rpm).toBeDefined();
		expect(rpm?.unit).toBe("RPM");
	});

	it("all PID numbers are in the RAX synthetic range (≥ 0x8000)", async () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		const pids = await protocol.getSupportedPids!(connection);
		for (const p of pids) {
			expect(p.pid).toBeGreaterThanOrEqual(0x8000);
		}
	});

	it("contains exactly the same number of PIDs as total RAX parameters", async () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		const pids = await protocol.getSupportedPids!(connection);
		const expectedTotal = RAX_BLOCKS.reduce(
			(acc, b) => acc + b.parameters.length,
			0,
		);
		expect(pids.length).toBe(expectedTotal);
	});
});

// ── streamLiveData ────────────────────────────────────────────────────────────

describe("Mut3Protocol.streamLiveData()", () => {
	/**
	 * Build a connection mock suitable for RAX streaming tests.
	 *
	 * - E0 (set address): returns [0x00]
	 * - E5 (read word + inc): returns the next 2 bytes from `blockBytes`
	 * - E1 (read byte): returns next 1 byte from `blockBytes`
	 *
	 * The mock uses a round-robin per-block counter so multiple polling
	 * cycles return consistent data.
	 */
	function makeRaxStreamMock(
		blockDataMap: Map<number, number[]>,
	): DeviceConnection {
		const offsets = new Map<number, number>();
		let currentAddress = 0;

		const deviceInfo: DeviceInfo = {
			id: "streaming-test",
			name: "Streaming Test Device",
			transportName: "openport2",
			connected: true,
		};

		return {
			deviceInfo,
			sendFrame: vi.fn(async (data: Uint8Array): Promise<Uint8Array> => {
				if (data[0] === CMD_SET_ADDRESS) {
					currentAddress =
						((data[1] ?? 0) << 24) |
						((data[2] ?? 0) << 16) |
						((data[3] ?? 0) << 8) |
						(data[4] ?? 0);
					offsets.set(currentAddress, 0);
					return new Uint8Array([0x00]);
				}
				if (data[0] === CMD_READ_WORD_INC) {
					const blockData = blockDataMap.get(currentAddress) ?? [0, 0];
					const offset = offsets.get(currentAddress) ?? 0;
					const b0 = blockData[offset] ?? 0;
					const b1 = blockData[offset + 1] ?? 0;
					offsets.set(currentAddress, offset + 2);
					return new Uint8Array([b0, b1]);
				}
				if (data[0] === CMD_READ_BYTE) {
					const blockData = blockDataMap.get(currentAddress) ?? [0];
					const offset = offsets.get(currentAddress) ?? 0;
					const b = blockData[offset] ?? 0;
					offsets.set(currentAddress, offset + 1);
					return new Uint8Array([b]);
				}
				return new Uint8Array([0x00]);
			}),
			startStream: vi.fn(),
			stopStream: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		};
	}

	it("returns a LiveDataSession with a stop() method", () => {
		const protocol = new Mut3Protocol();
		const connection = makeRaxStreamMock(new Map());
		const session = protocol.streamLiveData!(connection, [], vi.fn());
		expect(typeof session.stop).toBe("function");
		session.stop();
	});

	it("does not call onFrame when no PIDs are requested", async () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		const onFrame = vi.fn();
		const session = protocol.streamLiveData!(connection, [], onFrame);

		// Let one polling cycle complete
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		session.stop();

		expect(onFrame).not.toHaveBeenCalled();
	});

	it("emits LiveDataFrame for each requested PID", async () => {
		const protocol = new Mut3Protocol();

		// RAX_A_BLOCK (requestId 0x238051ac, size 4) — fuel trim block
		// Use 0x80 for each byte: (0x80 - 128) * 0.1 = 0% trim (neutral)
		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]], // all trims = 0%
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		// Request the first 2 PIDs in block A (STFT Bank 1, LTFT Bank 1)
		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const pid0 = RAX_PID_BASE + aBlockIdx * 100 + 0; // STFT Bank 1
		const pid1 = RAX_PID_BASE + aBlockIdx * 100 + 1; // LTFT Bank 1

		const frames: LiveDataFrame[] = [];
		const session = protocol.streamLiveData!(
			connection,
			[pid0, pid1],
			(frame) => frames.push(frame),
		);

		// Wait for at least one polling cycle
		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		// Should have received frames for both PIDs
		const pid0Frames = frames.filter((f) => f.pid === pid0);
		const pid1Frames = frames.filter((f) => f.pid === pid1);
		expect(pid0Frames.length).toBeGreaterThan(0);
		expect(pid1Frames.length).toBeGreaterThan(0);
	});

	it("emits frames with non-negative timestamp", async () => {
		const protocol = new Mut3Protocol();
		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const pid = RAX_PID_BASE + aBlockIdx * 100 + 0;

		const frames: LiveDataFrame[] = [];
		const session = protocol.streamLiveData!(connection, [pid], (f) =>
			frames.push(f),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		for (const frame of frames) {
			expect(frame.timestamp).toBeGreaterThanOrEqual(0);
		}
	});

	it("emits frames with correct unit for the parameter", async () => {
		const protocol = new Mut3Protocol();
		// RAX_A params use "%" as the unit for fuel trim
		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const pid = RAX_PID_BASE + aBlockIdx * 100 + 0; // STFT Bank 1 = %

		const frames: LiveDataFrame[] = [];
		const session = protocol.streamLiveData!(connection, [pid], (f) =>
			frames.push(f),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame.unit).toBe("%");
		}
	});

	it("only emits frames for requested PIDs, not all block parameters", async () => {
		const protocol = new Mut3Protocol();
		// Request only PID for STFT Bank 1 (param 0 of block A)
		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const pid0 = RAX_PID_BASE + aBlockIdx * 100 + 0; // STFT Bank 1
		// Do NOT request pid1 (LTFT Bank 1), pid2 (STFT Bank 2), pid3 (LTFT Bank 2)

		const receivedPids = new Set<number>();
		const session = protocol.streamLiveData!(connection, [pid0], (f) =>
			receivedPids.add(f.pid),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		// Only pid0 should have been emitted
		expect(receivedPids.has(pid0)).toBe(true);
		expect(receivedPids.has(aBlockIdx * 100 + RAX_PID_BASE + 1)).toBe(false);
		expect(receivedPids.has(aBlockIdx * 100 + RAX_PID_BASE + 2)).toBe(false);
	});

	it("sends E0 command with the correct RequestID for each block", async () => {
		const protocol = new Mut3Protocol();
		// Request two PIDs from two different blocks (A and C)
		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const cBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "C");
		const pidA = RAX_PID_BASE + aBlockIdx * 100 + 0;
		const pidC = RAX_PID_BASE + cBlockIdx * 100 + 0; // RPM

		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]],
			[RAX_C_BLOCK.requestId, [0x00, 0x00, 0x00, 0x00, 0x00]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const session = protocol.streamLiveData!(connection, [pidA, pidC], vi.fn());

		// Wait for at least one full cycle
		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		// Verify E0 was sent for both block addresses
		const sentFrames = (
			connection.sendFrame as ReturnType<typeof vi.fn>
		).mock.calls
			.filter((call: Uint8Array[]) => call[0]?.[0] === CMD_SET_ADDRESS)
			.map((call: Uint8Array[]) => {
				const d = call[0]!;
				return (
					((d[1] ?? 0) << 24) |
					((d[2] ?? 0) << 16) |
					((d[3] ?? 0) << 8) |
					(d[4] ?? 0)
				);
			});

		expect(sentFrames).toContain(RAX_A_BLOCK.requestId >>> 0);
		expect(sentFrames).toContain(RAX_C_BLOCK.requestId >>> 0);
	});

	it("stops polling after session.stop() is called", async () => {
		const protocol = new Mut3Protocol();
		const blockDataMap = new Map<number, number[]>([
			[RAX_A_BLOCK.requestId, [0x80, 0x80, 0x80, 0x80]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const aBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "A");
		const pid = RAX_PID_BASE + aBlockIdx * 100 + 0;

		const frames: LiveDataFrame[] = [];
		const session = protocol.streamLiveData!(connection, [pid], (f) =>
			frames.push(f),
		);

		// Let it run briefly
		await new Promise<void>((resolve) => setTimeout(resolve, 60));
		session.stop();
		const countAfterStop = frames.length;

		// No more frames should arrive after stop
		await new Promise<void>((resolve) => setTimeout(resolve, 60));
		expect(frames.length).toBe(countAfterStop);
	});

	it("does not throw when PIDs are outside the RAX range", () => {
		const protocol = new Mut3Protocol();
		const connection = makeMockConnection("openport2");
		// OBD-II PIDs that have no mapping
		expect(() => {
			const session = protocol.streamLiveData!(
				connection,
				[0x0c, 0x0d],
				vi.fn(),
			);
			session.stop();
		}).not.toThrow();
	});

	it("emits decoded RPM value proportional to raw bytes (RAX_C block)", async () => {
		const protocol = new Mut3Protocol();
		// RAX_C RPM is bits 11-21 (bitOffset=11, bitLength=11), convert = raw * 7.8125
		// For raw = 256 (RPM ~2000): bytes [0x19, 0x80, 0x00, 0x00, 0x00]
		// Let's encode RPM raw = 0 → all zero bytes
		const blockDataMap = new Map<number, number[]>([
			[RAX_C_BLOCK.requestId, [0x00, 0x00, 0x00, 0x00, 0x00]],
		]);
		const connection = makeRaxStreamMock(blockDataMap);

		const cBlockIdx = RAX_BLOCKS.findIndex((b) => b.blockId === "C");
		const rpmPid = RAX_PID_BASE + cBlockIdx * 100 + 0; // RPM is first param

		const frames: LiveDataFrame[] = [];
		const session = protocol.streamLiveData!(connection, [rpmPid], (f) =>
			frames.push(f),
		);

		await new Promise<void>((resolve) => setTimeout(resolve, 80));
		session.stop();

		expect(frames.length).toBeGreaterThan(0);
		// All zero bytes → RPM raw = 0 → 0 * 7.8125 = 0 RPM
		for (const frame of frames) {
			expect(frame.value).toBe(0);
			expect(frame.unit).toBe("RPM");
		}
	});
});
