/**
 * Log reader for the ECU Explorer MCP server.
 *
 * Parses CSV log files produced by the VSCode extension's LoggingManager.
 * CSV format:
 *   Row 0: headers — "Timestamp (ms),<PID Name 1>,<PID Name 2>,..."
 *   Row 1: units  — "Unit,<unit1>,<unit2>,..."
 *   Row 2+: data  — "<timestamp_ms>,<value1>,<value2>,..."
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface LogFile {
	/** Absolute path to the log file */
	filePath: string;
	/** File name (basename) */
	fileName: string;
	/** File size in bytes */
	fileSizeBytes: number;
	/** File modification time */
	mtime: Date;
	/** Channel names (from header row, excluding timestamp column) */
	channels: string[];
	/** Units for each channel (from units row) */
	units: string[];
	/** Total number of data rows */
	rowCount: number;
	/** Session duration in milliseconds (last timestamp - first timestamp); null if no time column */
	durationMs: number | null;
	/** Sample rate in Hz computed from time column; null if no time column */
	sampleRateHz: number | null;
}

export interface LogMetadata {
	/** Channel names (all columns including time column if present) */
	channels: string[];
	/** Total number of data rows */
	rowCount: number;
	/** Session duration in seconds; null if no time column */
	durationS: number | null;
	/** Sample rate in Hz; null if no time column */
	sampleRateHz: number | null;
}

export interface LogRow {
	/** Timestamp in milliseconds (relative to session start) */
	timestampMs: number;
	/** Channel values, keyed by channel name */
	values: Map<string, number | null>;
}

export interface LogData {
	/** Log file metadata */
	file: LogFile;
	/** Filtered/downsampled rows */
	rows: LogRow[];
	/** Channels included in this result */
	channels: string[];
	/** Units for included channels */
	units: string[];
}

/**
 * Parse a CSV line, handling quoted fields.
 *
 * @param line - CSV line to parse
 * @returns Array of field values
 */
function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === "," && !inQuotes) {
			fields.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

/**
 * Detect the time column index from header fields.
 * Returns the index of the first column that looks like a time column,
 * or -1 if none found.
 */
function detectTimeColumnIndex(headerFields: string[]): number {
	for (let i = 0; i < headerFields.length; i++) {
		const h = (headerFields[i] ?? "").toLowerCase();
		if (
			h.includes("time") ||
			h.includes("timestamp") ||
			h === "t" ||
			h === "t (s)" ||
			h === "time (s)"
		) {
			return i;
		}
	}
	return -1;
}

/**
 * Get log metadata from a file without loading all rows.
 * Reads only the header, units, first data row, and last data row.
 *
 * @param filePath - Absolute path to the log CSV file
 * @returns Log metadata
 */
export async function getLogMetadata(filePath: string): Promise<LogMetadata> {
	const content = await fs.readFile(filePath, "utf8");
	const lines = content.split("\n").filter((l) => l.trim().length > 0);

	if (lines.length < 1) {
		return { channels: [], rowCount: 0, durationS: null, sampleRateHz: null };
	}

	// Parse header row — all columns are channels
	const headerFields = parseCsvLine(lines[0] ?? "");

	// Check if there's a units row (second row that doesn't look like data)
	let dataStartLine = 1;
	if (lines.length >= 2) {
		const secondFields = parseCsvLine(lines[1] ?? "");
		// If the first field of the second row is not a number, it's a units row
		const firstVal = Number.parseFloat(secondFields[0] ?? "");
		if (!Number.isFinite(firstVal)) {
			dataStartLine = 2;
		}
	}

	const channels = headerFields;
	const dataLines = lines.slice(dataStartLine);
	const rowCount = dataLines.length;

	// Detect time column
	const timeColIdx = detectTimeColumnIndex(headerFields);

	let durationS: number | null = null;
	let sampleRateHz: number | null = null;

	if (timeColIdx >= 0 && dataLines.length > 1) {
		const firstRow = parseCsvLine(dataLines[0] ?? "");
		const lastRow = parseCsvLine(dataLines[dataLines.length - 1] ?? "");
		const firstTs = Number.parseFloat(firstRow[timeColIdx] ?? "");
		const lastTs = Number.parseFloat(lastRow[timeColIdx] ?? "");

		if (Number.isFinite(firstTs) && Number.isFinite(lastTs)) {
			// Determine if timestamps are in ms or s
			// If values are large (> 1000), assume ms; otherwise assume s
			const isMs = Math.abs(lastTs) > 1000 || Math.abs(firstTs) > 1000;
			const firstS = isMs ? firstTs / 1000 : firstTs;
			const lastS = isMs ? lastTs / 1000 : lastTs;
			durationS = lastS - firstS;

			if (durationS > 0 && rowCount > 1) {
				sampleRateHz = (rowCount - 1) / durationS;
			}
		}
	}

	return { channels, rowCount, durationS, sampleRateHz };
}

/**
 * Read metadata from a log file without loading all rows.
 *
 * @param filePath - Absolute path to the log CSV file
 * @returns Log file metadata
 */
export async function readLogFileMeta(filePath: string): Promise<LogFile> {
	const stat = await fs.stat(filePath);
	const fileName = path.basename(filePath);

	// Read the file content
	const content = await fs.readFile(filePath, "utf8");
	const lines = content.split("\n").filter((l) => l.trim().length > 0);

	if (lines.length < 2) {
		return {
			filePath,
			fileName,
			fileSizeBytes: stat.size,
			mtime: stat.mtime,
			channels: [],
			units: [],
			rowCount: 0,
			durationMs: null,
			sampleRateHz: null,
		};
	}

	// Parse header row
	const headerFields = parseCsvLine(lines[0] ?? "");
	// First column is "Timestamp (ms)", rest are channel names
	const channels = headerFields.slice(1);

	// Parse units row
	const unitFields = parseCsvLine(lines[1] ?? "");
	// First column is "Unit", rest are units
	const units = unitFields.slice(1);

	// Count data rows and get duration
	const dataLines = lines.slice(2);
	const rowCount = dataLines.length;

	let durationMs: number | null = null;
	let sampleRateHz: number | null = null;

	if (dataLines.length > 1) {
		const firstRow = parseCsvLine(dataLines[0] ?? "");
		const lastRow = parseCsvLine(dataLines[dataLines.length - 1] ?? "");
		const firstTs = Number.parseFloat(firstRow[0] ?? "0");
		const lastTs = Number.parseFloat(lastRow[0] ?? "0");
		if (Number.isFinite(firstTs) && Number.isFinite(lastTs)) {
			durationMs = lastTs - firstTs;
			const durationS = durationMs / 1000;
			if (durationS > 0 && rowCount > 1) {
				sampleRateHz = (rowCount - 1) / durationS;
			}
		}
	}

	return {
		filePath,
		fileName,
		fileSizeBytes: stat.size,
		mtime: stat.mtime,
		channels,
		units,
		rowCount,
		durationMs,
		sampleRateHz,
	};
}

/**
 * List all log files in a directory.
 *
 * @param logsDir - Directory to scan for CSV log files
 * @returns Array of log file metadata, sorted by mtime descending (newest first)
 */
export async function listLogFiles(logsDir: string): Promise<LogFile[]> {
	let entries: string[];
	try {
		const dirEntries = await fs.readdir(logsDir);
		entries = dirEntries.filter((e) => e.toLowerCase().endsWith(".csv"));
	} catch {
		return [];
	}

	const files: LogFile[] = [];
	for (const entry of entries) {
		const filePath = path.join(logsDir, entry);
		try {
			const meta = await readLogFileMeta(filePath);
			files.push(meta);
		} catch {
			// Skip files that can't be read
		}
	}

	// Sort by mtime descending (newest first)
	files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return files;
}

/**
 * Query log data from a CSV file with optional filtering and downsampling.
 *
 * @param filePath - Absolute path to the log CSV file
 * @param options - Query options
 * @returns Filtered and downsampled log data
 */
export async function queryLogFile(
	filePath: string,
	options: {
		/** Channel names to include (undefined = all channels) */
		channels?: string[];
		/** Start timestamp in milliseconds (inclusive) */
		startMs?: number;
		/** End timestamp in milliseconds (inclusive) */
		endMs?: number;
		/** Return every Nth row (1 = no downsampling) */
		downsample?: number;
	} = {},
): Promise<LogData> {
	const { channels: filterChannels, startMs, endMs, downsample = 1 } = options;

	const content = await fs.readFile(filePath, "utf8");
	const lines = content.split("\n").filter((l) => l.trim().length > 0);

	if (lines.length < 2) {
		const meta = await readLogFileMeta(filePath);
		return {
			file: meta,
			rows: [],
			channels: [],
			units: [],
		};
	}

	// Parse header and units rows
	const headerFields = parseCsvLine(lines[0] ?? "");
	const unitFields = parseCsvLine(lines[1] ?? "");

	const allChannels = headerFields.slice(1);
	const allUnits = unitFields.slice(1);

	// Determine which channels to include
	const includedChannels =
		filterChannels !== undefined
			? allChannels.filter((ch) => filterChannels.includes(ch))
			: allChannels;

	// Build column index map: channel name -> column index in data row (0-based, after timestamp)
	const channelColIndex = new Map<string, number>();
	for (let i = 0; i < allChannels.length; i++) {
		const ch = allChannels[i];
		if (ch !== undefined) channelColIndex.set(ch, i);
	}

	// Get units for included channels
	const includedUnits = includedChannels.map((ch) => {
		const idx = channelColIndex.get(ch);
		return idx !== undefined ? (allUnits[idx] ?? "") : "";
	});

	// Parse data rows
	const dataLines = lines.slice(2);
	const rows: LogRow[] = [];
	let rowIndex = 0;

	for (const line of dataLines) {
		const fields = parseCsvLine(line);
		const tsStr = fields[0];
		if (!tsStr) continue;

		const timestampMs = Number.parseFloat(tsStr);
		if (!Number.isFinite(timestampMs)) continue;

		// Apply time range filter
		if (startMs !== undefined && timestampMs < startMs) continue;
		if (endMs !== undefined && timestampMs > endMs) continue;

		// Apply downsampling
		if (rowIndex % downsample !== 0) {
			rowIndex++;
			continue;
		}
		rowIndex++;

		// Build values map for included channels
		const values = new Map<string, number | null>();
		for (const ch of includedChannels) {
			const colIdx = channelColIndex.get(ch);
			if (colIdx === undefined) {
				values.set(ch, null);
				continue;
			}
			const valStr = fields[colIdx + 1]; // +1 for timestamp column
			if (valStr === undefined || valStr === "") {
				values.set(ch, null);
			} else {
				const val = Number.parseFloat(valStr);
				values.set(ch, Number.isFinite(val) ? val : null);
			}
		}

		rows.push({ timestampMs, values });
	}

	const meta = await readLogFileMeta(filePath);

	return {
		file: meta,
		rows,
		channels: includedChannels,
		units: includedUnits,
	};
}

/**
 * Parse all rows from a CSV log file, returning raw row objects.
 * Used by query_logs for filter expression evaluation.
 *
 * @param filePath - Absolute path to the log CSV file
 * @returns Object with headers and rows as plain objects
 */
export async function parseLogFileRows(filePath: string): Promise<{
	headers: string[];
	timeColumnName: string | null;
	rows: Record<string, number>[];
	sampleRateHz: number | null;
}> {
	const content = await fs.readFile(filePath, "utf8");
	const lines = content.split("\n").filter((l) => l.trim().length > 0);

	if (lines.length < 1) {
		return { headers: [], timeColumnName: null, rows: [], sampleRateHz: null };
	}

	const headerFields = parseCsvLine(lines[0] ?? "");

	// Check if there's a units row
	let dataStartLine = 1;
	if (lines.length >= 2) {
		const secondFields = parseCsvLine(lines[1] ?? "");
		const firstVal = Number.parseFloat(secondFields[0] ?? "");
		if (!Number.isFinite(firstVal)) {
			dataStartLine = 2;
		}
	}

	const dataLines = lines.slice(dataStartLine);

	// Detect time column
	const timeColIdx = detectTimeColumnIndex(headerFields);
	const timeColumnName =
		timeColIdx >= 0 ? (headerFields[timeColIdx] ?? null) : null;

	// Parse all rows
	const rows: Record<string, number>[] = [];
	for (const line of dataLines) {
		const fields = parseCsvLine(line);
		const row: Record<string, number> = {};
		for (let i = 0; i < headerFields.length; i++) {
			const key = headerFields[i];
			if (!key) continue;
			const val = Number.parseFloat(fields[i] ?? "");
			if (Number.isFinite(val)) {
				row[key] = val;
			}
		}
		rows.push(row);
	}

	// Compute sample rate
	let sampleRateHz: number | null = null;
	if (timeColIdx >= 0 && rows.length > 1) {
		const firstRow = rows[0];
		const lastRow = rows[rows.length - 1];
		const timeKey = headerFields[timeColIdx];
		if (timeKey && firstRow && lastRow) {
			const firstTs = firstRow[timeKey] ?? 0;
			const lastTs = lastRow[timeKey] ?? 0;
			// Determine if timestamps are in ms or s
			const isMs = Math.abs(lastTs) > 1000 || Math.abs(firstTs) > 1000;
			const firstS = isMs ? firstTs / 1000 : firstTs;
			const lastS = isMs ? lastTs / 1000 : lastTs;
			const durationS = lastS - firstS;
			if (durationS > 0) {
				sampleRateHz = (rows.length - 1) / durationS;
			}
		}
	}

	return { headers: headerFields, timeColumnName, rows, sampleRateHz };
}
