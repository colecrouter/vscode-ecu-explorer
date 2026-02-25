import { describe, expect, it } from "vitest";
import {
	getScalarTypeRange,
	validateDataType,
	validateMinMax,
	validateMonotonicDecreasing,
	validateMonotonicIncreasing,
	validateNumber,
} from "../src/validation/rules";
import type { ValidationContext } from "../src/validation/types";
import {
	areAllValid,
	getInvalidCount,
	getInvalidResults,
	validateValue,
	validateValues,
} from "../src/validation/validator";

describe("Validation Rules", () => {
	describe("getScalarTypeRange", () => {
		it("returns correct range for u8", () => {
			const range = getScalarTypeRange("u8");
			expect(range).toEqual({ min: 0, max: 255 });
		});

		it("returns correct range for i8", () => {
			const range = getScalarTypeRange("i8");
			expect(range).toEqual({ min: -128, max: 127 });
		});

		it("returns correct range for u16", () => {
			const range = getScalarTypeRange("u16");
			expect(range).toEqual({ min: 0, max: 65535 });
		});

		it("returns correct range for i16", () => {
			const range = getScalarTypeRange("i16");
			expect(range).toEqual({ min: -32768, max: 32767 });
		});

		it("returns correct range for u32", () => {
			const range = getScalarTypeRange("u32");
			expect(range).toEqual({ min: 0, max: 4294967295 });
		});

		it("returns correct range for i32", () => {
			const range = getScalarTypeRange("i32");
			expect(range).toEqual({ min: -2147483648, max: 2147483647 });
		});

		it("returns correct range for f32", () => {
			const range = getScalarTypeRange("f32");
			expect(range.min).toBe(-3.4e38);
			expect(range.max).toBe(3.4e38);
		});

		it("throws error for unknown type", () => {
			expect(() => {
				getScalarTypeRange("unknown" as any);
			}).toThrow();
		});
	});

	describe("validateDataType", () => {
		it("validates u8 value within range", () => {
			const result = validateDataType(128, "u8");
			expect(result.valid).toBe(true);
		});

		it("rejects u8 value above max", () => {
			const result = validateDataType(256, "u8");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("TYPE_OUT_OF_RANGE");
			expect(result.suggestion).toContain("0");
			expect(result.suggestion).toContain("255");
		});

		it("rejects u8 value below min", () => {
			const result = validateDataType(-1, "u8");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("TYPE_OUT_OF_RANGE");
		});

		it("validates i8 negative value", () => {
			const result = validateDataType(-100, "i8");
			expect(result.valid).toBe(true);
		});

		it("rejects i8 value below min", () => {
			const result = validateDataType(-129, "i8");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("TYPE_OUT_OF_RANGE");
		});

		it("rejects NaN", () => {
			const result = validateDataType(NaN, "u8");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});

		it("rejects Infinity", () => {
			const result = validateDataType(Infinity, "f32");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});

		it("rejects -Infinity", () => {
			const result = validateDataType(-Infinity, "f32");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});

		it("validates f32 large value", () => {
			const result = validateDataType(1.5e38, "f32");
			expect(result.valid).toBe(true);
		});

		it("rejects f32 value above max", () => {
			const result = validateDataType(4e38, "f32");
			expect(result.valid).toBe(false);
			expect(result.code).toBe("TYPE_OUT_OF_RANGE");
		});
	});

	describe("validateMinMax", () => {
		it("validates value within min/max", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateMinMax(150, context);
			expect(result.valid).toBe(true);
		});

		it("rejects value below min", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateMinMax(50, context);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("VALUE_BELOW_MIN");
			expect(result.suggestedValue).toBe(100);
		});

		it("rejects value above max", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateMinMax(250, context);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("VALUE_ABOVE_MAX");
			expect(result.suggestedValue).toBe(200);
		});

		it("validates value at min boundary", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateMinMax(100, context);
			expect(result.valid).toBe(true);
		});

		it("validates value at max boundary", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateMinMax(200, context);
			expect(result.valid).toBe(true);
		});

		it("validates when min is undefined", () => {
			const context: ValidationContext = {
				dtype: "u16",
				max: 200,
			};
			const result = validateMinMax(50, context);
			expect(result.valid).toBe(true);
		});

		it("validates when max is undefined", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
			};
			const result = validateMinMax(250, context);
			expect(result.valid).toBe(true);
		});
	});

	describe("validateMonotonicIncreasing", () => {
		it("validates first value (no previous)", () => {
			const context: ValidationContext = {
				dtype: "u16",
			};
			const result = validateMonotonicIncreasing(100, context, true);
			expect(result.valid).toBe(true);
		});

		it("validates strictly increasing value", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(150, context, true);
			expect(result.valid).toBe(true);
		});

		it("rejects equal value in strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(100, context, true);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_STRICTLY_INCREASING");
			expect(result.suggestedValue).toBe(101);
		});

		it("rejects decreasing value in strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(50, context, true);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_STRICTLY_INCREASING");
		});

		it("validates equal value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(100, context, false);
			expect(result.valid).toBe(true);
		});

		it("validates increasing value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(150, context, false);
			expect(result.valid).toBe(true);
		});

		it("rejects decreasing value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicIncreasing(50, context, false);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_INCREASING");
			expect(result.suggestedValue).toBe(100);
		});
	});

	describe("validateMonotonicDecreasing", () => {
		it("validates first value (no previous)", () => {
			const context: ValidationContext = {
				dtype: "u16",
			};
			const result = validateMonotonicDecreasing(100, context, true);
			expect(result.valid).toBe(true);
		});

		it("validates strictly decreasing value", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(50, context, true);
			expect(result.valid).toBe(true);
		});

		it("rejects equal value in strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(100, context, true);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_STRICTLY_DECREASING");
			expect(result.suggestedValue).toBe(99);
		});

		it("rejects increasing value in strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(150, context, true);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_STRICTLY_DECREASING");
		});

		it("validates equal value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(100, context, false);
			expect(result.valid).toBe(true);
		});

		it("validates decreasing value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(50, context, false);
			expect(result.valid).toBe(true);
		});

		it("rejects increasing value in non-strict mode", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateMonotonicDecreasing(150, context, false);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_DECREASING");
			expect(result.suggestedValue).toBe(100);
		});
	});

	describe("validateNumber", () => {
		it("validates finite number", () => {
			const result = validateNumber(42);
			expect(result.valid).toBe(true);
		});

		it("validates zero", () => {
			const result = validateNumber(0);
			expect(result.valid).toBe(true);
		});

		it("validates negative number", () => {
			const result = validateNumber(-42);
			expect(result.valid).toBe(true);
		});

		it("rejects NaN", () => {
			const result = validateNumber(NaN);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});

		it("rejects Infinity", () => {
			const result = validateNumber(Infinity);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});

		it("rejects -Infinity", () => {
			const result = validateNumber(-Infinity);
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});
	});
});

describe("Validator", () => {
	describe("validateValue", () => {
		it("validates value with all checks enabled", () => {
			const context: ValidationContext = {
				dtype: "u8",
				min: 0,
				max: 255,
			};
			const result = validateValue(128, context, {
				checkDataType: true,
				checkMinMax: true,
			});
			expect(result.valid).toBe(true);
		});

		it("rejects value exceeding data type range", () => {
			const context: ValidationContext = {
				dtype: "u8",
			};
			const result = validateValue(300, context, {
				checkDataType: true,
			});
			expect(result.valid).toBe(false);
			expect(result.code).toBe("TYPE_OUT_OF_RANGE");
		});

		it("rejects value exceeding min/max constraints", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateValue(250, context, {
				checkMinMax: true,
			});
			expect(result.valid).toBe(false);
			expect(result.code).toBe("VALUE_ABOVE_MAX");
		});

		it("skips data type check when disabled", () => {
			const context: ValidationContext = {
				dtype: "u8",
			};
			const result = validateValue(300, context, {
				checkDataType: false,
			});
			expect(result.valid).toBe(true);
		});

		it("skips min/max check when disabled", () => {
			const context: ValidationContext = {
				dtype: "u16",
				min: 100,
				max: 200,
			};
			const result = validateValue(250, context, {
				checkMinMax: false,
			});
			expect(result.valid).toBe(true);
		});

		it("checks monotonic constraint when enabled", () => {
			const context: ValidationContext = {
				dtype: "u16",
				previousValue: 100,
			};
			const result = validateValue(50, context, {
				checkMonotonic: true,
			});
			expect(result.valid).toBe(false);
			expect(result.code).toBe("NOT_STRICTLY_INCREASING");
		});

		it("always checks if value is a valid number", () => {
			const context: ValidationContext = {
				dtype: "u8",
			};
			const result = validateValue(NaN, context, {
				checkDataType: false,
				checkMinMax: false,
			});
			expect(result.valid).toBe(false);
			expect(result.code).toBe("INVALID_NUMBER");
		});
	});

	describe("validateValues", () => {
		it("validates array of values", () => {
			const context: ValidationContext = {
				dtype: "u8",
				min: 0,
				max: 255,
			};
			const results = validateValues([100, 150, 200], context, {
				checkDataType: true,
				checkMinMax: true,
			});
			expect(results).toHaveLength(3);
			expect(results.every((r) => r.valid)).toBe(true);
		});

		it("returns results for each value", () => {
			const context: ValidationContext = {
				dtype: "u8",
				min: 0,
				max: 255,
			};
			const results = validateValues([100, 300, 200], context, {
				checkDataType: true,
			});
			expect(results).toHaveLength(3);
			expect(results[0]?.valid).toBe(true);
			expect(results[1]?.valid).toBe(false);
			expect(results[2]?.valid).toBe(true);
		});

		it("provides previous value for monotonic checks", () => {
			const context: ValidationContext = {
				dtype: "u16",
			};
			const results = validateValues([100, 150, 140], context, {
				checkMonotonic: true,
			});
			expect(results[0]?.valid).toBe(true); // First value
			expect(results[1]?.valid).toBe(true); // 150 > 100
			expect(results[2]?.valid).toBe(false); // 140 < 150
		});

		it("handles empty array", () => {
			const context: ValidationContext = {
				dtype: "u8",
			};
			const results = validateValues([], context);
			expect(results).toHaveLength(0);
		});
	});

	describe("areAllValid", () => {
		it("returns true when all results are valid", () => {
			const results = [{ valid: true }, { valid: true }, { valid: true }];
			expect(areAllValid(results)).toBe(true);
		});

		it("returns false when any result is invalid", () => {
			const results = [
				{ valid: true },
				{ valid: false, error: "test" },
				{ valid: true },
			];
			expect(areAllValid(results)).toBe(false);
		});

		it("returns true for empty array", () => {
			expect(areAllValid([])).toBe(true);
		});
	});

	describe("getInvalidResults", () => {
		it("returns only invalid results", () => {
			const results = [
				{ valid: true },
				{ valid: false, error: "error1" },
				{ valid: true },
				{ valid: false, error: "error2" },
			];
			const invalid = getInvalidResults(results);
			expect(invalid).toHaveLength(2);
			expect(invalid.every((r) => !r.valid)).toBe(true);
		});

		it("returns empty array when all valid", () => {
			const results = [{ valid: true }, { valid: true }];
			const invalid = getInvalidResults(results);
			expect(invalid).toHaveLength(0);
		});
	});

	describe("getInvalidCount", () => {
		it("counts invalid results", () => {
			const results = [
				{ valid: true },
				{ valid: false, error: "error1" },
				{ valid: true },
				{ valid: false, error: "error2" },
			];
			expect(getInvalidCount(results)).toBe(2);
		});

		it("returns 0 when all valid", () => {
			const results = [{ valid: true }, { valid: true }];
			expect(getInvalidCount(results)).toBe(0);
		});

		it("returns count for empty array", () => {
			expect(getInvalidCount([])).toBe(0);
		});
	});
});
