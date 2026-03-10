import type {
	ROMDefinition,
	Table1DDefinition,
	Table2DDefinition,
} from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../config.js";
import type { PatchTableOptions } from "./patch-table.js";
import { handlePatchTable } from "./patch-table.js";

let definition: ROMDefinition;
let romBytes: Uint8Array;
let lastWrittenBytes: Uint8Array | null = null;

const config: McpConfig = {
	definitionsPaths: [],
	logsDir: "/tmp",
};

vi.mock("../rom-loader.js", () => {
	return {
		loadRom: vi.fn(async () => ({
			romPath: "/tmp/transformed.rom",
			romBytes,
			definition,
			fileSizeBytes: romBytes.length,
			mtime: Date.now(),
		})),
		invalidateRomCache: vi.fn(),
	};
});

vi.mock("node:fs/promises", async () => {
	const actual = await import("node:fs/promises");
	return {
		...actual,
		writeFile: vi.fn(async (_path: string, bytes: Uint8Array) => {
			romBytes = new Uint8Array(bytes);
			lastWrittenBytes = new Uint8Array(bytes);
		}),
		rename: vi.fn(async () => {}),
		unlink: vi.fn(async () => {}),
	};
});

describe("handlePatchTable transform handling", () => {
	beforeEach(() => {
		lastWrittenBytes = null;
		romBytes = new Uint8Array(64);
		const transform = (raw: number) => raw * 2;
		const inverseTransform = (physical: number) => physical / 2;
		const transformTable1d = {
			id: "transform-table-1d",
			name: "Transform Table 1D",
			kind: "table1d",
			rows: 2,
			z: {
				id: "z-transform-1d",
				name: "values",
				address: 16,
				dtype: "u8",
				length: 2,
				transform,
				inverseTransform,
			},
		} satisfies Table1DDefinition;
		const transformTable2d = {
			id: "transform-table-2d",
			name: "Transform Table 2D",
			kind: "table2d",
			rows: 2,
			cols: 2,
			z: {
				id: "z-transform-2d",
				name: "values",
				address: 0,
				dtype: "u8",
				transform,
				inverseTransform,
			},
		} satisfies Table2DDefinition;

		definition = {
			uri: "file:///tmp/transformed.xml",
			name: "Transform Definition",
			fingerprints: [],
			platform: {},
			tables: [transformTable1d, transformTable2d],
		};
	});

	it("should apply z.transform when reading and inverseTransform when writing for table1D", async () => {
		romBytes[16] = 4;
		romBytes[17] = 8;

		const options: PatchTableOptions = {
			rom: "/tmp/transformed.rom",
			table: "Transform Table 1D",
			op: "add",
			value: 4,
		};

		await handlePatchTable(options, config);

		expect(lastWrittenBytes?.[16]).toBe(6);
		expect(lastWrittenBytes?.[17]).toBe(10);
	});

	it("should apply z.transform when reading and inverseTransform when writing for table2D", async () => {
		romBytes[0] = 2;
		romBytes[1] = 4;
		romBytes[2] = 6;
		romBytes[3] = 8;

		const options: PatchTableOptions = {
			rom: "/tmp/transformed.rom",
			table: "Transform Table 2D",
			op: "add",
			value: 2,
		};

		await handlePatchTable(options, config);

		expect(lastWrittenBytes?.[0]).toBe(3);
		expect(lastWrittenBytes?.[1]).toBe(5);
		expect(lastWrittenBytes?.[2]).toBe(7);
		expect(lastWrittenBytes?.[3]).toBe(9);
	});

	it("should patch only cells matched by where selectors", async () => {
		romBytes = Uint8Array.from([10, 20, 30, 40]);
		const selectorTable = {
			id: "selector-table",
			name: "Selector Table",
			kind: "table2d",
			rows: 2,
			cols: 2,
			x: {
				id: "x-selector",
				kind: "static",
				name: "RPM (rpm)",
				values: [3000, 4000],
			},
			y: {
				id: "y-selector",
				kind: "static",
				name: "Load (g/rev)",
				values: [1.6, 2.0],
			},
			z: {
				id: "selector-z",
				name: "values",
				address: 0,
				dtype: "u8",
			},
		} satisfies Table2DDefinition;

		definition = {
			uri: "file:///tmp/selector.xml",
			name: "Selector Definition",
			fingerprints: [],
			platform: {},
			tables: [selectorTable],
		};

		await handlePatchTable(
			{
				rom: "/tmp/transformed.rom",
				table: "Selector Table",
				op: "add",
				value: 5,
				where: "RPM (rpm) == 4000 && Load (g/rev) == 2",
			},
			config,
		);

		expect(lastWrittenBytes).toEqual(Uint8Array.from([10, 20, 30, 45]));
	});

	it("returns a bounding slice for disjoint selector matches while only writing matched cells", async () => {
		romBytes = Uint8Array.from([10, 20, 30, 40]);
		const selectorTable = {
			id: "selector-table",
			name: "Selector Table",
			kind: "table2d",
			rows: 2,
			cols: 2,
			x: {
				id: "x-selector",
				kind: "static",
				name: "RPM (rpm)",
				values: [3000, 4000],
			},
			y: {
				id: "y-selector",
				kind: "static",
				name: "Load (g/rev)",
				values: [1.6, 2.0],
			},
			z: {
				id: "selector-z",
				name: "values",
				address: 0,
				dtype: "u8",
			},
		} satisfies Table2DDefinition;

		definition = {
			uri: "file:///tmp/selector.xml",
			name: "Selector Definition",
			fingerprints: [],
			platform: {},
			tables: [selectorTable],
		};

		const result = await handlePatchTable(
			{
				rom: "/tmp/transformed.rom",
				table: "Selector Table",
				op: "add",
				value: 5,
				where:
					"(RPM (rpm) == 3000 && Load (g/rev) == 1.6) || (RPM (rpm) == 4000 && Load (g/rev) == 2)",
			},
			config,
		);

		expect(lastWrittenBytes).toEqual(Uint8Array.from([15, 20, 30, 45]));
		expect(result).toContain("cells_written: 2");
		expect(result).toContain("| Load (g/rev)\\RPM (rpm) | 3000 | 4000 |");
		expect(result).toContain("| 1.6                    | 15   | 20");
		expect(result).toContain("| 2                      | 30   | 45");
	});
});
