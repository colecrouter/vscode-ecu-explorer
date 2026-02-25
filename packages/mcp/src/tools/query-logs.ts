/**
 * query_logs tool handler for the ECU Explorer MCP server.
 *
 * Queries live-data log files using a filter expression.
 * Returns YAML frontmatter + markdown table of time-series data.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compileExpression } from "filtrex";
import type { McpConfig } from "../config.js";
import { buildMarkdownTable } from "../formatters/markdown.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { listLogFiles, parseLogFileRows } from "../log-reader.js";

/**
 * Normalize a filter expression from JS-style operators to filtrex syntax.
 * Converts && → and, || → or, ! → not (when not part of !=).
 */
function normalizeFilterExpression(expr: string): string {
	return expr
		.replace(/&&/g, " and ")
		.replace(/\|\|/g, " or ")
		.replace(/!(?!=)/g, " not ");
}

/**
 * Extract channel names referenced in a filter expression.
 * Looks for identifiers that are not numbers, keywords, or function names.
 */
function extractChannelsFromFilter(filter: string): string[] {
	// Match identifiers (words that start with a letter or underscore)
	// Exclude known filtrex keywords and functions
	const keywords = new Set([
		"and",
		"or",
		"not",
		"in",
		"of",
		"if",
		"then",
		"else",
		"abs",
		"ceil",
		"floor",
		"log",
		"log2",
		"log10",
		"max",
		"min",
		"round",
		"sqrt",
		"exists",
		"empty",
		"mod",
		"true",
		"false",
	]);

	const identifiers = new Set<string>();
	const regex = /\b([A-Za-z_][A-Za-z0-9_ ]*)\b/g;
	const matches = [...filter.matchAll(regex)];

	for (const match of matches) {
		const name = match[1]?.trim();
		if (name && !keywords.has(name.toLowerCase()) && !/^\d/.test(name)) {
			identifiers.add(name);
		}
	}

	return Array.from(identifiers);
}

/**
 * Format a number for display in a log table cell.
 */
function formatLogValue(v: number | undefined): string {
	if (v === undefined || !Number.isFinite(v)) return "";
	const s = v.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

/**
 * Handle the query_logs tool call.
 *
 * @param options - Query options
 * @param config - MCP server configuration
 * @returns Formatted output string
 */
export async function handleQueryLogs(
	options: {
		filter: string;
		channels?: string[];
		file?: string;
		sampleRate?: number;
	},
	config: McpConfig,
): Promise<string> {
	const { filter, channels: extraChannels, file, sampleRate } = options;

	// Normalize filter expression for filtrex
	const normalizedFilter = normalizeFilterExpression(filter);

	// Compile filter expression
	let filterFn: (obj: Record<string, number>) => unknown;
	try {
		filterFn = compileExpression(normalizedFilter);
	} catch (err) {
		throw new Error(
			`Invalid filter expression: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Determine which files to search
	const logsDir = config.logsDir;
	let filePaths: string[];

	if (file !== undefined) {
		// Search only the specified file
		const filePath = path.isAbsolute(file) ? file : path.join(logsDir, file);
		// Verify file exists
		try {
			await fs.stat(filePath);
		} catch {
			throw new Error(`Log file not found: ${filePath}`);
		}
		filePaths = [filePath];
	} else {
		// Search all CSV files in the logs directory
		const logFiles = await listLogFiles(logsDir);
		if (logFiles.length === 0) {
			throw new Error(
				`No log files found in ${logsDir}. Use list_logs to check available log files.`,
			);
		}
		filePaths = logFiles.map((f) => f.filePath);
	}

	// Extract channels referenced in the filter expression
	const filterChannels = extractChannelsFromFilter(filter);

	// Collect all matching rows across files
	const allMatchingRows: Record<string, number>[] = [];
	let filesSearched = 0;
	let actualSampleRateHz: number | null = null;
	let timeColumnName: string | null = null;
	let allHeaders: string[] = [];

	for (const filePath of filePaths) {
		try {
			const {
				headers,
				timeColumnName: timeCol,
				rows,
				sampleRateHz,
			} = await parseLogFileRows(filePath);

			filesSearched++;

			if (timeCol && !timeColumnName) {
				timeColumnName = timeCol;
			}

			if (sampleRateHz !== null && actualSampleRateHz === null) {
				actualSampleRateHz = sampleRateHz;
			}

			if (allHeaders.length === 0) {
				allHeaders = headers;
			}

			// Filter rows using the expression
			for (const row of rows) {
				try {
					const result = filterFn(row);
					if (result) {
						allMatchingRows.push(row);
					}
				} catch {
					// Skip rows where filter evaluation fails (e.g. missing channel)
				}
			}
		} catch {
			// Skip files that can't be read
		}
	}

	const rowsMatched = allMatchingRows.length;

	// Determine output sample rate and stride
	let outputSampleRateHz = actualSampleRateHz;
	let stride = 1;

	if (
		sampleRate !== undefined &&
		actualSampleRateHz !== null &&
		actualSampleRateHz > 0
	) {
		stride = Math.max(1, Math.round(actualSampleRateHz / sampleRate));
		outputSampleRateHz = actualSampleRateHz / stride;
	}

	// Apply stride downsampling
	const sampledRows =
		stride > 1
			? allMatchingRows.filter((_, i) => i % stride === 0)
			: allMatchingRows;

	// Determine output channels:
	// 1. Time column (if present)
	// 2. Channels from filter expression
	// 3. Extra channels from parameter
	const outputChannelSet = new Set<string>();

	if (timeColumnName) {
		outputChannelSet.add(timeColumnName);
	}

	for (const ch of filterChannels) {
		// Only include channels that actually exist in the data
		if (allHeaders.includes(ch)) {
			outputChannelSet.add(ch);
		}
	}

	if (extraChannels) {
		for (const ch of extraChannels) {
			if (allHeaders.includes(ch)) {
				outputChannelSet.add(ch);
			}
		}
	}

	// If no channels determined, include all headers
	const outputChannels =
		outputChannelSet.size > 0 ? Array.from(outputChannelSet) : allHeaders;

	// Build YAML frontmatter
	const frontmatterData: Record<string, unknown> = {
		files_searched: filesSearched,
		rows_matched: rowsMatched,
		actual_sample_rate_hz: actualSampleRateHz,
		output_sample_rate_hz: outputSampleRateHz,
		channels: outputChannels,
	};

	const frontmatter = toYamlFrontmatter(frontmatterData);

	if (sampledRows.length === 0) {
		return `${frontmatter}\n(No rows matched the filter expression)`;
	}

	// Build markdown table
	// First column is time (if present), then other channels
	const timeCol = timeColumnName;
	const headers: string[] = [];

	if (timeCol && outputChannels.includes(timeCol)) {
		headers.push(`Time (s)`);
	}

	for (const ch of outputChannels) {
		if (ch !== timeCol) {
			headers.push(ch);
		}
	}

	const tableRows: string[][] = sampledRows.map((row) => {
		const cells: string[] = [];

		if (timeCol && outputChannels.includes(timeCol)) {
			const timeVal = row[timeCol];
			if (timeVal !== undefined) {
				// Convert ms to s if needed
				const isMs = Math.abs(timeVal) > 1000;
				const timeS = isMs ? timeVal / 1000 : timeVal;
				cells.push(timeS.toFixed(2));
			} else {
				cells.push("");
			}
		}

		for (const ch of outputChannels) {
			if (ch !== timeCol) {
				cells.push(formatLogValue(row[ch]));
			}
		}

		return cells;
	});

	const markdownTable = buildMarkdownTable(headers, tableRows);

	return `${frontmatter}\n${markdownTable}`;
}
