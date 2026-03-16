import { describe, expect, it } from "vitest";
import type {
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "../src/definition/table.js";
import {
	findClosestTableMatches,
	rankTablesByQuery,
} from "../src/definition/table-search.js";

describe("table search", () => {
	const highOctaneIgnition = {
		id: "ignition",
		name: "High Octane Ignition",
		kind: "table2d",
		rows: 2,
		cols: 2,
		category: "Ignition",
		x: {
			id: "rpm",
			kind: "static",
			name: "RPM (rpm)",
			values: [3000, 4000],
		},
		y: {
			id: "load",
			kind: "static",
			name: "Load (g/rev)",
			values: [1.6, 2],
		},
		z: {
			id: "z1",
			name: "values",
			address: 0,
			dtype: "u8",
		},
	} satisfies Table2DDefinition;

	const primaryOpenLoopFueling = {
		id: "fuel",
		name: "Primary Open Loop Fueling",
		kind: "table2d",
		rows: 2,
		cols: 2,
		category: "Fuel",
		x: {
			id: "rpm-fuel",
			kind: "static",
			name: "RPM (rpm)",
			values: [3000, 4000],
		},
		y: {
			id: "load-fuel",
			kind: "static",
			name: "Load (g/rev)",
			values: [1.6, 2],
		},
		z: {
			id: "z2",
			name: "values",
			address: 4,
			dtype: "u8",
		},
	} satisfies Table2DDefinition;

	const coolantCompensation = {
		id: "coolant",
		name: "Coolant Compensation",
		kind: "table1d",
		rows: 4,
		x: {
			id: "coolant-temp",
			kind: "static",
			name: "Coolant Temp (C)",
			values: [20, 40, 60, 80],
		},
		z: {
			id: "z3",
			name: "values",
			address: 8,
			dtype: "u8",
		},
	} satisfies Table1DDefinition;

	const tables: TableDefinition[] = [
		highOctaneIgnition,
		primaryOpenLoopFueling,
		coolantCompensation,
	];

	it("ranks by broad metadata queries", () => {
		const results = rankTablesByQuery("ignition rpm load", tables);
		expect(results[0]?.value.name).toBe("High Octane Ignition");
	});

	it("matches parenthetical axis names through weighted metadata", () => {
		const results = rankTablesByQuery("coolant temp", tables);
		expect(results[0]?.value.name).toBe("Coolant Compensation");
	});

	it("surfaces typo-tolerant suggestions", () => {
		const results = findClosestTableMatches("High Octane Ignitoin", tables, 2);
		expect(results[0]?.name).toBe("High Octane Ignition");
	});

	it("prefers table names over weaker metadata-only matches", () => {
		const results = rankTablesByQuery("fueling", tables);
		expect(results[0]?.value.name).toBe("Primary Open Loop Fueling");
	});
});
