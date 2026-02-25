/**
 * Checksum management for ROM validation and updates
 *
 * This module provides functions to:
 * - Recompute checksums from ROM data
 * - Write checksums to ROM
 * - Validate checksums
 * - Read checksums from ROM
 */

import type {
	ChecksumAlgorithm,
	ChecksumDefinition,
	ChecksumValidation,
} from "../definition/rom";
import { crc32, sumChecksum, xorChecksum } from "./algorithms";

/**
 * Recompute checksum for ROM data based on definition
 *
 * Reads data from all specified regions and computes the checksum
 * using the specified algorithm.
 *
 * @param romBytes - Complete ROM data
 * @param checksumDef - Checksum definition specifying algorithm and regions
 * @returns Computed checksum value
 * @throws Error if regions are invalid or custom function is missing
 *
 * @example
 * ```typescript
 * const checksum = recomputeChecksum(romBytes, {
 *   algorithm: "crc32",
 *   regions: [{ start: 0, end: 0x1000 }],
 *   storage: { offset: 0x1000, size: 4 }
 * });
 * ```
 */
export function recomputeChecksum(
	romBytes: Uint8Array,
	checksumDef: ChecksumDefinition,
): number {
	// Validate regions
	for (const region of checksumDef.regions) {
		if (region.start < 0 || region.end > romBytes.length) {
			throw new Error(
				`Invalid checksum region: start=${region.start}, end=${region.end}, ROM length=${romBytes.length}`,
			);
		}
		if (region.start >= region.end) {
			throw new Error(
				`Invalid checksum region: start=${region.start} must be less than end=${region.end}`,
			);
		}
	}

	// Create a copy of ROM bytes and zero out the checksum storage location
	// This ensures the checksum is computed from data without the old checksum value
	const romCopy = new Uint8Array(romBytes);
	const { offset, size } = checksumDef.storage;
	for (let i = 0; i < size; i++) {
		romCopy[offset + i] = 0;
	}

	// Collect all data from regions (using the zeroed copy)
	const dataToChecksum = collectRegionData(romCopy, checksumDef.regions);

	// Compute checksum based on algorithm
	return computeChecksum(
		dataToChecksum,
		checksumDef.algorithm,
		checksumDef.customFunction,
	);
}

/**
 * Write checksum value to ROM at specified storage location
 *
 * Writes the checksum value to the ROM at the offset specified in the
 * checksum definition, using the specified size and endianness.
 *
 * @param romBytes - Complete ROM data (will be modified in place)
 * @param checksum - Checksum value to write
 * @param checksumDef - Checksum definition specifying storage location
 * @throws Error if storage offset is out of bounds
 *
 * @example
 * ```typescript
 * writeChecksum(romBytes, 0x12345678, {
 *   algorithm: "crc32",
 *   regions: [{ start: 0, end: 0x1000 }],
 *   storage: { offset: 0x1000, size: 4, endianness: "le" }
 * });
 * ```
 */
export function writeChecksum(
	romBytes: Uint8Array,
	checksum: number,
	checksumDef: ChecksumDefinition,
): void {
	const { offset, size, endianness = "le" } = checksumDef.storage;

	// Validate offset
	if (offset < 0 || offset + size > romBytes.length) {
		throw new Error(
			`Invalid checksum storage offset: ${offset}, size: ${size}, ROM length: ${romBytes.length}`,
		);
	}

	// Ensure checksum is unsigned
	checksum = checksum >>> 0;

	// Write checksum based on size and endianness
	switch (size) {
		case 1: {
			romBytes[offset] = checksum & 0xff;
			break;
		}

		case 2: {
			if (endianness === "le") {
				romBytes[offset] = checksum & 0xff;
				romBytes[offset + 1] = (checksum >>> 8) & 0xff;
			} else {
				romBytes[offset] = (checksum >>> 8) & 0xff;
				romBytes[offset + 1] = checksum & 0xff;
			}
			break;
		}

		case 4: {
			if (endianness === "le") {
				romBytes[offset] = checksum & 0xff;
				romBytes[offset + 1] = (checksum >>> 8) & 0xff;
				romBytes[offset + 2] = (checksum >>> 16) & 0xff;
				romBytes[offset + 3] = (checksum >>> 24) & 0xff;
			} else {
				romBytes[offset] = (checksum >>> 24) & 0xff;
				romBytes[offset + 1] = (checksum >>> 16) & 0xff;
				romBytes[offset + 2] = (checksum >>> 8) & 0xff;
				romBytes[offset + 3] = checksum & 0xff;
			}
			break;
		}

		default: {
			const _exhaustive: never = size;
			throw new Error(`Invalid checksum size: ${_exhaustive}`);
		}
	}
}

/**
 * Validate checksum in ROM
 *
 * Reads the stored checksum from ROM, recomputes it from the data,
 * and compares the two values.
 *
 * @param romBytes - Complete ROM data
 * @param checksumDef - Checksum definition
 * @returns Validation result with expected and actual values
 *
 * @example
 * ```typescript
 * const result = validateChecksum(romBytes, checksumDef);
 * if (!result.valid) {
 *   console.log(`Checksum mismatch: expected ${result.expected}, got ${result.actual}`);
 * }
 * ```
 */
export function validateChecksum(
	romBytes: Uint8Array,
	checksumDef: ChecksumDefinition,
): ChecksumValidation {
	const actual = readChecksum(romBytes, checksumDef);
	const expected = recomputeChecksum(romBytes, checksumDef);

	return {
		valid: actual === expected,
		expected,
		actual,
		algorithm: checksumDef.algorithm,
	};
}

/**
 * Read checksum value from ROM
 *
 * Reads the checksum value from the ROM at the offset specified in the
 * checksum definition, using the specified size and endianness.
 *
 * @param romBytes - Complete ROM data
 * @param checksumDef - Checksum definition specifying storage location
 * @returns Checksum value read from ROM
 * @throws Error if storage offset is out of bounds
 *
 * @example
 * ```typescript
 * const storedChecksum = readChecksum(romBytes, checksumDef);
 * ```
 */
export function readChecksum(
	romBytes: Uint8Array,
	checksumDef: ChecksumDefinition,
): number {
	const { offset, size, endianness = "le" } = checksumDef.storage;

	// Validate offset
	if (offset < 0 || offset + size > romBytes.length) {
		throw new Error(
			`Invalid checksum storage offset: ${offset}, size: ${size}, ROM length: ${romBytes.length}`,
		);
	}

	let checksum = 0;

	// Read checksum based on size and endianness
	switch (size) {
		case 1: {
			checksum = romBytes[offset] ?? NaN;
			break;
		}

		case 2: {
			if (endianness === "le") {
				checksum =
					(romBytes[offset] ?? NaN) | ((romBytes[offset + 1] ?? NaN) << 8);
			} else {
				checksum =
					((romBytes[offset] ?? NaN) << 8) | (romBytes[offset + 1] ?? NaN);
			}
			break;
		}

		case 4: {
			if (endianness === "le") {
				checksum =
					(romBytes[offset] ?? NaN) |
					((romBytes[offset + 1] ?? NaN) << 8) |
					((romBytes[offset + 2] ?? NaN) << 16) |
					((romBytes[offset + 3] ?? NaN) << 24);
			} else {
				checksum =
					((romBytes[offset] ?? NaN) << 24) |
					((romBytes[offset + 1] ?? NaN) << 16) |
					((romBytes[offset + 2] ?? NaN) << 8) |
					(romBytes[offset + 3] ?? NaN);
			}
			break;
		}

		default: {
			const _exhaustive: never = size;
			throw new Error(`Invalid checksum size: ${_exhaustive}`);
		}
	}

	return checksum >>> 0;
}

/**
 * Collect data from all specified regions
 *
 * @internal
 */
function collectRegionData(
	romBytes: Uint8Array,
	regions: { start: number; end: number }[],
): Uint8Array {
	// Calculate total size
	let totalSize = 0;
	for (const region of regions) {
		totalSize += region.end - region.start;
	}

	// Allocate buffer
	const data = new Uint8Array(totalSize);

	// Copy data from each region
	let offset = 0;
	for (const region of regions) {
		const regionData = romBytes.subarray(region.start, region.end);
		data.set(regionData, offset);
		offset += regionData.length;
	}

	return data;
}

/**
 * Compute checksum using specified algorithm
 *
 * @internal
 */
function computeChecksum(
	data: Uint8Array,
	algorithm: ChecksumAlgorithm,
	customFunction?: (data: Uint8Array) => number,
): number {
	switch (algorithm) {
		case "crc32":
			return crc32(data);

		case "sum":
			return sumChecksum(data);

		case "xor":
			return xorChecksum(data);

		case "custom":
			if (!customFunction) {
				throw new Error('Custom checksum algorithm requires "customFunction"');
			}
			return customFunction(data);

		default: {
			const _exhaustive: never = algorithm;
			throw new Error(`Unknown checksum algorithm: ${_exhaustive}`);
		}
	}
}
