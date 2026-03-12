import {
	calculateCellAddress,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import type { Edit, EditTransaction } from "@ecu-explorer/ui";
import type * as vscode from "vscode";
import type { RomDocument } from "../rom/document.js";
import {
	type EditOperation,
	isBatchEdit,
	type StackEntry,
	UndoRedoManager,
} from "../undo-redo-manager.js";
import { VsCodeHistoryExecutor } from "./vscode-history-executor.js";

export type TableSessionId = string;

export function createTableSessionId(
	tableUri: vscode.Uri | string,
): TableSessionId {
	return typeof tableUri === "string" ? tableUri : tableUri.toString();
}

export interface TableEditSessionOptions {
	id: TableSessionId;
	tableUri: vscode.Uri;
	tableDef: TableDefinition;
	romDocument: RomDocument;
	panel?: vscode.WebviewPanel | null;
}

export interface TableSessionUpdateMessage {
	type: "update";
	snapshot: ReturnType<typeof snapshotTable>;
	rom: number[];
	reason: "undo" | "redo";
}

export interface TableSessionMoveResult {
	entry: StackEntry;
	message: TableSessionUpdateMessage;
}

export class TableEditSession {
	readonly id: TableSessionId;
	readonly tableUri: vscode.Uri;
	readonly tableDef: TableDefinition;
	readonly romDocument: RomDocument;
	readonly undoRedoManager = new UndoRedoManager();

	private panel: vscode.WebviewPanel | null;

	constructor(options: TableEditSessionOptions) {
		this.id = options.id;
		this.tableUri = options.tableUri;
		this.tableDef = options.tableDef;
		this.romDocument = options.romDocument;
		this.panel = options.panel ?? null;
	}

	get activePanel(): vscode.WebviewPanel | null {
		return this.panel;
	}

	get canUndo(): boolean {
		return this.undoRedoManager.canUndo();
	}

	get canRedo(): boolean {
		return this.undoRedoManager.canRedo();
	}

	setPanel(panel: vscode.WebviewPanel | null): void {
		this.panel = panel;
	}

	clearPanel(panel?: vscode.WebviewPanel): void {
		if (!panel || this.panel === panel) {
			this.panel = null;
		}
	}

	markSaved(): void {
		this.undoRedoManager.markSavePoint();
	}

	isAtSavePoint(): boolean {
		return this.undoRedoManager.isAtSavePoint();
	}

	createExecutor(): VsCodeHistoryExecutor {
		return new VsCodeHistoryExecutor(
			this.romDocument.romBytes,
			this.romDocument,
		);
	}

	isForRom(romDocument: RomDocument): boolean {
		return this.romDocument === romDocument;
	}

	markSavedIfForRom(romDocument: RomDocument): boolean {
		if (!this.isForRom(romDocument)) {
			return false;
		}

		this.markSaved();
		return true;
	}

	recordTransaction(transaction: EditTransaction): void {
		if (transaction.edits.length === 0) {
			return;
		}

		const ops = transaction.edits.map((edit) =>
			this.toOperation(edit, transaction.timestamp, transaction.label),
		);

		if (ops.length === 1) {
			const [op] = ops;
			if (!op) {
				return;
			}
			this.undoRedoManager.push(op);
			return;
		}

		this.undoRedoManager.pushBatch(ops, transaction.label);
	}

	undo(): TableSessionMoveResult | null {
		const entry = this.undoRedoManager.undo();
		if (!entry) {
			return null;
		}

		const transaction = this.toTransaction(entry, "Undo");
		this.createExecutor().revert(transaction, {
			atSavePoint: this.isAtSavePoint(),
		});

		return {
			entry,
			message: this.createUpdateMessage("undo"),
		};
	}

	redo(): TableSessionMoveResult | null {
		const entry = this.undoRedoManager.redo();
		if (!entry) {
			return null;
		}

		const transaction = this.toTransaction(entry, "Redo");
		this.createExecutor().apply(transaction, {
			atSavePoint: this.isAtSavePoint(),
		});

		return {
			entry,
			message: this.createUpdateMessage("redo"),
		};
	}

	private toTransaction(
		entry: StackEntry,
		fallbackLabel: string,
	): EditTransaction {
		if (isBatchEdit(entry)) {
			return {
				label: entry.label ?? fallbackLabel,
				timestamp: entry.timestamp,
				edits: entry.ops.map((op) => this.toEdit(op)),
			};
		}

		return {
			label: entry.label ?? fallbackLabel,
			timestamp: entry.timestamp,
			edits: [this.toEdit(entry)],
		};
	}

	private toEdit(operation: EditOperation) {
		return {
			address: this.resolveAddress(operation),
			before: operation.oldValue,
			after: operation.newValue,
			...(operation.label !== undefined ? { label: operation.label } : {}),
		};
	}

	private toOperation(
		edit: Edit<Uint8Array>,
		timestamp: number,
		fallbackLabel: string,
	): EditOperation {
		const row = this.getNumericMetadata(edit, "row");
		const col = this.getNumericMetadata(edit, "col");
		const depth = this.getNumericMetadata(edit, "depth");

		return {
			row: row ?? 0,
			col: col ?? 0,
			...(depth !== undefined ? { depth } : {}),
			address: edit.address,
			oldValue: edit.before,
			newValue: edit.after,
			timestamp,
			label: edit.label ?? fallbackLabel,
		};
	}

	private getNumericMetadata(
		edit: Edit<Uint8Array>,
		key: string,
	): number | undefined {
		const value = edit.metadata?.[key];
		return typeof value === "number" ? value : undefined;
	}

	private resolveAddress(operation: EditOperation): number {
		return (
			operation.address ??
			calculateCellAddress(this.tableDef, operation.row, operation.col)
		);
	}

	private createUpdateMessage(
		reason: TableSessionUpdateMessage["reason"],
	): TableSessionUpdateMessage {
		const romBytes = this.romDocument.romBytes;
		return {
			type: "update",
			snapshot: snapshotTable(this.tableDef, romBytes),
			rom: Array.from(romBytes),
			reason,
		};
	}
}
