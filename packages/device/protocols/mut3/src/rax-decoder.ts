/**
 * MUT-III RAX Block Decoder
 *
 * Provides typed decoding functions for all 8 RAX (Real-Time Advanced Logging)
 * data blocks used in Mitsubishi MUT-III ECU real-time telemetry.
 *
 * Each `decode*` function takes a raw byte buffer (from the ECU response)
 * and returns a strongly-typed object with all parameter values already
 * converted to physical units.
 *
 * @module mut3/rax-decoder
 * @see MUT3_LOGGING_CAPABILITIES.md
 * @see rax-parameters.ts
 */

import {
	extractAllRaxParameters,
	extractRaxParameter,
	RAX_A_BLOCK,
	RAX_B_BLOCK,
	RAX_BLOCK_BY_REQUEST_ID,
	RAX_BLOCKS,
	RAX_C_BLOCK,
	RAX_D_BLOCK,
	RAX_E_BLOCK,
	RAX_F_BLOCK,
	RAX_G_BLOCK,
	RAX_H_BLOCK,
	type RaxBlockDef,
} from "./rax-parameters";

export type { RaxBlockDef };
export {
	RAX_A_BLOCK,
	RAX_B_BLOCK,
	RAX_C_BLOCK,
	RAX_D_BLOCK,
	RAX_E_BLOCK,
	RAX_F_BLOCK,
	RAX_G_BLOCK,
	RAX_H_BLOCK,
	RAX_BLOCKS,
	RAX_BLOCK_BY_REQUEST_ID,
	extractRaxParameter,
	extractAllRaxParameters,
};

// ---------------------------------------------------------------------------
// Typed result interfaces for each RAX block
// ---------------------------------------------------------------------------

/**
 * Decoded values from RAX Block A (Fuel Trim Adjustments).
 * All values are in physical units (%) relative to stoichiometric AFR.
 *
 * Positive trim means ECU is adding fuel (running lean).
 * Negative trim means ECU is removing fuel (running rich).
 */
export interface RaxAData {
	/** Short-term fuel trim bank 1 (%) — fast O2 feedback */
	stftBank1: number;
	/** Long-term fuel trim bank 1 (%) — adaptive learned correction */
	ltftBank1: number;
	/** Short-term fuel trim bank 2 (%) — only on bi-bank engines */
	stftBank2: number;
	/** Long-term fuel trim bank 2 (%) — only on bi-bank engines */
	ltftBank2: number;
}

/**
 * Decoded values from RAX Block B (Fuel & Oxygen).
 */
export interface RaxBData {
	/** Air-fuel ratio (λ) — 14.7 is stoichiometric for gasoline */
	afr: number;
	/** Engine load at AFR measurement (%) */
	loadAfr: number;
	/** Left (primary) O2 sensor voltage (V) — wideband lambda */
	o2Left: number;
	/** Right (secondary) O2 sensor voltage (V) */
	o2Right: number;
	/** Injector pulse width (ms) — time injectors are open per cycle */
	injectorPulseWidth: number;
}

/**
 * Decoded values from RAX Block C (Engine Performance).
 */
export interface RaxCData {
	/** Engine RPM */
	rpm: number;
	/** Accumulated knock sensor counts — non-zero indicates knock activity */
	knockSum: number;
	/** Ignition timing advance (°BTDC) — positive = advanced */
	timingAdvance: number;
	/** Engine load for timing calculation (%) */
	loadTiming: number;
}

/**
 * Decoded values from RAX Block D (Intake & Boost).
 */
export interface RaxDData {
	/** Atmospheric (barometric) pressure (kPa) */
	barometer: number;
	/** Manifold absolute pressure (kPa) */
	map: number;
	/** Boost gauge pressure (kPa) — MAP minus barometer */
	boostPressure: number;
	/** Mass air flow rate (g/s) */
	maf: number;
}

/**
 * VVT control status enumeration.
 */
export const VVT_STATUS = {
	INACTIVE: 0,
	ACTIVE: 1,
	ERROR: 2,
	UNKNOWN: 3,
} as const;

/** VVT control status values */
export type VvtStatus = (typeof VVT_STATUS)[keyof typeof VVT_STATUS];

/**
 * Decoded values from RAX Block E (Variable Valve Timing).
 */
export interface RaxEData {
	/** Intake cam timing angle (°CRANKSHAFT) — negative = retarded */
	intakeVvtAngle: number;
	/** Exhaust cam timing angle (°CRANKSHAFT) — negative = retarded */
	exhaustVvtAngle: number;
	/** VVT actuator oil pressure (Bar) */
	vvtOilPressure: number;
	/** VVT control system status (0=Inactive, 1=Active, 2=Error) */
	vvtControlStatus: VvtStatus;
}

/**
 * Decoded values from RAX Block F (Throttle & Intake Temperatures).
 */
export interface RaxFData {
	/** Throttle position sensor (%) */
	tps: number;
	/** Accelerator pedal position (%) */
	app: number;
	/** Intake air temperature (°C) */
	iat: number;
	/** Waste gate duty cycle (%) — higher = more boost target */
	wgdc: number;
}

/**
 * Decoded values from RAX Block G (Vehicle Dynamics).
 */
export interface RaxGData {
	/** Vehicle speed (km/h) — from wheel speed sensors */
	vehicleSpeed: number;
	/** Battery/charging system voltage (V) */
	batteryVoltage: number;
	/** Engine coolant temperature (°C) */
	ect: number;
	/** Ambient/manifold air temperature (°C) */
	mat: number;
}

/**
 * Decoded values from RAX Block H (Calculated Engine Values).
 */
export interface RaxHData {
	/** Calculated mass air flow (g/s) — derived from MAP/RPM/IAT */
	calculatedMaf: number;
	/** Calculated engine load — predicted engine load (%) */
	calculatedLoadPe: number;
	/** Target AFR from ROM lookup table (λ) */
	targetAfr: number;
	/** Actual minus target AFR deviation (λ) — positive = running lean */
	actualAfrDelta: number;
}

// ---------------------------------------------------------------------------
// Block-specific decoder functions
// ---------------------------------------------------------------------------

/**
 * Decode a RAX Block A (Fuel Trim) response buffer.
 *
 * @param data - 4-byte buffer from the ECU response to RequestID 0x238051ac
 * @returns Decoded fuel trim values in percent
 * @throws Error if buffer is less than 4 bytes
 *
 * @example
 * const response = new Uint8Array([0x80, 0x90, 0x70, 0x88]);
 * const trims = decodeRaxA(response);
 * // trims.stftBank1 === 0.0    (128 - 128) * 0.1 = 0%
 * // trims.ltftBank1 === 1.6   (144 - 128) * 0.1 = +1.6%
 * // trims.stftBank2 === -1.6  (112 - 128) * 0.1 = -1.6%
 * // trims.ltftBank2 === 0.8   (136 - 128) * 0.1 = +0.8%
 */
export function decodeRaxA(data: Uint8Array): RaxAData {
	if (data.length < RAX_A_BLOCK.blockSize) {
		throw new Error(
			`RAX_A buffer too small: expected ${RAX_A_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [stft1Def, ltft1Def, stft2Def, ltft2Def] = RAX_A_BLOCK.parameters;
	return {
		stftBank1: extractRaxParameter(data, stft1Def!),
		ltftBank1: extractRaxParameter(data, ltft1Def!),
		stftBank2: extractRaxParameter(data, stft2Def!),
		ltftBank2: extractRaxParameter(data, ltft2Def!),
	};
}

/**
 * Decode a RAX Block B (Fuel & Oxygen) response buffer.
 *
 * @param data - 6-byte buffer from the ECU response to RequestID 0x238051a8
 * @returns Decoded fuel and oxygen sensor values
 * @throws Error if buffer is less than 6 bytes
 *
 * @example
 * const buffer = new Uint8Array([0x00, 0x00, 0x80, 0x80, 0x00, 0x00]);
 * const fuel = decodeRaxB(buffer);
 * // fuel.afr === 8.0   (0 * 0.005 + 8)
 */
export function decodeRaxB(data: Uint8Array): RaxBData {
	if (data.length < RAX_B_BLOCK.blockSize) {
		throw new Error(
			`RAX_B buffer too small: expected ${RAX_B_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [afrDef, loadDef, o2LDef, o2RDef, injDef] = RAX_B_BLOCK.parameters;
	return {
		afr: extractRaxParameter(data, afrDef!),
		loadAfr: extractRaxParameter(data, loadDef!),
		o2Left: extractRaxParameter(data, o2LDef!),
		o2Right: extractRaxParameter(data, o2RDef!),
		injectorPulseWidth: extractRaxParameter(data, injDef!),
	};
}

/**
 * Decode a RAX Block C (Engine Performance) response buffer.
 *
 * @param data - 5-byte buffer from the ECU response to RequestID 0x238051b0
 * @returns Decoded engine performance values
 * @throws Error if buffer is less than 5 bytes
 *
 * @example
 * // Buffer with RPM ~2000, no knock, +10° timing, 50% load
 * const buffer = new Uint8Array([0x19, 0x80, 0x1E, 0x20, 0x20]);
 * const engine = decodeRaxC(buffer);
 */
export function decodeRaxC(data: Uint8Array): RaxCData {
	if (data.length < RAX_C_BLOCK.blockSize) {
		throw new Error(
			`RAX_C buffer too small: expected ${RAX_C_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [rpmDef, knockDef, timingDef, loadDef] = RAX_C_BLOCK.parameters;
	return {
		rpm: extractRaxParameter(data, rpmDef!),
		knockSum: extractRaxParameter(data, knockDef!),
		timingAdvance: extractRaxParameter(data, timingDef!),
		loadTiming: extractRaxParameter(data, loadDef!),
	};
}

/**
 * Decode a RAX Block D (Intake & Boost) response buffer.
 *
 * @param data - 4-byte buffer from the ECU response to RequestID 0x238051b4
 * @returns Decoded intake and boost pressure values
 * @throws Error if buffer is less than 4 bytes
 */
export function decodeRaxD(data: Uint8Array): RaxDData {
	if (data.length < RAX_D_BLOCK.blockSize) {
		throw new Error(
			`RAX_D buffer too small: expected ${RAX_D_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [baroDef, mapDef, boostDef, mafDef] = RAX_D_BLOCK.parameters;
	return {
		barometer: extractRaxParameter(data, baroDef!),
		map: extractRaxParameter(data, mapDef!),
		boostPressure: extractRaxParameter(data, boostDef!),
		maf: extractRaxParameter(data, mafDef!),
	};
}

/**
 * Decode a RAX Block E (Variable Valve Timing) response buffer.
 *
 * @param data - 4-byte buffer from the ECU response to RequestID 0x238051b8
 * @returns Decoded VVT parameters
 * @throws Error if buffer is less than 4 bytes
 */
export function decodeRaxE(data: Uint8Array): RaxEData {
	if (data.length < RAX_E_BLOCK.blockSize) {
		throw new Error(
			`RAX_E buffer too small: expected ${RAX_E_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [intakeDef, exhaustDef, oilPDef, statusDef] = RAX_E_BLOCK.parameters;
	return {
		intakeVvtAngle: extractRaxParameter(data, intakeDef!),
		exhaustVvtAngle: extractRaxParameter(data, exhaustDef!),
		vvtOilPressure: extractRaxParameter(data, oilPDef!),
		vvtControlStatus: extractRaxParameter(data, statusDef!) as VvtStatus,
	};
}

/**
 * Decode a RAX Block F (Throttle & Intake Temps) response buffer.
 *
 * @param data - 4-byte buffer from the ECU response to RequestID 0x238051bc
 * @returns Decoded throttle and temperature values
 * @throws Error if buffer is less than 4 bytes
 */
export function decodeRaxF(data: Uint8Array): RaxFData {
	if (data.length < RAX_F_BLOCK.blockSize) {
		throw new Error(
			`RAX_F buffer too small: expected ${RAX_F_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [tpsDef, appDef, iatDef, wgdcDef] = RAX_F_BLOCK.parameters;
	return {
		tps: extractRaxParameter(data, tpsDef!),
		app: extractRaxParameter(data, appDef!),
		iat: extractRaxParameter(data, iatDef!),
		wgdc: extractRaxParameter(data, wgdcDef!),
	};
}

/**
 * Decode a RAX Block G (Vehicle Dynamics) response buffer.
 *
 * @param data - 4-byte buffer from the ECU response to RequestID 0x238051c0
 * @returns Decoded vehicle dynamics values
 * @throws Error if buffer is less than 4 bytes
 */
export function decodeRaxG(data: Uint8Array): RaxGData {
	if (data.length < RAX_G_BLOCK.blockSize) {
		throw new Error(
			`RAX_G buffer too small: expected ${RAX_G_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [speedDef, battDef, ectDef, matDef] = RAX_G_BLOCK.parameters;
	return {
		vehicleSpeed: extractRaxParameter(data, speedDef!),
		batteryVoltage: extractRaxParameter(data, battDef!),
		ect: extractRaxParameter(data, ectDef!),
		mat: extractRaxParameter(data, matDef!),
	};
}

/**
 * Decode a RAX Block H (Calculated Values) response buffer.
 *
 * @param data - 5-byte buffer from the ECU response to RequestID 0x238051c4
 * @returns Decoded calculated engine values
 * @throws Error if buffer is less than 5 bytes
 */
export function decodeRaxH(data: Uint8Array): RaxHData {
	if (data.length < RAX_H_BLOCK.blockSize) {
		throw new Error(
			`RAX_H buffer too small: expected ${RAX_H_BLOCK.blockSize} bytes, got ${data.length}`,
		);
	}
	const [mafDef, loadDef, targetAfrDef, afrDeltaDef] = RAX_H_BLOCK.parameters;
	return {
		calculatedMaf: extractRaxParameter(data, mafDef!),
		calculatedLoadPe: extractRaxParameter(data, loadDef!),
		targetAfr: extractRaxParameter(data, targetAfrDef!),
		actualAfrDelta: extractRaxParameter(data, afrDeltaDef!),
	};
}

/**
 * Union type of all RAX block decoded data types.
 */
export type RaxBlockData =
	| RaxAData
	| RaxBData
	| RaxCData
	| RaxDData
	| RaxEData
	| RaxFData
	| RaxGData
	| RaxHData;

/**
 * Generic RAX block decoder that dispatches by block type letter.
 *
 * @param data - Raw bytes from the ECU response
 * @param blockType - Block identifier: 'A' through 'H'
 * @returns Decoded block data with physical values
 * @throws Error if blockType is unknown or buffer is too small
 *
 * @example
 * const buffer = new Uint8Array([0x80, 0x90, 0x70, 0x88]);
 * const result = decodeRaxBlock(buffer, 'A');
 * // result as RaxAData: { stftBank1: 0, ltftBank1: 1.6, ... }
 */
export function decodeRaxBlock(
	data: Uint8Array,
	blockType: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H",
): RaxBlockData {
	switch (blockType) {
		case "A":
			return decodeRaxA(data);
		case "B":
			return decodeRaxB(data);
		case "C":
			return decodeRaxC(data);
		case "D":
			return decodeRaxD(data);
		case "E":
			return decodeRaxE(data);
		case "F":
			return decodeRaxF(data);
		case "G":
			return decodeRaxG(data);
		case "H":
			return decodeRaxH(data);
		default: {
			const _exhaustive: never = blockType;
			throw new Error(`Unknown RAX block type: ${_exhaustive}`);
		}
	}
}

/**
 * Decode a RAX block by its RequestID.
 *
 * This is the primary entry point when handling live ECU responses,
 * where you know the RequestID but not the block letter.
 *
 * @param data - Raw bytes from the ECU response
 * @param requestId - The RequestID sent to the ECU to retrieve this block
 * @returns Decoded block data with physical values, or null if requestId unknown
 *
 * @example
 * // In a protocol handler receiving live data
 * const decoded = decodeRaxByRequestId(responseBuffer, 0x238051b0);
 * if (decoded && 'rpm' in decoded) {
 *   console.log(`RPM: ${decoded.rpm}`);
 * }
 */
export function decodeRaxByRequestId(
	data: Uint8Array,
	requestId: number,
): RaxBlockData | null {
	const blockDef = RAX_BLOCK_BY_REQUEST_ID.get(requestId);
	if (!blockDef) {
		return null;
	}
	return decodeRaxBlock(data, blockDef.blockId);
}
