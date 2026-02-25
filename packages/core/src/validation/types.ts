import type { ScalarType } from "../binary";

/**
 * Error codes for validation failures
 */
export type ValidationErrorCode =
	| "VALUE_BELOW_MIN"
	| "VALUE_ABOVE_MAX"
	| "TYPE_OUT_OF_RANGE"
	| "NOT_STRICTLY_INCREASING"
	| "NOT_INCREASING"
	| "NOT_STRICTLY_DECREASING"
	| "NOT_DECREASING"
	| "INVALID_NUMBER";

/**
 * Result of a validation check
 */
export interface ValidationResult {
	/** Whether the value is valid */
	valid: boolean;
	/** Error message if invalid */
	error?: string;
	/** Error code for programmatic handling */
	code?: ValidationErrorCode;
	/** Suggestion for fixing the error */
	suggestion?: string;
	/** Suggested value to use instead */
	suggestedValue?: number;
}

/**
 * Context for validation operations
 */
export interface ValidationContext {
	/** Data type of the value */
	dtype: ScalarType;
	/** Minimum allowed value (optional) */
	min?: number | undefined;
	/** Maximum allowed value (optional) */
	max?: number | undefined;
	/** Scale factor applied to raw value */
	scale?: number | undefined;
	/** Offset applied after scaling */
	offset?: number | undefined;
	/** Previous value in sequence (for monotonic checks) */
	previousValue?: number | undefined;
	/** Next value in sequence (for monotonic checks) */
	nextValue?: number | undefined;
}

/**
 * A composable validation rule
 */
export interface ValidationRule {
	/** Name of the rule */
	name: string;
	/** Description of what the rule validates */
	description: string;
	/** Function to validate a value */
	validate: (value: number, context: ValidationContext) => ValidationResult;
}

/**
 * Options for validation operations
 */
export interface ValidationOptions {
	/** Check data type range constraints */
	checkDataType?: boolean;
	/** Check min/max constraints */
	checkMinMax?: boolean;
	/** Check monotonic constraints */
	checkMonotonic?: boolean;
}
