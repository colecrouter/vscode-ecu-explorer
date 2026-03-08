import { mkdtemp, writeFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logReader from "../log-reader.js";
import { handleQueryLogs } from "./query-logs.js";
import type { McpConfig } from "../config.js";

vi.mock("../log-reader.js", () => ({
	listLogFiles: vi.fn(),
	parseLogFileRows: vi.fn(),
}));

const baseConfig = {
	definitionsPaths: [],
};

describe("handleQueryLogs", () => {
	let config: McpConfig;

	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("rejects file paths outside the configured logs directory", async () => {
		config = {
			...baseConfig,
			logsDir: "/tmp/logs",
		};

		await expect(
			handleQueryLogs(
				{
					filter: "RPM > 10",
					file: "../evil.csv",
				},
				config,
			),
		).rejects.toThrow("Invalid log file path");
	});

	it("supports spaced channel names in filter expressions", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-query-logs-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		const parseLogFileRows = vi.mocked(logReader.parseLogFileRows);
		parseLogFileRows.mockResolvedValue({
			headers: ["Timestamp (ms)", "Engine Temp", "Coolant Temp"],
			timeColumnName: "Timestamp (ms)",
			sampleRateHz: 10,
			rows: [
				{ "Timestamp (ms)": 0, "Engine Temp": 120, "Coolant Temp": 95 },
				{ "Timestamp (ms)": 100, "Engine Temp": 105, "Coolant Temp": 85 },
				{ "Timestamp (ms)": 200, "Engine Temp": 80, "Coolant Temp": 70 },
			],
		});

		const result = await handleQueryLogs(
			{
				filter: "Engine Temp > 100 and Coolant Temp > 90",
				file: "session.csv",
			},
			config,
		);

		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("rows_matched: 1");
		expect(result).toContain("| Time (s) |");
		expect(result).toContain("Engine Temp");
		expect(result).toContain("Coolant Temp");
		expect(result).toContain("0.00");
		expect(result).toContain("120");
		expect(result).toContain("95");
	});
});
