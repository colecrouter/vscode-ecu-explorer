/**
 * Table formatter for the ECU Explorer MCP server.
 *
 * Renders calibration table data as YAML frontmatter + markdown table.
 *
 * 1D table layout:
 *   | Axis (unit) | Value (unit) |
 *   |-------------|--------------|
 *   | val         | val          |
 *
 * 2D table layout:
 *   | Y\X | x0 | x1 | ... |
 *   |-----|----|----|-----|
 *   | y0  | v  | v  | ... |
 */

import type {
	AxisDefinition,
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import { decodeScalar } from "@ecu-explorer/core";
import { buildMarkdownTable } from "./markdown.js";
import { toYamlFrontmatter } from "./yaml-formatter.js";

export interface TableReadResult {
	/** YAML frontmatter + markdown table */
	content: string;
	/** Number of rows */
	rows: number;
	/** Number of columns (1 for 1D tables) */
	cols: number;
	/** Decoded cell values (row-major) */
	values: number[][];
	/** X-axis values (column breakpoints) */
	xAxisValues: number[];
	/** Y-axis values (row breakpoints) */
	yAxisValues: number[];
}

/**
 * Get the byte size of a scalar type.
 */
function byteSize(
	dtype: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32",
): number {
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
	}
}

/**
 * Read axis values from ROM bytes.
 *
 * @param romBytes - ROM image bytes
 * @param axis - Axis definition
 * @returns Array of physical axis values
 */
function readAxisValues(romBytes: Uint8Array, axis: AxisDefinition): number[] {
	if (axis.kind === "static") {
		return axis.values.slice();
	}

	// Dynamic axis: read from ROM
	const values: number[] = [];
	const scale = axis.scale ?? 1;
	const offset = axis.offset ?? 0;
	const endian = axis.endianness ?? "le";
	const elemSize = byteSize(axis.dtype);

	for (let i = 0; i < axis.length; i++) {
		const byteOffset = axis.address + i * elemSize;
		const raw = decodeScalar(romBytes, byteOffset, axis.dtype, { endian });
		values.push(raw * scale + offset);
	}

	return values;
}

/**
 * Read all cell values from a 1D table.
 *
 * @param romBytes - ROM image bytes
 * @param def - Table definition
 * @returns Array of physical values
 */
function readTable1DValues(
	romBytes: Uint8Array,
	def: Table1DDefinition,
): number[] {
	const z = def.z;
	const scale = z.scale ?? 1;
	const offset = z.offset ?? 0;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const length = z.length ?? def.rows;
	const values: number[] = [];

	for (let i = 0; i < length; i++) {
		const byteOffset = z.address + i * elemSize;
		const raw = decodeScalar(romBytes, byteOffset, z.dtype, { endian });
		values.push(raw * scale + offset);
	}

	return values;
}

/**
 * Read all cell values from a 2D table (row-major).
 *
 * @param romBytes - ROM image bytes
 * @param def - Table definition
 * @returns 2D array of physical values [row][col]
 */
function readTable2DValues(
	romBytes: Uint8Array,
	def: Table2DDefinition,
): number[][] {
	const z = def.z;
	const scale = z.scale ?? 1;
	const offset = z.offset ?? 0;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const rowStride = z.rowStrideBytes ?? def.cols * elemSize;
	const colStride = z.colStrideBytes ?? elemSize;

	const result: number[][] = [];

	for (let r = 0; r < def.rows; r++) {
		const row: number[] = [];
		for (let c = 0; c < def.cols; c++) {
			let byteOffset: number;
			if (z.indexer) {
				byteOffset = z.address + z.indexer(r, c);
			} else {
				byteOffset = z.address + r * rowStride + c * colStride;
			}
			const raw = decodeScalar(romBytes, byteOffset, z.dtype, { endian });
			row.push(raw * scale + offset);
		}
		result.push(row);
	}

	return result;
}

/**
 * Format a number for display in a table cell.
 * Avoids excessive decimal places while preserving precision.
 */
function formatNumber(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	// Use up to 4 decimal places, trimming trailing zeros
	const s = n.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

/**
 * Format a 1D table as YAML frontmatter + markdown table.
 *
 * @param romPath - Path to the ROM file (for metadata)
 * @param def - Table definition
 * @param romBytes - ROM image bytes
 * @param writeStatus - Optional write status to include in frontmatter
 * @returns Formatted table content
 */
export function formatTable1D(
	romPath: string,
	def: Table1DDefinition,
	romBytes: Uint8Array,
	writeStatus?: { status: string; cellsWritten: number },
): TableReadResult {
	const values = readTable1DValues(romBytes, def);
	const xAxisValues = def.x ? readAxisValues(romBytes, def.x) : [];

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		table: def.name,
		rom: romPath,
		kind: "table1d",
		rows: values.length,
		unit: def.z.unit ?? "",
	};

	if (def.x) {
		frontmatterData["x_axis_name"] = def.x.name;
		frontmatterData["x_axis_unit"] = def.x.unit ?? "";
	}

	if (writeStatus) {
		frontmatterData["write_status"] = writeStatus.status;
		frontmatterData["cells_written"] = writeStatus.cellsWritten;
	} else {
		frontmatterData["dirty"] = false;
	}

	const frontmatter = toYamlFrontmatter(frontmatterData);

	// Build markdown table
	const axisName = def.x ? `${def.x.name} (${def.x.unit ?? ""})` : "Index";
	const valueName = `${def.name} (${def.z.unit ?? ""})`;
	const headers = [axisName, valueName];

	const tableRows: string[][] = values.map((val, i) => {
		const axisVal =
			xAxisValues.length > i
				? formatNumber(xAxisValues[i] as number)
				: String(i);
		return [axisVal, formatNumber(val)];
	});

	const markdownTable = buildMarkdownTable(headers, tableRows);

	return {
		content: `${frontmatter}\n${markdownTable}`,
		rows: values.length,
		cols: 1,
		values: values.map((v) => [v]),
		xAxisValues,
		yAxisValues: [],
	};
}

/**
 * Format a 2D table as YAML frontmatter + markdown table.
 *
 * @param romPath - Path to the ROM file (for metadata)
 * @param def - Table definition
 * @param romBytes - ROM image bytes
 * @param writeStatus - Optional write status to include in frontmatter
 * @returns Formatted table content
 */
export function formatTable2D(
	romPath: string,
	def: Table2DDefinition,
	romBytes: Uint8Array,
	writeStatus?: { status: string; cellsWritten: number },
): TableReadResult {
	const values = readTable2DValues(romBytes, def);
	const xAxisValues = def.x ? readAxisValues(romBytes, def.x) : [];
	const yAxisValues = def.y ? readAxisValues(romBytes, def.y) : [];

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		table: def.name,
		rom: romPath,
		kind: "table2d",
		rows: def.rows,
		cols: def.cols,
		unit: def.z.unit ?? "",
	};

	if (def.x) {
		frontmatterData["x_axis_name"] = def.x.name;
		frontmatterData["x_axis_unit"] = def.x.unit ?? "";
	}

	if (def.y) {
		frontmatterData["y_axis_name"] = def.y.name;
		frontmatterData["y_axis_unit"] = def.y.unit ?? "";
	}

	if (writeStatus) {
		frontmatterData["write_status"] = writeStatus.status;
		frontmatterData["cells_written"] = writeStatus.cellsWritten;
	} else {
		frontmatterData["dirty"] = false;
	}

	const frontmatter = toYamlFrontmatter(frontmatterData);

	// Build markdown table
	// Header: Y\X | x0 | x1 | ...
	const yAxisLabel = def.y
		? `${def.y.name}\\${def.x?.name ?? "X"}`
		: `Y\\${def.x?.name ?? "X"}`;

	const xHeaders =
		xAxisValues.length > 0
			? xAxisValues.map(formatNumber)
			: Array.from({ length: def.cols }, (_, i) => String(i));

	const headers = [yAxisLabel, ...xHeaders];

	const tableRows: string[][] = values.map((row, r) => {
		const yLabel =
			yAxisValues.length > r
				? formatNumber(yAxisValues[r] as number)
				: String(r);
		return [yLabel, ...row.map(formatNumber)];
	});

	const markdownTable = buildMarkdownTable(headers, tableRows);

	return {
		content: `${frontmatter}\n${markdownTable}`,
		rows: def.rows,
		cols: def.cols,
		values,
		xAxisValues,
		yAxisValues,
	};
}

/**
 * Format a table (1D or 2D) as YAML frontmatter + markdown table.
 *
 * @param romPath - Path to the ROM file (for metadata)
 * @param def - Table definition
 * @param romBytes - ROM image bytes
 * @param writeStatus - Optional write status to include in frontmatter
 * @returns Formatted table content
 */
export function formatTable(
	romPath: string,
	def: TableDefinition,
	romBytes: Uint8Array,
	writeStatus?: { status: string; cellsWritten: number },
): TableReadResult {
	if (def.kind === "table1d") {
		return formatTable1D(romPath, def, romBytes, writeStatus);
	}
	if (def.kind === "table2d") {
		return formatTable2D(romPath, def, romBytes, writeStatus);
	}

	// table3d: treat as 2D (first layer)
	// For now, render as a note
	const frontmatterData: Record<string, unknown> = {
		table: def.name,
		rom: romPath,
		kind: "table3d",
		rows: def.rows,
		cols: def.cols,
		depth: def.depth,
		unit: def.z.unit ?? "",
		note: "3D tables are not fully supported. Showing first layer.",
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	return {
		content: `${frontmatter}\n(3D table — first layer display not yet implemented)`,
		rows: def.rows,
		cols: def.cols,
		values: [],
		xAxisValues: [],
		yAxisValues: [],
	};
}

/**
 * Write new values to a 1D table in ROM bytes (in-place mutation).
 *
 * @param romBytes - ROM image bytes (will be mutated)
 * @param def - Table definition
 * @param newValues - New physical values to write (1D array)
 * @returns Number of cells written
 */
export function writeTable1DValues(
	romBytes: Uint8Array,
	def: Table1DDefinition,
	newValues: number[],
): number {
	const z = def.z;
	const scale = z.scale ?? 1;
	const offset = z.offset ?? 0;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const length = z.length ?? def.rows;

	if (newValues.length !== length) {
		throw new Error(
			`Value count mismatch: expected ${length}, got ${newValues.length}`,
		);
	}

	const dv = new DataView(
		romBytes.buffer,
		romBytes.byteOffset,
		romBytes.byteLength,
	);
	const le = endian === "le";

	for (let i = 0; i < length; i++) {
		const physVal = newValues[i] as number;
		const rawVal = scale !== 0 ? (physVal - offset) / scale : physVal;
		const byteOffset = z.address + i * elemSize;

		writeScalarToView(dv, byteOffset, z.dtype, le, rawVal);
	}

	return length;
}

/**
 * Write new values to a 2D table in ROM bytes (in-place mutation).
 *
 * @param romBytes - ROM image bytes (will be mutated)
 * @param def - Table definition
 * @param newValues - New physical values to write (2D array [row][col])
 * @returns Number of cells written
 */
export function writeTable2DValues(
	romBytes: Uint8Array,
	def: Table2DDefinition,
	newValues: number[][],
): number {
	const z = def.z;
	const scale = z.scale ?? 1;
	const offset = z.offset ?? 0;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const rowStride = z.rowStrideBytes ?? def.cols * elemSize;
	const colStride = z.colStrideBytes ?? elemSize;

	if (newValues.length !== def.rows) {
		throw new Error(
			`Row count mismatch: expected ${def.rows}, got ${newValues.length}`,
		);
	}

	const dv = new DataView(
		romBytes.buffer,
		romBytes.byteOffset,
		romBytes.byteLength,
	);
	const le = endian === "le";
	let cellsWritten = 0;

	for (let r = 0; r < def.rows; r++) {
		const row = newValues[r];
		if (!row || row.length !== def.cols) {
			throw new Error(
				`Column count mismatch at row ${r}: expected ${def.cols}, got ${row?.length ?? 0}`,
			);
		}

		for (let c = 0; c < def.cols; c++) {
			const physVal = row[c] as number;
			const rawVal = scale !== 0 ? (physVal - offset) / scale : physVal;

			let byteOffset: number;
			if (z.indexer) {
				byteOffset = z.address + z.indexer(r, c);
			} else {
				byteOffset = z.address + r * rowStride + c * colStride;
			}

			writeScalarToView(dv, byteOffset, z.dtype, le, rawVal);
			cellsWritten++;
		}
	}

	return cellsWritten;
}

/**
 * Write a scalar value to a DataView at the given offset.
 */
function writeScalarToView(
	dv: DataView,
	offset: number,
	dtype: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32",
	le: boolean,
	value: number,
): void {
	const rounded = Math.round(value);
	switch (dtype) {
		case "u8":
			dv.setUint8(offset, Math.max(0, Math.min(255, rounded)));
			break;
		case "i8":
			dv.setInt8(offset, Math.max(-128, Math.min(127, rounded)));
			break;
		case "u16":
			dv.setUint16(offset, Math.max(0, Math.min(65535, rounded)), le);
			break;
		case "i16":
			dv.setInt16(offset, Math.max(-32768, Math.min(32767, rounded)), le);
			break;
		case "u32":
			dv.setUint32(offset, Math.max(0, rounded) >>> 0, le);
			break;
		case "i32":
			dv.setInt32(offset, rounded | 0, le);
			break;
		case "f32":
			dv.setFloat32(offset, value, le);
			break;
	}
}
