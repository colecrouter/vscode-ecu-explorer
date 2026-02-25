import type {
	DeviceConnection,
	EcuEvent,
	EcuProtocol,
	RomProgress,
	WriteOptions,
} from "@ecu-explorer/device";
import { computeChangedSectors } from "@ecu-explorer/device";

import { UDS_NEGATIVE_RESPONSE, UDS_NRC, UDS_SERVICES } from "./services.js";

// Ref: ISO 14229-1 UDS standard
// Address and length format identifier: 1 byte length, 3 bytes address
const ADDRESS_AND_LENGTH_FORMAT = 0x14;

/**
 * Parses a UDS negative response and returns a human-readable error message.
 *
 * A UDS negative response has the format:
 *   [0x7F, <requestSID>, <NRC>]
 *
 * Ref: ISO 14229-1 §11.3 — NegativeResponse
 *
 * @param response - Raw response bytes from the ECU
 * @returns Human-readable error message describing the NRC
 */
export function parseNegativeResponse(response: Uint8Array): string {
	if (response.length < 3 || response[0] !== UDS_NEGATIVE_RESPONSE) {
		return `Invalid negative response: ${Array.from(response)
			.map((b) => `0x${b.toString(16).padStart(2, "0").toUpperCase()}`)
			.join(" ")}`;
	}

	const requestSid = response[1]!;
	const nrc = response[2]!;

	const nrcMessages: Record<number, string> = {
		[UDS_NRC.GENERAL_REJECT]: "General reject",
		[UDS_NRC.SERVICE_NOT_SUPPORTED]: "Service not supported",
		[UDS_NRC.SUB_FUNCTION_NOT_SUPPORTED]: "Sub-function not supported",
		[UDS_NRC.INCORRECT_MESSAGE_LENGTH]:
			"Incorrect message length or invalid format",
		[UDS_NRC.CONDITIONS_NOT_CORRECT]: "Conditions not correct",
		[UDS_NRC.REQUEST_SEQUENCE_ERROR]: "Request sequence error",
		[UDS_NRC.REQUEST_OUT_OF_RANGE]: "Request out of range",
		[UDS_NRC.SECURITY_ACCESS_DENIED]: "Security access denied",
		[UDS_NRC.INVALID_KEY]: "Invalid key",
		[UDS_NRC.EXCEEDED_NUMBER_OF_ATTEMPTS]: "Exceeded number of attempts",
		[UDS_NRC.REQUIRED_TIME_DELAY_NOT_EXPIRED]:
			"Required time delay not expired",
		[UDS_NRC.UPLOAD_DOWNLOAD_NOT_ACCEPTED]: "Upload/download not accepted",
		[UDS_NRC.TRANSFER_DATA_SUSPENDED]: "Transfer data suspended",
		[UDS_NRC.GENERAL_PROGRAMMING_FAILURE]: "General programming failure",
		[UDS_NRC.WRONG_BLOCK_SEQUENCE_COUNTER]: "Wrong block sequence counter",
		[UDS_NRC.RESPONSE_PENDING]: "Response pending",
		[UDS_NRC.SUB_FUNCTION_NOT_SUPPORTED_IN_ACTIVE_SESSION]:
			"Sub-function not supported in active session",
		[UDS_NRC.SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION]:
			"Service not supported in active session",
	};

	const nrcMessage =
		nrcMessages[nrc] ??
		`Unknown NRC (0x${nrc.toString(16).padStart(2, "0").toUpperCase()})`;
	const sidHex = `0x${requestSid.toString(16).padStart(2, "0").toUpperCase()}`;
	const nrcHex = `0x${nrc.toString(16).padStart(2, "0").toUpperCase()}`;

	return `UDS negative response for service ${sidHex}: ${nrcMessage} (NRC ${nrcHex})`;
}

/**
 * Generic UDS (ISO 14229) ECU protocol implementation.
 *
 * Provides a reusable base for UDS-based ROM read operations using
 * ReadMemoryByAddress (0x23) with extended diagnostic session and
 * security access handshake.
 *
 * Subclasses can override:
 * - `computeKey(seed)` — to provide ECU-specific security key derivation
 * - `ROM_START`, `ROM_SIZE`, `BLOCK_SIZE` — to adjust memory parameters
 * - `SESSION_TYPE` — to use a different diagnostic session type
 * - `SECURITY_ACCESS_LEVEL` — to use a different security access level
 *
 * Ref: ISO 14229-1 UDS standard
 */
export class UdsProtocol implements EcuProtocol {
	readonly name: string = "Generic UDS (ISO 14229)";

	/**
	 * ROM start address.
	 * Ref: ISO 14229-1 §11.12 — ReadMemoryByAddress
	 */
	protected readonly ROM_START: number = 0x000000;

	/**
	 * Total ROM size in bytes (default: 1 MB).
	 * Ref: ISO 14229-1 §11.12 — ReadMemoryByAddress
	 */
	protected readonly ROM_SIZE: number = 0x100000;

	/**
	 * Number of bytes to read per ReadMemoryByAddress request (default: 128).
	 * Ref: ISO 14229-1 §11.12 — ReadMemoryByAddress
	 */
	protected readonly BLOCK_SIZE: number = 0x80;

	/**
	 * Diagnostic session type to request (default: extended diagnostic = 0x03).
	 * Ref: ISO 14229-1 §9.2 — DiagnosticSessionControl
	 */
	protected readonly SESSION_TYPE: number = 0x03;

	/**
	 * Security access level to request (default: 0x01).
	 * Ref: ISO 14229-1 §9.4 — SecurityAccess
	 */
	protected readonly SECURITY_ACCESS_LEVEL: number = 0x01;

	/**
	 * Flash sector (erase block) size in bytes (default: 64 KB).
	 * Subclasses can override this to match the target ECU's flash geometry.
	 * Used by writeRom() when options.originalRom is provided to compute
	 * which sectors need to be erased and rewritten.
	 */
	protected readonly SECTOR_SIZE: number = 0x10000;

	/**
	 * Probe the connection to determine if this protocol can communicate
	 * with the connected ECU.
	 *
	 * The generic UDS protocol returns true for any connection, acting as
	 * a fallback for ECUs that speak standard UDS.
	 *
	 * @param _connection - Active device connection to probe (unused)
	 * @returns Always resolves to true
	 */
	async canHandle(_connection: DeviceConnection): Promise<boolean> {
		return true;
	}

	/**
	 * Compute the security access key from the seed.
	 *
	 * Default implementation XORs each seed byte with 0xFF as a stub.
	 * Subclasses should override this with the ECU-specific key derivation algorithm.
	 *
	 * Ref: ISO 14229-1 §9.4 — SecurityAccess seed/key mechanism
	 *
	 * @param seed - Seed bytes received from the ECU
	 * @returns Computed key bytes to send back to the ECU
	 */
	protected computeKey(seed: Uint8Array): Uint8Array {
		// Default stub: XOR each byte with 0xFF
		// Subclasses must override this with the actual ECU-specific algorithm
		const key = new Uint8Array(seed.length);
		for (let i = 0; i < seed.length; i++) {
			key[i] = (seed[i]! ^ 0xff) & 0xff;
		}
		return key;
	}

	/**
	 * Read the full ROM binary from the ECU using the generic UDS sequence.
	 *
	 * Sequence:
	 * 1. Extended Diagnostic Session: [0x10, SESSION_TYPE]
	 * 2. Security Access — request seed: [0x27, SECURITY_ACCESS_LEVEL]
	 * 3. Compute key from seed using computeKey()
	 * 4. Security Access — send key: [0x27, SECURITY_ACCESS_LEVEL + 1, ...key]
	 * 5. Read ROM in BLOCK_SIZE-byte blocks via ReadMemoryByAddress (0x23)
	 *    Frame format: [0x23, 0x14, addr[2], addr[1], addr[0], BLOCK_SIZE]
	 *
	 * Ref: ISO 14229-1 §9.2 DiagnosticSessionControl, §9.4 SecurityAccess,
	 *      §11.12 ReadMemoryByAddress
	 *
	 * @param connection - Active device connection
	 * @param onProgress - Optional progress callback invoked after each block read
	 * @param onEvent - Optional event callback for key milestones
	 * @returns Full ROM binary as Uint8Array
	 */
	async readRom(
		connection: DeviceConnection,
		onProgress?: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<Uint8Array> {
		await this.enterDiagnosticSession(connection, onEvent);

		// Step 5: Read ROM in BLOCK_SIZE-byte blocks
		// Ref: ISO 14229-1 §11.12 — ReadMemoryByAddress
		const rom = new Uint8Array(this.ROM_SIZE);
		const totalBlocks = this.ROM_SIZE / this.BLOCK_SIZE;

		for (let block = 0; block < totalBlocks; block++) {
			const addr = this.ROM_START + block * this.BLOCK_SIZE;

			// Address bytes in big-endian order (3 bytes for 24-bit address space)
			// Frame format: [0x23, 0x14, addr[2], addr[1], addr[0], BLOCK_SIZE]
			// 0x14 = ADDRESS_AND_LENGTH_FORMAT: 1 byte length, 3 bytes address
			const addrByte0 = (addr >> 16) & 0xff;
			const addrByte1 = (addr >> 8) & 0xff;
			const addrByte2 = addr & 0xff;

			const response = await connection.sendFrame(
				new Uint8Array([
					UDS_SERVICES.READ_MEMORY_BY_ADDRESS,
					ADDRESS_AND_LENGTH_FORMAT,
					addrByte0,
					addrByte1,
					addrByte2,
					this.BLOCK_SIZE,
				]),
			);

			// Skip first byte of response (0x63 positive response SID for ReadMemoryByAddress)
			const blockData = response.slice(1, 1 + this.BLOCK_SIZE);
			rom.set(blockData, block * this.BLOCK_SIZE);

			const bytesProcessed = (block + 1) * this.BLOCK_SIZE;
			onProgress?.({
				phase: "reading",
				bytesProcessed,
				totalBytes: this.ROM_SIZE,
				percentComplete: (bytesProcessed / this.ROM_SIZE) * 100,
			});
		}

		return rom;
	}

	/**
	 * Write a ROM binary to the ECU using the UDS RequestDownload/TransferData sequence.
	 *
	 * Sequence:
	 * 1. Enter diagnostic session (extended/programming)
	 * 2. Security access
	 * 3. Request download (0x34)
	 * 4. Transfer data (0x36)
	 * 5. Request transfer exit (0x37)
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
		if (rom.length !== this.ROM_SIZE) {
			throw new Error(
				`Invalid ROM size: expected ${this.ROM_SIZE} bytes, got ${rom.length}`,
			);
		}

		await this.enterDiagnosticSession(connection, onEvent);

		if (options?.dryRun) {
			onProgress?.({
				phase: "writing",
				bytesProcessed: this.ROM_SIZE,
				totalBytes: this.ROM_SIZE,
				percentComplete: 100,
			});
			return;
		}

		// Determine which sectors need to be erased and written.
		// When originalRom is provided, only changed sectors are processed.
		// When not provided, all sectors are processed (full flash — backward compatible).
		const sectorsToWrite = options?.originalRom
			? computeChangedSectors(options.originalRom, rom, this.SECTOR_SIZE)
			: Array.from({ length: this.ROM_SIZE / this.SECTOR_SIZE }, (_, i) => i);

		const blocksPerSector = this.SECTOR_SIZE / this.BLOCK_SIZE;
		let bytesWritten = 0;
		const totalBytesToWrite = sectorsToWrite.length * this.SECTOR_SIZE;

		for (const sectorIndex of sectorsToWrite) {
			const sectorAddr = this.ROM_START + sectorIndex * this.SECTOR_SIZE;

			const addrByte0 = (sectorAddr >> 16) & 0xff;
			const addrByte1 = (sectorAddr >> 8) & 0xff;
			const addrByte2 = sectorAddr & 0xff;

			const sizeByte0 = (this.SECTOR_SIZE >> 16) & 0xff;
			const sizeByte1 = (this.SECTOR_SIZE >> 8) & 0xff;
			const sizeByte2 = this.SECTOR_SIZE & 0xff;

			// Emit SECTOR_ERASE_STARTED before erasing this sector
			onEvent?.({
				type: "SECTOR_ERASE_STARTED",
				timestamp: Date.now(),
				data: { sectorIndex, sectorAddr },
			});

			// Step 3: Request download for this sector
			// Ref: ISO 14229-1 §11.4 — RequestDownload
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
					UDS_SERVICES.REQUEST_DOWNLOAD,
					0x00, // dataFormatIdentifier (no compression/encryption)
					ADDRESS_AND_LENGTH_FORMAT,
					addrByte0,
					addrByte1,
					addrByte2,
					sizeByte0,
					sizeByte1,
					sizeByte2,
				]),
			);

			// Emit SECTOR_ERASE_COMPLETE after the download request (erase phase)
			onEvent?.({
				type: "SECTOR_ERASE_COMPLETE",
				timestamp: Date.now(),
				data: { sectorIndex, sectorAddr },
			});

			// Step 4: Transfer data blocks within this sector
			// Ref: ISO 14229-1 §11.6 — TransferData
			for (
				let blockInSector = 0;
				blockInSector < blocksPerSector;
				blockInSector++
			) {
				const block = sectorIndex * blocksPerSector + blockInSector;
				const blockData = rom.slice(
					block * this.BLOCK_SIZE,
					(block + 1) * this.BLOCK_SIZE,
				);

				const frame = new Uint8Array(2 + this.BLOCK_SIZE);
				frame[0] = UDS_SERVICES.TRANSFER_DATA;
				frame[1] = (blockInSector + 1) & 0xff; // blockSequenceCounter (resets per sector)
				frame.set(blockData, 2);

				await connection.sendFrame(frame);

				bytesWritten += this.BLOCK_SIZE;
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

			// Step 5: Request transfer exit for this sector
			// Ref: ISO 14229-1 §11.7 — RequestTransferExit
			await connection.sendFrame(
				new Uint8Array([UDS_SERVICES.REQUEST_TRANSFER_EXIT]),
			);
		}

		onProgress?.({
			phase: "verifying",
			bytesProcessed: this.ROM_SIZE,
			totalBytes: this.ROM_SIZE,
			percentComplete: 100,
		});
	}

	private async enterDiagnosticSession(
		connection: DeviceConnection,
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		// Step 1: Extended Diagnostic Session
		// Ref: ISO 14229-1 §9.2 — DiagnosticSessionControl
		await connection.sendFrame(
			new Uint8Array([
				UDS_SERVICES.DIAGNOSTIC_SESSION_CONTROL,
				this.SESSION_TYPE,
			]),
		);

		// Emit BOOT_MODE_ENTERED after diagnostic session is established
		onEvent?.({
			type: "BOOT_MODE_ENTERED",
			timestamp: Date.now(),
			data: { sessionType: this.SESSION_TYPE },
		});

		// Step 2: Security Access — request seed
		// Ref: ISO 14229-1 §9.4 — SecurityAccess requestSeed subfunction
		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
			data: { level: this.SECURITY_ACCESS_LEVEL },
		});

		let seedResponse: Uint8Array;
		try {
			seedResponse = await connection.sendFrame(
				new Uint8Array([
					UDS_SERVICES.SECURITY_ACCESS,
					this.SECURITY_ACCESS_LEVEL,
				]),
			);
		} catch (err) {
			onEvent?.({
				type: "SECURITY_ACCESS_DENIED",
				timestamp: Date.now(),
				data: { error: err instanceof Error ? err.message : String(err) },
			});
			throw err;
		}

		// Check for negative response
		if (seedResponse[0] === UDS_NEGATIVE_RESPONSE) {
			const errorMsg = parseNegativeResponse(seedResponse);
			onEvent?.({
				type: "SECURITY_ACCESS_DENIED",
				timestamp: Date.now(),
				data: { error: errorMsg },
			});
			throw new Error(errorMsg);
		}

		// Parse seed from response (bytes after the 2-byte header [0x67, level])
		// Response format: [0x67, SECURITY_ACCESS_LEVEL, seed...]
		const seed = seedResponse.slice(2);

		// Step 3: Compute key from seed
		const key = this.computeKey(seed);

		// Step 4: Security Access — send key (subfunction = level + 1)
		// Ref: ISO 14229-1 §9.4 — SecurityAccess sendKey subfunction
		let keyResponse: Uint8Array;
		try {
			keyResponse = await connection.sendFrame(
				new Uint8Array([
					UDS_SERVICES.SECURITY_ACCESS,
					this.SECURITY_ACCESS_LEVEL + 1,
					...key,
				]),
			);
		} catch (err) {
			onEvent?.({
				type: "SECURITY_ACCESS_DENIED",
				timestamp: Date.now(),
				data: { error: err instanceof Error ? err.message : String(err) },
			});
			throw err;
		}

		// Check for negative response on key send
		if (keyResponse[0] === UDS_NEGATIVE_RESPONSE) {
			const errorMsg = parseNegativeResponse(keyResponse);
			onEvent?.({
				type: "SECURITY_ACCESS_DENIED",
				timestamp: Date.now(),
				data: { error: errorMsg },
			});
			throw new Error(errorMsg);
		}

		// Emit SECURITY_ACCESS_GRANTED after successful key verification
		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
			data: { level: this.SECURITY_ACCESS_LEVEL },
		});
	}
}

export * from "./services.js";
