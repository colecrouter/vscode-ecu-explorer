/**
 * Log formatter for the ECU Explorer MCP server.
 *
 * Renders log data as YAML frontmatter + markdown table.
 *
 * Output format:
 *   ---
 *   file: log-2026-02-22T14-30-00-000Z.csv
 *   session_duration_ms: 45230
 *   channels: [RPM, MAP, Coolant Temp]
 *   sample_count: 4523
 *   filtered_count: 452
 *   start_ms: 0
 *   end_ms: 45230
 *   ---
 *
 *   | Timestamp (ms) | RPM | MAP (kPa) | ... |
 *   |----------------|-----|-----------|-----|
 *   | 0              | 850 | 35.2      | ... |
 */

import type { LogData } from "../log-reader.js";
import { buildMarkdownTable } from "./markdown.js";
import { toYamlFrontmatter } from "./yaml-formatter.js";

/**
 * Format a number for display in a log table cell.
 */
function formatLogValue(v: number | null): string {
	if (v === null) return "";
	if (!Number.isFinite(v)) return String(v);
	// Use up to 2 decimal places for log data
	const s = v.toFixed(2);
	return s.replace(/\.?0+$/, "");
}

/**
 * Format log data as YAML frontmatter + markdown table.
 *
 * @param data - Log data to format
 * @param options - Formatting options
 * @returns Formatted log content
 */
export function formatLogData(
	data: LogData,
	options: {
		startMs?: number;
		endMs?: number;
	} = {},
): string {
	const { file, rows, channels, units } = data;

	// Compute actual time range from rows
	const firstTs = rows.length > 0 ? (rows[0]?.timestampMs ?? 0) : 0;
	const lastTs =
		rows.length > 0 ? (rows[rows.length - 1]?.timestampMs ?? 0) : 0;

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		file: file.fileName,
		session_duration_ms: file.durationMs,
		channels: channels,
		sample_count: file.rowCount,
		filtered_count: rows.length,
		start_ms: options.startMs ?? firstTs,
		end_ms: options.endMs ?? lastTs,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	if (rows.length === 0) {
		return `${frontmatter}\n(No data rows match the specified filters)`;
	}

	// Build column headers: "Timestamp (ms)" + channel names with units
	const headers = [
		"Timestamp (ms)",
		...channels.map((ch, i) => {
			const unit = units[i];
			return unit ? `${ch} (${unit})` : ch;
		}),
	];

	// Build data rows
	const tableRows: string[][] = rows.map((row) => {
		const tsCell = String(row.timestampMs);
		const valueCells = channels.map((ch) => {
			const val = row.values.get(ch);
			return formatLogValue(val ?? null);
		});
		return [tsCell, ...valueCells];
	});

	const markdownTable = buildMarkdownTable(headers, tableRows);

	return `${frontmatter}\n${markdownTable}`;
}
