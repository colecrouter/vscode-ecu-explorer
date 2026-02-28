import {
	calculateCellAddress,
	type DefinitionProvider,
	decodeScalarBytes,
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";
import type { EcuEvent, RomProgress } from "@ecu-explorer/device";
import { MitsubishiBootloaderProtocol } from "@ecu-explorer/device-protocol-mitsubishi-bootloader";
import { Mut3Protocol } from "@ecu-explorer/device-protocol-mut3";
import { Obd2Protocol } from "@ecu-explorer/device-protocol-obd2";
import { SubaruProtocol } from "@ecu-explorer/device-protocol-subaru";
import { UdsProtocol } from "@ecu-explorer/device-protocol-uds";
import { OpenPort2Transport } from "@ecu-explorer/device-transport-openport2";
import * as vscode from "vscode";
import { setEditCommandsContext, setGraphCommandsContext } from "./commands";
import { readConfig } from "./config";
import { exportActiveTableCsvFlow } from "./csv/export";
import { importTableFromCsvFlow } from "./csv/import";
import { DeviceManagerImpl } from "./device-manager";
import { DeviceStatusBarManager } from "./device-status-bar";
import { GraphPanelManager } from "./graph-panel-manager";
import { GraphPanelSerializer } from "./graph-panel-serializer";
import {
	handleCellEdit,
	handleTableOpen,
	setCellEditHandlerContext,
	setTableHandlerContext,
} from "./handlers";
import { LiveDataPanelManager } from "./live-data-panel-manager";
import { LoggingManager, openLogsFolder } from "./logging-manager";
import { resolveRomDefinition } from "./rom/definition-resolver";
import type { RomDocument } from "./rom/document";
import { RomEditorProvider, TableEditorDelegate } from "./rom/editor-provider";
import { RomSymbolProvider } from "./rom/symbol-provider";
import { TableFileSystemProvider } from "./table-fs-provider";
import { createTableUri } from "./table-fs-uri";
import { getThemeColors } from "./theme-colors";
import type { RomTreeItem } from "./tree/rom-tree-item";
import { RomExplorerTreeProvider } from "./tree/rom-tree-provider";
import { isBatchEdit, type UndoRedoManager } from "./undo-redo-manager";
import { WorkspaceState } from "./workspace-state";

class ProviderRegistry {
	providers: DefinitionProvider[] = [];
	register(p: DefinitionProvider) {
		this.providers.push(p);
	}
	list() {
		return this.providers;
	}
}

const registry = new ProviderRegistry();

let activeRom: RomInstance | null = null;
let activeTableName: string | null = null;
let activeTableDef: TableDefinition | null = null;
/** Per-tab undo/redo managers keyed by table URI string */
const undoRedoManagers = new Map<string, UndoRedoManager>();
/** The active undo/redo manager for the currently focused tab */
let undoRedoManager: UndoRedoManager | null = null;
/** Key (table URI string) used to look up the active undoRedoManager in the map */
let activePanel: vscode.WebviewPanel | null = null;
// statusBarItem removed - using VSCode's built-in dirty state indicator
let treeProvider: RomExplorerTreeProvider | null = null;
let graphPanelManager: GraphPanelManager | null = null;
let liveDataPanelManager: LiveDataPanelManager | null = null;
let loggingManager: LoggingManager | null = null;
let deviceManager: DeviceManagerImpl | null = null;
let editorProvider: RomEditorProvider | null = null; // Will be set during activation
let workspaceState: WorkspaceState | null = null; // Workspace state manager

function getActiveRomPathForCacheClear(): string | null {
	if (activeRom) {
		return vscode.Uri.parse(activeRom.romUri).fsPath;
	}

	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab as
		| { input?: { uri?: vscode.Uri } }
		| undefined;
	const activeUri = activeTab?.input?.uri;

	if (activeUri?.scheme === "file") {
		return activeUri.fsPath;
	}

	return null;
}

/**
 * Manages selection synchronization across different panels for the same ROM.
 */
class SelectionManager {
	// ROM Path -> Table ID -> Selection
	private selections = new Map<string, Map<string, any>>();

	/**
	 * Update selection for a specific table in a ROM
	 */
	updateSelection(romPath: string, tableId: string, selection: any) {
		let romSelections = this.selections.get(romPath);
		if (!romSelections) {
			romSelections = new Map();
			this.selections.set(romPath, romSelections);
		}
		romSelections.set(tableId, selection);

		// Broadcast to other panels
		this.broadcast(romPath, tableId, selection);
	}

	/**
	 * Get current selection for a table
	 */
	getSelection(romPath: string, tableId: string) {
		return this.selections.get(romPath)?.get(tableId);
	}

	private broadcast(romPath: string, tableId: string, selection: any) {
		// Forward to GraphPanelManager
		if (graphPanelManager) {
			graphPanelManager.handleExternalSelectionChange(
				romPath,
				tableId,
				selection,
			);
		}

		// Forward to RomEditorProvider (for table webviews)
		if (editorProvider) {
			editorProvider.handleExternalSelectionChange(romPath, tableId, selection);
		}
	}
}

const selectionManager = new SelectionManager();

// Track RomDocument instances by webview panel
const panelToDocument = new Map<vscode.WebviewPanel, RomDocument>();

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
async function openTableInCustomEditor(
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

// Status bar functions removed - using VSCode's built-in dirty state indicator instead

/**
 * Resolve setting paths relative to the workspace root.
 * Absolute paths are returned as-is. Relative paths are resolved against the workspace root.
 * If no workspace root is available, relative paths are filtered out.
 *
 * @param paths - Array of paths from settings
 * @param workspaceRoot - The workspace root URI, or undefined if no workspace is open
 * @returns Resolved absolute paths
 */
function resolveSettingPaths(
	paths: string[],
	workspaceRoot: vscode.Uri | undefined,
): string[] {
	if (!workspaceRoot) return paths.filter((p) => p.startsWith("/"));
	return paths.map((p) =>
		p.startsWith("/") ? p : vscode.Uri.joinPath(workspaceRoot, p).fsPath,
	);
}

/**
 * Re-initialize definition providers based on current settings.
 * Clears the existing registry, reads updated settings, and re-registers providers.
 */
function reinitializeProviders(): void {
	// Clear existing providers
	registry.providers = [];

	const cfg = readConfig();
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

	const commonPaths = resolveSettingPaths(cfg.definitions.paths, workspaceRoot);
	const ecuflashPaths = resolveSettingPaths(
		cfg.definitions.ecuflash.paths,
		workspaceRoot,
	);
	const enabledProviders = cfg.providers.enabled;

	// Merge workspace folders + common paths + ecuflash-specific paths
	const workspaceFolderPaths =
		vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
	const allEcuflashPaths = [
		...workspaceFolderPaths,
		...commonPaths,
		...ecuflashPaths,
	];

	// Only instantiate if enabled
	if (enabledProviders.includes("ecuflash")) {
		registry.register(new EcuFlashProvider(allEcuflashPaths));
	}
}

/**
 * Activate shared ECU Explorer extension logic
 *
 * Registers ROM definition providers and VSCode commands.
 *
 * @param ctx - Extension context
 */
export async function activate(ctx: vscode.ExtensionContext) {
	// Initialize providers based on current settings
	reinitializeProviders();

	// Initialize GraphPanelManager
	graphPanelManager = new GraphPanelManager(
		ctx,
		(romPath: string) => {
			// Find RomDocument by ROM path
			for (const [_panel, doc] of panelToDocument.entries()) {
				if (doc.uri.fsPath === romPath) {
					return doc;
				}
			}
			return undefined;
		},
		(romPath: string, tableId: string) => {
			// Find the table definition and ROM bytes to create a snapshot
			// We can use the activeRom if it matches, or find the document
			let romBytes: Uint8Array | undefined;
			let tableDef: TableDefinition | undefined;

			for (const [_panel, doc] of panelToDocument.entries()) {
				if (doc.uri.fsPath === romPath) {
					romBytes = doc.romBytes;
					if (doc.definition?.tables) {
						tableDef = doc.definition.tables.find((t) => t.name === tableId);
					}
					break;
				}
			}

			if (romBytes && tableDef) {
				return snapshotTable(tableDef, romBytes);
			}
			return undefined;
		},
		(_romPath, tableId, row, col) => {
			// Handle cell selection from graph (legacy)
			if (activePanel && activeTableName === tableId) {
				activePanel.webview.postMessage({
					type: "selectCell",
					row,
					col,
				});
			}
		},
		(romPath, tableId, selection) => {
			// Handle selection change from graph
			selectionManager.updateSelection(romPath, tableId, selection);
		},
	);

	// Initialize context setters for handler modules
	// These allow handlers to access extension state
	setTableHandlerContext(() => ({
		activeRom,
		activeTableName,
		activeTableDef,
		activePanel,
		panelToDocument,
		undoRedoManagers,
		treeProvider,
		getRomDocumentForPanel: (panel: vscode.WebviewPanel) =>
			panelToDocument.get(panel),
		getRomDocumentForPanelRef: (panel: vscode.WebviewPanel) =>
			panelToDocument.get(panel),
		setupTableWebview: async (_panel, _extensionUri) => {
			// Webview setup is now handled in table-handler.ts
		},
		registerPanel: (panel, document, disposables) => {
			panelToDocument.set(panel, document);
			disposables.push(
				panel.onDidDispose(() => {
					panelToDocument.delete(panel);
				}),
			);
		},
		handleCellEdit,
		handleUndo: () => handleUndo(),
		handleRedo: () => handleRedo(),
		exportActiveTableCsvFlow: async (ctx) => {
			await exportActiveTableCsvFlow(
				ctx,
				activeRom,
				activeTableName,
				activeTableDef,
			);
		},
		importTableFromCsvFlow: async (ctx) => {
			await importTableFromCsvFlow(
				ctx,
				activeRom,
				activeTableName,
				activeTableDef,
				activePanel,
				undoRedoManager,
				panelToDocument,
			);
		},
		openTableInCustomEditor,
	}));

	setCellEditHandlerContext(() => ({
		activeRom,
		undoRedoManager,
		getRomDocumentForPanel: (panel: vscode.WebviewPanel) =>
			panelToDocument.get(panel),
		decodeScalarBytes,
		sizeOf: (dtype) => {
			const sizes: Record<string, number> = {
				u8: 1,
				i8: 1,
				u16: 2,
				i16: 2,
				u32: 4,
				i32: 4,
				f32: 4,
			};
			return sizes[dtype] || 4;
		},
	}));

	setEditCommandsContext(() => ({
		activeRom,
		activePanel,
		activeTableDef,
		undoRedoManager,
		getRomDocumentForPanel: (panel: vscode.WebviewPanel) =>
			panelToDocument.get(panel),
	}));

	setGraphCommandsContext(() => ({
		graphPanelManager,
		activeRom,
		activeTableName,
		activeTableDef,
		activePanel,
		editorProvider,
	}));

	// Initialize DeviceManager and register transport/protocol
	deviceManager = new DeviceManagerImpl();
	deviceManager.registerTransport("openport2", new OpenPort2Transport());
	deviceManager.registerProtocol(new Mut3Protocol());
	deviceManager.registerProtocol(new MitsubishiBootloaderProtocol());
	deviceManager.registerProtocol(new SubaruProtocol());
	deviceManager.registerProtocol(new UdsProtocol());
	deviceManager.registerProtocol(new Obd2Protocol());
	ctx.subscriptions.push(deviceManager);

	// Set VSCode context key when connection state changes
	ctx.subscriptions.push(
		deviceManager.onDidChangeConnection((conn) => {
			vscode.commands.executeCommand(
				"setContext",
				"ecuExplorer.deviceConnected",
				conn !== undefined,
			);
		}),
	);

	// Initialize and register DeviceStatusBarManager
	const deviceStatusBarManager = new DeviceStatusBarManager(deviceManager);
	ctx.subscriptions.push(deviceStatusBarManager);

	// Initialize LiveDataPanelManager
	liveDataPanelManager = new LiveDataPanelManager(ctx, deviceManager);

	// Initialize LoggingManager
	loggingManager = new LoggingManager();
	ctx.subscriptions.push(loggingManager);

	// Wire LoggingManager state changes to DeviceStatusBarManager
	ctx.subscriptions.push(
		loggingManager.onDidChangeState((state) => {
			deviceStatusBarManager.updateLoggingState(state);
		}),
	);

	// Wire LiveDataPanelManager frames to LoggingManager
	ctx.subscriptions.push(
		liveDataPanelManager.onFrame((frame) => {
			loggingManager?.onFrame(frame);
		}),
	);

	// Status bar item removed - using VSCode's built-in dirty state indicator
	// Dirty state is now tracked by RomDocument.isDirty and displayed by VSCode's native indicator

	ctx.subscriptions.push(
		vscode.commands.registerCommand("rom.open", () => openRomFlow(ctx)),
		vscode.commands.registerCommand("rom.openTable", () => openTableFlow(ctx)),
		vscode.commands.registerCommand("ecuExplorer.clearDefinitionCache", () => {
			if (!workspaceState) {
				vscode.window.showErrorMessage("Workspace state not initialized.");
				return;
			}

			workspaceState.clearAll();
			vscode.window.showInformationMessage(
				"Cleared all cached ROM definition mappings for this workspace.",
			);
		}),
		vscode.commands.registerCommand(
			"ecuExplorer.clearDefinitionCacheForActiveRom",
			() => {
				if (!workspaceState) {
					vscode.window.showErrorMessage("Workspace state not initialized.");
					return;
				}

				const romPath = getActiveRomPathForCacheClear();
				if (!romPath) {
					vscode.window.showWarningMessage(
						"No active ROM found to clear definition cache.",
					);
					return;
				}

				workspaceState.clearRomState(romPath);
				vscode.window.showInformationMessage(
					`Cleared cached ROM definition mapping for: ${romPath}`,
				);
			},
		),
		vscode.commands.registerCommand(
			"ecuExplorer.openTable",
			async (romUriOrTreeItem: string | RomTreeItem, tableName?: string) => {
				// Handle both direct command invocation and context menu invocation
				let romUri: string;
				let tableNameResolved: string;

				if (typeof romUriOrTreeItem === "string") {
					// Direct command invocation with arguments
					romUri = romUriOrTreeItem;
					if (!tableName) {
						throw new Error("tableName is required when romUri is a string");
					}
					tableNameResolved = tableName;
				} else {
					// Context menu invocation - VSCode passes the tree item
					const treeItem = romUriOrTreeItem;
					if (treeItem.data.type !== "table") {
						vscode.window.showErrorMessage(
							"Can only open table items from the tree",
						);
						return;
					}
					romUri = treeItem.data.romUri;
					tableNameResolved = treeItem.data.tableDef.name;
				}

				await handleOpenTableFromTree(ctx, romUri, tableNameResolved);
			},
		),
		vscode.commands.registerCommand(
			"ecuExplorer.removeRom",
			async (romUriOrTreeItem: string | RomTreeItem) => {
				if (!treeProvider) {
					return;
				}
				let romUri: vscode.Uri | undefined;
				if (typeof romUriOrTreeItem === "string") {
					romUri = vscode.Uri.parse(romUriOrTreeItem);
				} else if (romUriOrTreeItem.data.type === "rom") {
					romUri = romUriOrTreeItem.data.documentUri;
				}
				if (!romUri) {
					vscode.window.showErrorMessage("Can only remove ROM items");
					return;
				}
				treeProvider.removeDocument(romUri);
			},
		),
		vscode.commands.registerCommand("rom.exportTableCsv", () =>
			exportActiveTableCsvFlow(ctx, activeRom, activeTableName, activeTableDef),
		),
		vscode.commands.registerCommand("rom.importTableCsv", () =>
			importTableFromCsvFlow(
				ctx,
				activeRom,
				activeTableName,
				activeTableDef,
				activePanel,
				undoRedoManager,
				panelToDocument,
			),
		),
		vscode.commands.registerCommand("rom.saveRom", async () => {
			// Trigger VSCode's native save command instead of manual save
			await vscode.commands.executeCommand("workbench.action.files.save");
		}),
		// NOTE: We intentionally do NOT register "undo"/"redo" commands here.
		// Undo/redo is handled by the webview itself (via Ctrl+Z keyboard shortcut)
		// which sends "undo"/"redo" messages to the extension's message handler
		// in table-handler.ts. Registering global undo/redo commands here would
		// cause DOUBLE undo: once from the webview message and once from the command.
		vscode.commands.registerCommand("rom.undo", () => handleUndo()),
		vscode.commands.registerCommand("rom.redo", () => handleRedo()),
		// USB Device commands
		vscode.commands.registerCommand(
			"ecuExplorer.readRomFromDevice",
			async () => {
				if (!deviceManager) {
					vscode.window.showErrorMessage("Device manager is not initialized.");
					return;
				}

				// Step 1: Reuse active connection or establish a new one
				let active = deviceManager.activeConnection;
				if (!active) {
					try {
						active = await deviceManager.connect();
					} catch (err) {
						if (err instanceof vscode.CancellationError) {
							return;
						}
						vscode.window.showErrorMessage(
							`Failed to connect to device: ${err instanceof Error ? err.message : String(err)}`,
						);
						return;
					}
				}

				const { connection, protocol: matchedProtocol } = active;

				if (!matchedProtocol.readRom) {
					vscode.window.showErrorMessage(
						`Protocol "${matchedProtocol.name}" does not support ROM reading.`,
					);
					return;
				}

				try {
					// Step 2: Read ROM with progress reporting
					const romBytes = await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Reading ROM via ${matchedProtocol.name}`,
							cancellable: false,
						},
						async (progress) => {
							progress.report({ increment: 0, message: "Connecting to ECU…" });

							const bytes = await matchedProtocol?.readRom?.(
								connection,
								(romProgress) => {
									progress.report({
										increment: romProgress.percentComplete,
										message:
											romProgress.message ??
											`${romProgress.phase}: ${romProgress.bytesProcessed.toLocaleString()} / ${romProgress.totalBytes.toLocaleString()} bytes (${Math.round(romProgress.percentComplete)}%)`,
									});
								},
								(event: EcuEvent) => {
									console.log(`[ECU Event] ${event.type}`, event.data ?? "");
									if (event.type === "SECURITY_ACCESS_GRANTED") {
										vscode.window.showInformationMessage(
											"Security access granted.",
										);
									} else if (event.type === "BOOT_MODE_ENTERED") {
										vscode.window.showInformationMessage(
											"ECU entered boot mode.",
										);
									} else if (event.type === "SECURITY_ACCESS_DENIED") {
										console.log("[ECU Event] Security access denied by ECU.");
									}
								},
							);

							return bytes;
						},
					);

					// Step 3: Show save dialog and write ROM to disk
					const saveUri = await vscode.window.showSaveDialog({
						defaultUri: vscode.Uri.file("rom.bin"),
						filters: {
							"ROM files": ["bin", "rom", "hex"],
							"All files": ["*"],
						},
						saveLabel: "Save ROM",
					});

					if (!romBytes) {
						vscode.window.showErrorMessage("Failed to read ROM from device.");
						return;
					}

					if (saveUri) {
						await vscode.workspace.fs.writeFile(saveUri, romBytes);
						vscode.window.showInformationMessage(
							`ROM saved to ${saveUri.fsPath}`,
						);
					} else {
						// User cancelled save — open as untitled document in hex view
						const doc = await vscode.workspace.openTextDocument({
							content: Array.from(romBytes)
								.map((b) => b.toString(16).padStart(2, "0"))
								.join(" "),
							language: "plaintext",
						});
						await vscode.window.showTextDocument(doc);
					}
				} catch (err) {
					// Error during ROM read operation — disconnect and show error
					const deviceName =
						deviceManager.activeConnection?.deviceName ?? "device";
					await deviceManager.disconnect();
					vscode.window.showErrorMessage(
						`ROM read from ${deviceName} failed. ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				// Do NOT close connection — it is now persistent
			},
		),
		vscode.commands.registerCommand(
			"ecuExplorer.writeRomToDevice",
			async () => {
				if (!deviceManager) {
					vscode.window.showErrorMessage("Device manager is not initialized.");
					return;
				}

				// Step 1: Select ROM file to write
				const romUri = await vscode.window.showOpenDialog({
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					filters: {
						"ROM files": ["bin", "rom", "hex"],
						"All files": ["*"],
					},
					openLabel: "Select ROM to Write",
				});

				const selectedRomUri = romUri?.[0];
				if (!selectedRomUri) {
					return;
				}

				const romBytes = await vscode.workspace.fs.readFile(selectedRomUri);

				// Step 2: Reuse active connection or establish a new one
				let active = deviceManager.activeConnection;
				if (!active) {
					try {
						active = await deviceManager.connect();
					} catch (err) {
						if (err instanceof vscode.CancellationError) {
							return;
						}
						vscode.window.showErrorMessage(
							`Failed to connect to device: ${err instanceof Error ? err.message : String(err)}`,
						);
						return;
					}
				}

				const { connection, protocol: matchedProtocol } = active;

				if (!matchedProtocol.writeRom) {
					vscode.window.showErrorMessage(
						`Protocol "${matchedProtocol.name}" does not support ROM writing.`,
					);
					return;
				}

				// Step 3: Confirm flash (HIGH RISK)
				const confirm = await vscode.window.showWarningMessage(
					`WARNING: Flashing a ROM is a high-risk operation. If interrupted, it may brick your ECU. Are you sure you want to proceed with writing to ${matchedProtocol.name}?`,
					{ modal: true },
					"Yes, Flash ROM",
				);

				if (confirm !== "Yes, Flash ROM") {
					return;
				}

				try {
					// Step 4: Write ROM with progress reporting
					// Determine if we can do a read-before-write for diff-based flashing
					const hasReadRom = !!matchedProtocol.readRom;

					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Flashing ROM via ${matchedProtocol.name}`,
							cancellable: false,
						},
						async (progress) => {
							progress.report({ increment: 0, message: "Connecting to ECU…" });

							// Phase 1: Read current ROM from ECU (if supported)
							let originalRom: Uint8Array | undefined;
							if (matchedProtocol?.readRom) {
								originalRom = await matchedProtocol.readRom(
									connection,
									(romProgress: RomProgress) => {
										// Read phase contributes first 50% of progress bar
										progress.report({
											increment: romProgress.percentComplete / 2,
											message:
												romProgress.message ??
												`Reading current ROM from ECU: ${romProgress.bytesProcessed.toLocaleString()} / ${romProgress.totalBytes.toLocaleString()} bytes (${Math.round(romProgress.percentComplete)}%)`,
										});
									},
									(event: EcuEvent) => {
										console.log(`[ECU Event] ${event.type}`, event.data ?? "");
										if (event.type === "SECURITY_ACCESS_GRANTED") {
											vscode.window.showInformationMessage(
												"Security access granted.",
											);
										} else if (event.type === "BOOT_MODE_ENTERED") {
											vscode.window.showInformationMessage(
												"ECU entered boot mode.",
											);
										} else if (event.type === "SECURITY_ACCESS_DENIED") {
											console.log("[ECU Event] Security access denied by ECU.");
										}
									},
								);
							}

							// Phase 2: Write ROM to ECU
							await matchedProtocol?.writeRom?.(
								connection,
								romBytes,
								(romProgress: RomProgress) => {
									// If we read first, write phase contributes second 50%; otherwise full 100%
									const increment = hasReadRom
										? romProgress.percentComplete / 2
										: romProgress.percentComplete;
									progress.report({
										increment,
										message:
											romProgress.message ??
											`Writing ROM to ECU: ${romProgress.bytesProcessed.toLocaleString()} / ${romProgress.totalBytes.toLocaleString()} bytes (${Math.round(romProgress.percentComplete)}%)`,
									});
								},
								originalRom ? { originalRom } : {},
								(event: EcuEvent) => {
									console.log(`[ECU Event] ${event.type}`, event.data ?? "");
									if (event.type === "SECURITY_ACCESS_GRANTED") {
										vscode.window.showInformationMessage(
											"Security access granted.",
										);
									} else if (event.type === "BOOT_MODE_ENTERED") {
										vscode.window.showInformationMessage(
											"ECU entered boot mode.",
										);
									} else if (event.type === "SECURITY_ACCESS_DENIED") {
										console.log("[ECU Event] Security access denied by ECU.");
									}
								},
							);
						},
					);

					vscode.window.showInformationMessage("ROM flashed successfully!");
				} catch (error) {
					// Error during ROM write operation — disconnect and show error
					const deviceName =
						deviceManager.activeConnection?.deviceName ?? "device";
					await deviceManager.disconnect();
					vscode.window.showErrorMessage(
						`ROM write to ${deviceName} failed. ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				// Do NOT close connection — it is now persistent
			},
		),
		vscode.commands.registerCommand("ecuExplorer.selectDevice", () => {
			vscode.window.showInformationMessage("Select Device is coming soon.");
		}),
		// Device connection commands
		vscode.commands.registerCommand("ecuExplorer.connectDevice", async () => {
			if (!deviceManager) {
				vscode.window.showErrorMessage("Device manager is not initialized.");
				return;
			}
			if (deviceManager.activeConnection) {
				vscode.window.showInformationMessage(
					`Already connected to ${deviceManager.activeConnection.deviceName}. Disconnect first.`,
				);
				return;
			}
			try {
				await deviceManager.connect();
			} catch (err) {
				if (err instanceof vscode.CancellationError) {
					// User cancelled — silent
					return;
				}
				vscode.window.showErrorMessage(
					`Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
		vscode.commands.registerCommand(
			"ecuExplorer.disconnectDevice",
			async () => {
				if (!deviceManager) {
					return;
				}
				if (!deviceManager.activeConnection) {
					return;
				}
				const deviceName = deviceManager.activeConnection.deviceName;
				await deviceManager.disconnect();
				vscode.window.showInformationMessage(
					`Disconnected from ${deviceName}.`,
				);
			},
		),
		vscode.commands.registerCommand("ecuExplorer.startLog", async () => {
			if (!loggingManager) {
				return;
			}
			const active = deviceManager?.activeConnection;
			if (!active) {
				vscode.window.showErrorMessage(
					"No device connected. Connect to a device first.",
				);
				return;
			}
			const pids = active.protocol.getSupportedPids
				? await active.protocol.getSupportedPids(active.connection)
				: [];
			await loggingManager.startLog(pids);
		}),
		vscode.commands.registerCommand("ecuExplorer.pauseLog", () => {
			loggingManager?.pauseLog();
		}),
		vscode.commands.registerCommand("ecuExplorer.resumeLog", () => {
			loggingManager?.resumeLog();
		}),
		vscode.commands.registerCommand("ecuExplorer.stopLog", async () => {
			await loggingManager?.stopLog();
		}),
		vscode.commands.registerCommand("ecuExplorer.openLogsFolder", async () => {
			await openLogsFolder(ctx);
		}),
		vscode.commands.registerCommand("ecuExplorer.startLiveData", async () => {
			if (!liveDataPanelManager) {
				vscode.window.showErrorMessage(
					"Live Data panel manager is not initialized.",
				);
				return;
			}
			await liveDataPanelManager.showPanel();
		}),
		// Math operations
		vscode.commands.registerCommand("rom.mathOpAdd", () => handleMathOpAdd()),
		vscode.commands.registerCommand("rom.mathOpMultiply", () =>
			handleMathOpMultiply(),
		),
		vscode.commands.registerCommand("rom.mathOpClamp", () =>
			handleMathOpClamp(),
		),
		vscode.commands.registerCommand("rom.mathOpSmooth", () =>
			handleMathOpSmooth(),
		),
		// Graph window commands
		vscode.commands.registerCommand(
			"ecuExplorer.open2DGraphForActiveTable",
			() => handleOpenGraph("line"),
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open3DGraphForActiveTable",
			() => handleOpenGraph("heatmap"),
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open2DGraph",
			async (treeItem?: RomTreeItem) => {
				if (editorProvider) {
					await handleOpenGraphParameterized(treeItem, editorProvider, "line");
				}
			},
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open3DGraph",
			async (treeItem?: RomTreeItem) => {
				if (editorProvider) {
					await handleOpenGraphParameterized(
						treeItem,
						editorProvider,
						"heatmap",
					);
				}
			},
		),
	);

	// Set of URI strings currently being saved by the extension.
	// Used to suppress spurious file watcher callbacks for self-initiated saves.
	const savingRomUris = new Set<string>();

	// Register CustomEditorProvider for native dirty marker support
	const newEditorProvider = new RomEditorProvider(
		ctx,
		registry,
		async (document, panel) => {
			await handleTableOpen(document, panel, ctx);
		},
		savingRomUris,
		(savedDocument) => {
			// Clear undo/redo history for all table tabs belonging to this ROM
			// so the post-save state becomes the new baseline
			for (const [key, manager] of undoRedoManagers.entries()) {
				if (key.includes(savedDocument.uri.fsPath)) {
					manager.clear();
				}
			}
		},
	);
	editorProvider = newEditorProvider;
	// Create a separate delegate for table editor registration.
	// Using the same provider instance for both romViewer.editor and romViewer.tableEditor
	// causes VSCode to dispatch TableDocument change events to romViewer.editor, which
	// throws "No custom document found" because it doesn't own TableDocument instances.
	// TableEditorDelegate exposes its own onDidChangeCustomDocument backed by
	// RomEditorProvider._onDidChangeTableDocument, keeping the two event streams separate.
	const tableEditorDelegate = new TableEditorDelegate(newEditorProvider);
	ctx.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			"romViewer.editor",
			newEditorProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			},
		),
		// Register the dedicated table editor delegate for table URIs
		vscode.window.registerCustomEditorProvider(
			"romViewer.tableEditor",
			tableEditorDelegate,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			},
		),
	);

	// Watch ROM files for external changes (e.g. from MCP patch_table)
	//
	// Per-document RelativePattern watchers: each opened ROM file gets its own
	// watcher scoped to that file's directory. This reliably fires for files
	// opened outside any VS Code workspace folder (plain string globs only fire
	// within workspace folders).
	//
	// Map to track per-document file watchers
	const romDocumentWatchers = new Map<string, vscode.FileSystemWatcher>();

	/**
	 * Create a RelativePattern watcher for a single ROM document.
	 * The watcher is disposed automatically when the document is disposed.
	 */
	function watchRomDocument(romDoc: RomDocument): void {
		const uri = romDoc.uri;
		const uriStr = uri.toString();
		if (romDocumentWatchers.has(uriStr)) return; // already watching

		const dir = vscode.Uri.file(
			uri.fsPath.substring(0, uri.fsPath.lastIndexOf("/")),
		);
		const fileName = uri.fsPath.substring(uri.fsPath.lastIndexOf("/") + 1);
		const pattern = new vscode.RelativePattern(dir, fileName);

		const watcher = vscode.workspace.createFileSystemWatcher(
			pattern,
			false, // watch create events (fs.rename fires onDidCreate at destination)
			false, // watch change events
			true, // ignore delete events
		);

		const handler = async (_changedUri: vscode.Uri) => {
			// Suppress watcher callback for self-initiated saves (e.g. Cmd+S)
			if (savingRomUris.has(uriStr)) {
				return;
			}
			try {
				const newBytes = new Uint8Array(
					await vscode.workspace.fs.readFile(uri),
				);
				// External update — bytes are already on disk, do NOT mark document dirty
				romDoc.updateBytes(newBytes, undefined, undefined, false);

				if (activeRom && activeRom.romUri === uriStr) {
					activeRom.bytes = newBytes;
					if (activePanel && activeTableDef) {
						const newSnapshot = snapshotTable(activeTableDef, newBytes);
						activePanel.webview.postMessage({
							type: "update",
							snapshot: newSnapshot,
							rom: Array.from(newBytes),
						});
					}
				}
			} catch (err) {
				console.error(`[RomFileWatcher] ERROR reading ${uriStr}: ${err}`);
			}
		};

		watcher.onDidCreate(handler);
		watcher.onDidChange(handler);

		// Clean up when the document is disposed
		romDoc.onDidDispose(() => {
			watcher.dispose();
			romDocumentWatchers.delete(uriStr);
		});

		romDocumentWatchers.set(uriStr, watcher);
		ctx.subscriptions.push(watcher);
	}

	// Subscribe to new ROM document openings
	ctx.subscriptions.push(
		newEditorProvider.onDidOpenRomDocument((doc) => {
			watchRomDocument(doc);
		}),
	);

	// Initialize workspace state
	workspaceState = new WorkspaceState(ctx.workspaceState);

	// Create and register ECU Explorer tree provider
	treeProvider = new RomExplorerTreeProvider(editorProvider, workspaceState);
	editorProvider.setTreeProvider(treeProvider);
	const treeView = vscode.window.createTreeView("ecuExplorer", {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
	});
	ctx.subscriptions.push(treeView);

	// Register Virtual File System Provider for table URIs
	const tableFs = new TableFileSystemProvider(registry, workspaceState);
	ctx.subscriptions.push(
		vscode.workspace.registerFileSystemProvider("ecu-table", tableFs, {
			isCaseSensitive: true,
			isReadonly: false,
		}),
	);

	// Register WorkspaceSymbolProvider for Quick Open integration (Cmd+P then #)
	// This is the correct approach without using proposed APIs
	const symbolProvider = new RomSymbolProvider(treeProvider);
	ctx.subscriptions.push(
		vscode.languages.registerWorkspaceSymbolProvider(symbolProvider),
	);

	// Listen for tab changes to update active table state
	ctx.subscriptions.push(
		vscode.window.tabGroups.onDidChangeTabs(async (_e) => {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			if (activeTab?.input instanceof vscode.TabInputCustom) {
				const tableDoc = editorProvider?.getTableDocument(activeTab.input.uri);
				if (tableDoc) {
					activeTableName = tableDoc.tableId;
					activeTableDef = tableDoc.tableDef;

					// Set context keys for command enablement
					console.log(
						"[DEBUG] onDidChangeTabs: Setting context keys - is1D =",
						activeTableDef.kind === "table1d",
						"is2D =",
						activeTableDef.kind === "table2d",
					);
					await vscode.commands.executeCommand(
						"setContext",
						"ecuExplorer.activeTableIs1D",
						activeTableDef.kind === "table1d",
					);
					await vscode.commands.executeCommand(
						"setContext",
						"ecuExplorer.activeTableIs2D",
						activeTableDef.kind === "table2d",
					);

					if (!tableDoc.romDocument.definition) {
						vscode.window.showErrorMessage(
							`Table definition not found for ${tableDoc.tableId}`,
						);
						return;
					}

					activeRom = {
						id: tableDoc.romDocument.uri.toString(),
						romUri: tableDoc.romDocument.uri.toString(),
						providerId: "",
						defUri: "",
						bytes: tableDoc.romDocument.romBytes,
						definition: tableDoc.romDocument.definition,
					};
					activePanel =
						editorProvider?.getPanelForDocument(tableDoc.romDocument) || null;

					// Switch to the per-tab UndoRedoManager for the newly-active tab
					const tabKey = activeTab.input.uri.toString();
					undoRedoManager = undoRedoManagers.get(tabKey) ?? null;

					// Update tree to show active table
					if (treeProvider) {
						treeProvider.setActiveTable(activeRom.romUri, activeTableName);
					}
				} else {
					// No table document - clear context keys
					await vscode.commands.executeCommand(
						"setContext",
						"ecuExplorer.activeTableIs1D",
						false,
					);
					await vscode.commands.executeCommand(
						"setContext",
						"ecuExplorer.activeTableIs2D",
						false,
					);
				}
			} else {
				// Not a custom editor tab - clear context keys
				await vscode.commands.executeCommand(
					"setContext",
					"ecuExplorer.activeTableIs1D",
					false,
				);
				await vscode.commands.executeCommand(
					"setContext",
					"ecuExplorer.activeTableIs2D",
					false,
				);
			}
		}),
	);

	// Register GraphPanelSerializer for persistence across VSCode reloads
	ctx.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(
			"ecuExplorerGraph",
			new GraphPanelSerializer(ctx, editorProvider, graphPanelManager),
		),
	);

	// Register serializer for tree view table panels
	// For now, we gracefully close panels on reload since the webview doesn't persist state yet
	// This prevents VSCode from showing empty/broken panels after reload
	// TODO: Implement full state persistence in TableApp.svelte using vscode.setState()
	ctx.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer("ecuExplorer.table", {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
				// For now, just dispose the panel gracefully
				// In the future, we can restore it if the webview saves state
				panel.dispose();
			},
		}),
	);

	// Listen for theme changes and broadcast to all active webviews
	ctx.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(() => {
			const themeColors = getThemeColors();

			// Send theme update to active table panel
			if (activePanel) {
				activePanel.webview.postMessage({
					type: "themeChanged",
					themeColors,
				});
			}

			// Send theme update to all graph panels
			if (graphPanelManager) {
				graphPanelManager.broadcastThemeColors(themeColors);
			}
		}),
	);

	// Listen for configuration changes and re-initialize providers when relevant settings change
	ctx.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (
				event.affectsConfiguration("ecuExplorer.definitions.paths") ||
				event.affectsConfiguration("ecuExplorer.definitions.ecuflash.paths") ||
				event.affectsConfiguration("ecuExplorer.providers.enabled")
			) {
				reinitializeProviders();
			}
		}),
	);
}

/**
 * Handle undo command
 * Integrates with VSCode's undo/redo system
 */
function handleUndo(): void {
	if (!undoRedoManager || !activeRom || !activePanel || !activeTableDef) {
		return;
	}

	const entry = undoRedoManager.undo();
	if (!entry) return;

	const document = panelToDocument.get(activePanel);

	if (isBatchEdit(entry)) {
		// Batch undo: revert all ops in reverse order
		let minAddress = Number.MAX_SAFE_INTEGER;
		let maxAddress = 0;
		for (const op of [...entry.ops].reverse()) {
			const address =
				op.address !== undefined
					? op.address
					: calculateCellAddress(activeTableDef, op.row, op.col);
			activeRom.bytes.set(op.oldValue, address);
			minAddress = Math.min(minAddress, address);
			maxAddress = Math.max(maxAddress, address + op.oldValue.length);
		}
		if (document) {
			const atInitial = undoRedoManager.isAtInitialState();
			if (atInitial) {
				document.makeClean();
			}
			document.updateBytes(
				activeRom.bytes,
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
				: calculateCellAddress(activeTableDef, entry.row, entry.col);

		// Revert ROM bytes
		activeRom.bytes.set(entry.oldValue, address);

		if (document) {
			// Check if we're back to the initial state (no changes)
			const atInitial = undoRedoManager.isAtInitialState();
			if (atInitial) {
				// Clear dirty state when back to initial state
				document.makeClean();
			}
			// Fire update event even if we're back to initial state, so other views sync
			document.updateBytes(
				activeRom.bytes,
				address,
				entry.oldValue.length,
				!atInitial,
			);
		}
	}
	// Note: If not at initial state, document remains dirty (no action needed)

	// Notify the active webview panel so its UI reflects the undo
	if (activePanel && activeTableDef && activeRom) {
		const newSnapshot = snapshotTable(activeTableDef, activeRom.bytes);
		activePanel.webview.postMessage({
			type: "update",
			snapshot: newSnapshot,
			rom: Array.from(activeRom.bytes),
			reason: "undo",
		});
	}
}

/**
 * Handle redo command
 * Integrates with VSCode's undo/redo system
 */
function handleRedo(): void {
	if (!undoRedoManager || !activeRom || !activePanel || !activeTableDef) return;
	const entry = undoRedoManager.redo();
	if (!entry) return;

	const document = panelToDocument.get(activePanel);

	if (isBatchEdit(entry)) {
		// Batch redo: apply all ops in forward order
		let minAddress = Number.MAX_SAFE_INTEGER;
		let maxAddress = 0;
		for (const op of entry.ops) {
			const address =
				op.address !== undefined
					? op.address
					: calculateCellAddress(activeTableDef, op.row, op.col);
			activeRom.bytes.set(op.newValue, address);
			minAddress = Math.min(minAddress, address);
			maxAddress = Math.max(maxAddress, address + op.newValue.length);
		}
		if (document) {
			document.updateBytes(
				activeRom.bytes,
				minAddress,
				maxAddress - minAddress,
			);
		}
	} else {
		// Single op redo
		const address =
			entry.address !== undefined
				? entry.address
				: calculateCellAddress(activeTableDef, entry.row, entry.col);

		// Apply ROM bytes
		activeRom.bytes.set(entry.newValue, address);

		// Mark the RomDocument as dirty (redo modifies the ROM)
		if (document) {
			document.updateBytes(activeRom.bytes, address, entry.newValue.length);
		}
	}

	// Notify the active webview panel so its UI reflects the redo
	if (activePanel && activeTableDef && activeRom) {
		const newSnapshot = snapshotTable(activeTableDef, activeRom.bytes);
		activePanel.webview.postMessage({
			type: "update",
			snapshot: newSnapshot,
			rom: Array.from(activeRom.bytes),
			reason: "redo",
		});
	}
}

/**
 * Handle math operation: Add constant to selection
 */
async function handleMathOpAdd(): Promise<void> {
	if (!activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const constant = await vscode.window.showInputBox({
		prompt: "Enter constant to add (can be negative)",
		placeHolder: "e.g., 5 or -10",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (constant === undefined) return;

	await activePanel.webview.postMessage({
		type: "mathOp",
		operation: "add",
		constant: Number.parseFloat(constant),
	});
}

/**
 * Handle math operation: Multiply selection by factor
 */
async function handleMathOpMultiply(): Promise<void> {
	if (!activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const factor = await vscode.window.showInputBox({
		prompt: "Enter multiplication factor",
		placeHolder: "e.g., 1.5 or 0.5",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (factor === undefined) return;

	await activePanel.webview.postMessage({
		type: "mathOp",
		operation: "multiply",
		factor: Number.parseFloat(factor),
	});
}

/**
 * Handle math operation: Clamp selection to range
 */
async function handleMathOpClamp(): Promise<void> {
	if (!activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	const min = await vscode.window.showInputBox({
		prompt: "Enter minimum value",
		placeHolder: "e.g., 0",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			return Number.isNaN(num) ? "Please enter a valid number" : null;
		},
	});

	if (min === undefined) return;

	const max = await vscode.window.showInputBox({
		prompt: "Enter maximum value",
		placeHolder: "e.g., 255",
		validateInput: (value) => {
			const num = Number.parseFloat(value);
			if (Number.isNaN(num)) return "Please enter a valid number";
			if (num < Number.parseFloat(min)) {
				return "Maximum must be greater than or equal to minimum";
			}
			return null;
		},
	});

	if (max === undefined) return;

	await activePanel.webview.postMessage({
		type: "mathOp",
		operation: "clamp",
		min: Number.parseFloat(min),
		max: Number.parseFloat(max),
	});
}

/**
 * Handle math operation: Smooth selection (2D/3D only)
 */
async function handleMathOpSmooth(): Promise<void> {
	if (!activePanel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	if (!activeTableDef || activeTableDef.kind === "table1d") {
		vscode.window.showErrorMessage(
			"Smooth operation is only available for 2D and 3D tables",
		);
		return;
	}

	const kernelSize = await vscode.window.showQuickPick(["3", "5", "7", "9"], {
		placeHolder: "Select kernel size",
		title: "Smooth Operation - Kernel Size",
	});

	if (kernelSize === undefined) return;

	const iterations = await vscode.window.showInputBox({
		prompt: "Enter number of iterations",
		placeHolder: "e.g., 1",
		value: "1",
		validateInput: (value) => {
			const num = Number.parseInt(value, 10);
			if (Number.isNaN(num) || num < 1) {
				return "Please enter a positive integer";
			}
			return null;
		},
	});

	if (iterations === undefined) return;

	const boundaryMode = await vscode.window.showQuickPick(
		[
			{ label: "Pad with zeros", value: "pad" },
			{ label: "Repeat edge values", value: "repeat" },
			{ label: "Mirror edge values", value: "mirror" },
		],
		{
			placeHolder: "Select boundary handling mode",
			title: "Smooth Operation - Boundary Mode",
		},
	);

	if (boundaryMode === undefined) return;

	await activePanel.webview.postMessage({
		type: "mathOp",
		operation: "smooth",
		kernelSize: Number.parseInt(kernelSize, 10),
		iterations: Number.parseInt(iterations, 10),
		boundaryMode: boundaryMode.value,
	});
}

/**
 * Handle open graph command
 * Opens a graph window for the currently active table
 */
async function handleOpenGraph(chartType?: "line" | "heatmap"): Promise<void> {
	console.log(
		"[DEBUG] handleOpenGraph: graphPanelManager =",
		!!graphPanelManager,
	);

	if (!graphPanelManager) {
		vscode.window.showErrorMessage("Graph panel manager not initialized");
		return;
	}

	// Try to get active table from active custom editor
	const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
	let rom: RomInstance | null = activeRom;
	let tableName: string | null = activeTableName;
	let tableDef: TableDefinition | null = activeTableDef;
	let panel: vscode.WebviewPanel | null = activePanel;

	if (activeTab?.input instanceof vscode.TabInputCustom) {
		const uri = activeTab.input.uri;
		const tableDoc = editorProvider?.getTableDocument(uri);
		if (tableDoc) {
			tableName = tableDoc.tableId;
			tableDef = tableDoc.tableDef;

			if (!tableDoc.romDocument.definition) {
				vscode.window.showErrorMessage("ROM definition not loaded");
				return;
			}

			rom = {
				id: tableDoc.romDocument.uri.toString(),
				romUri: tableDoc.romDocument.uri.toString(),
				providerId: "",
				defUri: "",
				bytes: tableDoc.romDocument.romBytes,
				definition: tableDoc.romDocument.definition,
			};
			panel = editorProvider?.getPanelForDocument(tableDoc.romDocument) || null;
		}
	}

	if (!rom || !tableName || !tableDef || !panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	try {
		// Get ROM path from active ROM
		const romPath = vscode.Uri.parse(rom.romUri).fsPath;

		// Generate table ID (using table name as ID for now)
		const tableId = tableName;

		// Get current snapshot
		const snapshot = snapshotTable(tableDef, rom.bytes);

		// Open or reveal graph panel
		graphPanelManager.getOrCreatePanel(
			romPath,
			tableId,
			tableName,
			snapshot,
			chartType,
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
async function handleOpenGraphParameterized(
	treeItem: RomTreeItem | undefined,
	editorProvider: RomEditorProvider,
	chartType?: "line" | "heatmap",
): Promise<void> {
	if (!graphPanelManager) {
		vscode.window.showErrorMessage("Graph panel manager not initialized");
		return;
	}

	// If called from context menu with tree item
	if (treeItem && treeItem.data.type === "table") {
		const tableData = treeItem.data;
		const romUri = vscode.Uri.parse(tableData.romUri);
		const tableDef = tableData.tableDef;
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

			// Generate table ID (using table name as ID for now)
			const tableId = tableName;

			// Get current snapshot
			const snapshot = snapshotTable(tableDef, document.romBytes);

			// Open or reveal graph panel
			graphPanelManager.getOrCreatePanel(
				romUri.fsPath,
				tableId,
				tableName,
				snapshot,
				chartType,
			);
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to open graph: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return;
	}

	// If called from command palette without arguments, fall back to active table
	await handleOpenGraph(chartType);
}

/**
 * Handle opening a table from the ECU Explorer tree
 * Called when user clicks on a table node or selects "Open Table" from context menu
 *
 * @param _ctx - Extension context
 * @param romUri - URI of the ROM file
 * @param tableName - Name of the table to open
 */
async function handleOpenTableFromTree(
	_ctx: vscode.ExtensionContext,
	romUri: string,
	tableName: string,
): Promise<void> {
	try {
		// Parse the ROM URI
		const uri = vscode.Uri.parse(romUri);

		// Use the unified openTableInCustomEditor function with preview mode
		// This makes the tab temporary until the user edits it
		await openTableInCustomEditor(uri, tableName, { preview: true });
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to open table: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Handle ROM open flow
 *
 * Opens a ROM file using the CustomEditor, which enables native dirty marker support.
 * The CustomEditor will handle definition matching and table selection.
 *
 * @param _ctx - Extension context (unused)
 */
async function openRomFlow(_ctx: vscode.ExtensionContext) {
	const pick = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { ROM: ["bin", "rom", "hex"] },
		openLabel: "Open ROM",
	});
	const romUri = pick?.at(0);
	if (!romUri) return;

	// Open with CustomEditor instead of creating WebviewPanel directly
	// This enables native dirty marker (●) in tabs
	await vscode.commands.executeCommand(
		"vscode.openWith",
		romUri,
		"romViewer.editor",
	);
}

/**
 * Handle table open flow
 *
 * Shows user a list of available tables from the active ROM
 * and opens the selected table using the unified Custom Editor infrastructure.
 *
 * @param _ctx - Extension context
 */
async function openTableFlow(_ctx: vscode.ExtensionContext) {
	if (!activeRom) {
		vscode.window.showWarningMessage("Open a ROM first.");
		return;
	}

	type TablePickItem = vscode.QuickPickItem & { def: TableDefinition };
	const items: TablePickItem[] = activeRom.definition.tables.map((t) => ({
		label: t.name,
		...(t.category ? { description: t.category } : {}),
		detail: t.kind,
		def: t,
	}));

	const picked = await vscode.window.showQuickPick<TablePickItem>(items, {
		placeHolder: "Select a table",
	});
	if (!picked) return;

	// Use unified Custom Editor infrastructure (Phase 3)
	const romUri = vscode.Uri.parse(activeRom.romUri);
	await openTableInCustomEditor(romUri, picked.def.name);
}

/**
 * Deactivate the ECU Explorer extension
 * Clean up resources and dispose of managers
 */
export function deactivate() {
	if (graphPanelManager) {
		graphPanelManager.dispose();
		graphPanelManager = null;
	}

	// Flush workspace state before deactivation
	if (workspaceState) {
		workspaceState.flush();
		workspaceState = null;
	}
}
