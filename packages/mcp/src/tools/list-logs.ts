/**
 * list_logs tool handler for the ECU Explorer MCP server.
 *
 * Lists available log files in the configured logs directory with metadata.
 * Returns YAML frontmatter + markdown table of log files sorted by recency.
 */

import type { McpConfig } from "../config.js";
import { buildMarkdownTable } from "../formatters/markdown.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { listLogFiles } from "../log-reader.js";

/**
 * Format a date as a UTC string for display.
 *
 * @param date - Date to format
 * @returns Formatted date string (e.g., "2026-02-22 14:30 UTC")
 */
function formatDate(date: Date): string {
	const y = date.getUTCFullYear();
	const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	const h = String(date.getUTCHours()).padStart(2, "0");
	const mi = String(date.getUTCMinutes()).padStart(2, "0");
	return `${y}-${mo}-${d} ${h}:${mi} UTC`;
}

/**
 * Handle the list_logs tool call.
 *
 * @param config - MCP server configuration
 * @returns Formatted output string
 */
export async function handleListLogs(config: McpConfig): Promise<string> {
	const logsDir = config.logsDir;
	const files = await listLogFiles(logsDir);

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		logs_dir: logsDir,
		total_files: files.length,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	if (files.length === 0) {
		return `${frontmatter}\n(No log files found in ${logsDir})`;
	}

	// Build markdown table
	// Columns: #, filename, date, duration_s, rows, sample_rate_hz, channels
	const headers = [
		"#",
		"Filename",
		"Date",
		"Duration (s)",
		"Rows",
		"Sample Rate (Hz)",
		"Channels",
	];

	const rows = files.map((file, index) => {
		const num = String(index + 1);
		const date = formatDate(file.mtime);
		const durationS =
			file.durationMs !== null ? (file.durationMs / 1000).toFixed(1) : "null";
		const rowCount = String(file.rowCount);
		const sampleRate =
			file.sampleRateHz !== null
				? Math.round(file.sampleRateHz).toString()
				: "null";
		const channels = file.channels.join(", ");
		return [
			num,
			file.fileName,
			date,
			durationS,
			rowCount,
			sampleRate,
			channels,
		];
	});

	const tableContent = buildMarkdownTable(headers, rows);

	return `${frontmatter}\n${tableContent}`;
}
