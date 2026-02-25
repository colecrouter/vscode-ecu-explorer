/**
 * Subaru SST Block Decoder
 *
 * Provides typed decoding functions for all SST (Subaru Select Monitor Transmission)
 * data blocks used in real-time telemetry via SSM protocol over K-line.
 *
 * Each `decode*` function takes a raw byte buffer (from the ECU response)
 * and returns a strongly-typed object with all parameter values already
 * converted to physical units.
 *
 * NOTE: K-line transport is currently not available (Phase 1 blocker).
 * This decoder is prepared for Phase 2 (streaming implementation).
 *
 * @module subaru/sst-decoder
 * @see SUBARU_EVOSCAN_FINDINGS.md
 * @see sst-parameters.ts
 */

import {
	extractAllSstParameters,
	extractSstParameter,
	getAllSstParameterPids,
	getSstParameterCount,
	SST_BLOCK_BY_ID,
	SST_BLOCKS,
	SST_CALC_BLOCK,
	SST_PRES_BLOCK,
	SST_SLIP_BLOCK,
	SST_SOL_BLOCK,
	SST_STATE_BLOCK,
	SST_TRANS_BLOCK,
	type SstBlockDef,
	type SstParameterDef,
} from "./sst-parameters";

export type { SstBlockDef, SstParameterDef };
export {
	SST_BLOCKS,
	SST_BLOCK_BY_ID,
	SST_CALC_BLOCK,
	SST_PRES_BLOCK,
	SST_SLIP_BLOCK,
	SST_SOL_BLOCK,
	SST_STATE_BLOCK,
	SST_TRANS_BLOCK,
	extractSstParameter,
	extractAllSstParameters,
	getAllSstParameterPids,
	getSstParameterCount,
};

// ---------------------------------------------------------------------------
// Typed result interfaces for each SST block
// ---------------------------------------------------------------------------

/**
 * Decoded values from SST Block TRANS (Transmission Core).
 * All values are in physical units.
 */
export interface SstTransData {
	/** Transmission fluid temperature (°C) */
	transmissionTemperature: number;
	/** Gear selection from shift lever (0=P, 1=R, 2=N, 3=D, 4=S, 5=L) */
	gearSelection: number;
	/** Actual engaged gear (0=P, 1=R, 2=N, 3=D, 4=S, 5=L, or gear number) */
	actualGear: number;
	/** Gear engagement percentage (0-100%) */
	gearEngagementPercent: number;
	/** Shift fork position in mechanical steps */
	shiftForkPosition: number;
}

/**
 * Decoded values from SST Block PRES (Transmission Pressure).
 */
export interface SstPresData {
	/** Clutch 1 pressure (Bar) */
	clutch1Pressure: number;
	/** Clutch 2 pressure (Bar) */
	clutch2Pressure: number;
	/** Line pressure (Bar) — primary hydraulic pressure */
	linePressure: number;
	/** Actuator pressure (Bar) — shift control pressure */
	actuatorPressure: number;
	/** Pressure control solenoid duty cycle (%) */
	pressureSolenoidDuty: number;
}

/**
 * Decoded values from SST Block SLIP (Wheel Speed & Transmission Slip).
 */
export interface SstSlipData {
	/** Front right wheel speed (km/h) */
	wheelSpeedFR: number;
	/** Front left wheel speed (km/h) */
	wheelSpeedFL: number;
	/** Rear right wheel speed (km/h) */
	wheelSpeedRR: number;
	/** Rear left wheel speed (km/h) */
	wheelSpeedRL: number;
	/** Transmission slip percentage (0-100%) */
	transmissionSlip: number;
	/** Vehicle speed averaged from all wheels (km/h) */
	vehicleSpeed: number;
}

/**
 * Decoded values from SST Block SOL (Solenoid Control).
 */
export interface SstSolData {
	/** Solenoid 1 current (mA) */
	solenoid1Current: number;
	/** Solenoid 2 current (mA) */
	solenoid2Current: number;
	/** Solenoid 3 current (mA) */
	solenoid3Current: number;
	/** PWM duty cycle for solenoid control (%) */
	pwmDutyCycle: number;
}

/**
 * Transmission operational mode enumeration.
 */
export const TRANS_MODE = {
	NORMAL: 0,
	SPORT: 1,
	MANUAL: 2,
	ECO: 3,
	SNOW: 4,
	UNKNOWN: 7,
} as const;

/** Transmission mode values */
export type TransMode = (typeof TRANS_MODE)[keyof typeof TRANS_MODE];

/**
 * Decoded values from SST Block STATE (Transmission State).
 */
export interface SstStateData {
	/** Transmission operating mode (0=Normal, 1=Sport, 2=Manual, etc.) */
	transmissionMode: TransMode;
	/** VIN lock protection state (0=unlocked, 1=locked) */
	vinLockState: boolean;
	/** Transmission fault flag (0=OK, 1=fault detected) */
	transmissionFault: boolean;
	/** Overheat warning flag (0=OK, 1=overheat warning) */
	overheatWarning: boolean;
	/** Number of times VIN has been written (for security tracking) */
	vinWriteCounter: number;
	/** Total number of gear shifts recorded */
	shiftAttemptCounter: number;
	/** Number of transmission fluid changes performed */
	oilChangeCounter: number;
}

/**
 * Decoded values from SST Block CALC (Calculated Transmission Values).
 */
export interface SstCalcData {
	/** Calculated transmission load percentage (0-100%) */
	transmissionLoad: number;
	/** Estimated transmission efficiency (0-100%) */
	transmissionEfficiency: number;
	/** Duration of current or last shift (ms) */
	currentShiftTime: number;
	/** Target gear for upcoming shift (0-6) */
	targetGear: number;
	/** Shift quality rating (0-7; higher = better) */
	shiftQuality: number;
}

// ---------------------------------------------------------------------------
// Block-specific decoder functions
// ---------------------------------------------------------------------------

/**
 * Decode an SST Block TRANS (Transmission Core) response buffer.
 *
 * @param data - 8-byte buffer from the ECU response to TRANS block read
 * @returns Decoded transmission core values
 * @throws Error if buffer is less than 8 bytes
 *
 * @example
 * const response = new Uint8Array([0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const trans = decodeSstTrans(response);
 * // trans.transmissionTemperature === 40.0   (0x50 - 40 = 80 - 40 = 40°C)
 */
export function decodeSstTrans(data: Uint8Array): SstTransData {
	if (data.length < SST_TRANS_BLOCK.blockSize) {
		throw new Error(
			`SST_TRANS buffer too small: expected ${SST_TRANS_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [tempDef, gearSelDef, actualGearDef, engagementDef, forkPosDef] =
		SST_TRANS_BLOCK.parameters;
	return {
		transmissionTemperature: extractSstParameter(data, tempDef!),
		gearSelection: extractSstParameter(data, gearSelDef!),
		actualGear: extractSstParameter(data, actualGearDef!),
		gearEngagementPercent: extractSstParameter(data, engagementDef!),
		shiftForkPosition: extractSstParameter(data, forkPosDef!),
	};
}

/**
 * Decode an SST Block PRES (Transmission Pressure) response buffer.
 *
 * @param data - 8-byte buffer from the ECU response to PRES block read
 * @returns Decoded pressure values
 * @throws Error if buffer is less than 8 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const pres = decodeSstPres(buffer);
 */
export function decodeSstPres(data: Uint8Array): SstPresData {
	if (data.length < SST_PRES_BLOCK.blockSize) {
		throw new Error(
			`SST_PRES buffer too small: expected ${SST_PRES_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [clk1Def, clk2Def, lineDef, actDef, pwmDef] = SST_PRES_BLOCK.parameters;
	return {
		clutch1Pressure: extractSstParameter(data, clk1Def!),
		clutch2Pressure: extractSstParameter(data, clk2Def!),
		linePressure: extractSstParameter(data, lineDef!),
		actuatorPressure: extractSstParameter(data, actDef!),
		pressureSolenoidDuty: extractSstParameter(data, pwmDef!),
	};
}

/**
 * Decode an SST Block SLIP (Wheel Speed & Transmission Slip) response buffer.
 *
 * @param data - 10-byte buffer from the ECU response to SLIP block read
 * @returns Decoded wheel speed and slip values
 * @throws Error if buffer is less than 10 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const slip = decodeSstSlip(buffer);
 */
export function decodeSstSlip(data: Uint8Array): SstSlipData {
	if (data.length < SST_SLIP_BLOCK.blockSize) {
		throw new Error(
			`SST_SLIP buffer too small: expected ${SST_SLIP_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [frDef, flDef, rrDef, rlDef, slipDef, vspeedDef] =
		SST_SLIP_BLOCK.parameters;
	return {
		wheelSpeedFR: extractSstParameter(data, frDef!),
		wheelSpeedFL: extractSstParameter(data, flDef!),
		wheelSpeedRR: extractSstParameter(data, rrDef!),
		wheelSpeedRL: extractSstParameter(data, rlDef!),
		transmissionSlip: extractSstParameter(data, slipDef!),
		vehicleSpeed: extractSstParameter(data, vspeedDef!),
	};
}

/**
 * Decode an SST Block SOL (Solenoid Control) response buffer.
 *
 * @param data - 6-byte buffer from the ECU response to SOL block read
 * @returns Decoded solenoid control values
 * @throws Error if buffer is less than 6 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const sol = decodeSstSol(buffer);
 */
export function decodeSstSol(data: Uint8Array): SstSolData {
	if (data.length < SST_SOL_BLOCK.blockSize) {
		throw new Error(
			`SST_SOL buffer too small: expected ${SST_SOL_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [sol1Def, sol2Def, sol3Def, pwmDef] = SST_SOL_BLOCK.parameters;
	return {
		solenoid1Current: extractSstParameter(data, sol1Def!),
		solenoid2Current: extractSstParameter(data, sol2Def!),
		solenoid3Current: extractSstParameter(data, sol3Def!),
		pwmDutyCycle: extractSstParameter(data, pwmDef!),
	};
}

/**
 * Decode an SST Block STATE (Transmission State) response buffer.
 *
 * @param data - 8-byte buffer from the ECU response to STATE block read
 * @returns Decoded transmission state values
 * @throws Error if buffer is less than 8 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const state = decodeSstState(buffer);
 */
export function decodeSstState(data: Uint8Array): SstStateData {
	if (data.length < SST_STATE_BLOCK.blockSize) {
		throw new Error(
			`SST_STATE buffer too small: expected ${SST_STATE_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [modeDef, vinDef, faultDef, overheatDef, counterDef, shiftDef, oilDef] =
		SST_STATE_BLOCK.parameters;
	return {
		transmissionMode: extractSstParameter(data, modeDef!) as TransMode,
		vinLockState: extractSstParameter(data, vinDef!) === 1,
		transmissionFault: extractSstParameter(data, faultDef!) === 1,
		overheatWarning: extractSstParameter(data, overheatDef!) === 1,
		vinWriteCounter: extractSstParameter(data, counterDef!),
		shiftAttemptCounter: extractSstParameter(data, shiftDef!),
		oilChangeCounter: extractSstParameter(data, oilDef!),
	};
}

/**
 * Decode an SST Block CALC (Calculated Values) response buffer.
 *
 * @param data - 6-byte buffer from the ECU response to CALC block read
 * @returns Decoded calculated transmission values
 * @throws Error if buffer is less than 6 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x80, 0x80, 0x00, 0x00, 0x00, 0x00]);
 * const calc = decodeSstCalc(buffer);
 */
export function decodeSstCalc(data: Uint8Array): SstCalcData {
	if (data.length < SST_CALC_BLOCK.blockSize) {
		throw new Error(
			`SST_CALC buffer too small: expected ${SST_CALC_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [loadDef, effDef, timeDef, targetDef, qualityDef] =
		SST_CALC_BLOCK.parameters;
	return {
		transmissionLoad: extractSstParameter(data, loadDef!),
		transmissionEfficiency: extractSstParameter(data, effDef!),
		currentShiftTime: extractSstParameter(data, timeDef!),
		targetGear: extractSstParameter(data, targetDef!),
		shiftQuality: extractSstParameter(data, qualityDef!),
	};
}

// ---------------------------------------------------------------------------
// Union types and generic decoders
// ---------------------------------------------------------------------------

/**
 * Union type of all SST block decoded data types.
 */
export type SstBlockData =
	| SstTransData
	| SstPresData
	| SstSlipData
	| SstSolData
	| SstStateData
	| SstCalcData;

/**
 * Generic SST block decoder that dispatches by block ID.
 *
 * @param data - Raw bytes from the ECU response
 * @param blockId - Block identifier: 'TRANS', 'PRES', 'SLIP', 'SOL', 'STATE', or 'CALC'
 * @returns Decoded block data with physical values
 * @throws Error if blockId is unknown or buffer is too small
 *
 * @example
 * const buffer = new Uint8Array([0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
 * const result = decodeSstBlock(buffer, 'TRANS');
 * // result as SstTransData
 */
export function decodeSstBlock(
	data: Uint8Array,
	blockId: "TRANS" | "PRES" | "SLIP" | "SOL" | "STATE" | "CALC",
): SstBlockData {
	switch (blockId) {
		case "TRANS":
			return decodeSstTrans(data);
		case "PRES":
			return decodeSstPres(data);
		case "SLIP":
			return decodeSstSlip(data);
		case "SOL":
			return decodeSstSol(data);
		case "STATE":
			return decodeSstState(data);
		case "CALC":
			return decodeSstCalc(data);
		default: {
			const _exhaustive: never = blockId;
			throw new Error(`Unknown SST block type: ${_exhaustive}`);
		}
	}
}

/**
 * Get block definition by ID.
 *
 * @param blockId - Block identifier
 * @returns Block definition, or undefined if not found
 *
 * @example
 * const def = getSstBlockDefinition('TRANS');
 */
export function getSstBlockDefinition(
	blockId: string,
): SstBlockDef | undefined {
	return SST_BLOCK_BY_ID.get(blockId);
}

/**
 * Validate buffer size against block definition.
 *
 * @param data - Raw buffer to validate
 * @param blockId - Expected block ID
 * @returns true if buffer is large enough for the block
 *
 * @example
 * if (!validateSstBlockBuffer(buffer, 'TRANS')) {
 *   throw new Error('Buffer too small for TRANS block');
 * }
 */
export function validateSstBlockBuffer(
	data: Uint8Array,
	blockId: string,
): boolean {
	const blockDef = SST_BLOCK_BY_ID.get(blockId);
	if (!blockDef) {
		return false;
	}
	return data.length >= blockDef.blockSize;
}

/**
 * Decode all SST blocks into a combined data object.
 *
 * @param blocks - Map of block ID to raw buffer
 * @returns Map of block ID to decoded data
 * @throws Error if any block fails to decode
 *
 * @example
 * const blocks = {
 *   'TRANS': transBuffer,
 *   'PRES': presBuffer,
 *   // ...
 * };
 * const decoded = decodeSstBlockSet(blocks);
 */
export function decodeSstBlockSet(
	blocks: Record<string, Uint8Array>,
): Record<string, SstBlockData> {
	const result: Record<string, SstBlockData> = {};
	for (const [blockId, data] of Object.entries(blocks)) {
		if (
			blockId === "TRANS" ||
			blockId === "PRES" ||
			blockId === "SLIP" ||
			blockId === "SOL" ||
			blockId === "STATE" ||
			blockId === "CALC"
		) {
			result[blockId] = decodeSstBlock(data, blockId);
		}
	}
	return result;
}
