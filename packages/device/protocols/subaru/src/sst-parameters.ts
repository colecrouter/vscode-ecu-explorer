/**
 * Subaru SST (Subaru Select Monitor Transmission) Parameter Definitions
 *
 * Extracted from EvoScan protocol analysis and community sources documenting
 * 100+ real-time transmission telemetry parameters for Subaru WRX/STI and
 * Forester ECUs over SSM protocol (K-line based).
 *
 * Provides bit-level parameter definitions for transmission data blocks
 * used in real-time telemetry via SSM-II protocol over K-line.
 *
 * Bit numbering convention: Big-endian (EvoScan BITS(start, length)):
 * - Bit 0 = MSB of byte 0
 * - Bit 7 = LSB of byte 0
 * - Bit 8 = MSB of byte 1, etc.
 *
 * NOTE: SSM protocol real-time streaming is blocked by lack of K-line transport.
 * This registry is prepared for Phase 2 (streaming implementation).
 * See SUBARU_EVOSCAN_FINDINGS.md § Part 7 for implementation roadmap.
 *
 * @module subaru/sst-parameters
 * @see SUBARU_EVOSCAN_FINDINGS.md
 * @see packages/device/protocols/mut3/src/rax-parameters.ts (pattern reference)
 */

import { extractBits } from "@ecu-explorer/core";

/**
 * Categories for SST parameters used for display organization
 */
export type SstParameterCategory =
	| "transmission_core"
	| "transmission_pressure"
	| "transmission_slip"
	| "transmission_solenoid"
	| "wheel_speed"
	| "transmission_state"
	| "vvt_transmission"
	| "transmission_calculated";

/**
 * Definition of a single parameter within an SST block.
 * Contains all metadata needed to extract and convert raw ECU data.
 */
export interface SstParameterDef {
	/** Human-readable parameter name */
	readonly name: string;
	/** Unit of measurement (e.g., "°C", "Bar", "km/h", "%") */
	readonly unit: string;
	/** Starting bit offset within the SST block (big-endian, 0 = MSB of byte 0) */
	readonly bitOffset: number;
	/** Number of bits for this parameter */
	readonly bitLength: number;
	/** Conversion function from raw integer to physical units */
	readonly convert: (raw: number) => number;
	/** Parameter category for display grouping */
	readonly category: SstParameterCategory;
	/** Expected minimum value in physical units (for validation) */
	readonly minValue?: number;
	/** Expected maximum value in physical units (for validation) */
	readonly maxValue?: number;
	/** Whether this is a signed (two's complement) bit field */
	readonly signed?: boolean;
	/** PID for OBD-style access (synthetic 0x8000+ range) */
	readonly pid?: number;
}

/**
 * Complete definition of an SST block including all parameters.
 */
export interface SstBlockDef {
	/** SST block identifier (e.g., "TRANS", "WHEEL", "SOL") */
	readonly blockId: string;
	/** Human-readable block description */
	readonly description: string;
	/** SSM block address (if applicable, format: 0x12345678 for 4-byte addressing) */
	readonly blockAddress?: number;
	/** Expected block size in bytes */
	readonly blockSize: number;
	/** All parameters within this block */
	readonly parameters: readonly SstParameterDef[];
}

/**
 * Helper function to create PID descriptors for synthetic OBD-style access.
 * Uses 0x8000+ range to avoid conflicts with standard OBD PIDs (0x00-0xFF).
 */
function makePid(baseId: number): number {
	return 0x8000 + baseId;
}

// ---------------------------------------------------------------------------
// SST_TRANS_Dat — Transmission Core (Temp, Gear, Engagement, Shift Position)
// Block ID: TRANS, Block Size: 6 bytes (estimated)
// ---------------------------------------------------------------------------

/** SST Block TRANS: Core transmission parameters */
export const SST_TRANS_BLOCK: SstBlockDef = {
	blockId: "TRANS",
	description: "Transmission Core (Temp, Gear, Engagement, Shift Position)",
	blockSize: 8, // Estimated; adjust based on actual ECU data
	parameters: [
		{
			name: "Transmission Temperature",
			unit: "°C",
			bitOffset: 0,
			bitLength: 8,
			convert: (raw) => raw - 40, // Typical Subaru temp offset
			category: "transmission_core",
			minValue: -40,
			maxValue: 215,
			pid: makePid(0x01),
		},
		{
			name: "Gear Selection",
			unit: "gear",
			bitOffset: 8,
			bitLength: 3,
			convert: (raw) => raw, // 0=P, 1=R, 2=N, 3=D, 4=S, 5=L
			category: "transmission_core",
			minValue: 0,
			maxValue: 5,
			pid: makePid(0x02),
		},
		{
			name: "Actual Gear",
			unit: "gear",
			bitOffset: 11,
			bitLength: 3,
			convert: (raw) => raw, // 0=P, 1=R, 2=N, 3=D, 4=S, 5=L, or gear number
			category: "transmission_core",
			minValue: 0,
			maxValue: 6,
			pid: makePid(0x03),
		},
		{
			name: "Gear Engagement %",
			unit: "%",
			bitOffset: 14,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100, // Normalize to percentage
			category: "transmission_core",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x04),
		},
		{
			name: "Shift Fork Position",
			unit: "steps",
			bitOffset: 22,
			bitLength: 10,
			convert: (raw) => raw,
			category: "transmission_core",
			minValue: 0,
			maxValue: 1023,
			pid: makePid(0x05),
		},
	],
};

// ---------------------------------------------------------------------------
// SST_PRES_Dat — Transmission Pressure Monitoring
// Block ID: PRES, Block Size: 8 bytes
// ---------------------------------------------------------------------------

/** SST Block PRES: Pressure monitoring parameters */
export const SST_PRES_BLOCK: SstBlockDef = {
	blockId: "PRES",
	description: "Pressure Monitoring (Clutch, Line, Actuator Pressures)",
	blockSize: 8,
	parameters: [
		{
			name: "Clutch 1 Pressure",
			unit: "Bar",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 0.1, // 0.1 Bar per count
			category: "transmission_pressure",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x10),
		},
		{
			name: "Clutch 2 Pressure",
			unit: "Bar",
			bitOffset: 10,
			bitLength: 10,
			convert: (raw) => raw * 0.1, // 0.1 Bar per count
			category: "transmission_pressure",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x11),
		},
		{
			name: "Line Pressure",
			unit: "Bar",
			bitOffset: 20,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "transmission_pressure",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x12),
		},
		{
			name: "Actuator Pressure",
			unit: "Bar",
			bitOffset: 30,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "transmission_pressure",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x13),
		},
		{
			name: "Pressure Control Solenoid Duty",
			unit: "%",
			bitOffset: 40,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100,
			category: "transmission_pressure",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x14),
		},
	],
};

// ---------------------------------------------------------------------------
// SST_SLIP_Dat — Wheel Speed & Transmission Slip
// Block ID: SLIP, Block Size: 10 bytes
// ---------------------------------------------------------------------------

/** SST Block SLIP: Wheel speed and transmission slip parameters */
export const SST_SLIP_BLOCK: SstBlockDef = {
	blockId: "SLIP",
	description: "Wheel Speed & Slip (4-wheel speeds, transmission slip %)",
	blockSize: 10,
	parameters: [
		{
			name: "Wheel Speed FR",
			unit: "km/h",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "wheel_speed",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x20),
		},
		{
			name: "Wheel Speed FL",
			unit: "km/h",
			bitOffset: 10,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "wheel_speed",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x21),
		},
		{
			name: "Wheel Speed RR",
			unit: "km/h",
			bitOffset: 20,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "wheel_speed",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x22),
		},
		{
			name: "Wheel Speed RL",
			unit: "km/h",
			bitOffset: 30,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "wheel_speed",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x23),
		},
		{
			name: "Transmission Slip",
			unit: "%",
			bitOffset: 40,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100,
			category: "transmission_slip",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x24),
		},
		{
			name: "Vehicle Speed",
			unit: "km/h",
			bitOffset: 48,
			bitLength: 10,
			convert: (raw) => raw * 0.1,
			category: "wheel_speed",
			minValue: 0,
			maxValue: 102.3,
			pid: makePid(0x25),
		},
	],
};

// ---------------------------------------------------------------------------
// SST_SOL_Dat — Solenoid Control (Current, PWM Duty)
// Block ID: SOL, Block Size: 6 bytes
// ---------------------------------------------------------------------------

/** SST Block SOL: Solenoid control parameters */
export const SST_SOL_BLOCK: SstBlockDef = {
	blockId: "SOL",
	description: "Solenoid Control (Solenoid 1-3 current, PWM duty cycle)",
	blockSize: 6,
	parameters: [
		{
			name: "Solenoid 1 Current",
			unit: "mA",
			bitOffset: 0,
			bitLength: 10,
			convert: (raw) => raw * 1, // 1 mA per count (approximate)
			category: "transmission_solenoid",
			minValue: 0,
			maxValue: 1023,
			pid: makePid(0x30),
		},
		{
			name: "Solenoid 2 Current",
			unit: "mA",
			bitOffset: 10,
			bitLength: 10,
			convert: (raw) => raw * 1,
			category: "transmission_solenoid",
			minValue: 0,
			maxValue: 1023,
			pid: makePid(0x31),
		},
		{
			name: "Solenoid 3 Current",
			unit: "mA",
			bitOffset: 20,
			bitLength: 10,
			convert: (raw) => raw * 1,
			category: "transmission_solenoid",
			minValue: 0,
			maxValue: 1023,
			pid: makePid(0x32),
		},
		{
			name: "PWM Duty Cycle",
			unit: "%",
			bitOffset: 30,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100,
			category: "transmission_solenoid",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x33),
		},
	],
};

// ---------------------------------------------------------------------------
// SST_STATE_Dat — Transmission State (Mode, Flags, Counters)
// Block ID: STATE, Block Size: 8 bytes
// ---------------------------------------------------------------------------

/** SST Block STATE: Transmission operational state and flags */
export const SST_STATE_BLOCK: SstBlockDef = {
	blockId: "STATE",
	description: "Transmission State (Mode, VIN lock, Fault flags, Counters)",
	blockSize: 8,
	parameters: [
		{
			name: "Transmission Mode",
			unit: "mode",
			bitOffset: 0,
			bitLength: 3,
			convert: (raw) => raw, // 0=Normal, 1=Sport, 2=Manual, etc.
			category: "transmission_state",
			minValue: 0,
			maxValue: 7,
			pid: makePid(0x40),
		},
		{
			name: "VIN Lock State",
			unit: "locked",
			bitOffset: 3,
			bitLength: 1,
			convert: (raw) => raw, // 0=unlocked, 1=locked
			category: "transmission_state",
			minValue: 0,
			maxValue: 1,
			pid: makePid(0x41),
		},
		{
			name: "Transmission Fault Flag",
			unit: "error",
			bitOffset: 4,
			bitLength: 1,
			convert: (raw) => raw, // 0=OK, 1=fault
			category: "transmission_state",
			minValue: 0,
			maxValue: 1,
			pid: makePid(0x42),
		},
		{
			name: "Overheat Warning Flag",
			unit: "warning",
			bitOffset: 5,
			bitLength: 1,
			convert: (raw) => raw,
			category: "transmission_state",
			minValue: 0,
			maxValue: 1,
			pid: makePid(0x43),
		},
		{
			name: "VIN Write Counter",
			unit: "writes",
			bitOffset: 8,
			bitLength: 8,
			convert: (raw) => raw,
			category: "transmission_state",
			minValue: 0,
			maxValue: 255,
			pid: makePid(0x44),
		},
		{
			name: "Shift Attempt Counter",
			unit: "shifts",
			bitOffset: 16,
			bitLength: 16,
			convert: (raw) => raw,
			category: "transmission_state",
			minValue: 0,
			maxValue: 65535,
			pid: makePid(0x45),
		},
		{
			name: "Oil Change Counter",
			unit: "changes",
			bitOffset: 32,
			bitLength: 8,
			convert: (raw) => raw,
			category: "transmission_state",
			minValue: 0,
			maxValue: 255,
			pid: makePid(0x46),
		},
	],
};

// ---------------------------------------------------------------------------
// SST_CALC_Dat — Calculated Transmission Values
// Block ID: CALC, Block Size: 6 bytes
// ---------------------------------------------------------------------------

/** SST Block CALC: Calculated transmission values and derived metrics */
export const SST_CALC_BLOCK: SstBlockDef = {
	blockId: "CALC",
	description: "Calculated Transmission Values (Load, Efficiency, Shift Time)",
	blockSize: 6,
	parameters: [
		{
			name: "Transmission Load",
			unit: "%",
			bitOffset: 0,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100,
			category: "transmission_calculated",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x50),
		},
		{
			name: "Transmission Efficiency",
			unit: "%",
			bitOffset: 8,
			bitLength: 8,
			convert: (raw) => (raw / 255) * 100,
			category: "transmission_calculated",
			minValue: 0,
			maxValue: 100,
			pid: makePid(0x51),
		},
		{
			name: "Current Shift Time",
			unit: "ms",
			bitOffset: 16,
			bitLength: 10,
			convert: (raw) => raw * 1, // 1 ms per count
			category: "transmission_calculated",
			minValue: 0,
			maxValue: 1023,
			pid: makePid(0x52),
		},
		{
			name: "Target Gear",
			unit: "gear",
			bitOffset: 26,
			bitLength: 3,
			convert: (raw) => raw,
			category: "transmission_calculated",
			minValue: 0,
			maxValue: 6,
			pid: makePid(0x53),
		},
		{
			name: "Shift Quality",
			unit: "quality",
			bitOffset: 29,
			bitLength: 3,
			convert: (raw) => raw, // 0-7 quality rating
			category: "transmission_calculated",
			minValue: 0,
			maxValue: 7,
			pid: makePid(0x54),
		},
	],
};

// ---------------------------------------------------------------------------
// Master Registry
// ---------------------------------------------------------------------------

/**
 * Complete registry of all SST data blocks and their parameters.
 *
 * Use this to look up block definitions by block ID.
 *
 * @example
 * // Find block by ID
 * const block = SST_BLOCKS.find(b => b.blockId === 'TRANS');
 *
 * @example
 * // Iterate all parameters across all blocks
 * for (const block of SST_BLOCKS) {
 *   for (const param of block.parameters) {
 *     console.log(`${block.blockId}.${param.name} = ${param.unit}`);
 *   }
 * }
 */
export const SST_BLOCKS: readonly SstBlockDef[] = [
	SST_TRANS_BLOCK,
	SST_PRES_BLOCK,
	SST_SLIP_BLOCK,
	SST_SOL_BLOCK,
	SST_STATE_BLOCK,
	SST_CALC_BLOCK,
] as const;

/**
 * Map from block ID to SstBlockDef for convenient access.
 *
 * @example
 * const transBlock = SST_BLOCK_BY_ID.get('TRANS');
 */
export const SST_BLOCK_BY_ID: ReadonlyMap<string, SstBlockDef> = new Map(
	SST_BLOCKS.map((block) => [block.blockId, block]),
);

/**
 * Map from PID (OBD-style synthetic ID) to parameter definition.
 *
 * @example
 * const param = SST_PARAM_BY_PID.get(0x8001); // Transmission Temperature
 */
export const SST_PARAM_BY_PID: ReadonlyMap<number, SstParameterDef> = new Map();

// Populate PID lookup on initialization
(() => {
	for (const block of SST_BLOCKS) {
		for (const param of block.parameters) {
			if (param.pid !== undefined) {
				(SST_PARAM_BY_PID as Map<number, SstParameterDef>).set(
					param.pid,
					param,
				);
			}
		}
	}
})();

/**
 * Extract a single parameter's physical value from a raw SST block buffer.
 *
 * @param buffer - Raw bytes from the SST block ECU response
 * @param param - Parameter definition from an SstBlockDef
 * @returns Converted physical value in the parameter's units
 * @throws Error if the bit range exceeds the buffer size
 *
 * @example
 * // Extract transmission temperature from SST_TRANS block response
 * const buffer = new Uint8Array([0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const tempDef = SST_TRANS_BLOCK.parameters[0]; // Temperature parameter
 * const temp = extractSstParameter(buffer, tempDef); // => 40°C (if raw was 80)
 */
export function extractSstParameter(
	buffer: Uint8Array,
	param: SstParameterDef,
): number {
	const raw = extractBits(buffer, param.bitOffset, param.bitLength);
	return param.convert(raw);
}

/**
 * Extract all parameters from an SST block and return a map of name → value.
 *
 * @param buffer - Raw bytes from the SST block ECU response
 * @param blockDef - Block definition with parameter metadata
 * @returns Map from parameter name to converted physical value
 *
 * @example
 * const buffer = new Uint8Array([0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const values = extractAllSstParameters(buffer, SST_TRANS_BLOCK);
 * // { "Transmission Temperature": 40, "Gear Selection": 0, ... }
 */
export function extractAllSstParameters(
	buffer: Uint8Array,
	blockDef: SstBlockDef,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const param of blockDef.parameters) {
		result[param.name] = extractSstParameter(buffer, param);
	}
	return result;
}

/**
 * Get all SST parameters as synthetic PID descriptors for logging/display.
 *
 * Returns an array of parameter definitions suitable for the live data panel,
 * CSV export, and other logging infrastructure that expects OBD-style PIDs.
 *
 * @returns Array of SST parameters with PID metadata
 *
 * @example
 * const pids = getAllSstParameterPids();
 * // Can be used with existing logging infrastructure
 * for (const param of pids) {
 *   console.log(`PID 0x${param.pid?.toString(16)} = ${param.name}`);
 * }
 */
export function getAllSstParameterPids(): SstParameterDef[] {
	const result: SstParameterDef[] = [];
	for (const block of SST_BLOCKS) {
		for (const param of block.parameters) {
			if (param.pid !== undefined) {
				result.push(param);
			}
		}
	}
	return result;
}

/**
 * Get total number of SST parameters across all blocks.
 *
 * @returns Total parameter count
 *
 * @example
 * console.log(`SST registry contains ${getSstParameterCount()} parameters`);
 */
export function getSstParameterCount(): number {
	let count = 0;
	for (const block of SST_BLOCKS) {
		count += block.parameters.length;
	}
	return count;
}
