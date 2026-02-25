import {
	encodeScalar,
	type RomInstance,
	sizeOf,
	snapshotTable,
	type Table1DDefinition,
	type Table2DDefinition,
	type TableDefinition,
} from "@ecu-explorer/core";
import type { UndoRedoManager } from "src/undo-redo-manager";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document";
import { csvToSnapshot, parseCsv, type TableSnapshot } from "./parser";
import {
	generateImportPreview,
	showImportPreviewDialog,
	validateDimensions,
} from "./validation";

/**
 * Get RomDocument for a webview panel
 *
 * Retrieves the RomDocument instance associated with a given webview panel.
 * Used for dirty state tracking and document operations.
 */
function getRomDocumentForPanel(
	panel: vscode.WebviewPanel,
	panelToDocument: Map<vscode.WebviewPanel, RomDocument>,
): RomDocument | undefined {
	return panelToDocument.get(panel);
}

/**
 * Handle CSV import flow
 *
 * Prompts user to select a CSV file, validates against current table,
 * and applies changes to ROM after user confirmation.
 *
 * @param _ctx - Extension context
 * @param activeRom - Current active ROM instance
 * @param activeTableName - Name of the active table
 * @param activeTableDef - Definition of the active table
 * @param activePanel - Active webview panel
 * @param undoRedoManager - Undo/redo manager for this table
 * @param panelToDocument - Map of panels to documents
 */
export async function importTableFromCsvFlow(
	_ctx: vscode.ExtensionContext,
	activeRom: RomInstance | null,
	activeTableName: string | null,
	activeTableDef: TableDefinition | null,
	activePanel: vscode.WebviewPanel | null,
	undoRedoManager: UndoRedoManager | null,
	panelToDocument: Map<vscode.WebviewPanel, RomDocument>,
) {
	if (!activeRom || !activeTableName || !activeTableDef || !activePanel) {
		vscode.window.showWarningMessage("Open a table first.");
		return;
	}

	// Prompt user to select CSV file
	const uri = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		filters: { CSV: ["csv"] },
		openLabel: "Import CSV",
	});

	if (!uri || uri.length === 0) return;
	const selectedUri = uri[0];
	if (!selectedUri) return;

	try {
		// Read CSV file
		const csvContent = await vscode.workspace.fs.readFile(selectedUri);
		const csvData = parseCsv(new TextDecoder().decode(csvContent));

		if (csvData.length === 0) {
			vscode.window.showErrorMessage("CSV file is empty.");
			return;
		}

		// Parse CSV based on table type
		const result = csvToSnapshot(csvData, activeTableDef);

		if (!result.success) {
			vscode.window.showErrorMessage(`CSV import failed: ${result.error}`);
			return;
		}

		// Get current snapshot for comparison
		const currentSnapshot = snapshotTable(activeTableDef, activeRom.bytes);

		// Validate dimensions match
		if (!validateDimensions(result.snapshot, currentSnapshot)) {
			vscode.window.showErrorMessage(
				`CSV dimensions don't match table. Expected ${currentSnapshot.rows} rows` +
					(currentSnapshot.kind === "table2d"
						? ` x ${currentSnapshot.cols} columns`
						: ""),
			);
			return;
		}

		// Generate import preview with validation
		const preview = generateImportPreview(
			result.snapshot,
			currentSnapshot,
			activeTableDef,
		);

		// Show preview dialog
		const confirmed = await showImportPreviewDialog(preview);
		if (!confirmed) {
			return;
		}

		// Apply changes to ROM
		await applySnapshotToRom(
			result.snapshot,
			activeTableDef,
			activeRom,
			activePanel,
			undoRedoManager,
			panelToDocument,
		);

		vscode.window.showInformationMessage(
			`Imported ${activeTableName} from CSV.`,
		);
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to import CSV: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Apply imported snapshot data to ROM
 *
 * Converts snapshot values back to raw bytes and writes to ROM,
 * creating a batch undo/redo operation for all changes.
 *
 * @param snapshot - Imported table snapshot
 * @param def - Table definition
 * @param rom - ROM instance to update
 * @param panel - Webview panel for sending updates
 * @param undoRedoManager - Undo/redo manager
 * @param panelToDocument - Map of panels to documents
 */
export async function applySnapshotToRom(
	snapshot: TableSnapshot,
	def: TableDefinition,
	rom: RomInstance,
	panel: vscode.WebviewPanel,
	undoRedoManager: UndoRedoManager | null,
	panelToDocument: Map<vscode.WebviewPanel, RomDocument>,
): Promise<void> {
	if (!undoRedoManager) {
		throw new Error("Undo/redo manager not initialized");
	}

	// Create a batch edit operation for undo
	const batchOps = [];

	if (snapshot.kind === "table1d") {
		const t = def as Table1DDefinition;
		const width = sizeOf(t.z.dtype);
		const stride = t.z.rowStrideBytes ?? width;

		for (let row = 0; row < snapshot.z.length; row++) {
			const address = (t.z.address ?? 0) + row * stride;
			const oldValue = rom.bytes.slice(address, address + width);

			// Convert scaled value back to raw value
			const scaledValue = snapshot.z[row];
			if (scaledValue === undefined) continue;
			const rawValue = (scaledValue - (t.z.offset ?? 0)) / (t.z.scale ?? 1);
			const newValue = encodeScalar(rawValue, t.z.dtype, t.z.endianness);

			batchOps.push({
				row,
				col: 0,
				oldValue,
				newValue,
				timestamp: Date.now(),
				label: `Import CSV row ${row}`,
			});

			rom.bytes.set(newValue, address);
		}
	} else if (snapshot.kind === "table2d") {
		const t = def as Table2DDefinition;
		const width = sizeOf(t.z.dtype);
		const colStride = t.z.colStrideBytes ?? width;
		const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;

		for (let row = 0; row < snapshot.rows; row++) {
			const zRow = snapshot.z[row];
			if (!zRow) continue;

			for (let col = 0; col < zRow.length; col++) {
				const address = (t.z.address ?? 0) + row * rowStride + col * colStride;
				const oldValue = rom.bytes.slice(address, address + width);

				// Convert scaled value back to raw value
				const scaledValue = zRow[col];
				if (scaledValue === undefined) continue;
				const rawValue = (scaledValue - (t.z.offset ?? 0)) / (t.z.scale ?? 1);
				const newValue = encodeScalar(rawValue, t.z.dtype, t.z.endianness);

				batchOps.push({
					row,
					col,
					oldValue,
					newValue,
					timestamp: Date.now(),
					label: `Import CSV cell (${row}, ${col})`,
				});

				rom.bytes.set(newValue, address);
			}
		}
	}

	// Push all operations as a single atomic undo unit
	undoRedoManager.pushBatch(batchOps, `Import CSV (${batchOps.length} cells)`);

	// Mark the RomDocument as dirty
	const document = getRomDocumentForPanel(panel, panelToDocument);
	if (document) {
		// For batch operations, we use the table's address and total length
		const width = sizeOf(def.z.dtype);
		let length = 0;
		if (def.kind === "table1d") {
			const t = def as Table1DDefinition;
			length = t.rows * (t.z.rowStrideBytes ?? width);
		} else {
			const t = def as Table2DDefinition;
			const colStride = t.z.colStrideBytes ?? width;
			const rowStride = t.z.rowStrideBytes ?? t.cols * colStride;
			length = t.rows * rowStride;
		}
		document.updateBytes(rom.bytes, def.z.address, length);
	}

	// Send updated snapshot to webview
	const newSnapshot = snapshotTable(def, rom.bytes);
	await panel.webview.postMessage({
		type: "snapshot",
		snapshot: newSnapshot,
	});
}
