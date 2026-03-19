/**
 * GraphPanelManager - Manages graph webview panels for ROM tables
 *
 * Responsibilities:
 * - Create and track graph panels per ROM + table
 * - Broadcast snapshot updates to relevant panels
 * - Synchronize cell selection between graph and table
 * - Handle panel lifecycle and cleanup
 *
 * Panel Tracking Structure:
 * - Nested Maps: ROM path → table ID → panel
 * - Reverse lookup: panel → context (romPath, tableId, tableName)
 */

import type { TableSnapshot } from "@ecu-explorer/ui";
import * as vscode from "vscode";
import type {
	TableEditSession,
	TableSessionUpdateMessage,
} from "./history/table-edit-session.js";
import type { RomDocument } from "./rom/document.js";
import type {
	TableSessionInitMessage,
	TableSessionUpdateMessage as TableSessionProtocolUpdateMessage,
	TableSessionSelectCellsMessage,
	TableSessionThemeMessage,
} from "./table-session-protocol.js";
import { getThemeColors, type ThemeColors } from "./theme-colors.js";

/**
 * Message from graph webview
 */
type WebviewMessage =
	| { type: "ready" }
	| { type: "cellSelect"; row: number; col: number }
	| { type: "selectionChange"; selection: { row: number; col: number } | null };

/**
 * Context information for a graph panel
 */
interface PanelContext {
	romPath: string;
	tableId: string;
	tableName: string;
	definitionUri?: string;
	snapshot?: TableSnapshot;
	disposables: vscode.Disposable[];
	documentSubscription?: vscode.Disposable;
	subscribedDocument?: RomDocument;
	sessionSubscription?: () => void;
	subscribedSessionId?: string;
	tableUri?: string;
}

interface PersistedGraphPanelState {
	romPath: string;
	tableId: string;
	tableName: string;
	definitionUri?: string;
}

const GRAPH_PANEL_STATE_KEY = "ecuExplorer.graphPanelStates";

function normalizePersistedGraphState(
	state: unknown,
): PersistedGraphPanelState | undefined {
	if (!state || typeof state !== "object") {
		return undefined;
	}

	const candidate = state as Partial<
		Record<keyof PersistedGraphPanelState, unknown>
	>;
	if (
		typeof candidate.romPath === "string" &&
		candidate.romPath.length > 0 &&
		typeof candidate.tableId === "string" &&
		candidate.tableId.length > 0 &&
		typeof candidate.tableName === "string" &&
		candidate.tableName.length > 0
	) {
		const state: PersistedGraphPanelState = {
			romPath: candidate.romPath,
			tableId: candidate.tableId,
			tableName: candidate.tableName,
		};

		if (typeof candidate.definitionUri === "string") {
			state.definitionUri = candidate.definitionUri;
		}

		return state;
	}

	return undefined;
}

function makeGraphPanelStateId(state: PersistedGraphPanelState): string {
	return `${state.romPath}::${state.tableId}`;
}

/**
 * Manages lifecycle and state of graph webview panels
 */
export class GraphPanelManager {
	// Panel registry: ROM path → table ID → panel
	private panels = new Map<string, Map<string, vscode.WebviewPanel>>();

	// Reverse lookup: panel → context
	private panelContext = new Map<vscode.WebviewPanel, PanelContext>();

	constructor(
		private context: vscode.ExtensionContext,
		private getDocument: (romPath: string) => RomDocument | undefined,
		private getSnapshot?: (
			romPath: string,
			tableId: string,
		) => TableSnapshot | undefined,
		private onCellSelect?: (
			romPath: string,
			tableId: string,
			row: number,
			col: number,
		) => void,
		public onSelectionChange?: (
			romPath: string,
			tableId: string,
			selection: { row: number; col: number } | null,
		) => void,
		private getTableSession?: (
			romPath: string,
			tableId: string,
		) => TableEditSession | undefined,
	) {}

	/**
	 * Handle selection change from external source (e.g. table editor)
	 */
	handleExternalSelectionChange(
		romPath: string,
		tableId: string,
		selection: { row: number; col: number } | null,
	) {
		const panel = this.panels.get(romPath)?.get(tableId);
		if (panel) {
			const message: TableSessionSelectCellsMessage = {
				type: "selectCells",
				selection,
			};
			panel.webview.postMessage(message);
		}
	}

	/**
	 * Get or create a graph panel for a ROM table
	 *
	 * If a panel already exists for this ROM + table, reveal it.
	 * Otherwise, create a new panel.
	 *
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 * @param tableName - Human-readable table name
	 * @param snapshot - Initial table snapshot
	 * @returns Webview panel
	 */
	getOrCreatePanel(
		romPath: string,
		tableId: string,
		tableName: string,
		snapshot: TableSnapshot,
		definitionUri?: string,
	): vscode.WebviewPanel {
		// Check if panel already exists
		const existing = this.panels.get(romPath)?.get(tableId);
		if (existing) {
			existing.reveal();

			const context = this.panelContext.get(existing);
			if (context) {
				if (definitionUri !== undefined) {
					context.definitionUri = definitionUri;
				}
			}

			existing.webview.postMessage({
				type: "update",
				snapshot,
			});
			return existing;
		}

		// Create new panel
		const panel = vscode.window.createWebviewPanel(
			"ecuExplorerGraph",
			`Graph: ${tableName}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist"),
				],
			},
		);

		// Set HTML content
		panel.webview.html = this.getWebviewContent(panel.webview);

		// Track panel with snapshot
		this.trackPanel(
			panel,
			romPath,
			tableId,
			tableName,
			snapshot,
			definitionUri,
		);

		// Set up message handler
		panel.webview.onDidReceiveMessage(
			(message) => this.handleMessage(panel, message),
			undefined,
			this.context.subscriptions,
		);

		// Clean up on dispose
		panel.onDidDispose(
			() => this.disposePanel(panel),
			undefined,
			this.context.subscriptions,
		);

		return panel;
	}

	/**
	 * Register a restored panel (called by GraphPanelSerializer)
	 *
	 * Used when deserializing panels after VSCode reload.
	 * Tracks the panel and sets up message handlers.
	 *
	 * @param panel - Restored webview panel
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 * @param tableName - Human-readable table name
	 */
	registerRestoredPanel(
		panel: vscode.WebviewPanel,
		romPath: string,
		tableId: string,
		tableName: string,
		definitionUri?: string,
	): void {
		console.log(
			`[GraphPanelManager] Registering restored panel: ROM=${romPath}, table=${tableId}`,
		);

		// Track panel
		this.trackPanel(
			panel,
			romPath,
			tableId,
			tableName,
			undefined,
			definitionUri,
		);

		// Set up message handler
		panel.webview.onDidReceiveMessage(
			(message) => this.handleMessage(panel, message),
			undefined,
			this.context.subscriptions,
		);

		// Clean up on dispose
		panel.onDidDispose(
			() => this.disposePanel(panel),
			undefined,
			this.context.subscriptions,
		);
	}

	/**
	 * Broadcast snapshot update to all panels for a ROM + table
	 *
	 * Called when table data changes (cell edit, undo, redo, etc.)
	 *
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 * @param snapshot - Updated table snapshot
	 */
	broadcastSnapshot(
		romPath: string,
		tableId: string,
		snapshot: TableSnapshot,
	): void {
		const panel = this.panels.get(romPath)?.get(tableId);
		if (panel) {
			panel.webview.postMessage({
				type: "update",
				snapshot,
			});
		}
	}

	/**
	 * Send cell selection to graph panel
	 *
	 * Called when user selects a cell in table editor
	 *
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 * @param row - Row index
	 * @param col - Column index
	 */
	selectCell(romPath: string, tableId: string, row: number, col: number): void {
		const panel = this.panels.get(romPath)?.get(tableId);
		if (panel) {
			panel.webview.postMessage({
				type: "selectCell",
				row,
				col,
			});
		}
	}

	/**
	 * Broadcast theme color changes to all graph panels
	 *
	 * Called when VSCode theme changes
	 *
	 * @param themeColors - Updated theme colors
	 */
	broadcastThemeColors(themeColors: ThemeColors): void {
		for (const romPanels of this.panels.values()) {
			for (const panel of romPanels.values()) {
				const payload: TableSessionThemeMessage = {
					type: "themeChanged",
					themeColors,
				};
				panel.webview.postMessage(payload);
			}
		}
	}

	/**
	 * Get a panel for a ROM + table
	 *
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 * @returns Webview panel or undefined if not found
	 */
	getPanel(romPath: string, tableId: string): vscode.WebviewPanel | undefined {
		return this.panels.get(romPath)?.get(tableId);
	}

	/**
	 * Close a graph panel
	 *
	 * @param romPath - Path to ROM file
	 * @param tableId - Table identifier
	 */
	closeGraph(romPath: string, tableId: string): void {
		const panel = this.panels.get(romPath)?.get(tableId);
		if (panel) {
			panel.dispose();
		}
	}

	/**
	 * Dispose all panels and clean up resources
	 */
	dispose(): void {
		// Dispose all panels
		for (const romPanels of this.panels.values()) {
			for (const panel of romPanels.values()) {
				panel.dispose();
			}
		}

		// Clear maps
		this.panels.clear();
		this.panelContext.clear();
	}

	/**
	 * Rebind all graph panels for a ROM to the latest RomDocument instance.
	 *
	 * This is primarily used during restore/reload flows where a panel may be
	 * restored before the final RomDocument instance has been opened.
	 */
	handleRomDocumentOpened(document: RomDocument): void {
		const romPath = document.uri.fsPath;
		const romPanels = this.panels.get(romPath);
		if (!romPanels) {
			return;
		}

		for (const panel of romPanels.values()) {
			const context = this.panelContext.get(panel);
			if (context) {
				this.attachDocumentSubscription(panel, context);
			}
		}
	}

	consumePersistedState(): PersistedGraphPanelState | undefined {
		const states = this.readPersistedStates();
		if (states.length === 0) {
			return undefined;
		}

		const [first, ...rest] = states;
		this.context.workspaceState
			.update(GRAPH_PANEL_STATE_KEY, rest)
			.then(() => {});
		return first;
	}

	handleTableSessionAvailable(session: TableEditSession): void {
		const romPath = session.romDocument.uri.fsPath;
		const romPanels = this.panels.get(romPath);
		if (!romPanels) {
			return;
		}

		for (const panel of romPanels.values()) {
			const context = this.panelContext.get(panel);
			if (!context || context.tableId !== session.tableDef.id) {
				continue;
			}
			this.attachTableSessionSubscription(panel, context);
		}
	}

	/**
	 * Handle message from graph panel
	 */
	private handleMessage(
		panel: vscode.WebviewPanel,
		message: WebviewMessage,
	): void {
		const context = this.panelContext.get(panel);
		if (!context) return;

		switch (message.type) {
			case "ready":
				// Send initial snapshot
				this.sendInitialSnapshot(panel, context);
				break;

			case "cellSelect":
				// Forward to table editor
				this.forwardCellSelection(
					context.romPath,
					context.tableId,
					message.row,
					message.col,
				);
				break;

			case "selectionChange":
				// Forward to selection manager
				if (this.onSelectionChange) {
					this.onSelectionChange(
						context.romPath,
						context.tableId,
						message.selection,
					);
				}
				break;
		}
	}

	/**
	 * Send initial snapshot to graph panel
	 */
	private sendInitialSnapshot(
		panel: vscode.WebviewPanel,
		context: PanelContext,
	): void {
		console.log(
			`[GraphPanelManager] Sending initial snapshot for table: ${context.tableName}`,
		);

		// Restored panels can outlive document instances across reload/order changes.
		// Re-attach to the current RomDocument whenever the panel initializes.
		this.attachDocumentSubscription(panel, context);
		this.attachTableSessionSubscription(panel, context);

		// Restored panels do not carry an in-memory snapshot, so rebuild it on demand.
		if (!context.snapshot && this.getSnapshot) {
			const snapshot = this.getSnapshot(context.romPath, context.tableId);
			if (snapshot) {
				context.snapshot = snapshot;
			}
		}

		if (!context.snapshot) {
			console.error(
				`[GraphPanelManager] No snapshot available for table: ${context.tableName}`,
			);
			return;
		}

		const themeColors = getThemeColors();
		const payload: TableSessionInitMessage = {
			type: "init",
			snapshot: context.snapshot,
			tableId: context.tableId,
			tableName: context.tableName,
			romPath: context.romPath,
			...(context.definitionUri
				? { definitionUri: context.definitionUri }
				: {}),
			themeColors,
		};
		panel.webview.postMessage(payload);

		console.log(
			`[GraphPanelManager] Initial snapshot sent for table: ${context.tableName}`,
		);
	}

	/**
	 * Forward cell selection from graph to table editor
	 */
	private forwardCellSelection(
		romPath: string,
		tableId: string,
		row: number,
		col: number,
	): void {
		console.log(
			`[GraphPanelManager] Cell selection: ROM=${romPath}, table=${tableId}, row=${row}, col=${col}`,
		);

		// Call the callback if provided
		if (this.onCellSelect) {
			this.onCellSelect(romPath, tableId, row, col);
		}
	}

	/**
	 * Track a panel in the registry
	 */
	private trackPanel(
		panel: vscode.WebviewPanel,
		romPath: string,
		tableId: string,
		tableName: string,
		snapshot?: TableSnapshot,
		definitionUri?: string,
	): void {
		let romPanels = this.panels.get(romPath);
		if (!romPanels) {
			romPanels = new Map();
			this.panels.set(romPath, romPanels);
		}
		romPanels.set(tableId, panel);

		this.panelContext.set(panel, {
			romPath,
			tableId,
			tableName,
			...(definitionUri ? { definitionUri } : {}),
			...(snapshot !== undefined && { snapshot }),
			tableUri: createTableUri(
				romPath,
				tableId,
				tableName,
				definitionUri,
			).toString(),
			disposables: [],
		});

		this.upsertPersistedState({
			romPath,
			tableId,
			tableName,
			...(definitionUri ? { definitionUri } : {}),
		});

		const context = this.panelContext.get(panel);
		if (context) {
			this.attachDocumentSubscription(panel, context);
			this.attachTableSessionSubscription(panel, context);
		}
	}

	private readPersistedStates(): PersistedGraphPanelState[] {
		const states = this.context.workspaceState.get<unknown[]>(
			GRAPH_PANEL_STATE_KEY,
		);
		if (!Array.isArray(states)) {
			return [];
		}

		const normalized = states
			.map((state) => normalizePersistedGraphState(state))
			.filter((state): state is PersistedGraphPanelState => Boolean(state));

		return normalized;
	}

	private upsertPersistedState(state: PersistedGraphPanelState): void {
		const states = this.readPersistedStates();
		const id = makeGraphPanelStateId(state);
		const filtered = states.filter(
			(entry) => makeGraphPanelStateId(entry) !== id,
		);
		filtered.unshift(state);
		this.context.workspaceState
			.update(GRAPH_PANEL_STATE_KEY, filtered.slice(0, 20))
			.then(() => {});
	}

	private removePersistedState(state: {
		romPath: string;
		tableId: string;
	}): void {
		const states = this.readPersistedStates();
		const id = `${state.romPath}::${state.tableId}`;
		const filtered = states.filter(
			(entry) => makeGraphPanelStateId(entry) !== id,
		);
		if (filtered.length !== states.length) {
			this.context.workspaceState
				.update(GRAPH_PANEL_STATE_KEY, filtered)
				.then(() => {});
		}
	}

	private attachTableSessionSubscription(
		panel: vscode.WebviewPanel,
		context: PanelContext,
	): void {
		const session = this.getTableSession?.(context.romPath, context.tableId);
		if (!session || context.subscribedSessionId === session.id) {
			return;
		}

		context.sessionSubscription?.();
		context.subscribedSessionId = session.id;
		context.tableUri = session.tableUri.toString();
		context.sessionSubscription = session.onDidUpdate((message) => {
			this.applySessionUpdate(panel, context, session, message);
		});
	}

	private attachDocumentSubscription(
		_panel: vscode.WebviewPanel,
		context: PanelContext,
	): void {
		const doc = this.getDocument(context.romPath);
		if (!doc) {
			return;
		}

		if (context.subscribedDocument === doc) {
			return;
		}

		context.documentSubscription?.dispose();
		context.subscribedDocument = doc;
		context.documentSubscription = doc.onDidUpdateBytes((_event) => {
			const panel = this.panels.get(context.romPath)?.get(context.tableId);
			if (!panel) {
				return;
			}

			if (context.subscribedSessionId) {
				return;
			}

			// ROM bytes changed — get a fresh snapshot and broadcast to the graph panel
			if (this.getSnapshot) {
				const newSnapshot = this.getSnapshot(context.romPath, context.tableId);
				if (newSnapshot) {
					context.snapshot = newSnapshot;
					const message: TableSessionProtocolUpdateMessage = {
						type: "update",
						snapshot: newSnapshot,
					};
					panel.webview.postMessage(message);
				}
			}
		});
	}

	private applySessionUpdate(
		panel: vscode.WebviewPanel,
		context: PanelContext,
		_session: TableEditSession,
		message: TableSessionUpdateMessage,
	): void {
		context.snapshot = message.snapshot;
		const payload: TableSessionProtocolUpdateMessage = {
			type: "update",
			snapshot: message.snapshot,
		};
		panel.webview.postMessage(payload);
	}

	/**
	 * Clean up disposed panel
	 */
	private disposePanel(panel: vscode.WebviewPanel): void {
		const context = this.panelContext.get(panel);
		if (context) {
			context.sessionSubscription?.();
			context.documentSubscription?.dispose();
			// Dispose all subscriptions
			for (const d of context.disposables) {
				d.dispose();
			}
			this.panels.get(context.romPath)?.delete(context.tableId);
			this.panelContext.delete(panel);
			this.removePersistedState(context);
		}
	}

	/**
	 * Get webview HTML content
	 */
	private getWebviewContent(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.context.extensionUri,
				"dist",
				"webview",
				"chart.js",
			),
		);

		// Note: CSS will be bundled with the JS by Vite
		// If we need separate CSS, we can add it here

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
	<title>Graph Viewer</title>
</head>
<body>
	<div id="app"></div>
	<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function createTableUri(
	romPath: string,
	tableId: string,
	tableName: string,
	definitionUri?: string,
): vscode.Uri {
	const params = new URLSearchParams({ table: tableId });
	if (tableName) {
		params.set("name", tableName);
	}
	if (definitionUri) {
		params.set("definition", definitionUri);
	}

	const uriPath = vscode.Uri.file(romPath).path;
	const displayPath = `${uriPath}/${encodeURIComponent(tableName)}`;
	return vscode.Uri.parse(`ecu-table://${displayPath}?${params.toString()}`);
}
