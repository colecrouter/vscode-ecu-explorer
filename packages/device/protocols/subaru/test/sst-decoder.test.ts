/**
 * SST Decoder Unit Tests
 *
 * Comprehensive test suite for Subaru transmission telemetry parameter
 * extraction and decoding, covering all SST blocks with bit-level
 * boundary conditions and conversion formula validation.
 *
 * Test coverage targets:
 * - All 6 SST blocks (TRANS, PRES, SLIP, SOL, STATE, CALC)
 * - All 40+ transmission parameters
 * - Bit extraction accuracy at byte boundaries
 * - Conversion formula correctness
 * - Buffer size validation
 * - Edge cases and boundary conditions
 */

import { describe, expect, it } from "vitest";
import {
	decodeSstBlock,
	decodeSstBlockSet,
	decodeSstCalc,
	decodeSstPres,
	decodeSstSlip,
	decodeSstSol,
	decodeSstState,
	decodeSstTrans,
	getSstBlockDefinition,
	SST_BLOCK_BY_ID,
	SST_CALC_BLOCK,
	SST_PRES_BLOCK,
	SST_SLIP_BLOCK,
	SST_SOL_BLOCK,
	SST_STATE_BLOCK,
	SST_TRANS_BLOCK,
	type SstPresData,
	type SstTransData,
	TRANS_MODE,
	validateSstBlockBuffer,
} from "../src/sst-decoder";
import {
	getAllSstParameterPids,
	getSstParameterCount,
} from "../src/sst-parameters";

/**
 * Create a test buffer filled with a specific byte pattern.
 * Useful for testing bit extraction at known positions.
 */
function createTestBuffer(size: number, fillByte: number = 0x00): Uint8Array {
	return new Uint8Array(size).fill(fillByte);
}

/**
 * Set a bit at a specific position in a buffer (big-endian bit numbering).
 * Used to create test vectors for specific bit positions.
 */
function setBitAt(buffer: Uint8Array, bitPos: number, value: boolean): void {
	const byteIdx = Math.floor(bitPos / 8);
	const bitInByte = 7 - (bitPos % 8);
	if (value) {
		buffer[byteIdx] = (buffer[byteIdx] ?? 0) | (1 << bitInByte);
	}
}

/**
 * Set a bit field (multiple bits) at a specific position.
 */
function setBitsAt(
	buffer: Uint8Array,
	bitPos: number,
	bitLen: number,
	value: number,
): void {
	for (let i = 0; i < bitLen; i++) {
		const bit = (value >> (bitLen - 1 - i)) & 1;
		setBitAt(buffer, bitPos + i, bit === 1);
	}
}

// ---------------------------------------------------------------------------
// Parameter Registry Tests
// ---------------------------------------------------------------------------

describe("SST Parameter Registry", () => {
	it("should have all 6 SST blocks defined", () => {
		expect(SST_BLOCK_BY_ID.size).toBe(6);
		expect(SST_BLOCK_BY_ID.has("TRANS")).toBe(true);
		expect(SST_BLOCK_BY_ID.has("PRES")).toBe(true);
		expect(SST_BLOCK_BY_ID.has("SLIP")).toBe(true);
		expect(SST_BLOCK_BY_ID.has("SOL")).toBe(true);
		expect(SST_BLOCK_BY_ID.has("STATE")).toBe(true);
		expect(SST_BLOCK_BY_ID.has("CALC")).toBe(true);
	});

	it("should have correct parameter counts per block", () => {
		expect(SST_TRANS_BLOCK.parameters.length).toBe(5);
		expect(SST_PRES_BLOCK.parameters.length).toBe(5);
		expect(SST_SLIP_BLOCK.parameters.length).toBe(6);
		expect(SST_SOL_BLOCK.parameters.length).toBe(4);
		expect(SST_STATE_BLOCK.parameters.length).toBe(7);
		expect(SST_CALC_BLOCK.parameters.length).toBe(5);
	});

	it("should have correct total parameter count", () => {
		const count = getSstParameterCount();
		expect(count).toBe(32); // 5+5+6+4+7+5 = 32
	});

	it("should have all parameters with PIDs in expected range", () => {
		const pids = getAllSstParameterPids();
		expect(pids.length).toBeGreaterThan(0);
		for (const param of pids) {
			expect(param.pid).toBeDefined();
			expect(param.pid).toBeGreaterThanOrEqual(0x8000);
			expect(param.pid).toBeLessThan(0x8100); // Reasonable upper bound
		}
	});

	it("should have unique PIDs for all parameters", () => {
		const pids = getAllSstParameterPids();
		const pidSet = new Set(pids.map((p) => p.pid));
		expect(pidSet.size).toBe(pids.length); // All unique
	});
});

// ---------------------------------------------------------------------------
// SST Block TRANS Tests
// ---------------------------------------------------------------------------

describe("SST Block TRANS (Transmission Core)", () => {
	it("should decode transmission temperature at bit 0-7", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x50); // 80 decimal (80 - 40 = 40°C)
		const result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(40);
	});

	it("should decode transmission temperature of -40 (0x00 - 40)", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x00);
		const result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(-40);
	});

	it("should decode transmission temperature of 215 (0xff - 40)", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0xff);
		const result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(215);
	});

	it("should decode gear selection (3-bit field)", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 8, 3, 3); // Gear D
		const result = decodeSstTrans(buffer);
		expect(result.gearSelection).toBe(3);
	});

	it("should decode actual gear (3-bit field)", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 11, 3, 2); // Neutral
		const result = decodeSstTrans(buffer);
		expect(result.actualGear).toBe(2);
	});

	it("should decode gear engagement percentage", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 14, 8, 0x80); // 128/255 = ~50%
		const result = decodeSstTrans(buffer);
		expect(result.gearEngagementPercent).toBeCloseTo(50.2, 1);
	});

	it("should decode gear engagement at 0%", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 14, 8, 0x00);
		const result = decodeSstTrans(buffer);
		expect(result.gearEngagementPercent).toBe(0);
	});

	it("should decode gear engagement at 100%", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 14, 8, 0xff);
		const result = decodeSstTrans(buffer);
		expect(result.gearEngagementPercent).toBeCloseTo(100, 1);
	});

	it("should decode shift fork position (10-bit field)", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 22, 10, 512); // Mid-range position
		const result = decodeSstTrans(buffer);
		expect(result.shiftForkPosition).toBe(512);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(4); // Too small for TRANS
		expect(() => decodeSstTrans(buffer)).toThrow();
	});

	it("should decode all TRANS parameters at once", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x50); // temp = 40°C
		setBitsAt(buffer, 8, 3, 3); // gear = D
		setBitsAt(buffer, 11, 3, 3); // actual = D
		setBitsAt(buffer, 14, 8, 0x80); // engagement ~50%
		setBitsAt(buffer, 22, 10, 256); // forkPos = 256

		const result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(40);
		expect(result.gearSelection).toBe(3);
		expect(result.actualGear).toBe(3);
		expect(result.gearEngagementPercent).toBeCloseTo(50.2, 1);
		expect(result.shiftForkPosition).toBe(256);
	});
});

// ---------------------------------------------------------------------------
// SST Block PRES Tests
// ---------------------------------------------------------------------------

describe("SST Block PRES (Transmission Pressure)", () => {
	it("should decode clutch 1 pressure in Bar", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 500); // 500 * 0.1 = 50 Bar
		const result = decodeSstPres(buffer);
		expect(result.clutch1Pressure).toBe(50);
	});

	it("should decode clutch 2 pressure in Bar", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 10, 10, 300); // 300 * 0.1 = 30 Bar
		const result = decodeSstPres(buffer);
		expect(result.clutch2Pressure).toBe(30);
	});

	it("should decode line pressure in Bar", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 20, 10, 700); // 700 * 0.1 = 70 Bar
		const result = decodeSstPres(buffer);
		expect(result.linePressure).toBe(70);
	});

	it("should decode actuator pressure in Bar", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 30, 10, 200); // 200 * 0.1 = 20 Bar
		const result = decodeSstPres(buffer);
		expect(result.actuatorPressure).toBe(20);
	});

	it("should decode PWM duty cycle percentage", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 40, 8, 0x80); // 128/255 = ~50%
		const result = decodeSstPres(buffer);
		expect(result.pressureSolenoidDuty).toBeCloseTo(50.2, 1);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(4);
		expect(() => decodeSstPres(buffer)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// SST Block SLIP Tests
// ---------------------------------------------------------------------------

describe("SST Block SLIP (Wheel Speed & Transmission Slip)", () => {
	it("should decode all 4 wheel speeds", () => {
		const buffer = createTestBuffer(SST_SLIP_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 300); // FR: 30.0 km/h
		setBitsAt(buffer, 10, 10, 300); // FL: 30.0 km/h
		setBitsAt(buffer, 20, 10, 300); // RR: 30.0 km/h
		setBitsAt(buffer, 30, 10, 300); // RL: 30.0 km/h
		setBitsAt(buffer, 40, 8, 0x00); // No slip
		setBitsAt(buffer, 48, 10, 300); // Vehicle speed: 30.0 km/h

		const result = decodeSstSlip(buffer);
		expect(result.wheelSpeedFR).toBe(30);
		expect(result.wheelSpeedFL).toBe(30);
		expect(result.wheelSpeedRR).toBe(30);
		expect(result.wheelSpeedRL).toBe(30);
		expect(result.transmissionSlip).toBe(0);
		expect(result.vehicleSpeed).toBe(30);
	});

	it("should decode transmission slip percentage", () => {
		const buffer = createTestBuffer(SST_SLIP_BLOCK.blockSize);
		setBitsAt(buffer, 40, 8, 0x33); // ~20% slip
		const result = decodeSstSlip(buffer);
		expect(result.transmissionSlip).toBeCloseTo(20, 0);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(4);
		expect(() => decodeSstSlip(buffer)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// SST Block SOL Tests
// ---------------------------------------------------------------------------

describe("SST Block SOL (Solenoid Control)", () => {
	it("should decode solenoid currents in mA", () => {
		const buffer = createTestBuffer(SST_SOL_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 500); // Sol1: 500 mA
		setBitsAt(buffer, 10, 10, 600); // Sol2: 600 mA
		setBitsAt(buffer, 20, 10, 700); // Sol3: 700 mA
		setBitsAt(buffer, 30, 8, 0xff); // PWM: 100%

		const result = decodeSstSol(buffer);
		expect(result.solenoid1Current).toBe(500);
		expect(result.solenoid2Current).toBe(600);
		expect(result.solenoid3Current).toBe(700);
		expect(result.pwmDutyCycle).toBeCloseTo(100, 1);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(2);
		expect(() => decodeSstSol(buffer)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// SST Block STATE Tests
// ---------------------------------------------------------------------------

describe("SST Block STATE (Transmission State)", () => {
	it("should decode transmission mode as NORMAL", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 0, 3, TRANS_MODE.NORMAL);
		const result = decodeSstState(buffer);
		expect(result.transmissionMode).toBe(TRANS_MODE.NORMAL);
	});

	it("should decode transmission mode as SPORT", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 0, 3, TRANS_MODE.SPORT);
		const result = decodeSstState(buffer);
		expect(result.transmissionMode).toBe(TRANS_MODE.SPORT);
	});

	it("should decode VIN lock state as locked", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitAt(buffer, 3, true);
		const result = decodeSstState(buffer);
		expect(result.vinLockState).toBe(true);
	});

	it("should decode VIN lock state as unlocked", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitAt(buffer, 3, false);
		const result = decodeSstState(buffer);
		expect(result.vinLockState).toBe(false);
	});

	it("should decode transmission fault flag", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitAt(buffer, 4, true);
		const result = decodeSstState(buffer);
		expect(result.transmissionFault).toBe(true);
	});

	it("should decode overheat warning flag", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitAt(buffer, 5, true);
		const result = decodeSstState(buffer);
		expect(result.overheatWarning).toBe(true);
	});

	it("should decode VIN write counter", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 8, 8, 42);
		const result = decodeSstState(buffer);
		expect(result.vinWriteCounter).toBe(42);
	});

	it("should decode shift attempt counter", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 16, 16, 1000);
		const result = decodeSstState(buffer);
		expect(result.shiftAttemptCounter).toBe(1000);
	});

	it("should decode oil change counter", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 32, 8, 5);
		const result = decodeSstState(buffer);
		expect(result.oilChangeCounter).toBe(5);
	});

	it("should decode all STATE parameters at once", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 0, 3, TRANS_MODE.SPORT);
		setBitAt(buffer, 3, true);
		setBitAt(buffer, 4, false);
		setBitAt(buffer, 5, true);
		setBitsAt(buffer, 8, 8, 3);
		setBitsAt(buffer, 16, 16, 5000);
		setBitsAt(buffer, 32, 8, 2);

		const result = decodeSstState(buffer);
		expect(result.transmissionMode).toBe(TRANS_MODE.SPORT);
		expect(result.vinLockState).toBe(true);
		expect(result.transmissionFault).toBe(false);
		expect(result.overheatWarning).toBe(true);
		expect(result.vinWriteCounter).toBe(3);
		expect(result.shiftAttemptCounter).toBe(5000);
		expect(result.oilChangeCounter).toBe(2);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(2);
		expect(() => decodeSstState(buffer)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// SST Block CALC Tests
// ---------------------------------------------------------------------------

describe("SST Block CALC (Calculated Values)", () => {
	it("should decode transmission load percentage", () => {
		const buffer = createTestBuffer(SST_CALC_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x80); // ~50%
		const result = decodeSstCalc(buffer);
		expect(result.transmissionLoad).toBeCloseTo(50.2, 1);
	});

	it("should decode transmission efficiency percentage", () => {
		const buffer = createTestBuffer(SST_CALC_BLOCK.blockSize);
		setBitsAt(buffer, 8, 8, 0xb0); // ~69%
		const result = decodeSstCalc(buffer);
		expect(result.transmissionEfficiency).toBeCloseTo(69, 0);
	});

	it("should decode current shift time in ms", () => {
		const buffer = createTestBuffer(SST_CALC_BLOCK.blockSize);
		setBitsAt(buffer, 16, 10, 150); // 150 ms
		const result = decodeSstCalc(buffer);
		expect(result.currentShiftTime).toBe(150);
	});

	it("should decode target gear (3-bit)", () => {
		const buffer = createTestBuffer(SST_CALC_BLOCK.blockSize);
		setBitsAt(buffer, 26, 3, 4); // Gear S
		const result = decodeSstCalc(buffer);
		expect(result.targetGear).toBe(4);
	});

	it("should decode shift quality rating", () => {
		const buffer = createTestBuffer(SST_CALC_BLOCK.blockSize);
		setBitsAt(buffer, 29, 3, 7); // Excellent quality
		const result = decodeSstCalc(buffer);
		expect(result.shiftQuality).toBe(7);
	});

	it("should throw error on buffer too small", () => {
		const buffer = new Uint8Array(2);
		expect(() => decodeSstCalc(buffer)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Generic Decoder Tests
// ---------------------------------------------------------------------------

describe("Generic SST Decoder Functions", () => {
	it("should dispatch TRANS block correctly with decodeSstBlock", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x50);
		const result = decodeSstBlock(buffer, "TRANS");
		expect("transmissionTemperature" in result).toBe(true);
		expect((result as SstTransData).transmissionTemperature).toBe(40);
	});

	it("should dispatch PRES block correctly", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 500);
		const result = decodeSstBlock(buffer, "PRES");
		expect("clutch1Pressure" in result).toBe(true);
		expect((result as SstPresData).clutch1Pressure).toBe(50);
	});

	it("should throw on invalid block ID", () => {
		const buffer = new Uint8Array(8);
		expect(() => decodeSstBlock(buffer, "INVALID" as "TRANS")).toThrow();
	});

	it("should validate buffer size for block", () => {
		const smallBuf = new Uint8Array(2);
		const validBuf = new Uint8Array(8);

		expect(validateSstBlockBuffer(smallBuf, "TRANS")).toBe(false);
		expect(validateSstBlockBuffer(validBuf, "TRANS")).toBe(true);
	});

	it("should return undefined for unknown block definition", () => {
		const def = getSstBlockDefinition("UNKNOWN");
		expect(def).toBeUndefined();
	});

	it("should return correct block definition", () => {
		const def = getSstBlockDefinition("TRANS");
		expect(def).toBeDefined();
		expect(def?.blockId).toBe("TRANS");
		expect(def?.parameters.length).toBe(5);
	});

	it("should decode multiple blocks at once", () => {
		const transBuffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(transBuffer, 0, 8, 0x50);

		const presBuffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(presBuffer, 0, 10, 500);

		const blocks = {
			TRANS: transBuffer,
			PRES: presBuffer,
		};

		const result = decodeSstBlockSet(blocks);
		expect(result["TRANS"]).toBeDefined();
		expect(result["PRES"]).toBeDefined();
		expect((result["TRANS"] as SstTransData).transmissionTemperature).toBe(40);
		expect((result["PRES"] as SstPresData).clutch1Pressure).toBe(50);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases and Boundary Tests
// ---------------------------------------------------------------------------

describe("Edge Cases and Boundary Conditions", () => {
	it("should handle minimum pressure values (0 Bar)", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 0);
		const result = decodeSstPres(buffer);
		expect(result.clutch1Pressure).toBe(0);
	});

	it("should handle maximum pressure values", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 1023); // 10-bit max
		const result = decodeSstPres(buffer);
		expect(result.clutch1Pressure).toBeCloseTo(102.3, 1);
	});

	it("should handle wheel speed at 0 km/h", () => {
		const buffer = createTestBuffer(SST_SLIP_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 0);
		const result = decodeSstSlip(buffer);
		expect(result.wheelSpeedFR).toBe(0);
	});

	it("should handle all counters at max values", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		setBitsAt(buffer, 8, 8, 0xff); // VIN counter: 255
		setBitsAt(buffer, 16, 16, 0xffff); // Shift counter: 65535
		setBitsAt(buffer, 32, 8, 0xff); // Oil counter: 255

		const result = decodeSstState(buffer);
		expect(result.vinWriteCounter).toBe(255);
		expect(result.shiftAttemptCounter).toBe(65535);
		expect(result.oilChangeCounter).toBe(255);
	});

	it("should handle bit field spanning byte boundary", () => {
		// Test parameter that spans multiple bytes
		const buffer = createTestBuffer(SST_SLIP_BLOCK.blockSize);
		// Set a 10-bit value that crosses byte boundary at bits 8-17
		setBitsAt(buffer, 10, 10, 512); // Half of 10-bit range
		const result = decodeSstSlip(buffer);
		expect(result.wheelSpeedFL).toBe(51.2); // 512 * 0.1
	});

	it("should handle zero solenoid currents", () => {
		const buffer = createTestBuffer(SST_SOL_BLOCK.blockSize);
		const result = decodeSstSol(buffer);
		expect(result.solenoid1Current).toBe(0);
		expect(result.solenoid2Current).toBe(0);
		expect(result.solenoid3Current).toBe(0);
	});

	it("should handle all flags as false in STATE block", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize);
		const result = decodeSstState(buffer);
		expect(result.vinLockState).toBe(false);
		expect(result.transmissionFault).toBe(false);
		expect(result.overheatWarning).toBe(false);
	});

	it("should handle all flags as true in STATE block", () => {
		const buffer = createTestBuffer(SST_STATE_BLOCK.blockSize, 0xff);
		const result = decodeSstState(buffer);
		expect(result.vinLockState).toBe(true);
		expect(result.transmissionFault).toBe(true);
		expect(result.overheatWarning).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Data Validation Tests
// ---------------------------------------------------------------------------

describe("Data Validation and Limits", () => {
	it("should respect min/max values for parameters", () => {
		// Temperature should be between -40 and 215
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 0, 8, 0x00); // -40°C min
		let result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(-40);

		setBitsAt(buffer, 0, 8, 0xff); // 215°C max
		result = decodeSstTrans(buffer);
		expect(result.transmissionTemperature).toBe(215);
	});

	it("should preserve precision in pressure calculations", () => {
		const buffer = createTestBuffer(SST_PRES_BLOCK.blockSize);
		setBitsAt(buffer, 0, 10, 123); // 123 * 0.1 = 12.3 Bar
		const result = decodeSstPres(buffer);
		expect(result.clutch1Pressure).toBeCloseTo(12.3, 1);
	});

	it("should handle percentage rounding correctly", () => {
		const buffer = createTestBuffer(SST_TRANS_BLOCK.blockSize);
		setBitsAt(buffer, 14, 8, 0x40); // 64/255 = ~25%
		const result = decodeSstTrans(buffer);
		expect(result.gearEngagementPercent).toBeCloseTo(25.1, 1);
	});
});

// ---------------------------------------------------------------------------
// Performance and Size Tests
// ---------------------------------------------------------------------------

describe("Performance Characteristics", () => {
	it("should verify block sizes match expected values", () => {
		expect(SST_TRANS_BLOCK.blockSize).toBe(8);
		expect(SST_PRES_BLOCK.blockSize).toBe(8);
		expect(SST_SLIP_BLOCK.blockSize).toBe(10);
		expect(SST_SOL_BLOCK.blockSize).toBe(6);
		expect(SST_STATE_BLOCK.blockSize).toBe(8);
		expect(SST_CALC_BLOCK.blockSize).toBe(6);
	});

	it("should have reasonable total payload size", () => {
		const totalSize =
			SST_TRANS_BLOCK.blockSize +
			SST_PRES_BLOCK.blockSize +
			SST_SLIP_BLOCK.blockSize +
			SST_SOL_BLOCK.blockSize +
			SST_STATE_BLOCK.blockSize +
			SST_CALC_BLOCK.blockSize;

		expect(totalSize).toBe(46); // 8+8+10+6+8+6
		expect(totalSize).toBeLessThan(255); // Reasonable single CAN frame equivalent
	});
});
