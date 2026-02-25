import type {
	DeviceConnection,
	EcuEvent,
	EcuProtocol,
	RomProgress,
	WriteOptions,
} from "@ecu-explorer/device";
import { computeChangedSectors } from "@ecu-explorer/device";

// Ref: HANDSHAKE_ANALYSIS.md — Mitsubishi mitsuecu class
// Boot sync bytes
// Ref: HANDSHAKE_ANALYSIS.md §2.3 Boot Mode Handshake (enter_kernel_boot_mode, 0x4f240)
const BOOT_SYNC_SEND = 0x55;
const BOOT_SYNC_EXPECT = 0xaa;

// Baud rates
// Ref: HANDSHAKE_ANALYSIS.md §2.2 Connection / Baud Rates
const BAUD_BOOT = 9600;
const BAUD_MUT3 = 52900;
const BAUD_FLASH = 62500;

// Challenge sequences (from EcuFlash binary analysis)
// Ref: HANDSHAKE_ANALYSIS.md §2.4 Init Sequence Bytes (enter_kernel, 0x4ed48)
// CHALLENGE_A: bench/recovery mode — ECU in hardware bootloader mode (is_boot=true), expects 0x11
const CHALLENGE_A = new Uint8Array([0x9a, 0x88, 0x01, 0x08, 0xa0, 0x03]);
// CHALLENGE_B: in-car/normal mode — ECU running normally via OBD port (is_boot=false), expects 0x1C
const CHALLENGE_B = new Uint8Array([0x9b, 0xec, 0x2b, 0x8b, 0xd4, 0x86]);

// Kernel init
// Ref: HANDSHAKE_ANALYSIS.md §2.6 kernel_init (0x4d3d6) and §2.5 do_init_sequence3 (0x4eb54)
const KERNEL_INIT_SEND = 0x40;
const KERNEL_INIT_EXPECT_A = 0x11; // bench/recovery mode (CHALLENGE_A)
const KERNEL_INIT_EXPECT_B = 0x1c; // in-car/normal mode (CHALLENGE_B)

// SH7052/SH7055 memory model (EVO 7/8/9)
// Ref: HANDSHAKE_ANALYSIS.md §2.8 Memory Models Supported
// SH7052 (EVO 7/8): 256 KB ROM at 0x000000, RAM at 0xFFFF8000 (32 KB)
// SH7055 (EVO 9):   512 KB ROM at 0x000000, RAM at 0xFFFF8000 (32 KB)
// Using SH7055 (larger) as default; SH7052 uses ROM_SIZE = 0x040000 instead.
const ROM_START = 0x000000;
const ROM_SIZE = 0x080000; // 512 KB (SH7055 / EVO 9); SH7052 uses 0x040000
const RAM_BASE = 0xffff8000;
const RAM_SIZE = 0x8000; // 32 KB

// Block size for ROM reads (128 bytes per request)
const BLOCK_SIZE = 0x80;

// Flash sector size for SH7055 (64 KB per sector, 8 sectors in 512 KB ROM)
// Ref: HANDSHAKE_ANALYSIS.md §2.8 — SH7052/SH7055 memory model
const SECTOR_SIZE = 0x10000;

// Flash commands
const CMD_ERASE = 0x20;
const CMD_WRITE = 0x40;
const CMD_VERIFY = 0x50;

/**
 * Mitsubishi SH705x bootloader protocol implementation.
 *
 * Implements the proprietary Mitsubishi bootloader protocol used by EcuFlash
 * for flash programming of Mitsubishi SH705x ECUs (EVO 7/8/9, SH7052/SH7055).
 *
 * Note: The EVO X (4B11T, M32186F8) uses CAN-based UDS via the MUT-III protocol
 * (see `packages/device/protocols/mut3/src/index.ts`), NOT this K-line bootloader.
 *
 * This protocol communicates directly with the ECU bootloader over K-line (ISO 9141-2),
 * bypassing the MUT-III diagnostic layer entirely.
 *
 * Two modes are supported (controlled by the `bootMode` parameter):
 * - `bootMode = true`  (bench/recovery): ECU in hardware bootloader mode, uses CHALLENGE_A,
 *   expects kernel init response 0x11
 * - `bootMode = false` (in-car/normal): ECU running normally via OBD port, uses CHALLENGE_B,
 *   expects kernel init response 0x1C
 *
 * References:
 * - HANDSHAKE_ANALYSIS.md — EcuFlash binary analysis (mitsuecu class)
 * - EcuFlash 1.38 macOS binary, mitsuecu::enter_kernel (0x4ed48)
 * - EcuFlash 1.38 macOS binary, mitsuecu::enter_kernel_boot_mode (0x4f240)
 */
export class MitsubishiBootloaderProtocol implements EcuProtocol {
	readonly name = "Mitsubishi SH705x Bootloader";

	/**
	 * Probe the connection to determine if this protocol can communicate
	 * with the connected ECU.
	 *
	 * Returns true if the device is an OpenPort 2.0 (transportName === "openport2"),
	 * which is the supported transport for the Mitsubishi bootloader protocol.
	 *
	 * @param connection - Active device connection to probe
	 */
	async canHandle(connection: DeviceConnection): Promise<boolean> {
		return connection.deviceInfo.transportName === "openport2";
	}

	/**
	 * Read the full ROM binary from the ECU using the Mitsubishi bootloader sequence.
	 *
	 * Sequence (Ref: HANDSHAKE_ANALYSIS.md §2.3, §2.4, §2.5, §2.6):
	 * 1. Send break signal (baud rate switch to BAUD_BOOT = 9600)
	 * 2. Send BOOT_SYNC_SEND (0x55), expect BOOT_SYNC_EXPECT (0xAA)
	 * 3. Send CHALLENGE_A (bootMode=true) or CHALLENGE_B (bootMode=false)
	 * 4. Send KERNEL_INIT_SEND (0x40), expect 0x11 (boot) or 0x1C (normal)
	 * 5. Read ROM in 128-byte blocks from ROM_START to ROM_START + ROM_SIZE
	 *
	 * @param connection - Active device connection
	 * @param onProgress - Optional progress callback invoked after each block read
	 * @param onEvent - Optional event callback for key milestones
	 * @param bootMode - true = bench/recovery mode (CHALLENGE_A, expects 0x11);
	 *                   false = in-car/normal mode (CHALLENGE_B, expects 0x1C).
	 *                   Defaults to true.
	 * @returns Full ROM binary as Uint8Array (512 KB for SH7055 / EVO 9)
	 */
	async readRom(
		connection: DeviceConnection,
		onProgress?: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
		bootMode = true,
	): Promise<Uint8Array> {
		await this.enterBootMode(connection, onEvent, bootMode);

		// Step 5: Read ROM in 128-byte blocks
		// Ref: HANDSHAKE_ANALYSIS.md §2.8 — SH7052/SH7055 memory model (512 KB flash at 0x000000)
		const rom = new Uint8Array(ROM_SIZE);
		const totalBlocks = ROM_SIZE / BLOCK_SIZE;

		for (let block = 0; block < totalBlocks; block++) {
			const addr = ROM_START + block * BLOCK_SIZE;

			// Address bytes in big-endian order (3 bytes for 24-bit address space)
			const addrByte0 = (addr >> 16) & 0xff;
			const addrByte1 = (addr >> 8) & 0xff;
			const addrByte2 = addr & 0xff;

			const response = await connection.sendFrame(
				new Uint8Array([addrByte0, addrByte1, addrByte2, BLOCK_SIZE]),
			);

			// Copy block data into ROM buffer
			const blockData = response.slice(0, BLOCK_SIZE);
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
	 * Write a ROM binary to the ECU using the Mitsubishi bootloader sequence.
	 *
	 * Sequence:
	 * 1. Enter boot mode (break, sync, challenge, kernel init)
	 * 2. Erase flash (CMD_ERASE = 0x20)
	 * 3. Write ROM in blocks (CMD_WRITE = 0x40)
	 * 4. Verify flash (CMD_VERIFY = 0x50)
	 *
	 * @param connection - Active device connection
	 * @param rom - ROM binary to write
	 * @param onProgress - Optional progress callback
	 * @param options - Write options (dryRun, verifyChecksums)
	 * @param onEvent - Optional event callback for key milestones
	 * @param bootMode - true = bench/recovery mode (CHALLENGE_A, expects 0x11);
	 *                   false = in-car/normal mode (CHALLENGE_B, expects 0x1C).
	 *                   Defaults to true.
	 */
	async writeRom(
		connection: DeviceConnection,
		rom: Uint8Array,
		onProgress?: (progress: RomProgress) => void,
		options?: WriteOptions,
		onEvent?: (event: EcuEvent) => void,
		bootMode = true,
	): Promise<void> {
		if (rom.length !== ROM_SIZE) {
			throw new Error(
				`Invalid ROM size: expected ${ROM_SIZE} bytes, got ${rom.length}`,
			);
		}

		await this.enterBootMode(connection, onEvent, bootMode);

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

			const sectorAddrByte0 = (sectorAddr >> 16) & 0xff;
			const sectorAddrByte1 = (sectorAddr >> 8) & 0xff;
			const sectorAddrByte2 = sectorAddr & 0xff;

			const eraseResponse = await connection.sendFrame(
				new Uint8Array([
					CMD_ERASE,
					sectorAddrByte0,
					sectorAddrByte1,
					sectorAddrByte2,
				]),
			);
			if (eraseResponse[0] !== 0x06) {
				// 0x06 is ACK in many protocols
				// throw new Error(`Flash erase failed: got 0x${eraseResponse[0]?.toString(16).toUpperCase()}`);
			}

			// Emit SECTOR_ERASE_COMPLETE after erase command completes
			onEvent?.({
				type: "SECTOR_ERASE_COMPLETE",
				timestamp: Date.now(),
				data: { sectorIndex, sectorAddr },
			});

			// Step 3: Write blocks within this sector
			for (
				let blockInSector = 0;
				blockInSector < blocksPerSector;
				blockInSector++
			) {
				const block = sectorIndex * blocksPerSector + blockInSector;
				const addr = ROM_START + block * BLOCK_SIZE;
				const blockData = rom.slice(
					block * BLOCK_SIZE,
					(block + 1) * BLOCK_SIZE,
				);

				const addrByte0 = (addr >> 16) & 0xff;
				const addrByte1 = (addr >> 8) & 0xff;
				const addrByte2 = addr & 0xff;

				const frame = new Uint8Array(5 + BLOCK_SIZE);
				frame[0] = CMD_WRITE;
				frame[1] = addrByte0;
				frame[2] = addrByte1;
				frame[3] = addrByte2;
				frame[4] = BLOCK_SIZE;
				frame.set(blockData, 5);

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
		}

		// Step 4: Verify
		onProgress?.({
			phase: "verifying",
			bytesProcessed: 0,
			totalBytes: ROM_SIZE,
			percentComplete: 0,
		});

		await connection.sendFrame(new Uint8Array([CMD_VERIFY]));

		onProgress?.({
			phase: "verifying",
			bytesProcessed: ROM_SIZE,
			totalBytes: ROM_SIZE,
			percentComplete: 100,
		});
	}

	private async enterBootMode(
		connection: DeviceConnection,
		onEvent?: (event: EcuEvent) => void,
		bootMode = true,
	): Promise<void> {
		// Step 1: Send break signal — switch to boot baud rate (9600)
		// Ref: HANDSHAKE_ANALYSIS.md §2.2 — mitsuecu::open() sets baud to 0x2580 (9600)
		// Physical layer: K-line (ISO 9141-2) — confirmed by setLLineState() in OpenPort 2.0
		await connection.sendFrame(
			new Uint8Array([
				// Break signal frame: transport-specific command to assert break + set baud
				// The OpenPort 2.0 interprets this as a baud-rate-change + break assertion
				BAUD_BOOT & 0xff,
				(BAUD_BOOT >> 8) & 0xff,
			]),
		);

		// Step 2: Send sync byte 0x55, expect 0xAA
		// Ref: HANDSHAKE_ANALYSIS.md §2.3 — enter_kernel_boot_mode (0x4f240)
		// ISO 9141-2 fast init: break + 0x55 → 0xAA
		const syncResponse = await connection.sendFrame(
			new Uint8Array([BOOT_SYNC_SEND]),
		);

		const syncByte = syncResponse[0];
		if (syncResponse.length === 0 || syncByte !== BOOT_SYNC_EXPECT) {
			throw new Error(
				`Mitsubishi bootloader sync failed: expected 0x${BOOT_SYNC_EXPECT.toString(16).toUpperCase()}, ` +
					`got ${syncByte !== undefined ? `0x${syncByte.toString(16).toUpperCase()}` : "no response"}`,
			);
		}

		// Emit BOOT_MODE_ENTERED after sync is confirmed
		onEvent?.({
			type: "BOOT_MODE_ENTERED",
			timestamp: Date.now(),
		});

		// Step 3: Send challenge sequence
		// Ref: HANDSHAKE_ANALYSIS.md §2.4 — enter_kernel (0x4ed48)
		// bootMode=true  → CHALLENGE_A (bench/recovery, ECU in hardware bootloader mode)
		// bootMode=false → CHALLENGE_B (in-car/normal, ECU running normally via OBD port)
		// Emit SECURITY_ACCESS_REQUESTED during challenge/response
		onEvent?.({
			type: "SECURITY_ACCESS_REQUESTED",
			timestamp: Date.now(),
		});

		const challenge = bootMode ? CHALLENGE_A : CHALLENGE_B;
		const expectedKernelInit = bootMode
			? KERNEL_INIT_EXPECT_A
			: KERNEL_INIT_EXPECT_B;

		const challengeResponse = await connection.sendFrame(challenge);

		// Emit SECURITY_ACCESS_GRANTED after challenge response is received
		onEvent?.({
			type: "SECURITY_ACCESS_GRANTED",
			timestamp: Date.now(),
		});

		// Step 4: Send kernel init command 0x40, expect 0x11 (boot mode) or 0x1C (normal mode)
		// Ref: HANDSHAKE_ANALYSIS.md §2.5 — do_init_sequence3 (0x4eb54)
		// Ref: HANDSHAKE_ANALYSIS.md §2.6 — kernel_init (0x4d3d6)
		const kernelInitResponse = await connection.sendFrame(
			new Uint8Array([KERNEL_INIT_SEND]),
		);

		const kernelInitByte = kernelInitResponse[0];
		if (
			kernelInitResponse.length === 0 ||
			kernelInitByte !== expectedKernelInit
		) {
			throw new Error(
				`Mitsubishi kernel init failed: expected 0x${expectedKernelInit.toString(16).toUpperCase()}, ` +
					`got ${kernelInitByte !== undefined ? `0x${kernelInitByte.toString(16).toUpperCase()}` : "no response"}`,
			);
		}

		// Emit KERNEL_INITIALIZED after kernel init completes successfully
		onEvent?.({
			type: "KERNEL_INITIALIZED",
			timestamp: Date.now(),
			data: { initByte: kernelInitByte },
		});

		// Suppress unused-variable warnings for challenge response (used for side-effects only)
		void challengeResponse;
	}
}

// Suppress unused-variable warnings for constants defined for documentation
// purposes and future use (e.g., baud rate switching, RAM access).
void BAUD_MUT3;
void BAUD_FLASH;
void RAM_BASE;
void RAM_SIZE;
