/**
 * Table view for reading and writing table data from ROM
 *
 * Provides a high-level interface for accessing table data with support for:
 * - 1D, 2D, and 3D tables
 * - Multiple data types (u8, i8, u16, i16, u32, i32, f32)
 * - Endianness handling (little-endian, big-endian)
 * - Physical and raw value modes
 * - Axis definitions (static and dynamic)
 * - Custom indexers for non-linear layouts
 */

import type { Endianness } from "../binary";
import {
	decodeScalar,
	decodeScalarBytes,
	encodeScalar,
	sizeOf,
} from "../binary";
import type {
	AxisDefinition,
	DynamicArrayDefinition,
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
	ZDataDefinition,
} from "../definition/table";
import type { Unit } from "../units";

type AccessMode = "raw" | "physical";

/**
 * Snapshot of a table at a given point in time
 *
 * Contains the current values of a table read from ROM.
 * Used for displaying table data in the UI and for CSV export/import.
 */
export type TableSnapshot =
	| {
			kind: "table1d";
			name: string;
			rows: number;
			x?: number[];
			z: number[];
			description?: string;
	  }
	| {
			kind: "table2d";
			name: string;
			rows: number;
			cols: number;
			x?: number[];
			y?: number[];
			z: number[][];
			description?: string;
	  };

/**
 * Main table view class for ROM table access
 *
 * Manages reading and writing table data from ROM bytes with support for
 * various data types, endianness, and scaling/offset transformations.
 *
 * @example
 * const table = new TableView(rom, definition);
 * const value = table.get(0, 0, "physical");
 * table.set(0, 0, 100, "physical");
 * const allData = table.readAll();
 */
export class TableView {
	/**
	 * Initialize table view
	 *
	 * @param rom - ROM image bytes
	 * @param def - Table definition with metadata
	 * @throws Error if table dimensions cannot be determined
	 */
	constructor(
		private rom: Uint8Array,
		public def: TableDefinition,
	) {
		if (def.kind === "table3d") {
			this.rows = def.rows;
			this.cols = def.cols;
			this.depth = def.depth;
		} else if (def.kind === "table2d") {
			this.rows = def.rows;
			this.cols = def.cols;
			this.depth = 1;
		} else {
			// 1D: derive length
			const len =
				def.z.length ??
				(def.x && def.x.kind === "static" ? def.x.values.length : undefined) ??
				(def.x && def.x.kind === "dynamic" ? def.x.length : undefined);
			if (!len) {
				throw new Error(
					`table1d "${def.name}" needs z.length or x axis length to be known`,
				);
			}
			this.rows = 1;
			this.cols = len;
			this.depth = 1;
		}

		this.z = def.z;
		this.dtypeSize = sizeOf(this.z.dtype);
		this.endian = this.z.endianness ?? "le";
		this.scale = this.z.scale ?? 1;
		this.offset = this.z.offset ?? 0;

		// Layout defaults for 2D/3D
		if (def.kind === "table2d" || def.kind === "table3d") {
			this.rowStride = this.z.rowStrideBytes ?? this.cols * this.dtypeSize;
			this.colStride = this.z.colStrideBytes ?? this.dtypeSize;
		} else {
			// 1D: treat as a single row (rowStride ignored)
			this.rowStride = this.cols * this.dtypeSize;
			this.colStride = this.dtypeSize;
		}
	}

	readonly rows: number;
	readonly cols: number;
	readonly depth: number;

	private readonly z: ZDataDefinition;
	private readonly dtypeSize: number;
	private readonly endian: Endianness;
	private readonly scale: number;
	private readonly offset: number;
	private readonly rowStride: number;
	private readonly colStride: number;

	// --- Reading/writing Z (table body) ---

	/**
	 * Get a cell value from the table
	 *
	 * @param r - Row index (0-based)
	 * @param c - Column index (0-based)
	 * @param mode - "raw" for untransformed value, "physical" for scaled/offset value
	 * @returns The cell value
	 * @throws RangeError if coordinates are out of bounds
	 */
	get(r: number, c: number, mode: AccessMode = "physical"): number {
		this.checkBounds(r, c);
		const off = this.cellByteOffset(r, c);
		const raw = decodeScalar(this.rom, off, this.z.dtype, {
			endian: this.endian,
		});
		const value = raw * this.scale + this.offset;
		return mode === "raw" ? raw : value;
	}

	/**
	 * Set a cell value in the table
	 *
	 * @param r - Row index (0-based)
	 * @param c - Column index (0-based)
	 * @param value - The value to set
	 * @param mode - "raw" for untransformed value, "physical" for scaled/offset value
	 * @throws RangeError if coordinates are out of bounds
	 */
	set(r: number, c: number, value: number, mode: AccessMode = "physical") {
		this.checkBounds(r, c);
		const off = this.cellByteOffset(r, c);
		const raw =
			mode === "raw" ? value : Math.round((value - this.offset) / this.scale);
		const bytes = encodeScalar(raw, this.z.dtype, this.endian);
		this.rom.set(bytes, off);
	}

	/**
	 * Read all table values
	 *
	 * @param mode - "raw" for untransformed values, "physical" for scaled/offset values
	 * @returns 2D array of table values (rows × cols)
	 */
	readAll(mode: AccessMode = "physical"): number[][] {
		const out: number[][] = [];
		for (let r = 0; r < this.rows; r++) {
			const row: number[] = [];
			for (let c = 0; c < this.cols; c++) {
				row[c] = this.get(r, c, mode);
			}
			out[r] = row;
		}
		return out;
	}

	/**
	 * Apply a patch of cell changes
	 *
	 * @param cells - Array of cell updates with row, column, and new value
	 */
	applyPatch(
		cells: { r: number; c: number; new: number; mode?: AccessMode }[],
	) {
		for (const p of cells) {
			this.set(p.r, p.c, p.new, p.mode ?? "physical");
		}
	}

	// --- Axes ---

	/**
	 * Read axis values from ROM
	 *
	 * Handles both static and dynamic axes:
	 * - Static axes have fixed values defined in the table definition
	 * - Dynamic axes store values in ROM and must be read
	 *
	 * @param ax - Axis definition
	 * @returns Object with scaled axis values and unit
	 */
	readAxis(ax: AxisDefinition): { values: number[]; unit: Unit | undefined } {
		if (ax.kind === "static") {
			return { values: ax.values.slice(), unit: ax.unit };
		}
		// dynamic
		const dyn = ax as DynamicArrayDefinition;
		const dynScale = dyn.scale ?? 1;
		const dynOffset = dyn.offset ?? 0;
		const endian = dyn.endianness ?? "le";
		const dtypeSize = sizeOf(dyn.dtype);
		const values = new Array(dyn.length);
		for (let i = 0; i < dyn.length; i++) {
			const off = dyn.address + i * dtypeSize;
			const bytes = this.rom.subarray(off, off + dtypeSize);
			const raw = decodeScalarBytes(bytes, dyn.dtype, endian);
			values[i] = raw * dynScale + dynOffset;
		}
		return { values, unit: dyn.unit };
	}

	// --- Address calculation ---

	/**
	 * Calculate the byte address for a cell in the ROM
	 *
	 * Computes the absolute address of a table cell based on:
	 * - Base address of the table data
	 * - Row and column indices
	 * - Row and column strides (spacing between consecutive elements)
	 * - Element data type size
	 *
	 * For 1D tables, only the row is used (column is ignored).
	 *
	 * @param row - Row index (0-based)
	 * @param col - Column index (0-based; only used for 2D tables)
	 * @returns Byte address of the cell in the ROM
	 */
	cellByteOffset(row: number, col: number): number {
		if (this.z.indexer) {
			// indexer computes relative offset from z.address
			return this.z.address + this.z.indexer(row, col);
		}
		return this.z.address + row * this.rowStride + col * this.colStride;
	}

	private checkBounds(r: number, c: number) {
		if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) {
			throw new RangeError(
				`cell out of range: r=${r}, c=${c} (rows=${this.rows}, cols=${this.cols})`,
			);
		}
	}
}

// --- Standalone functions ---

/**
 * Calculate the byte address for a cell in the ROM
 *
 * Computes the absolute address of a table cell based on:
 * - Base address of the table data
 * - Row and column indices
 * - Row and column strides (spacing between consecutive elements)
 * - Element data type size
 *
 * For 1D tables, only the row is used (column is ignored).
 *
 * @param def - Table definition containing address and stride information
 * @param row - Row index (0-based)
 * @param col - Column index (0-based; only used for 2D tables)
 * @returns Byte address of the cell in the ROM
 *
 * @example
 * const address = calculateCellAddress(tableDef, 0, 5); // Get address of row 0, col 5
 */
export function calculateCellAddress(
	def: TableDefinition,
	row: number,
	col: number,
): number {
	const { z } = def;
	const base = z.address ?? 0;
	const elementSize = sizeOf(z.dtype);
	const colStride = z.colStrideBytes ?? elementSize;

	if (def.kind === "table1d") {
		const rowStride = z.rowStrideBytes ?? elementSize;
		return base + row * rowStride;
	}

	const t = def as Table2DDefinition;
	const rowStride = z.rowStrideBytes ?? t.cols * colStride;
	return base + row * rowStride + col * colStride;
}

/**
 * Read axis values from ROM (standalone function)
 *
 * Handles both static and dynamic axes:
 * - Static axes have fixed values defined in the table definition
 * - Dynamic axes store values in ROM and must be read
 *
 * @param axis - Axis definition (may be undefined)
 * @param rom - ROM bytes to read from
 * @returns Array of scaled axis values, or undefined if axis is not defined
 *
 * @example
 * const xValues = readAxis(tableDef.x, rom);
 */
export function readAxis(
	axis: AxisDefinition | undefined,
	rom: Uint8Array,
): number[] | undefined {
	if (!axis) return undefined;
	if (axis.kind === "static") return axis.values;
	const dyn = axis as DynamicArrayDefinition;
	const width = sizeOf(dyn.dtype);
	const out: number[] = [];
	for (let i = 0; i < dyn.length; i++) {
		const addr = dyn.address + i * width;
		const cell = rom.subarray(addr, addr + width);
		const raw = decodeScalarBytes(cell, dyn.dtype, dyn.endianness ?? "le");
		const scaled = raw * (dyn.scale ?? 1) + (dyn.offset ?? 0);
		out.push(scaled);
	}
	return out;
}

/**
 * Create a snapshot of a table from ROM bytes
 *
 * Reads all values from ROM at the addresses specified in the table definition,
 * applies scaling and offset transforms, and returns a snapshot object.
 *
 * Handles all table kinds:
 * - 1D tables: Single row of values with optional X axis
 * - 2D tables: 2D grid of values with optional X and Y axes
 *
 * @param def - Table definition with layout information
 * @param rom - ROM bytes to read from
 * @returns Snapshot containing all table values and axes
 * @throws Error if ROM read fails or table data is corrupted
 *
 * @example
 * const snapshot = snapshotTable(tableDef, rom);
 * console.log(snapshot.z); // 2D array of table values
 */
export function snapshotTable(
	def: TableDefinition,
	rom: Uint8Array,
): TableSnapshot {
	if (def.kind === "table1d") {
		const t = def as Table1DDefinition;
		const width = sizeOf(t.z.dtype);
		const stride = t.z.rowStrideBytes ?? width;
		const endian = t.z.endianness ?? "le";
		const scale = t.z.scale ?? 1;
		const offset = t.z.offset ?? 0;
		const z: number[] = [];
		for (let r = 0; r < t.rows; r++) {
			const addr = t.z.address + r * stride;
			const bytes = rom.subarray(addr, addr + width);
			const raw = decodeScalarBytes(bytes, t.z.dtype, endian);
			z.push(raw * scale + offset);
		}
		const x = readAxis(t.x, rom);
		const result: TableSnapshot = {
			kind: "table1d" as const,
			name: t.name,
			rows: t.rows,
			...(x ? { x } : {}),
			z,
		};
		return result;
	}

	// 2D table
	const t = def as Table2DDefinition;
	const width = sizeOf(t.z.dtype);
	const colStride = t.z.colStrideBytes ?? width;
	const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
	const endian = t.z.endianness ?? "le";
	const scale = t.z.scale ?? 1;
	const offset = t.z.offset ?? 0;
	const z: number[][] = [];
	for (let r = 0; r < t.rows; r++) {
		const row: number[] = [];
		for (let c = 0; c < t.cols; c++) {
			const addr = t.z.address + r * rowStride + c * colStride;
			const bytes = rom.subarray(addr, addr + width);
			const raw = decodeScalarBytes(bytes, t.z.dtype, endian);
			row.push(raw * scale + offset);
		}
		z.push(row);
	}
	const x = readAxis(t.x, rom);
	const y = readAxis(t.y, rom);
	const result: TableSnapshot = {
		kind: "table2d" as const,
		name: t.name,
		rows: t.rows,
		cols: t.cols,
		...(x ? { x } : {}),
		...(y ? { y } : {}),
		z,
	};
	return result;
}
