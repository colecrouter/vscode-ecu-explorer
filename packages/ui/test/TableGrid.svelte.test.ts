import type { Table2DDefinition, Table3DDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TableGrid from "../src/lib/views/TableGrid.svelte";
import { TableView } from "../src/lib/views/table.svelte";

describe("TableGrid Component", () => {
	const rom = new Uint8Array(1024).fill(0);

	const def2d: Table2DDefinition = {
		kind: "table2d",
		name: "Test 2D",
		rows: 4,
		cols: 4,
		z: { name: "Values", address: 0, length: 16, dtype: "u8" },
	};

	it("should render correct number of cells for 2D table", async () => {
		const view = new TableView(rom, def2d);
		const screen = render(TableGrid, { view, definition: def2d });

		const cells = screen.getByRole("cell");
		await expect.poll(() => cells.all().length).toBe(16);
	});

	it("should show layer selector for 3D table", async () => {
		const def3d: Table3DDefinition = {
			kind: "table3d",
			name: "Test 3D",
			rows: 4,
			cols: 4,
			depth: 2,
			z: { name: "Values", address: 0, length: 32, dtype: "u8" },
		};
		const view = new TableView(rom, def3d);
		const screen = render(TableGrid, { view, definition: def3d });

		const select = screen.getByRole("combobox");
		await expect.element(select).toBeVisible();
	});

	it("should handle cell click for selection", async () => {
		const view = new TableView(rom, def2d);
		const screen = render(TableGrid, { view, definition: def2d });

		// Wait for cells to be rendered
		const cells = screen.getByRole("cell");
		await expect.poll(() => cells.all().length).toBe(16);

		const cell = cells.first();
		await cell.click();

		expect(view.getSelectionCount()).toBe(1);
	});

	it("should navigate with arrow keys", async () => {
		const view = new TableView(rom, def2d);
		const screen = render(TableGrid, { view, definition: def2d });

		// Wait for cells to be rendered
		const cells = screen.getByRole("cell");
		await expect.poll(() => cells.all().length).toBe(16);

		// Click the input inside the first cell directly so it receives DOM focus.
		// The document-level keydown handler requires document.activeElement to be
		// the <input> element, not the surrounding <td>.
		const firstInput = cells.first().getByRole("spinbutton");
		await firstInput.click();

		await userEvent.keyboard("{ArrowRight}");

		await expect.poll(() => view.isSelected({ row: 0, col: 1 })).toBe(true);
	});

	it("should render units in headers", async () => {
		const defWithUnits: Table2DDefinition = {
			...def2d,
			x: {
				kind: "static",
				name: "X Axis",
				values: [1, 2, 3, 4],
				unit: { symbol: "RPM" } as any,
			},
			y: {
				kind: "static",
				name: "Y Axis",
				values: [10, 20, 30, 40],
				unit: { symbol: "Load" } as any,
			},
			z: {
				...def2d.z,
				unit: { symbol: "%" } as any,
			},
		};
		const view = new TableView(rom, defWithUnits);
		const screen = render(TableGrid, { view, definition: defWithUnits });

		// Check for X unit in corner
		const xUnit = screen.getByText("RPM");
		await expect.element(xUnit).toBeVisible();

		// Check for Y unit in corner
		const yUnit = screen.getByText("Load");
		await expect.element(yUnit).toBeVisible();

		// Check for Z unit above table
		const zUnit = screen.getByText("Unit: %");
		await expect.element(zUnit).toBeVisible();
	});
});
