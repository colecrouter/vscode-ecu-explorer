import {
	type RomInstance,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { TableSnapshot } from "./parser";

/**
 * Handle CSV export flow
 *
 * Exports the active table to CSV format and saves to user-selected location.
 * Shows success/error messages to user.
 *
 * @param ctx - Extension context
 * @param activeRom - Current active ROM instance
 * @param activeTableName - Name of the active table
 * @param activeTableDef - Definition of the active table
 */
export async function exportActiveTableCsvFlow(
	ctx: vscode.ExtensionContext,
	activeRom: RomInstance | null,
	activeTableName: string | null,
	activeTableDef: TableDefinition | null,
) {
	if (!activeRom || !activeTableName || !activeTableDef) {
		vscode.window.showWarningMessage("Open a table first.");
		return;
	}

	const snapshot = snapshotTable(activeTableDef, activeRom.bytes);
	const csv = snapshotToCsv(snapshot);
	const defaultUri = vscode.Uri.file(
		new URL(
			`./${sanitizeFilename(snapshot.name)}.csv`,
			ctx.globalStorageUri.toString(),
		).toString(),
	);
	const uri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: { CSV: ["csv"] },
		saveLabel: "Export CSV",
	});
	if (!uri) return;
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(csv));
	vscode.window.showInformationMessage(`Exported ${snapshot.name} to CSV.`);
}

/**
 * Sanitize filename to remove invalid characters
 *
 * @param input - Raw filename
 * @returns Sanitized filename safe for filesystem
 */
export function sanitizeFilename(input: string): string {
	const replaced = input.replace(/[<>:"/\\|?*]/g, "_");
	const safe = Array.from(replaced, (ch) => (ch <= "\u001F" ? "_" : ch)).join(
		"",
	);
	return safe.slice(0, 120);
}

/**
 * Convert table snapshot to CSV string
 *
 * @param snapshot - Table snapshot to convert
 * @returns CSV formatted string
 */
export function snapshotToCsv(snapshot: TableSnapshot): string {
	if (snapshot.kind === "table1d") {
		const header = ["x", "value"];
		const lines = [header.join(",")];
		for (let i = 0; i < snapshot.z.length; i++) {
			const x = snapshot.x ? snapshot.x[i] : i;
			lines.push(`${x},${snapshot.z[i]}`);
		}
		return lines.join("\n");
	}

	const header = [""].concat(
		(snapshot.x ?? Array.from({ length: snapshot.cols }, (_, i) => i)).map(
			String,
		),
	);
	const lines = [header.join(",")];
	for (let r = 0; r < snapshot.rows; r++) {
		const y = snapshot.y ? snapshot.y[r] : r;
		const row = snapshot.z[r] ?? [];
		lines.push([String(y)].concat(row.map(String)).join(","));
	}
	return lines.join("\n");
}
