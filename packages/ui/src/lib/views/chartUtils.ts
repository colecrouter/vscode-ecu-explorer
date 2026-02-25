/**
 * Chart utility functions for data processing and formatting
 *
 * Provides downsampling algorithms and formatting utilities for chart rendering.
 */

/**
 * Downsample configuration
 */
export interface DownsampleConfig {
	maxPoints: number;
	algorithm: "lttb" | "minmax" | "average";
}

/**
 * Check if data should be downsampled based on size threshold
 *
 * @param dataLength - Number of data points
 * @param threshold - Maximum points before downsampling (default: 1000)
 * @returns True if data should be downsampled
 */
export function shouldDownsample(
	dataLength: number,
	threshold = 1000,
): boolean {
	return dataLength > threshold;
}

/**
 * Downsample 1D data using Largest-Triangle-Three-Buckets (LTTB) algorithm
 *
 * LTTB preserves the visual shape of the data by selecting points that form
 * the largest triangles, maintaining peaks and valleys while reducing point count.
 *
 * @param data - Array of data points to downsample
 * @param maxPoints - Target number of points after downsampling
 * @returns Downsampled array with indices preserved
 *
 * @example
 * const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const downsampled = downsampleData(data, 5);
 * // Returns approximately [1, 3, 5, 7, 10] with original indices
 */
export function downsampleData(
	data: number[],
	maxPoints: number,
): { indices: number[]; values: number[] } {
	if (data.length <= maxPoints) {
		return {
			indices: Array.from({ length: data.length }, (_, i) => i),
			values: data,
		};
	}

	const indices: number[] = [0]; // Always keep first point
	const firstVal = data[0];
	if (firstVal === undefined) throw new Error("Expected data[0] to be defined");
	const values: number[] = [firstVal];

	// LTTB algorithm
	const bucketSize = (data.length - 2) / (maxPoints - 2);

	for (let i = 0; i < maxPoints - 2; i++) {
		// Calculate average point for next bucket
		const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
		const avgRangeEnd = Math.min(
			Math.floor((i + 2) * bucketSize) + 1,
			data.length,
		);

		let avgX = 0;
		let avgY = 0;
		let avgRangeLength = 0;

		for (let j = avgRangeStart; j < avgRangeEnd; j++) {
			const val = data[j];
			if (val === undefined)
				throw new Error(`Expected data[${j}] to be defined`);
			avgX += j;
			avgY += val;
			avgRangeLength++;
		}

		avgX /= avgRangeLength;
		avgY /= avgRangeLength;

		// Get the range for this bucket
		const rangeStart = Math.floor(i * bucketSize) + 1;
		const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;

		// Find point with largest triangle area
		let maxArea = -1;
		let maxAreaPoint = rangeStart;

		const prevX = indices[indices.length - 1];
		const prevY = values[values.length - 1];
		if (prevX === undefined || prevY === undefined)
			throw new Error("Expected previous point to be defined");

		for (let j = rangeStart; j < rangeEnd; j++) {
			const val = data[j];
			if (val === undefined)
				throw new Error(`Expected data[${j}] to be defined`);
			// Calculate triangle area using cross product
			const area = Math.abs(
				(prevX - avgX) * (val - prevY) - (prevX - j) * (avgY - prevY),
			);

			if (area > maxArea) {
				maxArea = area;
				maxAreaPoint = j;
			}
		}

		indices.push(maxAreaPoint);
		const pointVal = data[maxAreaPoint];
		if (pointVal === undefined)
			throw new Error(`Expected data[${maxAreaPoint}] to be defined`);
		values.push(pointVal);
	}

	// Always keep last point
	indices.push(data.length - 1);
	const lastVal = data[data.length - 1];
	if (lastVal === undefined)
		throw new Error("Expected last data point to be defined");
	values.push(lastVal);

	return { indices, values };
}

/**
 * Downsample 2D matrix for heatmap rendering
 *
 * Uses averaging within buckets to reduce matrix size while preserving
 * overall patterns and gradients.
 *
 * @param matrix - 2D array of values to downsample
 * @param maxRows - Maximum number of rows in output
 * @param maxCols - Maximum number of columns in output
 * @returns Downsampled matrix
 *
 * @example
 * const matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
 * const downsampled = downsample2D(matrix, 2, 2);
 * // Returns [[3, 4.5], [7.5, 9]] (averaged buckets)
 */
export function downsample2D(
	matrix: number[][],
	maxRows: number,
	maxCols: number,
): number[][] {
	if (matrix.length === 0 || matrix[0]?.length === 0) {
		return matrix;
	}

	const firstRow = matrix[0];
	if (!firstRow) return matrix;

	if (matrix.length <= maxRows && firstRow.length <= maxCols) {
		return matrix;
	}

	const rowStep = Math.ceil(matrix.length / maxRows);
	const colStep = Math.ceil(firstRow.length / maxCols);

	const downsampled: number[][] = [];

	for (let r = 0; r < matrix.length; r += rowStep) {
		const row: number[] = [];

		for (let c = 0; c < firstRow.length; c += colStep) {
			// Average values in bucket
			let sum = 0;
			let count = 0;

			for (let dr = 0; dr < rowStep && r + dr < matrix.length; dr++) {
				const currentRow = matrix[r + dr];
				if (!currentRow) continue;

				for (let dc = 0; dc < colStep && c + dc < firstRow.length; dc++) {
					sum += currentRow[c + dc] ?? NaN;
					count++;
				}
			}

			row.push(sum / count);
		}

		downsampled.push(row);
	}

	return downsampled;
}

/**
 * Format axis label with appropriate precision and units
 *
 * @param value - Numeric value to format
 * @param unit - Optional unit string (e.g., "rpm", "°C")
 * @param precision - Number of decimal places (default: 2)
 * @returns Formatted label string
 *
 * @example
 * formatAxisLabel(1234.5678, "rpm", 1); // "1234.6 rpm"
 * formatAxisLabel(0.00123, "V", 4); // "0.0012 V"
 */
export function formatAxisLabel(
	value: number,
	unit?: string,
	precision = 2,
): string {
	const formatted = value.toFixed(precision);
	return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format value for tooltip display
 *
 * Automatically adjusts precision based on value magnitude.
 *
 * @param value - Numeric value to format
 * @param unit - Optional unit string
 * @returns Formatted value string
 *
 * @example
 * formatTooltipValue(1234.5678, "rpm"); // "1234.57 rpm"
 * formatTooltipValue(0.00123, "V"); // "0.00123 V"
 */
export function formatTooltipValue(value: number, unit?: string): string {
	// Determine precision based on magnitude
	let precision = 2;
	const absValue = Math.abs(value);

	if (absValue < 0.01) {
		precision = 5;
	} else if (absValue < 1) {
		precision = 4;
	} else if (absValue > 1000) {
		precision = 1;
	}

	return formatAxisLabel(value, unit, precision);
}

/**
 * Debounce function for performance optimization
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number,
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeoutId) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), delay);
	};
}
