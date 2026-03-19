import {
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { GraphPanelManager } from "../graph-panel-manager.js";
import type { RomEditorProvider } from "../rom/editor-provider.js";
import type { RomTreeItem } from "../tree/rom-tree-item.js";

/**
 * Get references to extension state
 */
let getStateRefs:
	| (() => {
			graphPanelManager: GraphPanelManager | null;
			activeRom: RomInstance | null;
			activeTableName: string | null;
			activeTableDef: TableDefinition | null;
			activePanel: vscode.WebviewPanel | null;
			editorProvider: RomEditorProvider | null;
	  })
	| null = null;

/**
 * Set the state reference getter for graph commands
 */
export function setGraphCommandsContext(
	stateRefGetter: typeof getStateRefs extends null
		? never
		: typeof getStateRefs,
): void {
	getStateRefs = stateRefGetter;
}

/**
 * Helper to get state refs
 */
function getState() {
	if (!getStateRefs) {
		throw new Error("Graph commands context not initialized");
	}
	return getStateRefs();
}

/**
 * Handle open graph command
 * Opens a graph window for the currently active table
 */
export async function handleOpenGraph(
	_chartType?: "line" | "heatmap",
): Promise<void> {
	const state = getState();

	console.log(
		"[DEBUG] handleOpenGraph: graphPanelManager =",
		!!state.graphPanelManager,
	);

	if (!state.graphPanelManager) {
		vscode.window.showErrorMessage("Graph panel manager not initialized");
		return;
	}

	// Try to get active table from active custom editor
	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
	let rom: RomInstance | null = state.activeRom;
	let tableId: string | null = state.activeTableName;
	let tableName: string | null = state.activeTableDef?.name ?? null;
	let tableDef: TableDefinition | null = state.activeTableDef;
	let panel: vscode.WebviewPanel | null = state.activePanel;
	let definitionUri: string | undefined;

	if (activeTab?.input instanceof vscode.TabInputCustom) {
		const uri = activeTab.input.uri;
		const tableDoc = state.editorProvider?.getTableDocument(uri);
		if (tableDoc) {
			if (!tableDoc.romDocument.definition) {
				throw new Error(
					"Cannot open graph: ROM definition is missing for active table document",
				);
			}
			tableId = tableDoc.tableId;
			tableName = tableDoc.tableDef.name;
			tableDef = tableDoc.tableDef;
			definitionUri = tableDoc.romDocument.definition.uri;
			rom = {
				id: tableDoc.romDocument.uri.toString(),
				romUri: tableDoc.romDocument.uri.toString(),
				providerId: "",
				defUri: "",
				bytes: tableDoc.romDocument.romBytes,
				definition: tableDoc.romDocument.definition,
			};
			panel =
				state.editorProvider?.getPanelForDocument(tableDoc.romDocument) || null;
		}
	}

	if (!rom || !tableId || !tableName || !tableDef || !panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	try {
		// Get ROM path from active ROM
		const romPath = vscode.Uri.parse(rom.romUri).fsPath;

		// Get current snapshot
		const snapshot = snapshotTable(tableDef, rom.bytes);

		// Open or reveal graph panel
		state.graphPanelManager.getOrCreatePanel(
			romPath,
			tableId,
			tableName,
			snapshot,
			definitionUri,
		);
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to open graph: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Opens a graph window for a table specified by tree item or active table
 * This is the parameterized version that can be called from context menu or command palette
 */
export async function handleOpenGraphParameterized(
	treeItem: RomTreeItem | undefined,
	editorProvider: RomEditorProvider,
	_chartType?: "line" | "heatmap",
): Promise<void> {
	const state = getState();

	if (!state.graphPanelManager) {
		vscode.window.showErrorMessage("Graph panel manager not initialized");
		return;
	}

	// If called from context menu with tree item
	if (treeItem && treeItem.data.type === "table") {
		const tableData = treeItem.data;
		const romUri = vscode.Uri.parse(tableData.romUri);
		const tableDef = tableData.tableDef;
		const tableId = tableDef.id;
		const tableName = tableDef.name;

		try {
			// Get ROM document
			const document = editorProvider.getDocument(romUri);
			if (!document) {
				vscode.window.showErrorMessage(`ROM not loaded: ${romUri.fsPath}`);
				return;
			}

			if (!document.definition) {
				vscode.window.showErrorMessage("ROM definition not loaded");
				return;
			}

			// Get current snapshot
			const snapshot = snapshotTable(tableDef, document.romBytes);

			// Open or reveal graph panel
			state.graphPanelManager.getOrCreatePanel(
				romUri.fsPath,
				tableId,
				tableName,
				snapshot,
				document.definition.uri,
			);
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to open graph: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return;
	}

	// If called from command palette without arguments, fall back to active table
	await handleOpenGraph();
}

/**
 * Handle opening a table from the ECU Explorer tree
 * Called when user clicks on a table node or selects "Open Table" from context menu
 *
 * @param _ctx - Extension context
 * @param romUri - URI of the ROM file
 * @param tableName - Name of the table to open
 * @param openTableInCustomEditor - Function to open table in custom editor
 */
export async function handleOpenTableFromTree(
	_ctx: vscode.ExtensionContext,
	romUri: string,
	tableId: string,
	tableName: string | undefined,
	openTableInCustomEditor: (
		romUri: vscode.Uri,
		tableId: string,
		tableName?: string,
		options?: {
			viewColumn?: vscode.ViewColumn;
			preserveFocus?: boolean;
			preview?: boolean;
		},
	) => Promise<void>,
): Promise<void> {
	try {
		// Parse the ROM URI
		const uri = vscode.Uri.parse(romUri);

		// Use the unified openTableInCustomEditor function with preview mode
		// This makes the tab temporary until the user edits it
		await openTableInCustomEditor(uri, tableId, tableName, {
			preview: true,
		});
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to open table: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
