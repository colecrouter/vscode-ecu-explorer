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
import { handleReadTable } from "./read-table.js";

let definition: ROMDefinition;
let romBytes: Uint8Array;

const config = createMcpConfig();

vi.mock("../rom-loader.js", () => ({
	loadRom: vi.fn(async () => createRomLoaderResult(definition, romBytes)),
}));

describe("handleReadTable", () => {
	beforeEach(() => {
		romBytes = Uint8Array.from([10, 20, 30, 40]);
		const ignitionTable = {
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
			},
		} satisfies Table2DDefinition;
		definition = {
			uri: "file:///tmp/sample.xml",
			name: "Sample Definition",
			fingerprints: [],
			platform: {},
			tables: [ignitionTable],
		};
	});

	it("returns a selected slice when where is provided", async () => {
		const result = await handleReadTable(
			"/tmp/sample.hex",
			"High Octane Ignition",
			config,
			"RPM (rpm) == 4000 && Load (g/rev) == 2",
		);

		expect(result).toContain("selector_axes:");
		expect(result).toContain("RPM (rpm)");
		expect(result).toContain("Load (g/rev)");
		expect(result).toContain("| Load (g/rev)\\RPM (rpm) | 4000 |");
		expect(result).toContain("| 2                      | 40");
		expect(result).not.toContain("| 3000 | 4000 |");
	});

	it("returns helpful errors for unknown axis names in where expressions", async () => {
		await expect(
			handleReadTable(
				"/tmp/sample.hex",
				"High Octane Ignition",
				config,
				"Engine Speed >= 4000 && LoadValue == 2",
			),
		).rejects.toThrow(
			/Unknown axis name: Engine Speed, LoadValue\. Available axes: RPM \(rpm\), Load \(g\/rev\)/,
		);
	});

	it("returns nearest breakpoint suggestions when exact equality matches no cells", async () => {
		await expect(
			handleReadTable(
				"/tmp/sample.hex",
				"High Octane Ignition",
				config,
				"RPM (rpm) == 4100 && Load (g/rev) == 1.9",
			),
		).rejects.toThrow(
			/Table selector matched no cells\. Available axes: RPM \(rpm\), Load \(g\/rev\)\. RPM \(rpm\): nearest values are 4000, 3000 Load \(g\/rev\): nearest values are 2, 1.6/,
		);
	});

	it("uses ranked table suggestions when an exact table name is missing", async () => {
		await expect(
			handleReadTable("/tmp/sample.hex", "ignitoin rpm", config),
		).rejects.toThrow(/Did you mean: High Octane Ignition\?/);
	});

	it("adds an index column for 1D tables when axis values repeat", async () => {
		romBytes = Uint8Array.from([10, 20, 30]);
		const mafTable = {
			id: "maf",
			name: "MAF Scaling Horizontal",
			kind: "table1d",
			rows: 3,
			category: "Fuel",
			x: {
				id: "x-maf",
				kind: "static",
				name: "Volts",
				values: [0, 5, 5],
			},
			z: {
				id: "z-maf",
				name: "values",
				address: 0,
				dtype: "u8",
			},
		} satisfies Table1DDefinition;
		definition = {
			uri: "file:///tmp/sample.xml",
			name: "Sample Definition",
			fingerprints: [],
			platform: {},
			tables: [mafTable],
		};

		const result = await handleReadTable(
			"/tmp/sample.hex",
			"MAF Scaling Horizontal",
			config,
		);

		expect(result).toContain(
			"| Index | Volts () | MAF Scaling Horizontal () |",
		);
		expect(result).toContain("| 1     | 5");
		expect(result).toContain("| 2     | 5");
	});
});
