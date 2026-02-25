import type { Table2DDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it } from "vitest";
import { TableView } from "../src/lib/views/table.svelte";

/**
 * Helper to create a simple 2D table definition
 */
function create2DTableDef(
	rows: number = 4,
	cols: number = 4,
): Table2DDefinition {
	return {
		kind: "table2d",
		name: "Test 2D Table",
		rows,
		cols,
		z: {
			name: "Values",
			address: 0x1000,
			length: rows * cols,
			dtype: "u8",
			endianness: "le",
		},
	};
}

/**
 * Helper to create ROM data with sequential values
 */
function createROM(size: number): Uint8Array {
	const rom = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		rom[i] = i % 256;
	}
	return rom;
}

describe("TableView Clipboard Operations", () => {
	let view: TableView<Table2DDefinition>;
	let rom: Uint8Array;
	let definition: Table2DDefinition;

	beforeEach(() => {
		// Create a 4x4 table with sequential values
		rom = createROM(0x2000);
		definition = create2DTableDef(4, 4);
		view = new TableView(rom, definition);
	});

	describe("getSelectedValuesAsMatrix", () => {
		it("should return empty array when no selection", () => {
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toEqual([]);
		});

		it("should return single cell as 1x1 matrix", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(1);
			const firstRow = matrix[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow).toHaveLength(1);
			expect(typeof firstRow[0]).toBe("number");
		});

		it("should return rectangular selection as matrix", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "range");
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(2); // 2 rows
			expect(matrix[0]).toHaveLength(2); // 2 columns
			expect(matrix[1]).toHaveLength(2); // 2 columns
		});

		it("should handle non-contiguous selection with NaN for empty cells", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 2 }, "add");
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(3); // 3 rows (0, 1, 2)
			expect(matrix[0]).toHaveLength(3); // 3 columns (0, 1, 2)
			// Middle cells should be NaN
			const middleRow = matrix[1];
			if (!middleRow) throw new Error("Expected middle row to be defined");
			expect(isNaN(middleRow[1] as number)).toBe(true);
		});

		it("should apply scale and offset to values", () => {
			const scaledDef: Table2DDefinition = {
				...definition,
				z: {
					...definition.z,
					scale: 0.1,
					offset: 10,
				},
			};
			const scaledView = new TableView(rom, scaledDef);
			scaledView.selectCell({ row: 0, col: 0 }, "replace");
			const matrix = scaledView.getSelectedValuesAsMatrix();
			// Value at 0x1000 is 0, so 0 * 0.1 + 10 = 10
			const firstRow = matrix[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow[0]).toBeCloseTo(10, 5);
		});
	});

	describe("getSelectedValuesAsTSV", () => {
		it("should return empty string when no selection", () => {
			const tsv = view.getSelectedValuesAsTSV();
			expect(tsv).toBe("");
		});

		it("should format single cell correctly", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = view.getSelectedValuesAsTSV();
			expect(tsv).not.toContain("\t");
			expect(tsv).not.toContain("\n");
			expect(tsv).toMatch(/^\d+$/);
		});

		it("should format row with tabs", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 0, col: 2 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			expect(tsv.split("\t")).toHaveLength(3);
			expect(tsv).not.toContain("\n");
		});

		it("should format column with newlines", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 0 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			expect(tsv.split("\n")).toHaveLength(3);
			expect(tsv.split("\n")[0]).not.toContain("\t");
		});

		it("should format matrix correctly", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 2 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			const lines = tsv.split("\n");
			expect(lines).toHaveLength(3);
			lines.forEach((line) => {
				expect(line.split("\t")).toHaveLength(3);
			});
		});

		it("should handle empty cells in non-contiguous selection", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 2 }, "add");
			const tsv = view.getSelectedValuesAsTSV();
			// Should contain empty cells (represented as empty strings)
			expect(tsv).toContain("\t\t");
		});

		it("should be compatible with Excel TSV format", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			// TSV should have tabs between cells and newlines between rows
			const lines = tsv.split("\n");
			expect(lines).toHaveLength(2);
			lines.forEach((line) => {
				expect(line.split("\t")).toHaveLength(2);
			});
		});
	});

	describe("clearSelectedCells", () => {
		it("should return null when no selection", () => {
			const transaction = view.clearSelectedCells();
			expect(transaction).toBeNull();
		});

		it("should clear single cell to 0", () => {
			// Select a cell that doesn't already have value 0
			view.selectCell({ row: 1, col: 1 }, "replace");
			const originalMatrix = view.getSelectedValuesAsMatrix();
			const originalRow = originalMatrix[0];
			if (!originalRow) throw new Error("Expected first row to be defined");
			const originalValue = originalRow[0];

			const transaction = view.clearSelectedCells();

			expect(transaction).not.toBeNull();
			const newMatrix = view.getSelectedValuesAsMatrix();
			const newRow = newMatrix[0];
			if (!newRow) throw new Error("Expected first row to be defined");
			expect(newRow[0]).toBe(0);
			expect(newRow[0]).not.toBe(originalValue);
		});

		it("should clear multiple cells", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "range");

			const transaction = view.clearSelectedCells();

			expect(transaction).not.toBeNull();
			const matrix = view.getSelectedValuesAsMatrix();
			matrix.forEach((row) => {
				row.forEach((value) => {
					expect(value).toBe(0);
				});
			});
		});

		it("should create undo transaction", () => {
			// Select a cell that doesn't already have value 0
			view.selectCell({ row: 1, col: 1 }, "replace");
			const transaction = view.clearSelectedCells();

			expect(transaction).not.toBeNull();
			expect(transaction?.label).toContain("Clear");
			expect(transaction?.label).toContain("1");
		});

		it("should create transaction with correct cell count", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "range");
			const transaction = view.clearSelectedCells();

			expect(transaction).not.toBeNull();
			expect(transaction?.label).toContain("4"); // 2x2 = 4 cells
		});

		it("should be undoable", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			const originalMatrix = view.getSelectedValuesAsMatrix();
			const originalRow = originalMatrix[0];
			if (!originalRow) throw new Error("Expected first row to be defined");
			const originalValue = originalRow[0];

			view.clearSelectedCells();
			const clearedMatrix = view.getSelectedValuesAsMatrix();
			const clearedRow = clearedMatrix[0];
			if (!clearedRow) throw new Error("Expected first row to be defined");
			expect(clearedRow[0]).toBe(0);

			view.undo();
			const restoredMatrix = view.getSelectedValuesAsMatrix();
			const restoredRow = restoredMatrix[0];
			if (!restoredRow) throw new Error("Expected first row to be defined");
			expect(restoredRow[0]).toBe(originalValue);
		});
	});

	describe("TSV Format Compatibility", () => {
		it("should produce valid TSV for single value", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = view.getSelectedValuesAsTSV();
			expect(tsv).toMatch(/^\d+(\.\d+)?$/);
		});

		it("should produce valid TSV for row", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 0, col: 3 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			const values = tsv.split("\t");
			expect(values).toHaveLength(4);
			values.forEach((v) => {
				expect(v).toMatch(/^\d+(\.\d+)?$/);
			});
		});

		it("should produce valid TSV for column", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 3, col: 0 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			const values = tsv.split("\n");
			expect(values).toHaveLength(4);
			values.forEach((v) => {
				expect(v).toMatch(/^\d+(\.\d+)?$/);
			});
		});

		it("should produce valid TSV for matrix", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 3, col: 3 }, "range");
			const tsv = view.getSelectedValuesAsTSV();
			const lines = tsv.split("\n");
			expect(lines).toHaveLength(4);
			lines.forEach((line) => {
				const values = line.split("\t");
				expect(values).toHaveLength(4);
				values.forEach((v) => {
					expect(v).toMatch(/^\d+(\.\d+)?$/);
				});
			});
		});

		it("should handle floating point values", () => {
			const floatDef: Table2DDefinition = {
				...definition,
				z: {
					...definition.z,
					dtype: "f32",
				},
			};
			const floatView = new TableView(rom, floatDef);
			floatView.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = floatView.getSelectedValuesAsTSV();
			// f32 can be in scientific notation
			expect(tsv).toMatch(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/);
		});
	});

	describe("Edge Cases", () => {
		it("should handle selection at table boundaries", () => {
			view.selectCell({ row: 3, col: 3 }, "replace");
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(1);
			expect(matrix[0]).toHaveLength(1);
		});

		it("should handle full table selection", () => {
			view.selectAll();
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(4);
			expect(matrix[0]).toHaveLength(4);
		});

		it("should handle clearing full table", () => {
			view.selectAll();
			const transaction = view.clearSelectedCells();
			expect(transaction).not.toBeNull();
			expect(transaction?.label).toContain("16"); // 4x4 = 16 cells
		});

		it("should handle sparse selection", () => {
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 0, col: 2 }, "add");
			view.selectCell({ row: 2, col: 0 }, "add");
			view.selectCell({ row: 2, col: 2 }, "add");
			const matrix = view.getSelectedValuesAsMatrix();
			expect(matrix).toHaveLength(3); // rows 0-2
			expect(matrix[0]).toHaveLength(3); // cols 0-2
			// Check that non-selected cells are NaN
			const row0 = matrix[0];
			const row1 = matrix[1];
			if (!row0 || !row1) throw new Error("Expected rows to be defined");
			expect(Number.isNaN(row0[1] as number)).toBe(true);
			expect(Number.isNaN(row1[0] as number)).toBe(true);
		});
	});

	describe("Data Type Support", () => {
		it("should handle u8 values", () => {
			const u8Def: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "u8" },
			};
			const u8View = new TableView(rom, u8Def);
			u8View.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = u8View.getSelectedValuesAsTSV();
			expect(tsv).toMatch(/^\d+$/);
		});

		it("should handle i8 values", () => {
			const i8Def: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "i8" },
			};
			const i8View = new TableView(rom, i8Def);
			i8View.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = i8View.getSelectedValuesAsTSV();
			expect(tsv).toMatch(/^-?\d+$/);
		});

		it("should handle u16 values", () => {
			const u16Def: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "u16" },
			};
			const u16View = new TableView(rom, u16Def);
			u16View.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = u16View.getSelectedValuesAsTSV();
			expect(tsv).toMatch(/^\d+$/);
		});

		it("should handle i16 values", () => {
			const i16Def: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "i16" },
			};
			const i16View = new TableView(rom, i16Def);
			i16View.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = i16View.getSelectedValuesAsTSV();
			expect(tsv).toMatch(/^-?\d+$/);
		});

		it("should handle f32 values", () => {
			const f32Def: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "f32" },
			};
			const f32View = new TableView(rom, f32Def);
			f32View.selectCell({ row: 0, col: 0 }, "replace");
			const tsv = f32View.getSelectedValuesAsTSV();
			// f32 can be in scientific notation
			expect(tsv).toMatch(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/);
		});
	});

	describe("Endianness Support", () => {
		it("should handle little-endian values", () => {
			const leDef: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "u16", endianness: "le" },
			};
			const leView = new TableView(rom, leDef);
			leView.selectCell({ row: 0, col: 0 }, "replace");
			const matrix = leView.getSelectedValuesAsMatrix();
			const row = matrix[0];
			if (!row) throw new Error("Expected first row to be defined");
			expect(typeof row[0]).toBe("number");
		});

		it("should handle big-endian values", () => {
			const beDef: Table2DDefinition = {
				...definition,
				z: { ...definition.z, dtype: "u16", endianness: "be" },
			};
			const beView = new TableView(rom, beDef);
			beView.selectCell({ row: 0, col: 0 }, "replace");
			const matrix = beView.getSelectedValuesAsMatrix();
			const row = matrix[0];
			if (!row) throw new Error("Expected first row to be defined");
			expect(typeof row[0]).toBe("number");
		});
	});
});
