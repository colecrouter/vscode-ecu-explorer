/**
 * Configuration for the ECU Explorer MCP server.
 *
 * Reads configuration from:
 * 1. CLI arguments (--definitions-path, --logs-dir)
 * 2. Environment variables (ECU_DEFINITIONS_PATH, ECU_LOGS_DIR)
 * 3. Workspace settings (.vscode/settings.json) — optional
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface McpConfig {
	/** Path(s) to ECUFlash XML definition directories */
	definitionsPaths: string[];
	/** Default log directory */
	logsDir: string;
}

/**
 * Parse CLI arguments for MCP server configuration.
 *
 * @param argv - Process arguments (default: process.argv)
 * @returns Parsed CLI config values
 */
function parseCliArgs(argv: string[] = process.argv): {
	definitionsPath: string | undefined;
	logsDir: string | undefined;
} {
	let definitionsPath: string | undefined;
	let logsDir: string | undefined;

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === "--definitions-path" && i + 1 < argv.length) {
			definitionsPath = argv[i + 1];
			i++;
		} else if (arg.startsWith("--definitions-path=")) {
			definitionsPath = arg.slice("--definitions-path=".length);
		} else if (arg === "--logs-dir" && i + 1 < argv.length) {
			logsDir = argv[i + 1];
			i++;
		} else if (arg.startsWith("--logs-dir=")) {
			logsDir = arg.slice("--logs-dir=".length);
		}
	}

	return { definitionsPath, logsDir };
}

/**
 * Try to read workspace settings from .vscode/settings.json.
 *
 * @param workspaceDir - Directory to search for .vscode/settings.json
 * @returns Parsed settings or empty object
 */
function readWorkspaceSettings(workspaceDir: string): Record<string, unknown> {
	const settingsPath = path.join(workspaceDir, ".vscode", "settings.json");
	try {
		const raw = fs.readFileSync(settingsPath, "utf8");
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Load MCP server configuration from all sources.
 *
 * Priority: CLI args > env vars > workspace settings > defaults
 *
 * @returns Resolved MCP configuration
 */
export function loadConfig(): McpConfig {
	const cli = parseCliArgs();
	const workspaceDir = process.cwd();
	const settings = readWorkspaceSettings(workspaceDir);

	// Resolve definitions paths
	const definitionsPaths: string[] = [];

	// CLI arg takes highest priority
	if (cli.definitionsPath !== undefined) {
		definitionsPaths.push(cli.definitionsPath);
	}

	// Environment variable
	const envDefinitionsPath = process.env["ECU_DEFINITIONS_PATH"];
	if (envDefinitionsPath !== undefined) {
		definitionsPaths.push(envDefinitionsPath);
	}

	// Workspace settings: ecuExplorer.definitions.paths
	const wsDefinitionsPaths = settings["ecuExplorer.definitions.paths"];
	if (Array.isArray(wsDefinitionsPaths)) {
		for (const p of wsDefinitionsPaths) {
			if (typeof p === "string") definitionsPaths.push(p);
		}
	}

	// Workspace settings: ecuExplorer.definitions.ecuflash.paths
	const wsEcuflashPaths = settings["ecuExplorer.definitions.ecuflash.paths"];
	if (Array.isArray(wsEcuflashPaths)) {
		for (const p of wsEcuflashPaths) {
			if (typeof p === "string") definitionsPaths.push(p);
		}
	}

	// Resolve logs directory
	let logsDir = "./logs";

	if (cli.logsDir !== undefined) {
		logsDir = cli.logsDir;
	} else if (process.env["ECU_LOGS_DIR"] !== undefined) {
		logsDir = process.env["ECU_LOGS_DIR"];
	} else {
		const wsLogsFolder = settings["ecuExplorer.logsFolder"];
		if (typeof wsLogsFolder === "string") {
			logsDir = wsLogsFolder;
		}
	}

	// Resolve relative paths to absolute
	const resolvedLogsDir = path.isAbsolute(logsDir)
		? logsDir
		: path.resolve(workspaceDir, logsDir);

	const resolvedDefinitionsPaths = definitionsPaths.map((p) =>
		path.isAbsolute(p) ? p : path.resolve(workspaceDir, p),
	);

	return {
		definitionsPaths: resolvedDefinitionsPaths,
		logsDir: resolvedLogsDir,
	};
}
