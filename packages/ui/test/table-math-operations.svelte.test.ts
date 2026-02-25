import type { Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { TableView } from "../src/lib/views/table.svelte";

/**
 * Helper to create a simple 1D table definition
 */
function create1DTableDef(rows: number = 16): Table1DDefinition {
	return {
		kind: "table1d",
		name: "Test 1D Table",
		rows,
		z: {
			name: "Values",
			address: 0x1000,
			length: rows,
			dtype: "u8",
		},
	};
}

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
		},
	};
}

/**
 * Helper to create ROM data
 */
function createROM(size: number): Uint8Array {
	const rom = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		rom[i] = i % 256;
	}
	return rom;
}

describe("TableView Math Operations", () => {
	describe("1D Table Operations", () => {
		it("should apply set value operation to multiple cells in 1D table", () => {
			const rom = createROM(0x2000);
			const def = create1DTableDef(16);
			const table = new TableView(rom, def);

			// Select cells at indices 3, 4, 5 (displayed as columns in UI)
			table.selectCell({ row: 0, col: 3 }, "replace");
			table.selectCell({ row: 0, col: 4 }, "add");
			table.selectCell({ row: 0, col: 5 }, "add");

			expect(table.getSelectionCount()).toBe(3);

			// Apply set value operation
			const { result, transaction } = table.applySetValueOperation(100);

			// Verify all 3 cells were changed
			expect(result.changedCount).toBe(3);
			expect(transaction).not.toBeNull();
			expect(transaction?.edits.length).toBe(3);

			// Verify the correct cells were updated
			const data = table.data;
			if (Array.isArray(data) && !Array.isArray(data[0])) {
				const data1d = data as Uint8Array[];
				expect(data1d[3]?.[0]).toBe(100);
				expect(data1d[4]?.[0]).toBe(100);
				expect(data1d[5]?.[0]).toBe(100);
			}
		});

		it("should apply add operation to multiple cells in 1D table", () => {
			const rom = createROM(0x2000);
			const def = create1DTableDef(16);
			const table = new TableView(rom, def);

			// Select cells at indices 3, 4, 5
			table.selectCell({ row: 0, col: 3 }, "replace");
			table.selectCell({ row: 0, col: 4 }, "add");
			table.selectCell({ row: 0, col: 5 }, "add");

			// Get original values
			const data = table.data;
			if (Array.isArray(data) && !Array.isArray(data[0])) {
				const data1d = data as Uint8Array[];
				const original3 = data1d[3]?.[0] ?? 0;
				const original4 = data1d[4]?.[0] ?? 0;
				const original5 = data1d[5]?.[0] ?? 0;

				// Apply add operation
				const { result, transaction } = table.applyAddOperation(10);

				// Verify all 3 cells were changed
				expect(result.changedCount).toBe(3);
				expect(transaction).not.toBeNull();
				expect(transaction?.edits.length).toBe(3);

				// Verify the correct cells were updated
				expect(data1d[3]?.[0]).toBe(original3 + 10);
				expect(data1d[4]?.[0]).toBe(original4 + 10);
				expect(data1d[5]?.[0]).toBe(original5 + 10);
			}
		});

		it("should apply multiply operation to multiple cells in 1D table", () => {
			const rom = createROM(0x2000);
			const def = create1DTableDef(16);
			const table = new TableView(rom, def);

			// Select cells at indices 3, 4, 5
			table.selectCell({ row: 0, col: 3 }, "replace");
			table.selectCell({ row: 0, col: 4 }, "add");
			table.selectCell({ row: 0, col: 5 }, "add");

			// Get original values
			const data = table.data;
			if (Array.isArray(data) && !Array.isArray(data[0])) {
				const data1d = data as Uint8Array[];
				const original3 = data1d[3]?.[0] ?? 0;
				const original4 = data1d[4]?.[0] ?? 0;
				const original5 = data1d[5]?.[0] ?? 0;

				// Apply multiply operation
				const { result, transaction } = table.applyMultiplyOperation(2);

				// Verify all 3 cells were changed
				expect(result.changedCount).toBe(3);
				expect(transaction).not.toBeNull();
				expect(transaction?.edits.length).toBe(3);

				// Verify the correct cells were updated
				expect(data1d[3]?.[0]).toBe(original3 * 2);
				expect(data1d[4]?.[0]).toBe(original4 * 2);
				expect(data1d[5]?.[0]).toBe(original5 * 2);
			}
		});
	});

	describe("2D Table Operations", () => {
		it("should apply set value operation to multiple cells in 2D table", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const table = new TableView(rom, def);

			// Select cells at (0,1), (0,2), (0,3)
			table.selectCell({ row: 0, col: 1 }, "replace");
			table.selectCell({ row: 0, col: 2 }, "add");
			table.selectCell({ row: 0, col: 3 }, "add");

			expect(table.getSelectionCount()).toBe(3);

			// Apply set value operation
			const { result, transaction } = table.applySetValueOperation(100);

			// Verify all 3 cells were changed
			expect(result.changedCount).toBe(3);
			expect(transaction).not.toBeNull();
			expect(transaction?.edits.length).toBe(3);

			// Verify the correct cells were updated
			const data = table.data;
			if (Array.isArray(data) && Array.isArray(data[0])) {
				const data2d = data as Uint8Array[][];
				expect(data2d[0]?.[1]?.[0]).toBe(100);
				expect(data2d[0]?.[2]?.[0]).toBe(100);
				expect(data2d[0]?.[3]?.[0]).toBe(100);
			}
		});

		it("should apply add operation to multiple cells in 2D table", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const table = new TableView(rom, def);

			// Select cells at (0,1), (0,2), (0,3)
			table.selectCell({ row: 0, col: 1 }, "replace");
			table.selectCell({ row: 0, col: 2 }, "add");
			table.selectCell({ row: 0, col: 3 }, "add");

			// Get original values
			const data = table.data;
			if (Array.isArray(data) && Array.isArray(data[0])) {
				const data2d = data as Uint8Array[][];
				const original1 = data2d[0]?.[1]?.[0] ?? 0;
				const original2 = data2d[0]?.[2]?.[0] ?? 0;
				const original3 = data2d[0]?.[3]?.[0] ?? 0;

				// Apply add operation
				const { result, transaction } = table.applyAddOperation(10);

				// Verify all 3 cells were changed
				expect(result.changedCount).toBe(3);
				expect(transaction).not.toBeNull();
				expect(transaction?.edits.length).toBe(3);

				// Verify the correct cells were updated
				expect(data2d[0]?.[1]?.[0]).toBe(original1 + 10);
				expect(data2d[0]?.[2]?.[0]).toBe(original2 + 10);
				expect(data2d[0]?.[3]?.[0]).toBe(original3 + 10);
			}
		});
	});
});
