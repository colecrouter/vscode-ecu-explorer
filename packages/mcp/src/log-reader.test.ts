import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLogFileRows, readLogFileMeta } from "./log-reader.js";

describe("log-reader time units", () => {
	it("treats Timestamp (ms) columns as milliseconds without magnitude heuristics", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-log-reader-"));
		const filePath = path.join(tempDir, "session.csv");

		await writeFile(
			filePath,
			[
				"Timestamp (ms),Engine RPM",
				"Unit,rpm",
				"100,2000",
				"200,2500",
				"300,3000",
				"",
			].join("\n"),
		);

		const meta = await readLogFileMeta(filePath);
		const parsed = await parseLogFileRows(filePath);

		expect(meta.timeUnit).toBe("ms");
		expect(meta.durationMs).toBe(200);
		expect(meta.sampleRateHz).toBe(10);
		expect(parsed.timeUnit).toBe("ms");
		expect(parsed.timeColumnName).toBe("Timestamp (ms)");
		expect(parsed.sampleRateHz).toBe(10);

		await rm(tempDir, { recursive: true, force: true });
	});
});
