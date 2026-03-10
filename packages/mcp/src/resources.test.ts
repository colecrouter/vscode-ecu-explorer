import { describe, expect, it } from "vitest";
import {
	buildOpenDocumentsContextPayload,
	buildQuerySyntaxResourceText,
} from "./resources.js";

describe("buildOpenDocumentsContextPayload", () => {
	it("omits empty ROM and table sections", () => {
		const payload = buildOpenDocumentsContextPayload({
			version: 1,
			timestamp: "2026-03-10T00:00:00.000Z",
			roms: [],
			tables: [],
		});
		const parsed = JSON.parse(payload) as Record<string, unknown>;

		expect(parsed).toEqual({
			version: 1,
			timestamp: "2026-03-10T00:00:00.000Z",
		});
	});

	it("includes only populated sections", () => {
		const payload = buildOpenDocumentsContextPayload({
			version: 1,
			timestamp: "2026-03-10T00:00:00.000Z",
			roms: [
				{
					uri: "file:///tmp/test.hex",
					path: "/tmp/test.hex",
					name: "test.hex",
					sizeBytes: 1024,
					isDirty: true,
					activeEditors: 1,
				},
			],
			tables: [],
		});
		const parsed = JSON.parse(payload) as Record<string, unknown>;

		expect(parsed).toHaveProperty("roms");
		expect(parsed).not.toHaveProperty("tables");
	});
});

describe("buildQuerySyntaxResourceText", () => {
	it("documents raw field names and exact table equality behavior", () => {
		const text = buildQuerySyntaxResourceText();

		expect(text).toContain(
			"Field names can be used exactly as exposed by the tool, including spaces and punctuation.",
		);
		expect(text).toContain("Engine RPM > 3000 && Knock Sum > 0");
		expect(text).toContain(
			"For table selectors, equality matches exact breakpoint values only.",
		);
	});
});
