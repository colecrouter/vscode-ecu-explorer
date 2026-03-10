import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logReader from "../log-reader.js";
import { handleListLogs } from "./list-logs.js";

vi.mock("../log-reader.js", async () => {
	const actual =
		await vi.importActual<typeof import("../log-reader.js")>(
			"../log-reader.js",
		);
	return {
		...actual,
		listLogFiles: vi.fn(),
	};
});

describe("handleListLogs", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("supports metadata query matching against file metadata and channels", async () => {
		vi.mocked(logReader.listLogFiles).mockResolvedValue([
			{
				filePath: "/tmp/logs/pull.csv",
				fileName: "pull.csv",
				fileSizeBytes: 1024,
				mtime: new Date("2026-03-10T00:00:00.000Z"),
				channels: ["Engine RPM", "Knock Sum"],
				units: ["rpm", "count"],
				rowCount: 200,
				durationMs: 2500,
				sampleRateHz: 80,
				timeUnit: "ms",
			},
			{
				filePath: "/tmp/logs/cruise.csv",
				fileName: "cruise.csv",
				fileSizeBytes: 512,
				mtime: new Date("2026-03-09T00:00:00.000Z"),
				channels: ["Coolant Temp"],
				units: ["C"],
				rowCount: 100,
				durationMs: 12000,
				sampleRateHz: 10,
				timeUnit: "ms",
			},
		]);

		const result = await handleListLogs(
			{
				definitionsPaths: [],
				logsDir: "/tmp/logs",
			},
			{ query: "knock pull" },
		);

		expect(result).toContain("total_files: 1");
		expect(result).toContain("pull.csv");
		expect(result).not.toContain("cruise.csv");
	});

	it("supports pagination metadata and row numbering", async () => {
		vi.mocked(logReader.listLogFiles).mockResolvedValue(
			Array.from({ length: 3 }, (_, index) => ({
				filePath: `/tmp/logs/log-${index + 1}.csv`,
				fileName: `log-${index + 1}.csv`,
				fileSizeBytes: 100 + index,
				mtime: new Date(`2026-03-0${index + 1}T00:00:00.000Z`),
				channels: ["Engine RPM"],
				units: ["rpm"],
				rowCount: 10 + index,
				durationMs: 1000,
				sampleRateHz: 10,
				timeUnit: "ms",
			})),
		);

		const result = await handleListLogs(
			{
				definitionsPaths: [],
				logsDir: "/tmp/logs",
			},
			{ page: 2, pageSize: 2 },
		);

		expect(result).toContain("page: 2");
		expect(result).toContain("page_size: 2");
		expect(result).toContain("total_pages: 2");
		expect(result).toContain("| 3 | log-3.csv |");
	});
});
