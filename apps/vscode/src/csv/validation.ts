import type {
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import { validateValue } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { TableSnapshot } from "./parser";

/**
 * Import preview data for user confirmation
 */
export interface ImportPreview {
	tableName: string;
	dimensions: { rows: number; cols?: number };
	beforeValues: number[][] | number[];
	afterValues: number[][] | number[];
	errors: ValidationError[];
	warnings: ValidationWarning[];
	scaleOffsetMismatch?: {
		csvScale: number;
		csvOffset: number;
		tableScale: number;
		tableOffset: number;
	};
	unitMismatch?: {
		csvUnit?: string;
		tableUnit?: string;
		suggestedConversion?: string;
	};
}

/**
 * Validation error for import
 */
export interface ValidationError {
	row: number;
	col?: number;
	value: number;
	error: string;
	suggestion?: string;
}

/**
 * Validation warning for import
 */
export interface ValidationWarning {
	row: number;
	col?: number;
	value: number;
	warning: string;
	suggestion?: string;
}

/**
 * Validate that imported snapshot dimensions match current table
 */
export function validateDimensions(
	imported: TableSnapshot,
	current: TableSnapshot,
): boolean {
	if (imported.kind !== current.kind) {
		return false;
	}

	if (imported.rows !== current.rows) {
		return false;
	}

	if (imported.kind === "table2d" && current.kind === "table2d") {
		if (imported.cols !== current.cols) {
			return false;
		}
	}

	return true;
}

/**
 * Generate import preview with validation
 */
export function generateImportPreview(
	imported: TableSnapshot,
	current: TableSnapshot,
	def: TableDefinition,
): ImportPreview {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Validate all imported values
	if (imported.kind === "table1d") {
		const t = def as Table1DDefinition;
		for (let i = 0; i < imported.z.length; i++) {
			const value = imported.z[i];
			if (value === undefined) continue;

			const context = {
				dtype: t.z.dtype,
				min: undefined,
				max: undefined,
				scale: t.z.scale,
				offset: t.z.offset,
			};

			const result = validateValue(value, context);
			if (!result.valid) {
				const errorItem: ValidationError = {
					row: i,
					value,
					error: result.error || "Invalid value",
				};
				if (result.suggestion) {
					errorItem.suggestion = result.suggestion;
				}
				errors.push(errorItem);
			}
		}
	} else if (imported.kind === "table2d") {
		const t = def as Table2DDefinition;
		for (let row = 0; row < imported.z.length; row++) {
			const zRow = imported.z[row];
			if (!zRow) continue;

			for (let col = 0; col < zRow.length; col++) {
				const value = zRow[col];
				if (value === undefined) continue;

				const context = {
					dtype: t.z.dtype,
					min: undefined,
					max: undefined,
					scale: t.z.scale,
					offset: t.z.offset,
				};

				const result = validateValue(value, context);
				if (!result.valid) {
					const errorItem: ValidationError = {
						row,
						col,
						value,
						error: result.error || "Invalid value",
					};
					if (result.suggestion) {
						errorItem.suggestion = result.suggestion;
					}
					errors.push(errorItem);
				}
			}
		}
	}

	// Get first 5 rows for preview
	const beforeValues = getPreviewValues(current, 5);
	const afterValues = getPreviewValues(imported, 5);

	const dimensions: { rows: number; cols?: number } = {
		rows: imported.rows,
	};
	if (imported.kind === "table2d") {
		dimensions.cols = imported.cols;
	}

	return {
		tableName: imported.name,
		dimensions,
		beforeValues,
		afterValues,
		errors,
		warnings,
	};
}

/**
 * Get preview values (first N rows)
 */
export function getPreviewValues(
	snapshot: TableSnapshot,
	maxRows: number,
): number[][] | number[] {
	if (snapshot.kind === "table1d") {
		return snapshot.z.slice(0, maxRows);
	} else {
		return snapshot.z.slice(0, maxRows);
	}
}

/**
 * Show import preview dialog
 */
export async function showImportPreviewDialog(
	preview: ImportPreview,
): Promise<boolean> {
	const errorCount = preview.errors.length;
	const warningCount = preview.warnings.length;

	let message = `Import ${preview.tableName}?\n\n`;
	message += `Dimensions: ${preview.dimensions.rows} rows`;
	if (preview.dimensions.cols) {
		message += ` x ${preview.dimensions.cols} columns`;
	}
	message += "\n\n";

	if (errorCount > 0) {
		message += `⚠️ ${errorCount} validation error(s)\n`;
		preview.errors.slice(0, 3).forEach((err) => {
			message += `  • Row ${err.row}${err.col !== undefined ? `, Col ${err.col}` : ""}: ${err.error}\n`;
		});
		if (errorCount > 3) {
			message += `  ... and ${errorCount - 3} more\n`;
		}
		message += "\n";
	}

	if (warningCount > 0) {
		message += `ℹ️ ${warningCount} warning(s)\n`;
		preview.warnings.slice(0, 3).forEach((warn) => {
			message += `  • Row ${warn.row}${warn.col !== undefined ? `, Col ${warn.col}` : ""}: ${warn.warning}\n`;
		});
		if (warningCount > 3) {
			message += `  ... and ${warningCount - 3} more\n`;
		}
	}

	// If there are critical errors, show error dialog
	if (errorCount > 0) {
		const result = await vscode.window.showErrorMessage(
			message,
			{ modal: true },
			"Cancel",
			"Import Anyway",
		);
		return result === "Import Anyway";
	}

	// Otherwise show info dialog
	const result = await vscode.window.showInformationMessage(
		message,
		{ modal: true },
		"Cancel",
		"Import",
	);
	return result === "Import";
}
