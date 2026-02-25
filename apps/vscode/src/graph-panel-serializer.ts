/**
 * GraphPanelSerializer - Restores graph panels after VSCode reload
 *
 * Implements WebviewPanelSerializer to persist graph windows across
 * VSCode sessions. When VSCode reloads, this serializer:
 * 1. Extracts saved state (romPath, tableId, tableName)
 * 2. Loads the ROM document
 * 3. Gets the table definition and creates a snapshot
 * 4. Initializes the webview and sends init message
 * 5. Registers the restored panel with GraphPanelManager
 */

import * as vscode from "vscode";
import type { GraphPanelManager } from "./graph-panel-manager";
import type { RomEditorProvider } from "./rom/editor-provider";

/**
 * State saved by ChartViewerApp for persistence
 */
interface GraphPanelState {
	romPath: string;
	tableId: string;
	tableName: string;
	// Chart view state (optional)
	zoom?: number;
	pan?: { x: number; y: number };
	layer?: number;
}

/**
 * Serializer for graph webview panels
 */
export class GraphPanelSerializer implements vscode.WebviewPanelSerializer {
	constructor(
		private context: vscode.ExtensionContext,
		private romEditorProvider: RomEditorProvider,
		private graphPanelManager: GraphPanelManager,
	) {}

	/**
	 * Restore a graph panel after VSCode reload
	 *
	 * @param webviewPanel - The panel to restore
	 * @param state - Saved state from ChartViewerApp
	 */
	async deserializeWebviewPanel(
		webviewPanel: vscode.WebviewPanel,
		state: unknown,
	): Promise<void> {
		// Validate state
		if (!state || typeof state !== "object") {
			console.error("[GraphPanelSerializer] Invalid state:", state);
			vscode.window.showErrorMessage("Failed to restore graph: Invalid state");
			webviewPanel.dispose();
			return;
		}

		const panelState = state as GraphPanelState;
		const { romPath, tableId, tableName } = panelState;

		// Validate required fields
		if (!romPath || !tableId || !tableName) {
			console.error(
				"[GraphPanelSerializer] Missing required fields in state:",
				panelState,
			);
			vscode.window.showErrorMessage(
				"Failed to restore graph: Missing required state",
			);
			webviewPanel.dispose();
			return;
		}

		try {
			// Load ROM document
			const romUri = vscode.Uri.file(romPath);
			const document = this.romEditorProvider.getDocument(romUri);

			if (!document) {
				console.error(
					`[GraphPanelSerializer] ROM document not found: ${romPath}`,
				);
				vscode.window.showErrorMessage(
					`Failed to restore graph: ROM file not loaded (${romPath})`,
				);
				webviewPanel.dispose();
				return;
			}

			// Get ROM definition
			const definition = document.definition;
			if (!definition) {
				console.error(
					`[GraphPanelSerializer] No definition for ROM: ${romPath}`,
				);
				vscode.window.showErrorMessage(
					`Failed to restore graph: No ROM definition loaded`,
				);
				webviewPanel.dispose();
				return;
			}

			// Find table definition
			const tableDef = definition.tables.find((t) => t.name === tableId);
			if (!tableDef) {
				console.error(
					`[GraphPanelSerializer] Table not found: ${tableId} in ROM: ${romPath}`,
				);
				vscode.window.showErrorMessage(
					`Failed to restore graph: Table "${tableId}" not found in ROM`,
				);
				webviewPanel.dispose();
				return;
			}

			// Set up webview HTML
			webviewPanel.webview.options = {
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist"),
				],
			};

			webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

			// Register panel with GraphPanelManager
			// This will set up message handlers, and when the webview sends "ready",
			// GraphPanelManager will send the initial snapshot
			this.graphPanelManager.registerRestoredPanel(
				webviewPanel,
				romPath,
				tableId,
				tableName,
			);
		} catch (error) {
			console.error("[GraphPanelSerializer] Error restoring panel:", error);
			vscode.window.showErrorMessage(
				`Failed to restore graph: ${error instanceof Error ? error.message : String(error)}`,
			);
			webviewPanel.dispose();
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
