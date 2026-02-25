import {
	validateDataType,
	validateMinMax,
	validateMonotonicIncreasing,
	validateNumber,
} from "./rules";
import type {
	ValidationContext,
	ValidationOptions,
	ValidationResult,
} from "./types";

/**
 * Validate a single value with all applicable rules
 *
 * @param value - The value to validate
 * @param context - Validation context with constraints and metadata
 * @param options - Validation options to control which checks to run
 * @returns ValidationResult indicating if value is valid
 *
 * @example
 * const result = validateValue(300, {
 *   dtype: "u8",
 *   min: 0,
 *   max: 255
 * }, {
 *   checkDataType: true,
 *   checkMinMax: true
 * });
 */
export function validateValue(
	value: number,
	context: ValidationContext,
	options: ValidationOptions = {},
): ValidationResult {
	const {
		checkDataType = true,
		checkMinMax = true,
		checkMonotonic = false,
	} = options;

	// Always check if value is a valid number
	const numberCheck = validateNumber(value);
	if (!numberCheck.valid) {
		return numberCheck;
	}

	// Check data type range
	if (checkDataType) {
		const typeCheck = validateDataType(value, context.dtype);
		if (!typeCheck.valid) {
			return typeCheck;
		}
	}

	// Check min/max constraints
	if (checkMinMax) {
		const minMaxCheck = validateMinMax(value, context);
		if (!minMaxCheck.valid) {
			return minMaxCheck;
		}
	}

	// Check monotonic constraints
	if (checkMonotonic && context.previousValue !== undefined) {
		// Determine if we should check increasing or decreasing
		// For now, we default to increasing (can be extended with direction parameter)
		const monotonicCheck = validateMonotonicIncreasing(value, context, true);
		if (!monotonicCheck.valid) {
			return monotonicCheck;
		}
	}

	return { valid: true };
}

/**
 * Validate an array of values with all applicable rules
 *
 * @param values - Array of values to validate
 * @param context - Validation context with constraints and metadata
 * @param options - Validation options to control which checks to run
 * @returns Array of ValidationResults, one per value
 *
 * @example
 * const results = validateValues([100, 200, 300], {
 *   dtype: "u16",
 *   min: 0,
 *   max: 255
 * }, {
 *   checkDataType: true,
 *   checkMinMax: true,
 *   checkMonotonic: true
 * });
 */
export function validateValues(
	values: number[],
	context: ValidationContext,
	options: ValidationOptions = {},
): ValidationResult[] {
	const results: ValidationResult[] = [];

	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (value === undefined) continue;

		// Create context for this value with previous value for monotonic checks
		const valueContext: ValidationContext = {
			dtype: context.dtype,
			min: context.min,
			max: context.max,
			scale: context.scale,
			offset: context.offset,
			previousValue: i > 0 ? values[i - 1] : undefined,
			nextValue: i < values.length - 1 ? values[i + 1] : undefined,
		};

		const result = validateValue(value, valueContext, options);
		results.push(result);
	}

	return results;
}

/**
 * Check if all validation results are valid
 *
 * @param results - Array of validation results
 * @returns True if all results are valid
 *
 * @example
 * const allValid = areAllValid(results);
 */
export function areAllValid(results: ValidationResult[]): boolean {
	return results.every((result) => result.valid);
}

/**
 * Get all invalid results from an array of validation results
 *
 * @param results - Array of validation results
 * @returns Array of invalid results
 *
 * @example
 * const errors = getInvalidResults(results);
 */
export function getInvalidResults(
	results: ValidationResult[],
): ValidationResult[] {
	return results.filter((result) => !result.valid);
}

/**
 * Get count of invalid results
 *
 * @param results - Array of validation results
 * @returns Number of invalid results
 *
 * @example
 * const errorCount = getInvalidCount(results);
 */
export function getInvalidCount(results: ValidationResult[]): number {
	return results.filter((result) => !result.valid).length;
}
