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
 * Converts && to and, || to or, ! to not (when not part of !=).
 */
function normalizeFilterExpression(expr: string): string {
	return expr
		.replace(/&&/g, " and ")
		.replace(/\|\|/g, " or ")
		.replace(/!(?!=)/g, " not ");
}

/**
 * Escape a string for regex usage.
 */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveLogFilePath(logsDir: string, requestedFile: string): string {
	const candidatePath = path.isAbsolute(requestedFile)
		? requestedFile
			: path.resolve(logsDir, requestedFile);

	const normalizedBase = path.resolve(logsDir);
	const normalizedCandidate = path.resolve(candidatePath);
	const rel = path.relative(normalizedBase, normalizedCandidate);
	const isInside =
		rel === "" ||
		(!rel.startsWith("..") &&
			!path.isAbsolute(rel) &&
			!rel.startsWith(`..${path.sep}`));

	if (!isInside) {
		throw new Error(`Invalid log file path: ${requestedFile}`);
	}

	return normalizedCandidate;
}

/**
 * Extract channel names referenced in a filter expression.
 * Looks for identifiers that are not numbers, keywords, or function names.
 */
function extractChannelsFromFilter(
	filter: string,
	headers: string[],
): string[] {
	const normalizedFilter = normalizeFilterExpression(filter);
	const candidates = new Set<string>();
	const sortedHeaders = [...headers].sort((a, b) => b.length - a.length);

	for (const header of sortedHeaders) {
		const escaped = escapeRegex(header);
		const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`, "i");

		if (pattern.test(normalizedFilter)) {
			candidates.add(header);
		}
	}

	return Array.from(candidates);
}

function buildFilterAliasMap(headers: string[]): {
	originalToAlias: Map<string, string>;
} {
	const originalToAlias = new Map<string, string>();
	const seen = new Set<string>();

	for (const header of headers) {
		if (seen.has(header)) {
			continue;
		}

		seen.add(header);
		const alias = `__ch_${originalToAlias.size}`;
		originalToAlias.set(header, alias);
	}

	return { originalToAlias };
}

function rewriteFilterExpression(
	filter: string,
	originalToAlias: Map<string, string>,
): string {
	let result = filter;
	const entries = [...originalToAlias.entries()].sort(
		(a, b) => b[0].length - a[0].length,
	);

	for (const [original, alias] of entries) {
		if (original.length === 0) {
			continue;
		}

		const escaped = escapeRegex(original);
		const re = new RegExp(
			`(^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`,
			"g",
		);

		result = result.replace(re, (_match, prefix) => `${prefix}${alias}`);
	}

	return result;
}

function buildAliasRow(
	headers: string[],
	row: Record<string, number>,
	originalToAlias: Map<string, string>,
): Record<string, number> {
	const aliasValues: Record<string, number> = {};

	for (const header of headers) {
		const alias = originalToAlias.get(header);
		if (!alias) {
			continue;
		}

		const value = row[header];
		if (value !== undefined) {
			aliasValues[alias] = value;
		}
	}

	return aliasValues;
}

function formatLogValue(v: number | undefined): string {
	if (v === undefined || !Number.isFinite(v)) return "";
	const s = v.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

/**
 * Handle the query_logs tool call.
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
	const normalizedFilter = normalizeFilterExpression(filter);

	const logsDir = config.logsDir;
	let filePaths: string[];

	if (file !== undefined) {
		const filePath = resolveLogFilePath(logsDir, file);
		try {
			await fs.stat(filePath);
		} catch {
			throw new Error(`Log file not found: ${filePath}`);
		}
		filePaths = [filePath];
	} else {
		const logFiles = await listLogFiles(logsDir);
		if (logFiles.length === 0) {
			throw new Error(
				`No log files found in ${logsDir}. Use list_logs to check available log files.`,
			);
		}
		filePaths = logFiles.map((f) => f.filePath);
	}

	const parsedByFile = new Map<
		string,
		{
			headers: string[];
			timeColumnName: string | null;
			rows: Record<string, number>[];
			sampleRateHz: number | null;
		}
	>();
	const allMatchingRows: Record<string, number>[] = [];
	let filesSearched = 0;
	let actualSampleRateHz: number | null = null;
	let timeColumnName: string | null = null;
	const allHeaders: string[] = [];

	for (const filePath of filePaths) {
		try {
			const parsed = await parseLogFileRows(filePath);
			filesSearched++;
			parsedByFile.set(filePath, parsed);

			if (parsed.timeColumnName && !timeColumnName) {
				timeColumnName = parsed.timeColumnName;
			}

			if (parsed.sampleRateHz !== null && actualSampleRateHz === null) {
				actualSampleRateHz = parsed.sampleRateHz;
			}

			for (const header of parsed.headers) {
				if (!allHeaders.includes(header)) {
					allHeaders.push(header);
				}
			}
		} catch {
			// Skip files that can't be read
		}
	}

	if (allHeaders.length === 0) {
		if (file !== undefined) {
			throw new Error(`No log data found in ${file}.`);
		}
		throw new Error(
			`No log files found in ${logsDir}. Use list_logs to check available log files.`,
		);
	}

	const { originalToAlias } = buildFilterAliasMap(allHeaders);
	const expressionWithAliases = rewriteFilterExpression(
		normalizedFilter,
		originalToAlias,
	);

	let filterFn: (obj: Record<string, number>) => unknown;
	try {
		filterFn = compileExpression(expressionWithAliases);
	} catch (err) {
		throw new Error(
			`Invalid filter expression: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	for (const parsed of parsedByFile.values()) {
		for (const row of parsed.rows) {
			const aliasRow = buildAliasRow(parsed.headers, row, originalToAlias);
			try {
				const result = filterFn({ ...row, ...aliasRow });
				if (result) {
					allMatchingRows.push(row);
				}
			} catch {
				// Skip rows where filter evaluation fails (e.g. missing channel)
			}
		}
	}

	const rowsMatched = allMatchingRows.length;
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

	const sampledRows =
		stride > 1
			? allMatchingRows.filter((_, i) => i % stride === 0)
			: allMatchingRows;

	const filterChannels = extractChannelsFromFilter(filter, allHeaders);

	const outputChannelSet = new Set<string>();
	if (timeColumnName) {
		outputChannelSet.add(timeColumnName);
	}

	for (const ch of filterChannels) {
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

	const outputChannels =
		outputChannelSet.size > 0 ? Array.from(outputChannelSet) : allHeaders;

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
