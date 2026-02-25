import type {
	DeviceConnection,
	EcuEvent,
	EcuProtocol,
	PidDescriptor,
	RomProgress,
	WriteOptions,
} from "@ecu-explorer/device";
import { computeChangedSectors } from "@ecu-explorer/device";

import { computeSubaruKey } from "./security.js";
import { getAllSstParameterPids } from "./sst-parameters.js";

// Re-export SST components for convenient access
export {
	decodeSstBlock,
	decodeSstBlockSet,
	decodeSstCalc,
	decodeSstPres,
	decodeSstSlip,
	decodeSstSol,
	decodeSstState,
	decodeSstTrans,
	getSstBlockDefinition,
	SST_BLOCK_BY_ID,
	SST_BLOCKS,
	SST_CALC_BLOCK,
	SST_PRES_BLOCK,
	SST_SLIP_BLOCK,
	SST_SOL_BLOCK,
	SST_STATE_BLOCK,
	SST_TRANS_BLOCK,
	type SstBlockData,
	type SstCalcData,
	type SstPresData,
	type SstSlipData,
	type SstSolData,
	type SstStateData,
	type SstTransData,
	TRANS_MODE,
	validateSstBlockBuffer,
} from "./sst-decoder.js";
export {
	extractAllSstParameters,
	extractSstParameter,
	SST_PARAM_BY_PID,
	type SstBlockDef,
	type SstParameterCategory,
	type SstParameterDef,
} from "./sst-parameters.js";

// Ref: HANDSHAKE_ANALYSIS.md — §4.4 Subaru CAN Flash (subarucantool)
// CAN IDs for ISO 15765-4 (same as MUT-III)
// Ref: HANDSHAKE_ANALYSIS.md — §7.2 Subaru CAN IDs: TX 0x7E8, RX 0x7E0
const TESTER_CAN_ID = 0x7e0;
const ECU_CAN_ID = 0x7e8;
const CAN_BAUD = 500000; // 500 kbps

// KWP2000 service IDs
// Ref: HANDSHAKE_ANALYSIS.md — §5.1 Service Codes Found
const SID_START_DIAGNOSTIC_SESSION = 0x10;
const SID_SECURITY_ACCESS = 0x27;
const SID_READ_MEMORY_BY_ADDRESS = 0x23;
const SID_REQUEST_DOWNLOAD = 0x34;
const SID_TRANSFER_DATA = 0x36;
const SID_REQUEST_TRANSFER_EXIT = 0x37;
const SID_ERASE_MEMORY = 0xff; // KWP2000 custom erase

// ROM parameters (SH7058 — same memory model as Mitsubishi)
// Ref: HANDSHAKE_ANALYSIS.md — §7.2 Memory model: SH7058 (same as EVO X)
// Ref: HANDSHAKE_ANALYSIS.md — §2.8 SH7058: 1 MB flash at 0x00000000
const ROM_START = 0x000000;
const ROM_SIZE = 0x100000; // 1 MB
const BLOCK_SIZE = 0x80; // 128 bytes per KWP2000 ReadMemoryByAddress request

// Flash sector size for SH7058 (64 KB per sector, 16 sectors in 1 MB ROM)
// Ref: HANDSHAKE_ANALYSIS.md §2.8 — SH7058 memory model
const SECTOR_SIZE = 0x10000;

/**
 * Subaru/Denso ECU protocol implementation (KWP2000 SecurityAccess + CAN ISO 15765-4).
 *
 * Implements the KWP2000-based ROM readback sequence over CAN (ISO 15765-4)
 * using the Tactrix OpenPort 2.0 as the underlying transport.
 *
 * This protocol is used by EcuFlash for Subaru WRX/STI/Forester ECUs with
 * Denso SH7058 processors.
 *
 * References:
 * - HANDSHAKE_ANALYSIS.md — §4 Subaru / Denso Protocol Analysis
 * - HANDSHAKE_ANALYSIS.md — §4.2 densoecu::do_challenge_response (0x15a26)
 * - HANDSHAKE_ANALYSIS.md — §4.4 subarucantool::ready_port (0x6df3a)
 * - HANDSHAKE_ANALYSIS.md — §5 KWP2000 Protocol Details
 */
export class SubaruProtocol implements EcuProtocol {
	readonly name = "Subaru/Denso KWP2000 (CAN)";

	/**
	 * Probe the connection to determine if this protocol can communicate
	 * with the connected ECU.
	 *
	 * Returns true if the device is an OpenPort 2.0 (transportName === "openport2")
	 * for CAN-based KWP2000, or a K-line transport (transportName === "kline")
	 * for Subaru ECUs using the SSM protocol over K-line.
	 *
	 * Ref: HANDSHAKE_ANALYSIS.md — §4.4 subarucantool::ready_port (0x6df3a)
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
	 * Read the full ROM binary from the ECU using the KWP2000 SecurityAccess sequence.
	 *
	 * Sequence (Ref: HANDSHAKE_ANALYSIS.md §4.2 densoecu::do_challenge_response):
	 * 1. Start diagnostic session: [0x10, 0x85] (programming mode)
	 * 2. Security access request seed: [0x27, 0x01]
	 * 3. Compute key from seed using S-box nibble-swap algorithm
	 * 4. Security access send key: [0x27, 0x02, ...key]
	 * 5. Read ROM in 128-byte blocks using [0x23, addr[2], addr[1], addr[0], 0x80]
	 *
	 * Ref: HANDSHAKE_ANALYSIS.md — §4.2 Subaru Security Access
	 * Ref: HANDSHAKE_ANALYSIS.md — §5.2 Session Types — programmingSession = 0x85
	 * Ref: HANDSHAKE_ANALYSIS.md — §5.1 Service Codes
	 *
	 * @param connection - Active device connection
	 * @param onProgress - Optional progress callback invoked after each block read
	 * @param onEvent - Optional event callback for key milestones
	 * @returns Full ROM binary as Uint8Array (1 MB for SH7058)
	 */
	async readRom(
		connection: DeviceConnection,
		onProgress?: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<Uint8Array> {
		await this.enterProgrammingMode(connection, onEvent);

		// Step 5: Read ROM in 128-byte blocks
		// Ref: HANDSHAKE_ANALYSIS.md — §7.2 Memory model: SH7058 (1 MB)
		// Ref: HANDSHAKE_ANALYSIS.md — §5.1 readMemoryByAddress = 0x23
		const rom = new Uint8Array(ROM_SIZE);
		const totalBlocks = ROM_SIZE / BLOCK_SIZE;

		for (let block = 0; block < totalBlocks; block++) {
			const addr = ROM_START + block * BLOCK_SIZE;

			// Address bytes in big-endian order (3 bytes for 24-bit address space)
			// Frame format: [0x23, addr[2], addr[1], addr[0], 0x80]
			// Ref: HANDSHAKE_ANALYSIS.md — §5.1 readMemoryByAddress = 0x23
			const addrByte0 = (addr >> 16) & 0xff;
			const addrByte1 = (addr >> 8) & 0xff;
			const addrByte2 = addr & 0xff;

			const response = await connection.sendFrame(
				new Uint8Array([
					SID_READ_MEMORY_BY_ADDRESS,
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
			onProgress?.({
				phase: "reading",
				bytesProcessed,
				totalBytes: ROM_SIZE,
				percentComplete: (bytesProcessed / ROM_SIZE) * 100,
			});
		}

		return rom;
	}

	/**
	 * Write a ROM binary to the ECU using the Subaru KWP2000 sequence.
	 *
	 * Sequence:
	 * 1. Enter programming mode (session 0x85, security access)
	 * 2. Erase memory (SID_ERASE_MEMORY = 0xFF)
	 * 3. Request download (SID_REQUEST_DOWNLOAD = 0x34)
	 * 4. Transfer data (SID_TRANSFER_DATA = 0x36)
	 * 5. Request transfer exit (SID_REQUEST_TRANSFER_EXIT = 0x37)
	 *
	 * @param connection - Active device connection
	 * @param rom - ROM binary to write
	 * @param onProgress - Optional progress callback
	 * @param options - Write options
	 * @param onEvent - Optional event callback for key milestones
	 */
	async writeRom(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress?: (progress: RomProgress) => void,
		options?: WriteOptions,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		if (rom.length !== ROM_SIZE) {
			throw new Error(
				`Invalid ROM size: expected ${ROM_SIZE} bytes, got ${rom.length}`,
			);
		}

		await this.enterProgrammingMode(connection, onEvent);

		if (options?.dryRun) {
			onProgress?.({
				phase: "writing",
				bytesProcessed: ROM_SIZE,
				totalBytes: ROM_SIZE,
				percentComplete: 100,
			});
			return;
		}

		// Determine which sectors need to be erased and written.
		// When originalRom is provided, only changed sectors are processed.
		// When not provided, all sectors are processed (full flash — backward compatible).
		const sectorsToWrite = options?.originalRom
			? computeChangedSectors(options.originalRom, rom, SECTOR_SIZE)
			: Array.from({ length: ROM_SIZE / SECTOR_SIZE }, (_, i) => i);

		const blocksPerSector = SECTOR_SIZE / BLOCK_SIZE;
		let bytesWritten = 0;
		const totalBytesToWrite = sectorsToWrite.length * SECTOR_SIZE;

		for (const sectorIndex of sectorsToWrite) {
			const sectorAddr = ROM_START + sectorIndex * SECTOR_SIZE;

			const sectorAddrByte0 = (sectorAddr >> 16) & 0xff;
			const sectorAddrByte1 = (sectorAddr >> 8) & 0xff;
			const sectorAddrByte2 = sectorAddr & 0xff;

			const sectorSizeByte0 = (SECTOR_SIZE >> 16) & 0xff;
			const sectorSizeByte1 = (SECTOR_SIZE >> 8) & 0xff;
			const sectorSizeByte2 = SECTOR_SIZE & 0xff;

			// Emit SECTOR_ERASE_STARTED before erasing this sector
			onEvent?.({
				type: "SECTOR_ERASE_STARTED",
				timestamp: Date.now(),
				data: { sectorIndex, sectorAddr },
			});

			// Step 2: Erase this sector
			onProgress?.({
				phase: "erasing",
				bytesProcessed: bytesWritten,
				totalBytes: totalBytesToWrite,
				percentComplete:
					totalBytesToWrite > 0
						? (bytesWritten / totalBytesToWrite) * 100
						: 100,
				message: `Erasing sector ${sectorIndex}`,
			});

			await connection.sendFrame(
				new Uint8Array([
					SID_ERASE_MEMORY,
					0x01,
					sectorAddrByte0,
					sectorAddrByte1,
					sectorAddrByte2,
					sectorSizeByte0,
					sectorSizeByte1,
					sectorSizeByte2,
				]),
			);

			// Emit SECTOR_ERASE_COMPLETE after erase command completes
			onEvent?.({
				type: "SECTOR_ERASE_COMPLETE",
				timestamp: Date.now(),
				data: { sectorIndex, sectorAddr },
			});

			// Step 3: Request download for this sector
			await connection.sendFrame(
				new Uint8Array([
					SID_REQUEST_DOWNLOAD,
					0x00, // format
					sectorAddrByte0,
					sectorAddrByte1,
					sectorAddrByte2, // addr
					sectorSizeByte0,
					sectorSizeByte1,
					sectorSizeByte2, // size
				]),
			);

			// Step 4: Transfer data blocks within this sector
			for (
				let blockInSector = 0;
				blockInSector < blocksPerSector;
				blockInSector++
			) {
				const block = sectorIndex * blocksPerSector + blockInSector;
				const blockData = rom.slice(
					block * BLOCK_SIZE,
					(block + 1) * BLOCK_SIZE,
				);

				const frame = new Uint8Array(2 + BLOCK_SIZE);
				frame[0] = SID_TRANSFER_DATA;
				frame[1] = (blockInSector + 1) & 0xff; // sequence number (resets per sector)
				frame.set(blockData, 2);

				await connection.sendFrame(frame);

				bytesWritten += BLOCK_SIZE;
				onProgress?.({
					phase: "writing",
					bytesProcessed: bytesWritten,
					totalBytes: totalBytesToWrite,
					percentComplete:
						totalBytesToWrite > 0
							? (bytesWritten / totalBytesToWrite) * 100
							: 100,
				});
			}

			// Step 5: Exit transfer for this sector
			await connection.sendFrame(new Uint8Array([SID_REQUEST_TRANSFER_EXIT]));
		}

		onProgress?.({
			phase: "verifying",
			bytesProcessed: ROM_SIZE,
			totalBytes: ROM_SIZE,
			percentComplete: 100,
		});
	}

	/**
	 * Get all supported SST parameters as OBD-style PID descriptors.
	 *
	 * Returns metadata for all 30+ SST (Subaru Select Monitor Transmission)
	 * parameters suitable for logging, CSV export, and live data visualization.
	 *
	 * Uses synthetic PID range 0x8000+ to avoid conflicts with standard OBD-II
	 * PIDs (0x00-0xFF), following the MUT-III pattern.
	 *
	 * NOTE: Real-time streaming via SSM/K-line is currently not implemented
	 * (blocked by lack of K-line transport support). This method provides the
	 * parameter catalog for when K-line streaming becomes available.
	 *
	 * @returns Promise resolving to array of PID descriptors for all SST parameters
	 *
	 * @example
	 * // Get all transmission parameters
	 * const pids = await subaruProtocol.getSupportedPids(connection);
	 * console.log(`Supported ${pids.length} transmission parameters`);
	 *
	 * @example
	 * // Use with live data logger
	 * for (const pid of pids) {
	 *   console.log(`${pid.name}: ${pid.unit}`);
	 * }
	 *
	 * @see SUBARU_EVOSCAN_FINDINGS.md — Phase 1 recommendation
	 * @see packages/device/protocols/mut3/src/index.ts — MUT-III pattern reference
	 */
	async getSupportedPids(
		_connection: DeviceConnection,
	): Promise<PidDescriptor[]> {
		const sstParams = getAllSstParameterPids();
		return sstParams.map((param) => ({
			pid: param.pid ?? 0,
			name: param.name,
			description: param.name,
			unit: param.unit,
			minValue: param.minValue ?? 0,
			maxValue: param.maxValue ?? 0,
		}));
	}

	private async enterProgrammingMode(
		connection: DeviceConnection,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		// Step 1: Start diagnostic session (programming mode 0x85)
		// Ref: HANDSHAKE_ANALYSIS.md — §5.2 programmingSession = 0x85
		// Ref: HANDSHAKE_ANALYSIS.md — §5.1 startDiagnosticSession = 0x10
		await connection.sendFrame(
			new Uint8Array([SID_START_DIAGNOSTIC_SESSION, 0x85]),
		);

		// Step 2: Security access — request seed (subfunction 0x01)
		// Ref: HANDSHAKE_ANALYSIS.md — §4.2 kwp_securityAccess(subfunction=0x01)
		// Ref: HANDSHAKE_ANALYSIS.md — §5.1 securityAccess = 0x27, requestSeed = 0x01
		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
		});

		const seedResponse = await connection.sendFrame(
			new Uint8Array([SID_SECURITY_ACCESS, 0x01]),
		);

		// Parse 2-byte seed from response (bytes after 0x67 0x01 header)
		// Ref: HANDSHAKE_ANALYSIS.md — §4.2 "Verify response length == 5 bytes"
		// Response format: [0x67, 0x01, seedHigh, seedLow, ...]
		const seed = seedResponse.slice(2, 4);

		// Step 3: Compute key from seed using S-box nibble-swap algorithm
		// Ref: HANDSHAKE_ANALYSIS.md — §4.3 densoecu::get_subaru_key (0x1509e)
		// Ref: HANDSHAKE_ANALYSIS.md — §4.5 transform_kernel_block02 (0x1510a)
		const key = computeSubaruKey(seed);

		// Step 4: Security access — send key (subfunction 0x02)
		// Ref: HANDSHAKE_ANALYSIS.md — §4.2 kwp_securityAccess(subfunction=0x02, key, key_len)
		// Ref: HANDSHAKE_ANALYSIS.md — §5.1 sendKey = 0x02
		const keyResponse = await connection.sendFrame(
			new Uint8Array([SID_SECURITY_ACCESS, 0x02, ...key]),
		);

		// Verify security access was granted (0x67 0x02 response)
		if (keyResponse[0] !== 0x67 || keyResponse[1] !== 0x02) {
			throw new Error(
				`Subaru security access failed: expected 0x67 0x02, got 0x${keyResponse[0]?.toString(16).toUpperCase()} 0x${keyResponse[1]?.toString(16).toUpperCase()}`,
			);
		}

		// Emit SECURITY_ACCESS_GRANTED after successful 0x67 0x02 response
		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
		});
	}
}

// Suppress unused-variable warnings for CAN ID and baud constants that are defined
// for documentation purposes and future use (e.g., filter configuration).
// Ref: HANDSHAKE_ANALYSIS.md — §4.4 subarucantool::ready_port (0x6df3a)
void TESTER_CAN_ID;
void ECU_CAN_ID;
void CAN_BAUD;
