import {
	ChartState,
	type TableSnapshot,
	type ThemeColors,
} from "@ecu-explorer/ui";
import type {
	TableSessionInitMessage,
	TableSessionSelectCellsMessage,
	TableSessionSelection,
	TableSessionThemeMessage,
	TableSessionUpdateMessage,
} from "../table-session-protocol.js";

export interface GraphWebviewApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

export type PersistedGraphPanelState = {
	romPath: string;
	tableId: string;
	tableName: string;
	definitionUri?: string;
};

export type GraphSelection = TableSessionSelection;

export type GraphInitMessage = TableSessionInitMessage;

export type GraphUpdateMessage = TableSessionUpdateMessage;

export type GraphSelectCellMessage = {
	type: "selectCell";
	row: number;
	col: number;
};

export type GraphSelectCellsMessage = TableSessionSelectCellsMessage;

export type GraphThemeChangedMessage = TableSessionThemeMessage;

export type GraphHostMessage =
	| GraphInitMessage
	| GraphUpdateMessage
	| GraphSelectCellMessage
	| GraphSelectCellsMessage
	| GraphThemeChangedMessage;

export interface GraphSessionViewModel {
	tableId: string;
	tableName: string;
	romPath: string;
	definitionUri: string;
	isReady: boolean;
	themeColors?: ThemeColors;
	snapshot: TableSnapshot | null;
	hasData: boolean;
}

export class GraphSessionController {
	readonly chartState = new ChartState();

	private tableIdState = "";
	private tableNameState = "";
	private romPathState = "";
	private definitionUriState = "";
	private isReadyState = false;
	private themeColorsState: ThemeColors | undefined;

	private snapshotState: TableSnapshot | null = null;

	constructor(
		private readonly host: GraphWebviewApi,
		persistedState?: PersistedGraphPanelState,
	) {
		if (persistedState) {
			this.applyPersistedState(persistedState);
		}
	}

	get snapshot(): TableSnapshot | null {
		return this.snapshotState;
	}

	get tableId(): string {
		return this.tableIdState;
	}

	get tableName(): string {
		return this.tableNameState;
	}

	get romPath(): string {
		return this.romPathState;
	}

	get definitionUri(): string {
		return this.definitionUriState;
	}

	get isReady(): boolean {
		return this.isReadyState;
	}

	get themeColors(): ThemeColors | undefined {
		return this.themeColorsState;
	}

	get hasData(): boolean {
		return this.snapshot !== null;
	}

	getViewModel(): GraphSessionViewModel {
		const snapshot = this.snapshot;
		return {
			tableId: this.tableId,
			tableName: this.tableName,
			romPath: this.romPath,
			definitionUri: this.definitionUri,
			isReady: this.isReady,
			...(this.themeColors ? { themeColors: this.themeColors } : {}),
			snapshot,
			hasData: snapshot !== null,
		};
	}

	handleHostMessage(message: GraphHostMessage): void {
		switch (message.type) {
			case "init":
				this.handleInit(message);
				break;
			case "update":
				this.handleUpdate(message);
				break;
			case "selectCell":
				this.chartState.selectCell(message.row, message.col);
				break;
			case "selectCells":
				this.handleSelectCells(message.selection);
				break;
			case "themeChanged":
				this.themeColorsState = message.themeColors;
				break;
		}
	}

	handleChartCellSelect(row: number, col: number): void {
		this.host.postMessage({
			type: "cellSelect",
			row,
			col,
		});
	}

	signalReady(): void {
		this.host.postMessage({ type: "ready" });
	}

	syncSelectionChange(): void {
		if (!this.chartState.selectedCell) {
			return;
		}

		this.host.postMessage({
			type: "selectionChange",
			selection: [this.chartState.selectedCell],
		});
	}

	persistState(): void {
		if (!this.tableId || !this.tableName || !this.romPath) {
			return;
		}

		this.host.setState({
			romPath: this.romPath,
			tableId: this.tableId,
			tableName: this.tableName,
			...(this.definitionUri ? { definitionUri: this.definitionUri } : {}),
		} satisfies PersistedGraphPanelState);
	}

	private applyPersistedState(state: PersistedGraphPanelState): void {
		this.tableIdState = state.tableId ?? "";
		this.tableNameState = state.tableName ?? "";
		this.romPathState = state.romPath ?? "";
		this.definitionUriState = state.definitionUri ?? "";
	}

	private handleInit(message: GraphInitMessage): void {
		this.snapshotState = message.snapshot;
		this.tableIdState = message.tableId;
		this.tableNameState = message.tableName;
		this.romPathState = message.romPath;
		this.definitionUriState = message.definitionUri ?? "";
		if (message.themeColors) {
			this.themeColorsState = message.themeColors;
		}

		this.isReadyState = true;
	}

	private handleUpdate(message: GraphUpdateMessage): void {
		this.snapshotState = message.snapshot;
	}

	private handleSelectCells(
		selection: GraphSelection | GraphSelection[] | null,
	): void {
		const first = Array.isArray(selection) ? selection[0] : selection;
		if (!first) {
			this.chartState.clearSelection();
			return;
		}

		this.chartState.selectCell(first.row, first.col);
	}
}
