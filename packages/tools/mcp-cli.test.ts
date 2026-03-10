import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadToolMcpConfig,
	parseCommaSeparatedList,
	parseOptionalInteger,
	parseOptionalNumber,
	resolveCliPath,
} from "./mcp-cli.js";

const tempDirs: string[] = [];

async function makeWorkspace(
	settings: Record<string, unknown> = {},
): Promise<string> {
	const workspaceDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "ecu-tools-config-"),
	);
	tempDirs.push(workspaceDir);
	await fs.mkdir(path.join(workspaceDir, ".vscode"), { recursive: true });
	await fs.writeFile(
		path.join(workspaceDir, ".vscode", "settings.json"),
		JSON.stringify(settings, null, 2),
	);
	return workspaceDir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

describe("resolveCliPath", () => {
	it("resolves relative paths from the invocation directory", () => {
		expect(resolveCliPath("./rom.hex", "/workspace/root")).toBe(
			path.join("/workspace/root", "rom.hex"),
		);
	});

	it("preserves absolute paths", () => {
		expect(resolveCliPath("/tmp/rom.hex", "/workspace/root")).toBe(
			"/tmp/rom.hex",
		);
	});
});

describe("loadToolMcpConfig", () => {
	it("loads workspace settings relative to the invocation directory", async () => {
		const workspaceDir = await makeWorkspace({
			"ecuExplorer.definitions.paths": ["./defs"],
			"ecuExplorer.definitions.ecuflash.paths": ["./ecuflash"],
			"ecuExplorer.logsFolder": "./logs",
		});

		const config = loadToolMcpConfig(
			{},
			{ invocationCwd: workspaceDir, env: {} },
		);

		expect(config.definitionsPaths).toEqual([
			path.join(workspaceDir, "defs"),
			path.join(workspaceDir, "ecuflash"),
		]);
		expect(config.logsDir).toBe(path.join(workspaceDir, "logs"));
	});

	it("gives CLI options precedence over environment and workspace settings", async () => {
		const workspaceDir = await makeWorkspace({
			"ecuExplorer.definitions.paths": ["./workspace-defs"],
			"ecuExplorer.logsFolder": "./workspace-logs",
		});

		const config = loadToolMcpConfig(
			{
				definitionsPath: "./cli-defs",
				logsDir: "./cli-logs",
			},
			{
				invocationCwd: workspaceDir,
				env: {
					ECU_DEFINITIONS_PATH: "./env-defs",
					ECU_LOGS_DIR: "./env-logs",
				},
			},
		);

		expect(config.definitionsPaths[0]).toBe(
			path.join(workspaceDir, "cli-defs"),
		);
		expect(config.definitionsPaths[1]).toBe(
			path.join(workspaceDir, "env-defs"),
		);
		expect(config.logsDir).toBe(path.join(workspaceDir, "cli-logs"));
	});
});

describe("CLI option parsers", () => {
	it("splits comma-separated channel lists", () => {
		expect(parseCommaSeparatedList("RPM, Load, Knock")).toEqual([
			"RPM",
			"Load",
			"Knock",
		]);
		expect(parseCommaSeparatedList("")).toBeUndefined();
	});

	it("parses numeric CLI values", () => {
		expect(parseOptionalInteger("3", "page", 1)).toBe(3);
		expect(parseOptionalNumber("2.5", "step-ms", 0)).toBe(2.5);
	});

	it("rejects invalid numeric CLI values", () => {
		expect(() => parseOptionalInteger("nope", "page", 1)).toThrow(
			"Invalid page: nope",
		);
		expect(() => parseOptionalNumber("-1", "step-ms", 0)).toThrow(
			"step-ms must be >= 0. Received -1.",
		);
	});
});
