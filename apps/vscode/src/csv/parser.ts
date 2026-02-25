import type {
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";

/**
 * Table snapshot type - represents the current data in a table
 */
export type TableSnapshot =
	| {
			kind: "table1d";
			name: string;
			rows: number;
			x?: number[];
			z: number[];
			description?: string;
	  }
	| {
			kind: "table2d";
			name: string;
			rows: number;
			cols: number;
			x?: number[];
			y?: number[];
			z: number[][];
			description?: string;
	  };

/**
 * Parse CSV content into a 2D array of strings
 *
 * @param content - CSV file content
 * @returns 2D array of strings
 */
export function parseCsv(content: string): string[][] {
	const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
	return lines.map((line) => {
		// Simple CSV parsing - handles basic comma-separated values
		// For more complex CSV with quotes, we'd need a proper parser
		return line.split(",").map((cell) => cell.trim());
	});
}

/**
 * Convert CSV data to a table snapshot
 *
 * @param csvData - Parsed CSV data
 * @param def - Table definition
 * @returns Result with snapshot or error
 */
export function csvToSnapshot(
	csvData: string[][],
	def: TableDefinition,
):
	| { success: true; snapshot: TableSnapshot }
	| { success: false; error: string } {
	try {
		if (def.kind === "table1d") {
			return parseCsv1D(csvData, def);
		} else if (def.kind === "table2d") {
			return parseCsv2D(csvData, def);
		} else {
			return {
				success: false,
				error: "3D tables are not yet supported for CSV import",
			};
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Parse CSV for 1D table
 * Format: x,value (header) followed by data rows
 */
export function parseCsv1D(
	csvData: string[][],
	def: Table1DDefinition,
):
	| { success: true; snapshot: TableSnapshot }
	| { success: false; error: string } {
	// Skip header row
	const dataRows = csvData.slice(1);

	if (dataRows.length === 0) {
		return { success: false, error: "No data rows found in CSV" };
	}

	const z = [];
	const x = [];

	for (const row of dataRows) {
		if (row.length < 2) {
			return {
				success: false,
				error: `Invalid row format: expected 2 columns, got ${row.length}`,
			};
		}

		const xVal = Number.parseFloat(row[0] ?? "");
		const zVal = Number.parseFloat(row[1] ?? "");

		if (Number.isNaN(xVal) || Number.isNaN(zVal)) {
			return {
				success: false,
				error: `Invalid numeric value in row: ${row.join(",")}`,
			};
		}

		x.push(xVal);
		z.push(zVal);
	}

	const snapshot: TableSnapshot = {
		kind: "table1d",
		name: def.name,
		rows: z.length,
		...(x.length > 0 ? { x } : {}),
		z,
	};

	return {
		success: true,
		snapshot,
	};
}

/**
 * Parse CSV for 2D table
 * Format: header row with column labels, then data rows with row label + values
 */
export function parseCsv2D(
	csvData: string[][],
	def: Table2DDefinition,
):
	| { success: true; snapshot: TableSnapshot }
	| { success: false; error: string } {
	if (csvData.length < 2) {
		return {
			success: false,
			error: "CSV must have at least header and one data row",
		};
	}

	// Parse header row (first element is empty, rest are x-axis values)
	const headerRow = csvData[0];
	if (!headerRow) {
		return { success: false, error: "Missing header row" };
	}

	const x = [];
	for (let i = 1; i < headerRow.length; i++) {
		const val = Number.parseFloat(headerRow[i] ?? "");
		if (!Number.isNaN(val)) {
			x.push(val);
		}
	}

	// Parse data rows
	const z = [];
	const y = [];

	for (let i = 1; i < csvData.length; i++) {
		const row = csvData[i];
		if (!row || row.length < 2) {
			return {
				success: false,
				error: `Invalid row ${i}: expected at least 2 columns`,
			};
		}

		// First column is y-axis value
		const yVal = Number.parseFloat(row[0] ?? "");
		if (!Number.isNaN(yVal)) {
			y.push(yVal);
		}

		// Rest are z values
		const zRow: number[] = [];
		for (let j = 1; j < row.length; j++) {
			const zVal = Number.parseFloat(row[j] ?? "");
			if (Number.isNaN(zVal)) {
				return {
					success: false,
					error: `Invalid numeric value at row ${i}, col ${j}: ${row[j] ?? ""}`,
				};
			}
			zRow.push(zVal);
		}
		z.push(zRow);
	}

	const snapshot = {
		kind: "table2d",
		name: def.name,
		rows: z.length,
		cols: z[0]?.length ?? 0,
		...(x.length > 0 ? { x } : {}),
		...(y.length > 0 ? { y } : {}),
		z,
	} satisfies TableSnapshot;

	return {
		success: true,
		snapshot,
	};
}
