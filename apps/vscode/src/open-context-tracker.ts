/**
 * Open Context Tracker
 *
 * Tracks which ROMs and tables are currently open in VS Code, providing
 * this context to the MCP server via JSON updates. Used to build the
 * `ecu-explorer://context/open-documents` MCP resource.
 */

import type { TableDefinition } from "@ecu-explorer/core";
import type * as vscode from "vscode";
import type { RomDocument } from "./rom/document.js";
import type { TableDocument } from "./table-document.js";

/**
 * Metadata about an open ROM
 */
export interface OpenRomState {
	uri: string;
	path: string;
	name: string;
	sizeBytes: number;
	definition?: {
		name: string;
		uri?: string;
	};
	isDirty: boolean;
	activeEditors: number;
	lastFocusedAt?: string;
}

/**
 * Metadata about an open table
 */
export interface OpenTableState {
	uri: string;
	tableId: string;
	romPath: string;
	romUri: string;
	kind: string;
	dimensions: { rows: number; cols: number };
	unit?: string;
	definitionUri?: string;
	activeEditors: number;
	lastFocusedAt?: string;
}

/**
 * Complete open documents context
 */
export interface OpenDocumentsContext {
	version: number;
	timestamp: string;
	roms: OpenRomState[];
	tables: OpenTableState[];
}

/**
 * Callback invoked when context changes
 */
type ContextUpdateListener = (context: OpenDocumentsContext) => void;

/**
 * Tracks open ROMs and tables, generating context updates for the MCP server
 */
export class OpenContextTracker {
	private readonly roms = new Map<string, OpenRomState>();
	private readonly tables = new Map<string, OpenTableState>();
	private readonly romDocuments = new Map<string, RomDocument>();
	private readonly tableDocuments = new Map<string, TableDocument>();
	private readonly listeners: Set<ContextUpdateListener> = new Set();
	private updateTimerId: ReturnType<typeof setTimeout> | undefined;
	private lastUpdate = 0;
	private readonly debounceMs = 100;

	/**
	 * Listen for context updates
	 */
	onContextUpdate(listener: ContextUpdateListener): vscode.Disposable {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	/**
	 * Track an open ROM document
	 */
	addRomDocument(document: RomDocument, activeEditors: number = 1): void {
		const uri = document.uri.toString();
		const state: OpenRomState = {
			uri,
			path: document.uri.fsPath,
			name: document.uri.fsPath.split(/[\\/]/).pop() ?? "unknown",
			sizeBytes: document.romBytes.byteLength,
			isDirty: document.isDirty,
			activeEditors,
			lastFocusedAt: new Date().toISOString(),
		};

		if (document.definition) {
			state.definition = {
				name: document.definition.name,
				uri: document.definition.uri,
			};
		}

		this.roms.set(uri, state);
		this.romDocuments.set(uri, document);

		// Listen for changes
		const changeListener = document.onDidChange(() => {
			this.updateRomState(uri);
		});

		document.onDidDispose(() => {
			changeListener.dispose();
			this.removeRomDocument(uri);
		});

		this.scheduleContextUpdate();
	}

	/**
	 * Track an open table document
	 */
	addTableDocument(document: TableDocument): void {
		const uri = document.uri.toString();
		const romUri = document.romDocument.uri.toString();

		const state: OpenTableState = {
			uri,
			tableId: document.tableId,
			romPath: document.romDocument.uri.fsPath,
			romUri,
			kind: document.tableDef.kind,
			dimensions: this.getTableDimensions(document.tableDef),
			activeEditors: 1,
			lastFocusedAt: new Date().toISOString(),
		};

		if (document.tableDef.z.unit) {
			state.unit = String(document.tableDef.z.unit);
		}

		if (document.romDocument.definition?.uri) {
			state.definitionUri = document.romDocument.definition.uri;
		}

		this.tables.set(uri, state);
		this.tableDocuments.set(uri, document);

		// Listen for changes
		const changeListener = document.onDidChange(() => {
			this.updateTableState(uri);
		});

		document.onDidDispose(() => {
			changeListener.dispose();
			this.removeTableDocument(uri);
		});

		this.scheduleContextUpdate();
	}

	/**
	 * Update focus timestamp for a ROM
	 */
	setRomFocused(uri: string): void {
		const state = this.roms.get(uri);
		if (state) {
			state.lastFocusedAt = new Date().toISOString();
			this.scheduleContextUpdate();
		}
	}

	/**
	 * Update focus timestamp for a table
	 */
	setTableFocused(uri: string): void {
		const state = this.tables.get(uri);
		if (state) {
			state.lastFocusedAt = new Date().toISOString();
			this.scheduleContextUpdate();
		}
	}

	/**
	 * Get current open documents context
	 */
	getContext(): OpenDocumentsContext {
		return {
			version: 1,
			timestamp: new Date().toISOString(),
			roms: Array.from(this.roms.values()),
			tables: Array.from(this.tables.values()),
		};
	}

	/**
	 * Update ROM state (called when ROM document changes)
	 */
	private updateRomState(uri: string): void {
		const romDoc = this.romDocuments.get(uri);
		const state = this.roms.get(uri);

		if (romDoc && state) {
			state.isDirty = romDoc.isDirty;
			this.scheduleContextUpdate();
		}
	}

	/**
	 * Update table state (called when table document changes)
	 */
	private updateTableState(uri: string): void {
		const tableDoc = this.tableDocuments.get(uri);
		const state = this.tables.get(uri);

		if (tableDoc && state) {
			// Table state updates are delegated to ROM state changes
			// since table documents delegate to parent ROM
			this.scheduleContextUpdate();
		}
	}

	/**
	 * Remove a ROM from tracking
	 */
	private removeRomDocument(uri: string): void {
		this.roms.delete(uri);
		this.romDocuments.delete(uri);

		// Also remove dependent tables
		const tablesToRemove: string[] = [];
		for (const [tableUri, tableState] of this.tables.entries()) {
			if (tableState.romUri === uri) {
				tablesToRemove.push(tableUri);
			}
		}
		for (const tableUri of tablesToRemove) {
			this.removeTableDocument(tableUri);
		}

		this.scheduleContextUpdate();
	}

	/**
	 * Remove a table from tracking
	 */
	private removeTableDocument(uri: string): void {
		this.tables.delete(uri);
		this.tableDocuments.delete(uri);
		this.scheduleContextUpdate();
	}

	/**
	 * Get table dimensions from table definition
	 */
	private getTableDimensions(tableDef: TableDefinition): {
		rows: number;
		cols: number;
	} {
		if (tableDef.kind === "table1d") {
			return { rows: tableDef.rows, cols: 1 };
		}
		// table2d or table3d
		return { rows: tableDef.rows, cols: tableDef.cols };
	}

	/**
	 * Schedule a context update with debouncing
	 */
	private scheduleContextUpdate(): void {
		if (this.updateTimerId) {
			clearTimeout(this.updateTimerId);
		}

		this.updateTimerId = setTimeout(() => {
			this.emitContextUpdate();
		}, this.debounceMs);
	}

	/**
	 * Emit context update to all listeners
	 */
	private emitContextUpdate(): void {
		this.updateTimerId = undefined;
		const context = this.getContext();
		const now = Date.now();

		// Only emit if at least 100ms has passed
		if (now - this.lastUpdate < this.debounceMs) {
			return;
		}

		this.lastUpdate = now;
		for (const listener of this.listeners) {
			try {
				listener(context);
			} catch (error) {
				console.error("Error in open context update listener:", error);
			}
		}
	}

	/**
	 * Dispose the tracker
	 */
	dispose(): void {
		if (this.updateTimerId) {
			clearTimeout(this.updateTimerId);
		}
		this.roms.clear();
		this.tables.clear();
		this.romDocuments.clear();
		this.tableDocuments.clear();
		this.listeners.clear();
	}
}
