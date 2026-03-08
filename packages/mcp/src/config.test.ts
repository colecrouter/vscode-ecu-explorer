import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
	it("splits ECU_DEFINITIONS_PATH using platform path delimiter", () => {
		const originalEnv = process.env.ECU_DEFINITIONS_PATH;
		const cwd = process.cwd();

		process.env.ECU_DEFINITIONS_PATH = `./defs-a${path.delimiter}./defs-b`;

		const config = loadConfig();

		expect(config.definitionsPaths).toHaveLength(2);
		expect(path.basename(config.definitionsPaths[0] ?? "")).toBe("defs-a");
		expect(path.basename(config.definitionsPaths[1] ?? "")).toBe("defs-b");
		expect(path.isAbsolute(config.definitionsPaths[0] as string)).toBe(true);
		expect(config.definitionsPaths.every((p) => p.startsWith(cwd))).toBe(true);

		process.env.ECU_DEFINITIONS_PATH = originalEnv;
	});
});
