import {
	type DefinitionProvider,
	decodeScalarBytes,
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";
import type { EcuEvent, RomProgress } from "@ecu-explorer/device";
import type {
	HardwareLocality,
	SerialRuntime,
} from "@ecu-explorer/device/hardware-runtime";
import { MitsubishiBootloaderProtocol } from "@ecu-explorer/device-protocol-mitsubishi-bootloader";
import { Mut3Protocol } from "@ecu-explorer/device-protocol-mut3";
import { Obd2Protocol } from "@ecu-explorer/device-protocol-obd2";
import { SubaruProtocol } from "@ecu-explorer/device-protocol-subaru";
import { UdsProtocol } from "@ecu-explorer/device-protocol-uds";
import { OpenPort2Transport } from "@ecu-explorer/device-transport-openport2";
import { AemSerialWidebandAdapter } from "@ecu-explorer/wideband";
import * as vscode from "vscode";
import {
	AutoReconnectController,
	canReconnectToPreferredWideband,
	hasRememberedHardwareSelection,
	reconnectPreferredWideband,
} from "./auto-reconnect.js";
import {
	handleMathOpAdd,
	handleMathOpClamp,
	handleMathOpMultiply,
	handleMathOpSmooth,
	handleRedo,
	handleUndo,
	setEditCommandsContext,
	setGraphCommandsContext,
} from "./commands/index.js";
import { readConfig } from "./config.js";
import { exportActiveTableCsvFlow } from "./csv/export.js";
import { importTableFromCsvFlow } from "./csv/import.js";
import { DeviceManagerImpl } from "./device-manager.js";
import { DeviceStatusBarManager } from "./device-status-bar.js";
import { GraphPanelManager } from "./graph-panel-manager.js";
import { GraphPanelSerializer } from "./graph-panel-serializer.js";
import {
	handleCellEdit,
	handleTableOpen,
	setCellEditHandlerContext,
	setTableHandlerContext,
} from "./handlers/index.js";
import {
	HardwareSelectionService,
	WorkspaceHardwareSelectionStrategy,
} from "./hardware-selection.js";
import { selectHardwareCandidateFromSource } from "./hardware-source.js";
import type { TableEditSession } from "./history/table-edit-session.js";
import { LiveDataPanelManager } from "./live-data-panel-manager.js";
import { LoggingManager, openLogsFolder } from "./logging-manager.js";
import { resolveRomDefinition } from "./rom/definition-resolver.js";
import type { RomDocument } from "./rom/document.js";
import {
	RomEditorProvider,
	TableEditorDelegate,
} from "./rom/editor-provider.js";
import { RomSymbolProvider } from "./rom/symbol-provider.js";
import { TableFileSystemProvider } from "./table-fs-provider.js";
import { createTableUri, parseTableUri } from "./table-fs-uri.js";
import { getThemeColors } from "./theme-colors.js";
import type { RomTreeItem } from "./tree/rom-tree-item.js";
import { RomExplorerTreeProvider } from "./tree/rom-tree-provider.js";
import { WidebandManager } from "./wideband-manager.js";
import {
	DEFAULT_WIDEBAND_SELECTION_SLOT,
	promptForWidebandMode,
	WidebandSerialHardwareSource,
} from "./wideband-serial-source.js";
import { WorkspaceState } from "./workspace-state.js";

type ActivationOptions = {
	openPortRuntime?: ConstructorParameters<typeof OpenPort2Transport>[0];
	hardwareLocality?: HardwareLocality;
	widebandSerialRuntime?: SerialRuntime;
};

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
/** Per-tab edit sessions keyed by table URI string */
const tableSessions = new Map<string, TableEditSession>();
let activeTableSession: TableEditSession | null = null;
/** Active table panel for the currently focused table session */
let activePanel: vscode.WebviewPanel | null = null;
// statusBarItem removed - using VSCode's built-in dirty state indicator
let treeProvider: RomExplorerTreeProvider | null = null;
let graphPanelManager: GraphPanelManager | null = null;
let liveDataPanelManager: LiveDataPanelManager | null = null;
let loggingManager: LoggingManager | null = null;
let deviceManager: DeviceManagerImpl | null = null;
let widebandManager: WidebandManager | null = null;
let editorProvider: RomEditorProvider | null = null; // Will be set during activation
let workspaceState: WorkspaceState | null = null; // Workspace state manager
let activeWidebandMode: "afr" | "lambda" | undefined;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}

	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}

	return true;
}

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

	if (activeUri?.scheme === "ecu-table") {
		return parseTableUri(activeUri)?.romPath ?? null;
	}

	return null;
}

/**
 * Manages selection synchronization across different panels for the same ROM.
 */

/**
 * Represents a cell selection in a table
 */
type TableSelection = { row: number; col: number } | null;

class SelectionManager {
	// ROM Path -> Table ID -> Selection
	private selections = new Map<string, Map<string, TableSelection>>();

	/**
	 * Update selection for a specific table in a ROM
	 */
	updateSelection(romPath: string, tableId: string, selection: TableSelection) {
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
	getSelection(romPath: string, tableId: string): TableSelection | undefined {
		return this.selections.get(romPath)?.get(tableId);
	}

	private broadcast(
		romPath: string,
		tableId: string,
		selection: TableSelection,
	) {
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
 * @param tableId - Stable ID of the table to open (required)
 * @param tableName - Optional human-readable table name for presentation
 * @param _options - View column and focus options for the editor
 * @returns Promise that resolves when the custom editor is opened
 */
async function openTableInCustomEditor(
	romUri: vscode.Uri,
	tableId: string,
	tableName?: string,
	options?: {
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
	const tableUri = createTableUri(romUri.fsPath, tableId, tableName);
	console.log(
		"[DEBUG] openTableInCustomEditor - Created URI:",
		tableUri.toString(),
	);

	// Open the table with the custom editor
	// VSCode will automatically focus existing tab if this table is already open
	console.log(
		"[DEBUG] openTableInCustomEditor - viewType: romViewer.tableEditor",
	);
	const editorOptions = {
		preview: options?.preview,
		preserveFocus: options?.preserveFocus,
	};

	if (options?.viewColumn !== undefined) {
		await vscode.commands.executeCommand(
			"vscode.openWith",
			tableUri,
			"romViewer.tableEditor",
			options.viewColumn,
			editorOptions,
		);
		return;
	}

	await vscode.commands.executeCommand(
		"vscode.openWith",
		tableUri,
		"romViewer.tableEditor",
		editorOptions,
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

function findTableSession(
	romPath: string,
	tableId: string,
): TableEditSession | undefined {
	for (const session of tableSessions.values()) {
		if (
			session.romDocument.uri.fsPath === romPath &&
			session.tableDef.id === tableId
		) {
			return session;
		}
	}

	return undefined;
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
export async function activate(
	ctx: vscode.ExtensionContext,
	options?: ActivationOptions,
) {
	// Initialize providers based on current settings
	reinitializeProviders();

	// Initialize GraphPanelManager
	graphPanelManager = new GraphPanelManager(
		ctx,
		(romPath: string) => {
			const directDocument = editorProvider?.getDocument(
				vscode.Uri.file(romPath),
			);
			if (directDocument) {
				return directDocument;
			}

			// Fallback to panel mapping for already-associated editors
			for (const [_panel, doc] of panelToDocument.entries()) {
				if (doc.uri.fsPath === romPath) {
					return doc;
				}
			}
			return undefined;
		},
		(romPath: string, tableId: string) => {
			const document =
				editorProvider?.getDocument(vscode.Uri.file(romPath)) ??
				(() => {
					for (const [_panel, doc] of panelToDocument.entries()) {
						if (doc.uri.fsPath === romPath) {
							return doc;
						}
					}
					return undefined;
				})();

			if (!document?.definition?.tables) {
				return undefined;
			}

			const tableDef: TableDefinition | undefined =
				document.definition.tables.find((t) => t.id === tableId) ??
				document.definition.tables.find((t) => t.name === tableId);

			if (tableDef) {
				return snapshotTable(tableDef, document.romBytes);
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
		(romPath: string, tableId: string) => findTableSession(romPath, tableId),
	);

	// Initialize context setters for handler modules
	// These allow handlers to access extension state
	setTableHandlerContext(() => ({
		activeRom,
		activeTableName,
		activeTableDef,
		activePanel,
		panelToDocument,
		tableSessions,
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
		notifyTableSessionAvailable: (session) => {
			graphPanelManager?.handleTableSessionAvailable(session);
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
				activeTableSession,
				panelToDocument,
			);
		},
		openTableInCustomEditor,
	}));

	setCellEditHandlerContext(() => ({
		activeRom,
		activeTableSession,
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
		activePanel,
		activeTableSession,
		editorProvider,
		getTableSessionForUri: (uri: vscode.Uri) =>
			tableSessions.get(uri.toString()) ?? null,
	}));

	setGraphCommandsContext(() => ({
		graphPanelManager,
		activeRom,
		activeTableName,
		activeTableDef,
		activePanel,
		editorProvider,
	}));

	workspaceState = new WorkspaceState(ctx.workspaceState);

	// Initialize DeviceManager and register transport/protocol
	deviceManager = new DeviceManagerImpl();
	deviceManager.setHardwareCandidateLocality(
		options?.hardwareLocality ?? "extension-host",
	);
	deviceManager.registerTransport(
		"openport2",
		new OpenPort2Transport(options?.openPortRuntime),
	);
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

	// Listen for connection state changes and show appropriate status messages
	ctx.subscriptions.push(
		deviceManager.onDidChangeState(({ state, cause }) => {
			switch (state) {
				case "degraded":
					vscode.window.showWarningMessage(
						`Connection degraded. Heartbeat missed. Cause: ${cause ?? "unknown"}`,
					);
					break;
				case "reconnecting":
					vscode.window.showInformationMessage("Attempting to reconnect...");
					break;
				case "connected":
					vscode.window.showInformationMessage("Connection restored.");
					break;
				case "failed":
					vscode.window.showErrorMessage(
						`Connection failed. Cause: ${cause ?? "unknown"}. Please reconnect manually.`,
					);
					break;
				case "resetting":
					vscode.window.showInformationMessage("ECU reset in progress...");
					break;
			}
		}),
	);

	const hardwareLocality = options?.hardwareLocality ?? "extension-host";
	if (workspaceState == null) {
		throw new Error("Workspace state not initialized");
	}
	const persistedWorkspaceState = workspaceState;
	const ecuSelectionService = new HardwareSelectionService(
		persistedWorkspaceState,
	);
	const ecuSelectionStrategy = new WorkspaceHardwareSelectionStrategy(
		ecuSelectionService,
	);
	deviceManager.setHardwareSelectionStrategy(ecuSelectionStrategy);
	const widebandSelectionService = new HardwareSelectionService(
		persistedWorkspaceState,
		DEFAULT_WIDEBAND_SELECTION_SLOT,
	);
	const widebandSelectionStrategy = new WorkspaceHardwareSelectionStrategy(
		widebandSelectionService,
	);
	const widebandSerialSource =
		options?.widebandSerialRuntime != null
			? new WidebandSerialHardwareSource(
					options.widebandSerialRuntime,
					hardwareLocality,
				)
			: undefined;
	if (widebandSerialSource != null) {
		widebandManager = new WidebandManager(() =>
			widebandSerialSource.listCandidates(),
		);
		ctx.subscriptions.push(widebandManager);
		ctx.subscriptions.push(
			widebandManager.onDidChangeSession((session) => {
				vscode.commands.executeCommand(
					"setContext",
					"ecuExplorer.widebandConnected",
					session != null,
				);
				if (session == null) {
					activeWidebandMode = undefined;
				}
			}),
			widebandManager.onDidRead((reading) => {
				loggingManager?.onChannelSample(
					"wideband-primary",
					reading.timestamp,
					reading.value,
				);
			}),
		);
	} else {
		widebandManager = null;
		void vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.widebandConnected",
			false,
		);
	}

	const deviceStatusBarManager = new DeviceStatusBarManager(
		deviceManager,
		ecuSelectionService,
		widebandManager ?? undefined,
	);
	ctx.subscriptions.push(deviceStatusBarManager);

	const ecuAutoReconnectController = new AutoReconnectController(
		() =>
			deviceManager != null &&
			deviceManager.activeConnection == null &&
			hasRememberedHardwareSelection(ecuSelectionService),
		async () => {
			if (deviceManager == null) {
				return false;
			}
			try {
				await deviceManager.connect({ silent: true });
				return true;
			} catch {
				return false;
			}
		},
	);
	ctx.subscriptions.push(ecuAutoReconnectController);

	let widebandAutoReconnectController: AutoReconnectController | undefined;
	if (
		widebandManager != null &&
		widebandSerialSource != null &&
		options?.widebandSerialRuntime != null
	) {
		const reconnectWidebandManager = widebandManager;
		const reconnectWidebandRuntime = options.widebandSerialRuntime;
		widebandAutoReconnectController = new AutoReconnectController(
			() =>
				canReconnectToPreferredWideband({
					manager: reconnectWidebandManager,
					selectionService: widebandSelectionService,
					mode: persistedWorkspaceState.getWidebandMode(
						DEFAULT_WIDEBAND_SELECTION_SLOT,
					),
				}),
			async () => {
				const mode = persistedWorkspaceState.getWidebandMode(
					DEFAULT_WIDEBAND_SELECTION_SLOT,
				);
				if (mode == null) {
					return false;
				}
				try {
					reconnectWidebandManager.setReconnectState("reconnecting");
					const reconnected = await reconnectPreferredWideband({
						manager: reconnectWidebandManager,
						selectionService: widebandSelectionService,
						runtime: reconnectWidebandRuntime,
						mode,
					});
					if (reconnected) {
						activeWidebandMode = mode;
					}
					return reconnected;
				} catch {
					reconnectWidebandManager.setReconnectState("failed");
					activeWidebandMode = undefined;
					return false;
				}
			},
		);
		ctx.subscriptions.push(widebandAutoReconnectController);
	}

	ctx.subscriptions.push(
		vscode.commands.registerCommand("ecuExplorer.connectDevice", async () => {
			// Keep reconnect suppressed while the user is explicitly choosing a
			// replacement interface so the previous preferred device cannot
			// reclaim the connection in the background during the picker flow.
			ecuAutoReconnectController.suppress();
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
				await deviceManager.connect({ forcePrompt: true });
				ecuAutoReconnectController.resume(false);
			} catch (err) {
				if (err instanceof vscode.CancellationError) {
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
				ecuAutoReconnectController.suppress();
				if (!deviceManager?.activeConnection) {
					return;
				}
				const deviceName = deviceManager.activeConnection.deviceName;
				await deviceManager.disconnect();
				vscode.window.showInformationMessage(
					`Disconnected from ${deviceName}.`,
				);
			},
		),
		vscode.commands.registerCommand("ecuExplorer.connectWideband", async () => {
			// Keep reconnect suppressed while the user is explicitly choosing a
			// replacement device so the previous preferred device cannot reclaim
			// the session in the background during the picker flow.
			widebandAutoReconnectController?.suppress();
			if (widebandManager == null || widebandSerialSource == null) {
				vscode.window.showErrorMessage(
					"Wideband serial runtime is not available in this host.",
				);
				return;
			}
			if (widebandManager.activeSession) {
				vscode.window.showInformationMessage(
					`Already connected to ${widebandManager.activeSession.candidate.device.name}. Disconnect first.`,
				);
				return;
			}

			try {
				const mode = await promptForWidebandMode();
				const widebandRuntime = options?.widebandSerialRuntime;
				if (widebandRuntime == null) {
					throw new Error("Wideband serial runtime is not available.");
				}
				widebandManager.setAdapters([
					new AemSerialWidebandAdapter(widebandRuntime, mode),
				]);
				const candidate = await selectHardwareCandidateFromSource({
					source: widebandSerialSource,
					strategy: widebandSelectionStrategy,
					forcePrompt: true,
					emptyMessage:
						"No wideband serial devices found. Connect a device or request a browser serial port.",
				});
				await widebandManager.openCandidate(candidate);
				widebandSelectionStrategy.rememberCandidate(candidate);
				persistedWorkspaceState.saveWidebandMode(
					DEFAULT_WIDEBAND_SELECTION_SLOT,
					mode,
				);
				activeWidebandMode = mode;
				widebandAutoReconnectController?.resume(false);
				vscode.window.showInformationMessage(
					`Connected to ${candidate.device.name}.`,
				);
			} catch (err) {
				if (err instanceof vscode.CancellationError) {
					return;
				}
				if (
					err instanceof Error &&
					err.message === "Device selection cancelled by user"
				) {
					return;
				}
				activeWidebandMode = undefined;
				vscode.window.showErrorMessage(
					`Failed to connect wideband: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
		vscode.commands.registerCommand(
			"ecuExplorer.disconnectWideband",
			async () => {
				widebandAutoReconnectController?.suppress();
				if (widebandManager == null) {
					return;
				}
				const deviceName =
					widebandManager.activeSession?.candidate.device.name ??
					widebandManager.lastCandidate?.device.name;
				await widebandManager.disconnect();
				activeWidebandMode = undefined;
				if (deviceName != null) {
					vscode.window.showInformationMessage(
						`Disconnected from ${deviceName}.`,
					);
				}
			},
		),
	);

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
			async (
				romUriOrTreeItem: string | RomTreeItem,
				tableIdOrName?: string,
				tableName?: string,
			) => {
				// Handle both direct command invocation and context menu invocation
				let romUri: string;
				let tableIdResolved: string;
				let tableNameResolved: string | undefined;

				if (typeof romUriOrTreeItem === "string") {
					// Direct command invocation with arguments
					romUri = romUriOrTreeItem;
					if (!tableIdOrName) {
						throw new Error("tableId is required when romUri is a string");
					}
					tableIdResolved = tableIdOrName;
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
					tableIdResolved = treeItem.data.tableDef.id;
					tableNameResolved = treeItem.data.tableDef.name;
				}

				await handleOpenTableFromTree(
					ctx,
					romUri,
					tableIdResolved,
					tableNameResolved,
				);
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
				activeTableSession,
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
		vscode.commands.registerCommand("ecuExplorer.startLog", async () => {
			if (!loggingManager) {
				return;
			}
			const active = deviceManager?.activeConnection;
			const activeWideband = widebandManager?.activeSession;
			if (!active && !activeWideband) {
				vscode.window.showErrorMessage(
					"No live data source connected. Connect an ECU or wideband first.",
				);
				return;
			}
			const pids =
				active?.protocol.getSupportedPids != null
					? await active.protocol.getSupportedPids(active.connection)
					: [];
			const channels =
				activeWidebandMode == null
					? []
					: [
							{
								key: "wideband-primary",
								name:
									activeWidebandMode === "afr"
										? "Wideband AFR"
										: "Wideband Lambda",
								unit: activeWidebandMode === "afr" ? "AFR" : "lambda",
							},
						];
			await loggingManager.startLog({ pids, channels });
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
			() => handleOpenGraph(),
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open3DGraphForActiveTable",
			() => handleOpenGraph(),
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open2DGraph",
			async (treeItem?: RomTreeItem) => {
				if (editorProvider) {
					await handleOpenGraphParameterized(treeItem, editorProvider);
				}
			},
		),
		vscode.commands.registerCommand(
			"ecuExplorer.open3DGraph",
			async (treeItem?: RomTreeItem) => {
				if (editorProvider) {
					await handleOpenGraphParameterized(treeItem, editorProvider);
				}
			},
		),
	);

	// Set of URI strings currently being saved by the extension.
	// Used to suppress spurious file watcher callbacks for self-initiated saves.
	const savingRomUris = new Set<string>();
	// Tracks the exact bytes written by the most recent self-save for each ROM.
	// The next watcher event carrying these bytes is ignored even if it arrives
	// after the coarse save-in-progress suppression window has expired.
	const pendingSavedRomBytes = new Map<string, Uint8Array>();

	// Register CustomEditorProvider for native dirty marker support
	const newEditorProvider = new RomEditorProvider(
		ctx,
		registry,
		async (document, panel) => {
			await handleTableOpen(document, panel, ctx);
		},
		savingRomUris,
		(savedDocument) => {
			pendingSavedRomBytes.set(
				savedDocument.uri.toString(),
				new Uint8Array(savedDocument.romBytes),
			);

			// Mark the current history position as the clean baseline for all
			// open table tabs backed by this ROM. Undo/redo must remain available
			// across saves, but dirty tracking should now compare against this
			// persisted state instead of the original open state.
			for (const session of tableSessions.values()) {
				session.markSavedIfForRom(savedDocument);
			}
		},
		async (document, action) => {
			const session = tableSessions.get(document.uri.toString());
			if (!session) {
				return;
			}

			const result = action === "undo" ? session.undo() : session.redo();
			if (!result) {
				return;
			}

			activeRom =
				activeRom && activeRom.romUri === session.romDocument.uri.toString()
					? { ...activeRom, bytes: session.romDocument.romBytes }
					: activeRom;

			const panel = session.activePanel ?? activePanel;
			if (panel) {
				await panel.webview.postMessage(result.message);
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
				const pendingSavedBytes = pendingSavedRomBytes.get(uriStr);
				if (pendingSavedBytes && bytesEqual(newBytes, pendingSavedBytes)) {
					pendingSavedRomBytes.delete(uriStr);
					return;
				}

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
			graphPanelManager?.handleRomDocumentOpened(doc);
			watchRomDocument(doc);
		}),
	);

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

					// Switch to the per-tab session for the newly-active tab
					const tabKey = activeTab.input.uri.toString();
					activeTableSession = tableSessions.get(tabKey) ?? null;

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

/**
 * Handle open graph command
 * Opens a graph window for the currently active table
 */
async function handleOpenGraph(): Promise<void> {
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
	let tableId: string | null = activeTableName;
	let tableName: string | null = activeTableDef?.name ?? null;
	let tableDef: TableDefinition | null = activeTableDef;
	let panel: vscode.WebviewPanel | null = activePanel;

	if (activeTab?.input instanceof vscode.TabInputCustom) {
		const uri = activeTab.input.uri;
		const tableDoc = editorProvider?.getTableDocument(uri);
		if (tableDoc) {
			tableId = tableDoc.tableId;
			tableName = tableDoc.tableDef.name;
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

	if (!rom || !tableId || !tableName || !tableDef || !panel) {
		vscode.window.showErrorMessage("No active table editor");
		return;
	}

	try {
		// Get ROM path from active ROM
		const romPath = vscode.Uri.parse(rom.romUri).fsPath;
		const definitionUri = activeTableSession?.romDocument.definition?.uri;

		// Get current snapshot
		const snapshot = snapshotTable(tableDef, rom.bytes);

		// Open or reveal graph panel
		graphPanelManager.getOrCreatePanel(
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
async function handleOpenGraphParameterized(
	treeItem: RomTreeItem | undefined,
	editorProvider: RomEditorProvider,
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
			graphPanelManager.getOrCreatePanel(
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
 */
async function handleOpenTableFromTree(
	_ctx: vscode.ExtensionContext,
	romUri: string,
	tableId: string,
	tableName?: string,
): Promise<void> {
	try {
		// Parse the ROM URI
		const uri = vscode.Uri.parse(romUri);

		// Use the unified openTableInCustomEditor function with preview mode
		// This makes the tab temporary until the user edits it
		await openTableInCustomEditor(uri, tableId, tableName, { preview: true });
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
	await openTableInCustomEditor(romUri, picked.def.id, picked.def.name);
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
