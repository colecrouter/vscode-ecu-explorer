import { describe, expect, it } from "vitest";
import {
	type DiagnosticResult,
	DiagnosticStage,
	DiagnosticStatus,
	formatDiagnosticEventsMarkdown,
	formatDiagnosticFrontmatter,
	formatDiagnosticOutput,
} from "../src/formatters/diagnostics-formatter.js";

describe("Diagnostics Formatter", () => {
	const mockResult: DiagnosticResult = {
		device: { id: "test-id", name: "Test Device" },
		connection: { deviceInfo: { id: "test-id", name: "Test Device" } },
		protocol: { name: "Test Protocol" },
		events: [
			{
				stage: DiagnosticStage.ENUMERATE,
				status: DiagnosticStatus.SUCCESS,
				timestamp: Date.now(),
				duration: 10,
				summary: "Found 1 device",
			},
			{
				stage: DiagnosticStage.CONNECT,
				status: DiagnosticStatus.SUCCESS,
				timestamp: Date.now(),
				duration: 50,
				summary: "Connected",
			},
		],
	};

	describe("formatDiagnosticFrontmatter", () => {
		it("contains expected fields and success status", () => {
			const output = formatDiagnosticFrontmatter("probe", mockResult);
			expect(output).toContain("tool: device-inspect");
			expect(output).toContain("command: probe");
			expect(output).toContain("device: test-id");
			expect(output).toContain("status: success");
			expect(output).toContain("protocol: Test Protocol");
		});

		it("reports failure status when error is present", () => {
			const resultWithError = {
				...mockResult,
				error: new Error("Failed"),
			};
			const output = formatDiagnosticFrontmatter("connect", resultWithError);
			expect(output).toContain("status: failure");
		});

		it("includes trace_file when provided", () => {
			const output = formatDiagnosticFrontmatter(
				"log",
				mockResult,
				"trace.jsonl",
			);
			expect(output).toContain("trace_file: trace.jsonl");
		});
	});

	describe("formatDiagnosticEventsMarkdown", () => {
		it("contains markdown table with correct headers", () => {
			const output = formatDiagnosticEventsMarkdown(mockResult.events);
			expect(output).toContain("## Diagnostic Steps");
			expect(output).toContain("Stage");
			expect(output).toContain("Status");
			expect(output).toContain("Duration");
			expect(output).toContain("Summary");
			expect(output).toContain("enumerate");
			expect(output).toContain("success");
			expect(output).toContain("10ms");
			expect(output).toContain("Found 1 device");
		});
	});

	describe("formatDiagnosticOutput", () => {
		it("combines frontmatter and markdown", () => {
			const output = formatDiagnosticOutput("list", mockResult);
			expect(output).toContain("---");
			expect(output).toContain("tool: device-inspect");
			expect(output).toContain("## Diagnostic Steps");
		});
	});
});
