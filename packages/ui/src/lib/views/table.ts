import type { AxisDefinition, ScalarType, Unit } from "@ecu-explorer/core";
import { decodeScalarBytes } from "@ecu-explorer/core";

/**
 * Get the step value for a number input based on data type and scale
 */
export function getStepForDataType(dtype: ScalarType, scale?: number): number {
	// For integers, step is 1 (or scaled)
	if (
		dtype === "u8" ||
		dtype === "i8" ||
		dtype === "u16" ||
		dtype === "i16" ||
		dtype === "u32" ||
		dtype === "i32"
	) {
		return scale && scale !== 1 ? scale : 1;
	}

	// For floats, calculate based on scale or default to 0.01
	if (dtype === "f32") {
		if (scale && scale !== 1) {
			// Use a step that's 1% of the scale
			return scale * 0.01;
		}
		return 0.01;
	}

	return 1;
}

/**
 * Get min/max range for a data type
 */
export function getRangeForDataType(dtype: ScalarType): {
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
			// For floats, we don't set hard limits
			return { min: -Infinity, max: Infinity };
		default:
			return { min: -Infinity, max: Infinity };
	}
}

/**
 * Format an axis value with its unit
 */
export function formatAxisValue(value: number, unit?: Unit): string {
	// Format the value with appropriate precision
	// Use up to 2 decimal places, but remove trailing zeros
	const formatted = Number.isInteger(value)
		? value.toString()
		: Number(value.toFixed(2)).toString();

	// Append unit if present
	if (unit?.symbol) {
		return `${formatted}${unit.symbol}`;
	}

	return formatted;
}

/**
 * Get the byte size of a scalar type
 */
function sizeOf(dtype: ScalarType): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
		default:
			return 1;
	}
}

/**
 * Load axis values from ROM or return static values
 */
export function loadAxisValues(
	axis: AxisDefinition | undefined,
	rom: Uint8Array,
): number[] | null {
	// Return null if axis is undefined
	if (!axis) {
		return null;
	}

	// Handle static axes
	if (axis.kind === "static") {
		return axis.values;
	}

	// Handle dynamic axes (read from ROM)
	const values: number[] = [];
	const elementSize = sizeOf(axis.dtype);
	const endianness = axis.endianness ?? "le";
	const scale = axis.scale ?? 1;
	const offset = axis.offset ?? 0;

	for (let i = 0; i < axis.length; i++) {
		const byteOffset = axis.address + i * elementSize;

		// Check bounds
		if (byteOffset + elementSize > rom.length) {
			console.warn(`Axis value at index ${i} is out of ROM bounds`);
			break;
		}

		// Extract bytes for this element
		const bytes = rom.slice(byteOffset, byteOffset + elementSize);

		// Decode and apply scale/offset
		const raw = decodeScalarBytes(bytes, axis.dtype, endianness);
		const scaled = raw * scale + offset;
		values.push(scaled);
	}

	return values;
}
