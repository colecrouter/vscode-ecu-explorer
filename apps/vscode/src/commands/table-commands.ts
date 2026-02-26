import type { DefinitionProvider, TableDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import { resolveRomDefinition } from "../rom/definition-resolver";
import { createTableUri } from "../table-fs-uri";
import type { WorkspaceState } from "../workspace-state";

/**
 * Registry for definition providers
 */
let registry: { list(): DefinitionProvider[] } | null = null;

/**
 * Workspace state manager
 */
let workspaceState: WorkspaceState | null = null;

/**
 * Set the registry and workspace state for command handlers
 */
export function setTableCommandsContext(
	_registry: { list(): DefinitionProvider[] },
	_workspaceState: WorkspaceState,
): void {
	registry = _registry;
	workspaceState = _workspaceState;
}

/**
 * Open a table in the custom editor
 *
 * Unified entry point for opening tables from various sources:
 * - Tree view item clicks
 * - Command palette
 * - Programmatic calls
 *
 * This function uses VSCode's Custom Editor infrastructure to:
 * 1. Ensure a ROM definition is resolved (from saved state or user prompt)
 * 2. Create a table URI for the specific table
 * 3. Open the table URI with romViewer.tableEditor
 * 4. VSCode automatically handles tab management (focus existing or create new)
 *
 * This function is self-sufficient — it does NOT require the ROM file to be
 * registered as a VSCode custom document (romViewer.editor). Instead, it
 * resolves the definition directly via resolveRomDefinition().
 *
 * @param romUri - URI of the ROM file to open
 * @param tableName - Name of the table to open (required)
 * @param _options - View column and focus options for the editor
 * @returns Promise that resolves when the custom editor is opened
 */
export async function openTableInCustomEditor(
	romUri: vscode.Uri,
	tableName: string,
	_options?: {
		viewColumn?: vscode.ViewColumn;
		preserveFocus?: boolean;
		preview?: boolean;
	},
): Promise<void> {
	// Check if definition is already saved in workspace state
	const savedDefUri = workspaceState?.getRomDefinition(romUri.fsPath);

	if (!savedDefUri) {
		// No saved definition — resolve it now (may prompt user)
		if (!workspaceState) {
			throw new Error("Workspace state not initialized");
		}
		if (!registry) {
			vscode.window.showWarningMessage("No definition providers available.");
			return;
		}
		const romBytes = new Uint8Array(await vscode.workspace.fs.readFile(romUri));
		const definition = await resolveRomDefinition(
			romUri,
			romBytes,
			registry,
			workspaceState,
		);
		if (!definition) {
			// User cancelled definition selection
			return;
		}
	}

	// Create table URI
	const tableUri = createTableUri(romUri.fsPath, tableName);
	console.log(
		"[DEBUG] openTableInCustomEditor - Created URI:",
		tableUri.toString(),
	);

	// Open the table with the custom editor
	// VSCode will automatically focus existing tab if this table is already open
	console.log(
		"[DEBUG] openTableInCustomEditor - viewType: romViewer.tableEditor",
	);
	await vscode.commands.executeCommand(
		"vscode.openWith",
		tableUri,
		"romViewer.tableEditor",
	);
}

/**
 * Handle table open flow
 *
 * Shows user a list of available tables from the active ROM
 * and opens the selected table using the unified Custom Editor infrastructure.
 *
 * @param _ctx - Extension context
 * @param activeRom - Active ROM instance
 */
export async function openTableFlow(
	_ctx: vscode.ExtensionContext,
	activeRom: {
		definition: { tables: TableDefinition[] };
		romUri: string;
	} | null,
): Promise<void> {
	if (!activeRom) {
		vscode.window.showWarningMessage("Open a ROM first.");
		return;
	}

	type TablePickItem = vscode.QuickPickItem & { def: TableDefinition };
	const items: TablePickItem[] = activeRom.definition.tables.map(
		(t: TableDefinition) => ({
			label: t.name,
			...(t.category ? { description: t.category } : {}),
			detail: t.kind,
			def: t,
		}),
	);

	const picked = await vscode.window.showQuickPick<TablePickItem>(items, {
		placeHolder: "Select a table",
	});
	if (!picked) return;

	// Use unified Custom Editor infrastructure (Phase 3)
	const romUri = vscode.Uri.parse(activeRom.romUri);
	await openTableInCustomEditor(romUri, picked.def.name);
}
