import type { Endianness, ScalarType } from "@ecu-explorer/core";

/**
 * Theme colors for gradient visualization
 * Extracted from VSCode theme (git decoration colors)
 */
export interface ThemeColors {
	/** Gradient colors (for data visualization) */
	gradient: {
		/** Low value color (green - good) */
		low: string;
		/** Mid value color (yellow - warning) */
		mid: string;
		/** High value color (red - danger) */
		high: string;
	};
	/** UI colors */
	ui: {
		background: string;
		foreground: string;
		border: string;
	};
}

/**
 * Result of normalized value map computation
 */
export interface NormalizedMapResult {
	/** Map of cell coordinates to normalized values [0, 1]. Key format: "rowIndex-colIndex" */
	values: Map<string, number>;
	/** Minimum physical value in matrix */
	min: number;
	/** Maximum physical value in matrix */
	max: number;
	/** Range (max - min); 0 if all values identical */
	range: number;
}

/**
 * Decodes a scalar value from bytes
 */
function decodeScalar(
	bytes: Uint8Array,
	dtype: ScalarType,
	endianness: Endianness,
): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	switch (dtype) {
		case "u8":
			return view.getUint8(0);
		case "i8":
			return view.getInt8(0);
		case "u16":
			return view.getUint16(0, endianness === "le");
		case "i16":
			return view.getInt16(0, endianness === "le");
		case "u32":
			return view.getUint32(0, endianness === "le");
		case "i32":
			return view.getInt32(0, endianness === "le");
		case "f32":
			return view.getFloat32(0, endianness === "le");
		default:
			return NaN;
	}
}

/**
 * Computes min and max values from a matrix, handling 1D/2D/3D arrays
 * Filters out NaN values
 */
export function computeMinMax(
	data: Uint8Array[] | Uint8Array[][] | Uint8Array[][][],
	dtype: ScalarType,
	endianness: Endianness,
	scale: number,
	offset: number,
): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;

	// Handle 3D arrays
	if (Array.isArray(data[0]) && Array.isArray(data[0][0])) {
		const data3d = data as Uint8Array[][][];
		for (const layer of data3d) {
			for (const row of layer) {
				for (const cell of row) {
					const numeric = decodeScalar(cell, dtype, endianness);
					const physical = numeric * scale + offset;

					if (Number.isFinite(physical)) {
						min = Math.min(min, physical);
						max = Math.max(max, physical);
					}
				}
			}
		}
		return { min, max };
	}

	// Handle 2D arrays
	if (Array.isArray(data[0])) {
		const data2d = data as Uint8Array[][];
		for (const row of data2d) {
			for (const cell of row) {
				const numeric = decodeScalar(cell, dtype, endianness);
				const physical = numeric * scale + offset;

				if (Number.isFinite(physical)) {
					min = Math.min(min, physical);
					max = Math.max(max, physical);
				}
			}
		}
		return { min, max };
	}

	// Handle 1D arrays
	const data1d = data as Uint8Array[];
	for (const cell of data1d) {
		const numeric = decodeScalar(cell, dtype, endianness);
		const physical = numeric * scale + offset;

		if (Number.isFinite(physical)) {
			min = Math.min(min, physical);
			max = Math.max(max, physical);
		}
	}

	return { min, max };
}

/**
 * Normalizes a value to [0, 1] range
 */
export function normalizeValue(
	value: number,
	min: number,
	max: number,
): number {
	if (max === min) {
		// All values identical: return middle of gradient
		return 0.5;
	}

	const normalized = (value - min) / (max - min);
	return Math.max(0, Math.min(1, normalized));
}

/**
 * Computes the normalized value map for a matrix.
 * Returns a map of cell coordinates to normalized [0, 1] values
 * suitable for use as CSS custom property `--t` in `color-mix()` expressions.
 *
 * Handles 1D and 2D arrays.
 *
 * @param matrix - Matrix data (1D or 2D array of Uint8Array)
 * @param dtype - Scalar data type
 * @param endianness - Byte order
 * @param scale - Scale factor for physical values
 * @param offset - Offset for physical values
 * @returns Normalized map result with values [0,1], min, max, and range
 * @example
 * const result = computeNormalizedValues(matrix, "u16", "le", 1.0, 0.0);
 * // result.values.get("0-0") === 0.75 (normalized position in gradient)
 */
export function computeNormalizedValues(
	matrix: Uint8Array[][] | Uint8Array[],
	dtype: ScalarType,
	endianness: Endianness,
	scale: number,
	offset: number,
): NormalizedMapResult {
	const { min, max } = computeMinMax(matrix, dtype, endianness, scale, offset);
	const range = max - min;
	const values = new Map<string, number>();

	// Handle 2D arrays
	if (Array.isArray(matrix[0])) {
		const matrix2d = matrix as Uint8Array[][];
		for (let rowIndex = 0; rowIndex < matrix2d.length; rowIndex++) {
			const row = matrix2d[rowIndex] ?? [];
			for (let colIndex = 0; colIndex < row.length; colIndex++) {
				const cell = row[colIndex] ?? new Uint8Array();
				const numeric = decodeScalar(cell, dtype, endianness);
				const physical = numeric * scale + offset;

				let t: number;
				if (!Number.isFinite(physical)) {
					// Invalid values: use middle of gradient (neutral)
					t = 0.5;
				} else {
					t = normalizeValue(physical, min, max);
				}

				const key = `${rowIndex}-${colIndex}`;
				values.set(key, t);
			}
		}
	} else {
		// Handle 1D arrays
		const matrix1d = matrix as Uint8Array[];
		for (let colIndex = 0; colIndex < matrix1d.length; colIndex++) {
			const cell = matrix1d[colIndex] ?? new Uint8Array();
			const numeric = decodeScalar(cell, dtype, endianness);
			const physical = numeric * scale + offset;

			let t: number;
			if (!Number.isFinite(physical)) {
				// Invalid values: use middle of gradient (neutral)
				t = 0.5;
			} else {
				t = normalizeValue(physical, min, max);
			}

			const key = `0-${colIndex}`;
			values.set(key, t);
		}
	}

	return { values, min, max, range };
}

/**
 * Computes text color (white or black) for contrast against a gradient position.
 * Uses a simple threshold on the normalized value [0, 1]:
 * - Low values (dark gradient end) → white text
 * - High values (light gradient end) → depends on gradient
 *
 * Since we can no longer compute the actual background color in JS (it's now
 * done via CSS color-mix()), we use a simple heuristic based on the normalized
 * position. The default gradient goes green→yellow→red, which are all
 * medium-luminance colors, so we use a fixed threshold.
 *
 * @param t - Normalized value [0, 1]
 * @returns "white" or "black" for text contrast
 */
export function getContrastTextColor(t: number): "white" | "black" {
	// Both low (green) and high (red) ends are medium-dark; yellow mid is bright
	// Use white text at the extremes, black in the middle
	return t < 0.2 || t > 0.8 ? "white" : "black";
}
