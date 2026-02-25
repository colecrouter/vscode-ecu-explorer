/**
 * Edit operation for undo/redo tracking
 */
export interface EditOperation {
	row: number;
	col: number;
	depth?: number;
	/** Direct ROM address — when set, used instead of calculateCellAddress(row, col) */
	address?: number;
	oldValue: Uint8Array;
	newValue: Uint8Array;
	timestamp: number;
	label?: string;
}

/**
 * A batch of edit operations that are undone/redone as a single unit.
 * Used for math operations that affect multiple cells at once.
 */
export interface BatchEditOperation {
	ops: EditOperation[];
	timestamp: number;
	label: string | undefined;
}

/** Stack entry — either a single edit or a batch */
export type StackEntry = EditOperation | BatchEditOperation;

export function isBatchEdit(entry: StackEntry): entry is BatchEditOperation {
	return "ops" in entry;
}

/**
 * Manages undo/redo stack for table edits
 */
export class UndoRedoManager {
	private undoStack: StackEntry[] = [];
	private redoStack: StackEntry[] = [];

	/**
	 * Push an edit operation to the undo stack
	 * Clears redo stack when new edit is made
	 */
	push(op: EditOperation): void {
		this.undoStack.push(op);
		this.redoStack = [];
	}

	/**
	 * Push a batch of edit operations as a single undo unit.
	 * All operations in the batch are undone/redone together.
	 * Clears redo stack when new edit is made.
	 */
	pushBatch(ops: EditOperation[], label?: string): void {
		if (ops.length === 0) return;
		this.undoStack.push({ ops, timestamp: Date.now(), label });
		this.redoStack = [];
	}

	/**
	 * Undo the last operation (single or batch)
	 */
	undo(): StackEntry | null {
		const entry = this.undoStack.pop();
		if (entry) this.redoStack.push(entry);
		return entry ?? null;
	}

	/**
	 * Redo the last undone operation (single or batch)
	 */
	redo(): StackEntry | null {
		const entry = this.redoStack.pop();
		if (entry) this.undoStack.push(entry);
		return entry ?? null;
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/**
	 * Check if redo is available
	 */
	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/**
	 * Check if we're at the initial state (no changes)
	 * This is true when the undo stack is empty
	 */
	isAtInitialState(): boolean {
		return this.undoStack.length === 0;
	}

	/**
	 * Clear all history
	 */
	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}
}
