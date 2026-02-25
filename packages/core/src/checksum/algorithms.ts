/**
 * Checksum algorithms for ROM validation
 *
 * This module provides standard checksum algorithms used for ROM file validation:
 * - CRC32: Standard CRC32 algorithm with lookup table
 * - Sum: Simple byte sum with u8 wrapping
 * - XOR: XOR all bytes together
 * - Mitsucan: Mitsubishi ECU ROM checksum (32-bit BE word sum fixup)
 * - SubaruDenso: Subaru/Denso ECU ROM checksum (table-driven 32-bit BE word sum)
 * - SSM: Subaru Select Monitor protocol packet checksum (16-bit sum mod 65536)
 * - NissanStd/Alt: Nissan ROM checksum (32-bit sum + XOR, big-endian DWORD iteration)
 * - NissanAlt2: Extended Nissan ROM checksum (4 values: 32-bit sum, XOR, 16-bit cal, 16-bit code)
 * - NCS: Nissan Communication System K-line packet checksum (8-bit sum)
 * - NcsCrc16: Nissan CRC-16 (CRC-16/IBM-SDLC without final XOR, poly=0x8408, init=0xFFFF)
 */

/**
 * CRC32 lookup table for polynomial 0xEDB88320 (reversed 0x04C11DB7)
 * Pre-computed for performance
 */
const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let crc = i;
		for (let j = 0; j < 8; j++) {
			crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
		table[i] = crc >>> 0;
	}
	return table;
})();

/**
 * Calculate CRC32 checksum of data
 *
 * Uses the standard CRC32 algorithm with polynomial 0xEDB88320 (reversed 0x04C11DB7).
 * This is the same algorithm used by ZIP, PNG, and Ethernet.
 *
 * @param data - Data to checksum
 * @returns CRC32 checksum as unsigned 32-bit integer
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode("123456789");
 * const checksum = crc32(data);
 * console.log(checksum.toString(16)); // "cbf43926"
 * ```
 */
export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;

	for (let i = 0; i < data.length; i++) {
		const byte = data[i];
		if (byte === undefined)
			throw new Error(`Expected data[${i}] to be defined`);
		const tableVal = CRC32_TABLE[(crc ^ byte) & 0xff];
		if (tableVal === undefined) throw new Error("CRC32_TABLE lookup failed");
		crc = (crc >>> 8) ^ tableVal;
	}

	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Calculate sum checksum of data
 *
 * Sums all bytes together with wrapping at 8-bit boundaries (u8 wrapping).
 * This is a simple checksum used by some ROM formats.
 *
 * @param data - Data to checksum
 * @returns Sum checksum as unsigned 8-bit integer (0-255)
 *
 * @example
 * ```typescript
 * const data = new Uint8Array([0x01, 0x02, 0x03]);
 * const checksum = sumChecksum(data); // 6
 * ```
 *
 * @example
 * ```typescript
 * // Wrapping example
 * const data = new Uint8Array([0xFF, 0x02]);
 * const checksum = sumChecksum(data); // 1 (wraps at 256)
 * ```
 */
export function sumChecksum(data: Uint8Array): number {
	let sum = 0;

	for (let i = 0; i < data.length; i++) {
		const byte = data[i];
		if (byte === undefined)
			throw new Error(`Expected data[${i}] to be defined`);
		sum = (sum + byte) & 0xff;
	}

	return sum >>> 0;
}

/**
 * Calculate XOR checksum of data
 *
 * XORs all bytes together. This is a simple checksum used by some ROM formats.
 *
 * @param data - Data to checksum
 * @returns XOR checksum as unsigned 8-bit integer (0-255)
 *
 * @example
 * ```typescript
 * const data = new Uint8Array([0x01, 0x02, 0x03]);
 * const checksum = xorChecksum(data); // 0 (1 ^ 2 ^ 3 = 0)
 * ```
 *
 * @example
 * ```typescript
 * const data = new Uint8Array([0xFF, 0xAA]);
 * const checksum = xorChecksum(data); // 0x55
 * ```
 */
export function xorChecksum(data: Uint8Array): number {
	let xor = 0;

	for (let i = 0; i < data.length; i++) {
		xor ^= data[i] ?? NaN;
	}

	return xor >>> 0;
}

/**
 * Computes the mitsucan checksum fixup value for Mitsubishi ECU ROMs.
 *
 * The algorithm sums the entire ROM as 32-bit big-endian words and computes
 * the 4-byte fixup value (stored big-endian at 0x0BFFF0) needed to make the
 * total sum equal 0x5AA55AA5.
 *
 * Confirmed by analysis of two real Mitsubishi Evo X ROMs:
 * - ROM 56890009 (stock): fixup = 0xFFFFFFFF (BE)
 * - ROM 56890313 (EcuFlash-processed): fixup = 0xAC086724 (BE)
 *
 * See MITSUCAN_ALGORITHM_FINDINGS.md for full reverse-engineering details.
 *
 * @param data - The ROM buffer (must be exactly 0x100000 bytes, 32-bit aligned)
 * @returns The 32-bit fixup value (to be stored big-endian at 0x0BFFF0)
 * @throws Error if ROM is too small or not 32-bit aligned
 *
 * @example
 * ```typescript
 * const rom = new Uint8Array(0x100000); // 1MB all-zero ROM
 * const fixup = mitsucanChecksum(rom);
 * console.log(fixup.toString(16)); // "5aa55aa5" (for all-zero ROM)
 * ```
 */
export function mitsucanChecksum(data: Uint8Array): number {
	const FIXUP_OFFSET = 0x0bfff0;
	const TARGET = 0x5aa55aa5;

	if (data.length < FIXUP_OFFSET + 4) {
		throw new Error(
			`ROM too small for mitsucan checksum: expected at least ${FIXUP_OFFSET + 4} bytes, got ${data.length}`,
		);
	}
	if (data.length % 4 !== 0) {
		throw new Error(
			`ROM size must be 32-bit aligned for mitsucan checksum: got ${data.length} bytes`,
		);
	}

	// Sum all 32-bit big-endian words, treating the fixup location as 0x00000000
	let sum = 0;
	for (let i = 0; i < data.length; i += 4) {
		if (i === FIXUP_OFFSET) {
			// Skip the fixup location (treat as zero)
			continue;
		}
		const word =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;
		sum = (sum + word) >>> 0;
	}

	// Compute the fixup value needed to reach the target
	return (TARGET - sum) >>> 0;
}

/**
 * Validates the mitsucan checksum of a Mitsubishi ECU ROM.
 *
 * Sums the entire ROM as 32-bit big-endian words (including the fixup at 0x0BFFF0)
 * and verifies the total equals 0x5AA55AA5.
 *
 * @param data - The ROM buffer
 * @returns true if the checksum is valid, false otherwise
 *
 * @example
 * ```typescript
 * const rom = new Uint8Array(0x100000);
 * const fixup = mitsucanChecksum(rom);
 * // Write fixup big-endian at 0x0BFFF0
 * rom[0x0BFFF0] = (fixup >>> 24) & 0xFF;
 * rom[0x0BFFF1] = (fixup >>> 16) & 0xFF;
 * rom[0x0BFFF2] = (fixup >>> 8) & 0xFF;
 * rom[0x0BFFF3] = fixup & 0xFF;
 * console.log(validateMitsucanChecksum(rom)); // true
 * ```
 */
export function validateMitsucanChecksum(data: Uint8Array): boolean {
	const FIXUP_OFFSET = 0x0bfff0;
	const TARGET = 0x5aa55aa5;

	if (data.length < FIXUP_OFFSET + 4 || data.length % 4 !== 0) {
		return false;
	}

	let sum = 0;
	for (let i = 0; i < data.length; i += 4) {
		const word =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;
		sum = (sum + word) >>> 0;
	}

	return sum === TARGET;
}

// ============================================================================
// Subaru/Denso ROM Checksum
//
// Subaru ECUs manufactured by Denso store a checksum table directly inside the
// ROM image. The table contains one or more 12-byte entries, each describing a
// region of the ROM and the expected checksum for that region. When the ECU
// boots, it reads this table and verifies each region. If any checksum fails,
// the ECU may refuse to run or enter a failsafe mode.
//
// The algorithm sums all 32-bit big-endian words in each region and computes
// the value that, when added to that sum, equals CHECK_TOTAL (0x5AA5A55A).
//
// Invariant: Σ word32_BE(region) + checksum ≡ CHECK_TOTAL (mod 2^32)
//
// In RomRaider, the checksum table is exposed as a special table named
// "Checksum Fix" in the ROM definition XML. The table's storageAddress and
// dataSize attributes specify where the 12-byte entries are located in the ROM.
//
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/Settings.java
//
// See also: SUBARU_CHECKSUM_ANALYSIS.md for full algorithm documentation.
// ============================================================================

/**
 * The magic target constant used by Subaru/Denso ECU ROM checksums.
 *
 * Defined in RomRaider `Settings.java` as `CHECK_TOTAL = 0x5AA5A55A`.
 *
 * The checksum invariant is:
 * ```
 * Σ word32_BE(region) + checksum ≡ CHECK_TOTAL (mod 2^32)
 * ```
 *
 * The alternating `5A`/`A5` byte pattern (`0101 1010` / `1010 0101`) is a
 * common choice for magic constants because it has good bit distribution and
 * is easy to recognize in a hex dump.
 *
 * **Note**: This is distinct from the Mitsubishi target (`0x5AA55AA5`) — the
 * middle two bytes are swapped:
 * - Subaru/Denso: `0x5AA5A55A` → bytes `5A A5 A5 5A`
 * - Mitsubishi:   `0x5AA55AA5` → bytes `5A A5 5A A5`
 *
 * @see https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/Settings.java
 * @see SUBARU_CHECKSUM_ANALYSIS.md
 */
export const SUBARU_DENSO_CHECK_TOTAL = 0x5aa5a55a;

/**
 * A single entry in a Subaru/Denso ROM checksum table.
 *
 * Each entry occupies exactly **12 bytes** in the ROM, stored big-endian:
 * ```
 * Offset  Size  Field      Description
 * ------  ----  ---------  ------------------------------------------
 * +0      4     startAddr  Start of the ROM region (inclusive, u32 BE)
 * +4      4     endAddr    End of the ROM region (exclusive, u32 BE)
 * +8      4     checksum   Stored checksum value (u32 BE)
 * ```
 *
 * A special **sentinel entry** signals that all checksums are disabled:
 * ```
 * startAddr = 0x00000000
 * endAddr   = 0x00000000
 * checksum  = CHECK_TOTAL (0x5AA5A55A)
 * ```
 * When the first entry is a sentinel, `validateSubaruDensoChecksums()` returns
 * `-1` (all checksums disabled).
 *
 * @see https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 */
export interface SubaruDensoChecksumEntry {
	/** Start address of the region (inclusive, ROM-relative) */
	startAddr: number;
	/** End address of the region (exclusive, ROM-relative) */
	endAddr: number;
	/** Stored checksum value: `(CHECK_TOTAL - Σ words) mod 2^32` */
	checksum: number;
}

/**
 * Reads the Subaru/Denso ROM checksum table from a ROM buffer.
 *
 * The checksum table is a contiguous array of 12-byte entries stored at
 * `tableOffset` in the ROM. Each entry contains:
 * - 4 bytes: start address (big-endian u32)
 * - 4 bytes: end address (big-endian u32, exclusive)
 * - 4 bytes: stored checksum (big-endian u32)
 *
 * Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 *
 * @param data         - The full ROM buffer
 * @param tableOffset  - Byte offset of the checksum table in the ROM
 * @param tableSize    - Total byte size of the checksum table (must be a multiple of 12)
 * @returns Array of checksum table entries
 * @throws Error if tableOffset/tableSize are out of bounds or not aligned
 *
 * @example
 * ```typescript
 * // Read a 4-entry checksum table at offset 0x7FFF0
 * const entries = readSubaruDensoChecksumTable(rom, 0x7FFF0, 48);
 * ```
 */
export function readSubaruDensoChecksumTable(
	data: Uint8Array,
	tableOffset: number,
	tableSize: number,
): SubaruDensoChecksumEntry[] {
	if (tableSize % 12 !== 0) {
		throw new Error(
			`Subaru/Denso checksum table size must be a multiple of 12 bytes, got ${tableSize}`,
		);
	}
	if (tableOffset < 0 || tableOffset + tableSize > data.length) {
		throw new Error(
			`Subaru/Denso checksum table out of bounds: offset=${tableOffset}, size=${tableSize}, ROM length=${data.length}`,
		);
	}

	const entries: SubaruDensoChecksumEntry[] = [];
	const count = tableSize / 12;

	for (let i = 0; i < count; i++) {
		const base = tableOffset + i * 12;
		const startAddr =
			(((data[base] ?? 0) << 24) |
				((data[base + 1] ?? 0) << 16) |
				((data[base + 2] ?? 0) << 8) |
				(data[base + 3] ?? 0)) >>>
			0;
		const endAddr =
			(((data[base + 4] ?? 0) << 24) |
				((data[base + 5] ?? 0) << 16) |
				((data[base + 6] ?? 0) << 8) |
				(data[base + 7] ?? 0)) >>>
			0;
		const checksum =
			(((data[base + 8] ?? 0) << 24) |
				((data[base + 9] ?? 0) << 16) |
				((data[base + 10] ?? 0) << 8) |
				(data[base + 11] ?? 0)) >>>
			0;
		entries.push({ startAddr, endAddr, checksum });
	}

	return entries;
}

/**
 * Computes the Subaru/Denso ROM checksum for a single address region.
 *
 * Sums all 32-bit big-endian words in `[startAddr, endAddr)` and returns
 * the value that, when added to that sum, equals `CHECK_TOTAL` (0x5AA5A55A).
 *
 * This is a direct port of `RomChecksum.calculateChecksum()` from RomRaider:
 * ```java
 * int byteSum = 0;
 * for (int i = startAddr; i < endAddr; i += 4) {
 *     byteSum += (int)parseByteValue(input, BIG, i, 4, true);
 * }
 * return CHECK_TOTAL - byteSum;
 * ```
 *
 * Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 *
 * @param data      - The full ROM buffer
 * @param startAddr - Start address of the region (inclusive, must be 4-byte aligned)
 * @param endAddr   - End address of the region (exclusive, must be 4-byte aligned)
 * @returns The 32-bit checksum value to store at the table entry
 * @throws Error if addresses are out of bounds or not 4-byte aligned
 *
 * @example
 * ```typescript
 * // Compute checksum for region 0x0000–0x7FF0
 * const checksum = computeSubaruDensoChecksum(rom, 0x0000, 0x7FF0);
 * ```
 */
export function computeSubaruDensoChecksum(
	data: Uint8Array,
	startAddr: number,
	endAddr: number,
): number {
	if (startAddr % 4 !== 0 || endAddr % 4 !== 0) {
		throw new Error(
			`Subaru/Denso checksum addresses must be 4-byte aligned: startAddr=${startAddr}, endAddr=${endAddr}`,
		);
	}
	if (startAddr < 0 || endAddr > data.length || startAddr >= endAddr) {
		throw new Error(
			`Subaru/Denso checksum region out of bounds or empty: startAddr=${startAddr}, endAddr=${endAddr}, ROM length=${data.length}`,
		);
	}

	let byteSum = 0;
	for (let i = startAddr; i < endAddr; i += 4) {
		const word =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;
		byteSum = (byteSum + word) >>> 0;
	}

	return (SUBARU_DENSO_CHECK_TOTAL - byteSum) >>> 0;
}

/**
 * Validates the Subaru/Denso ROM checksum for a single address region.
 *
 * Checks that `CHECK_TOTAL - storedChecksum - byteSum == 0`, i.e. that the
 * stored checksum is correct for the given region.
 *
 * This is a direct port of `RomChecksum.validateChecksum()` from RomRaider:
 * ```java
 * int byteSum = 0;
 * for (int i = startAddr; i < endAddr; i += 4) {
 *     byteSum += (int)parseByteValue(input, BIG, i, 4, true);
 * }
 * int result = (CHECK_TOTAL - diff - byteSum);
 * return result; // 0 means valid
 * ```
 *
 * Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 *
 * @param data           - The full ROM buffer
 * @param startAddr      - Start address of the region (inclusive)
 * @param endAddr        - End address of the region (exclusive)
 * @param storedChecksum - The checksum value stored in the ROM table entry
 * @returns `true` if the checksum is valid, `false` otherwise
 *
 * @example
 * ```typescript
 * const valid = validateSubaruDensoChecksum(rom, 0x0000, 0x7FF0, storedChecksum);
 * ```
 */
export function validateSubaruDensoChecksum(
	data: Uint8Array,
	startAddr: number,
	endAddr: number,
	storedChecksum: number,
): boolean {
	if (startAddr % 4 !== 0 || endAddr % 4 !== 0) {
		return false;
	}
	if (startAddr < 0 || endAddr > data.length || startAddr >= endAddr) {
		return false;
	}

	let byteSum = 0;
	for (let i = startAddr; i < endAddr; i += 4) {
		const word =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;
		byteSum = (byteSum + word) >>> 0;
	}

	// result = CHECK_TOTAL - storedChecksum - byteSum; valid if result == 0
	const result = (SUBARU_DENSO_CHECK_TOTAL - storedChecksum - byteSum) | 0;
	return result === 0;
}

/**
 * Updates all Subaru/Denso ROM checksum table entries in-place.
 *
 * Iterates over each 12-byte entry in the checksum table at `tableOffset`.
 * For each entry:
 * - If `startAddr == 0` and `endAddr == 0`, the entry is a "disabled" sentinel
 *   and is left unchanged (RomRaider skips these with `off = 0`).
 * - Otherwise, recomputes the checksum for `[startAddr, endAddr)` and writes
 *   the new 4-byte big-endian value back to bytes 8–11 of the entry.
 *
 * This is a direct port of `RomChecksum.calculateRomChecksum()` from RomRaider:
 * ```java
 * for (int i = storageAddress; i < storageAddress + dataSize; i += 12) {
 *     int startAddr = parseByteValue(input, BIG, i,   4, true);
 *     int endAddr   = parseByteValue(input, BIG, i+4, 4, true);
 *     // 0 means checksum is disabled, keep it
 *     byte[] newSum = calculateChecksum(input, startAddr, endAddr);
 *     System.arraycopy(newSum, 0, input, i + 8, 4);
 * }
 * ```
 *
 * Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 *
 * @param data        - The full ROM buffer (modified in place)
 * @param tableOffset - Byte offset of the checksum table in the ROM
 * @param tableSize   - Total byte size of the checksum table (must be a multiple of 12)
 * @throws Error if tableOffset/tableSize are out of bounds or not aligned
 *
 * @example
 * ```typescript
 * // Update a 4-entry checksum table at offset 0x7FFF0
 * updateSubaruDensoChecksums(rom, 0x7FFF0, 48);
 * ```
 */
export function updateSubaruDensoChecksums(
	data: Uint8Array,
	tableOffset: number,
	tableSize: number,
): void {
	if (tableSize % 12 !== 0) {
		throw new Error(
			`Subaru/Denso checksum table size must be a multiple of 12 bytes, got ${tableSize}`,
		);
	}
	if (tableOffset < 0 || tableOffset + tableSize > data.length) {
		throw new Error(
			`Subaru/Denso checksum table out of bounds: offset=${tableOffset}, size=${tableSize}, ROM length=${data.length}`,
		);
	}

	const count = tableSize / 12;

	for (let i = 0; i < count; i++) {
		const base = tableOffset + i * 12;
		const startAddr =
			(((data[base] ?? 0) << 24) |
				((data[base + 1] ?? 0) << 16) |
				((data[base + 2] ?? 0) << 8) |
				(data[base + 3] ?? 0)) >>>
			0;
		const endAddr =
			(((data[base + 4] ?? 0) << 24) |
				((data[base + 5] ?? 0) << 16) |
				((data[base + 6] ?? 0) << 8) |
				(data[base + 7] ?? 0)) >>>
			0;

		// 0,0 means checksum is disabled — leave the entry unchanged
		if (startAddr === 0 && endAddr === 0) {
			continue;
		}

		const newChecksum = computeSubaruDensoChecksum(data, startAddr, endAddr);

		// Write new checksum big-endian at bytes 8–11 of this entry
		data[base + 8] = (newChecksum >>> 24) & 0xff;
		data[base + 9] = (newChecksum >>> 16) & 0xff;
		data[base + 10] = (newChecksum >>> 8) & 0xff;
		data[base + 11] = newChecksum & 0xff;
	}
}

/**
 * Validates all Subaru/Denso ROM checksum table entries.
 *
 * Returns the 1-based index of the first invalid entry, or 0 if all are valid,
 * or -1 if all checksums are disabled (first entry is the sentinel).
 *
 * This mirrors the return semantics of `RomChecksum.validateRomChecksum()`:
 * - Returns `0`  — all checksums valid
 * - Returns `-1` — all checksums disabled (first entry is sentinel)
 * - Returns `N`  — entry N (1-based) is the first invalid checksum
 *
 * Ported from: https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java
 *
 * @param data        - The full ROM buffer
 * @param tableOffset - Byte offset of the checksum table in the ROM
 * @param tableSize   - Total byte size of the checksum table (must be a multiple of 12)
 * @returns 0 (all valid), -1 (all disabled), or 1-based index of first invalid entry
 * @throws Error if tableOffset/tableSize are out of bounds or not aligned
 *
 * @example
 * ```typescript
 * const result = validateSubaruDensoChecksums(rom, 0x7FFF0, 48);
 * if (result === 0) console.log("All checksums valid");
 * else if (result === -1) console.log("Checksums disabled");
 * else console.log(`Checksum ${result} is invalid`);
 * ```
 */
export function validateSubaruDensoChecksums(
	data: Uint8Array,
	tableOffset: number,
	tableSize: number,
): number {
	if (tableSize % 12 !== 0) {
		throw new Error(
			`Subaru/Denso checksum table size must be a multiple of 12 bytes, got ${tableSize}`,
		);
	}
	if (tableOffset < 0 || tableOffset + tableSize > data.length) {
		throw new Error(
			`Subaru/Denso checksum table out of bounds: offset=${tableOffset}, size=${tableSize}, ROM length=${data.length}`,
		);
	}

	const count = tableSize / 12;
	const results: number[] = new Array(count).fill(0);

	for (let i = 0; i < count; i++) {
		const base = tableOffset + i * 12;
		const startAddr =
			(((data[base] ?? 0) << 24) |
				((data[base + 1] ?? 0) << 16) |
				((data[base + 2] ?? 0) << 8) |
				(data[base + 3] ?? 0)) >>>
			0;
		const endAddr =
			(((data[base + 4] ?? 0) << 24) |
				((data[base + 5] ?? 0) << 16) |
				((data[base + 6] ?? 0) << 8) |
				(data[base + 7] ?? 0)) >>>
			0;
		const storedChecksum =
			(((data[base + 8] ?? 0) << 24) |
				((data[base + 9] ?? 0) << 16) |
				((data[base + 10] ?? 0) << 8) |
				(data[base + 11] ?? 0)) >>>
			0;

		// Check for the "all disabled" sentinel: first entry with 0,0,CHECK_TOTAL
		if (
			i === 0 &&
			startAddr === 0 &&
			endAddr === 0 &&
			storedChecksum === SUBARU_DENSO_CHECK_TOTAL
		) {
			return -1;
		}

		// Validate this entry
		const valid = validateSubaruDensoChecksum(
			data,
			startAddr,
			endAddr,
			storedChecksum,
		);
		results[i] = valid ? 0 : i + 1;
	}

	for (let i = 0; i < count; i++) {
		if ((results[i] ?? 0) !== 0) {
			return results[i] ?? i + 1;
		}
	}

	return 0;
}

// ============================================================================
// Subaru SSM Protocol Checksum
//
// The Subaru Select Monitor (SSM) protocol is Subaru's proprietary OBD
// diagnostic protocol, used for ECU communication over the K-line (ISO 9141).
// It predates standardized OBD-II/CAN protocols and is used for reading live
// sensor data, reading/writing ECU memory addresses, and ECU initialization.
//
// Each SSM packet ends with a 1-byte checksum that allows the receiver to
// detect transmission errors. The checksum is a simple unsigned byte sum of
// all bytes in the packet except the last (checksum placeholder), truncated
// to 8 bits.
//
// SSM Packet Structure:
//   Byte 0:    Header (0x80)
//   Byte 1:    Destination (0x10 = ECU, 0xF0 = diagnostic tool)
//   Byte 2:    Source (0xF0 = diagnostic tool, 0x10 = ECU)
//   Byte 3:    Data length
//   Bytes 4–N: Data payload
//   Byte N+1:  Checksum (sum of bytes 0..N, truncated to 8 bits)
//
// Example — SSM ECU init request:
//   [0x80, 0x10, 0xF0, 0x01, 0xBF, 0x40]
//   checksum = (0x80 + 0x10 + 0xF0 + 0x01 + 0xBF) & 0xFF = 0x240 & 0xFF = 0x40
//
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java
//
// See also: SUBARU_CHECKSUM_ANALYSIS.md for full algorithm documentation.
// ============================================================================

/**
 * Computes the Subaru Select Monitor (SSM) protocol packet checksum.
 *
 * The SSM protocol is used by Subaru ECUs for diagnostic communication over
 * the K-line (ISO 9141). Each SSM packet ends with a 1-byte checksum computed
 * as the unsigned sum of all preceding bytes, truncated to 8 bits.
 *
 * **Algorithm** (from RomRaider `SSMChecksumCalculator.calculateChecksum`):
 * ```java
 * int total = 0;
 * for (int i = 0; i < (bytes.length - 1); i++) {
 *     total += asInt(b);  // unsigned byte addition
 * }
 * return asByte(total - ((total >>> 16) << 16));
 * // total - ((total >>> 16) << 16) ≡ total & 0xFFFF
 * // asByte(x) ≡ x & 0xFF
 * // net result: total & 0xFF
 * ```
 *
 * The Java expression `total - ((total >>> 16) << 16)` is equivalent to
 * `total & 0xFFFF` (clears the upper 16 bits). Then `asByte()` truncates to
 * 8 bits. The net result is simply `total & 0xFF`.
 *
 * **SSM Packet Structure**:
 * ```
 * [0x80] [dest] [src] [len] [data...] [checksum]
 *   │      │      │     │      │          └── sum of all preceding bytes & 0xFF
 *   │      │      │     │      └──────────── payload (len bytes)
 *   │      │      │     └────────────────── number of data bytes
 *   │      │      └──────────────────────── source address
 *   │      └─────────────────────────────── destination address
 *   └────────────────────────────────────── fixed header
 * ```
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java
 *
 * @param packet - The full SSM packet buffer including the trailing checksum byte
 *                 (the last byte is the checksum placeholder and is not included
 *                 in the sum)
 * @returns The 8-bit checksum value to place in the last byte of the packet
 * @throws Error if packet is empty
 *
 * @example
 * ```typescript
 * // SSM ECU init request: [0x80, 0x10, 0xF0, 0x01, 0xBF, checksum]
 * // sum = 0x80 + 0x10 + 0xF0 + 0x01 + 0xBF = 0x240, checksum = 0x40
 * const packet = new Uint8Array([0x80, 0x10, 0xF0, 0x01, 0xBF, 0x00]);
 * packet[packet.length - 1] = ssmChecksum(packet);
 * // packet is now [0x80, 0x10, 0xF0, 0x01, 0xBF, 0x40]
 * ```
 *
 * @see https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java
 * @see SUBARU_CHECKSUM_ANALYSIS.md
 */
export function ssmChecksum(packet: Uint8Array): number {
	if (packet.length === 0) {
		throw new Error("SSM packet must not be empty");
	}

	let total = 0;
	// Sum all bytes except the last (checksum placeholder)
	for (let i = 0; i < packet.length - 1; i++) {
		total += packet[i] ?? 0;
	}

	// Equivalent to: total - ((total >>> 16) << 16) then truncate to byte
	// = (total & 0xFFFF) & 0xFF = total & 0xFF
	return total & 0xff;
}

// ============================================================================
// Nissan ROM Checksum Algorithms
//
// Nissan ECUs use a family of checksum algorithms to protect ROM integrity.
// RomRaider implements three variants:
//
//   std / alt  — Standard Nissan ROM checksum (same algorithm, different
//                address layouts in the XML definition). Iterates the ROM
//                region in 4-byte big-endian DWORD steps, skipping the
//                sumloc and xorloc addresses. Produces a 32-bit arithmetic
//                sum (sumt) and a 32-bit XOR (xort), both stored big-endian.
//
//   alt2       — Extended Nissan ROM checksum with 4 values:
//                  1. 32-bit sum  (sumt)  — stored at sumloc
//                  2. 32-bit XOR  (xort)  — stored at xorloc
//                  3. 16-bit calibration checksum — stored at start
//                  4. 16-bit code checksum        — stored at skiploc
//
// Parameters (from the ROM definition XML):
//   start    — first address of the ROM region to checksum (inclusive)
//   end      — last address of the ROM region (exclusive)
//   sumloc   — address where the 32-bit sum is stored (skipped during sum)
//   xorloc   — address where the 32-bit XOR is stored (skipped during XOR)
//   skiploc  — (alt2 only) boundary between calibration and code regions
//              (defaults to 0x20000)
//
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateSTD.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumSTD.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateALT2.java
//
// See also: NISSAN_CHECKSUM_ANALYSIS.md for full algorithm documentation.
// ============================================================================

/**
 * Result of a Nissan STD/ALT ROM checksum computation.
 *
 * Both the 32-bit arithmetic sum (`sumt`) and the 32-bit XOR (`xort`) are
 * computed over the same region and stored big-endian at their respective
 * locations in the ROM.
 *
 * @see computeNissanStdChecksum
 * @see validateNissanStdChecksum
 * @see updateNissanStdChecksum
 */
export interface NissanStdChecksumResult {
	/** 32-bit arithmetic sum of all DWORDs in the region (excluding sumloc/xorloc) */
	sumt: number;
	/** 32-bit XOR of all DWORDs in the region (excluding sumloc/xorloc) */
	xort: number;
}

/**
 * Result of a Nissan ALT2 ROM checksum computation.
 *
 * Contains all four checksum values produced by the ALT2 algorithm:
 * - `sumt`  — 32-bit arithmetic sum, stored at `sumloc`
 * - `xort`  — 32-bit XOR, stored at `xorloc`
 * - `calSum` — 16-bit calibration checksum, stored at `start`
 * - `codeSum` — 16-bit code checksum, stored at `skiploc`
 *
 * @see computeNissanAlt2Checksum
 * @see validateNissanAlt2Checksum
 * @see updateNissanAlt2Checksum
 */
export interface NissanAlt2ChecksumResult {
	/** 32-bit arithmetic sum of DWORDs from start+4 to end (excluding sumloc/xorloc/skiploc) */
	sumt: number;
	/** 32-bit XOR of DWORDs from start+4 to end (excluding sumloc/xorloc/skiploc) */
	xort: number;
	/** 16-bit calibration checksum: 16-bit word sum from start+2 to skiploc */
	calSum: number;
	/** 16-bit code checksum: 16-bit word sum from skiploc+2 to end */
	codeSum: number;
}

/**
 * Computes the Nissan STD/ALT ROM checksum for a region.
 *
 * Used by Nissan ECUs with the `std` or `alt` checksum type in their ROM
 * definition XML. Both `std` and `alt` use the identical algorithm — the
 * only difference is the address layout specified in the XML definition.
 *
 * **Algorithm** (from RomRaider `CalculateSTD.calculate`):
 * ```java
 * int sumt = 0;
 * int xort = 0;
 * for (int i = range.get(START); i < range.get(END); i += 4) {
 *     if ((i == range.get(SUMLOC)) || (i == range.get(XORLOC))) continue;
 *     int dw = (int) parseByteValue(binData, BIG, i, 4, true);
 *     sumt += dw;
 *     xort ^= dw;
 * }
 * ```
 *
 * The function iterates the ROM region `[start, end)` in 4-byte (DWORD)
 * steps, reading each DWORD as a big-endian 32-bit integer. The addresses
 * `sumloc` and `xorloc` are skipped (they hold the stored checksum values
 * and must not contribute to the computation). The result is:
 * - `sumt`: 32-bit unsigned arithmetic sum of all DWORDs (mod 2^32)
 * - `xort`: 32-bit XOR of all DWORDs
 *
 * Both values are stored big-endian at their respective locations in the ROM.
 *
 * **Which ECUs use this algorithm**:
 * - Nissan ECUs with `<checksummodule>std</checksummodule>` in their ROM definition
 * - Nissan ECUs with `<checksummodule>alt</checksummodule>` in their ROM definition
 * - Includes various Nissan/Infiniti models (Skyline, 350Z, Frontier, etc.)
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateSTD.java
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java
 *
 * @param data    - The full ROM buffer
 * @param start   - Start address of the region (inclusive, must be 4-byte aligned)
 * @param end     - End address of the region (exclusive, must be 4-byte aligned)
 * @param sumloc  - Address where the 32-bit sum is stored (must be 4-byte aligned, within [start, end))
 * @param xorloc  - Address where the 32-bit XOR is stored (must be 4-byte aligned, within [start, end))
 * @returns Object with `sumt` (32-bit sum) and `xort` (32-bit XOR)
 * @throws Error if addresses are out of bounds or not 4-byte aligned
 *
 * @example
 * ```typescript
 * // Compute checksums for region 0x0000–0x8000, stored at 0x7FF8 and 0x7FFC
 * const result = computeNissanStdChecksum(rom, 0x0000, 0x8000, 0x7FF8, 0x7FFC);
 * console.log(result.sumt.toString(16)); // 32-bit sum
 * console.log(result.xort.toString(16)); // 32-bit XOR
 * ```
 */
export function computeNissanStdChecksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
): NissanStdChecksumResult {
	if (
		start % 4 !== 0 ||
		end % 4 !== 0 ||
		sumloc % 4 !== 0 ||
		xorloc % 4 !== 0
	) {
		throw new Error(
			`Nissan STD checksum addresses must be 4-byte aligned: start=${start}, end=${end}, sumloc=${sumloc}, xorloc=${xorloc}`,
		);
	}
	if (start < 0 || end > data.length || start >= end) {
		throw new Error(
			`Nissan STD checksum region out of bounds or empty: start=${start}, end=${end}, ROM length=${data.length}`,
		);
	}
	if (sumloc < start || sumloc + 4 > end) {
		throw new Error(
			`Nissan STD checksum sumloc out of region: sumloc=${sumloc}, region=[${start}, ${end})`,
		);
	}
	if (xorloc < start || xorloc + 4 > end) {
		throw new Error(
			`Nissan STD checksum xorloc out of region: xorloc=${xorloc}, region=[${start}, ${end})`,
		);
	}

	let sumt = 0;
	let xort = 0;

	for (let i = start; i < end; i += 4) {
		// Skip the storage locations — they hold the checksum values themselves
		if (i === sumloc || i === xorloc) continue;

		const dw =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;

		sumt = (sumt + dw) >>> 0;
		xort = (xort ^ dw) >>> 0;
	}

	return { sumt, xort };
}

/**
 * Validates the Nissan STD/ALT ROM checksum for a region.
 *
 * Reads the stored `sumt` and `xort` values from the ROM at `sumloc` and
 * `xorloc`, recomputes them, and returns the number of valid checksums (0, 1,
 * or 2). A return value of 2 means both checksums are valid.
 *
 * This mirrors the return semantics of `NissanChecksum.validate()`:
 * - Returns `2` — both sum and XOR are valid
 * - Returns `1` — only one of the two is valid
 * - Returns `0` — neither checksum is valid
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java
 *
 * @param data    - The full ROM buffer
 * @param start   - Start address of the region (inclusive)
 * @param end     - End address of the region (exclusive)
 * @param sumloc  - Address where the 32-bit sum is stored
 * @param xorloc  - Address where the 32-bit XOR is stored
 * @returns Number of valid checksums (0, 1, or 2)
 *
 * @example
 * ```typescript
 * const valid = validateNissanStdChecksum(rom, 0x0000, 0x8000, 0x7FF8, 0x7FFC);
 * if (valid === 2) console.log("Both checksums valid");
 * ```
 */
export function validateNissanStdChecksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
): number {
	const computed = computeNissanStdChecksum(data, start, end, sumloc, xorloc);

	// Read stored values big-endian from ROM
	const storedSumt =
		(((data[sumloc] ?? 0) << 24) |
			((data[sumloc + 1] ?? 0) << 16) |
			((data[sumloc + 2] ?? 0) << 8) |
			(data[sumloc + 3] ?? 0)) >>>
		0;
	const storedXort =
		(((data[xorloc] ?? 0) << 24) |
			((data[xorloc + 1] ?? 0) << 16) |
			((data[xorloc + 2] ?? 0) << 8) |
			(data[xorloc + 3] ?? 0)) >>>
		0;

	let valid = 0;
	if (computed.sumt === storedSumt) valid++;
	if (computed.xort === storedXort) valid++;
	return valid;
}

/**
 * Updates the Nissan STD/ALT ROM checksum values in-place.
 *
 * Computes the `sumt` and `xort` values for the region `[start, end)` and
 * writes them big-endian at `sumloc` and `xorloc` respectively.
 *
 * This is a direct port of `NissanChecksum.update()` from RomRaider:
 * ```java
 * calculator.calculate(range, binData, results);
 * System.arraycopy(parseIntegerValue(results.get(SUMT), BIG, 4), 0, binData, range.get(SUMLOC), 4);
 * System.arraycopy(parseIntegerValue(results.get(XORT), BIG, 4), 0, binData, range.get(XORLOC), 4);
 * ```
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java
 *
 * @param data    - The full ROM buffer (modified in place)
 * @param start   - Start address of the region (inclusive)
 * @param end     - End address of the region (exclusive)
 * @param sumloc  - Address where the 32-bit sum is stored
 * @param xorloc  - Address where the 32-bit XOR is stored
 * @returns The computed checksum result
 *
 * @example
 * ```typescript
 * // Update checksums after modifying ROM data
 * updateNissanStdChecksum(rom, 0x0000, 0x8000, 0x7FF8, 0x7FFC);
 * ```
 */
export function updateNissanStdChecksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
): NissanStdChecksumResult {
	const result = computeNissanStdChecksum(data, start, end, sumloc, xorloc);

	// Write sumt big-endian at sumloc
	data[sumloc] = (result.sumt >>> 24) & 0xff;
	data[sumloc + 1] = (result.sumt >>> 16) & 0xff;
	data[sumloc + 2] = (result.sumt >>> 8) & 0xff;
	data[sumloc + 3] = result.sumt & 0xff;

	// Write xort big-endian at xorloc
	data[xorloc] = (result.xort >>> 24) & 0xff;
	data[xorloc + 1] = (result.xort >>> 16) & 0xff;
	data[xorloc + 2] = (result.xort >>> 8) & 0xff;
	data[xorloc + 3] = result.xort & 0xff;

	return result;
}

/**
 * Computes all four Nissan ALT2 ROM checksum values for a region.
 *
 * The ALT2 algorithm is an extended variant used by some Nissan ECUs that
 * require four checksum values instead of two. It produces:
 *
 * 1. **32-bit sum** (`sumt`): Arithmetic sum of DWORDs from `start+4` to `end`,
 *    skipping `sumloc`, `xorloc`, and `skiploc`. Stored big-endian at `sumloc`.
 *
 * 2. **32-bit XOR** (`xort`): XOR of DWORDs from `start+4` to `end`,
 *    skipping `sumloc`, `xorloc`, and `skiploc`. Stored big-endian at `xorloc`.
 *
 * 3. **16-bit calibration checksum** (`calSum`): 16-bit word sum from `start+2`
 *    to `skiploc`. When the iteration reaches `sumloc` or `xorloc`, the
 *    already-computed 32-bit values are included inline (as two 16-bit halves
 *    each). Stored big-endian at `start`.
 *
 * 4. **16-bit code checksum** (`codeSum`): 16-bit word sum from `skiploc+2`
 *    to `end`. Stored big-endian at `skiploc`.
 *
 * **Algorithm** (from RomRaider `CalculateALT2.calculate`):
 * ```java
 * // 32-bit checksums (start+4 to end, skip sumloc/xorloc/skiploc)
 * int sumt = 0, xort = 0;
 * for (int i = range.get(START) + 4; i < range.get(END); i += 4) {
 *     if ((i == range.get(SUMLOC)) || (i == range.get(XORLOC))
 *             || (i == range.get(SKIPLOC))) continue;
 *     int dw = (int) parseByteValue(binData, BIG, i, 4, true);
 *     sumt += dw;
 *     xort ^= dw;
 * }
 * // 16-bit calibration checksum (start+2 to skiploc)
 * short sum = 0;
 * for (int i = range.get(START) + 2; i < range.get(SKIPLOC); i += 2) {
 *     if (i == range.get(SUMLOC)) {
 *         sum += (short)((sumt >> 16) & 0xffff);
 *         sum += (short)(sumt & 0xffff);
 *         i += 2;
 *         continue;
 *     }
 *     if (i == range.get(XORLOC)) {
 *         sum += (short)((xort >> 16) & 0xffff);
 *         sum += (short)(xort & 0xffff);
 *         i += 2;
 *         continue;
 *     }
 *     sum += (short) parseByteValue(binData, BIG, i, 2, false);
 * }
 * results.put(START, (int) sum);
 * // 16-bit code checksum (skiploc+2 to end)
 * sum = 0;
 * for (int i = range.get(SKIPLOC) + 2; i < range.get(END); i += 2) {
 *     sum += (short) parseByteValue(binData, BIG, i, 2, false);
 * }
 * results.put(SKIPLOC, (int) sum);
 * ```
 *
 * **Which ECUs use this algorithm**:
 * - Nissan ECUs with `<checksummodule>alt2</checksummodule>` in their ROM definition
 * - Typically larger ROMs with a split calibration/code region boundary at `skiploc`
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateALT2.java
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java
 *
 * @param data     - The full ROM buffer
 * @param start    - Start address of the region (inclusive, must be 4-byte aligned)
 * @param end      - End address of the region (exclusive, must be 4-byte aligned)
 * @param sumloc   - Address where the 32-bit sum is stored (must be 4-byte aligned)
 * @param xorloc   - Address where the 32-bit XOR is stored (must be 4-byte aligned)
 * @param skiploc  - Boundary between calibration and code regions (default: 0x20000)
 * @returns Object with `sumt`, `xort`, `calSum`, and `codeSum`
 * @throws Error if addresses are out of bounds or not properly aligned
 *
 * @example
 * ```typescript
 * // Compute all 4 checksums for a 256KB ROM
 * const result = computeNissanAlt2Checksum(rom, 0x0000, 0x40000, 0x1FFF8, 0x1FFFC, 0x20000);
 * console.log(result.sumt.toString(16));    // 32-bit sum
 * console.log(result.xort.toString(16));    // 32-bit XOR
 * console.log(result.calSum.toString(16));  // 16-bit calibration checksum
 * console.log(result.codeSum.toString(16)); // 16-bit code checksum
 * ```
 */
export function computeNissanAlt2Checksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
	skiploc = 0x20000,
): NissanAlt2ChecksumResult {
	if (
		start % 4 !== 0 ||
		end % 4 !== 0 ||
		sumloc % 4 !== 0 ||
		xorloc % 4 !== 0
	) {
		throw new Error(
			`Nissan ALT2 checksum addresses must be 4-byte aligned: start=${start}, end=${end}, sumloc=${sumloc}, xorloc=${xorloc}`,
		);
	}
	if (start < 0 || end > data.length || start >= end) {
		throw new Error(
			`Nissan ALT2 checksum region out of bounds or empty: start=${start}, end=${end}, ROM length=${data.length}`,
		);
	}
	if (skiploc <= start || skiploc >= end) {
		throw new Error(
			`Nissan ALT2 skiploc must be within region: skiploc=${skiploc}, region=[${start}, ${end})`,
		);
	}

	// Step 1: 32-bit sum and XOR (start+4 to end, skip sumloc/xorloc/skiploc)
	let sumt = 0;
	let xort = 0;

	for (let i = start + 4; i < end; i += 4) {
		if (i === sumloc || i === xorloc || i === skiploc) continue;

		const dw =
			(((data[i] ?? 0) << 24) |
				((data[i + 1] ?? 0) << 16) |
				((data[i + 2] ?? 0) << 8) |
				(data[i + 3] ?? 0)) >>>
			0;

		sumt = (sumt + dw) >>> 0;
		xort = (xort ^ dw) >>> 0;
	}

	// Step 2: 16-bit calibration checksum (start+2 to skiploc)
	// When sumloc or xorloc is encountered, include the already-computed
	// 32-bit values inline (as two 16-bit halves each).
	let calSum = 0;
	for (let i = start + 2; i < skiploc; i += 2) {
		if (i === sumloc) {
			// Include 32-bit sumt as two 16-bit halves
			calSum = (calSum + ((sumt >>> 16) & 0xffff)) & 0xffff;
			calSum = (calSum + (sumt & 0xffff)) & 0xffff;
			i += 2; // advance past the 32-bit value (already consumed 4 bytes)
			continue;
		}
		if (i === xorloc) {
			// Include 32-bit xort as two 16-bit halves
			calSum = (calSum + ((xort >>> 16) & 0xffff)) & 0xffff;
			calSum = (calSum + (xort & 0xffff)) & 0xffff;
			i += 2; // advance past the 32-bit value
			continue;
		}
		// Read 16-bit big-endian word
		const w = (((data[i] ?? 0) << 8) | (data[i + 1] ?? 0)) & 0xffff;
		calSum = (calSum + w) & 0xffff;
	}

	// Step 3: 16-bit code checksum (skiploc+2 to end)
	let codeSum = 0;
	for (let i = skiploc + 2; i < end; i += 2) {
		const w = (((data[i] ?? 0) << 8) | (data[i + 1] ?? 0)) & 0xffff;
		codeSum = (codeSum + w) & 0xffff;
	}

	return { sumt, xort, calSum, codeSum };
}

/**
 * Validates all four Nissan ALT2 ROM checksum values.
 *
 * Reads the stored values from the ROM and compares them to the computed
 * values. Returns the number of valid checksums (0–4). A return value of 4
 * means all checksums are valid.
 *
 * This mirrors the return semantics of `ChecksumALT2.validate()`:
 * - Returns `4` — all four checksums valid
 * - Returns `N` — N of the four checksums are valid
 * - Returns `0` — no checksums are valid
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java
 *
 * @param data     - The full ROM buffer
 * @param start    - Start address of the region (inclusive)
 * @param end      - End address of the region (exclusive)
 * @param sumloc   - Address where the 32-bit sum is stored
 * @param xorloc   - Address where the 32-bit XOR is stored
 * @param skiploc  - Boundary between calibration and code regions (default: 0x20000)
 * @returns Number of valid checksums (0–4)
 *
 * @example
 * ```typescript
 * const valid = validateNissanAlt2Checksum(rom, 0x0000, 0x40000, 0x1FFF8, 0x1FFFC, 0x20000);
 * if (valid === 4) console.log("All checksums valid");
 * ```
 */
export function validateNissanAlt2Checksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
	skiploc = 0x20000,
): number {
	const computed = computeNissanAlt2Checksum(
		data,
		start,
		end,
		sumloc,
		xorloc,
		skiploc,
	);

	// Read stored 32-bit sum big-endian at sumloc
	const storedSumt =
		(((data[sumloc] ?? 0) << 24) |
			((data[sumloc + 1] ?? 0) << 16) |
			((data[sumloc + 2] ?? 0) << 8) |
			(data[sumloc + 3] ?? 0)) >>>
		0;

	// Read stored 32-bit XOR big-endian at xorloc
	const storedXort =
		(((data[xorloc] ?? 0) << 24) |
			((data[xorloc + 1] ?? 0) << 16) |
			((data[xorloc + 2] ?? 0) << 8) |
			(data[xorloc + 3] ?? 0)) >>>
		0;

	// Read stored 16-bit calibration checksum big-endian at start
	const storedCalSum =
		(((data[start] ?? 0) << 8) | (data[start + 1] ?? 0)) & 0xffff;

	// Read stored 16-bit code checksum big-endian at skiploc
	const storedCodeSum =
		(((data[skiploc] ?? 0) << 8) | (data[skiploc + 1] ?? 0)) & 0xffff;

	let valid = 0;
	if (computed.sumt === storedSumt) valid++;
	if (computed.xort === storedXort) valid++;
	if (computed.calSum === storedCalSum) valid++;
	if (computed.codeSum === storedCodeSum) valid++;
	return valid;
}

/**
 * Updates all four Nissan ALT2 ROM checksum values in-place.
 *
 * Computes all four checksum values and writes them to the ROM:
 * - `sumt`    → written big-endian (4 bytes) at `sumloc`
 * - `xort`    → written big-endian (4 bytes) at `xorloc`
 * - `calSum`  → written big-endian (2 bytes) at `start`
 * - `codeSum` → written big-endian (2 bytes) at `skiploc`
 *
 * This is a direct port of `ChecksumALT2.update()` from RomRaider:
 * ```java
 * super.update(binData);  // writes sumt and xort
 * System.arraycopy(parseIntegerValue(results.get(START), BIG, 2), 0, binData, range.get(START), 2);
 * System.arraycopy(parseIntegerValue(results.get(SKIPLOC), BIG, 2), 0, binData, range.get(SKIPLOC), 2);
 * ```
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java
 *
 * @param data     - The full ROM buffer (modified in place)
 * @param start    - Start address of the region (inclusive)
 * @param end      - End address of the region (exclusive)
 * @param sumloc   - Address where the 32-bit sum is stored
 * @param xorloc   - Address where the 32-bit XOR is stored
 * @param skiploc  - Boundary between calibration and code regions (default: 0x20000)
 * @returns The computed checksum result
 *
 * @example
 * ```typescript
 * // Update all 4 checksums after modifying ROM data
 * updateNissanAlt2Checksum(rom, 0x0000, 0x40000, 0x1FFF8, 0x1FFFC, 0x20000);
 * ```
 */
export function updateNissanAlt2Checksum(
	data: Uint8Array,
	start: number,
	end: number,
	sumloc: number,
	xorloc: number,
	skiploc = 0x20000,
): NissanAlt2ChecksumResult {
	const result = computeNissanAlt2Checksum(
		data,
		start,
		end,
		sumloc,
		xorloc,
		skiploc,
	);

	// Write sumt big-endian (4 bytes) at sumloc
	data[sumloc] = (result.sumt >>> 24) & 0xff;
	data[sumloc + 1] = (result.sumt >>> 16) & 0xff;
	data[sumloc + 2] = (result.sumt >>> 8) & 0xff;
	data[sumloc + 3] = result.sumt & 0xff;

	// Write xort big-endian (4 bytes) at xorloc
	data[xorloc] = (result.xort >>> 24) & 0xff;
	data[xorloc + 1] = (result.xort >>> 16) & 0xff;
	data[xorloc + 2] = (result.xort >>> 8) & 0xff;
	data[xorloc + 3] = result.xort & 0xff;

	// Write calSum big-endian (2 bytes) at start
	data[start] = (result.calSum >>> 8) & 0xff;
	data[start + 1] = result.calSum & 0xff;

	// Write codeSum big-endian (2 bytes) at skiploc
	data[skiploc] = (result.codeSum >>> 8) & 0xff;
	data[skiploc + 1] = result.codeSum & 0xff;

	return result;
}

// ============================================================================
// NCS K-line Protocol Checksum
//
// The Nissan Communication System (NCS) protocol is used for ECU communication
// over the K-line (ISO 14230 / KWP2000). It is used by Nissan/Infiniti vehicles
// for diagnostic communication, ECU flashing, and live data logging.
//
// Each NCS packet ends with a 1-byte checksum computed as the unsigned sum of
// all bytes in the packet except the last (checksum placeholder), truncated to
// 8 bits. This is structurally identical to the Subaru SSM checksum.
//
// NCS Packet Structure (ISO 14230 / KWP2000):
//   Byte 0:    Format byte (e.g., 0x80 for long addressing)
//   Byte 1:    Target address
//   Byte 2:    Source address
//   Byte 3:    Data length
//   Bytes 4–N: Data payload
//   Byte N+1:  Checksum (sum of bytes 0..N, truncated to 8 bits)
//
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java
//
// See also: NISSAN_CHECKSUM_ANALYSIS.md for full algorithm documentation.
// ============================================================================

/**
 * Computes the NCS (Nissan Communication System) K-line protocol packet checksum.
 *
 * The NCS protocol is used by Nissan/Infiniti ECUs for diagnostic communication
 * over the K-line (ISO 14230 / KWP2000). Each NCS packet ends with a 1-byte
 * checksum computed as the unsigned sum of all preceding bytes, truncated to
 * 8 bits.
 *
 * **Algorithm** (from RomRaider `NCSChecksumCalculator.calculateChecksum`):
 * ```java
 * public static byte calculateChecksum(byte[] bytes) {
 *     int total = 0;
 *     for (int i = 0; i < (bytes.length - 1); i++) {
 *         byte b = bytes[i];
 *         total += asInt(b);  // unsigned byte addition
 *     }
 *     return asByte(total & 0xFF);
 * }
 * ```
 *
 * This is structurally identical to the Subaru SSM checksum (`ssmChecksum`).
 * The difference is the protocol context: NCS is used by Nissan ECUs over
 * ISO 14230 (KWP2000), while SSM is used by Subaru ECUs over ISO 9141.
 *
 * **NCS Packet Structure** (ISO 14230 / KWP2000):
 * ```
 * [format] [target] [source] [len] [data...] [checksum]
 *    │         │        │      │       │          └── sum of all preceding bytes & 0xFF
 *    │         │        │      │       └──────────── payload (len bytes)
 *    │         │        │      └────────────────── number of data bytes
 *    │         │        └──────────────────────── source address
 *    │         └─────────────────────────────── target address
 *    └────────────────────────────────────────── format byte (0x80 = long addressing)
 * ```
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java
 *
 * @param packet - The full NCS packet buffer including the trailing checksum byte
 *                 (the last byte is the checksum placeholder and is not included
 *                 in the sum)
 * @returns The 8-bit checksum value to place in the last byte of the packet
 * @throws Error if packet is empty
 *
 * @example
 * ```typescript
 * // NCS packet: [0x80, 0x10, 0xF1, 0x01, 0x3E, 0x00]
 * // sum = 0x80 + 0x10 + 0xF1 + 0x01 + 0x3E = 0x220, checksum = 0x20
 * const packet = new Uint8Array([0x80, 0x10, 0xF1, 0x01, 0x3E, 0x00]);
 * packet[packet.length - 1] = ncsChecksum(packet);
 * // packet is now [0x80, 0x10, 0xF1, 0x01, 0x3E, 0x20]
 * ```
 *
 * @see https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java
 * @see NISSAN_CHECKSUM_ANALYSIS.md
 */
export function ncsChecksum(packet: Uint8Array): number {
	if (packet.length === 0) {
		throw new Error("NCS packet must not be empty");
	}

	let total = 0;
	// Sum all bytes except the last (checksum placeholder)
	for (let i = 0; i < packet.length - 1; i++) {
		total += packet[i] ?? 0;
	}

	return total & 0xff;
}

// ============================================================================
// NCS CRC-16 (CRC-16/CCITT Reversed)
//
// The NCS CRC-16 is used by Nissan ECUs for data integrity verification in
// the NCS communication protocol. It is a standard CRC-16/CCITT reversed
// (also known as CRC-16/IBM-SDLC or CRC-B) with:
//   - Polynomial: 0x8408 (reversed 0x1021)
//   - Initial value: 0xFFFF
//   - Input reflection: true (bit-by-bit processing, LSB first)
//   - Output reflection: true
//   - Final XOR: none (0x0000)
//
// The algorithm processes each byte bit-by-bit, LSB first. For each bit:
//   1. XOR the LSB of the current CRC with the LSB of the current data byte
//   2. Shift the CRC right by 1
//   3. If the XOR result was 1, XOR the CRC with the polynomial 0x8408
//   4. Shift the data byte right by 1
//
// This is the same CRC used in many serial communication protocols (HDLC, X.25).
//
// Ported from:
//   https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java
//
// See also: NISSAN_CHECKSUM_ANALYSIS.md for full algorithm documentation.
// ============================================================================

/**
 * Computes the NCS CRC-16 (CRC-16/CCITT reversed) checksum.
 *
 * Used by Nissan ECUs in the NCS communication protocol for data integrity
 * verification. This is a standard CRC-16/CCITT reversed algorithm with
 * polynomial `0x8408` (the bit-reversed form of `0x1021`) and initial value
 * `0xFFFF`.
 *
 * **Algorithm** (from RomRaider `NcsCoDec.calcCrc`):
 * ```java
 * public final short calcCrc(byte[] data) {
 *     int r6;
 *     int r5;
 *     int crc = 0xffff;
 *     for (int i = 0; i < data.length; i++) {
 *         r5 = data[i];
 *         for (int j = 0; j < 8; j++) {
 *             r6 = crc & 1;
 *             crc = crc >>> 1;
 *             if (r6 != (r5 & 1)) {
 *                 crc = crc ^ 0x8408;
 *             }
 *             r5 = r5 >> 1;
 *         }
 *     }
 *     return (short) crc;
 * }
 * ```
 *
 * **CRC parameters** (CRC-16/CCITT reversed / CRC-16/IBM-SDLC / CRC-B):
 * - Polynomial: `0x8408` (bit-reversed `0x1021`)
 * - Initial value: `0xFFFF`
 * - Input reflection: true (processes bits LSB first)
 * - Output reflection: true
 * - Final XOR: `0x0000`
 *
 * **Standard test vector**: CRC of `"123456789"` = `0x6F91`
 * (CRC-16/IBM-SDLC without final XOR: `0x906E ^ 0xFFFF = 0x6F91`)
 *
 * **Usage in NCS protocol**: The CRC is computed over the encoded data buffer.
 * The inverted CRC (`~crc`) is then appended to the packet in little-endian
 * byte order. The residue (CRC of the full packet including the appended CRC)
 * is `0x0000` for a valid packet.
 *
 * Ported from:
 * https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java
 *
 * @param data - Data to compute CRC over
 * @returns CRC-16 value as unsigned 16-bit integer (0–65535)
 *
 * @example
 * ```typescript
 * // Standard test vector: CRC of "123456789" = 0x6F91
 * const data = new TextEncoder().encode("123456789");
 * const crc = ncsCrc16(data);
 * console.log(crc.toString(16)); // "6f91"
 * ```
 *
 * @example
 * ```typescript
 * // Compute CRC and append inverted CRC (little-endian) for NCS packet
 * const encoded = encodeData(payload);
 * const crc = ncsCrc16(encoded);
 * const inverted = (~crc) & 0xFFFF;
 * const packet = new Uint8Array(encoded.length + 2);
 * packet.set(encoded);
 * packet[encoded.length]     = inverted & 0xFF;         // low byte
 * packet[encoded.length + 1] = (inverted >>> 8) & 0xFF; // high byte
 * ```
 *
 * @see https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java
 * @see NISSAN_CHECKSUM_ANALYSIS.md
 */
export function ncsCrc16(data: Uint8Array): number {
	let crc = 0xffff;

	for (let i = 0; i < data.length; i++) {
		let r5 = data[i] ?? 0;
		for (let j = 0; j < 8; j++) {
			const r6 = crc & 1;
			crc = crc >>> 1;
			if (r6 !== (r5 & 1)) {
				crc = crc ^ 0x8408;
			}
			r5 = r5 >>> 1;
		}
	}

	return crc & 0xffff;
}
