import type { ROMDefinition, Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import type { PatchTableOptions } from "./patch-table.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePatchTable } from "./patch-table.js";
import type { McpConfig } from "../config.js";

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

		definition = {
			uri: "file:///tmp/transformed.xml",
			name: "Transform Definition",
			fingerprints: [],
			platform: {},
			tables: [
				{
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
				} as Table1DDefinition,
				{
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
				} as Table2DDefinition,
			],
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
});
