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
import type { RomDocument } from "./rom/document";
import { getThemeColors, type ThemeColors } from "./theme-colors";

/**
 * Context information for a graph panel
 */
interface PanelContext {
	romPath: string;
	tableId: string;
	tableName: string;
	snapshot?: TableSnapshot;
	preferredChartType?: "line" | "heatmap" | undefined;
	disposables: vscode.Disposable[];
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
			selection: any,
		) => void,
	) {}

	/**
	 * Handle selection change from external source (e.g. table editor)
	 */
	handleExternalSelectionChange(
		romPath: string,
		tableId: string,
		selection: any,
	) {
		const panel = this.panels.get(romPath)?.get(tableId);
		if (panel) {
			panel.webview.postMessage({
				type: "selectCells",
				selection,
			});
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
	 * @param preferredChartType - Optional preferred chart type ('line' | 'heatmap')
	 * @returns Webview panel
	 */
	getOrCreatePanel(
		romPath: string,
		tableId: string,
		tableName: string,
		snapshot: TableSnapshot,
		preferredChartType?: "line" | "heatmap",
	): vscode.WebviewPanel {
		// Check if panel already exists
		const existing = this.panels.get(romPath)?.get(tableId);
		if (existing) {
			existing.reveal();

			const context = this.panelContext.get(existing);
			if (context) {
				context.preferredChartType = preferredChartType;
			}

			// Send updated snapshot and preferred type to existing panel
			existing.webview.postMessage({
				type: "update",
				snapshot,
				preferredChartType,
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
			preferredChartType,
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
	): void {
		console.log(
			`[GraphPanelManager] Registering restored panel: ROM=${romPath}, table=${tableId}`,
		);

		// Track panel
		this.trackPanel(panel, romPath, tableId, tableName);

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
				panel.webview.postMessage({
					type: "themeChanged",
					themeColors,
				});
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
	 * Handle message from graph panel
	 */
	private handleMessage(panel: vscode.WebviewPanel, message: any): void {
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

		// Use the snapshot stored in context (set when panel was created)
		if (!context.snapshot) {
			console.error(
				`[GraphPanelManager] No snapshot available for table: ${context.tableName}`,
			);
			return;
		}

		const themeColors = getThemeColors();

		panel.webview.postMessage({
			type: "init",
			snapshot: context.snapshot,
			tableName: context.tableName,
			romPath: context.romPath,
			preferredChartType: context.preferredChartType,
			themeColors,
		});

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
		preferredChartType?: "line" | "heatmap",
	): void {
		let romPanels = this.panels.get(romPath);
		if (!romPanels) {
			romPanels = new Map();
			this.panels.set(romPath, romPanels);
		}
		romPanels.set(tableId, panel);

		const disposables: vscode.Disposable[] = [];

		// Subscribe to ROM document updates
		const doc = this.getDocument(romPath);
		if (doc) {
			disposables.push(
				doc.onDidUpdateBytes((_e) => {
					// ROM bytes changed — get a fresh snapshot and broadcast to the graph panel
					if (this.getSnapshot) {
						const newSnapshot = this.getSnapshot(romPath, tableId);
						if (newSnapshot) {
							const context = this.panelContext.get(panel);
							if (context) {
								context.snapshot = newSnapshot;
							}
							this.broadcastSnapshot(romPath, tableId, newSnapshot);
						}
					}
				}),
			);
		}

		this.panelContext.set(panel, {
			romPath,
			tableId,
			tableName,
			...(snapshot !== undefined && { snapshot }),
			preferredChartType,
			disposables,
		});
	}

	/**
	 * Clean up disposed panel
	 */
	private disposePanel(panel: vscode.WebviewPanel): void {
		const context = this.panelContext.get(panel);
		if (context) {
			// Dispose all subscriptions
			for (const d of context.disposables) {
				d.dispose();
			}
			this.panels.get(context.romPath)?.delete(context.tableId);
			this.panelContext.delete(panel);
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
