/**
 * Table Document Model
 *
 * This module provides the TableDocument class, which represents a specific table
 * within a ROM file. TableDocument instances reference a parent RomDocument and
 * delegate save operations to it.
 *
 * TableDocuments are created when opening tables from the ECU Explorer or via
 * table URIs. They provide a way for VSCode to distinguish between different
 * table editors while maintaining a single source of truth for the ROM data.
 */

import type {
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { RomDocument } from "./rom/document.js";

/**
 * Custom document for a table within a ROM file
 *
 * Represents a specific table view into ROM data. The table document references
 * a parent RomDocument and delegates all data operations to it.
 *
 * @example
 * ```typescript
 * const tableDoc = new TableDocument(
 *   tableUri,
 *   romDocument,
 *   'Fuel Map',
 *   tableDef
 * );
 *
 * // Check if dirty (delegates to parent ROM)
 * if (tableDoc.isDirty) {
 *   // Save (delegates to parent ROM)
 *   await saveManager.save(tableDoc.romDocument);
 * }
 * ```
 */
export class TableDocument implements vscode.CustomDocument {
	private readonly _uri: vscode.Uri;
	private readonly _romDocument: RomDocument;
	private readonly _tableId: string;
	private readonly _tableDef: TableDefinition;

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidDispose = new vscode.EventEmitter<void>();
	readonly onDidDispose = this._onDidDispose.event;

	private romChangeListener: vscode.Disposable | undefined;
	private romBytesListener: vscode.Disposable | undefined;

	/**
	 * Create a new table document
	 *
	 * @param uri - Table URI (ecu-explorer://table?...)
	 * @param romDocument - Parent ROM document
	 * @param tableId - Table name/ID
	 * @param tableDef - Table definition
	 */
	constructor(
		uri: vscode.Uri,
		romDocument: RomDocument,
		tableId: string,
		tableDef: TableDefinition,
	) {
		this._uri = uri;
		this._romDocument = romDocument;
		this._tableId = tableId;
		this._tableDef = tableDef;

		// Listen to parent ROM document for clean-state changes (save/revert).
		// Fires _onDidChange for ALL table documents when the ROM transitions to
		// clean – this allows subscribers to react (e.g. UI refresh, etc.).
		// NOTE: editor-provider.ts MUST NOT forward this to _onDidChangeCustomDocument
		// when the document is CLEAN, as that would incorrectly mark the next
		// focused document as dirty.
		this.romChangeListener = this._romDocument.onDidChange(() => {
			if (!this._romDocument.isDirty) {
				// Document was just cleaned (saved/reverted) – notify listeners
				this._onDidChange.fire();
			}
		});

		// Listen to byte-level updates and only propagate if:
		//  1. The update actually marked the document dirty (didMarkDirty=true).
		//     If markDirty=false was passed (revert/undo-to-clean), skip here –
		//     romChangeListener handles the clean notification via makeClean().
		//  2. The changed byte range overlaps with this table's byte range.
		//
		// This ensures that editing Table A fires onDidChange only on Table A,
		// while saves/reverts (handled by romChangeListener above) notify all.
		this.romBytesListener = this._romDocument.onDidUpdateBytes((e) => {
			// Only propagate dirty edits – clean updates are handled by
			// romChangeListener when makeClean() fires onDidChange.
			if (!e.didMarkDirty) {
				return;
			}

			if (e.offset === undefined || e.length === undefined) {
				// No range info – fire unconditionally (conservative fallback)
				this._onDidChange.fire();
				return;
			}

			const tableStart = this._tableDef.z.address;
			const tableLength = TableDocument.getTableDataSpan(this._tableDef);
			if (tableLength <= 0) {
				// Cannot determine table range – fire unconditionally
				this._onDidChange.fire();
				return;
			}

			const tableEnd = tableStart + tableLength;
			const changeEnd = e.offset + e.length;

			// Overlap check: [tableStart, tableEnd) ∩ [e.offset, changeEnd)
			if (e.offset < tableEnd && changeEnd > tableStart) {
				this._onDidChange.fire();
			}
		});
	}

	/**
	 * Get the table URI
	 *
	 * This is the unique URI for this table (ecu-explorer://table?...)
	 */
	get uri(): vscode.Uri {
		return this._uri;
	}

	/**
	 * Get the parent ROM document
	 *
	 * All data operations should be performed on the parent ROM document.
	 */
	get romDocument(): RomDocument {
		return this._romDocument;
	}

	/**
	 * Get the table ID
	 *
	 * This is the table name/ID from the ROM definition.
	 */
	get tableId(): string {
		return this._tableId;
	}

	/**
	 * Get the table definition
	 *
	 * This is the table definition from the ROM definition.
	 */
	get tableDef(): TableDefinition {
		return this._tableDef;
	}

	/**
	 * Check if the table has unsaved changes
	 *
	 * Delegates to the parent ROM document, since tables are views into ROM data.
	 */
	get isDirty(): boolean {
		return this._romDocument.isDirty;
	}

	/**
	 * Dispose the table document
	 *
	 * This should be called when the table editor is closed.
	 */
	dispose(): void {
		// Clean up ROM change listeners
		if (this.romChangeListener) {
			this.romChangeListener.dispose();
			this.romChangeListener = undefined;
		}
		if (this.romBytesListener) {
			this.romBytesListener.dispose();
			this.romBytesListener = undefined;
		}

		this._onDidDispose.fire();
		this._onDidChange.dispose();
		this._onDidDispose.dispose();
	}

	/**
	 * Compute the byte span of this table's z-data in the ROM.
	 *
	 * Returns the number of bytes from `z.address` to the end of the last cell,
	 * i.e. the actual address range that must be covered in an overlap check.
	 *
	 * This is NOT simply `rows * rowStride`, which gives the wrong answer for
	 * ECUFlash tables with swapped axes (where `colStrideBytes > rowStrideBytes`).
	 * The correct formula is the address of the last cell plus its width:
	 *
	 *   table1d: (rows - 1) * rowStride + width
	 *   table2d: (rows - 1) * rowStride + (cols - 1) * colStride + width
	 *
	 * Example (Throttle Map #2 with swapxy):
	 *   rows=16, cols=49, colStrideBytes=32, rowStrideBytes=2, width=2
	 *   span = 15*2 + 48*32 + 2 = 30 + 1536 + 2 = 1568 bytes
	 *
	 * Returns 0 when the table geometry cannot be determined (e.g. missing
	 * `cols` on a 2-D table), so callers can fall back to firing unconditionally.
	 */
	private static getTableDataSpan(tableDef: TableDefinition): number {
		const sizeOf = (dtype: string): number => {
			switch (dtype) {
				case "u8":
				case "i8":
					return 1;
				case "u16":
				case "i16":
					return 2;
				case "u32":
				case "i32":
				case "f32":
					return 4;
				default:
					return 0;
			}
		};

		const width = sizeOf(tableDef.z.dtype);
		if (width === 0) return 0;

		if (tableDef.kind === "table1d") {
			const t = tableDef as Table1DDefinition;
			if (!t.rows) return 0;
			const rowStride = t.z.rowStrideBytes ?? width;
			// Span from first to last byte of last cell
			return (t.rows - 1) * rowStride + width;
		}

		// table2d / table3d
		const t = tableDef as Table2DDefinition;
		if (!t.rows || !t.cols) return 0;
		const colStride = t.z.colStrideBytes ?? width;
		const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
		// Span from first to last byte of last cell (row=rows-1, col=cols-1)
		return (t.rows - 1) * rowStride + (t.cols - 1) * colStride + width;
	}
}
