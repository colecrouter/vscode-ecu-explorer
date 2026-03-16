import { describe, expect, it } from "vitest";
import {
	detectLogFormat,
	getDefaultOutputPath,
	normalizeEvoScanCsv,
	renderNormalizedCsv,
} from "./normalize-log.js";

describe("normalize-log", () => {
	const sampleCsv = [
		"LogID,LogEntryDate,LogEntryTime,LogEntrySeconds,LogNotes,2ByteRPM,AFR,WGDC_Active,Battery",
		"1,2026-03-15,22:34:39.62814,0.22742,,1054.6875,14.7,35.2,14.5",
		"2,2026-03-15,22:34:39.72191,0.32444,,1200,14.4,40.1,14.4",
		"",
	].join("\n");

	it("detects EvoScan headers", () => {
		expect(
			detectLogFormat([
				"LogID",
				"LogEntryDate",
				"LogEntryTime",
				"LogEntrySeconds",
			]),
		).toBe("evoscan");
	});

	it("normalizes EvoScan logs into native CSV parts", () => {
		const normalized = normalizeEvoScanCsv(sampleCsv);

		expect(normalized.headers).toEqual([
			"Timestamp (ms)",
			"2ByteRPM",
			"AFR",
			"WGDC_Active",
			"Battery",
		]);
		expect(normalized.units).toEqual(["Unit", "rpm", "afr", "%", "V"]);
		expect(normalized.rows[0]).toEqual([
			"227",
			"1054.6875",
			"14.7",
			"35.2",
			"14.5",
		]);
		expect(normalized.rows[1]).toEqual(["324", "1200", "14.4", "40.1", "14.4"]);
	});

	it("supports channel subsetting", () => {
		const normalized = normalizeEvoScanCsv(sampleCsv, {
			channels: ["AFR", "Battery"],
		});

		expect(normalized.headers).toEqual(["Timestamp (ms)", "AFR", "Battery"]);
		expect(normalized.rows[0]).toEqual(["227", "14.7", "14.5"]);
	});

	it("renders normalized CSV text", () => {
		const rendered = renderNormalizedCsv(normalizeEvoScanCsv(sampleCsv));

		expect(rendered).toContain(
			"Timestamp (ms),2ByteRPM,AFR,WGDC_Active,Battery",
		);
		expect(rendered).toContain("Unit,rpm,afr,%,V");
		expect(rendered).toContain("227,1054.6875,14.7,35.2,14.5");
	});

	it("derives a default output path beside the input file", () => {
		expect(getDefaultOutputPath("/tmp/evoscan.csv")).toBe(
			"/tmp/evoscan.ecu-explorer.csv",
		);
	});
});
