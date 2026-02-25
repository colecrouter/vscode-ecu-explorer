/**
 * Workspace State Persistence
 *
 * This module provides utilities for persisting workspace state across VSCode reloads.
 * It stores ROM definition selections, last opened tables, and table editor states.
 *
 * State is stored using VSCode's Memento API at the workspace level, ensuring
 * that state is specific to each workspace and persists across sessions.
 */

import type * as vscode from "vscode";

/**
 * Table editor state
 */
export interface TableEditorState {
	/** Absolute path to the ROM file */
	romPath: string;
	/** Table name/ID */
	tableId: string;
	/** URI of the ROM definition */
	definitionUri: string;
	/** Scroll position (optional) */
	scrollPosition?: { row: number; col: number };
	/** Selection (optional) */
	selection?: {
		startRow: number;
		startCol: number;
		endRow: number;
		endCol: number;
	};
	/** Last modified timestamp (optional) */
	lastModified?: number;
}

/**
 * Workspace state structure
 */
interface WorkspaceStateData {
	/** Map of ROM file path → selected definition URI */
	romDefinitions: Record<string, string>;
	/** Map of ROM file path → last opened table */
	lastOpenedTables: Record<string, string>;
	/** Map of table URI → editor state */
	tableStates: Record<string, TableEditorState>;
	/** Map of ROM file path → Set of dirty table names */
	dirtyTables: Record<string, string[]>;
}

/**
 * Workspace state manager
 *
 * Manages persistence of ROM definitions, table states, and other workspace-specific data.
 * Uses VSCode's Memento API for storage.
 *
 * @example
 * ```typescript
 * const stateManager = new WorkspaceState(context.workspaceState);
 *
 * // Save ROM definition selection
 * stateManager.saveRomDefinition('/path/to/rom.hex', 'file:///path/to/def.xml');
 *
 * // Get saved definition
 * const definitionUri = stateManager.getRomDefinition('/path/to/rom.hex');
 *
 * // Save last opened table
 * stateManager.saveLastOpenedTable('/path/to/rom.hex', 'Fuel Map');
 * ```
 */
export class WorkspaceState {
	private static readonly STATE_KEY = "ecuExplorer.workspaceState";
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private pendingState: WorkspaceStateData | null = null;

	constructor(private readonly memento: vscode.Memento) {}

	/**
	 * Save ROM definition selection
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @param definitionUri - URI of the selected ROM definition
	 */
	saveRomDefinition(romPath: string, definitionUri: string): void {
		const state = this.getState();
		state.romDefinitions[romPath] = definitionUri;
		this.setState(state);
	}

	/**
	 * Get saved ROM definition
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @returns URI of the saved ROM definition, or undefined if not found
	 */
	getRomDefinition(romPath: string): string | undefined {
		return this.getState().romDefinitions[romPath];
	}

	/**
	 * Save last opened table for a ROM
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @param tableId - Table name/ID
	 */
	saveLastOpenedTable(romPath: string, tableId: string): void {
		const state = this.getState();
		state.lastOpenedTables[romPath] = tableId;
		this.setState(state);
	}

	/**
	 * Get last opened table for a ROM
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @returns Table name/ID, or undefined if not found
	 */
	getLastOpenedTable(romPath: string): string | undefined {
		return this.getState().lastOpenedTables[romPath];
	}

	/**
	 * Save table editor state (debounced)
	 *
	 * This method debounces saves to avoid excessive writes to the memento.
	 * State is saved after 1 second of inactivity.
	 *
	 * @param tableUri - URI of the table
	 * @param editorState - Editor state to save
	 */
	saveTableState(tableUri: string, editorState: TableEditorState): void {
		// Update pending state
		if (!this.pendingState) {
			this.pendingState = this.getState();
		}
		this.pendingState.tableStates[tableUri] = editorState;

		// Debounce save
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}

		this.saveTimeout = setTimeout(() => {
			if (this.pendingState) {
				this.setState(this.pendingState);
				this.pendingState = null;
			}
			this.saveTimeout = null;
		}, 1000); // Save after 1 second of inactivity
	}

	/**
	 * Get table editor state
	 *
	 * @param tableUri - URI of the table
	 * @returns Editor state, or undefined if not found
	 */
	getTableState(tableUri: string): TableEditorState | undefined {
		return this.getState().tableStates[tableUri];
	}

	/**
	 * Clear all state for a ROM file
	 *
	 * This should be called when a ROM file is deleted or moved.
	 *
	 * @param romPath - Absolute path to the ROM file
	 */
	clearRomState(romPath: string): void {
		const state = this.getState();
		delete state.romDefinitions[romPath];
		delete state.lastOpenedTables[romPath];

		// Clear all table states for this ROM
		for (const [uri, tableState] of Object.entries(state.tableStates)) {
			if (tableState.romPath === romPath) {
				delete state.tableStates[uri];
			}
		}

		this.setState(state);
	}

	/**
	 * Clear all workspace state
	 *
	 * This is useful for testing or resetting the extension.
	 */
	clearAll(): void {
		this.setState({
			romDefinitions: {},
			lastOpenedTables: {},
			tableStates: {},
			dirtyTables: {},
		});
	}

	/**
	 * Get all ROM definitions
	 *
	 * @returns Map of ROM path → definition URI
	 */
	getAllRomDefinitions(): Record<string, string> {
		return { ...this.getState().romDefinitions };
	}

	/**
	 * Get all table states
	 *
	 * @returns Map of table URI → editor state
	 */
	getAllTableStates(): Record<string, TableEditorState> {
		return { ...this.getState().tableStates };
	}

	/**
	 * Flush any pending state saves
	 *
	 * This should be called before extension deactivation to ensure
	 * all pending state is saved.
	 */
	flush(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}

		if (this.pendingState) {
			this.setState(this.pendingState);
			this.pendingState = null;
		}
	}

	/**
	 * Get current workspace state
	 *
	 * @returns Current workspace state
	 */
	private getState(): WorkspaceStateData {
		const state = this.memento.get<WorkspaceStateData>(
			WorkspaceState.STATE_KEY,
		);
		if (!state) {
			return {
				romDefinitions: {},
				lastOpenedTables: {},
				tableStates: {},
				dirtyTables: {},
			};
		}

		// Sanitize state to ensure it's valid
		return this.sanitizeState(state);
	}

	/**
	 * Set workspace state
	 *
	 * @param state - Workspace state to save
	 */
	private setState(state: WorkspaceStateData): void {
		this.memento.update(WorkspaceState.STATE_KEY, state);
	}

	/**
	 * Sanitize workspace state
	 *
	 * Ensures that the state loaded from memento is valid and doesn't contain
	 * any unexpected data types or structures.
	 *
	 * @param state - State to sanitize
	 * @returns Sanitized state
	 */
	private sanitizeState(state: any): WorkspaceStateData {
		return {
			romDefinitions: this.sanitizeRecord(state.romDefinitions),
			lastOpenedTables: this.sanitizeRecord(state.lastOpenedTables),
			tableStates: this.sanitizeTableStates(state.tableStates),
			dirtyTables: this.sanitizeDirtyTables(state.dirtyTables),
		};
	}

	/**
	 * Sanitize a record (object with string keys and values)
	 *
	 * @param record - Record to sanitize
	 * @returns Sanitized record
	 */
	private sanitizeRecord(record: any): Record<string, string> {
		if (typeof record !== "object" || record === null) {
			return {};
		}

		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(record)) {
			if (typeof key === "string" && typeof value === "string") {
				result[key] = value;
			}
		}
		return result;
	}

	/**
	 * Sanitize table states
	 *
	 * @param tableStates - Table states to sanitize
	 * @returns Sanitized table states
	 */
	private sanitizeTableStates(
		tableStates: any,
	): Record<string, TableEditorState> {
		if (typeof tableStates !== "object" || tableStates === null) {
			return {};
		}

		const result: Record<string, TableEditorState> = {};
		for (const [key, value] of Object.entries(tableStates)) {
			if (typeof key === "string" && this.isValidTableEditorState(value)) {
				result[key] = value as TableEditorState;
			}
		}
		return result;
	}

	/**
	 * Check if a value is a valid TableEditorState
	 *
	 * @param value - Value to check
	 * @returns True if the value is a valid TableEditorState
	 */
	private isValidTableEditorState(value: any): boolean {
		if (typeof value !== "object" || value === null) {
			return false;
		}

		// Check required fields
		if (
			typeof value.romPath !== "string" ||
			typeof value.tableId !== "string" ||
			typeof value.definitionUri !== "string"
		) {
			return false;
		}

		// Check optional fields if present
		if (value.scrollPosition !== undefined) {
			if (
				typeof value.scrollPosition !== "object" ||
				typeof value.scrollPosition.row !== "number" ||
				typeof value.scrollPosition.col !== "number"
			) {
				return false;
			}
		}

		if (value.selection !== undefined) {
			if (
				typeof value.selection !== "object" ||
				typeof value.selection.startRow !== "number" ||
				typeof value.selection.startCol !== "number" ||
				typeof value.selection.endRow !== "number" ||
				typeof value.selection.endCol !== "number"
			) {
				return false;
			}
		}

		if (
			value.lastModified !== undefined &&
			typeof value.lastModified !== "number"
		) {
			return false;
		}

		return true;
	}

	/**
	 * Sanitize dirty tables record
	 *
	 * @param dirtyTables - Dirty tables to sanitize
	 * @returns Sanitized dirty tables
	 */
	private sanitizeDirtyTables(dirtyTables: any): Record<string, string[]> {
		if (typeof dirtyTables !== "object" || dirtyTables === null) {
			return {};
		}

		const result: Record<string, string[]> = {};
		for (const [key, value] of Object.entries(dirtyTables)) {
			if (typeof key === "string" && Array.isArray(value)) {
				// Filter to only include string values
				const tableNames = value.filter((v) => typeof v === "string");
				if (tableNames.length > 0) {
					result[key] = tableNames;
				}
			}
		}
		return result;
	}

	/**
	 * Mark a table as dirty
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @param tableName - Table name/ID
	 */
	markTableDirty(romPath: string, tableName: string): void {
		const state = this.getState();
		if (!state.dirtyTables[romPath]) {
			state.dirtyTables[romPath] = [];
		}
		if (!state.dirtyTables[romPath].includes(tableName)) {
			state.dirtyTables[romPath].push(tableName);
			this.setState(state);
		}
	}

	/**
	 * Mark a table as clean
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @param tableName - Table name/ID
	 */
	markTableClean(romPath: string, tableName: string): void {
		const state = this.getState();
		if (state.dirtyTables[romPath]) {
			state.dirtyTables[romPath] = state.dirtyTables[romPath].filter(
				(name) => name !== tableName,
			);
			if (state.dirtyTables[romPath].length === 0) {
				delete state.dirtyTables[romPath];
			}
			this.setState(state);
		}
	}

	/**
	 * Clear all dirty tables for a ROM
	 *
	 * @param romPath - Absolute path to the ROM file
	 */
	clearDirtyTables(romPath: string): void {
		const state = this.getState();
		delete state.dirtyTables[romPath];
		this.setState(state);
	}

	/**
	 * Get dirty tables for a ROM
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @returns Array of dirty table names
	 */
	getDirtyTables(romPath: string): string[] {
		return this.getState().dirtyTables[romPath] || [];
	}

	/**
	 * Check if a table is dirty
	 *
	 * @param romPath - Absolute path to the ROM file
	 * @param tableName - Table name/ID
	 * @returns True if the table is dirty
	 */
	isTableDirty(romPath: string, tableName: string): boolean {
		const dirtyTables = this.getDirtyTables(romPath);
		return dirtyTables.includes(tableName);
	}
}
