import type { ROMDefinition, Table2DDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleListTables } from "./list-tables.js";
import type { McpConfig } from "../config.js";

let definition: ROMDefinition;

const config: McpConfig = {
	definitionsPaths: [],
	logsDir: "/tmp",
};

vi.mock("../rom-loader.js", () => ({
	loadRom: vi.fn(async () => ({
		romPath: "/tmp/sample.hex",
		romBytes: new Uint8Array(16),
		definition,
		fileSizeBytes: 16,
		mtime: Date.now(),
	})),
}));

describe("handleListTables", () => {
	beforeEach(() => {
		definition = {
			uri: "file:///tmp/sample.xml",
			name: "Sample Definition",
			fingerprints: [],
			platform: {},
			tables: [
				{
					id: "ign",
					name: "High Octane Ignition",
					kind: "table2d",
					rows: 2,
					cols: 2,
					category: "Ignition",
					x: {
						id: "x-axis",
						kind: "static",
						name: "RPM (rpm)",
						values: [3000, 4000],
					},
					y: {
						id: "y-axis",
						kind: "static",
						name: "Load (g/rev)",
						values: [1.6, 2.0],
					},
					z: {
						id: "z",
						name: "values",
						address: 0,
						dtype: "u8",
						unit: "deg",
					},
				} as unknown as Table2DDefinition,
				{
					id: "fuel",
					name: "Primary Fuel",
					kind: "table2d",
					rows: 2,
					cols: 2,
					category: "Fuel",
					x: {
						id: "x-axis-2",
						kind: "static",
						name: "RPM (rpm)",
						values: [3000, 4000],
					},
					y: {
						id: "y-axis-2",
						kind: "static",
						name: "Load (g/rev)",
						values: [1.6, 2.0],
					},
					z: {
						id: "z2",
						name: "values",
						address: 4,
						dtype: "u8",
						unit: "ms",
					},
				} as unknown as Table2DDefinition,
			],
		};
	});

	it("includes axis names in the table listing", async () => {
		const result = await handleListTables("/tmp/sample.hex", config);

		expect(result).toContain("X Axis");
		expect(result).toContain("Y Axis");
		expect(result).toContain("RPM (rpm)");
		expect(result).toContain("Load (g/rev)");
	});

	it("supports metadata query and pagination", async () => {
		const result = await handleListTables(
			"/tmp/sample.hex",
			config,
			{ query: "ignition rpm", page: 1, pageSize: 1 },
		);

		expect(result).toContain("total_tables: 1");
		expect(result).toContain("page_size: 1");
		expect(result).toContain("High Octane Ignition");
		expect(result).not.toContain("Primary Fuel");
	});
});
