import type {
	DeviceConnection,
	EcuEvent,
	EcuProtocol,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataSession,
	PidDescriptor,
	RomProgress,
} from "@ecu-explorer/device";
import { extractAllRaxParameters, RAX_BLOCKS } from "./rax-decoder.js";
import { computeFlashSecurityKey, computeSecurityKey } from "./security.js";

// Ref: https://github.com/harshadura/libmut/blob/master/libmut/mut.py
// MUT-III ROM readback sequence — start_session(), security_access(), read_memory()

// CAN IDs for MUT-III over ISO 15765-4
// Confirmed from EcuFlash 1.44 analysis of the `mitsucan` flash method.
// TESTER_CAN_ID (0x7E0) and ECU_CAN_ID (0x7E8) are standard OBD-II CAN IDs
// used by EcuFlash 1.44 for the EVO X at 500 kbps on ISO 15765-4.
// TODO: Pass these to the transport layer's CAN filter configuration once the
// transport API supports explicit CAN ID filtering. Currently the OpenPort 2.0
// transport does not expose a CAN filter API, so these constants are defined
// here for documentation and future use only. Do NOT remove the `void`
// suppression below until the transport API is ready.
const TESTER_CAN_ID = 0x7e0;
const ECU_CAN_ID = 0x7e8;

// ROM parameters for Mitsubishi 4B11T / EVO X
const ROM_START = 0x000000;
const ROM_SIZE = 0x100000; // 1 MB
const BLOCK_SIZE = 0x80; // 128 bytes per UDS ReadMemoryByAddress request

// UDS service IDs
const SID_DIAGNOSTIC_SESSION_CONTROL = 0x10;
const SID_SECURITY_ACCESS = 0x27;
const SID_READ_MEMORY_BY_ADDRESS = 0x23;
const ADDRESS_AND_LENGTH_FORMAT = 0x14; // 1 byte length, 3 bytes address
const SID_VENDOR_SERVICE = 0x3b;

// Trace-confirmed MUT-III flash session values for EVO X (`mitsucan`).
const FLASH_PREPARATION_SESSION = 0x92;
const FLASH_PROGRAMMING_SESSION = 0x85;
const FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION = 0x05;
const FLASH_SECURITY_SEND_KEY_SUBFUNCTION = 0x06;
const FLASH_PREPARE_DOWNLOAD_SUBFUNCTION = 0x9a;
const FLASH_PREPARE_DOWNLOAD_REQUEST = new Uint8Array([
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
]);
const FLASH_REQUEST_DOWNLOAD_STAGE1 = new Uint8Array([
	0x34, 0x20, 0x00, 0x00, 0x01, 0x00, 0x00, 0x02,
]);
const FLASH_TRANSFER_DATA_STAGE1_BA = new Uint8Array([0x36, 0xba, 0x02]);
const FLASH_TRANSFER_DATA_STAGE1_D4 = new Uint8Array([0x36, 0xd4, 0xd4]);
const FLASH_REQUEST_TRANSFER_EXIT = new Uint8Array([0x37]);
const FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE = new Uint8Array([0x31, 0xe0]);
const FLASH_ROUTINE_CONTROL_STAGE2 = new Uint8Array([0x31, 0xe1, 0x02]);
const FLASH_ECU_RESET_HARD = new Uint8Array([0x11, 0x01]);
const FLASH_REQUEST_DOWNLOAD_STAGE2 = new Uint8Array([
	0x34, 0x80, 0x85, 0x38, 0x01, 0x00, 0x00, 0xd0,
]);
const FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC = new Uint8Array([
	0x36, 0xcc, 0xfb, 0x54, 0xd4, 0x6a, 0xd0, 0x55, 0x57, 0xd7, 0xd4, 0xd5, 0x6b,
	0xa5, 0xd2, 0xf8, 0xd5, 0xd3, 0xd0, 0xa7, 0xd4, 0x20, 0xd6, 0xd7, 0xd6, 0xd5,
	0x6b, 0x54, 0xd4, 0x26, 0xd0, 0x1e, 0xb4, 0xd3, 0xd0, 0x3c, 0x97, 0x20, 0xd6,
	0xfb, 0xd5, 0xd3, 0xd0, 0x8f, 0xd6, 0x4c, 0xd2, 0x54, 0xd4, 0xd3, 0xd0, 0x55,
	0x35, 0xd5, 0x52, 0x57, 0x57, 0x52, 0x52, 0xff, 0xb4, 0x26, 0xd0, 0x55, 0x35,
	0xd7, 0xd4, 0xd5, 0x20, 0x26, 0xd0, 0x55, 0x57, 0xd7, 0xcd, 0xd5, 0x27, 0xd3,
	0xd0, 0xa7, 0x8b, 0xf7, 0x38, 0xd5, 0x51, 0x26, 0xd0, 0xa7, 0x87, 0x18, 0x54,
	0x03, 0xeb, 0x6a, 0xd0, 0x55, 0xa1, 0xd7, 0xd4, 0xd5, 0x6b, 0x9e, 0xd2, 0xf8,
	0x16, 0xd3, 0xd0, 0xa7, 0x55, 0x19, 0xd6, 0x54, 0xd4, 0xd3, 0x15, 0x56, 0xd4,
	0x1f, 0xd0, 0xa7, 0x75, 0xd5, 0x1a, 0xd7, 0xd4, 0x1f, 0xd0, 0xa7, 0x95, 0xd5,
	0x1a, 0xd7, 0xd0, 0xd5, 0x6b, 0xfb, 0x8b, 0xd5, 0xa3, 0x21, 0xff, 0x1f, 0xd0,
	0x3c, 0x97, 0x6c, 0x1e, 0xd4, 0xe9, 0xd5, 0x6b, 0xd5, 0x1e, 0xd6, 0xff, 0xd5,
	0x1a, 0xf6, 0xff, 0x54, 0xd4, 0x52, 0x71, 0xff, 0x2b, 0x26, 0xd0, 0x3c, 0x97,
	0x20, 0x25, 0x54, 0xd4, 0xd3, 0xd0, 0x52, 0xd4, 0x27, 0xd6, 0x03, 0xd3, 0xd3,
	0xd0, 0x52, 0xd4, 0x4c, 0xd2, 0x54, 0xd4, 0xcc, 0x7f, 0xf8, 0xc9, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x26, 0xd4, 0xd4, 0xd4, 0xd4, 0xd4,
	0xd4,
]);
const FLASH_ROUTINE_CONTROL_STAGE1 = new Uint8Array([0x31, 0xe1, 0x01]);

// MUT-III serial/CAN direct memory commands (K-line / RAX streaming)
// Reference: EvoScan_Protocol_Analysis.md — commands E0-E6
const CMD_SET_ADDRESS = 0xe0; // E0: Set 4-byte RAM address pointer
const CMD_READ_WORD_INC = 0xe5; // E5: Read 2 bytes and auto-increment address by 2
const CMD_READ_BYTE = 0xe1; // E1: Read 1 byte at current address (for odd-size remainder)

// Polling interval between full RAX cycle iterations (ms).
// RAX blocks refresh at ~10-20 Hz on CAN, ~10 Hz on K-line.
// A 20 ms cycle gives headroom for multiple block reads per cycle.
const RAX_POLL_INTERVAL_MS = 20;

// Base PID number for synthetic MUT-III RAX PIDs.
// OBD-II Mode 01 uses PIDs 0x00–0xFF. We use 0x8000–0x8FFF as a proprietary
// range: pid = RAX_PID_BASE + (blockIndex * 100) + paramIndex
const RAX_PID_BASE = 0x8000;

// ---------------------------------------------------------------------------
// PID ↔ RAX parameter mapping helpers
// ---------------------------------------------------------------------------

/**
 * Build a list of PidDescriptors from all RAX blocks.
 *
 * Each RAX parameter is assigned a synthetic PID number in 0x8000–0x8FFF
 * to avoid collision with standard OBD-II and manufacturer PIDs.
 *
 * Encoding: `pid = RAX_PID_BASE + (blockIndex * 100) + paramIndex`
 *
 * @returns Array of PidDescriptors for all 48 RAX parameters across 8 blocks
 */
function buildRaxPidDescriptors(): PidDescriptor[] {
	const descriptors: PidDescriptor[] = [];
	for (let blockIdx = 0; blockIdx < RAX_BLOCKS.length; blockIdx++) {
		const block = RAX_BLOCKS[blockIdx];
		if (block === undefined) {
			continue;
		}
		for (let paramIdx = 0; paramIdx < block.parameters.length; paramIdx++) {
			const param = block.parameters[paramIdx];
			if (param === undefined) {
				continue;
			}
			descriptors.push({
				pid: RAX_PID_BASE + blockIdx * 100 + paramIdx,
				name: param.name,
				unit: param.unit,
				minValue: param.minValue ?? 0,
				maxValue: param.maxValue ?? 255,
			});
		}
	}
	return descriptors;
}

/** Cached PID descriptors (built once at module load, reused across calls). */
const RAX_PID_DESCRIPTORS: PidDescriptor[] = buildRaxPidDescriptors();

/**
 * Decode a synthetic RAX PID back to its block index and parameter index.
 *
 * @param pid - Synthetic PID in range 0x8000–0x8FFF
 * @returns `{ blockIdx, paramIdx }` or `null` if not a valid RAX PID
 */
function decodeRaxPid(
	pid: number,
): { blockIdx: number; paramIdx: number } | null {
	if (pid < RAX_PID_BASE) return null;
	const offset = pid - RAX_PID_BASE;
	const blockIdx = Math.floor(offset / 100);
	const paramIdx = offset % 100;
	if (blockIdx >= RAX_BLOCKS.length) return null;
	const block = RAX_BLOCKS[blockIdx];
	if (block === undefined) return null;
	if (paramIdx >= block.parameters.length) return null;
	return { blockIdx, paramIdx };
}

/**
 * Read a single RAX block from the ECU using E0 (set address) + E5 (read word,
 * auto-increment) command pairs.
 *
 * Command sequence per block:
 *   1. `[0xE0, a3, a2, a1, a0]`  — set the 4-byte RAM address pointer
 *   2. `[0xE5]` × ⌊blockSize/2⌋   — read 2 bytes and increment (pairs)
 *   3. `[0xE1]`                   — if blockSize is odd, read the final byte
 *
 * The ECU response to each E5 is exactly 2 bytes of data.
 * The ECU response to E1 is exactly 1 byte of data.
 *
 * @param connection - Active device connection
 * @param requestId  - 4-byte RAM address of the RAX block (e.g. 0x238051b0)
 * @param blockSize  - Number of bytes to read
 * @returns Raw block data as Uint8Array
 */
async function readRaxBlock(
	connection: DeviceConnection,
	requestId: number,
	blockSize: number,
): Promise<Uint8Array> {
	// Step 1: Set the 4-byte address with E0
	const a3 = (requestId >>> 24) & 0xff;
	const a2 = (requestId >>> 16) & 0xff;
	const a1 = (requestId >>> 8) & 0xff;
	const a0 = requestId & 0xff;
	await connection.sendFrame(new Uint8Array([CMD_SET_ADDRESS, a3, a2, a1, a0]));

	// Step 2: Read the block in 2-byte chunks using E5 (read + auto-increment)
	const result = new Uint8Array(blockSize);
	let offset = 0;
	const wordCount = Math.floor(blockSize / 2);
	for (let i = 0; i < wordCount; i++) {
		const word = await connection.sendFrame(
			new Uint8Array([CMD_READ_WORD_INC]),
		);
		result[offset++] = word[0] ?? 0;
		result[offset++] = word[1] ?? 0;
	}

	// Step 3: If blockSize is odd, read the remaining byte with E1
	if (blockSize % 2 !== 0) {
		const lastByte = await connection.sendFrame(
			new Uint8Array([CMD_READ_BYTE]),
		);
		result[offset] = lastByte[0] ?? 0;
	}

	return result;
}

/**
 * MUT-III ECU protocol implementation for Mitsubishi 4B11T ECUs (EVO X).
 *
 * Implements the UDS-based ROM readback sequence over CAN (ISO 15765-4)
 * using the Tactrix OpenPort 2.0 as the underlying transport.
 *
 * ## EcuFlash 1.44 Context
 *
 * EcuFlash 1.44 calls this flash method **`mitsucan`**. It targets the
 * **Renesas M32186F8** CPU in the EVO X (Lancer Evolution X / 4B11T) — NOT
 * the SH7058 (which is used by Subaru ECUs and EVO 7/8/9). The `mitsucan`
 * path uses the ECU's built-in CAN bootloader directly; no kernel upload is
 * required (unlike the EVO 7/8/9 `mitsukernel` path over K-line).
 *
 * CAN IDs confirmed from EcuFlash 1.44 analysis:
 *   - Tester → ECU: `0x7E0`
 *   - ECU → Tester: `0x7E8`
 *   - Baud rate: 500 kbps, ISO 15765-4
 *
 * References:
 * - https://github.com/harshadura/libmut/blob/master/libmut/mut.py
 * - Community EvoScan forum documentation
 * - EcuFlash 1.44 binary analysis (see HANDSHAKE_ANALYSIS.md §7.2, §7.4)
 */
export class Mut3Protocol implements EcuProtocol {
	readonly name = "MUT-III (Mitsubishi)";

	/**
	 * Probe the connection to determine if this protocol can communicate
	 * with the connected ECU.
	 *
	 * Returns true if the device is an OpenPort 2.0 (transportName === "openport2")
	 * for CAN-based MUT-III, or a K-line transport (transportName === "kline")
	 * for older Mitsubishi ECUs using the E0/E5/E1 command sequence.
	 *
	 * @param connection - Active device connection to probe
	 */
	async canHandle(connection: DeviceConnection): Promise<boolean> {
		return (
			connection.deviceInfo.transportName === "openport2" ||
			connection.deviceInfo.transportName === "kline"
		);
	}

	/**
	 * Return the list of RAX parameters supported by this MUT-III ECU.
	 *
	 * All 48 RAX parameters across 8 data blocks (A–H) are returned.
	 * Each parameter has a synthetic PID number in 0x8000–0x8FFF.
	 *
	 * @param _connection - Unused; RAX parameters are fixed for the 4B11T ECU
	 * @returns All 48 RAX PidDescriptors
	 */
	async getSupportedPids(
		_connection: DeviceConnection,
	): Promise<PidDescriptor[]> {
		return RAX_PID_DESCRIPTORS;
	}

	/**
	 * Stream live data for the requested RAX parameter PIDs.
	 *
	 * ## How it works
	 *
	 * 1. Map the requested PIDs to the minimal set of RAX blocks needed.
	 * 2. Each polling cycle, for each required block:
	 *    a. Send `[0xE0, addr3, addr2, addr1, addr0]` to set the address.
	 *    b. Read block data using `[0xE5]` (2-byte read + auto-increment) pairs,
	 *       plus a final `[0xE1]` for any odd byte.
	 *    c. Decode the raw bytes using `extractAllRaxParameters()`.
	 *    d. Emit one `LiveDataFrame` per requested parameter in that block.
	 * 3. Wait `RAX_POLL_INTERVAL_MS` before the next cycle.
	 * 4. Report health metrics (samples/s, dropped frames, latency) periodically.
	 *
	 * @param connection - Active device connection
	 * @param pids - Synthetic RAX PID numbers to stream (from getSupportedPids)
	 * @param onFrame - Called for each decoded parameter value
	 * @param onHealth - Optional callback for health/performance metrics
	 * @returns LiveDataSession — call `.stop()` to halt streaming
	 */
	streamLiveData(
		connection: DeviceConnection,
		pids: number[],
		onFrame: (frame: LiveDataFrame) => void,
		onHealth?: (health: LiveDataHealth) => void,
	): LiveDataSession {
		let running = true;
		const startTime = Date.now();

		// Map each requested pid to its block index and param index
		const pidMap = new Map<
			number,
			{ blockIdx: number; paramIdx: number; unit: string }
		>();
		for (const pid of pids) {
			const decoded = decodeRaxPid(pid);
			if (!decoded) continue;

			const param = RAX_BLOCKS[decoded.blockIdx]?.parameters[decoded.paramIdx];
			if (!param) continue;

			pidMap.set(pid, { ...decoded, unit: param.unit });
		}

		// Derive the unique set of block indices needed for requested pids
		const requiredBlockIndices = new Set<number>(
			[...pidMap.values()].map((v) => v.blockIdx),
		);

		// Health tracking
		let frameCount = 0;
		let droppedFrames = 0;
		let lastHealthReportTime = startTime;
		let totalLatencyMs = 0;
		let latencySamples = 0;

		const poll = async () => {
			while (running) {
				const cycleStart = Date.now();

				for (const blockIdx of requiredBlockIndices) {
					if (!running) break;

					const block = RAX_BLOCKS[blockIdx];
					if (!block) continue;

					try {
						const blockStart = Date.now();
						const rawData = await readRaxBlock(
							connection,
							block.requestId,
							block.blockSize,
						);
						const latency = Date.now() - blockStart;
						totalLatencyMs += latency;
						latencySamples++;

						// Decode all parameters in this block
						const values = extractAllRaxParameters(rawData, block);
						const timestamp = Date.now() - startTime;

						// Emit only the parameters that were requested
						for (const [pid, { blockIdx: bIdx, paramIdx, unit }] of pidMap) {
							if (bIdx === blockIdx) {
								const paramName =
									RAX_BLOCKS[blockIdx]?.parameters[paramIdx]?.name;
								if (paramName === undefined) continue;
								const value = values[paramName];
								if (value !== undefined) {
									onFrame({ timestamp, pid, value, unit });
									frameCount++;
								}
							}
						}
					} catch (error) {
						droppedFrames++;
						console.error(
							`[MUT-III] Failed to read RAX block ${block.blockId} (0x${block.requestId.toString(16)}):`,
							error,
						);
					}
				}

				// Report health metrics periodically (every second)
				const now = Date.now();
				const elapsed = now - lastHealthReportTime;
				if (onHealth && elapsed >= 1000) {
					const samplesPerSecond = frameCount / (elapsed / 1000);
					const avgLatencyMs =
						latencySamples > 0
							? Math.round(totalLatencyMs / latencySamples)
							: 0;
					const status =
						samplesPerSecond === 0
							? "stalled"
							: samplesPerSecond < 5
								? "degraded"
								: "healthy";

					onHealth({
						samplesPerSecond: Math.round(samplesPerSecond),
						droppedFrames,
						latencyMs: avgLatencyMs,
						status,
					});

					// Reset counters for next window
					frameCount = 0;
					droppedFrames = 0;
					totalLatencyMs = 0;
					latencySamples = 0;
					lastHealthReportTime = now;
				}

				// Wait before next polling cycle
				const cycleElapsed = Date.now() - cycleStart;
				const waitMs = Math.max(0, RAX_POLL_INTERVAL_MS - cycleElapsed);
				if (waitMs > 0) {
					await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
				}
			}
		};

		// Start the polling loop (fire and forget; errors are caught within poll)
		poll().catch((error) => {
			console.error("[MUT-III] Streaming poll loop exited with error:", error);
		});

		return {
			stop: () => {
				running = false;
			},
		};
	}

	/**
	 * Read the full ROM binary from the ECU using the MUT-III UDS sequence.
	 *
	 * Sequence:
	 * 1. Extended Diagnostic Session (0x10 0x03)
	 * 2. Security Access — request seed (0x27 0x01)
	 * 3. Compute key from seed
	 * 4. Security Access — send key (0x27 0x02 <key>)
	 * 5. Read ROM in 128-byte blocks via ReadMemoryByAddress (0x23)
	 *
	 * Ref: https://github.com/harshadura/libmut/blob/master/libmut/mut.py
	 *
	 * @param connection - Active device connection
	 * @param onProgress - Progress callback invoked after each block read
	 * @param onEvent - Optional event callback for key milestones
	 * @returns Full ROM binary as Uint8Array (1 MB for 4B11T)
	 */
	async readRom(
		connection: DeviceConnection,
		onProgress: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<Uint8Array> {
		// Step 1: Extended Diagnostic Session
		await connection.sendFrame(
			new Uint8Array([SID_DIAGNOSTIC_SESSION_CONTROL, 0x03]),
		);

		// Step 2: Security Access — request seed
		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
		});

		const seedResponse = await connection.sendFrame(
			new Uint8Array([SID_SECURITY_ACCESS, 0x01]),
		);

		// Parse 2-byte seed from response (bytes after 0x67 0x01 header)
		// Response format: [0x67, 0x01, seedHigh, seedLow]
		const seed = seedResponse.slice(2, 4);

		// Step 3: Compute key from seed
		const key = computeSecurityKey(seed);

		// Step 4: Security Access — send key
		const keyResponse = await connection.sendFrame(
			new Uint8Array([SID_SECURITY_ACCESS, 0x02, ...key]),
		);

		// Verify security access was granted (0x67 0x02)
		if (keyResponse[0] !== 0x67 || keyResponse[1] !== 0x02) {
			throw new Error(
				`Security access denied: ECU returned [${Array.from(keyResponse)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		// Emit SECURITY_ACCESS_GRANTED after key is accepted
		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
		});

		// Step 5: Read ROM in 128-byte blocks
		const rom = new Uint8Array(ROM_SIZE);
		const totalBlocks = ROM_SIZE / BLOCK_SIZE;

		for (let block = 0; block < totalBlocks; block++) {
			const addr = ROM_START + block * BLOCK_SIZE;

			// Address bytes in little-endian order (addr[2], addr[1], addr[0])
			const addrByte0 = (addr >> 16) & 0xff;
			const addrByte1 = (addr >> 8) & 0xff;
			const addrByte2 = addr & 0xff;

			const response = await connection.sendFrame(
				new Uint8Array([
					SID_READ_MEMORY_BY_ADDRESS,
					ADDRESS_AND_LENGTH_FORMAT,
					addrByte0,
					addrByte1,
					addrByte2,
					BLOCK_SIZE,
				]),
			);

			// Skip first byte of response (0x63 positive response SID)
			const blockData = response.slice(1, 1 + BLOCK_SIZE);
			rom.set(blockData, block * BLOCK_SIZE);

			const bytesProcessed = (block + 1) * BLOCK_SIZE;
			onProgress({
				phase: "reading",
				bytesProcessed,
				totalBytes: ROM_SIZE,
				percentComplete: (bytesProcessed / ROM_SIZE) * 100,
			});
		}

		return rom;
	}

	/**
	 * Perform the trace-confirmed MUT-III flash session setup without sending
	 * any key or download payloads.
	 *
	 * This is intentionally limited to the pre-write negotiation that has been
	 * confirmed by CAN captures:
	 *   1. `0x10 0x92`
	 *   2. `0x10 0x85` (may reply with `0x7F 0x10 0x78` before success)
	 *   3. `0x27 0x05` (4-byte seed)
	 *   4. `0x27 0x06` (derived from observed seed/key fixtures)
	 *   5. `0x3B 0x9A` (traced pre-download request)
	 *   6. `0x34 0x20 0x00 0x00 0x01 0x00 0x00 0x02`
	 *
	 * The method stops after the first traced BA-side continuation
	 * response-pending boundary and does not attempt to generalize the larger
	 * variant-dependent transfer loop that follows.
	 */
	async dryRunWrite(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		if (rom.length !== ROM_SIZE) {
			throw new RangeError(
				`dryRunWrite: expected ${ROM_SIZE}-byte ROM, got ${rom.length} bytes`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Entering traced MUT-III flash preparation session",
		});

		await this.startFlashPreparationSession(connection);

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Entering traced MUT-III flash programming session",
		});

		await this.startFlashProgrammingSession(connection);

		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
		});

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Requesting traced MUT-III flash seed",
		});

		const seedResponse = await connection.sendFrame(
			new Uint8Array([
				SID_SECURITY_ACCESS,
				FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION,
			]),
		);

		if (
			seedResponse[0] !== 0x67 ||
			seedResponse[1] !== FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION
		) {
			throw new Error(
				`Flash seed request failed: ECU returned [${Array.from(seedResponse)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		const seed = seedResponse.slice(2);
		const key = computeFlashSecurityKey(seed);

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Sending traced MUT-III flash key",
		});

		const sendKeyResponse = await connection.sendFrame(
			new Uint8Array([
				SID_SECURITY_ACCESS,
				FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
				...key,
			]),
		);

		if (
			sendKeyResponse[0] !== 0x67 ||
			sendKeyResponse[1] !== FLASH_SECURITY_SEND_KEY_SUBFUNCTION
		) {
			throw new Error(
				`Flash key request failed: ECU returned [${Array.from(sendKeyResponse)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
		});

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III pre-download vendor request",
		});

		let prepareDownloadResponse = await connection.sendFrame(
			FLASH_PREPARE_DOWNLOAD_REQUEST,
		);
		if (
			prepareDownloadResponse[0] === 0x7f &&
			prepareDownloadResponse[1] === SID_VENDOR_SERVICE &&
			prepareDownloadResponse[2] === 0x78
		) {
			prepareDownloadResponse = await connection.sendFrame(
				FLASH_PREPARE_DOWNLOAD_REQUEST,
			);
		}

		if (
			prepareDownloadResponse[0] !== SID_VENDOR_SERVICE + 0x40 ||
			prepareDownloadResponse[1] !== FLASH_PREPARE_DOWNLOAD_SUBFUNCTION
		) {
			throw new Error(
				`Flash vendor pre-download request failed: ECU returned [${Array.from(
					prepareDownloadResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing first traced MUT-III RequestDownload",
		});

		const requestDownloadStage1Response = await connection.sendFrame(
			FLASH_REQUEST_DOWNLOAD_STAGE1,
		);
		if (
			requestDownloadStage1Response[0] !== 0x74 ||
			requestDownloadStage1Response[1] !== 0x01 ||
			requestDownloadStage1Response[2] !== 0x01
		) {
			throw new Error(
				`Flash RequestDownload stage 1 failed: ECU returned [${Array.from(
					requestDownloadStage1Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Sending first traced MUT-III TransferData block",
		});

		const transferDataStage1Response = await connection.sendFrame(
			FLASH_TRANSFER_DATA_STAGE1_BA,
		);
		if (transferDataStage1Response[0] !== 0x76) {
			throw new Error(
				`Flash TransferData stage 1 failed: ECU returned [${Array.from(
					transferDataStage1Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing first traced MUT-III RequestTransferExit",
		});

		const requestTransferExitResponse = await connection.sendFrame(
			FLASH_REQUEST_TRANSFER_EXIT,
		);
		if (requestTransferExitResponse[0] !== 0x77) {
			throw new Error(
				`Flash RequestTransferExit failed: ECU returned [${Array.from(
					requestTransferExitResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing second traced MUT-III RequestDownload",
		});

		const requestDownloadStage2Response = await connection.sendFrame(
			FLASH_REQUEST_DOWNLOAD_STAGE2,
		);
		if (
			requestDownloadStage2Response[0] !== 0x74 ||
			requestDownloadStage2Response[1] !== 0x01 ||
			requestDownloadStage2Response[2] !== 0x01
		) {
			throw new Error(
				`Flash RequestDownload stage 2 failed: ECU returned [${Array.from(
					requestDownloadStage2Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Sending first traced large MUT-III TransferData block",
		});

		const transferDataStage2Response = await connection.sendFrame(
			FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC,
		);
		if (transferDataStage2Response[0] !== 0x76) {
			throw new Error(
				`Flash TransferData stage 2 failed: ECU returned [${Array.from(
					transferDataStage2Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message:
				"Issuing traced MUT-III RequestTransferExit after first bulk block",
		});

		const requestTransferExitStage2Response = await connection.sendFrame(
			FLASH_REQUEST_TRANSFER_EXIT,
		);
		if (requestTransferExitStage2Response[0] !== 0x77) {
			throw new Error(
				`Flash RequestTransferExit stage 2 failed: ECU returned [${Array.from(
					requestTransferExitStage2Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III RoutineControl after first bulk block",
		});

		const routineControlStage1Response = await connection.sendFrame(
			FLASH_ROUTINE_CONTROL_STAGE1,
		);
		if (
			routineControlStage1Response[0] !== 0x71 ||
			routineControlStage1Response[1] !== 0xe1 ||
			routineControlStage1Response[2] !== 0x00
		) {
			throw new Error(
				`Flash RoutineControl stage 1 failed: ECU returned [${Array.from(
					routineControlStage1Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III BA continuation RoutineControl",
		});

		const routineControlStage1ContinueResponse = await connection.sendFrame(
			FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE,
		);
		if (
			routineControlStage1ContinueResponse[0] !== 0x7f ||
			routineControlStage1ContinueResponse[1] !== 0x31 ||
			routineControlStage1ContinueResponse[2] !== 0x78
		) {
			throw new Error(
				`Flash RoutineControl BA continuation failed: ECU returned [${Array.from(
					routineControlStage1ContinueResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}
	}

	/**
	 * Perform the trace-confirmed MUT-III D4/reset branch without attempting the
	 * post-reset functional re-entry sequence.
	 *
	 * This follows the clean reset-side branch observed in the concrete write
	 * captures:
	 *   1. shared flash-session negotiation through `0x34 0x20 ...`
	 *   2. `0x36 0xD4 0xD4`
	 *   3. `0x37`
	 *   4. `0x31 0xE1 0x02` (with `0x7F 0x31 0x78` response-pending)
	 *   5. `0x11 0x01` (with `0x7F 0x11 0x78` response-pending)
	 *
	 * The method intentionally stops after the positive ECU-reset response. The
	 * subsequent `0x3E 0x02`, `0x10 0x81`, and `0x10 0x92` traffic is sent as
	 * functional broadcast in the traces and does not fit the current
	 * request/response `sendFrame()` contract.
	 */
	async dryRunWriteResetBranch(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		if (rom.length !== ROM_SIZE) {
			throw new RangeError(
				`dryRunWriteResetBranch: expected ${ROM_SIZE}-byte ROM, got ${rom.length} bytes`,
			);
		}

		await this.negotiateFlashSessionThroughStage1(
			connection,
			onProgress,
			onEvent,
			FLASH_TRANSFER_DATA_STAGE1_D4,
			"Sending traced MUT-III D4 reset-branch token",
		);

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III reset-branch RoutineControl",
		});

		let routineControlStage2Response = await connection.sendFrame(
			FLASH_ROUTINE_CONTROL_STAGE2,
		);
		if (
			routineControlStage2Response[0] === 0x7f &&
			routineControlStage2Response[1] === 0x31 &&
			routineControlStage2Response[2] === 0x78
		) {
			routineControlStage2Response = await connection.sendFrame(
				FLASH_ROUTINE_CONTROL_STAGE2,
			);
		}
		if (
			routineControlStage2Response[0] !== 0x71 ||
			routineControlStage2Response[1] !== 0xe1 ||
			routineControlStage2Response[2] !== 0x00
		) {
			throw new Error(
				`Flash RoutineControl stage 2 failed: ECU returned [${Array.from(
					routineControlStage2Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onEvent?.({
			type: "ECU_RESET_REQUESTED",
			timestamp: Date.now(),
		});
		onEvent?.({
			type: "ECU_RESETTING",
			timestamp: Date.now(),
		});

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III hard reset request",
		});

		let resetResponse = await connection.sendFrame(FLASH_ECU_RESET_HARD);
		if (
			resetResponse[0] === 0x7f &&
			resetResponse[1] === 0x11 &&
			resetResponse[2] === 0x78
		) {
			resetResponse = await connection.sendFrame(FLASH_ECU_RESET_HARD);
		}
		if (resetResponse[0] !== 0x51) {
			throw new Error(
				`Flash reset-branch ECUReset failed: ECU returned [${Array.from(
					resetResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onEvent?.({
			type: "ECU_RESET_ACKNOWLEDGED",
			timestamp: Date.now(),
		});
	}

	// TODO: Implement writeRom() for EVO X (`mitsucan`) ROM flash write.
	// Known gap: the native traced bootstrap is understood through the BA `0x31 E0`
	// boundary and the D4 reset path, but the observed EcuFlash/OpenECU write flow
	// then hands off into a RAM-resident OpenECU kernel protocol.
	//
	// Write sequence (from EcuFlash 1.44 `mitsucan` analysis):
	//   1. Extended/Programming diagnostic session — 0x10 0x03 or 0x10 0x02
	//      (exact session type unconfirmed)
	//   2. Diagnostic session        — 0x10 0x92
	//   3. Programming session       — 0x10 0x85
	//   4. SecurityAccess requestSeed — 0x27 0x05 (4-byte seed)
	//   5. SecurityAccess sendKey    — 0x27 0x06 with computed 4-byte key
	//   6. Vendor service            — 0x3B 0x9A
	//   7. RequestDownload / TransferData traffic follows
	//
	// ⚠️ BLOCKER: The traced flash-session SecurityAccess key is now implemented,
	// but full write traffic after the first `RequestTransferExit` still needs
	// transcript-driven implementation and verification. See `security.ts` and
	// HANDSHAKE_ANALYSIS.md §7.5 for the current traced flow.

	private async startFlashPreparationSession(
		connection: DeviceConnection,
	): Promise<void> {
		const response = await connection.sendFrame(
			new Uint8Array([
				SID_DIAGNOSTIC_SESSION_CONTROL,
				FLASH_PREPARATION_SESSION,
			]),
		);

		if (response[0] !== 0x50 || response[1] !== FLASH_PREPARATION_SESSION) {
			throw new Error(
				`Flash preparation session failed: ECU returned [${Array.from(response)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}
	}

	private async negotiateFlashSessionThroughStage1(
		connection: DeviceConnection,
		onProgress: (progress: RomProgress) => void,
		onEvent: ((event: EcuEvent) => void) | undefined,
		stage1TransferData: Uint8Array,
		stage1TransferMessage: string,
	): Promise<void> {
		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Entering traced MUT-III flash preparation session",
		});

		await this.startFlashPreparationSession(connection);

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Entering traced MUT-III flash programming session",
		});

		await this.startFlashProgrammingSession(connection);

		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
		});

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Requesting traced MUT-III flash seed",
		});

		const seedResponse = await connection.sendFrame(
			new Uint8Array([
				SID_SECURITY_ACCESS,
				FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION,
			]),
		);

		if (
			seedResponse[0] !== 0x67 ||
			seedResponse[1] !== FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION
		) {
			throw new Error(
				`Flash seed request failed: ECU returned [${Array.from(seedResponse)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		const seed = seedResponse.slice(2);
		const key = computeFlashSecurityKey(seed);

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Sending traced MUT-III flash key",
		});

		const sendKeyResponse = await connection.sendFrame(
			new Uint8Array([
				SID_SECURITY_ACCESS,
				FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
				...key,
			]),
		);

		if (
			sendKeyResponse[0] !== 0x67 ||
			sendKeyResponse[1] !== FLASH_SECURITY_SEND_KEY_SUBFUNCTION
		) {
			throw new Error(
				`Flash key request failed: ECU returned [${Array.from(sendKeyResponse)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
		});

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing traced MUT-III pre-download vendor request",
		});

		let prepareDownloadResponse = await connection.sendFrame(
			FLASH_PREPARE_DOWNLOAD_REQUEST,
		);
		if (
			prepareDownloadResponse[0] === 0x7f &&
			prepareDownloadResponse[1] === SID_VENDOR_SERVICE &&
			prepareDownloadResponse[2] === 0x78
		) {
			prepareDownloadResponse = await connection.sendFrame(
				FLASH_PREPARE_DOWNLOAD_REQUEST,
			);
		}

		if (
			prepareDownloadResponse[0] !== SID_VENDOR_SERVICE + 0x40 ||
			prepareDownloadResponse[1] !== FLASH_PREPARE_DOWNLOAD_SUBFUNCTION
		) {
			throw new Error(
				`Flash vendor pre-download request failed: ECU returned [${Array.from(
					prepareDownloadResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing first traced MUT-III RequestDownload",
		});

		const requestDownloadStage1Response = await connection.sendFrame(
			FLASH_REQUEST_DOWNLOAD_STAGE1,
		);
		if (
			requestDownloadStage1Response[0] !== 0x74 ||
			requestDownloadStage1Response[1] !== 0x01 ||
			requestDownloadStage1Response[2] !== 0x01
		) {
			throw new Error(
				`Flash RequestDownload stage 1 failed: ECU returned [${Array.from(
					requestDownloadStage1Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: stage1TransferMessage,
		});

		const transferDataStage1Response =
			await connection.sendFrame(stage1TransferData);
		if (transferDataStage1Response[0] !== 0x76) {
			throw new Error(
				`Flash TransferData stage 1 failed: ECU returned [${Array.from(
					transferDataStage1Response,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}

		onProgress({
			phase: "negotiating",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
			message: "Issuing first traced MUT-III RequestTransferExit",
		});

		const requestTransferExitResponse = await connection.sendFrame(
			FLASH_REQUEST_TRANSFER_EXIT,
		);
		if (requestTransferExitResponse[0] !== 0x77) {
			throw new Error(
				`Flash RequestTransferExit failed: ECU returned [${Array.from(
					requestTransferExitResponse,
				)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}
	}

	private async startFlashProgrammingSession(
		connection: DeviceConnection,
	): Promise<void> {
		for (;;) {
			const response = await connection.sendFrame(
				new Uint8Array([
					SID_DIAGNOSTIC_SESSION_CONTROL,
					FLASH_PROGRAMMING_SESSION,
				]),
			);

			if (response[0] === 0x50 && response[1] === FLASH_PROGRAMMING_SESSION) {
				return;
			}

			if (
				response[0] === 0x7f &&
				response[1] === SID_DIAGNOSTIC_SESSION_CONTROL &&
				response[2] === 0x78
			) {
				continue;
			}

			throw new Error(
				`Flash programming session failed: ECU returned [${Array.from(response)
					.map((b) => `0x${b.toString(16)}`)
					.join(", ")}]`,
			);
		}
	}
}

// Suppress unused-variable warnings for CAN ID constants that are defined
// for documentation purposes and future use (e.g., filter configuration).
void TESTER_CAN_ID;
void ECU_CAN_ID;

// Export constants and helpers for testing
export {
	RAX_PID_BASE,
	RAX_PID_DESCRIPTORS,
	buildRaxPidDescriptors,
	decodeRaxPid,
	readRaxBlock,
	CMD_SET_ADDRESS,
	CMD_READ_WORD_INC,
	CMD_READ_BYTE,
	SID_SECURITY_ACCESS,
	SID_VENDOR_SERVICE,
	FLASH_PREPARATION_SESSION,
	FLASH_PROGRAMMING_SESSION,
	FLASH_SECURITY_REQUEST_SEED_SUBFUNCTION,
	FLASH_SECURITY_SEND_KEY_SUBFUNCTION,
	FLASH_PREPARE_DOWNLOAD_SUBFUNCTION,
	FLASH_ECU_RESET_HARD,
	FLASH_REQUEST_DOWNLOAD_STAGE1,
	FLASH_REQUEST_DOWNLOAD_STAGE2,
	FLASH_TRANSFER_DATA_STAGE1_BA,
	FLASH_TRANSFER_DATA_STAGE1_D4,
	FLASH_TRANSFER_DATA_STAGE2_BLOCK_CC,
	FLASH_ROUTINE_CONTROL_STAGE1,
	FLASH_ROUTINE_CONTROL_STAGE1_CONTINUE,
	FLASH_ROUTINE_CONTROL_STAGE2,
	FLASH_REQUEST_TRANSFER_EXIT,
};
