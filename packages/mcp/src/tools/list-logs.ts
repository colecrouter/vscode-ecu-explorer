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
export async function handleListLogs(
	config: McpConfig,
	options: {
		query?: string;
		page?: number;
		pageSize?: number;
	} = {},
): Promise<string> {
	const { query, page = 1, pageSize = 25 } = options;
	const logsDir = config.logsDir;
	const allFiles = await listLogFiles(logsDir);
	const normalizedTokens =
		query?.toLowerCase().split(/\s+/).filter((token) => token.length > 0) ?? [];

	const files =
		normalizedTokens.length > 0
			? allFiles.filter((file) => {
					const haystack = [
						file.fileName,
						formatDate(file.mtime),
						file.durationMs !== null ? (file.durationMs / 1000).toFixed(1) : "",
						file.rowCount.toString(),
						file.sampleRateHz !== null
							? Math.round(file.sampleRateHz).toString()
							: "",
						...file.channels,
					]
						.join(" ")
						.toLowerCase();

					return normalizedTokens.every((token) => haystack.includes(token));
				})
			: allFiles;

	const safePageSize = Math.max(1, pageSize);
	const totalPages = files.length === 0 ? 0 : Math.ceil(files.length / safePageSize);
	const safePage = totalPages === 0 ? 1 : Math.min(Math.max(1, page), totalPages);
	const startIndex = (safePage - 1) * safePageSize;
	const pagedFiles = files.slice(startIndex, startIndex + safePageSize);

	// Build frontmatter
	const frontmatterData: Record<string, unknown> = {
		logs_dir: logsDir,
		total_files: files.length,
		page: safePage,
		page_size: safePageSize,
		total_pages: totalPages,
		query: query ?? null,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	if (pagedFiles.length === 0) {
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

	const rows = pagedFiles.map((file, index) => {
		const num = String(startIndex + index + 1);
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
