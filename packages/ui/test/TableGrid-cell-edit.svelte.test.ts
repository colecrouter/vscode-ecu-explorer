/**
 * Regression tests for cell editing index correctness in TableGrid.
 *
 * Covers the bug where editing a non-first cell in a 1D table always
 * applied the value to the first cell (index 0) instead of the correct cell.
 *
 * Root cause: TableGrid.handleCommit called view.stageCell({ row: rowIndex })
 * for 1D tables. Since 1D tables are displayed as a single row, rowIndex is
 * always 0. The fix passes colIndex as the row so the correct cell is staged.
 */
import type { Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TableGrid from "../src/lib/views/TableGrid.svelte";
import { TableView } from "../src/lib/views/table.svelte";

describe("TableGrid cell editing — index correctness", () => {
	describe("1D table cell editing", () => {
		it("editing a non-first cell (colIndex=3) should update that cell, not the first cell", async () => {
			// ROM is all zeros
			const rom = new Uint8Array(1024);

			const def: Table1DDefinition = {
				kind: "table1d",
				name: "Test 1D",
				rows: 8,
				z: { name: "Values", address: 0, length: 8, dtype: "u8" },
			};

			const view = new TableView(rom, def);
			const screen = render(TableGrid, { view, definition: def });

			// A 1D table with 8 rows is displayed as 1 row × 8 columns
			const cells = screen.getByRole("cell");
			await expect.poll(() => cells.all().length).toBe(8);

			// Edit the 4th cell (colIndex=3)
			const targetInput = cells.nth(3).getByRole("spinbutton");
			await targetInput.click();
			await targetInput.fill("99");
			await userEvent.keyboard("{Tab}");

			// After blur, stageCell should have been called with the correct index (row=3 for 1D)
			// Verify the correct cell was updated in the reactive data
			await expect
				.poll(() => {
					const data = view.data as Uint8Array[];
					const bytes = data[3]!;
					return new DataView(
						bytes.buffer,
						bytes.byteOffset,
						bytes.byteLength,
					).getUint8(0);
				})
				.toBe(99);

			// Commit and verify the transaction targets the correct address (3)
			const tx = view.commit("Test");
			expect(tx).not.toBeNull();
			expect(tx!.edits.length).toBe(1);
			expect(tx!.edits[0]!.address).toBe(3);
			expect(tx!.edits[0]!.after[0]).toBe(99);

			// The first cell (address 0) should NOT have been modified
			expect(rom[0]).toBe(0);
		});

		it("editing the last cell in a 1D table should update the correct address", async () => {
			const rom = new Uint8Array(1024);

			const def: Table1DDefinition = {
				kind: "table1d",
				name: "Test 1D",
				rows: 5,
				z: { name: "Values", address: 0, length: 5, dtype: "u8" },
			};

			const view = new TableView(rom, def);
			const screen = render(TableGrid, { view, definition: def });

			const cells = screen.getByRole("cell");
			await expect.poll(() => cells.all().length).toBe(5);

			// Edit the last cell (colIndex=4)
			const lastInput = cells.nth(4).getByRole("spinbutton");
			await lastInput.click();
			await lastInput.fill("127");
			await userEvent.keyboard("{Tab}");

			await expect
				.poll(() => {
					const data = view.data as Uint8Array[];
					const bytes = data[4]!;
					return new DataView(
						bytes.buffer,
						bytes.byteOffset,
						bytes.byteLength,
					).getUint8(0);
				})
				.toBe(127);

			const tx = view.commit("Test");
			expect(tx).not.toBeNull();
			expect(tx!.edits[0]!.address).toBe(4);
			expect(tx!.edits[0]!.after[0]).toBe(127);
			expect(rom[0]).toBe(0); // first cell must be untouched
		});
	});

	describe("2D table cell editing (regression: must remain correct)", () => {
		it("editing cell at row=1, col=2 in a 4×4 table should update address 6", async () => {
			const rom = new Uint8Array(1024);
			const def: Table2DDefinition = {
				kind: "table2d",
				name: "Test 2D",
				rows: 4,
				cols: 4,
				z: { name: "Values", address: 0, length: 16, dtype: "u8" },
			};
			const view = new TableView(rom, def);
			const screen = render(TableGrid, { view, definition: def });

			const cells = screen.getByRole("cell");
			await expect.poll(() => cells.all().length).toBe(16);

			// row=1, col=2 → linear index = 1*4+2 = 6 (7th cell)
			const targetInput = cells.nth(6).getByRole("spinbutton");
			await targetInput.click();
			await targetInput.fill("55");
			await userEvent.keyboard("{Tab}");

			await expect
				.poll(() => {
					const data = view.data as Uint8Array[][];
					const bytes = data[1]![2]!;
					return new DataView(
						bytes.buffer,
						bytes.byteOffset,
						bytes.byteLength,
					).getUint8(0);
				})
				.toBe(55);

			const tx = view.commit("Test");
			expect(tx).not.toBeNull();
			expect(tx!.edits[0]!.address).toBe(6);
			expect(rom[0]).toBe(0);
		});
	});
});
