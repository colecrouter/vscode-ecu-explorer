import type { TableDefinition } from "@ecu-explorer/core";
import type { TableSnapshot, ThemeColors } from "@ecu-explorer/ui";

export type TableSessionSelection = {
	row: number;
	col: number;
	depth?: number;
};

export type TableSessionSelectionPayload =
	| TableSessionSelection
	| TableSessionSelection[]
	| null;

export type TableSessionInitMessage = {
	type: "init";
	tableId: string;
	tableName: string;
	romPath: string;
	snapshot: TableSnapshot;
	// Optional table-facing fields (may be omitted for graph surface consumers).
	definition?: TableDefinition;
	rom?: number[] | Uint8Array;
	definitionUri?: string;
	themeColors?: ThemeColors;
};

export type TableSessionUpdateMessage = {
	type: "update";
	snapshot: TableSnapshot;
	reason?: "undo" | "redo" | "sync" | "external";
	rom?: number[] | Uint8Array;
};

export type TableSessionThemeMessage = {
	type: "themeChanged";
	themeColors: ThemeColors;
};

export type TableSessionSelectCellsMessage = {
	type: "selectCells";
	selection: TableSessionSelectionPayload;
};

export type TableSessionHostMessage =
	| TableSessionInitMessage
	| TableSessionUpdateMessage
	| TableSessionThemeMessage
	| TableSessionSelectCellsMessage;
