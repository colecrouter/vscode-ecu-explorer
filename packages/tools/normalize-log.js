import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import sade from "sade";
import {
	parseCommaSeparatedList,
	resolveCliPath,
	runCliAction,
} from "./mcp-cli.js";

const EVOSCAN_METADATA_COLUMNS = new Set([
	"LogID",
	"LogEntryDate",
	"LogEntryTime",
	"LogEntrySeconds",
	"LogNotes",
]);

/**
 * Parse a CSV line, handling quoted fields.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
	/** @type {string[]} */
	const fields = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
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
 * Escape a CSV field when necessary.
 *
 * @param {string} value
 * @returns {string}
 */
function csvEscape(value) {
	if (/[",\n]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Infer the source log format from CSV headers.
 *
 * @param {string[]} headers
 * @returns {"evoscan" | "unknown"}
 */
export function detectLogFormat(headers) {
	return headers.includes("LogEntrySeconds") && headers.includes("LogEntryTime")
		? "evoscan"
		: "unknown";
}

/**
 * Map common EvoScan channels to unit strings for the native CSV format.
 *
 * @param {string} channel
 * @returns {string}
 */
export function inferEvoScanUnit(channel) {
	if (/rpm/i.test(channel)) return "rpm";
	if (/afr/i.test(channel)) return "afr";
	if (/^psig$/i.test(channel)) return "psi";
	if (/battery/i.test(channel)) return "V";
	if (/fronto2|o2sensor/i.test(channel)) return "V";
	if (/wgdc|tps|app|ltft|stft/i.test(channel)) return "%";
	if (/ipw/i.test(channel)) return "ms";
	if (/mafhz/i.test(channel)) return "Hz";
	if (/maf/i.test(channel)) return "g/s";
	if (/timing/i.test(channel)) return "deg";
	if (/knocksum/i.test(channel)) return "count";
	if (/mat|ect|iat/i.test(channel)) return "C";
	return "";
}

/**
 * Convert an EvoScan CSV string into the ECU Explorer native log CSV format.
 *
 * @param {string} csvText
 * @param {{ channels?: string[] | undefined }} [options]
 * @returns {{ headers: string[]; units: string[]; rows: string[][] }}
 */
export function normalizeEvoScanCsv(csvText, options = {}) {
	const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length < 2) {
		throw new Error(
			"EvoScan CSV must include a header row and at least one data row.",
		);
	}

	const headers = parseCsvLine(lines[0] || "");
	const secondsIndex = headers.indexOf("LogEntrySeconds");
	if (secondsIndex < 0) {
		throw new Error("EvoScan CSV is missing the LogEntrySeconds column.");
	}

	const availableChannels = headers.filter(
		(header) => !EVOSCAN_METADATA_COLUMNS.has(header),
	);
	const requestedChannels = options.channels;
	if (requestedChannels !== undefined) {
		const missing = requestedChannels.filter(
			(channel) => !availableChannels.includes(channel),
		);
		if (missing.length > 0) {
			throw new Error(
				`Unknown EvoScan channel(s): ${missing.join(", ")}. Available channels: ${availableChannels.join(", ")}`,
			);
		}
	}

	const selectedChannels = requestedChannels ?? availableChannels;
	const selectedIndices = selectedChannels.map((channel) => {
		const index = headers.indexOf(channel);
		if (index < 0) {
			throw new Error(`Missing selected channel index for ${channel}.`);
		}
		return index;
	});

	/** @type {string[][]} */
	const outputRows = [];
	for (const line of lines.slice(1)) {
		const fields = parseCsvLine(line);
		const seconds = Number.parseFloat(fields[secondsIndex] ?? "");
		if (!Number.isFinite(seconds)) {
			continue;
		}

		const timestampMs = String(Math.round(seconds * 1000));
		const values = selectedIndices.map((index) => {
			const raw = (fields[index] ?? "").trim();
			const numeric = Number.parseFloat(raw);
			return Number.isFinite(numeric) ? raw : "";
		});
		outputRows.push([timestampMs, ...values]);
	}

	return {
		headers: ["Timestamp (ms)", ...selectedChannels],
		units: ["Unit", ...selectedChannels.map(inferEvoScanUnit)],
		rows: outputRows,
	};
}

/**
 * Render normalized CSV parts back into CSV text.
 *
 * @param {{ headers: string[]; units: string[]; rows: string[][] }} normalized
 * @returns {string}
 */
export function renderNormalizedCsv(normalized) {
	return [
		normalized.headers.map(csvEscape).join(","),
		normalized.units.map(csvEscape).join(","),
		...normalized.rows.map((row) => row.map(csvEscape).join(",")),
		"",
	].join("\n");
}

/**
 * Resolve the default output path for a normalized log.
 *
 * @param {string} inputPath
 * @returns {string}
 */
export function getDefaultOutputPath(inputPath) {
	const parsed = path.parse(inputPath);
	return path.join(parsed.dir, `${parsed.name}.ecu-explorer.csv`);
}

const prog = sade("normalize-log", true);

prog
	.version("1.0.0")
	.describe(
		"Normalize third-party log CSVs into ECU Explorer's native log format",
	)
	.option("--input", "Path to the source log CSV")
	.option("--output", "Optional output CSV path")
	.option("--format", "Source format: auto or evoscan", "auto")
	.option("--channels", "Optional comma-separated subset of channels to keep")
	.action((opts) => {
		if (!opts.input) {
			console.error("Missing required --input argument");
			process.exit(1);
		}

		runCliAction(async () => {
			const inputPath = resolveCliPath(opts.input);
			const outputPath = resolveCliPath(
				opts.output ?? getDefaultOutputPath(inputPath),
			);
			const csvText = await fs.readFile(inputPath, "utf8");
			const headers = parseCsvLine(csvText.split(/\r?\n/)[0] ?? "");
			const detectedFormat =
				opts.format === "auto" ? detectLogFormat(headers) : opts.format;

			if (detectedFormat !== "evoscan") {
				throw new Error(
					`Unsupported log format: ${detectedFormat}. Supported formats: evoscan.`,
				);
			}

			const channels = parseCommaSeparatedList(opts.channels);
			const normalized = normalizeEvoScanCsv(csvText, { channels });
			const rendered = renderNormalizedCsv(normalized);
			await fs.writeFile(outputPath, rendered, "utf8");

			return [
				`Normalized ${detectedFormat} log to ECU Explorer format.`,
				`Input: ${inputPath}`,
				`Output: ${outputPath}`,
				`Channels: ${normalized.headers.length - 1}`,
				`Rows: ${normalized.rows.length}`,
			].join("\n");
		});
	});

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
	prog.parse(process.argv);
}
