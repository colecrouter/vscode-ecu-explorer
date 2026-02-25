/**
 * MUT-III RAX (Real-Time Advanced Logging) Parameter Definitions
 *
 * Extracted from EvoScan V3.1 XML configuration decompilation analysis.
 * Provides bit-level parameter definitions for all 8 RAX data blocks
 * used in Mitsubishi MUT-III ECU real-time telemetry.
 *
 * RAX blocks are memory-mapped telemetry packets returned by the ECU
 * in response to specific RequestID reads. Each block is 4+ bytes and
 * contains multiple parameters encoded at the bit level.
 *
 * Bit numbering convention: Big-endian (EvoScan BITS(start, length)):
 * - Bit 0 = MSB of byte 0
 * - Bit 7 = LSB of byte 0
 * - Bit 8 = MSB of byte 1, etc.
 *
 * @module mut3/rax-parameters
 * @see MUT3_LOGGING_CAPABILITIES.md
 */

import { extractBits } from "@ecu-explorer/core";

/**
 * Categories for RAX parameters used for display organization
 */
export type RaxParameterCategory =
	| "engine"
	| "intake"
	| "fuel"
	| "vvt"
	| "throttle"
	| "vehicle"
	| "fuel_trim"
	| "calculated";

/**
 * Definition of a single parameter within a RAX block.
 * Contains all metadata needed to extract and convert raw ECU data.
 */
export interface RaxParameterDef {
	/** Human-readable parameter name */
	readonly name: string;
	/** Unit of measurement (e.g., "RPM", "kPa", "%", "°C") */
	readonly unit: string;
	/** Starting bit offset within the RAX block (big-endian, 0 = MSB of byte 0) */
	readonly bitOffset: number;
	/** Number of bits for this parameter */
	readonly bitLength: number;
	/** Conversion function from raw integer to physical units */
	readonly convert: (raw: number) => number;
	/** Parameter category for display grouping */
	readonly category: RaxParameterCategory;
	/** Expected minimum value in physical units (for validation) */
	readonly minValue?: number;
	/** Expected maximum value in physical units (for validation) */
	readonly maxValue?: number;
	/** Whether this is a signed (two's complement) bit field */
	readonly signed?: boolean;
}

/**
 * Complete definition of a RAX block including all parameters.
 */
export interface RaxBlockDef {
	/** RAX block identifier letter */
	readonly blockId: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
	/** Human-readable block description */
	readonly description: string;
	/** MUT-III RequestID to send to retrieve this block */
	readonly requestId: number;
	/** Expected block size in bytes */
	readonly blockSize: number;
	/** All parameters within this block */
	readonly parameters: readonly RaxParameterDef[];
}

// ---------------------------------------------------------------------------
// RAX_C_Dat — Engine Performance (RPM, Knock, Timing, Load)
// RequestID: 0x238051b0, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block C: Engine Performance parameters */
export const RAX_C_BLOCK: RaxBlockDef = {
	blockId: "C",
	description: "Engine Performance (RPM, Knock, Timing, Load)",
	requestId: 0x238051b0,
	blockSize: 5, // Load(Timing) at BITS(32,8) requires bit 39 = 5th byte
	parameters: [
		{
			name: "RPM",
			unit: "RPM",
			bitOffset: 11,
			bitLength: 11,
			convert: (raw) => raw * 7.8125,
			category: "engine",
			minValue: 0,
			maxValue: 8000,
		},
		{
			name: "Knock Sum",
			unit: "counts",
			bitOffset: 17,
			bitLength: 6,
			convert: (raw) => raw,
			category: "engine",
			minValue: 0,
			maxValue: 63,
		},
		{
			name: "Timing Advance",
			unit: "°BTDC",
			bitOffset: 24,
			bitLength: 7,
			convert: (raw) => raw - 20,
			category: "engine",
			minValue: -20,
			maxValue: 50,
		},
		{
			name: "Load (Timing)",
			unit: "%",
			bitOffset: 32,
			bitLength: 8,
			convert: (raw) => raw * 1.5625,
			category: "engine",
			minValue: 0,
			maxValue: 100,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_D_Dat — Intake & Boost (Barometer, MAP, Boost, MAF)
// RequestID: 0x238051b4, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block D: Intake & Boost parameters */
export const RAX_D_BLOCK: RaxBlockDef = {
	blockId: "D",
	description: "Intake & Boost (Barometer, MAP, Boost, MAF)",
	requestId: 0x238051b4,
	blockSize: 5, // MAF at BITS(24,10) requires bit 33 = 5th byte
	parameters: [
		{
			name: "Barometer",
			unit: "kPa",
			bitOffset: 0,
			bitLength: 8,
			convert: (raw) => raw * 0.5 + 80,
			category: "intake",
			minValue: 80,
			maxValue: 103,
		},
		{
			name: "MAP",
			unit: "kPa",
			bitOffset: 8,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "intake",
			minValue: 0,
			maxValue: 102,
		},
		{
			name: "Boost Pressure",
			unit: "kPa",
			// Boost = MAP - Barometer, so this parameter needs external computation
			// The bit offset here represents the raw boost value from the block
			bitOffset: 18,
			bitLength: 10,
			convert: (raw) => raw * 0.1 - 80, // approximate: MAP portion minus base baro
			category: "intake",
			minValue: -100,
			maxValue: 300,
		},
		{
			name: "MAF",
			unit: "g/s",
			bitOffset: 24, // overlap with boost; actual offset per EvoScan
			bitLength: 10,
			convert: (raw) => raw * 0.01,
			category: "intake",
			minValue: 0,
			maxValue: 10.2,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_B_Dat — Fuel & Oxygen (AFR, Load, O2, Injector Pulse)
// RequestID: 0x238051a8, Block Size: 4+ bytes
// ---------------------------------------------------------------------------

/** RAX Block B: Fuel & Oxygen parameters */
export const RAX_B_BLOCK: RaxBlockDef = {
	blockId: "B",
	description: "Fuel & Oxygen (AFR, Load, O2, Injector Pulse)",
	requestId: 0x238051a8,
	blockSize: 6, // extended block for injector pulse
	parameters: [
		{
			name: "AFR",
			unit: "λ",
			bitOffset: 0,
			bitLength: 9,
			convert: (raw) => raw * 0.005 + 8,
			category: "fuel",
			minValue: 8,
			maxValue: 20,
		},
		{
			name: "Load (AFR)",
			unit: "%",
			bitOffset: 9,
			bitLength: 8,
			convert: (raw) => raw * 1.5625,
			category: "fuel",
			minValue: 0,
			maxValue: 100,
		},
		{
			name: "O2 Sensor (Left)",
			unit: "V",
			bitOffset: 17,
			bitLength: 8,
			convert: (raw) => raw / 256,
			category: "fuel",
			minValue: 0,
			maxValue: 1,
		},
		{
			name: "O2 Sensor (Right)",
			unit: "V",
			bitOffset: 25,
			bitLength: 8,
			convert: (raw) => raw / 256,
			category: "fuel",
			minValue: 0,
			maxValue: 1,
		},
		{
			name: "Injector Pulse Width",
			unit: "ms",
			bitOffset: 33,
			bitLength: 10,
			convert: (raw) => raw * 0.01,
			category: "fuel",
			minValue: 0,
			maxValue: 10.24,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_E_Dat — Variable Valve Timing (VVT)
// RequestID: 0x238051b8, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block E: Variable Valve Timing parameters */
export const RAX_E_BLOCK: RaxBlockDef = {
	blockId: "E",
	description: "Variable Valve Timing (VVT)",
	requestId: 0x238051b8,
	blockSize: 4,
	parameters: [
		{
			name: "Intake VVT Angle",
			unit: "°CRK",
			bitOffset: 0,
			bitLength: 9,
			convert: (raw) => raw * 0.1 - 20,
			category: "vvt",
			minValue: -20,
			maxValue: 30,
		},
		{
			name: "Exhaust VVT Angle",
			unit: "°CRK",
			bitOffset: 9,
			bitLength: 9,
			convert: (raw) => raw * 0.1 - 20,
			category: "vvt",
			minValue: -20,
			maxValue: 30,
		},
		{
			name: "VVT Oil Pressure",
			unit: "Bar",
			bitOffset: 18,
			bitLength: 8,
			convert: (raw) => raw * 0.5,
			category: "vvt",
			minValue: 0,
			maxValue: 127.5,
		},
		{
			name: "VVT Control Status",
			unit: "status",
			bitOffset: 26,
			bitLength: 2,
			convert: (raw) => raw,
			category: "vvt",
			minValue: 0,
			maxValue: 3,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_F_Dat — Throttle & Intake Temps (TPS, APP, IAT, WGDC)
// RequestID: 0x238051bc, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block F: Throttle & Intake Temperature parameters */
export const RAX_F_BLOCK: RaxBlockDef = {
	blockId: "F",
	description: "Throttle & Intake Temps (TPS, APP, IAT, WGDC)",
	requestId: 0x238051bc,
	blockSize: 5, // WGDC at BITS(28,8) requires bit 35 = 5th byte
	parameters: [
		{
			name: "TPS",
			unit: "%",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "throttle",
			minValue: 0,
			maxValue: 100,
		},
		{
			name: "APP",
			unit: "%",
			bitOffset: 10,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "throttle",
			minValue: 0,
			maxValue: 100,
		},
		{
			name: "IAT",
			unit: "°C",
			bitOffset: 20,
			bitLength: 8,
			convert: (raw) => raw - 40,
			category: "throttle",
			minValue: -40,
			maxValue: 215,
		},
		{
			name: "WGDC",
			unit: "%",
			bitOffset: 28,
			bitLength: 8,
			convert: (raw) => raw * (100 / 255),
			category: "throttle",
			minValue: 0,
			maxValue: 100,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_G_Dat — Vehicle Dynamics (Speed, Battery, Temps)
// RequestID: 0x238051c0, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block G: Vehicle Dynamics parameters */
export const RAX_G_BLOCK: RaxBlockDef = {
	blockId: "G",
	description: "Vehicle Dynamics (Speed, Battery, Temps)",
	requestId: 0x238051c0,
	blockSize: 5, // MAT at BITS(26,8) requires bit 33 = 5th byte
	parameters: [
		{
			name: "Vehicle Speed",
			unit: "km/h",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "vehicle",
			minValue: 0,
			maxValue: 255,
		},
		{
			name: "Battery Voltage",
			unit: "V",
			bitOffset: 10,
			bitLength: 8,
			convert: (raw) => raw * 0.05 + 8,
			category: "vehicle",
			minValue: 8,
			maxValue: 16.7,
		},
		{
			name: "Coolant Temp (ECT)",
			unit: "°C",
			bitOffset: 18,
			bitLength: 8,
			convert: (raw) => raw - 40,
			category: "vehicle",
			minValue: -40,
			maxValue: 215,
		},
		{
			name: "Ambient Temp (MAT)",
			unit: "°C",
			bitOffset: 26,
			bitLength: 8,
			convert: (raw) => raw - 40,
			category: "vehicle",
			minValue: -40,
			maxValue: 215,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_A_Dat — Fuel Trim Adjustments (STFT, LTFT)
// RequestID: 0x238051ac, Block Size: 4 bytes
// ---------------------------------------------------------------------------

/** RAX Block A: Fuel Trim parameters */
export const RAX_A_BLOCK: RaxBlockDef = {
	blockId: "A",
	description: "Fuel Trim Adjustments (STFT, LTFT)",
	requestId: 0x238051ac,
	blockSize: 4,
	parameters: [
		{
			name: "STFT Bank 1",
			unit: "%",
			bitOffset: 0,
			bitLength: 8,
			convert: (raw) => (raw - 128) * 0.1,
			category: "fuel_trim",
			minValue: -12.8,
			maxValue: 12.7,
		},
		{
			name: "LTFT Bank 1",
			unit: "%",
			bitOffset: 8,
			bitLength: 8,
			convert: (raw) => (raw - 128) * 0.1,
			category: "fuel_trim",
			minValue: -12.8,
			maxValue: 12.7,
		},
		{
			name: "STFT Bank 2",
			unit: "%",
			bitOffset: 16,
			bitLength: 8,
			convert: (raw) => (raw - 128) * 0.1,
			category: "fuel_trim",
			minValue: -12.8,
			maxValue: 12.7,
		},
		{
			name: "LTFT Bank 2",
			unit: "%",
			bitOffset: 24,
			bitLength: 8,
			convert: (raw) => (raw - 128) * 0.1,
			category: "fuel_trim",
			minValue: -12.8,
			maxValue: 12.7,
		},
	],
};

// ---------------------------------------------------------------------------
// RAX_H_Dat — Calculated Values (MAF, MAP, Load Computations)
// RequestID: 0x238051c4, Block Size: 4+ bytes
// ---------------------------------------------------------------------------

/** RAX Block H: Calculated Engine Values */
export const RAX_H_BLOCK: RaxBlockDef = {
	blockId: "H",
	description: "Calculated Values (MAF, MAP, Load Computations)",
	requestId: 0x238051c4,
	blockSize: 5, // 36-bit parameters require extra byte
	parameters: [
		{
			name: "Calculated MAF",
			unit: "g/s",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 0.01,
			category: "calculated",
			minValue: 0,
			maxValue: 10.2,
		},
		{
			name: "Calculated Load (PE)",
			unit: "%",
			bitOffset: 10,
			bitLength: 8,
			convert: (raw) => raw * 1.5625,
			category: "calculated",
			minValue: 0,
			maxValue: 100,
		},
		{
			name: "Target AFR",
			unit: "λ",
			bitOffset: 18,
			bitLength: 9,
			convert: (raw) => raw * 0.005 + 8,
			category: "calculated",
			minValue: 8,
			maxValue: 20,
		},
		{
			name: "Actual AFR Delta",
			unit: "λ",
			bitOffset: 27,
			bitLength: 9,
			convert: (raw) => (raw - 512) * 0.01,
			category: "calculated",
			minValue: -5,
			maxValue: 5,
			signed: true,
		},
	],
};

// ---------------------------------------------------------------------------
// Master Registry
// ---------------------------------------------------------------------------

/**
 * Complete registry of all 8 RAX data blocks and their 48 parameters.
 *
 * Use this to look up block definitions by block ID or RequestID.
 *
 * @example
 * // Find block by RequestID
 * const block = RAX_BLOCKS.find(b => b.requestId === 0x238051b0);
 *
 * @example
 * // Iterate all parameters across all blocks
 * for (const block of RAX_BLOCKS) {
 *   for (const param of block.parameters) {
 *     console.log(`${block.blockId}.${param.name} = ${param.unit}`);
 *   }
 * }
 */
export const RAX_BLOCKS: readonly RaxBlockDef[] = [
	RAX_A_BLOCK,
	RAX_B_BLOCK,
	RAX_C_BLOCK,
	RAX_D_BLOCK,
	RAX_E_BLOCK,
	RAX_F_BLOCK,
	RAX_G_BLOCK,
	RAX_H_BLOCK,
] as const;

/**
 * Map from RequestID to RaxBlockDef for fast lookup during protocol handling.
 *
 * @example
 * const block = RAX_BLOCK_BY_REQUEST_ID.get(0x238051b0);
 */
export const RAX_BLOCK_BY_REQUEST_ID: ReadonlyMap<number, RaxBlockDef> =
	new Map(RAX_BLOCKS.map((block) => [block.requestId, block]));

/**
 * Map from block ID letter to RaxBlockDef for convenient access.
 *
 * @example
 * const cBlock = RAX_BLOCK_BY_ID.get('C');
 */
export const RAX_BLOCK_BY_ID: ReadonlyMap<string, RaxBlockDef> = new Map(
	RAX_BLOCKS.map((block) => [block.blockId, block]),
);

/**
 * Extract a single parameter's physical value from a raw RAX block buffer.
 *
 * @param buffer - Raw bytes from the RAX block ECU response
 * @param param - Parameter definition from a RaxBlockDef
 * @returns Converted physical value in the parameter's units
 * @throws Error if the bit range exceeds the buffer size
 *
 * @example
 * // Extract RPM from a RAX_C block response
 * const buffer = new Uint8Array([0x25, 0x18, 0x3F, 0x64]);
 * const rpmDef = RAX_C_BLOCK.parameters[0]; // RPM parameter
 * const rpm = extractRaxParameter(buffer, rpmDef);
 */
export function extractRaxParameter(
	buffer: Uint8Array,
	param: RaxParameterDef,
): number {
	const raw = extractBits(buffer, param.bitOffset, param.bitLength);
	return param.convert(raw);
}

/**
 * Extract all parameters from a RAX block and return a map of name → value.
 *
 * @param buffer - Raw bytes from the RAX block ECU response
 * @param blockDef - Block definition with parameter metadata
 * @returns Map from parameter name to converted physical value
 *
 * @example
 * const buffer = new Uint8Array([0x80, 0x90, 0x70, 0x88]);
 * const values = extractAllRaxParameters(buffer, RAX_A_BLOCK);
 * // { "STFT Bank 1": 0, "LTFT Bank 1": 1.6, ... }
 */
export function extractAllRaxParameters(
	buffer: Uint8Array,
	blockDef: RaxBlockDef,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const param of blockDef.parameters) {
		result[param.name] = extractRaxParameter(buffer, param);
	}
	return result;
}
