import * as fs from "node:fs";
import * as path from "node:path";

/**
 * @typedef {import("../mcp/dist/config.js").McpConfig} McpConfig
 */

/**
 * @typedef {{
 *   definitionsPath?: string | undefined;
 *   logsDir?: string | undefined;
 * }} ToolMcpConfigOptions
 */

/**
 * @typedef {{
 *   invocationCwd?: string | undefined;
 *   env?: NodeJS.ProcessEnv | undefined;
 * }} ToolMcpConfigContext
 */

/**
 * Resolve the directory the user invoked the tool from.
 *
 * npm workspace scripts execute from the workspace directory, so INIT_CWD
 * is the reliable source for user-relative paths.
 *
 * @returns {string}
 */
export function getInvocationCwd() {
	return process.env.INIT_CWD || process.cwd();
}

console.warn = () => {};

/**
 * Resolve a user-provided path from the original invocation directory.
 *
 * @param {string} fsPath
 * @param {string} [baseDir]
 * @returns {string}
 */
export function resolveCliPath(fsPath, baseDir = getInvocationCwd()) {
	return path.isAbsolute(fsPath) ? fsPath : path.resolve(baseDir, fsPath);
}

/**
 * Split a definitions path string using platform delimiter and newlines.
 *
 * @param {string} rawPaths
 * @returns {string[]}
 */
export function splitDefinitionPaths(rawPaths) {
	return rawPaths
		.split(path.delimiter)
		.flatMap((raw) => raw.split("\n"))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/**
 * Parse a comma-separated list option.
 *
 * @param {string | undefined} value
 * @returns {string[] | undefined}
 */
export function parseCommaSeparatedList(value) {
	if (value === undefined) return undefined;
	const items = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return items.length > 0 ? items : undefined;
}

/**
 * Parse an optional integer CLI value.
 *
 * @param {string | number | undefined} value
 * @param {string} name
 * @param {number} [min]
 * @returns {number | undefined}
 */
export function parseOptionalInteger(value, name, min) {
	if (value === undefined) return undefined;
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
		throw new Error(`Invalid ${name}: ${value}`);
	}
	if (min !== undefined && parsed < min) {
		throw new Error(`${name} must be >= ${min}. Received ${parsed}.`);
	}
	return parsed;
}

/**
 * Parse an optional numeric CLI value.
 *
 * @param {string | number | undefined} value
 * @param {string} name
 * @param {number} [min]
 * @returns {number | undefined}
 */
export function parseOptionalNumber(value, name, min) {
	if (value === undefined) return undefined;
	const parsed = typeof value === "number" ? value : Number(String(value));
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid ${name}: ${value}`);
	}
	if (min !== undefined && parsed < min) {
		throw new Error(`${name} must be >= ${min}. Received ${parsed}.`);
	}
	return parsed;
}

/**
 * Read workspace settings from the invocation directory.
 *
 * @param {string} workspaceDir
 * @returns {Record<string, unknown>}
 */
function readWorkspaceSettings(workspaceDir) {
	const settingsPath = path.join(workspaceDir, ".vscode", "settings.json");
	try {
		const raw = fs.readFileSync(settingsPath, "utf8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

/**
 * Resolve MCP-like config for headless CLI tools.
 *
 * Priority matches the MCP server, but paths are resolved from INIT_CWD so the
 * root `npm run tools:*` wrappers behave like users expect.
 *
 * @param {ToolMcpConfigOptions} [options]
 * @param {ToolMcpConfigContext} [context]
 * @returns {McpConfig}
 */
export function loadToolMcpConfig(options = {}, context = {}) {
	const invocationCwd = context.invocationCwd ?? getInvocationCwd();
	const env = context.env ?? process.env;
	const settings = readWorkspaceSettings(invocationCwd);

	/** @type {string[]} */
	const definitionsPaths = [];

	if (options.definitionsPath !== undefined) {
		definitionsPaths.push(options.definitionsPath);
	}

	const envDefinitionsPath = env.ECU_DEFINITIONS_PATH;
	if (envDefinitionsPath !== undefined) {
		for (const entry of splitDefinitionPaths(envDefinitionsPath)) {
			definitionsPaths.push(entry);
		}
	}

	for (const key of [
		"ecuExplorer.definitions.paths",
		"ecuExplorer.definitions.ecuflash.paths",
	]) {
		const value = settings[key];
		if (!Array.isArray(value)) continue;
		for (const entry of value) {
			if (typeof entry === "string") definitionsPaths.push(entry);
		}
	}

	let logsDir = options.logsDir;
	if (logsDir === undefined) {
		if (env.ECU_LOGS_DIR !== undefined) {
			logsDir = env.ECU_LOGS_DIR;
		} else {
			const workspaceLogsDir = settings["ecuExplorer.logsFolder"];
			if (typeof workspaceLogsDir === "string") {
				logsDir = workspaceLogsDir;
			}
		}
	}

	return {
		definitionsPaths: definitionsPaths.map((entry) =>
			resolveCliPath(entry, invocationCwd),
		),
		logsDir: resolveCliPath(logsDir ?? "./logs", invocationCwd),
	};
}

/**
 * Run a CLI action and print its text result.
 *
 * @param {() => Promise<string>} action
 * @returns {void}
 */
export function runCliAction(action) {
	action()
		.then((output) => {
			console.log(output);
		})
		.catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
}
