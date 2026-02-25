/**
 * Shared markdown formatting utilities for the ECU Explorer MCP server.
 */

/**
 * Build a markdown table from headers and rows.
 *
 * Column widths are computed as the maximum of the header length and the
 * longest cell value in that column, so separators are never too short.
 *
 * @param headers - Column header strings
 * @param rows - Data rows (each row is an array of cell strings)
 * @returns Formatted markdown table string
 */
export function buildMarkdownTable(
	headers: string[],
	rows: string[][],
): string {
	const colWidths = headers.map((h) => h.length);
	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			const cell = row[i] ?? "";
			if (cell.length > (colWidths[i] ?? 0)) {
				colWidths[i] = cell.length;
			}
		}
	}

	const pad = (s: string, w: number) => s.padEnd(w);
	const headerRow = `| ${headers.map((h, i) => pad(h, colWidths[i] ?? h.length)).join(" | ")} |`;
	const sepRow = `| ${colWidths.map((w) => "-".repeat(Math.max(w, 1))).join(" | ")} |`;
	const dataRows = rows.map(
		(row) =>
			`| ${row.map((cell, i) => pad(cell, colWidths[i] ?? cell.length)).join(" | ")} |`,
	);

	return [headerRow, sepRow, ...dataRows].join("\n");
}
