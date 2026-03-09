/**
 * Diagnostic output formatters for the ECU Explorer MCP server.
 *
 * Formats diagnostic workflow results as YAML frontmatter + markdown,
 * consistent with the inspect-rom.js CLI tool output style.
 */

/**
 * Diagnostic workflow stages.
 */
export enum DiagnosticStage {
	ENUMERATE = "enumerate",
	CONNECT = "connect",
	INITIALIZE = "initialize",
	PROBE = "probe",
	OPERATION = "operation",
}

/**
 * Diagnostic workflow status.
 */
export enum DiagnosticStatus {
	START = "start",
	SUCCESS = "success",
	FAILURE = "failure",
}

/**
 * Event emitted during diagnostics.
 */
export interface DiagnosticEvent {
	stage: DiagnosticStage;
	status: DiagnosticStatus;
	timestamp: number;
	duration?: number;
	summary: string;
	details?: Record<string, unknown>;
}

/**
 * Basic device info structure (subset of full DeviceInfo).
 */
export interface DiagnosticDeviceInfo {
	id: string;
	name: string;
}

/**
 * Basic connection info structure (subset of full DeviceConnection).
 */
export interface DiagnosticConnectionInfo {
	deviceInfo: DiagnosticDeviceInfo;
}

/**
 * Basic protocol info structure (subset of full EcuProtocol).
 */
export interface DiagnosticProtocolInfo {
	name: string;
}

/**
 * Result of diagnostics.
 */
export interface DiagnosticResult {
	device: DiagnosticDeviceInfo | null;
	connection: DiagnosticConnectionInfo | null;
	protocol: DiagnosticProtocolInfo | null;
	events: DiagnosticEvent[];
	error?: Error;
}

import { buildMarkdownTable } from "./markdown.js";
import { toYamlFrontmatter } from "./yaml-formatter.js";

/**
 * Diagnostic status based on whether an error occurred.
 */
type OutputStatus = "success" | "failure";

/**
 * Extract the overall status from a diagnostic result.
 *
 * @param result - The diagnostic result to check
 * @returns "success" if no error, "failure" otherwise
 */
function getStatus(result: DiagnosticResult): OutputStatus {
	return result.error ? "failure" : "success";
}

/**
 * Get the device ID from a diagnostic result.
 *
 * @param result - The diagnostic result
 * @returns Device ID or "none" if no device
 */
function getDeviceId(result: DiagnosticResult): string {
	return result.device?.id ?? "none";
}

/**
 * Get the transport name from a diagnostic result.
 *
 * @param result - The diagnostic result
 * @returns Transport name or "none" if no connection
 */
function getTransportName(result: DiagnosticResult): string {
	return result.connection?.deviceInfo.name ?? "none";
}

/**
 * Get the protocol name from a diagnostic result.
 *
 * @param result - The diagnostic result
 * @returns Protocol name or "none" if no protocol matched
 */
function getProtocolName(result: DiagnosticResult): string {
	return result.protocol?.name ?? "none";
}

/**
 * Format diagnostic result metadata as YAML frontmatter.
 *
 * @param command - The diagnostic subcommand (list, connect, probe, log, read-rom)
 * @param result - The diagnostic result
 * @param traceFile - Optional path to trace file if written
 * @returns YAML frontmatter string
 */
export function formatDiagnosticFrontmatter(
	command: string,
	result: DiagnosticResult,
	traceFile?: string,
): string {
	const frontmatterData: Record<string, unknown> = {
		tool: "device-inspect",
		command,
		device: getDeviceId(result),
		transport: getTransportName(result),
		protocol: getProtocolName(result),
		status: getStatus(result),
	};

	// Add trace file if provided
	if (traceFile) {
		frontmatterData.trace_file = traceFile;
	}

	return toYamlFrontmatter(frontmatterData);
}

/**
 * Format diagnostic events as a markdown section.
 *
 * Each event shows stage name, status, duration (if available), and summary text.
 * Events are grouped by their status type in the output.
 *
 * @param events - Array of diagnostic events
 * @returns Markdown formatted string
 */
export function formatDiagnosticEventsMarkdown(
	events: DiagnosticEvent[],
): string {
	// Build table rows for each event
	const headers = ["Stage", "Status", "Duration", "Summary"];
	const rows: string[][] = events.map((event) => {
		const stageName = event.stage;
		const statusValue = event.status;
		const duration = event.duration !== undefined ? `${event.duration}ms` : "-";
		const summary = event.summary;

		return [stageName, statusValue, duration, summary];
	});

	// Build the markdown table
	const table = buildMarkdownTable(headers, rows);

	// Add a header
	return `## Diagnostic Steps\n\n${table}\n`;
}

/**
 * Format complete diagnostic output including YAML frontmatter and markdown body.
 *
 * This combines the frontmatter metadata with the event details in a format
 * consistent with the inspect-rom.js CLI tool.
 *
 * @param command - The diagnostic subcommand (list, connect, probe, log, read-rom)
 * @param result - The diagnostic result
 * @param traceFile - Optional path to trace file if written
 * @returns Complete output string with YAML frontmatter + markdown body
 */
export function formatDiagnosticOutput(
	command: string,
	result: DiagnosticResult,
	traceFile?: string,
): string {
	const frontmatter = formatDiagnosticFrontmatter(command, result, traceFile);
	const markdown = formatDiagnosticEventsMarkdown(result.events);

	return `${frontmatter}${markdown}`;
}
