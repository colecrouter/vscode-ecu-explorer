import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import {
	ChartState,
	ROMView,
	type TableSnapshot,
	type ThemeColors,
} from "@ecu-explorer/ui";

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
	zoom?: number;
	pan?: { x: number; y: number };
	layer?: number;
};

export type GraphSelection = {
	row: number;
	col: number;
	depth?: number;
};

export type GraphInitMessage = {
	type: "init";
	snapshot: TableSnapshot;
	romBytes?: number[];
	tableDefinition?: TableDefinition;
	tableId: string;
	tableName: string;
	romPath: string;
	definitionUri?: string;
	preferredChartType?: "line" | "heatmap";
	themeColors?: ThemeColors;
};

export type GraphUpdateMessage = {
	type: "update";
	snapshot: TableSnapshot;
	romBytes?: number[];
	romPatch?: {
		offset: number;
		bytes: number[];
	};
	preferredChartType?: "line" | "heatmap";
};

export type GraphSelectCellMessage = {
	type: "selectCell";
	row: number;
	col: number;
};

export type GraphSelectCellsMessage = {
	type: "selectCells";
	selection: GraphSelection | GraphSelection[] | null;
};

export type GraphThemeChangedMessage = {
	type: "themeChanged";
	themeColors: ThemeColors;
};

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
	private romView: ROMView | null = null;

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
		this.romView =
			message.romBytes && message.tableDefinition
				? createGraphRomView(
						this.definitionUri,
						message.tableName,
						message.tableDefinition,
						message.romBytes,
					)
				: null;

		if (message.preferredChartType) {
			this.chartState.setChartType(message.preferredChartType);
		}
		if (message.themeColors) {
			this.themeColorsState = message.themeColors;
		}

		this.isReadyState = true;
	}

	private handleUpdate(message: GraphUpdateMessage): void {
		this.snapshotState = message.snapshot;

		if (this.romView && message.romPatch) {
			this.romView.patchBytes(
				message.romPatch.offset,
				Uint8Array.from(message.romPatch.bytes),
			);
		} else if (this.romView && message.romBytes) {
			this.romView.replaceBytes(Uint8Array.from(message.romBytes));
		}

		if (message.preferredChartType) {
			this.chartState.setChartType(message.preferredChartType);
		}
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

function createGraphRomView(
	definitionUri: string,
	name: string,
	tableDefinition: TableDefinition,
	romBytes: number[],
): ROMView {
	const definition: ROMDefinition = {
		uri: definitionUri || `graph://${tableDefinition.id}`,
		name,
		fingerprints: [],
		platform: {},
		tables: [tableDefinition],
	};

	return new ROMView(Uint8Array.from(romBytes), definition);
}
