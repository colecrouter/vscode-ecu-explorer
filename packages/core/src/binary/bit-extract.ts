/**
 * Bit-level extraction utilities for packed binary data.
 *
 * These utilities support extraction of variable-length bit fields
 * from binary buffers, as used in MUT-III RAX logging blocks and
 * similar bit-packed ECU telemetry formats.
 *
 * Bit numbering convention: Big-endian bit ordering where bit 0 is the
 * most significant bit of byte 0. This matches EvoScan's BITS(start, length)
 * notation as used in RAX parameter definitions.
 *
 * @module binary/bit-extract
 */

/**
 * Extract an unsigned integer bit field from a buffer using big-endian bit ordering.
 *
 * Bit numbering: bit 0 is the MSB of byte 0, bit 7 is the LSB of byte 0,
 * bit 8 is the MSB of byte 1, etc. This matches the EvoScan BITS(start, length)
 * convention for RAX parameter extraction.
 *
 * @param buffer - Source buffer to extract bits from
 * @param bitOffset - Starting bit position (0 = MSB of first byte)
 * @param bitLength - Number of bits to extract (1-32)
 * @returns Extracted unsigned integer value
 * @throws Error if bitLength is 0, >32, or the range exceeds buffer bounds
 *
 * @example
 * // Extract RPM: BITS(11,11) from RAX_C_Dat
 * const buffer = new Uint8Array([0x25, 0x18, 0x3F, 0x64]);
 * const rpmRaw = extractBits(buffer, 11, 11);
 * const rpm = rpmRaw * 7.8125;
 *
 * @example
 * // Extract a single byte at byte boundary
 * const buffer = new Uint8Array([0xAB, 0xCD]);
 * extractBits(buffer, 0, 8)  // => 0xAB (171)
 * extractBits(buffer, 8, 8)  // => 0xCD (205)
 */
export function extractBits(
	buffer: Uint8Array,
	bitOffset: number,
	bitLength: number,
): number {
	if (bitLength <= 0) {
		throw new Error(`bitLength must be positive, got ${bitLength}`);
	}
	if (bitLength > 32) {
		throw new Error(`bitLength cannot exceed 32, got ${bitLength}`);
	}

	const endBit = bitOffset + bitLength - 1;
	const endByte = Math.floor(endBit / 8);

	if (endByte >= buffer.length) {
		throw new Error(
			`Bit range [${bitOffset}, ${bitOffset + bitLength - 1}] exceeds buffer length ${buffer.length} bytes (${buffer.length * 8} bits)`,
		);
	}

	let result = 0;

	for (let i = 0; i < bitLength; i++) {
		const bitPos = bitOffset + i;
		const byteIdx = Math.floor(bitPos / 8);
		// In big-endian bit order, bit 0 of a byte is the MSB (value 128)
		const bitInByte = 7 - (bitPos % 8);
		const bitValue = ((buffer[byteIdx] as number) >> bitInByte) & 1;
		result = (result << 1) | bitValue;
	}

	return result >>> 0; // ensure unsigned 32-bit
}

/**
 * Extract a single boolean flag bit from a buffer.
 *
 * Uses the same big-endian bit ordering as {@link extractBits}.
 * Bit 0 is the MSB of byte 0.
 *
 * @param buffer - Source buffer to extract bit from
 * @param bitOffset - Bit position to read (0 = MSB of first byte)
 * @returns `true` if the bit is 1, `false` if the bit is 0
 * @throws Error if the bit position exceeds buffer bounds
 *
 * @example
 * // Check if VVT control is active (bit flag at position 26)
 * const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x20]); // bit 26 = 1
 * const isActive = extractBitFlag(buffer, 26); // => true
 *
 * @example
 * // MSB of first byte
 * const buf = new Uint8Array([0x80]);
 * extractBitFlag(buf, 0); // => true
 * extractBitFlag(buf, 1); // => false
 */
export function extractBitFlag(buffer: Uint8Array, bitOffset: number): boolean {
	const byteIdx = Math.floor(bitOffset / 8);

	if (byteIdx >= buffer.length) {
		throw new Error(
			`Bit position ${bitOffset} exceeds buffer length ${buffer.length} bytes`,
		);
	}

	const bitInByte = 7 - (bitOffset % 8);
	return (((buffer[byteIdx] as number) >> bitInByte) & 1) === 1;
}

/**
 * Extract a signed (two's complement) integer bit field from a buffer.
 *
 * Uses the same big-endian bit ordering as {@link extractBits}.
 * The most significant extracted bit is treated as the sign bit.
 *
 * @param buffer - Source buffer to extract bits from
 * @param bitOffset - Starting bit position (0 = MSB of first byte)
 * @param bitLength - Number of bits to extract (2-32; must be ≥ 2 for sign bit)
 * @returns Signed integer value using two's complement interpretation
 * @throws Error if bitLength < 2, > 32, or the range exceeds buffer bounds
 *
 * @example
 * // Extract Timing Advance: BITS(24,7) with (value - 20)
 * // If signed 7-bit field contains 0x7E (126), that's -2 in signed = raw -2
 * const buffer = new Uint8Array([0x25, 0x18, 0x3F, 0xFE]);
 * const raw = extractSignedBits(buffer, 24, 7);
 * // Signed 7-bit 0x7E = 0b1111110 = -2 in two's complement
 *
 * @example
 * // Signed 4-bit field: 0b1000 = -8
 * const buffer = new Uint8Array([0x80]);
 * extractSignedBits(buffer, 0, 4); // => -8
 *
 * @example
 * // Signed 4-bit field: 0b0111 = +7
 * const buffer = new Uint8Array([0x70]);
 * extractSignedBits(buffer, 0, 4); // => 7
 */
export function extractSignedBits(
	buffer: Uint8Array,
	bitOffset: number,
	bitLength: number,
): number {
	if (bitLength < 2) {
		throw new Error(
			`bitLength must be at least 2 for signed extraction, got ${bitLength}`,
		);
	}

	const unsigned = extractBits(buffer, bitOffset, bitLength);

	// Check if the sign bit (MSB of the extracted field) is set
	const signBit = 1 << (bitLength - 1);
	if (unsigned & signBit) {
		// Two's complement: subtract 2^bitLength
		return unsigned - (1 << bitLength);
	}

	return unsigned;
}

/**
 * Extract bits from a buffer using byte offset + sub-byte bit offset.
 *
 * This is an alternative API that accepts a byte offset and a bit offset
 * within that byte (0-7), as used in some parameter definitions.
 *
 * @param buffer - Source buffer
 * @param byteOffset - Byte offset within the buffer
 * @param bitOffset - Bit offset within the byte (0 = MSB, 7 = LSB)
 * @param bitLength - Number of bits to extract (1-32)
 * @returns Extracted unsigned integer value
 * @throws Error if parameters are out of range
 *
 * @example
 * // Extract 4 bits starting at byte 1, bit 2 (third bit of second byte)
 * const buffer = new Uint8Array([0x00, 0x3C, 0x00]);
 * extractBitsAt(buffer, 1, 2, 4); // => 0xF (15)
 */
export function extractBitsAt(
	buffer: Uint8Array,
	byteOffset: number,
	bitOffset: number,
	bitLength: number,
): number {
	if (bitOffset < 0 || bitOffset > 7) {
		throw new Error(`bitOffset within byte must be 0-7, got ${bitOffset}`);
	}
	const globalBitOffset = byteOffset * 8 + bitOffset;
	return extractBits(buffer, globalBitOffset, bitLength);
}
