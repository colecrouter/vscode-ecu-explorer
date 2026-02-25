import type {
	ChecksumDefinition,
	DefinitionProvider,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import { OpenContextTracker } from "../open-context-tracker.js";
import { TableDocument } from "../table-document.js";
import { isTableUri, parseTableUri } from "../table-fs-uri.js";
import type { RomExplorerTreeProvider } from "../tree/rom-tree-provider.js";
import { WorkspaceState } from "../workspace-state.js";
import { resolveRomDefinition } from "./definition-resolver.js";
import { RomDocument } from "./document.js";
import { RomSaveManager } from "./save-manager.js";

/**
 * Custom editor provider for ROM files
 * Implements VSCode's CustomEditorProvider to enable native dirty marker,
 * save prompts, and lifecycle integration
 *
 * This provider works alongside the existing command-based flow,
 * providing native VSCode integration for ROM files.
 */
export class RomEditorProvider
	implements vscode.CustomEditorProvider<RomDocument | TableDocument>
{
	private readonly saveManager = new RomSaveManager();

	/**
	 * Emitter for ROM document changes (used by romViewer.editor registration).
	 * Fires only for RomDocument instances opened via romViewer.editor.
	 */
	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
		vscode.CustomDocumentEditEvent<RomDocument | TableDocument>
	>();
	readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

	/**
	 * Separate emitter for table document changes.
	 * Used by a dedicated TableEditorDelegate (romViewer.tableEditor registration)
	 * so that VSCode's romViewer.editor registration never sees TableDocument events,
	 * preventing "No custom document found" errors.
	 */
	readonly _onDidChangeTableDocument = new vscode.EventEmitter<
		vscode.CustomDocumentEditEvent<TableDocument>
	>();

	private readonly _onDidOpenRomDocument =
		new vscode.EventEmitter<RomDocument>();
	/** Fired whenever a new RomDocument is created and registered */
	readonly onDidOpenRomDocument = this._onDidOpenRomDocument.event;

	// Store active documents by URI
	private readonly documents = new Map<string, RomDocument>();
	private readonly tableDocuments = new Map<string, TableDocument>();

	// Track which webview panel corresponds to each ROM document (ROM editor tabs only)
	// This map is ONLY for ROM editor tabs (romViewer.editor), NOT table editor tabs.
	// Using this for table editors would cause "No custom document found" errors.
	private readonly documentToPanelMap = new Map<
		RomDocument,
		vscode.WebviewPanel
	>();

	// Track which webview panel corresponds to each ROM document via a TABLE editor tab.
	// This is separate from documentToPanelMap to avoid triggering the ROM document's
	// _onDidChangeCustomDocument for table URIs. Table editor dirty state is tracked
	// through TableDocument.onDidChange instead.
	private readonly romToTablePanelMap = new Map<
		RomDocument,
		vscode.WebviewPanel
	>();

	// Tree provider reference (set after construction)
	private treeProvider?: RomExplorerTreeProvider;

	// Workspace state manager
	private readonly stateManager: WorkspaceState;

	// Context tracker for MCP
	private readonly contextTracker: OpenContextTracker;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly providerRegistry: { list(): DefinitionProvider[] },
		private readonly onTableOpen?: (
			document: RomDocument | TableDocument,
			webviewPanel: vscode.WebviewPanel,
		) => Promise<void>,
		/** Set of URI strings currently being saved by the extension (for watcher suppression) */
		private readonly savingRomUris?: Set<string>,
		/** Called after a successful save so callers can reset undo/redo history */
		private readonly onAfterSave?: (document: RomDocument) => void,
	) {
		this.stateManager = new WorkspaceState(context.workspaceState);
		this.contextTracker = new OpenContextTracker();
	}

	/**
	 * Set the tree provider (called after tree provider is created)
	 */
	setTreeProvider(provider: RomExplorerTreeProvider): void {
		this.treeProvider = provider;
	}

	/**
	 * Get document for a URI (used by extension to access document state)
	 */
	getDocument(uri: vscode.Uri): RomDocument | undefined {
		return this.documents.get(uri.toString());
	}

	/**
	 * Get table document for a URI
	 */
	getTableDocument(uri: vscode.Uri): TableDocument | undefined {
		return this.tableDocuments.get(uri.toString());
	}

	/**
	 * Get webview panel for a document (used to send messages to existing panels)
	 * Checks both ROM editor panels and table editor panels.
	 */
	getPanelForDocument(document: RomDocument): vscode.WebviewPanel | undefined {
		return (
			this.documentToPanelMap.get(document) ??
			this.romToTablePanelMap.get(document)
		);
	}

	/**
	 * Get the current open documents context
	 */
	getOpenContext() {
		return this.contextTracker.getContext();
	}

	/**
	 * Listen for context updates
	 */
	onOpenContextUpdate(
		listener: (
			context: import("../open-context-tracker.js").OpenDocumentsContext,
		) => void,
	): vscode.Disposable {
		return this.contextTracker.onContextUpdate(listener);
	}

	/**
	 * Handle selection change from external source (e.g. graph panel)
	 */
	handleExternalSelectionChange(
		romPath: string,
		tableId: string,
		selection: any,
	) {
		// Find the document for this ROM
		for (const [_uri, doc] of this.documents.entries()) {
			if (doc.uri.fsPath === romPath) {
				// Check both ROM editor and table editor panels (table editor takes priority)
				const panel =
					this.romToTablePanelMap.get(doc) ?? this.documentToPanelMap.get(doc);
				if (panel) {
					panel.webview.postMessage({
						type: "selectCells",
						selection,
						tableId, // Optional: table webview might want to know which table this is for
					});
				}
				break;
			}
		}
	}

	/**
	 * Open a custom document (ROM file or table)
	 * Called when a ROM file or table URI is opened
	 */
	async openCustomDocument(
		uri: vscode.Uri,
		openContext: vscode.CustomDocumentOpenContext,
		token: vscode.CancellationToken,
	): Promise<RomDocument | TableDocument> {
		// Check if this is a table URI (ecu-table:// scheme)
		if (isTableUri(uri)) {
			return this.openTableDocument(uri, token);
		}

		// Only handle file:// URIs as ROM documents.
		// Reject untitled:, vscode-userdata:, and other non-file schemes to
		// prevent intercepting "New Text File" (untitled:Untitled-1) and similar.
		if (uri.scheme !== "file") {
			throw new Error(
				`Unsupported URI scheme "${uri.scheme}" for ROM editor. Only file:// and ecu-table:// URIs are supported.`,
			);
		}

		// Otherwise, open as ROM document
		return this.openRomDocument(uri, openContext, token);
	}

	/**
	 * Open a ROM document
	 * Extracted from openCustomDocument to support both direct ROM opening and table URIs
	 */
	private async openRomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): Promise<RomDocument> {
		// Check if we already have this document
		const existing = this.documents.get(uri.toString());
		if (existing) {
			return existing;
		}

		// Read ROM file
		const romBytes = new Uint8Array(await vscode.workspace.fs.readFile(uri));

		// Resolve the ROM definition (checks saved state, auto-matches, or prompts user)
		const definition = await resolveRomDefinition(
			uri,
			romBytes,
			this.providerRegistry,
			this.stateManager,
		);

		// Create document (definition may be undefined if user cancelled)
		const document = new RomDocument(uri, romBytes, definition);

		// Store document
		this.documents.set(uri.toString(), document);

		// Notify listeners that a new ROM document has been opened
		this._onDidOpenRomDocument.fire(document);

		// Add to tree provider if available
		if (this.treeProvider) {
			this.treeProvider.addDocument(document);
		}

		// Track open ROM in context tracker
		this.contextTracker.addRomDocument(document);

		// Listen for changes to the document.
		// Only fire _onDidChangeCustomDocument when there is an open ROM editor
		// panel for this document. When only table tabs are open (no ROM editor
		// tab), calling this would cause VS Code to throw "No custom document
		// found" because the ROM document has no associated open editor.
		const changeListener = document.onDidChange(() => {
			if (this.documentToPanelMap.has(document)) {
				this._onDidChangeCustomDocument.fire({
					document,
					undo: () => {
						// Undo is handled by the webview and extension
					},
					redo: () => {
						// Redo is handled by the webview and extension
					},
				});
			}
		});

		// Clean up listener when document is disposed
		document.onDidDispose(() => {
			changeListener.dispose();
			// Note: We intentionally do NOT remove the document from the tree provider
			// or delete it from this.documents. Once a ROM is loaded, it stays in the
			// sidebar permanently. This prevents the ROM from disappearing when the
			// editor tab is closed while table editors are still open.
		});

		return document;
	}

	/**
	 * Open a table document
	 * Creates a TableDocument that references a parent ROM document
	 */
	private async openTableDocument(
		uri: vscode.Uri,
		token: vscode.CancellationToken,
	): Promise<TableDocument> {
		// Return existing TableDocument if already open (avoids duplicate listeners)
		const existingTableDoc = this.tableDocuments.get(uri.toString());
		if (existingTableDoc) {
			return existingTableDoc;
		}

		const tableUri = parseTableUri(uri);
		if (!tableUri) {
			throw new Error(`Invalid table URI: ${uri.toString()}`);
		}

		// Find or open the parent ROM document
		const romUri = vscode.Uri.file(tableUri.romPath);
		let romDocument = this.documents.get(romUri.toString());

		if (!romDocument) {
			// Open the ROM document first
			const openContext: vscode.CustomDocumentOpenContext = {
				backupId: undefined,
				untitledDocumentData: undefined,
			};
			romDocument = await this.openRomDocument(romUri, openContext, token);
		}

		// Find the table definition
		const tableDef = romDocument.definition?.tables.find(
			(t) => t.name === tableUri.tableName,
		);

		if (!tableDef) {
			throw new Error(
				`Table "${tableUri.tableName}" not found in ROM definition`,
			);
		}

		// Create table document
		const tableDocument = new TableDocument(
			uri,
			romDocument,
			tableUri.tableName,
			tableDef,
		);
		this.tableDocuments.set(uri.toString(), tableDocument);

		// Track open table in context tracker
		this.contextTracker.addTableDocument(tableDocument);

		// Listen for changes to the table document.
		// Only notify VSCode about DIRTY edits (not clean transitions like save/revert).
		// VSCode handles clean state transitions via saveCustomDocument/revertCustomDocument.
		// Firing _onDidChangeTableDocument for clean transitions would incorrectly
		// mark the next focused document as dirty after tab close.
		//
		// IMPORTANT: We use _onDidChangeTableDocument (not _onDidChangeCustomDocument)
		// so that only the romViewer.tableEditor registration (TableEditorDelegate) sees
		// these events. The shared _onDidChangeCustomDocument is consumed by BOTH
		// romViewer.editor and romViewer.tableEditor; firing it for TableDocument causes
		// VSCode's romViewer.editor registration to throw "No custom document found".
		const changeListener = tableDocument.onDidChange(() => {
			const uriStr = uri.toString();
			// Guard 1: only fire if the table document is still registered
			if (!this.tableDocuments.has(uriStr)) {
				return;
			}
			// Guard 2: only fire for dirty edits
			// (romChangeListener fires _onDidChange for clean transitions too,
			// but those should not be forwarded to VSCode's document change system)
			if (!tableDocument.isDirty) {
				return;
			}
			this._onDidChangeTableDocument.fire({
				document: tableDocument,
				undo: () => {
					// Undo is handled by the webview and extension
				},
				redo: () => {
					// Redo is handled by the webview and extension
				},
			});
		});

		// Clean up when table document is disposed
		tableDocument.onDidDispose(() => {
			changeListener.dispose();
			this.tableDocuments.delete(uri.toString());
		});

		return tableDocument;
	}

	/**
	 * Resolve a custom editor for a document
	 * Called when the editor is opened
	 */
	async resolveCustomEditor(
		document: RomDocument | TableDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// Check if this is a table document
		if (document instanceof TableDocument) {
			return this.resolveTableEditor(document, webviewPanel, _token);
		}

		// Otherwise, handle as ROM document (existing logic)
		// Store the panel in the map for save notifications
		this.documentToPanelMap.set(document, webviewPanel);

		// Clean up when panel is disposed
		webviewPanel.onDidDispose(() => {
			this.documentToPanelMap.delete(document);
		});

		// If we have a table open callback, use it
		// This allows the existing extension code to handle the table selection flow
		if (this.onTableOpen) {
			await this.onTableOpen(document, webviewPanel);
			return;
		}

		// Otherwise, show a simple message
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
			],
		};

		webviewPanel.webview.html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>ROM Editor</title>
</head>
<body>
	<h1>ROM File Opened</h1>
	<p>Use the "ECU Explorer: Open Table" command to view tables.</p>
	<p>File: ${document.uri.fsPath.split("/").pop()}</p>
	${document.definition ? `<p>Definition: ${document.definition.name}</p>` : "<p>No definition found. Use 'ECU Explorer: Open ROM' to select a definition.</p>"}
</body>
</html>`;
	}

	/**
	 * Resolve a table editor
	 * Delegates to the onTableOpen callback if available
	 */
	private async resolveTableEditor(
		document: TableDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// Store in romToTablePanelMap (NOT documentToPanelMap) so getPanelForDocument
		// can find this panel without triggering the ROM editor's change notification.
		// documentToPanelMap is only for ROM editor tabs; using it here would cause
		// the RomDocument.onDidChange listener to fire _onDidChangeCustomDocument with
		// the RomDocument, leading to "No custom document found" errors from VSCode.
		this.romToTablePanelMap.set(document.romDocument, webviewPanel);

		// Clean up when panel is disposed
		webviewPanel.onDidDispose(() => {
			this.romToTablePanelMap.delete(document.romDocument);
		});

		// If we have a table open callback, use it with the TableDocument
		// This allows the callback to know which specific table to open
		if (this.onTableOpen) {
			await this.onTableOpen(document, webviewPanel);
			return;
		}

		// Otherwise, show a simple message
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
			],
		};

		webviewPanel.webview.html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>Table Editor</title>
</head>
<body>
	<h1>Table: ${document.tableId}</h1>
	<p>ROM File: ${document.romDocument.uri.fsPath.split("/").pop()}</p>
	${document.romDocument.definition ? `<p>Definition: ${document.romDocument.definition.name}</p>` : "<p>No definition found.</p>"}
</body>
</html>`;
	}

	/**
	 * Save a custom document
	 * Called when the user saves the document (Ctrl+S)
	 */
	async saveCustomDocument(
		document: RomDocument | TableDocument,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// If this is a table document, delegate to parent ROM document
		if (document instanceof TableDocument) {
			return this.saveCustomDocument(document.romDocument, _token);
		}

		// Otherwise, save the ROM document
		const romPath = document.uri.fsPath;
		const checksumDef: ChecksumDefinition | undefined =
			document.definition?.checksum;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Saving ROM...",
				cancellable: false,
			},
			async (progress) => {
				progress.report({ message: "Writing ROM data..." });

				const uriStr = document.uri.toString();
				const result = await this.saveManager.save({
					romPath,
					romData: document.romBytes,
					...(checksumDef ? { checksumDef } : {}),
					...(this.savingRomUris
						? { savingUris: this.savingRomUris, uriStr }
						: {}),
				});

				if (result.ok) {
					const checksumStatus = result.checksumValid
						? " (checksum valid)"
						: checksumDef
							? " (checksum updated)"
							: "";
					vscode.window.showInformationMessage(
						`ROM saved successfully${checksumStatus}`,
					);

					// Mark document as clean
					document.makeClean();

					// Notify caller (extension.ts) so it can clear undo/redo history
					this.onAfterSave?.(document);

					// Clear all dirty tables for this ROM
					this.stateManager.clearDirtyTables(romPath);

					// Notify webview of successful save
					const panel = this.documentToPanelMap.get(document);
					if (panel) {
						await panel.webview.postMessage({
							type: "saveComplete",
							path: romPath,
							checksumValid: result.checksumValid ?? false,
						});
					}
				} else {
					vscode.window.showErrorMessage(`Failed to save ROM: ${result.error}`);

					// Notify webview of save failure
					const panel = this.documentToPanelMap.get(document);
					if (panel) {
						await panel.webview.postMessage({
							type: "saveError",
							error: result.error,
						});
					}

					throw new Error(result.error);
				}
			},
		);
	}

	/**
	 * Save a custom document as a new file
	 * Called when the user uses "Save As"
	 */
	async saveCustomDocumentAs(
		document: RomDocument,
		destination: vscode.Uri,
		_token: vscode.CancellationToken,
	): Promise<void> {
		const checksumDef: ChecksumDefinition | undefined =
			document.definition?.checksum;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Saving ROM...",
				cancellable: false,
			},
			async (progress) => {
				progress.report({ message: "Writing ROM data..." });

				const result = await this.saveManager.save({
					romPath: destination.fsPath,
					romData: new Uint8Array(document.romBytes),
					...(checksumDef ? { checksumDef } : {}),
				});

				if (result.ok) {
					const checksumStatus = result.checksumValid
						? " (checksum valid)"
						: checksumDef
							? " (checksum updated)"
							: "";
					vscode.window.showInformationMessage(
						`ROM saved successfully${checksumStatus}`,
					);

					// Mark document as clean
					document.makeClean();
				} else {
					vscode.window.showErrorMessage(`Failed to save ROM: ${result.error}`);
					throw new Error(result.error);
				}
			},
		);
	}

	/**
	 * Revert a custom document to its saved state
	 * Called when the user reverts changes (discards without saving)
	 */
	async revertCustomDocument(
		document: RomDocument | TableDocument,
		_token: vscode.CancellationToken,
	): Promise<void> {
		// For table documents, delegate to the parent ROM document
		if (document instanceof TableDocument) {
			return this.revertCustomDocument(document.romDocument, _token);
		}

		// Reload ROM from disk
		const romBytes = new Uint8Array(
			await vscode.workspace.fs.readFile(document.uri),
		);
		// Pass markDirty=false: reverting from disk should never dirty the document
		document.updateBytes(romBytes, undefined, undefined, false);
		document.makeClean();

		// Clear all dirty tables for this ROM
		this.stateManager.clearDirtyTables(document.uri.fsPath);
	}

	/**
	 * Backup a custom document
	 * Called for hot exit support (when VSCode closes unexpectedly)
	 */
	async backupCustomDocument(
		document: RomDocument | TableDocument,
		context: vscode.CustomDocumentBackupContext,
		_token: vscode.CancellationToken,
	): Promise<vscode.CustomDocumentBackup> {
		// For table documents, delegate to the parent ROM document
		if (document instanceof TableDocument) {
			return this.backupCustomDocument(document.romDocument, context, _token);
		}

		// Ensure backup directory exists
		const backupDir = context.destination.fsPath
			.split("/")
			.slice(0, -1)
			.join("/");
		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupDir));
		} catch (error) {
			throw error;
		}

		// Write backup to temporary location
		await vscode.workspace.fs.writeFile(context.destination, document.romBytes);

		return {
			id: context.destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(context.destination);
				} catch {
					// Ignore errors when deleting backup
				}
			},
		};
	}
}

/**
 * Thin delegate wrapping RomEditorProvider for the `romViewer.tableEditor` registration.
 *
 * VSCode subscribes to the `onDidChangeCustomDocument` event of each registered provider
 * independently. Using the same `RomEditorProvider` instance for both `romViewer.editor`
 * and `romViewer.tableEditor` means both registrations receive every event fired on their
 * shared emitter. When a `TableDocument` change event is fired, the `romViewer.editor`
 * registration (which only owns `RomDocument` instances) throws "No custom document found".
 *
 * This delegate forwards all lifecycle calls to the underlying `RomEditorProvider` but
 * exposes a **separate** `onDidChangeCustomDocument` backed by
 * `RomEditorProvider._onDidChangeTableDocument`. This way:
 * - `romViewer.editor` only sees ROM document changes (via `RomEditorProvider.onDidChangeCustomDocument`)
 * - `romViewer.tableEditor` only sees table document changes (via this delegate's event)
 */
export class TableEditorDelegate
	implements vscode.CustomEditorProvider<TableDocument>
{
	readonly onDidChangeCustomDocument: vscode.Event<
		vscode.CustomDocumentEditEvent<TableDocument>
	>;

	constructor(private readonly inner: RomEditorProvider) {
		this.onDidChangeCustomDocument = inner._onDidChangeTableDocument.event;
	}

	openCustomDocument(
		uri: vscode.Uri,
		openContext: vscode.CustomDocumentOpenContext,
		token: vscode.CancellationToken,
	): Promise<TableDocument> {
		// The inner provider handles table URIs and returns a TableDocument
		return this.inner.openCustomDocument(
			uri,
			openContext,
			token,
		) as Promise<TableDocument>;
	}

	resolveCustomEditor(
		document: TableDocument,
		webviewPanel: vscode.WebviewPanel,
		token: vscode.CancellationToken,
	): Promise<void> {
		return this.inner.resolveCustomEditor(document, webviewPanel, token);
	}

	saveCustomDocument(
		document: TableDocument,
		token: vscode.CancellationToken,
	): Promise<void> {
		return this.inner.saveCustomDocument(document, token);
	}

	saveCustomDocumentAs(
		document: TableDocument,
		destination: vscode.Uri,
		token: vscode.CancellationToken,
	): Promise<void> {
		// TableDocument save-as delegates to ROM document; cast is safe here
		return this.inner.saveCustomDocumentAs(
			document.romDocument,
			destination,
			token,
		);
	}

	revertCustomDocument(
		document: TableDocument,
		token: vscode.CancellationToken,
	): Promise<void> {
		return this.inner.revertCustomDocument(document, token);
	}

	backupCustomDocument(
		document: TableDocument,
		context: vscode.CustomDocumentBackupContext,
		token: vscode.CancellationToken,
	): Promise<vscode.CustomDocumentBackup> {
		return this.inner.backupCustomDocument(document, context, token);
	}
}
