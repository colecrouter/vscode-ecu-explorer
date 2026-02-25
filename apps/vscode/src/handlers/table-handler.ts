import {
	calculateCellAddress,
	decodeScalarBytes,
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import type { RomExplorerTreeProvider } from "src/tree/rom-tree-provider";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document";
import { TableDocument } from "../table-document";
import { getThemeColors } from "../theme-colors";
import type { UndoRedoManager } from "../undo-redo-manager";
import { isBatchEdit } from "../undo-redo-manager";

/**
 * Get references to extension state
 */
let getStateRefs:
	| (() => {
			activeRom: RomInstance | null;
			activeTableName: string | null;
			activeTableDef: TableDefinition | null;
			activePanel: vscode.WebviewPanel | null;
			panelToDocument: Map<vscode.WebviewPanel, RomDocument>;
			undoRedoManagers: Map<string, UndoRedoManager>;
			treeProvider: RomExplorerTreeProvider | null;
			getRomDocumentForPanel: (
				panel: vscode.WebviewPanel,
			) => RomDocument | undefined;
			getRomDocumentForPanelRef: (
				panel: vscode.WebviewPanel,
			) => RomDocument | undefined;
			setupTableWebview: (
				panel: vscode.WebviewPanel,
				extensionUri: vscode.Uri,
			) => Promise<void>;
			registerPanel: (
				panel: vscode.WebviewPanel,
				document: RomDocument,
				disposables: vscode.Disposable[],
			) => void;
			handleCellEdit: (
				msg: any,
				def: TableDefinition,
				panel: vscode.WebviewPanel,
			) => void;
			handleUndo: () => void;
			handleRedo: () => void;
			exportActiveTableCsvFlow: (ctx: vscode.ExtensionContext) => Promise<void>;
			importTableFromCsvFlow: (ctx: vscode.ExtensionContext) => Promise<void>;
			openTableInCustomEditor: (
				romUri: vscode.Uri,
				tableName: string,
			) => Promise<void>;
	  })
	| null = null;

/**
 * Set the state reference getter for table handlers
 */
export function setTableHandlerContext(
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
		throw new Error("Table handler context not initialized");
	}
	return getStateRefs();
}

/**
 * Get RomDocument for a webview panel
 *
 * Retrieves the RomDocument instance associated with a given webview panel.
 * Used for dirty state tracking and document operations.
 *
 * @param panel - The webview panel to look up
 * @returns The associated RomDocument, or undefined if not found
 */
export function getRomDocumentForPanel(
	panel: vscode.WebviewPanel,
): RomDocument | undefined {
	const state = getState();
	return state.getRomDocumentForPanel(panel);
}

/**
 * Register a webview panel with its associated RomDocument
 *
 * This helper function centralizes panel registration logic:
 * - Maps the panel to its RomDocument for dirty state tracking
 * - Sets up automatic cleanup when the panel is disposed
 * - Adds the dispose handler to the extension's subscriptions
 *
 * This ensures consistent panel lifecycle management across all table views.
 *
 * @param panel - The webview panel to register
 * @param document - The RomDocument associated with this panel
 * @param disposables - Array to track disposables for cleanup
 */
export function registerPanel(
	panel: vscode.WebviewPanel,
	document: RomDocument,
	disposables: vscode.Disposable[],
): void {
	const state = getState();
	state.registerPanel(panel, document, disposables);
}

/**
 * Configure webview options and set HTML content
 *
 * Common setup for table webviews that:
 * - Enables JavaScript execution in the webview
 * - Configures local resource roots for loading bundled assets
 * - Sets the HTML content using the table viewer template
 *
 * This centralizes webview configuration to ensure consistency
 * across all table views.
 *
 * @param panel - The webview panel to configure
 * @param extensionUri - Extension URI for loading resources from dist/webview
 * @returns Promise that resolves when HTML is set
 */
export async function setupTableWebview(
	panel: vscode.WebviewPanel,
	extensionUri: vscode.Uri,
): Promise<void> {
	// Set webview options
	panel.webview.options = {
		enableScripts: true,
		localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview")],
	};

	// Set the HTML content to load the Svelte app
	panel.webview.html = await renderTableHtml(panel.webview, extensionUri);
}

/**
 * Callback for RomEditorProvider to handle table selection and webview setup
 *
 * This is the core callback invoked when a ROM file or table is opened via the Custom Editor.
 * It handles the complete table opening workflow:
 *
 * 1. Registers the panel with its RomDocument for dirty state tracking
 * 2. Checks if a ROM definition was successfully matched
 * 3. If opening a RomDocument directly, prompts user to select a table
 * 4. If opening a TableDocument, uses the pre-selected table
 * 5. Sets up the webview with the selected table's data
 * 6. Configures message handlers for table editing, undo/redo, and graph visualization
 *
 * @param document - The RomDocument or TableDocument containing ROM data and definition
 * @param panel - The webview panel to configure for table display
 * @param ctx - Extension context for accessing resources and subscriptions
 * @returns Promise that resolves when table is loaded and webview is configured
 */
export async function handleTableOpen(
	document: RomDocument | TableDocument,
	panel: vscode.WebviewPanel,
	ctx: vscode.ExtensionContext,
): Promise<void> {
	const state = getState();

	// Set up local state tracker (only activeRom is needed for math operations)
	let activeRom: RomInstance | null = null;

	// Determine if this is a TableDocument or RomDocument
	const isTableDocument = document instanceof TableDocument;
	const romDocument = isTableDocument ? document.romDocument : document;

	// Track the document for this panel using helper
	registerPanel(panel, romDocument, ctx.subscriptions);

	// Show table selection
	const definition = romDocument.definition;
	if (!definition) {
		// No definition was selected - show helpful message
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(ctx.extensionUri, "dist", "webview"),
			],
		};
		panel.webview.html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>No ROM Definition</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
		}
		h1 {
			color: var(--vscode-errorForeground);
		}
		p {
			margin: 10px 0;
		}
		.info {
			background: var(--vscode-textBlockQuote-background);
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			padding: 10px;
			margin: 20px 0;
		}
	</style>
</head>
<body>
	<h1>No ROM Definition Selected</h1>
	<p>No definition was found or selected for this ROM file.</p>
	<div class="info">
		<p><strong>To use this ROM:</strong></p>
		<ul>
			<li>Close this editor</li>
			<li>Use "ECU Explorer: Open ROM" command to select a definition</li>
			<li>Or add a matching definition file to your workspace</li>
		</ul>
	</div>
	<p>File: ${document.uri.fsPath.split(/[\\/]/).pop()}</p>
</body>
</html>`;
		return;
	}

	// Set up activeRom from the document
	const rom: RomInstance = {
		id: `${romDocument.uri.toString()}`,
		romUri: romDocument.uri.toString(),
		providerId: "", // Will be set by provider
		defUri: "", // Will be set by provider
		bytes: romDocument.romBytes,
		definition: romDocument.definition,
	};
	activeRom = rom;

	// Determine which table to open
	let selectedTable: TableDefinition | undefined;

	if (isTableDocument) {
		// Table already selected - use it directly
		selectedTable = document.tableDef;
	} else {
		// Show quick pick to select table (only for ROM documents)
		type TablePickItem = vscode.QuickPickItem & { def: TableDefinition };
		const items: TablePickItem[] = definition.tables.map((t) => ({
			label: t.name,
			...(t.category ? { description: t.category } : {}),
			detail: t.kind,
			def: t,
		}));

		const picked = await vscode.window.showQuickPick<TablePickItem>(items, {
			placeHolder: "Select a table",
		});
		if (!picked) {
			panel.dispose();
			return;
		}
		selectedTable = picked.def;

		// Open the selected table via the table editor and dispose the ROM panel.
		// We don't want a ROM editor tab to remain open — only the table tab.
		await state.openTableInCustomEditor(romDocument.uri, selectedTable.name);
		panel.dispose();
		return;
	}

	// Set context keys for command enablement
	console.log(
		"[DEBUG] handleTableOpen: Setting context keys - is1D =",
		selectedTable.kind === "table1d",
		"is2D =",
		selectedTable.kind === "table2d",
	);
	await vscode.commands.executeCommand(
		"setContext",
		"ecuExplorer.activeTableIs1D",
		selectedTable.kind === "table1d",
	);
	await vscode.commands.executeCommand(
		"setContext",
		"ecuExplorer.activeTableIs2D",
		selectedTable.kind === "table2d",
	);

	// Initialize per-tab undo/redo manager (reuse existing instance if present)
	const tableUriKey = document.uri.toString();
	const undoRedoManagers = state.undoRedoManagers;
	if (!undoRedoManagers.has(tableUriKey)) {
		// Create new UndoRedoManager with lazy import
		const { UndoRedoManager } = await import("../undo-redo-manager");
		undoRedoManagers.set(tableUriKey, new UndoRedoManager());
	}
	const undoRedoManager = undoRedoManagers.get(tableUriKey)!;

	// Compute snapshot
	const snapshot = snapshotTable(selectedTable, rom.bytes);
	let didInit = false;

	// Update tree to show active table (Phase 2)
	if (state.treeProvider) {
		state.treeProvider.setActiveTable(rom.romUri, selectedTable.name);
	}

	// Clean up when panel is closed
	panel.onDidDispose(() => {
		// Remove per-tab manager from map to avoid memory leaks
		undoRedoManagers.delete(tableUriKey);
		// Note: panelToDocument cleanup is handled by registerPanel()

		// Clear context keys
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.activeTableIs1D",
			false,
		);
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.activeTableIs2D",
			false,
		);

		// Clear active table from tree
		if (state.treeProvider) {
			state.treeProvider.clearActiveTable();
		}
	});

	// Set up webview using helper
	await setupTableWebview(panel, ctx.extensionUri);
	panel.webview.onDidReceiveMessage(
		async (msg: unknown) => {
			if (!msg || typeof msg !== "object") return;
			const type = (msg as { type?: string }).type;
			if (type === "ready") {
				if (!didInit) {
					didInit = true;
					const themeColors = getThemeColors();
					await panel.webview.postMessage({
						type: "init",
						snapshot,
						definition: selectedTable,
						rom: Array.from(rom.bytes),
						themeColors,
					});
				}
				return;
			}
			if (type === "exportCsv") {
				await state.exportActiveTableCsvFlow(ctx);
				return;
			}
			if (type === "cellEdit") {
				console.log(`[DEBUG] cellEdit message received`);
				const cellMsg = msg as {
					type: string;
					row: number;
					col: number;
					depth?: number;
					value: Uint8Array;
					label?: string;
				};
				// Handle cell edits directly with per-tab undo/redo manager
				if (!activeRom || !undoRedoManager) {
					console.log("[DEBUG] cellEdit: Missing activeRom or undoRedoManager");
					return;
				}

				const { row, col, value, label } = cellMsg;
				const address = calculateCellAddress(selectedTable, row, col);
				console.log(
					`[DEBUG] cellEdit: row=${row}, col=${col}, address=0x${address.toString(
						16,
					)}, romSize=${activeRom.bytes.length}`,
				);

				if (address < 0 || address >= activeRom.bytes.length) {
					panel.webview.postMessage({
						type: "error",
						message: `Cell address out of bounds: 0x${address.toString(16)}`,
					});
					return;
				}

				// Get old value
				const elementSize = ["u8", "i8"].includes(selectedTable.z.dtype)
					? 1
					: ["u16", "i16"].includes(selectedTable.z.dtype)
						? 2
						: 4;
				const oldValue = activeRom.bytes.slice(address, address + elementSize);
				const newValue = new Uint8Array(value);

				console.log(
					`[DEBUG] cellEdit: Pushing to per-tab undoRedoManager (canUndo before=${undoRedoManager.canUndo()})`,
				);

				// Store operation in per-tab undo stack
				undoRedoManager.push({
					row,
					col,
					...(cellMsg.depth !== undefined ? { depth: cellMsg.depth } : {}),
					oldValue,
					newValue,
					timestamp: Date.now(),
					label: label || `Edit cell (${row}, ${col})`,
				});
				console.log(
					`[DEBUG] cellEdit: Pushed to per-tab undoRedoManager (canUndo after=${undoRedoManager.canUndo()})`,
				);

				// Apply change to ROM
				activeRom.bytes.set(newValue, address);

				// Mark the RomDocument as dirty
				const document = getRomDocumentForPanel(panel);
				console.log(
					`[DEBUG] cellEdit: Got document=${!!document}, isDirty=${
						document?.isDirty
					}`,
				);
				if (document) {
					document.updateBytes(activeRom.bytes, address, newValue.length);
					console.log(
						`[DEBUG] cellEdit: Called updateBytes, isDirty=${document.isDirty}`,
					);
				}

				// Send confirmation back to webview
				const newSnapshot = snapshotTable(selectedTable, activeRom.bytes);
				const decodedValue = decodeScalarBytes(
					newValue,
					selectedTable.z.dtype as any,
					selectedTable.z.endianness ?? "le",
				);
				const scaledValue =
					decodedValue * (selectedTable.z.scale ?? 1) +
					(selectedTable.z.offset ?? 0);
				panel.webview.postMessage({
					type: "cellCommit",
					row,
					col,
					value: scaledValue,
					snapshot: newSnapshot,
				});
				console.log(
					`[DEBUG] cellEdit handled, canUndo=${undoRedoManager.canUndo()}`,
				);
				return;
			}
			if (type === "undo") {
				console.log(
					`[DEBUG] undo message received, canUndo=${undoRedoManager.canUndo()}`,
				);
				const entry = undoRedoManager.undo();
				console.log(
					`[DEBUG] undoRedoManager.undo() returned`,
					entry ? "entry" : "null",
				);
				if (entry) {
					if (isBatchEdit(entry)) {
						// Batch undo: revert all ops in reverse order
						let minAddress = Number.MAX_SAFE_INTEGER;
						let maxAddress = 0;
						for (const op of [...entry.ops].reverse()) {
							const address =
								op.address !== undefined
									? op.address
									: calculateCellAddress(selectedTable, op.row, op.col);
							rom.bytes.set(op.oldValue, address);
							minAddress = Math.min(minAddress, address);
							maxAddress = Math.max(maxAddress, address + op.oldValue.length);
						}
						const document = getRomDocumentForPanel(panel);
						if (document) {
							const atInitial = undoRedoManager.isAtInitialState();
							if (atInitial) {
								document.makeClean();
							}
							document.updateBytes(
								rom.bytes,
								minAddress,
								maxAddress - minAddress,
								!atInitial,
							);
						}
					} else {
						// Single op undo
						const address =
							entry.address !== undefined
								? entry.address
								: calculateCellAddress(selectedTable, entry.row, entry.col);
						rom.bytes.set(entry.oldValue, address);
						const document = getRomDocumentForPanel(panel);
						if (document) {
							const atInitial = undoRedoManager.isAtInitialState();
							if (atInitial) {
								document.makeClean();
							}
							document.updateBytes(
								rom.bytes,
								address,
								entry.oldValue.length,
								!atInitial,
							);
						}
					}
				}
				const newSnapshot = snapshotTable(selectedTable, rom.bytes);
				await panel.webview.postMessage({
					type: "update",
					snapshot: newSnapshot,
					rom: Array.from(rom.bytes),
					reason: "undo",
				});
				return;
			}
			if (type === "redo") {
				console.log(
					`[DEBUG] redo message received, canRedo=${undoRedoManager.canRedo()}`,
				);
				const entry = undoRedoManager.redo();
				console.log(
					`[DEBUG] undoRedoManager.redo() returned`,
					entry ? "entry" : "null",
				);
				if (entry) {
					if (isBatchEdit(entry)) {
						// Batch redo: apply all ops in forward order
						let minAddress = Number.MAX_SAFE_INTEGER;
						let maxAddress = 0;
						for (const op of entry.ops) {
							const address =
								op.address !== undefined
									? op.address
									: calculateCellAddress(selectedTable, op.row, op.col);
							rom.bytes.set(op.newValue, address);
							minAddress = Math.min(minAddress, address);
							maxAddress = Math.max(maxAddress, address + op.newValue.length);
						}
						const document = getRomDocumentForPanel(panel);
						if (document) {
							document.updateBytes(
								rom.bytes,
								minAddress,
								maxAddress - minAddress,
								true,
							);
						}
					} else {
						// Single op redo
						const address =
							entry.address !== undefined
								? entry.address
								: calculateCellAddress(selectedTable, entry.row, entry.col);
						rom.bytes.set(entry.newValue, address);
						const document = getRomDocumentForPanel(panel);
						if (document) {
							document.updateBytes(
								rom.bytes,
								address,
								entry.newValue.length,
								true,
							);
						}
					}
				}
				const newSnapshot = snapshotTable(selectedTable, rom.bytes);
				await panel.webview.postMessage({
					type: "update",
					snapshot: newSnapshot,
					rom: Array.from(rom.bytes),
					reason: "redo",
				});
				return;
			}
			if (type === "triggerSave") {
				// Trigger VSCode's native save command
				await vscode.commands.executeCommand("workbench.action.files.save");
				return;
			}
			if (type === "mathOpHotkey") {
				const msgKey = (msg as { key?: string }).key;
				if (!msgKey) return;

				const key = msgKey;

				// Define prompts based on key
				let promptText = "";
				let placeHolder = "";
				const defaultValue = "0";

				switch (key) {
					case "=":
						promptText = "Enter value to set selected cells to";
						placeHolder = "e.g., 0 or 255";
						break;
					case "+":
						promptText = "Enter value to add to selected cells";
						placeHolder = "e.g., 5 or -10";
						break;
					case "-":
						promptText = "Enter value to subtract from selected cells";
						placeHolder = "e.g., 5 or -10";
						break;
					case "*":
						promptText = "Enter factor to multiply selected cells by";
						placeHolder = "e.g., 1.5 or 0.5";
						break;
					case "/":
						promptText = "Enter factor to divide selected cells by";
						placeHolder = "e.g., 2 or 0.5";
						break;
					default:
						return;
				}

				const input = await vscode.window.showInputBox({
					prompt: promptText,
					placeHolder,
					value: defaultValue,
					validateInput: (inputVal) => {
						const num = Number.parseFloat(inputVal);
						return Number.isNaN(num) ? "Please enter a valid number" : null;
					},
				});

				if (input === undefined) {
					// User cancelled
					return;
				}

				const value = Number.parseFloat(input);
				if (Number.isNaN(value)) {
					return;
				}

				// Check for division by zero
				if (key === "/" && value === 0) {
					vscode.window.showErrorMessage("Cannot divide by zero");
					return;
				}

				// Send the math operation to the webview
				await panel.webview.postMessage({
					type: "mathOp",
					operation:
						key === "="
							? "set"
							: key === "+"
								? "add"
								: key === "-"
									? "add"
									: key === "*"
										? "multiply"
										: "multiply",
					constant: key === "-" ? -value : key === "/" ? 1 / value : value,
					factor:
						key === "*" || key === "/"
							? key === "/"
								? 1 / value
								: value
							: undefined,
					value: key === "=" ? value : undefined,
				});
				return;
			}
			if (type === "mathOpComplete") {
				const mathMsg = msg as {
					type: string;
					operation: string;
					changedCount: number;
					warnings: string[];
					edits?: { address: number; after: number[] }[];
				};
				// Apply edits to ROM bytes and fire update event so graph panels sync
				if (mathMsg.edits && mathMsg.edits.length > 0 && activeRom) {
					let minAddress = Number.MAX_SAFE_INTEGER;
					let maxAddress = 0;

					// Build batch edit operations, capturing 'before' bytes from ROM
					const batchOps: any[] = [];
					for (const edit of mathMsg.edits) {
						const newValue = new Uint8Array(edit.after);
						// Capture old bytes before overwriting
						const oldValue = activeRom.bytes.slice(
							edit.address,
							edit.address + newValue.length,
						);
						batchOps.push({
							row: 0,
							col: 0,
							address: edit.address,
							oldValue,
							newValue,
							timestamp: Date.now(),
							label: `Math op: ${mathMsg.operation}`,
						});
						activeRom.bytes.set(newValue, edit.address);
						minAddress = Math.min(minAddress, edit.address);
						maxAddress = Math.max(maxAddress, edit.address + newValue.length);
					}

					// Push all edits as a single undo unit
					if (undoRedoManager) {
						undoRedoManager.pushBatch(
							batchOps,
							`Math op: ${mathMsg.operation} (${batchOps.length} cells)`,
						);
					}

					const docRef = getRomDocumentForPanel(panel);
					if (docRef) {
						docRef.updateBytes(
							activeRom.bytes,
							minAddress,
							maxAddress - minAddress,
						);
					}
				}
				return;
			}
			if (type === "open2DGraph") {
				await vscode.commands.executeCommand(
					"ecuExplorer.open2DGraphForActiveTable",
				);
				return;
			}
			if (type === "open3DGraph") {
				await vscode.commands.executeCommand(
					"ecuExplorer.open3DGraphForActiveTable",
				);
				return;
			}
			if (type === "selectionChange") {
				// Forward to selection manager if available
				// This will be implemented in extension.ts
				return;
			}
		},
		undefined,
		ctx.subscriptions,
	);
}

async function renderTableHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
): Promise<string> {
	try {
		console.log(
			"[DEBUG] renderTableHtml: extensionUri =",
			extensionUri.toString(),
		);

		// TEST: Try minimal HTML first to isolate the issue
		const USE_MINIMAL_HTML = false; // Set to true to test with minimal HTML
		if (USE_MINIMAL_HTML) {
			const minimalHtml = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Test</title>
	</head>
	<body>
		<h1>Hello World - Minimal Test</h1>
		<p>If you see this, the webview panel creation works.</p>
	</body>
</html>`;
			return minimalHtml;
		}

		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "dist", "webview", "table.js"),
		);

		// Find the CSS file (it has a hash in the name)
		const webviewDir = vscode.Uri.joinPath(extensionUri, "dist", "webview");
		console.log(
			"[DEBUG] renderTableHtml: webviewDir.fsPath =",
			webviewDir.fsPath,
		);

		let cssFileName = "table-D9vXwniH.css"; // Default fallback

		try {
			const files = await vscode.workspace.fs.readDirectory(webviewDir);
			console.log(
				"[DEBUG] renderTableHtml: fs.readdir succeeded, files =",
				files,
			);

			const [cssFile] =
				files.find(([f]) => f.startsWith("table-") && f.endsWith(".css")) || [];

			if (cssFile) {
				cssFileName = cssFile;
				console.log(
					"[DEBUG] renderTableHtml: Updated cssFileName =",
					cssFileName,
				);
			}
		} catch (_error) {
			// Use default if directory read fails
			console.warn(
				"[WARN] renderTableHtml: Could not read webview directory, using default CSS filename",
			);
		}

		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, "dist", "webview", cssFileName),
		);

		const nonce = String(Date.now());

		console.log(
			"[DEBUG] renderTableHtml: webview.cspSource =",
			webview.cspSource,
		);
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data: https:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}' 'unsafe-eval'`,
			`font-src ${webview.cspSource}`,
			`connect-src ${webview.cspSource} https:`,
		].join("; ");

		const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="${csp}" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>ROM Table</title>
		<link rel="stylesheet" href="${cssUri}" />
	</head>
	<body>
		<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
	</body>
</html>`;
		return html;
	} catch (error) {
		console.error(
			"[ERROR] renderTableHtml: Stack trace:",
			error instanceof Error ? error.stack : "N/A",
		);
		throw error;
	}
}
