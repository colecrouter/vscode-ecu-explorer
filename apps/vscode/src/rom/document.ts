import type { ROMDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";

/**
 * Event fired when ROM bytes are updated
 */
export interface RomChangeEvent {
	/**
	 * The new ROM bytes
	 */
	readonly bytes: Uint8Array;
	/**
	 * The offset where the change started, if known
	 */
	readonly offset?: number | undefined;
	/**
	 * The length of the changed data, if known
	 */
	readonly length?: number | undefined;
	/**
	 * Whether this update marked the document dirty.
	 * `false` when called during revert/undo-to-clean (markDirty=false).
	 */
	readonly didMarkDirty: boolean;
}

/**
 * Custom document for ROM files
 * Implements VSCode's CustomDocument interface to enable native dirty marker
 * and save lifecycle integration
 */
export class RomDocument implements vscode.CustomDocument {
	private readonly _uri: vscode.Uri;
	private _romBytes: Uint8Array;
	private _definition: ROMDefinition | undefined;
	private _isDirty = false;

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidUpdateBytes =
		new vscode.EventEmitter<RomChangeEvent>();
	readonly onDidUpdateBytes = this._onDidUpdateBytes.event;

	private readonly _onDidDispose = new vscode.EventEmitter<void>();
	readonly onDidDispose = this._onDidDispose.event;

	constructor(
		uri: vscode.Uri,
		romBytes: Uint8Array,
		definition?: ROMDefinition,
	) {
		this._uri = uri;
		this._romBytes = romBytes;
		this._definition = definition;
	}

	get uri(): vscode.Uri {
		return this._uri;
	}

	get romBytes(): Uint8Array {
		return this._romBytes;
	}

	get definition(): ROMDefinition | undefined {
		return this._definition;
	}

	get isDirty(): boolean {
		return this._isDirty;
	}

	/**
	 * Mark document as dirty (has unsaved changes)
	 * Fires onDidChange event to notify VSCode and trigger tree refresh
	 */
	makeDirty(): void {
		this._isDirty = true;
		// Always fire event to ensure tree refreshes on every edit
		this._onDidChange.fire();
	}

	/**
	 * Mark document as clean (saved)
	 * Fires onDidChange event to notify VSCode
	 */
	makeClean(): void {
		this._isDirty = false;
		this._onDidChange.fire();
	}

	/**
	 * Update ROM bytes, optionally marking the document as dirty
	 * @param newBytes - New ROM bytes
	 * @param offset - Optional offset where the change started
	 * @param length - Optional length of the changed data
	 * @param markDirty - Whether to mark the document as dirty (default: true).
	 *   Pass `false` when updating from an external source (e.g. file watcher)
	 *   where the bytes are already persisted on disk.
	 */
	updateBytes(
		newBytes: Uint8Array,
		offset?: number,
		length?: number,
		markDirty = true,
	): void {
		this._romBytes = newBytes;
		if (markDirty) {
			this.makeDirty();
		}
		this._onDidUpdateBytes.fire({
			bytes: newBytes,
			offset,
			length,
			didMarkDirty: markDirty,
		});
	}

	/**
	 * Set ROM definition
	 * @param definition - ROM definition
	 */
	setDefinition(definition: ROMDefinition): void {
		this._definition = definition;
	}

	/**
	 * Dispose of the document
	 * Cleans up event emitters
	 */
	dispose(): void {
		this._onDidDispose.fire();
		this._onDidChange.dispose();
		this._onDidUpdateBytes.dispose();
		this._onDidDispose.dispose();
	}
}
