import type { TableDefinition } from "./table";

export interface ROMDefinitionStub {
	/** Definition file URI (typically file://...) */
	uri: string;
	name: string;
	/** One or more checks that can be used to match a ROM image to this definition */
	fingerprints: ROMFingerprint[];
}

/** Parsed ROM definition file */
export interface ROMDefinition extends ROMDefinitionStub {
	/**
	 * Metadata about the vehicle
	 *
	 * @remarks All of these fields are user-generated, and do not affect anything functional.
	 */
	platform: {
		make?: string;
		model?: string;
		submodel?: string;
		year?: number;
		market?: string;
		transmission?: string;
	};
	tables: TableDefinition[];
	/** Optional checksum definition for ROM validation and recomputation */
	checksum?: ChecksumDefinition;
}

/** Address & value to verify that a ROM matches a definition */
export interface ROMFingerprint {
	/** Address and length of bytes to read */
	reads: { address: number; length: number }[];

	/** Expected bytes, as hex strings aligned with `reads` order (whitespace is ignored). */
	expectedHex: string[];

	/** Optional weights aligned with `reads` order; defaults to 100 each. */
	weights?: number[];

	/** Optional human readable fingerprint description */
	description?: string;
}

/** Checksum algorithm type */
export type ChecksumAlgorithm = "crc32" | "sum" | "xor" | "custom";

/** Checksum definition for ROM validation */
export interface ChecksumDefinition {
	/** Algorithm to use for checksum calculation */
	algorithm: ChecksumAlgorithm;
	/** Regions of ROM to include in checksum calculation */
	regions: ChecksumRegion[];
	/** Where and how the checksum is stored in the ROM */
	storage: ChecksumStorage;
	/** Custom checksum function (required if algorithm is "custom") */
	customFunction?: (data: Uint8Array) => number;
}

/** Region of ROM to include in checksum calculation */
export interface ChecksumRegion {
	/** Start address (inclusive) */
	start: number;
	/** End address (exclusive) */
	end: number;
	/** Optional description of this region */
	description?: string;
}

/** Checksum storage location and format */
export interface ChecksumStorage {
	/** Offset in ROM where checksum is stored */
	offset: number;
	/** Size of checksum in bytes */
	size: 1 | 2 | 4;
	/** Endianness of stored checksum (default: "le") */
	endianness?: "le" | "be";
}

/** Result of checksum validation */
export interface ChecksumValidation {
	/** Whether the checksum is valid */
	valid: boolean;
	/** Expected checksum value (computed from ROM data) */
	expected: number;
	/** Actual checksum value (read from ROM) */
	actual: number;
	/** Algorithm used for validation */
	algorithm: ChecksumAlgorithm;
}
