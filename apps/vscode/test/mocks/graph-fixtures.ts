import type { ROMDefinition, Table2DDefinition } from "@ecu-explorer/core";
import type { TableSnapshot } from "@ecu-explorer/ui";
import { vi } from "vitest";
import * as vscode from "vscode";
import { RomDocument } from "../../src/rom/document.js";

type Table2DSnapshot = Extract<TableSnapshot, { kind: "table2d" }>;

export const GRAPH_ROM_PATH = "/test/rom.hex";
export const GRAPH_ROM_PATH_1 = "/test/rom1.hex";
export const GRAPH_ROM_PATH_2 = "/test/rom2.hex";
export const GRAPH_TABLE_ID = "table1";
export const GRAPH_TABLE_NAME = "Test Table";
export const SECOND_GRAPH_TABLE_ID = "table2";
export const SECOND_GRAPH_TABLE_NAME = "Test Table 2";
export const FIRST_GRAPH_PANEL_NAME = "Test Table 1";
export const SECOND_GRAPH_PANEL_NAME = "Test Table 2";
export const GRAPH_DEFINITION_URI = "file:///test/definition.xml";
export const GRAPH_ROM_NAME = "Test ROM";
export const GRAPH_PANEL_TITLE = `Graph: ${GRAPH_TABLE_NAME}`;

export const PRIMARY_GRAPH_CASE = {
	romPath: GRAPH_ROM_PATH,
	tableId: GRAPH_TABLE_ID,
	tableName: GRAPH_TABLE_NAME,
} as const;

export const SECOND_GRAPH_CASE = {
	romPath: GRAPH_ROM_PATH,
	tableId: SECOND_GRAPH_TABLE_ID,
	tableName: SECOND_GRAPH_TABLE_NAME,
} as const;

export const FIRST_GRAPH_PANEL_CASE = {
	romPath: GRAPH_ROM_PATH,
	tableId: GRAPH_TABLE_ID,
	tableName: FIRST_GRAPH_PANEL_NAME,
} as const;

export const SECOND_GRAPH_PANEL_CASE = {
	romPath: GRAPH_ROM_PATH,
	tableId: SECOND_GRAPH_TABLE_ID,
	tableName: SECOND_GRAPH_PANEL_NAME,
} as const;

export const PRIMARY_GRAPH_ROM1_CASE = {
	romPath: GRAPH_ROM_PATH_1,
	tableId: GRAPH_TABLE_ID,
	tableName: GRAPH_TABLE_NAME,
} as const;

export const PRIMARY_GRAPH_ROM2_CASE = {
	romPath: GRAPH_ROM_PATH_2,
	tableId: GRAPH_TABLE_ID,
	tableName: GRAPH_TABLE_NAME,
} as const;

const GRAPH_TABLE_DEFINITION = {
	id: GRAPH_TABLE_ID,
	name: GRAPH_TABLE_NAME,
	kind: "table2d",
	rows: 2,
	cols: 2,
	z: {
		id: `${GRAPH_TABLE_ID}-z`,
		name: "z",
		address: 0x1000,
		dtype: "u8",
	},
} satisfies Table2DDefinition;

const GRAPH_ROM_DEFINITION = {
	uri: GRAPH_DEFINITION_URI,
	name: GRAPH_ROM_NAME,
	fingerprints: [],
	platform: { make: "Subaru" },
	tables: [GRAPH_TABLE_DEFINITION],
} satisfies ROMDefinition;

export function createGraphDefinition() {
	return {
		...GRAPH_ROM_DEFINITION,
		platform: { ...GRAPH_ROM_DEFINITION.platform },
		tables: GRAPH_ROM_DEFINITION.tables.map((table) => ({
			...table,
			z: { ...table.z },
		})),
	} satisfies ROMDefinition;
}

export function createGraphSnapshot(value: number = 10, tableName = GRAPH_TABLE_NAME) {
	return {
		kind: "table2d",
		name: tableName,
		description: "Test description",
		rows: 2,
		cols: 2,
		x: [0, 1],
		y: [0, 1],
		z: [
			[value, value + 10],
			[value + 20, value + 30],
		],
	} satisfies Table2DSnapshot;
}

export function createGraphDocument(romPath: string = GRAPH_ROM_PATH) {
	return {
		uri: vscode.Uri.file(romPath),
		onDidUpdateBytes: vi.fn(() => ({ dispose: vi.fn() })),
		definition: createGraphDefinition(),
	} satisfies Pick<RomDocument, "uri" | "onDidUpdateBytes" | "definition">;
}

export function createPersistedGraphDocument(
	romPath: string = GRAPH_ROM_PATH,
): RomDocument {
	return new RomDocument(vscode.Uri.file(romPath), new Uint8Array(1024), {
		...createGraphDefinition(),
		tables: createGraphDefinition().tables.map((table) => ({
			...table,
			z: {
				...table.z,
				endianness: "be",
			},
		})),
	});
}
