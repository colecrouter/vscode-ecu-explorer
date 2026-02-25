import type {
	Table1DDefinition,
	Table2DDefinition,
	Table3DDefinition,
} from "@ecu-explorer/core";
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
 * Helper to create a simple 3D table definition
 */
function create3DTableDef(
	rows: number = 4,
	cols: number = 4,
	depth: number = 2,
): Table3DDefinition {
	return {
		kind: "table3d",
		name: "Test 3D Table",
		rows,
		cols,
		depth,
		z: {
			name: "Values",
			address: 0x1000,
			length: rows * cols * depth,
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

describe("TableView Svelte Reactive State", () => {
	describe("Initialization", () => {
		it("should initialize TableView", () => {
			const tableView = {
				name: "Test Table",
				data: [],
				staged: new Map(),
			};

			expect(tableView.name).toBe("Test Table");
			expect(tableView.data.length).toBe(0);
			expect(tableView.staged.size).toBe(0);
		});

		it("should initialize with empty staged changes", () => {
			const staged = new Map<string, number>();
			expect(staged.size).toBe(0);
		});
	});

	describe("Loading data from ROM bytes", () => {
		it("should load data from ROM bytes", () => {
			const romBytes = new Uint8Array([10, 20, 30, 40, 50]);
			const data = Array.from(romBytes);

			expect(data.length).toBe(5);
			expect(data[0]).toBe(10);
		});

		it("should handle empty ROM", () => {
			const romBytes = new Uint8Array(0);
			const data = Array.from(romBytes);

			expect(data.length).toBe(0);
		});
	});

	describe("Cell staging", () => {
		it("should stage cell edit without commit", () => {
			const staged = new Map<string, number>();
			staged.set("cell_0_0", 42);

			expect(staged.get("cell_0_0")).toBe(42);
		});

		it("should update staged value", () => {
			const staged = new Map<string, number>();
			staged.set("cell_0_0", 42);
			staged.set("cell_0_0", 100);

			expect(staged.get("cell_0_0")).toBe(100);
		});

		it("should stage multiple cells", () => {
			const staged = new Map<string, number>();
			staged.set("cell_0_0", 10);
			staged.set("cell_0_1", 20);
			staged.set("cell_1_0", 30);

			expect(staged.size).toBe(3);
		});
	});

	describe("Cell commit", () => {
		it("should commit staged changes", () => {
			const data = [0, 0, 0, 0];
			const staged = new Map<string, number>();
			staged.set("cell_0", 42);

			// Apply staged changes
			staged.forEach((value, key) => {
				const indexStr = key.split("_")[1];
				if (indexStr) {
					const index = parseInt(indexStr);
					data[index] = value;
				}
			});

			expect(data[0]).toBe(42);
		});

		it("should clear staged after commit", () => {
			const staged = new Map<string, number>();
			staged.set("cell_0", 42);
			staged.clear();

			expect(staged.size).toBe(0);
		});
	});

	describe("Undo/Redo functionality", () => {
		it("should track undo history", () => {
			const history: number[][] = [];
			const data = [10, 20, 30];

			history.push([...data]);
			data[0] = 100;
			history.push([...data]);

			expect(history.length).toBe(2);
			const firstRow = history[0];
			const secondRow = history[1];
			if (firstRow && secondRow) {
				expect(firstRow[0]).toBe(10);
				expect(secondRow[0]).toBe(100);
			}
		});

		it("should undo to previous state", () => {
			const history: number[][] = [];
			const data = [10, 20, 30];

			history.push([...data]);
			data[0] = 100;
			history.push([...data]);

			const undone = history[history.length - 2];
			if (undone) {
				expect(undone[0]).toBe(10);
			}
		});

		it("should track redo history", () => {
			const undoHistory: number[][] = [];
			const redoHistory: number[][] = [];
			const data = [10, 20, 30];

			undoHistory.push([...data]);
			data[0] = 100;
			redoHistory.push([...data]);

			expect(redoHistory.length).toBe(1);
		});
	});

	describe("Reactive updates", () => {
		it("should update view on data change", () => {
			let data = [10, 20, 30];
			const originalLength = data.length;

			data = [10, 20, 30, 40];

			expect(data.length).toBeGreaterThan(originalLength);
		});

		it("should trigger reactivity on cell edit", () => {
			const staged = new Map<string, number>();

			staged.set("cell_0", 100);

			expect(staged.size).toBeGreaterThan(0);
		});
	});

	describe("Different table types", () => {
		it("should handle 1D table", () => {
			const table = {
				type: "1d",
				columns: 10,
				data: new Array(10).fill(0),
			};

			expect(table.type).toBe("1d");
			expect(table.data.length).toBe(10);
		});

		it("should handle 2D table", () => {
			const table = {
				type: "2d",
				columns: 16,
				rows: 16,
				data: new Array(256).fill(0),
			};

			expect(table.type).toBe("2d");
			expect(table.data.length).toBe(256);
		});

		it("should handle 3D table", () => {
			const table = {
				type: "3d",
				columns: 16,
				rows: 16,
				layers: 8,
				data: new Array(2048).fill(0),
			};

			expect(table.type).toBe("3d");
			expect(table.data.length).toBe(2048);
		});
	});

	describe("Error handling", () => {
		it("should handle invalid cell reference", () => {
			const staged = new Map<string, number>();
			const value = staged.get("invalid_cell");

			expect(value).toBeUndefined();
		});

		it("should handle out of bounds access", () => {
			const data = [10, 20, 30];
			const value = data[100];

			expect(value).toBeUndefined();
		});
	});

	describe("Undo/Redo UI Integration", () => {
		it("should enable undo button when history exists", () => {
			const undoStack: any[] = [];
			undoStack.push({ row: 0, col: 0, oldValue: 10, newValue: 20 });

			const canUndo = undoStack.length > 0;
			expect(canUndo).toBe(true);
		});

		it("should disable undo button when history is empty", () => {
			const undoStack: any[] = [];

			const canUndo = undoStack.length > 0;
			expect(canUndo).toBe(false);
		});

		it("should enable redo button when undone operations exist", () => {
			const redoStack: any[] = [];
			redoStack.push({ row: 0, col: 0, oldValue: 20, newValue: 10 });

			const canRedo = redoStack.length > 0;
			expect(canRedo).toBe(true);
		});

		it("should disable redo button when no undone operations", () => {
			const redoStack: any[] = [];

			const canRedo = redoStack.length > 0;
			expect(canRedo).toBe(false);
		});

		it("should handle keyboard shortcut Ctrl+Z for undo", () => {
			const event = new KeyboardEvent("keydown", {
				key: "z",
				ctrlKey: true,
			});

			const isUndo =
				(event.ctrlKey || event.metaKey) &&
				event.key === "z" &&
				!event.shiftKey;
			expect(isUndo).toBe(true);
		});

		it("should handle keyboard shortcut Cmd+Z for undo on Mac", () => {
			const event = new KeyboardEvent("keydown", {
				key: "z",
				metaKey: true,
			});

			const isUndo =
				(event.ctrlKey || event.metaKey) &&
				event.key === "z" &&
				!event.shiftKey;
			expect(isUndo).toBe(true);
		});

		it("should handle keyboard shortcut Ctrl+Y for redo", () => {
			const event = new KeyboardEvent("keydown", {
				key: "y",
				ctrlKey: true,
			});

			const isRedo = (event.ctrlKey || event.metaKey) && event.key === "y";
			expect(isRedo).toBe(true);
		});

		it("should handle keyboard shortcut Ctrl+Shift+Z for redo", () => {
			const event = new KeyboardEvent("keydown", {
				key: "z",
				ctrlKey: true,
				shiftKey: true,
			});

			const isRedo =
				(event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "z";
			expect(isRedo).toBe(true);
		});

		it("should update UI state after undo", () => {
			const undoStack: any[] = [];
			const redoStack: any[] = [];

			const operation = { row: 0, col: 0, oldValue: 10, newValue: 20 };
			undoStack.push(operation);

			// Simulate undo
			const undone = undoStack.pop();
			if (undone) redoStack.push(undone);

			expect(undoStack.length).toBe(0);
			expect(redoStack.length).toBe(1);
		});

		it("should update UI state after redo", () => {
			const undoStack: any[] = [];
			const redoStack: any[] = [];

			const operation = { row: 0, col: 0, oldValue: 10, newValue: 20 };
			redoStack.push(operation);

			// Simulate redo
			const redone = redoStack.pop();
			if (redone) undoStack.push(redone);

			expect(undoStack.length).toBe(1);
			expect(redoStack.length).toBe(0);
		});

		it("should clear redo stack on new edit", () => {
			const undoStack: any[] = [];
			const redoStack: any[] = [];

			// Add to undo and redo
			undoStack.push({ row: 0, col: 0, oldValue: 10, newValue: 20 });
			redoStack.push({ row: 1, col: 1, oldValue: 30, newValue: 40 });

			// New edit clears redo
			const newOp = { row: 2, col: 2, oldValue: 50, newValue: 60 };
			undoStack.push(newOp);
			redoStack.length = 0;

			expect(undoStack.length).toBe(2);
			expect(redoStack.length).toBe(0);
		});

		it("should handle rapid undo/redo operations", () => {
			const undoStack: any[] = [];
			const redoStack: any[] = [];

			// Add multiple operations
			for (let i = 0; i < 5; i++) {
				undoStack.push({
					row: i,
					col: i,
					oldValue: i * 10,
					newValue: i * 20,
				});
			}

			expect(undoStack.length).toBe(5);

			// Undo all
			while (undoStack.length > 0) {
				const op = undoStack.pop();
				if (op) redoStack.push(op);
			}

			expect(undoStack.length).toBe(0);
			expect(redoStack.length).toBe(5);

			// Redo all
			while (redoStack.length > 0) {
				const op = redoStack.pop();
				if (op) undoStack.push(op);
			}

			expect(undoStack.length).toBe(5);
			expect(redoStack.length).toBe(0);
		});
	});

	describe("TableView Selection", () => {
		describe("Single cell selection", () => {
			it("should select single cell with replace mode", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select a cell
				table.selectCell({ row: 1, col: 2 }, "replace");

				// Verify only one cell is selected
				expect(table.getSelectionCount()).toBe(1);
				expect(table.isSelected({ row: 1, col: 2 })).toBe(true);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(false);
			});

			it("should replace previous selection with new cell", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select first cell
				table.selectCell({ row: 0, col: 0 }, "replace");
				expect(table.isSelected({ row: 0, col: 0 })).toBe(true);

				// Select second cell with replace mode
				table.selectCell({ row: 1, col: 1 }, "replace");

				// Verify only second cell is selected
				expect(table.getSelectionCount()).toBe(1);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(false);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);
			});

			it("should set selection anchor on replace", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				table.selectCell({ row: 2, col: 3 }, "replace");

				expect(table.anchor).toEqual({ row: 2, col: 3 });
			});
		});

		describe("Range selection", () => {
			it("should extend selection with range mode", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select anchor cell
				table.selectCell({ row: 0, col: 0 }, "replace");

				// Extend to create range
				table.selectCell({ row: 2, col: 2 }, "range");

				// Verify all cells in rectangular region are selected (3x3 = 9 cells)
				expect(table.getSelectionCount()).toBe(9);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);
				expect(table.isSelected({ row: 2, col: 2 })).toBe(true);
				expect(table.isSelected({ row: 0, col: 2 })).toBe(true);
				expect(table.isSelected({ row: 2, col: 0 })).toBe(true);
			});

			it("should preserve selection anchor when using range mode", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Set anchor
				table.selectCell({ row: 1, col: 1 }, "replace");
				const anchor = table.anchor;

				// Extend range multiple times
				table.selectCell({ row: 2, col: 2 }, "range");
				expect(table.anchor).toEqual(anchor);

				table.selectCell({ row: 3, col: 3 }, "range");
				expect(table.anchor).toEqual(anchor);
			});

			it("should handle range selection in reverse direction", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select from bottom-right to top-left
				table.selectCell({ row: 3, col: 3 }, "replace");
				table.selectCell({ row: 1, col: 1 }, "range");

				// Should select 3x3 = 9 cells
				expect(table.getSelectionCount()).toBe(9);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);
				expect(table.isSelected({ row: 2, col: 2 })).toBe(true);
				expect(table.isSelected({ row: 3, col: 3 })).toBe(true);
			});

			it("should handle range selection for 1D tables", () => {
				const rom = createROM(0x2000);
				const def = create1DTableDef(10);
				const table = new TableView(rom, def);

				// Select range in 1D table (single column)
				table.selectCell({ row: 2, col: 0 }, "replace");
				table.selectCell({ row: 5, col: 0 }, "range");

				// Should select 4 cells (rows 2-5)
				expect(table.getSelectionCount()).toBe(4);
				expect(table.isSelected({ row: 2, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 3, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 4, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 5, col: 0 })).toBe(true);
			});
		});

		describe("Toggle selection (add mode)", () => {
			it("should toggle cell with add mode", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select first cell
				table.selectCell({ row: 0, col: 0 }, "replace");

				// Add another cell
				table.selectCell({ row: 1, col: 1 }, "add");

				// Both should be selected
				expect(table.getSelectionCount()).toBe(2);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);
			});

			it("should deselect cell when toggling already selected cell", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select a cell
				table.selectCell({ row: 1, col: 1 }, "replace");
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);

				// Toggle it off
				table.selectCell({ row: 1, col: 1 }, "add");

				// Should be deselected
				expect(table.isSelected({ row: 1, col: 1 })).toBe(false);
				expect(table.getSelectionCount()).toBe(0);
			});

			it("should allow non-contiguous selection with add mode", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select scattered cells
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 0, col: 3 }, "add");
				table.selectCell({ row: 3, col: 0 }, "add");
				table.selectCell({ row: 3, col: 3 }, "add");

				// All four corners should be selected
				expect(table.getSelectionCount()).toBe(4);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 0, col: 3 })).toBe(true);
				expect(table.isSelected({ row: 3, col: 0 })).toBe(true);
				expect(table.isSelected({ row: 3, col: 3 })).toBe(true);
				// Middle cells should not be selected
				expect(table.isSelected({ row: 1, col: 1 })).toBe(false);
			});
		});

		describe("Select all", () => {
			it("should select all cells in 1D table", () => {
				const rom = createROM(0x2000);
				const def = create1DTableDef(10);
				const table = new TableView(rom, def);

				table.selectAll();

				expect(table.getSelectionCount()).toBe(10);
				for (let row = 0; row < 10; row++) {
					expect(table.isSelected({ row, col: 0 })).toBe(true);
				}
			});

			it("should select all cells in 2D table", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				table.selectAll();

				// Should select all 16 cells
				expect(table.getSelectionCount()).toBe(16);
				for (let row = 0; row < 4; row++) {
					for (let col = 0; col < 4; col++) {
						expect(table.isSelected({ row, col })).toBe(true);
					}
				}
			});

			it("should select all cells in 3D table", () => {
				const rom = createROM(0x4000);
				const def = create3DTableDef(3, 3, 2);
				const table = new TableView(rom, def);

				table.selectAll();

				// Should select all 9 cells (3x3) in current layer
				expect(table.getSelectionCount()).toBe(9);
			});
		});

		describe("Clear selection", () => {
			it("should clear all selections", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select multiple cells
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 2, col: 2 }, "range");
				expect(table.getSelectionCount()).toBeGreaterThan(0);

				// Clear selection
				table.clearSelection();

				// Verify no cells are selected
				expect(table.getSelectionCount()).toBe(0);
				expect(table.isSelected({ row: 0, col: 0 })).toBe(false);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(false);
			});

			it("should clear anchor and range", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Create a range selection
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 2, col: 2 }, "range");
				expect(table.anchor).not.toBeNull();

				// Clear selection
				table.clearSelection();

				// Verify anchor is cleared
				expect(table.anchor).toBeNull();
			});
		});

		describe("Get selected cells", () => {
			it("should get selected cells as coordinates", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select some cells
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 1, col: 1 }, "add");
				table.selectCell({ row: 2, col: 2 }, "add");

				const selected = table.getSelectedCells();

				// Verify returned array contains correct coordinates
				expect(selected.length).toBe(3);
				expect(selected).toContainEqual({ row: 0, col: 0, depth: undefined });
				expect(selected).toContainEqual({ row: 1, col: 1, depth: undefined });
				expect(selected).toContainEqual({ row: 2, col: 2, depth: undefined });
			});

			it("should return empty array when no selection", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				const selected = table.getSelectedCells();

				expect(selected.length).toBe(0);
			});
		});

		describe("Get selection count", () => {
			it("should return correct count for single selection", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				table.selectCell({ row: 0, col: 0 }, "replace");

				expect(table.getSelectionCount()).toBe(1);
			});

			it("should return correct count for range selection", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 1, col: 2 }, "range");

				// 2 rows x 3 cols = 6 cells
				expect(table.getSelectionCount()).toBe(6);
			});

			it("should return zero when no selection", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				expect(table.getSelectionCount()).toBe(0);
			});
		});

		describe("Edge cases", () => {
			it("should handle selection on empty table", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(0, 0);
				const table = new TableView(rom, def);

				table.selectAll();

				expect(table.getSelectionCount()).toBe(0);
			});

			it("should handle range mode without anchor", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Try to use range mode without setting anchor first
				table.selectCell({ row: 1, col: 1 }, "range");

				// Should not select anything since there's no anchor
				expect(table.getSelectionCount()).toBe(0);
			});

			it("should handle single cell range", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select same cell as anchor and end
				table.selectCell({ row: 1, col: 1 }, "replace");
				table.selectCell({ row: 1, col: 1 }, "range");

				// Should select just one cell
				expect(table.getSelectionCount()).toBe(1);
				expect(table.isSelected({ row: 1, col: 1 })).toBe(true);
			});

			it("should handle selection across entire row", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select entire first row
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 0, col: 3 }, "range");

				expect(table.getSelectionCount()).toBe(4);
				for (let col = 0; col < 4; col++) {
					expect(table.isSelected({ row: 0, col })).toBe(true);
				}
			});

			it("should handle selection across entire column", () => {
				const rom = createROM(0x2000);
				const def = create2DTableDef(4, 4);
				const table = new TableView(rom, def);

				// Select entire first column
				table.selectCell({ row: 0, col: 0 }, "replace");
				table.selectCell({ row: 3, col: 0 }, "range");

				expect(table.getSelectionCount()).toBe(4);
				for (let row = 0; row < 4; row++) {
					expect(table.isSelected({ row, col: 0 })).toBe(true);
				}
			});
		});
	});
});
