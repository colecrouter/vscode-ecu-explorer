import type { McpConfig } from "../mcp/dist/config.js";

export interface ToolMcpConfigOptions {
	definitionsPath?: string | undefined;
	logsDir?: string | undefined;
}

export interface ToolMcpConfigContext {
	invocationCwd?: string | undefined;
	env?: NodeJS.ProcessEnv | undefined;
}

export function getInvocationCwd(): string;
export function resolveCliPath(fsPath: string, baseDir?: string): string;
export function splitDefinitionPaths(rawPaths: string): string[];
export function parseCommaSeparatedList(
	value: string | undefined,
): string[] | undefined;
export function parseOptionalInteger(
	value: string | number | undefined,
	name: string,
	min?: number,
): number | undefined;
export function parseOptionalNumber(
	value: string | number | undefined,
	name: string,
	min?: number,
): number | undefined;
export function loadToolMcpConfig(
	options?: ToolMcpConfigOptions,
	context?: ToolMcpConfigContext,
): McpConfig;
export function runCliAction(action: () => Promise<string>): void;
