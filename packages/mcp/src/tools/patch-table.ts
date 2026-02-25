/**
 * patch_table tool handler for the ECU Explorer MCP server.
 *
 * Applies a math operation to a calibration table and saves to ROM.
 * Returns the updated table in the same format as read_table.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import {
	addConstant,
	clampValues,
	decodeScalar,
	findClosestMatches,
	multiplyConstant,
	recomputeChecksum,
	smoothValues,
	writeChecksum,
} from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";
import {
	formatTable,
	writeTable1DValues,
	writeTable2DValues,
} from "../formatters/table-formatter.js";
import { invalidateRomCache, loadRom } from "../rom-loader.js";

export type PatchOp = "set" | "add" | "multiply" | "clamp" | "smooth";

export interface PatchTableOptions {
	rom: string;
	table: string;
	op: PatchOp;
	value?: number;
	min?: number;
	max?: number;
	row?: number;
	col?: number;
}

/**
 * Handle the patch_table tool call.
 *
 * @param options - Patch options
 * @param config - MCP server configuration
 * @returns Formatted output string (updated table)
 */
export async function handlePatchTable(
	options: PatchTableOptions,
	config: McpConfig,
): Promise<string> {
	const {
		rom: romPath,
		table: tableName,
		op,
		value,
		min,
		max,
		row,
		col,
	} = options;

	// Validate operation parameters
	if (op === "set" || op === "add" || op === "multiply") {
		if (value === undefined) {
			throw new Error(`Operation "${op}" requires a "value" parameter.`);
		}
	}

	if (op === "clamp") {
		if (min === undefined || max === undefined) {
			throw new Error(
				`Operation "clamp" requires both "min" and "max" parameters.`,
			);
		}
		if (min > max) {
			throw new Error(
				`"min" (${min}) must be less than or equal to "max" (${max}).`,
			);
		}
	}

	// Load ROM + definition
	const loaded = await loadRom(romPath, config.definitionsPaths);
	const { definition, romBytes } = loaded;

	// Find the table definition by name
	let tableDef = definition.tables.find((t) => t.name === tableName);

	// If not found, try case-insensitive exact match
	if (!tableDef) {
		tableDef = definition.tables.find(
			(t) => t.name.toLowerCase() === tableName.toLowerCase(),
		);
	}

	if (!tableDef) {
		const tableNames = definition.tables.map((t) => t.name);

		// Find fuzzy matches
		const suggestions = findClosestMatches(tableName, tableNames, 3, 20);
		const suggestionText =
			suggestions.length > 0
				? `\nDid you mean: ${suggestions.join(", ")}?`
				: "";

		throw new Error(
			`Table "${tableName}" not found in ROM definition "${definition.name}". ` +
				suggestionText +
				"\nUse list_tables to see all available tables.",
		);
	}

	// smooth is only valid for 2D tables
	if (op === "smooth" && tableDef.kind !== "table2d") {
		throw new Error(
			`Operation "smooth" is only valid for 2D tables. Table "${tableName}" is a ${tableDef.kind}.`,
		);
	}

	// Make a mutable copy of ROM bytes
	const mutableRomBytes = new Uint8Array(romBytes);

	if (tableDef.kind === "table1d") {
		// Read current values
		const currentValues = readTable1DPhysical(mutableRomBytes, tableDef);
		const numRows = currentValues.length;

		// Validate row/col bounds
		if (row !== undefined && row >= numRows) {
			throw new Error(
				`Row index ${row} is out of bounds for table "${tableName}" (${numRows} rows).`,
			);
		}
		if (col !== undefined && col >= 1) {
			throw new Error(
				`Column index ${col} is out of bounds for 1D table "${tableName}" (1 column).`,
			);
		}

		// Determine target indices
		const targetIndices: number[] =
			row !== undefined ? [row] : Array.from({ length: numRows }, (_, i) => i);

		// Extract target values
		const targetValues = targetIndices.map((i) => currentValues[i] as number);

		// Apply operation
		const newTargetValues = applyOp1D(op, targetValues, value, min, max);

		// Write back
		const newValues = [...currentValues];
		for (let i = 0; i < targetIndices.length; i++) {
			const idx = targetIndices[i] as number;
			newValues[idx] = newTargetValues[i] as number;
		}

		writeTable1DValues(mutableRomBytes, tableDef, newValues);
	} else if (tableDef.kind === "table2d") {
		// Read current values
		const currentValues = readTable2DPhysical(mutableRomBytes, tableDef);
		const numRows = currentValues.length;
		const numCols = currentValues[0]?.length ?? 0;

		// Validate row/col bounds
		if (row !== undefined && row >= numRows) {
			throw new Error(
				`Row index ${row} is out of bounds for table "${tableName}" (${numRows} rows).`,
			);
		}
		if (col !== undefined && col >= numCols) {
			throw new Error(
				`Column index ${col} is out of bounds for table "${tableName}" (${numCols} columns).`,
			);
		}

		let newValues: number[][];

		if (op === "smooth") {
			// smooth applies to entire table
			const result = smoothValues(currentValues);
			// Reshape flat result back to 2D
			newValues = [];
			for (let r = 0; r < numRows; r++) {
				const rowVals: number[] = [];
				for (let c = 0; c < numCols; c++) {
					rowVals.push(result.values[r * numCols + c] as number);
				}
				newValues.push(rowVals);
			}
		} else {
			// Determine target cells
			newValues = currentValues.map((r) => [...r]);

			if (row !== undefined && col !== undefined) {
				// Single cell
				const cell = currentValues[row]?.[col];
				if (cell === undefined) {
					throw new Error(
						`Cell [${row}, ${col}] is out of bounds for table "${tableName}".`,
					);
				}
				const [newVal] = applyOp1D(op, [cell], value, min, max);
				(newValues[row] as number[])[col] = newVal as number;
			} else if (row !== undefined) {
				// Entire row
				const rowVals = currentValues[row] as number[];
				const newRowVals = applyOp1D(op, rowVals, value, min, max);
				newValues[row] = newRowVals;
			} else if (col !== undefined) {
				// Entire column
				const colVals = currentValues.map((r) => r[col] as number);
				const newColVals = applyOp1D(op, colVals, value, min, max);
				for (let r = 0; r < numRows; r++) {
					(newValues[r] as number[])[col] = newColVals[r] as number;
				}
			} else {
				// Entire table
				const flat = currentValues.flat();
				const newFlat = applyOp1D(op, flat, value, min, max);
				newValues = [];
				for (let r = 0; r < numRows; r++) {
					const rowVals: number[] = [];
					for (let c = 0; c < numCols; c++) {
						rowVals.push(newFlat[r * numCols + c] as number);
					}
					newValues.push(rowVals);
				}
			}
		}

		writeTable2DValues(mutableRomBytes, tableDef, newValues);
	} else {
		throw new Error(`Patching 3D tables is not supported.`);
	}

	// Recompute and write checksum
	if (definition.checksum) {
		try {
			const newChecksum = recomputeChecksum(
				mutableRomBytes,
				definition.checksum,
			);
			writeChecksum(mutableRomBytes, newChecksum, definition.checksum);
		} catch (err) {
			process.stderr.write(
				`Warning: failed to update checksum after patch: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
	}

	// Atomically save to disk (temp file + rename)
	const absoluteRomPath = path.isAbsolute(romPath)
		? romPath
		: path.resolve(process.cwd(), romPath);

	const tmpPath = path.join(
		os.tmpdir(),
		`ecu-mcp-${Date.now()}-${path.basename(absoluteRomPath)}`,
	);

	try {
		await fs.writeFile(tmpPath, mutableRomBytes);
		await fs.rename(tmpPath, absoluteRomPath);
	} catch (err) {
		try {
			await fs.unlink(tmpPath);
		} catch {
			// Ignore cleanup errors
		}
		throw new Error(
			`Failed to write ROM file: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Invalidate ROM cache
	invalidateRomCache(absoluteRomPath);

	// Reload ROM with new bytes and return updated table
	const reloaded = await loadRom(romPath, config.definitionsPaths);
	const result = formatTable(romPath, tableDef, reloaded.romBytes);
	return result.content;
}

/**
 * Apply a 1D operation to an array of values.
 */
function applyOp1D(
	op: PatchOp,
	values: number[],
	value?: number,
	min?: number,
	max?: number,
): number[] {
	switch (op) {
		case "set":
			return values.map(() => value as number);
		case "add": {
			const result = addConstant(values, value as number);
			return result.values;
		}
		case "multiply": {
			const result = multiplyConstant(values, value as number);
			return result.values;
		}
		case "clamp": {
			const result = clampValues(values, min as number, max as number);
			return result.values;
		}
		case "smooth":
			// smooth is handled separately for 2D tables
			throw new Error(`smooth operation is not valid for 1D arrays`);
	}
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
 * Read physical values from a 1D table.
 */
function readTable1DPhysical(
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
 * Read physical values from a 2D table.
 */
function readTable2DPhysical(
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
