/**
 * Integration tests for TableGrid selection behavior
 * Tests the selection logic that would be triggered by UI interactions
 *
 * Note: These tests focus on verifying the TableView selection methods work correctly
 * in scenarios that would be triggered by mouse and keyboard events in the UI.
 */

import type { Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { TableView } from "../src/lib/views/table.svelte";

/**
 * Helper to create a simple 1D table definition
 */
function create1DTableDef(rows: number = 10): Table1DDefinition {
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

describe("TableGrid Selection Integration", () => {
	describe("Click selection behavior", () => {
		it("should handle normal click (replace mode)", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Simulate clicking cell (0,0)
			view.selectCell({ row: 0, col: 0 }, "replace");

			expect(view.isSelected({ row: 0, col: 0 })).toBe(true);
			expect(view.getSelectionCount()).toBe(1);

			// Simulate clicking cell (1,1) - should replace
			view.selectCell({ row: 1, col: 1 }, "replace");

			expect(view.isSelected({ row: 0, col: 0 })).toBe(false);
			expect(view.isSelected({ row: 1, col: 1 })).toBe(true);
			expect(view.getSelectionCount()).toBe(1);
		});

		it("should handle Shift+click (range mode)", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Click first cell
			view.selectCell({ row: 0, col: 0 }, "replace");

			// Shift+click to extend range
			view.selectCell({ row: 2, col: 2 }, "range");

			// Should select 3x3 = 9 cells
			expect(view.getSelectionCount()).toBe(9);
			expect(view.isSelected({ row: 0, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 1, col: 1 })).toBe(true);
			expect(view.isSelected({ row: 2, col: 2 })).toBe(true);
		});

		it("should handle Ctrl+click (add/toggle mode)", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Click first cell
			view.selectCell({ row: 0, col: 0 }, "replace");

			// Ctrl+click to add another cell
			view.selectCell({ row: 2, col: 2 }, "add");

			expect(view.getSelectionCount()).toBe(2);
			expect(view.isSelected({ row: 0, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 2, col: 2 })).toBe(true);

			// Ctrl+click again to toggle off
			view.selectCell({ row: 0, col: 0 }, "add");

			expect(view.getSelectionCount()).toBe(1);
			expect(view.isSelected({ row: 0, col: 0 })).toBe(false);
			expect(view.isSelected({ row: 2, col: 2 })).toBe(true);
		});
	});

	describe("Drag selection behavior", () => {
		it("should handle click and drag to create range", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Simulate mousedown on first cell
			view.selectCell({ row: 0, col: 0 }, "replace");

			// Simulate dragging over cells (mouseenter events)
			view.selectCell({ row: 0, col: 1 }, "range");
			view.selectCell({ row: 1, col: 1 }, "range");

			// Should have selected a 2x2 range
			expect(view.getSelectionCount()).toBe(4);
			expect(view.isSelected({ row: 0, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 0, col: 1 })).toBe(true);
			expect(view.isSelected({ row: 1, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 1, col: 1 })).toBe(true);
		});

		it("should maintain anchor during drag", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Set anchor
			view.selectCell({ row: 1, col: 1 }, "replace");
			const anchor = view.anchor;

			// Drag to different cells
			view.selectCell({ row: 2, col: 2 }, "range");
			expect(view.anchor).toEqual(anchor);

			view.selectCell({ row: 3, col: 3 }, "range");
			expect(view.anchor).toEqual(anchor);
		});
	});

	describe("Keyboard shortcut behavior", () => {
		it("should handle Ctrl+A (select all)", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Simulate Ctrl+A
			view.selectAll();

			// Should select all 16 cells
			expect(view.getSelectionCount()).toBe(16);
			for (let row = 0; row < 4; row++) {
				for (let col = 0; col < 4; col++) {
					expect(view.isSelected({ row, col })).toBe(true);
				}
			}
		});

		it("should handle Escape (clear selection)", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select some cells
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 2 }, "range");
			expect(view.getSelectionCount()).toBeGreaterThan(0);

			// Simulate Escape key
			view.clearSelection();

			// Should clear all selection
			expect(view.getSelectionCount()).toBe(0);
			expect(view.anchor).toBeNull();
		});
	});

	describe("Selection info display", () => {
		it("should provide selection count for UI display", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// No selection
			expect(view.getSelectionCount()).toBe(0);

			// Single selection
			view.selectCell({ row: 0, col: 0 }, "replace");
			expect(view.getSelectionCount()).toBe(1);

			// Range selection
			view.selectCell({ row: 2, col: 2 }, "range");
			expect(view.getSelectionCount()).toBe(9);

			// Select all
			view.selectAll();
			expect(view.getSelectionCount()).toBe(16);
		});

		it("should provide selected cell coordinates for UI", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select scattered cells
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "add");
			view.selectCell({ row: 2, col: 2 }, "add");

			const selected = view.getSelectedCells();

			expect(selected.length).toBe(3);
			expect(selected).toContainEqual({ row: 0, col: 0, depth: undefined });
			expect(selected).toContainEqual({ row: 1, col: 1, depth: undefined });
			expect(selected).toContainEqual({ row: 2, col: 2, depth: undefined });
		});
	});

	describe("Different table types", () => {
		it("should handle 1D table selection", () => {
			const rom = createROM(0x2000);
			const def = create1DTableDef(10);
			const view = new TableView(rom, def);

			// Select range in 1D table
			view.selectCell({ row: 2, col: 0 }, "replace");
			view.selectCell({ row: 5, col: 0 }, "range");

			// Should select 4 rows
			expect(view.getSelectionCount()).toBe(4);
			expect(view.isSelected({ row: 2, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 3, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 4, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 5, col: 0 })).toBe(true);
		});

		it("should handle 2D table selection", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select rectangular region
			view.selectCell({ row: 1, col: 1 }, "replace");
			view.selectCell({ row: 2, col: 3 }, "range");

			// Should select 2 rows x 3 cols = 6 cells
			expect(view.getSelectionCount()).toBe(6);
		});
	});

	describe("Edge cases and error handling", () => {
		it("should handle rapid selection changes", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Rapid clicks on different cells
			for (let i = 0; i < 10; i++) {
				const row = i % 4;
				const col = Math.floor(i / 4);
				view.selectCell({ row, col }, "replace");
			}

			// Should have last cell selected
			expect(view.getSelectionCount()).toBe(1);
		});

		it("should handle selection on empty table", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(0, 0);
			const view = new TableView(rom, def);

			// Try to select all
			view.selectAll();

			// Should have no selection
			expect(view.getSelectionCount()).toBe(0);
		});

		it("should handle range mode without anchor", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Try range mode without setting anchor first
			view.selectCell({ row: 1, col: 1 }, "range");

			// Should not select anything
			expect(view.getSelectionCount()).toBe(0);
		});

		it("should handle selection across entire row", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select entire first row
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 0, col: 3 }, "range");

			expect(view.getSelectionCount()).toBe(4);
			for (let col = 0; col < 4; col++) {
				expect(view.isSelected({ row: 0, col })).toBe(true);
			}
		});

		it("should handle selection across entire column", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select entire first column
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 3, col: 0 }, "range");

			expect(view.getSelectionCount()).toBe(4);
			for (let row = 0; row < 4; row++) {
				expect(view.isSelected({ row, col: 0 })).toBe(true);
			}
		});
	});

	describe("Selection state management", () => {
		it("should maintain selection state across operations", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Create selection
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 2, col: 2 }, "range");

			const selectionBefore = view.getSelectionCount();
			const selectedCellsBefore = view.getSelectedCells();

			// Selection should persist
			expect(view.getSelectionCount()).toBe(selectionBefore);
			expect(view.getSelectedCells()).toEqual(selectedCellsBefore);
		});

		it("should clear selection state properly", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Create complex selection
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 1, col: 1 }, "add");
			view.selectCell({ row: 2, col: 2 }, "add");

			// Clear
			view.clearSelection();

			// Verify everything is cleared
			expect(view.getSelectionCount()).toBe(0);
			expect(view.getSelectedCells()).toEqual([]);
			expect(view.anchor).toBeNull();
		});

		it("should handle selection with non-contiguous cells", () => {
			const rom = createROM(0x2000);
			const def = create2DTableDef(4, 4);
			const view = new TableView(rom, def);

			// Select corners
			view.selectCell({ row: 0, col: 0 }, "replace");
			view.selectCell({ row: 0, col: 3 }, "add");
			view.selectCell({ row: 3, col: 0 }, "add");
			view.selectCell({ row: 3, col: 3 }, "add");

			expect(view.getSelectionCount()).toBe(4);
			expect(view.isSelected({ row: 0, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 0, col: 3 })).toBe(true);
			expect(view.isSelected({ row: 3, col: 0 })).toBe(true);
			expect(view.isSelected({ row: 3, col: 3 })).toBe(true);
			// Middle cells should not be selected
			expect(view.isSelected({ row: 1, col: 1 })).toBe(false);
		});
	});
});
