import type { ScalarType } from "../binary";
import type { ValidationContext, ValidationResult } from "./types";

/**
 * Get the valid range for a scalar data type
 *
 * @param dtype - The scalar type
 * @returns Object with min and max values for the type
 * @throws Error if dtype is unknown
 *
 * @example
 * const range = getScalarTypeRange("u8"); // { min: 0, max: 255 }
 */
export function getScalarTypeRange(dtype: ScalarType): {
	min: number;
	max: number;
} {
	switch (dtype) {
		case "u8":
			return { min: 0, max: 255 };
		case "i8":
			return { min: -128, max: 127 };
		case "u16":
			return { min: 0, max: 65535 };
		case "i16":
			return { min: -32768, max: 32767 };
		case "u32":
			return { min: 0, max: 4294967295 };
		case "i32":
			return { min: -2147483648, max: 2147483647 };
		case "f32":
			return { min: -3.4e38, max: 3.4e38 };
		default: {
			const _exhaustive: never = dtype;
			throw new Error(`Unknown scalar type: ${_exhaustive}`);
		}
	}
}

/**
 * Validate that a value fits within the range of its scalar data type
 *
 * @param value - The value to validate
 * @param dtype - The scalar type
 * @returns ValidationResult indicating if value is valid for the type
 *
 * @example
 * const result = validateDataType(300, "u8");
 * // { valid: false, error: "Value 300 out of range for u8 type", code: "TYPE_OUT_OF_RANGE", ... }
 */
export function validateDataType(
	value: number,
	dtype: ScalarType,
): ValidationResult {
	// Check for non-finite values
	if (!Number.isFinite(value)) {
		return {
			valid: false,
			error: `Value ${value} is not a valid number`,
			code: "INVALID_NUMBER",
			suggestion: "Enter a valid decimal number",
		};
	}

	const range = getScalarTypeRange(dtype);

	if (value < range.min || value > range.max) {
		return {
			valid: false,
			error: `Value ${value} out of range for ${dtype} type`,
			code: "TYPE_OUT_OF_RANGE",
			suggestion: `Use value between ${range.min} and ${range.max}`,
		};
	}

	return { valid: true };
}

/**
 * Validate that a value is within min/max constraints
 *
 * @param value - The value to validate
 * @param context - Validation context with min/max constraints
 * @returns ValidationResult indicating if value is within constraints
 *
 * @example
 * const result = validateMinMax(350, { dtype: "u16", min: 0, max: 300 });
 * // { valid: false, error: "Value 350 exceeds maximum 300", code: "VALUE_ABOVE_MAX", ... }
 */
export function validateMinMax(
	value: number,
	context: ValidationContext,
): ValidationResult {
	const { min, max } = context;

	if (min !== undefined && value < min) {
		return {
			valid: false,
			error: `Value ${value} below minimum ${min}`,
			code: "VALUE_BELOW_MIN",
			suggestion: `Use minimum value ${min}`,
			suggestedValue: min,
		};
	}

	if (max !== undefined && value > max) {
		return {
			valid: false,
			error: `Value ${value} exceeds maximum ${max}`,
			code: "VALUE_ABOVE_MAX",
			suggestion: `Use maximum value ${max}`,
			suggestedValue: max,
		};
	}

	return { valid: true };
}

/**
 * Validate that a value maintains monotonic increasing order
 *
 * @param value - The value to validate
 * @param context - Validation context with previousValue
 * @param strict - If true, requires strictly increasing (>); if false, allows equal (>=)
 * @returns ValidationResult indicating if value maintains monotonic order
 *
 * @example
 * const result = validateMonotonicIncreasing(1500, { dtype: "u16", previousValue: 1500 }, true);
 * // { valid: false, error: "Values not strictly increasing: 1500 >= 1500", code: "NOT_STRICTLY_INCREASING", ... }
 */
export function validateMonotonicIncreasing(
	value: number,
	context: ValidationContext,
	strict = true,
): ValidationResult {
	const { previousValue } = context;

	if (previousValue === undefined) {
		return { valid: true };
	}

	if (strict && value <= previousValue) {
		return {
			valid: false,
			error: `Values not strictly increasing: ${previousValue} >= ${value}`,
			code: "NOT_STRICTLY_INCREASING",
			suggestion: `Use value > ${previousValue}`,
			suggestedValue: previousValue + 1,
		};
	}

	if (!strict && value < previousValue) {
		return {
			valid: false,
			error: `Values not increasing: ${previousValue} > ${value}`,
			code: "NOT_INCREASING",
			suggestion: `Use value >= ${previousValue}`,
			suggestedValue: previousValue,
		};
	}

	return { valid: true };
}

/**
 * Validate that a value maintains monotonic decreasing order
 *
 * @param value - The value to validate
 * @param context - Validation context with previousValue
 * @param strict - If true, requires strictly decreasing (<); if false, allows equal (<=)
 * @returns ValidationResult indicating if value maintains monotonic order
 *
 * @example
 * const result = validateMonotonicDecreasing(1500, { dtype: "u16", previousValue: 1500 }, true);
 * // { valid: false, error: "Values not strictly decreasing: 1500 <= 1500", code: "NOT_STRICTLY_DECREASING", ... }
 */
export function validateMonotonicDecreasing(
	value: number,
	context: ValidationContext,
	strict = true,
): ValidationResult {
	const { previousValue } = context;

	if (previousValue === undefined) {
		return { valid: true };
	}

	if (strict && value >= previousValue) {
		return {
			valid: false,
			error: `Values not strictly decreasing: ${previousValue} <= ${value}`,
			code: "NOT_STRICTLY_DECREASING",
			suggestion: `Use value < ${previousValue}`,
			suggestedValue: previousValue - 1,
		};
	}

	if (!strict && value > previousValue) {
		return {
			valid: false,
			error: `Values not decreasing: ${previousValue} < ${value}`,
			code: "NOT_DECREASING",
			suggestion: `Use value <= ${previousValue}`,
			suggestedValue: previousValue,
		};
	}

	return { valid: true };
}

/**
 * Validate that a value is a valid number (not NaN or Infinity)
 *
 * @param value - The value to validate
 * @returns ValidationResult indicating if value is a valid number
 *
 * @example
 * const result = validateNumber(NaN);
 * // { valid: false, error: "Value is not a valid number", code: "INVALID_NUMBER", ... }
 */
export function validateNumber(value: number): ValidationResult {
	if (!Number.isFinite(value)) {
		return {
			valid: false,
			error: "Value is not a valid number",
			code: "INVALID_NUMBER",
			suggestion: "Enter a valid decimal number",
		};
	}

	return { valid: true };
}
