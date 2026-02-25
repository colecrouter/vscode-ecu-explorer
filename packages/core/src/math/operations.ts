import type { ScalarType } from "../binary";

/**
 * Clamp a single value to a min/max range
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 *
 * @example
 * const clamped = clamp(15, 0, 10); // 10
 * const clamped2 = clamp(-5, 0, 10); // 0
 * const clamped3 = clamp(5, 0, 10); // 5
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.round(Math.min(Math.max(value, min), max));
}

/**
 * Result of a math operation
 */
export interface MathOpResult {
	/** Resulting values after operation */
	values: number[];
	/** Warnings about clamping or other issues */
	warnings: string[];
	/** Count of cells that changed */
	changedCount: number;
}

/**
 * Constraints for math operations
 */
export interface MathOpConstraints {
	/** Minimum allowed value */
	min?: number;
	/** Maximum allowed value */
	max?: number;
	/** Data type for range validation */
	dtype?: ScalarType;
}

/**
 * Add a constant value to all values
 *
 * @param values - Array of values to modify
 * @param constant - Constant to add (can be negative for subtraction)
 * @param constraints - Optional min/max constraints
 * @returns Result with modified values, warnings, and change count
 *
 * @example
 * const result = addConstant([10, 20, 30], 5);
 * // result.values = [15, 25, 35]
 */
export function addConstant(
	values: number[],
	constant: number,
	constraints?: MathOpConstraints,
): MathOpResult {
	const result: number[] = [];
	const warnings: string[] = [];
	let changedCount = 0;
	let clampedCount = 0;

	for (const value of values) {
		let newValue = value + constant;

		// Check constraints
		if (constraints?.min !== undefined && newValue < constraints.min) {
			newValue = constraints.min;
			clampedCount++;
		}

		if (constraints?.max !== undefined && newValue > constraints.max) {
			newValue = constraints.max;
			clampedCount++;
		}

		result.push(newValue);
		if (newValue !== value) changedCount++;
	}

	// Add warning if values were clamped
	if (clampedCount > 0) {
		warnings.push(
			`${clampedCount} value${clampedCount > 1 ? "s" : ""} clamped to constraints`,
		);
	}

	return { values: result, warnings, changedCount };
}

/**
 * Multiply all values by a constant factor
 *
 * @param values - Array of values to modify
 * @param factor - Multiplication factor (can be < 1 for division)
 * @param constraints - Optional min/max constraints
 * @returns Result with modified values, warnings, and change count
 *
 * @example
 * const result = multiplyConstant([10, 20, 30], 1.5);
 * // result.values = [15, 30, 45]
 */
export function multiplyConstant(
	values: number[],
	factor: number,
	constraints?: MathOpConstraints,
): MathOpResult {
	const result: number[] = [];
	const warnings: string[] = [];
	let changedCount = 0;
	let clampedCount = 0;

	for (const value of values) {
		let newValue = value * factor;

		// Check constraints
		if (constraints?.min !== undefined && newValue < constraints.min) {
			newValue = constraints.min;
			clampedCount++;
		}

		if (constraints?.max !== undefined && newValue > constraints.max) {
			newValue = constraints.max;
			clampedCount++;
		}

		result.push(newValue);
		if (newValue !== value) changedCount++;
	}

	// Add warning if values were clamped
	if (clampedCount > 0) {
		warnings.push(
			`${clampedCount} value${clampedCount > 1 ? "s" : ""} clamped to constraints`,
		);
	}

	return { values: result, warnings, changedCount };
}

/**
 * Clamp all values to a min/max range
 *
 * @param values - Array of values to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Result with clamped values and change count
 * @throws Error if min > max
 *
 * @example
 * const result = clampValues([5, 15, 25, 35, 45], 10, 40);
 * // result.values = [10, 15, 25, 35, 40]
 */
export function clampValues(
	values: number[],
	min: number,
	max: number,
): MathOpResult {
	if (min > max) {
		throw new Error(`min (${min}) must be <= max (${max})`);
	}

	const result: number[] = [];
	let changedCount = 0;

	for (const value of values) {
		const newValue = Math.max(min, Math.min(max, value));
		result.push(newValue);
		if (newValue !== value) changedCount++;
	}

	return { values: result, warnings: [], changedCount };
}

/**
 * Smooth values using a kernel-based averaging filter
 *
 * @param matrix - 2D matrix of values to smooth
 * @param kernelSize - Size of averaging kernel (must be odd: 3, 5, 7, etc.)
 * @param iterations - Number of smoothing passes
 * @param boundaryMode - How to handle boundaries: "pad" (zeros), "repeat" (edge values), "mirror" (reflect)
 * @returns Result with smoothed values (flattened), warnings, and change count
 * @throws Error if kernel size is even
 *
 * @example
 * const matrix = [[10, 20, 30], [40, 50, 60], [70, 80, 90]];
 * const result = smoothValues(matrix, 3, 1);
 * // Smooths each cell by averaging with neighbors
 */
export function smoothValues(
	matrix: number[][],
	kernelSize = 3,
	iterations = 1,
	boundaryMode: "pad" | "repeat" | "mirror" = "pad",
): MathOpResult {
	if (kernelSize % 2 === 0) {
		throw new Error("Kernel size must be odd");
	}

	let result = matrix.map((row) => [...row]);
	const radius = Math.floor(kernelSize / 2);

	for (let iter = 0; iter < iterations; iter++) {
		const smoothed: number[][] = [];

		for (let i = 0; i < result.length; i++) {
			const currentRow = result[i];
			if (!currentRow) continue;

			const row: number[] = [];

			for (let j = 0; j < currentRow.length; j++) {
				let sum = 0;
				let count = 0;

				for (let di = -radius; di <= radius; di++) {
					for (let dj = -radius; dj <= radius; dj++) {
						const ni = i + di;
						const nj = j + dj;

						if (isValidIndex(ni, nj, result, boundaryMode)) {
							sum += getValueAtIndex(result, ni, nj, boundaryMode);
							count++;
						}
					}
				}

				row.push(sum / count);
			}

			smoothed.push(row);
		}

		result = smoothed;
	}

	// Flatten for comparison
	const originalFlat = matrix.flat();
	const resultFlat = result.flat();
	let changedCount = 0;

	for (let i = 0; i < originalFlat.length; i++) {
		const origVal = originalFlat[i];
		const resVal = resultFlat[i];
		if (origVal !== undefined && resVal !== undefined) {
			if (Math.abs(resVal - origVal) > 0.001) {
				changedCount++;
			}
		}
	}

	return {
		values: resultFlat,
		warnings: [],
		changedCount,
	};
}

/**
 * Check if an index is valid for the given boundary mode
 *
 * @param i - Row index
 * @param j - Column index
 * @param matrix - Matrix to check against
 * @param mode - Boundary mode
 * @returns True if index is valid
 */
function isValidIndex(
	i: number,
	j: number,
	matrix: number[][],
	mode: "pad" | "repeat" | "mirror",
): boolean {
	if (mode === "pad") {
		const firstRow = matrix[0];
		return (
			i >= 0 &&
			i < matrix.length &&
			j >= 0 &&
			firstRow !== undefined &&
			j < firstRow.length
		);
	}
	return true; // repeat/mirror always valid
}

/**
 * Get value at index with boundary handling
 *
 * @param matrix - Matrix to get value from
 * @param i - Row index
 * @param j - Column index
 * @param mode - Boundary mode
 * @returns Value at index with boundary handling applied
 */
function getValueAtIndex(
	matrix: number[][],
	i: number,
	j: number,
	mode: "pad" | "repeat" | "mirror",
): number {
	const firstRow = matrix[0];
	if (!firstRow) return 0;

	if (i < 0 || i >= matrix.length || j < 0 || j >= firstRow.length) {
		if (mode === "pad") return 0;
		if (mode === "repeat") {
			const ii = Math.max(0, Math.min(matrix.length - 1, i));
			const jj = Math.max(0, Math.min(firstRow.length - 1, j));
			const row = matrix[ii];
			return row?.[jj] ?? 0;
		}
		if (mode === "mirror") {
			let ii = i;
			let jj = j;

			// Mirror row index
			if (ii < 0) {
				ii = -ii - 1;
			} else if (ii >= matrix.length) {
				ii = 2 * matrix.length - ii - 1;
			}

			// Mirror column index
			if (jj < 0) {
				jj = -jj - 1;
			} else if (jj >= firstRow.length) {
				jj = 2 * firstRow.length - jj - 1;
			}

			// Clamp to valid range (in case of multiple reflections)
			ii = Math.max(0, Math.min(matrix.length - 1, ii));
			jj = Math.max(0, Math.min(firstRow.length - 1, jj));

			const row = matrix[ii];
			return row?.[jj] ?? 0;
		}
	}
	const row = matrix[i];
	return row?.[j] ?? 0;
}
