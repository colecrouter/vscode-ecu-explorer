import type {
	ROMDefinition,
	Table1DDefinition,
	Table2DDefinition,
} from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMcpConfig,
	createRomLoaderResult,
} from "../test/tool-test-support.js";
import { handleDiffTables } from "./diff-tables.js";

let baseDefinition: ROMDefinition;
let targetDefinition: ROMDefinition;
let baseBytes: Uint8Array;
let targetBytes: Uint8Array;

const config = createMcpConfig();

vi.mock("../rom-loader.js", () => ({
	loadRom: vi.fn(async (romPath: string) => {
		if (romPath.includes("base")) {
			return createRomLoaderResult(baseDefinition, baseBytes, {
				romPath: "/tmp/base.rom",
			});
		}

		return createRomLoaderResult(targetDefinition, targetBytes, {
			romPath: "/tmp/target.rom",
		});
	}),
}));

function makeFuelTable(
	overrides: Partial<Table2DDefinition> = {},
): Table2DDefinition {
	return {
		id: "fuel",
		name: "Fuel Map",
		kind: "table2d",
		rows: 2,
		cols: 2,
		category: "Fuel",
		x: {
			id: "x-fuel",
			kind: "static",
			name: "RPM (rpm)",
			values: [3000, 4000],
		},
		y: {
			id: "y-fuel",
			kind: "static",
			name: "Load (g/rev)",
			values: [1.2, 1.6],
		},
		z: {
			id: "z-fuel",
			name: "values",
			address: 0,
			dtype: "u8",
		},
		...overrides,
	};
}

function makeIdleTable(
	overrides: Partial<Table1DDefinition> = {},
): Table1DDefinition {
	return {
		id: "idle",
		name: "Idle Speed",
		kind: "table1d",
		rows: 2,
		category: "Idle",
		x: {
			id: "x-idle",
			kind: "static",
			name: "Coolant Temp (C)",
			values: [20, 80],
		},
		z: {
			id: "z-idle",
			name: "values",
			address: 4,
			dtype: "u8",
		},
		...overrides,
	};
}

describe("handleDiffTables", () => {
	beforeEach(() => {
		baseBytes = Uint8Array.from([10, 20, 30, 40, 50, 60]);
		targetBytes = Uint8Array.from([10, 25, 30, 40, 50, 60]);

		baseDefinition = {
			uri: "file:///tmp/base.xml",
			name: "Base Definition",
			fingerprints: [],
			platform: {},
			tables: [makeFuelTable(), makeIdleTable()],
		};

		targetDefinition = {
			uri: "file:///tmp/target.xml",
			name: "Base Definition",
			fingerprints: [],
			platform: {},
			tables: [makeFuelTable(), makeIdleTable()],
		};
	});

	it("returns a summary with changed tables first", async () => {
		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
			},
			config,
		);

		expect(result).toContain("changed_tables: 1");
		expect(result).toContain("unchanged_tables: 1");
		expect(result).toContain("| 1 | Fuel Map");
		expect(result).toContain("| changed");
		expect(result).toContain("| 1             | 5");
	});

	it("filters summary results with query", async () => {
		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
				query: "idle",
				pageSize: 10,
			},
			config,
		);

		expect(result).toContain("Idle Speed");
		expect(result).not.toContain("Fuel Map");
	});

	it("returns detailed changed cells for a compatible table", async () => {
		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
				table: "Fuel Map",
			},
			config,
		);

		expect(result).toContain("status: changed");
		expect(result).toContain("cells_changed: 1");
		expect(result).toContain("portability: safe");
		expect(result).toContain("Changed cells for Fuel Map.");
		expect(result).toContain("| 1.2      | 4000");
		expect(result).toContain("| 20         | 25");
	});

	it("adds a row index in 1D detail mode when axis values repeat", async () => {
		baseDefinition = {
			...baseDefinition,
			tables: [
				makeIdleTable({
					name: "Repeated Axis Table",
					x: {
						id: "x-repeat",
						kind: "static",
						name: "Volts",
						values: [0, 5],
					},
				}),
			],
		};
		targetDefinition = {
			...targetDefinition,
			tables: [
				makeIdleTable({
					name: "Repeated Axis Table",
					x: {
						id: "x-repeat",
						kind: "static",
						name: "Volts",
						values: [0, 5],
					},
				}),
			],
		};
		baseBytes = Uint8Array.from([50, 60, 0, 0, 10, 20]);
		targetBytes = Uint8Array.from([50, 60, 0, 0, 10, 30]);

		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
				table: "Repeated Axis Table",
			},
			config,
		);

		expect(result).not.toContain("| index |");

		baseDefinition = {
			...baseDefinition,
			tables: [
				makeIdleTable({
					name: "Repeated Axis Table",
					x: {
						id: "x-repeat-dup",
						kind: "static",
						name: "Volts",
						values: [5, 5],
					},
				}),
			],
		};
		targetDefinition = {
			...targetDefinition,
			tables: [
				makeIdleTable({
					name: "Repeated Axis Table",
					x: {
						id: "x-repeat-dup",
						kind: "static",
						name: "Volts",
						values: [5, 5],
					},
				}),
			],
		};

		const duplicateResult = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
				table: "Repeated Axis Table",
			},
			config,
		);

		expect(duplicateResult).toContain("| index | axis |");
		expect(duplicateResult).toContain("| 1     | 5");
	});

	it("reports axis changes when table breakpoints differ", async () => {
		targetDefinition = {
			...targetDefinition,
			tables: [
				makeFuelTable({
					x: {
						id: "x-fuel",
						kind: "static",
						name: "RPM (rpm)",
						values: [3200, 4200],
					},
				}),
				makeIdleTable(),
			],
		};

		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
				table: "Fuel Map",
			},
			config,
		);

		expect(result).toContain("status: axis_changed");
		expect(result).toContain("x_axis_changed: true");
		expect(result).toContain("different axis breakpoints");
		expect(result).toContain("RPM (rpm) base");
		expect(result).toContain("3200");
	});

	it("reports base-only and target-only tables when definitions differ", async () => {
		baseDefinition = {
			...baseDefinition,
			name: "Base Definition A",
			tables: [makeFuelTable(), makeIdleTable()],
		};
		targetDefinition = {
			...targetDefinition,
			name: "Base Definition B",
			tables: [
				makeFuelTable(),
				{
					...makeIdleTable(),
					name: "Boost Limit",
					id: "boost",
				},
			],
		};

		const result = await handleDiffTables(
			{
				baseRom: "/tmp/base.rom",
				targetRom: "/tmp/target.rom",
			},
			config,
		);

		expect(result).toContain(
			"warning: definitions differ; only exact-name table matches are compared",
		);
		expect(result).toContain("base_only_tables: 1");
		expect(result).toContain("target_only_tables: 1");
		expect(result).toContain("Boost Limit");
		expect(result).toContain("target_only");
	});

	it("fails when ROM sizes differ", async () => {
		targetBytes = Uint8Array.from([1, 2, 3]);

		await expect(
			handleDiffTables(
				{
					baseRom: "/tmp/base.rom",
					targetRom: "/tmp/target.rom",
				},
				config,
			),
		).rejects.toThrow("ROM size mismatch");
	});

	it("errors when detail mode table is missing in both ROMs", async () => {
		await expect(
			handleDiffTables(
				{
					baseRom: "/tmp/base.rom",
					targetRom: "/tmp/target.rom",
					table: "Missing Table",
				},
				config,
			),
		).rejects.toThrow(
			'Table "Missing Table" not found in either ROM definition',
		);
	});
});
