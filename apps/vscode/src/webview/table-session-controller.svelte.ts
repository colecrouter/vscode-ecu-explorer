import type { TableDefinition } from "@ecu-explorer/core";
import { type TableSnapshot, type ThemeColors } from "@ecu-explorer/ui";
import type {
	TableSessionHostMessage,
	TableSessionInitMessage,
	TableSessionSelection,
	TableSessionSelectionPayload,
	TableSessionUpdateMessage,
} from "../table-session-protocol.js";

export interface TableWebviewApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

export type TableSessionControllerInitMessage = TableSessionInitMessage;

export type TableSessionControllerUpdateMessage = TableSessionUpdateMessage;

export interface TableSessionViewModel {
	tableId: string;
	tableName: string;
	romPath: string;
	isReady: boolean;
	themeColors?: ThemeColors;
	snapshot: TableSnapshot | null;
	hasData: boolean;
	definition: TableDefinition | null;
}

export class TableSessionController {
	private tableIdState = "";
	private tableNameState = "";
	private romPathState = "";
	private isReadyState = false;
	private themeColorsState: ThemeColors | undefined;
	private snapshotState: TableSnapshot | null = null;
	private definitionState: TableDefinition | null = null;
	private romState: Uint8Array | null = null;

	constructor(private readonly host: TableWebviewApi) {}

	get tableId(): string {
		return this.tableIdState;
	}

	get tableName(): string {
		return this.tableNameState;
	}

	get romPath(): string {
		return this.romPathState;
	}

	get isReady(): boolean {
		return this.isReadyState;
	}

	get themeColors(): ThemeColors | undefined {
		return this.themeColorsState;
	}

	get snapshot(): TableSnapshot | null {
		return this.snapshotState;
	}

	get definition(): TableDefinition | null {
		return this.definitionState;
	}

	get rom(): Uint8Array | null {
		return this.romState;
	}

	get hasData(): boolean {
		return this.snapshot !== null;
	}

	getViewModel(): TableSessionViewModel {
		const snapshot = this.snapshot;
		return {
			tableId: this.tableId,
			tableName: this.tableName,
			romPath: this.romPath,
			isReady: this.isReady,
			snapshot,
			hasData: snapshot !== null,
			...(this.themeColors ? { themeColors: this.themeColors } : {}),
			definition: this.definition,
		};
	}

	handleHostMessage(message: TableSessionHostMessage): void {
		switch (message.type) {
			case "init":
				this.handleInit(message);
				break;
			case "update":
				this.handleUpdate(message);
				break;
			case "themeChanged":
				this.themeColorsState = message.themeColors;
				break;
			case "selectCells":
				// no-op here: selection messages are consumed by the view layer
				break;
		}
	}

	handleCellSelectionChange(message: {
		selection: TableSessionSelectionPayload;
	}): void {
		this.host.postMessage({
			type: "selectionChange",
			selection: normalizeSelection(message.selection)[0] ?? null,
		});
	}

	normalizeSelection(
		selection: TableSessionSelectionPayload,
	): TableSessionSelection[] {
		if (!selection) {
			return [];
		}

		return Array.isArray(selection) ? selection : [selection];
	}

	signalReady(): void {
		this.host.postMessage({ type: "ready" });
	}

	private handleInit(message: TableSessionControllerInitMessage): void {
		this.snapshotState = message.snapshot;
		this.tableIdState = message.tableId;
		this.tableNameState = message.tableName;
		this.romPathState = message.romPath;
		this.definitionState = message.definition ?? null;
		if (message.themeColors) {
			this.themeColorsState = message.themeColors;
		}
		if (message.rom) {
			this.romState = new Uint8Array(message.rom);
		}
		this.isReadyState = true;
	}

	private handleUpdate(message: TableSessionControllerUpdateMessage): void {
		this.snapshotState = message.snapshot;

		if (message.rom) {
			this.romState = new Uint8Array(message.rom);
		}
	}
}

function normalizeSelection(
	selection: TableSessionSelectionPayload,
): TableSessionSelection[] {
	if (!selection) {
		return [];
	}

	return Array.isArray(selection) ? selection : [selection];
}
