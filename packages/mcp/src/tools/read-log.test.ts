import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../config.js";
import * as logReader from "../log-reader.js";
import {
	createLogFileMeta,
	createMcpConfig,
	createParsedLogRows,
} from "../test/tool-test-support.js";
import { handleReadLog } from "./read-log.js";

vi.mock("../log-reader.js", async () => {
	const actual =
		await vi.importActual<typeof import("../log-reader.js")>(
			"../log-reader.js",
		);
	return {
		...actual,
		readLogFileMeta: vi.fn(),
		parseLogFileRows: vi.fn(),
	};
});

const baseConfig = createMcpConfig({ logsDir: "/tmp" });

describe("handleReadLog", () => {
	let config: McpConfig;

	it("returns schema/details when only file is provided", async () => {
		const tempDir = await mkdtemp(
			path.join(os.tmpdir(), "ecu-mcp-read-log-schema-"),
		);
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "session.csv",
				fileSizeBytes: 1024,
				channels: ["Engine RPM", "Knock Sum"],
				units: ["rpm", "count"],
				rowCount: 42,
				durationMs: 4100,
				sampleRateHz: 10,
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Engine RPM", "Knock Sum"],
			}),
		);

		const result = await handleReadLog({ file: "session.csv" }, config);
		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("time_column: Timestamp (ms)");
		expect(result).toContain(`resolved_path: ${target}`);
		expect(result).toContain("outside_logs_dir: false");
		expect(result).toContain("channels:");
		expect(result).toContain("Engine RPM");
		expect(result).toContain("Knock Sum");
		expect(result).toContain("| Channel");
		expect(result).toContain("| Engine RPM | rpm");
	});

	it("allows reading a log outside logsDir and emits a warning", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const outsideDir = await mkdtemp(
			path.join(os.tmpdir(), "ecu-mcp-read-log-outside-"),
		);
		const target = path.join(outsideDir, "external-session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "external-session.csv",
				channels: ["Engine RPM", "Knock Sum"],
				units: ["rpm", "count"],
				rowCount: 2,
				durationMs: 100,
				sampleRateHz: 20,
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Engine RPM", "Knock Sum"],
				rows: [
					{ "Timestamp (ms)": 0, "Engine RPM": 3000, "Knock Sum": 0 },
					{ "Timestamp (ms)": 100, "Engine RPM": 3200, "Knock Sum": 1 },
				],
			}),
		);

		const result = await handleReadLog({ file: target }, config);

		await rm(tempDir, { recursive: true, force: true });
		await rm(outsideDir, { recursive: true, force: true });

		expect(result).toContain(`resolved_path: ${target}`);
		expect(result).toContain("outside_logs_dir: true");
		expect(result).toContain("Warning:");
		expect(result).toContain("outside the configured");
		expect(result).toContain("| Engine RPM | rpm");
	});

	it("supports spaced channel names in where expressions", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "session.csv",
				channels: ["Engine Temp", "Coolant Temp"],
				units: ["C", "C"],
				rowCount: 3,
				durationMs: 200,
				sampleRateHz: 10,
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Engine Temp", "Coolant Temp"],
				rows: [
					{ "Timestamp (ms)": 0, "Engine Temp": 120, "Coolant Temp": 95 },
					{ "Timestamp (ms)": 100, "Engine Temp": 105, "Coolant Temp": 85 },
					{ "Timestamp (ms)": 200, "Engine Temp": 80, "Coolant Temp": 70 },
				],
			}),
		);

		const result = await handleReadLog(
			{
				file: "session.csv",
				where: "Engine Temp > 100 && Coolant Temp > 90",
			},
			config,
		);

		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("rows_returned: 1");
		expect(result).toContain("| Time (s) |");
		expect(result).toContain("Engine Temp");
		expect(result).toContain("Coolant Temp");
		expect(result).toContain("0.00");
		expect(result).toContain("120");
		expect(result).toContain("95");
	});

	it("returns helpful errors for unknown fields in where expressions", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "session.csv",
				channels: ["Engine RPM", "Knock Sum"],
				units: ["rpm", "count"],
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Engine RPM", "Knock Sum"],
				rows: [{ "Timestamp (ms)": 0, "Engine RPM": 3000, "Knock Sum": 0 }],
			}),
		);

		await expect(
			handleReadLog(
				{
					file: "session.csv",
					where: "Engine RPm > 2500 && KnockCount > 0",
				},
				config,
			),
		).rejects.toThrow(/Unknown field: Engine RPm, KnockCount\./);
		await expect(
			handleReadLog(
				{
					file: "session.csv",
					where: "Engine RPm > 2500 && KnockCount > 0",
				},
				config,
			),
		).rejects.toThrow(
			/Suggestions: Engine RPm: Engine RPM(?:, [^;]+)*; KnockCount: Knock Sum/,
		);

		await rm(tempDir, { recursive: true, force: true });
	});

	it("expands matched rows into merged time windows and applies step_ms after selection", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "session.csv",
				channels: ["Engine RPM", "Knock Sum"],
				units: ["rpm", "count"],
				rowCount: 5,
				durationMs: 400,
				sampleRateHz: 10,
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Engine RPM", "Knock Sum"],
				rows: [
					{ "Timestamp (ms)": 100, "Engine RPM": 2000, "Knock Sum": 1 },
					{ "Timestamp (ms)": 180, "Engine RPM": 2200, "Knock Sum": 0 },
					{ "Timestamp (ms)": 260, "Engine RPM": 2400, "Knock Sum": 1 },
					{ "Timestamp (ms)": 340, "Engine RPM": 2600, "Knock Sum": 0 },
					{ "Timestamp (ms)": 500, "Engine RPM": 2800, "Knock Sum": 0 },
				],
			}),
		);

		const result = await handleReadLog(
			{
				file: "session.csv",
				where: "Knock Sum > 0",
				beforeMs: 100,
				afterMs: 100,
				stepMs: 70,
			},
			config,
		);

		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("rows_returned: 4");
		expect(result).toContain("time_range_s:");
		expect(result).toContain("| 0.10");
		expect(result).toContain("| 0.18");
		expect(result).toContain("| 0.26");
		expect(result).toContain("| 0.34");
		expect(result).not.toContain("| 0.50");
	});

	it("supports overlapping field names in where expressions", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue(
			createLogFileMeta({
				filePath: target,
				fileName: "session.csv",
				channels: ["Load", "Load Avg"],
				units: ["g/rev", "g/rev"],
				rowCount: 2,
				durationMs: 100,
				sampleRateHz: 10,
			}),
		);
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue(
			createParsedLogRows({
				headers: ["Timestamp (ms)", "Load", "Load Avg"],
				rows: [
					{ "Timestamp (ms)": 0, Load: 1.2, "Load Avg": 1.0 },
					{ "Timestamp (ms)": 100, Load: 0.8, "Load Avg": 1.1 },
				],
			}),
		);

		const result = await handleReadLog(
			{
				file: "session.csv",
				where: "Load > 1.0 && Load Avg < 1.1",
			},
			config,
		);

		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("rows_returned: 1");
		expect(result).toContain("referenced_fields:");
		expect(result).toContain("- Load");
		expect(result).toContain("- Load Avg");
		expect(result).toContain("| 0.00");
		expect(result).not.toContain("| 0.10");
	});
});
