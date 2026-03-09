import type {
	StaticArrayDefinition,
	Table1DDefinition,
	Table2DDefinition,
	Table3DDefinition,
	Unit,
} from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TableGrid from "../src/lib/views/TableGrid.svelte";
import { TableView } from "../src/lib/views/table.svelte.js";

function createUnit(symbol: string): Unit {
	return {
		symbol,
		min: Number.NEGATIVE_INFINITY,
		max: Number.POSITIVE_INFINITY,
		step: 1,
		type: "u8",
		order: "be",
		to: (raw) => raw,
		from: (scaled) => scaled,
	};
}

function createStaticAxis(
	name: string,
	values: number[],
	unit: Unit,
): StaticArrayDefinition {
	return {
		kind: "static",
		id: `axis-${name.toLowerCase().replace(/\s+/g, "-")}`,
		name,
		values,
		unit,
	};
}

describe("TableGrid Component", () => {
	const rom = new Uint8Array(1024).fill(0);

	function createROM(size = 1024): Uint8Array {
		return new Uint8Array(size).fill(0);
	}

	const def2d: Table2DDefinition = {
		id: "table-2d-test",
		kind: "table2d",
		name: "Test 2D",
		rows: 4,
		cols: 4,
		z: { id: "values-2d", name: "Values", address: 0, length: 16, dtype: "u8" },
	};

	it("should render correct number of cells for 2D table", async () => {
		const view = new TableView(rom, def2d);
		const screen = render(TableGrid, { view, definition: def2d });

		const cells = screen.getByRole("cell");
		await expect.poll(() => cells.all().length).toBe(16);
	});

	it("should show layer selector for 3D table", async () => {
		const def3d: Table3DDefinition = {
			id: "table-3d-test",
			kind: "table3d",
			name: "Test 3D",
			rows: 4,
			cols: 4,
			depth: 2,
			z: {
				id: "z-test-3d",
				name: "Values",
				address: 0,
				length: 32,
				dtype: "u8",
			},
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
			x: createStaticAxis("X Axis", [1, 2, 3, 4], createUnit("RPM")),
			y: createStaticAxis("Y Axis", [10, 20, 30, 40], createUnit("Load")),
			z: {
				...def2d.z,
				unit: createUnit("%"),
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

	it("should render transformed values in cells when z.transform is defined", async () => {
		const romForTransform = createROM();

		const def: Table1DDefinition = {
			kind: "table1d",
			name: "Transform Table",
			id: "grid-transform-1d",
			rows: 1,
			z: {
				id: "values-transformed",
				name: "Values",
				address: 0,
				length: 1,
				dtype: "u8",
				transform: (raw) => raw * 2,
				inverseTransform: (physical) => physical / 2,
			},
		};

		romForTransform[0] = 4;
		const view = new TableView(romForTransform, def);
		const screen = render(TableGrid, { view, definition: def });

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(8);
	});

	it("should encode edits using z.inverseTransform when defined", async () => {
		const romForInverse = createROM();

		const def: Table1DDefinition = {
			kind: "table1d",
			name: "Inverse Transform Table",
			id: "grid-inverse-1d",
			rows: 1,
			z: {
				id: "values-inverse",
				name: "Values",
				address: 0,
				length: 1,
				dtype: "u8",
				transform: (raw) => raw * 2,
				inverseTransform: (physical) => physical / 2,
			},
		};

		const view = new TableView(romForInverse, def);
		const screen = render(TableGrid, { view, definition: def });

		const input = screen.getByRole("spinbutton");
		await input.click();
		await input.fill("20");
		await userEvent.keyboard("{Tab}");

		const tx = view.commit("Set cell");
		expect(tx).not.toBeNull();
		expect(tx?.edits[0]?.after[0]).toBe(10);
		expect(romForInverse[0]).toBe(10);
	});
});
