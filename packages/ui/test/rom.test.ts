import type { ROMDefinition, Table1DDefinition } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import { ROMView } from "../src/lib/views/rom.svelte.js";

function create1DTable(
	id: string,
	name: string,
	address: number,
	rows: number,
): Table1DDefinition {
	return {
		id,
		name,
		kind: "table1d",
		rows,
		z: {
			id: `${id}-z`,
			name: `${name} Values`,
			address,
			length: rows,
			dtype: "u8",
		},
		x: {
			id: `${id}-x`,
			name: `${name} Axis`,
			kind: "static",
			values: Array.from({ length: rows }, (_, index) => index),
		},
	};
}

function createDefinition(tables: Table1DDefinition[]): ROMDefinition {
	return {
		uri: "file:///test/definition.xml",
		name: "Reactive ROM Definition",
		fingerprints: [],
		platform: {},
		tables,
	};
}

describe("ROMView", () => {
	it("returns the same table model by id and name", () => {
		const fuelTable = create1DTable("fuel-table", "Fuel Table", 0, 4);
		const view = new ROMView(
			new Uint8Array([10, 20, 30, 40]),
			createDefinition([fuelTable]),
		);

		const byId = view.table(fuelTable.id);
		const byName = view.table(fuelTable.name);

		expect(byId).toBeDefined();
		expect(byId).toBe(byName);
	});

	it("updates table snapshots when ROM bytes are patched", () => {
		const fuelTable = create1DTable("fuel-table", "Fuel Table", 0, 4);
		const view = new ROMView(
			new Uint8Array([10, 20, 30, 40]),
			createDefinition([fuelTable]),
		);

		const table = view.table(fuelTable.id);
		if (!table) {
			throw new Error("Expected table model");
		}

		const before = table.snapshot;
		view.patchBytes(1, Uint8Array.from([99]));
		const after = table.snapshot;

		if (before.kind !== "table1d" || after.kind !== "table1d") {
			throw new Error("Expected 1D snapshots");
		}

		expect(before.z).toEqual([10, 20, 30, 40]);
		expect(after.z).toEqual([10, 99, 30, 40]);
	});

	it("notifies listeners with change metadata", () => {
		const table = create1DTable("fuel-table", "Fuel Table", 0, 4);
		const view = new ROMView(
			new Uint8Array([10, 20, 30, 40]),
			createDefinition([table]),
		);

		const events: { offset?: number; length?: number; bytes: Uint8Array }[] =
			[];
		const stop = view.onDidUpdate((event) => {
			events.push(event);
		});

		view.patchBytes(2, Uint8Array.from([55, 66]));
		stop();

		expect(events).toHaveLength(1);
		expect(events[0]?.offset).toBe(2);
		expect(events[0]?.length).toBe(2);
		expect(Array.from(events[0]?.bytes ?? [])).toEqual([10, 20, 55, 66]);
	});

	it("clears cached tables when the definition changes", () => {
		const fuelTable = create1DTable("fuel-table", "Fuel Table", 0, 4);
		const ignitionTable = create1DTable("ign-table", "Ignition Table", 4, 4);
		const view = new ROMView(
			new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
			createDefinition([fuelTable]),
		);

		expect(view.table(fuelTable.id)).toBeDefined();
		expect(view.table(ignitionTable.id)).toBeUndefined();

		view.setDefinition(createDefinition([fuelTable, ignitionTable]));

		expect(view.table(ignitionTable.id)).toBeDefined();
	});
});
