import { snapshotTable, type TableDefinition } from "@ecu-explorer/core";
import { type EditTransaction, HistoryStack } from "@ecu-explorer/ui";
import type * as vscode from "vscode";
import type { RomDocument } from "../rom/document.js";
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
	rom?: number[];
	reason: "undo" | "redo" | "sync";
}

export interface TableSessionMoveResult {
	transaction: EditTransaction;
	message: TableSessionUpdateMessage;
}

export class TableEditSession {
	readonly id: TableSessionId;
	readonly tableUri: vscode.Uri;
	readonly tableDef: TableDefinition;
	readonly history = new HistoryStack<EditTransaction>();
	private _romDocument: RomDocument;
	private readonly listeners = new Set<
		(message: TableSessionUpdateMessage) => void
	>();
	private disposeDocumentListener: (() => void) | null = null;

	private panel: vscode.WebviewPanel | null;

	constructor(options: TableEditSessionOptions) {
		this.id = options.id;
		this.tableUri = options.tableUri;
		this.tableDef = options.tableDef;
		this._romDocument = options.romDocument;
		this.panel = options.panel ?? null;
		this.bindRomDocument(options.romDocument);
	}

	get romDocument(): RomDocument {
		return this._romDocument;
	}

	get activePanel(): vscode.WebviewPanel | null {
		return this.panel;
	}

	get canUndo(): boolean {
		return this.history.getSnapshot().canUndo;
	}

	get canRedo(): boolean {
		return this.history.getSnapshot().canRedo;
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
		this.history.markSavePoint();
	}

	isAtSavePoint(): boolean {
		return this.history.getSnapshot().atSavePoint;
	}

	createExecutor(): VsCodeHistoryExecutor {
		return new VsCodeHistoryExecutor(
			this._romDocument.romBytes,
			this._romDocument,
		);
	}

	isForRom(romDocument: RomDocument): boolean {
		return this._romDocument === romDocument;
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
		this.history.record(transaction);
	}

	attachRomDocument(romDocument: RomDocument): void {
		if (this._romDocument === romDocument) {
			return;
		}

		this.bindRomDocument(romDocument);
		this.emitUpdate("sync");
	}

	onDidUpdate(
		listener: (message: TableSessionUpdateMessage) => void,
	): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	undo(): TableSessionMoveResult | null {
		const result = this.history.undo();
		if (!result) {
			return null;
		}

		this.createExecutor().revert(result.transaction, {
			atSavePoint: result.snapshot.atSavePoint,
		});

		return {
			transaction: result.transaction,
			message: this.createUpdateMessage("undo"),
		};
	}

	redo(): TableSessionMoveResult | null {
		const result = this.history.redo();
		if (!result) {
			return null;
		}

		this.createExecutor().apply(result.transaction, {
			atSavePoint: result.snapshot.atSavePoint,
		});

		return {
			transaction: result.transaction,
			message: this.createUpdateMessage("redo"),
		};
	}

	private bindRomDocument(romDocument: RomDocument): void {
		this.disposeDocumentListener?.();
		this._romDocument = romDocument;
		const subscription = romDocument.onDidUpdateBytes(() => {
			this.emitUpdate("sync");
		});
		this.disposeDocumentListener = () => {
			subscription.dispose();
		};
	}

	private emitUpdate(reason: TableSessionUpdateMessage["reason"]): void {
		const message = this.createUpdateMessage(reason);
		for (const listener of this.listeners) {
			listener(message);
		}
	}

	private createUpdateMessage(
		reason: TableSessionUpdateMessage["reason"],
	): TableSessionUpdateMessage {
		const romBytes = this._romDocument.romBytes;

		return {
			type: "update",
			snapshot: snapshotTable(this.tableDef, romBytes),
			rom: Array.from(romBytes),
			reason,
		};
	}
}
