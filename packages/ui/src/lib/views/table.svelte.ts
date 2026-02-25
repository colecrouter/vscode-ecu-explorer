import type {
	MathOpConstraints,
	MathOpResult,
	Table2DDefinition,
	Table3DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import {
	addConstant,
	clampValues,
	multiplyConstant,
	smoothValues,
} from "@ecu-explorer/core";
import type { RangeEdit, Transaction } from "../types/transaction";
import { getRangeForDataType } from "./table";

type ReactiveTable<T extends TableDefinition> = T extends Table3DDefinition
	? Uint8Array[][][]
	: T extends Table2DDefinition
		? Uint8Array[][]
		: Uint8Array[];

type CellLocation = {
	depth: number;
	row: number;
	col: number;
};

/**
 * Cell coordinate for selection
 */
export type CellCoordinate = {
	row: number;
	col: number;
	depth?: number;
};

/**
 * Selection range from start to end coordinates
 */
export type SelectionRange = {
	start: CellCoordinate;
	end: CellCoordinate;
};

/**
 * Reactive table view for Svelte components
 *
 * Manages table data with reactive state, undo/redo support, and transaction tracking.
 * Supports 1D, 2D, and 3D tables with various data types and strides.
 *
 * @template T - Table definition type (1D, 2D, or 3D)
 * @example
 * const table = new TableView(rom, definition);
 * table.stageCell({ row: 0, col: 0 }, newBytes);
 * const transaction = table.commit('Edit cell');
 * table.undo();
 */
export class TableView<T extends TableDefinition> {
	protected def: T;
	protected rom: Uint8Array;
	protected transactions = $state<Transaction[]>([]);
	protected undone = $state<Transaction[]>([]);
	private hasPendingChanges = $state(false);

	private readonly cellIndex = new Map<number, CellLocation>();

	// Selection state
	private selectedCells = $state<Set<string>>(new Set());
	private selectionAnchor = $state<CellCoordinate | null>(null);
	private selectionRange = $state<SelectionRange | null>(null);

	/**
	 * Reactive table data
	 *
	 * Structure depends on table type:
	 * - 1D: Uint8Array[]
	 * - 2D: Uint8Array[][]
	 * - 3D: Uint8Array[][][]
	 */
	public readonly data: ReactiveTable<T>;

	/**
	 * Initialize table view
	 *
	 * @param rom - ROM image bytes
	 * @param def - Table definition
	 * @param transactions - Initial transaction history (default: empty)
	 * @param undone - Initial redo history (default: empty)
	 */
	constructor(
		rom: Uint8Array,
		def: T,
		initialTransactions: Transaction[] = [],
		initialUndone: Transaction[] = [],
	) {
		this.rom = rom;
		this.def = def;
		this.transactions = initialTransactions;
		this.undone = initialUndone;
		this.data = this.loadFromROM();
	}

	/**
	 * Load table data from ROM
	 *
	 * Creates reactive state for all cells and builds cell index for fast lookup.
	 *
	 * @returns Reactive table data structure
	 * @private
	 */
	private loadFromROM(): ReactiveTable<T> {
		this.cellIndex.clear();
		const { def } = this;

		if (def.kind === "table3d") {
			const layers: Uint8Array[][][] = [];
			for (let depth = 0; depth < def.depth; depth++) {
				const rows: Uint8Array[][] = [];
				for (let row = 0; row < def.rows; row++) {
					const cols: Uint8Array[] = [];
					for (let col = 0; col < def.cols; col++) {
						const address = this.cellOffset(row, col, depth);
						const value = this.readBytes(address);
						this.cellIndex.set(address, { depth, row, col });
						cols.push(value);
					}
					rows.push(cols);
				}
				layers.push(rows);
			}
			const reactiveData = $state(layers);
			return reactiveData as ReactiveTable<T>;
		}

		if (def.kind === "table2d") {
			const rows: Uint8Array[][] = [];
			for (let row = 0; row < def.rows; row++) {
				const cols: Uint8Array[] = [];
				for (let col = 0; col < def.cols; col++) {
					const address = this.cellOffset(row, col);
					const value = this.readBytes(address);
					this.cellIndex.set(address, { depth: 0, row, col });
					cols.push(value);
				}
				rows.push(cols);
			}
			const reactiveData = $state(rows);
			return reactiveData as ReactiveTable<T>;
		}

		const cells: Uint8Array[] = [];
		for (let row = 0; row < def.rows; row++) {
			const address = this.cellOffset(row);
			const value = this.readBytes(address);
			this.cellIndex.set(address, { depth: 0, row, col: 0 });
			cells.push(value);
		}
		const reactiveData = $state(cells);
		return reactiveData as ReactiveTable<T>;
	}

	private cellOffset(row: number, col = 0, depth = 0): number {
		const { def } = this;
		const { z } = def;
		const base = z.address ?? 0;

		if (z.indexer) {
			return base + z.indexer(row, col);
		}

		const elementSize = this.elementSize();
		const colStride = z.colStrideBytes ?? elementSize;
		let rowStride = z.rowStrideBytes ?? elementSize;

		if (def.kind !== "table1d") {
			const cols = (def as Table2DDefinition | Table3DDefinition).cols;
			rowStride = z.rowStrideBytes ?? cols * colStride;
		}

		let depthStride = 0;
		if (def.kind === "table3d") {
			const rows = (def as Table3DDefinition).rows;
			depthStride = rowStride * rows;
		}

		return base + depth * depthStride + row * rowStride + col * colStride;
	}

	private elementSize(): number {
		switch (this.def.z.dtype) {
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
				throw new Error(`Unknown dtype: ${this.def.z.dtype}`);
		}
	}

	private readBytes(address: number): Uint8Array {
		const elementSize = this.elementSize();
		const end = address + elementSize;
		if (address < 0 || end > this.rom.length) {
			throw new RangeError(
				`Attempted to read outside ROM bounds at [${address}, ${end})`,
			);
		}
		return this.rom.slice(address, end);
	}

	private diffData(source: Uint8Array, target: ReactiveTable<T>): RangeEdit[] {
		const edits: RangeEdit[] = [];
		const elementSize = this.elementSize();

		for (const [address, location] of this.cellIndex.entries()) {
			const before = source.slice(address, address + elementSize);
			const after = this.getCellValue(target, location);

			if (before.length !== after.length) {
				throw new Error(
					`Mismatched cell width at address ${address}: expected ${before.length}, got ${after.length}`,
				);
			}

			let changed = false;
			for (let i = 0; i < before.length; i++) {
				if (before[i] !== after[i]) {
					changed = true;
					break;
				}
			}

			if (!changed) {
				continue;
			}

			edits.push({ address, before, after });
		}

		edits.sort((a, b) => a.address - b.address);
		return edits;
	}

	private applyEdits(edits: RangeEdit[]): void {
		if (!edits.length) {
			return;
		}

		for (const edit of edits) {
			this.rom.set(edit.after, edit.address);

			const location = this.cellIndex.get(edit.address);
			if (!location) {
				continue;
			}

			this.setCellValue(location, edit.after);
		}
	}

	/**
	 * Commit staged edits as a transaction
	 *
	 * Compares current data with ROM and creates a transaction for any changes.
	 * Clears redo history when new edits are committed.
	 *
	 * @param label - Description of the transaction
	 * @returns Transaction if changes were made, null if no changes
	 * @example
	 * table.stageCell({ row: 0, col: 0 }, newBytes);
	 * const transaction = table.commit('Edit cell value');
	 */
	public commit(label: string): Transaction | null {
		const edits = this.diffData(this.rom, this.data);
		if (!edits.length) {
			this.hasPendingChanges = false;
			return null;
		}

		const transaction: Transaction = { label, edits };
		this.applyEdits(edits);
		this.transactions.push(transaction);
		this.undone.length = 0;
		this.hasPendingChanges = false;
		return transaction;
	}

	/**
	 * Undo last transaction
	 *
	 * Reverts the most recent committed transaction and moves it to redo history.
	 *
	 * @returns Transaction that was undone, null if no transactions to undo
	 * @example
	 * const transaction = table.undo();
	 * if (transaction) {
	 *   console.log('Undid:', transaction.label);
	 * }
	 */
	public undo(): Transaction | null {
		if (!this.transactions.length) {
			return null;
		}

		const transaction = this.transactions.pop()!;
		const inverse = transaction.edits.map((edit) => ({
			address: edit.address,
			before: edit.after,
			after: edit.before,
		}));

		this.applyEdits(inverse);
		this.undone.push(transaction);
		return transaction;
	}

	/**
	 * Redo last undone transaction
	 *
	 * Reapplies the most recently undone transaction.
	 *
	 * @returns Transaction that was redone, null if no transactions to redo
	 * @example
	 * const transaction = table.redo();
	 * if (transaction) {
	 *   console.log('Redid:', transaction.label);
	 * }
	 */
	public redo(): Transaction | null {
		if (!this.undone.length) {
			return null;
		}

		const transaction = this.undone.pop()!;
		this.applyEdits(transaction.edits);
		this.transactions.push(transaction);
		return transaction;
	}

	public clearHistory(): void {
		this.transactions.length = 0;
		this.undone.length = 0;
	}

	public get canUndo(): boolean {
		return this.transactions.length > 0;
	}

	public get canRedo(): boolean {
		return this.undone.length > 0;
	}

	public get history(): readonly Transaction[] {
		return this.transactions;
	}

	public get redoHistory(): readonly Transaction[] {
		return this.undone;
	}

	public get romData(): Uint8Array {
		return this.rom;
	}

	/**
	 * Get undo/redo state for UI
	 */
	public get undoRedoState() {
		return {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			undoCount: this.transactions.length,
			redoCount: this.undone.length,
		};
	}

	/**
	 * Check if there are pending changes that haven't been committed
	 */
	public get isPending(): boolean {
		return this.hasPendingChanges;
	}

	/**
	 * Stage a cell edit
	 *
	 * Updates the reactive cell value without committing to transaction history.
	 * Call commit() to save staged edits.
	 *
	 * @param location - Cell location (row, col, depth)
	 * @param bytes - New cell value as bytes
	 * @example
	 * table.stageCell({ row: 0, col: 0 }, new Uint8Array([0x12, 0x34]));
	 * table.commit('Edit cell');
	 */
	public stageCell(
		location: { row: number; col?: number; depth?: number },
		bytes: Uint8Array,
	): void {
		this.hasPendingChanges = true;

		if (this.def.kind === "table3d") {
			const depth = location.depth ?? 0;
			const col = location.col ?? 0;
			this.setCellValue({ depth, row: location.row, col }, bytes);
			return;
		}

		if (this.def.kind === "table2d") {
			const col = location.col ?? 0;
			this.setCellValue({ depth: 0, row: location.row, col }, bytes);
			return;
		}

		// For 1D tables displayed as a row, use col as the row index
		const row = location.col ?? location.row;
		this.setCellValue({ depth: 0, row, col: 0 }, bytes);
	}

	private getCellValue(
		target: ReactiveTable<T>,
		location: CellLocation,
	): Uint8Array {
		if (this.def.kind === "table3d") {
			return (
				(target as Uint8Array[][][])[location.depth]?.[location.row]?.[
					location.col
				] ?? new Uint8Array()
			);
		}

		if (this.def.kind === "table2d") {
			return (
				(target as Uint8Array[][])[location.row]?.[location.col] ??
				new Uint8Array()
			);
		}

		return (target as Uint8Array[])[location.row] ?? new Uint8Array();
	}

	private setCellValue(location: CellLocation, bytes: Uint8Array): void {
		if (this.def.kind === "table3d") {
			const layers = this.data as Uint8Array[][][];
			const depthRow = layers[location.depth];
			if (!depthRow) throw new Error(`Invalid depth index: ${location.depth}`);
			const row = depthRow[location.row];
			if (!row) throw new Error(`Invalid row index: ${location.row}`);
			row[location.col] = bytes;
			return;
		}

		if (this.def.kind === "table2d") {
			const rows = this.data as Uint8Array[][];
			const row = rows[location.row];
			if (!row) throw new Error(`Invalid row index: ${location.row}`);
			row[location.col] = bytes;
			return;
		}

		const cells = this.data as unknown as Uint8Array[];
		cells[location.row] = bytes;
	}

	/**
	 * Select a cell or range of cells
	 *
	 * @param coord - Cell coordinate to select
	 * @param mode - Selection mode: 'replace' (single), 'add' (toggle), 'range' (extend)
	 */
	public selectCell(
		coord: CellCoordinate,
		mode: "replace" | "add" | "range",
	): void {
		const key = this.coordToKey(coord);

		if (mode === "replace") {
			this.selectedCells = new Set([key]);
			this.selectionAnchor = coord;
			this.selectionRange = null;
		} else if (mode === "add") {
			if (this.selectedCells.has(key)) {
				this.selectedCells.delete(key);
			} else {
				this.selectedCells.add(key);
			}
		} else if (mode === "range" && this.selectionAnchor) {
			this.selectionRange = { start: this.selectionAnchor, end: coord };
			this.selectedCells = this.expandRange(this.selectionRange);
		}
	}

	/**
	 * Select all cells in the table
	 */
	public selectAll(): void {
		const newSelection = new Set<string>();
		const def = this.def;

		for (let row = 0; row < def.rows; row++) {
			if (def.kind === "table1d") {
				newSelection.add(this.coordToKey({ row, col: 0 }));
			} else {
				const cols = (def as Table2DDefinition | Table3DDefinition).cols;
				for (let col = 0; col < cols; col++) {
					newSelection.add(this.coordToKey({ row, col }));
				}
			}
		}
		this.selectedCells = newSelection;
	}

	/**
	 * Clear all selections
	 */
	public clearSelection(): void {
		this.selectedCells = new Set();
		this.selectionAnchor = null;
		this.selectionRange = null;
	}

	/**
	 * Check if a cell is selected
	 *
	 * @param coord - Cell coordinate to check
	 * @returns True if the cell is selected
	 */
	public isSelected(coord: CellCoordinate): boolean {
		return this.selectedCells.has(this.coordToKey(coord));
	}

	/**
	 * Get all selected cell coordinates
	 *
	 * @returns Array of selected cell coordinates
	 */
	public getSelectedCells(): CellCoordinate[] {
		return Array.from(this.selectedCells).map((key) => this.keyToCoord(key));
	}

	/**
	 * Get the number of selected cells
	 *
	 * @returns Count of selected cells
	 */
	public getSelectionCount(): number {
		return this.selectedCells.size;
	}

	/**
	 * Get the selection anchor (first selected cell in range)
	 */
	public get anchor(): CellCoordinate | null {
		return this.selectionAnchor;
	}

	/**
	 * Convert cell coordinate to string key
	 */
	private coordToKey(coord: CellCoordinate): string {
		return `${coord.row},${coord.col ?? 0},${coord.depth ?? 0}`;
	}

	/**
	 * Convert string key to cell coordinate
	 */
	private keyToCoord(key: string): CellCoordinate {
		const [row, col, depth] = key.split(",").map(Number);
		if (row === undefined || col === undefined) {
			throw new Error(`Invalid coordinate key: ${key}`);
		}
		const coord: CellCoordinate = { row, col };
		if (depth !== undefined && depth !== 0) {
			coord.depth = depth;
		}
		return coord;
	}

	/**
	 * Expand a selection range to include all cells in the rectangle
	 */
	private expandRange(range: SelectionRange): Set<string> {
		const cells = new Set<string>();
		const minRow = Math.min(range.start.row, range.end.row);
		const maxRow = Math.max(range.start.row, range.end.row);
		const minCol = Math.min(range.start.col ?? 0, range.end.col ?? 0);
		const maxCol = Math.max(range.start.col ?? 0, range.end.col ?? 0);
		const depth = range.start.depth;

		for (let row = minRow; row <= maxRow; row++) {
			for (let col = minCol; col <= maxCol; col++) {
				const coord: CellCoordinate = { row, col };
				if (depth !== undefined) {
					coord.depth = depth;
				}
				cells.add(this.coordToKey(coord));
			}
		}

		return cells;
	}

	/**
	 * Get selected cell values as a 2D matrix
	 *
	 * Returns a matrix where each cell contains the scaled/formatted value.
	 * Empty cells (in non-contiguous selections) are represented as NaN.
	 *
	 * @returns 2D array of cell values
	 */
	public getSelectedValuesAsMatrix(): number[][] {
		const selected = this.getSelectedCells();
		if (selected.length === 0) return [];

		// Find bounds
		const rows = selected.map((c) => c.row);
		const cols = selected.map((c) => c.col ?? 0);
		const minRow = Math.min(...rows);
		const maxRow = Math.max(...rows);
		const minCol = Math.min(...cols);
		const maxCol = Math.max(...cols);

		// Build matrix
		const matrix: number[][] = [];
		for (let row = minRow; row <= maxRow; row++) {
			const rowData: number[] = [];
			for (let col = minCol; col <= maxCol; col++) {
				if (this.isSelected({ row, col })) {
					const address = this.cellOffset(row, col, 0);
					const bytes = this.readBytes(address);
					const value = this.decodeScalarValue(bytes);
					const scaled =
						value * (this.def.z.scale ?? 1) + (this.def.z.offset ?? 0);
					rowData.push(scaled);
				} else {
					rowData.push(NaN); // Empty cell
				}
			}
			matrix.push(rowData);
		}

		return matrix;
	}

	/**
	 * Get selected cell values as TSV (Tab-Separated Values) format
	 *
	 * TSV format is compatible with Excel and other spreadsheet applications.
	 * Cells are separated by tabs, rows by newlines.
	 *
	 * @returns TSV string of selected cells
	 */
	public getSelectedValuesAsTSV(): string {
		const matrix = this.getSelectedValuesAsMatrix();
		return matrix
			.map((row) => row.map((v) => (isNaN(v) ? "" : v.toString())).join("\t"))
			.join("\n");
	}

	/**
	 * Clear selected cells (set to 0)
	 *
	 * Creates a transaction for the clear operation that can be undone.
	 *
	 * @returns Transaction if cells were cleared, null if no selection
	 */
	public clearSelectedCells(): Transaction | null {
		const selected = this.getSelectedCells();
		if (selected.length === 0) return null;

		for (const coord of selected) {
			// Set to 0 (or could use min value from definition)
			const zeroBytes = this.encodeScalarValue(0);
			this.stageCell(coord, zeroBytes);
		}

		return this.commit(`Clear ${selected.length} cells`);
	}

	/**
	 * Paste TSV data into the table starting from an anchor cell
	 *
	 * Parses the TSV string and writes values into the table starting at the
	 * given anchor cell. Values that are out of bounds or not valid numbers are
	 * skipped. The pasted values are treated as scaled values (same as what
	 * getSelectedValuesAsTSV produces).
	 *
	 * @param tsv - Tab-separated values string (rows separated by \n, cols by \t)
	 * @param anchorRow - Starting row index
	 * @param anchorCol - Starting column index
	 * @param depth - Depth index for 3D tables (default: 0)
	 * @returns The actual pasted region bounds, or null if nothing was pasted
	 */
	public pasteFromTSV(
		tsv: string,
		anchorRow: number,
		anchorCol: number,
		depth = 0,
	): { minRow: number; minCol: number; maxRow: number; maxCol: number } | null {
		const def = this.def;
		const maxRow = def.rows - 1;
		const maxCol =
			def.kind === "table1d"
				? 0
				: (def as Table2DDefinition | Table3DDefinition).cols - 1;

		const tsvRows = tsv.split("\n");
		let pastedMinRow = Infinity;
		let pastedMinCol = Infinity;
		let pastedMaxRow = -Infinity;
		let pastedMaxCol = -Infinity;
		let pastedCount = 0;

		for (let r = 0; r < tsvRows.length; r++) {
			const tsvRow = tsvRows[r];
			if (tsvRow === undefined) continue;
			const tsvCols = tsvRow.split("\t");

			for (let c = 0; c < tsvCols.length; c++) {
				const targetRow = anchorRow + r;
				const targetCol = anchorCol + c;

				// Skip out-of-bounds cells
				if (targetRow > maxRow || targetCol > maxCol) continue;
				if (targetRow < 0 || targetCol < 0) continue;

				const rawValue = tsvCols[c];
				if (rawValue === undefined) continue;

				const scaledValue = parseFloat(rawValue.trim());
				if (!isFinite(scaledValue)) continue;

				// Unscale before encoding
				const scale = def.z.scale ?? 1;
				const offset = def.z.offset ?? 0;
				const unscaled = (scaledValue - offset) / scale;
				const bytes = this.encodeScalarValue(unscaled);

				this.stageCell({ row: targetRow, col: targetCol, depth }, bytes);

				if (targetRow < pastedMinRow) pastedMinRow = targetRow;
				if (targetRow > pastedMaxRow) pastedMaxRow = targetRow;
				if (targetCol < pastedMinCol) pastedMinCol = targetCol;
				if (targetCol > pastedMaxCol) pastedMaxCol = targetCol;
				pastedCount++;
			}
		}

		if (pastedCount === 0) return null;

		this.commit(`Paste ${pastedCount} cells`);

		return {
			minRow: pastedMinRow,
			minCol: pastedMinCol,
			maxRow: pastedMaxRow,
			maxCol: pastedMaxCol,
		};
	}

	/**
	 * Apply add operation to selected cells
	 *
	 * Adds a constant value to all selected cells, respecting data type constraints.
	 *
	 * @param constant - Value to add (can be negative for subtraction)
	 * @returns Result with warnings and transaction if successful
	 */
	public applyAddOperation(constant: number): {
		result: MathOpResult;
		transaction: Transaction | null;
	} {
		const selected = this.getSelectedCells();
		if (selected.length === 0) {
			return {
				result: {
					values: [],
					warnings: ["No cells selected"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		// Get current values (scaled)
		const values: number[] = [];
		for (const coord of selected) {
			const address = this.cellOffset(
				coord.row,
				coord.col ?? 0,
				coord.depth ?? 0,
			);
			const bytes = this.readBytes(address);
			const raw = this.decodeScalarValue(bytes);
			const scaled = raw * (this.def.z.scale ?? 1) + (this.def.z.offset ?? 0);
			values.push(scaled);
		}

		// Get constraints
		const constraints = this.getConstraints();

		// Apply operation
		const result = addConstant(values, constant, constraints);

		// Stage changes
		for (let i = 0; i < selected.length; i++) {
			const coord = selected[i];
			if (!coord) throw new Error(`Missing coordinate for index ${i}`);
			const newScaled = result.values[i];
			if (newScaled === undefined)
				throw new Error(`Missing result value for index ${i}`);
			// Unscale before encoding
			const newRaw =
				(newScaled - (this.def.z.offset ?? 0)) / (this.def.z.scale ?? 1);
			const bytes = this.encodeScalarValue(newRaw);
			this.stageCell(coord, bytes);
		}

		// Commit
		const transaction = this.commit(
			`Add ${constant} to ${selected.length} cells`,
		);

		return { result, transaction };
	}

	/**
	 * Apply set value operation to selected cells
	 *
	 * Sets all selected cells to a specific value, respecting data type constraints.
	 *
	 * @param value - Value to set all selected cells to
	 * @returns Result with warnings and transaction if successful
	 */
	public applySetValueOperation(value: number): {
		result: MathOpResult;
		transaction: Transaction | null;
	} {
		const selected = this.getSelectedCells();
		if (selected.length === 0) {
			return {
				result: {
					values: [],
					warnings: ["No cells selected"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		// Get current values (scaled)
		const currentValues: number[] = [];
		for (const coord of selected) {
			const address = this.cellOffset(
				coord.row,
				coord.col ?? 0,
				coord.depth ?? 0,
			);
			const bytes = this.readBytes(address);
			const raw = this.decodeScalarValue(bytes);
			const scaled = raw * (this.def.z.scale ?? 1) + (this.def.z.offset ?? 0);
			currentValues.push(scaled);
		}

		// Get constraints
		const constraints = this.getConstraints();

		// Apply constraints to the new value
		let constrainedValue = value;
		const warnings: string[] = [];

		if (constraints.min !== undefined && constrainedValue < constraints.min) {
			constrainedValue = constraints.min;
			warnings.push(`Value clamped to minimum ${constraints.min}`);
		}

		if (constraints.max !== undefined && constrainedValue > constraints.max) {
			constrainedValue = constraints.max;
			warnings.push(`Value clamped to maximum ${constraints.max}`);
		}

		// Create result with all cells set to the same value
		const resultValues = selected.map(() => constrainedValue);

		// Count changes
		let changedCount = 0;
		for (let i = 0; i < currentValues.length; i++) {
			const currentValue = currentValues[i];
			if (
				currentValue !== undefined &&
				Math.abs(currentValue - constrainedValue) > 0.001
			) {
				changedCount++;
			}
		}

		const result: MathOpResult = {
			values: resultValues,
			warnings,
			changedCount,
		};

		// Stage changes
		for (const coord of selected) {
			// Unscale before encoding
			const newRaw =
				(constrainedValue - (this.def.z.offset ?? 0)) / (this.def.z.scale ?? 1);
			const bytes = this.encodeScalarValue(newRaw);
			this.stageCell(coord, bytes);
		}

		// Commit
		const transaction = this.commit(`Set ${selected.length} cells to ${value}`);

		return { result, transaction };
	}

	/**
	 * Apply multiply operation to selected cells
	 *
	 * Multiplies all selected cells by a constant factor, respecting data type constraints.
	 *
	 * @param factor - Multiplication factor (can be < 1 for division)
	 * @returns Result with warnings and transaction if successful
	 */
	public applyMultiplyOperation(factor: number): {
		result: MathOpResult;
		transaction: Transaction | null;
	} {
		const selected = this.getSelectedCells();
		if (selected.length === 0) {
			return {
				result: {
					values: [],
					warnings: ["No cells selected"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		// Get current values (scaled)
		const values: number[] = [];
		for (const coord of selected) {
			const address = this.cellOffset(
				coord.row,
				coord.col ?? 0,
				coord.depth ?? 0,
			);
			const bytes = this.readBytes(address);
			const raw = this.decodeScalarValue(bytes);
			const scaled = raw * (this.def.z.scale ?? 1) + (this.def.z.offset ?? 0);
			values.push(scaled);
		}

		// Get constraints
		const constraints = this.getConstraints();

		// Apply operation
		const result = multiplyConstant(values, factor, constraints);

		// Stage changes
		for (let i = 0; i < selected.length; i++) {
			const coord = selected[i];
			if (!coord) throw new Error(`Missing coordinate for index ${i}`);

			const newScaled = result.values[i];
			if (newScaled === undefined)
				throw new Error(`Missing result value for index ${i}`);
			// Unscale before encoding
			const newRaw =
				(newScaled - (this.def.z.offset ?? 0)) / (this.def.z.scale ?? 1);
			const bytes = this.encodeScalarValue(newRaw);
			this.stageCell(coord, bytes);
		}

		// Commit
		const transaction = this.commit(
			`Multiply by ${factor} for ${selected.length} cells`,
		);

		return { result, transaction };
	}

	/**
	 * Apply clamp operation to selected cells
	 *
	 * Constrains all selected cells to a min/max range.
	 *
	 * @param min - Minimum value
	 * @param max - Maximum value
	 * @returns Result with warnings and transaction if successful
	 */
	public applyClampOperation(
		min: number,
		max: number,
	): {
		result: MathOpResult;
		transaction: Transaction | null;
	} {
		const selected = this.getSelectedCells();
		if (selected.length === 0) {
			return {
				result: {
					values: [],
					warnings: ["No cells selected"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		// Get current values (scaled)
		const values: number[] = [];
		for (const coord of selected) {
			const address = this.cellOffset(
				coord.row,
				coord.col ?? 0,
				coord.depth ?? 0,
			);
			const bytes = this.readBytes(address);
			const raw = this.decodeScalarValue(bytes);
			const scaled = raw * (this.def.z.scale ?? 1) + (this.def.z.offset ?? 0);
			values.push(scaled);
		}

		// Apply operation
		const result = clampValues(values, min, max);

		// Stage changes
		for (let i = 0; i < selected.length; i++) {
			const coord = selected[i];
			if (!coord) throw new Error(`Missing coordinate for index ${i}`);

			const newScaled = result.values[i];
			if (newScaled === undefined)
				throw new Error(`Missing result value for index ${i}`);

			// Unscale before encoding
			const newRaw =
				(newScaled - (this.def.z.offset ?? 0)) / (this.def.z.scale ?? 1);
			const bytes = this.encodeScalarValue(newRaw);
			this.stageCell(coord, bytes);
		}

		// Commit
		const transaction = this.commit(
			`Clamp to [${min}, ${max}] for ${selected.length} cells`,
		);

		return { result, transaction };
	}

	/**
	 * Apply smooth operation to selected cells (2D/3D tables only)
	 *
	 * Smooths values using a kernel-based averaging filter.
	 *
	 * @param kernelSize - Size of averaging kernel (must be odd: 3, 5, 7, etc.)
	 * @param iterations - Number of smoothing passes
	 * @param boundaryMode - How to handle boundaries
	 * @returns Result with warnings and transaction if successful
	 */
	public applySmoothOperation(
		kernelSize = 3,
		iterations = 1,
		boundaryMode: "pad" | "repeat" | "mirror" = "pad",
	): {
		result: MathOpResult;
		transaction: Transaction | null;
	} {
		if (this.def.kind === "table1d") {
			return {
				result: {
					values: [],
					warnings: ["Smooth operation not supported for 1D tables"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		const selected = this.getSelectedCells();
		if (selected.length === 0) {
			return {
				result: {
					values: [],
					warnings: ["No cells selected"],
					changedCount: 0,
				},
				transaction: null,
			};
		}

		// Build matrix from selected cells
		const matrix = this.getSelectedValuesAsMatrix();

		// Apply smooth operation
		const result = smoothValues(matrix, kernelSize, iterations, boundaryMode);

		// Get selected cells in order
		const rows = selected.map((c) => c.row);
		const cols = selected.map((c) => c.col ?? 0);
		const minRow = Math.min(...rows);
		const maxRow = Math.max(...rows);
		const minCol = Math.min(...cols);
		const maxCol = Math.max(...cols);

		// Stage changes
		let valueIndex = 0;
		for (let row = minRow; row <= maxRow; row++) {
			for (let col = minCol; col <= maxCol; col++) {
				if (this.isSelected({ row, col })) {
					const newScaled = result.values[valueIndex];
					if (newScaled === undefined)
						throw new Error(`Missing result value for index ${valueIndex}`);

					// Unscale before encoding
					const newRaw =
						(newScaled - (this.def.z.offset ?? 0)) / (this.def.z.scale ?? 1);
					const bytes = this.encodeScalarValue(newRaw);
					this.stageCell({ row, col }, bytes);
					valueIndex++;
				}
			}
		}

		// Commit
		const transaction = this.commit(
			`Smooth ${kernelSize}x${kernelSize} kernel for ${selected.length} cells`,
		);

		return { result, transaction };
	}

	/**
	 * Get constraints for math operations based on data type and table definition
	 *
	 * @returns Constraints object with min/max values
	 * @private
	 */
	private getConstraints(): MathOpConstraints {
		const { dtype } = this.def.z;
		const range = getRangeForDataType(dtype);
		const scale = this.def.z.scale ?? 1;
		const offset = this.def.z.offset ?? 0;

		// Apply scale and offset to range
		const scaledMin = range.min * scale + offset;
		const scaledMax = range.max * scale + offset;

		return { min: scaledMin, max: scaledMax, dtype };
	}

	/**
	 * Decode a scalar value from bytes
	 *
	 * @param bytes - Bytes to decode
	 * @returns Decoded numeric value
	 * @private
	 */
	private decodeScalarValue(bytes: Uint8Array): number {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const { dtype, endianness } = this.def.z;
		const littleEndian = endianness === "le";

		switch (dtype) {
			case "u8":
				return view.getUint8(0);
			case "i8":
				return view.getInt8(0);
			case "u16":
				return view.getUint16(0, littleEndian);
			case "i16":
				return view.getInt16(0, littleEndian);
			case "u32":
				return view.getUint32(0, littleEndian);
			case "i32":
				return view.getInt32(0, littleEndian);
			case "f32":
				return view.getFloat32(0, littleEndian);
			default:
				return NaN;
		}
	}

	/**
	 * Encode a scalar value to bytes
	 *
	 * @param value - Numeric value to encode
	 * @returns Encoded bytes
	 * @private
	 */
	private encodeScalarValue(value: number): Uint8Array {
		const { dtype, endianness } = this.def.z;
		const buffer = new ArrayBuffer(this.elementSize());
		const view = new DataView(buffer);
		const littleEndian = endianness === "le";

		switch (dtype) {
			case "u8":
				view.setUint8(0, this.clamp(value, 0, 0xff));
				break;
			case "i8":
				view.setInt8(0, this.clamp(value, -0x80, 0x7f));
				break;
			case "u16":
				view.setUint16(0, this.clamp(value, 0, 0xffff), littleEndian);
				break;
			case "i16":
				view.setInt16(0, this.clamp(value, -0x8000, 0x7fff), littleEndian);
				break;
			case "u32":
				view.setUint32(0, this.clamp(value, 0, 0xffffffff), littleEndian);
				break;
			case "i32":
				view.setInt32(
					0,
					this.clamp(value, -0x80000000, 0x7fffffff),
					littleEndian,
				);
				break;
			case "f32":
				view.setFloat32(0, value, littleEndian);
				break;
		}

		return new Uint8Array(buffer);
	}

	/**
	 * Get table snapshot for chart visualization
	 *
	 * Converts table data to a format suitable for chart rendering.
	 * Data is decoded and scaled according to the table definition.
	 *
	 * @returns Table snapshot with decoded values
	 */
	get snapshot() {
		const { def } = this;

		if (def.kind === "table1d") {
			const z: number[] = [];
			for (let row = 0; row < def.rows; row++) {
				const address = this.cellOffset(row);
				const bytes = this.readBytes(address);
				const raw = this.decodeScalarValue(bytes);
				const scaled = raw * (def.z.scale ?? 1) + (def.z.offset ?? 0);
				z.push(scaled);
			}

			return {
				kind: "table1d" as const,
				name: def.name,
				rows: def.rows,
				x: def.x?.kind === "static" ? def.x.values : undefined,
				z,
				unit: def.z.unit,
				xLabel: def.x?.name,
				zLabel: def.z.name,
			};
		}

		if (def.kind === "table2d") {
			const z: number[][] = [];
			for (let row = 0; row < def.rows; row++) {
				const rowData: number[] = [];
				for (let col = 0; col < def.cols; col++) {
					const address = this.cellOffset(row, col);
					const bytes = this.readBytes(address);
					const raw = this.decodeScalarValue(bytes);
					const scaled = raw * (def.z.scale ?? 1) + (def.z.offset ?? 0);
					rowData.push(scaled);
				}
				z.push(rowData);
			}

			return {
				kind: "table2d" as const,
				name: def.name,
				rows: def.rows,
				cols: def.cols,
				x: def.x?.kind === "static" ? def.x.values : undefined,
				y: def.y?.kind === "static" ? def.y.values : undefined,
				z,
				unit: def.z.unit,
				xLabel: def.x?.name,
				yLabel: def.y?.name,
				zLabel: def.z.name,
			};
		}

		// table3d
		const z: number[][][] = [];
		for (let depth = 0; depth < def.depth; depth++) {
			const layer: number[][] = [];
			for (let row = 0; row < def.rows; row++) {
				const rowData: number[] = [];
				for (let col = 0; col < def.cols; col++) {
					const address = this.cellOffset(row, col, depth);
					const bytes = this.readBytes(address);
					const raw = this.decodeScalarValue(bytes);
					const scaled = raw * (def.z.scale ?? 1) + (def.z.offset ?? 0);
					rowData.push(scaled);
				}
				layer.push(rowData);
			}
			z.push(layer);
		}

		return {
			kind: "table3d" as const,
			name: def.name,
			rows: def.rows,
			cols: def.cols,
			depth: def.depth,
			x: def.x?.kind === "static" ? def.x.values : undefined,
			y: def.y?.kind === "static" ? def.y.values : undefined,
			z,
			unit: def.z.unit,
			xLabel: def.x?.name,
			yLabel: def.y?.name,
			zLabel: def.z.name,
		};
	}

	/**
	 * Clamp a value to a range
	 *
	 * @param value - Value to clamp
	 * @param min - Minimum value
	 * @param max - Maximum value
	 * @returns Clamped value
	 * @private
	 */
	private clamp(value: number, min: number, max: number): number {
		return Math.round(Math.min(Math.max(value, min), max));
	}
}
