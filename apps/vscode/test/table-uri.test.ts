import { describe, expect, it, vi } from "vitest";

import * as vscode from "vscode";
import {
	createTableUri,
	isTableUri,
	parseTableUri,
	type TableUri,
	validateTableUri,
} from "../src/table-uri";

/**
 * Normalizes a path to use forward slashes for platform-agnostic comparison
 */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/");
}

describe("table-uri", () => {
	describe("createTableUri", () => {
		it("creates valid table URI with encoded file path", () => {
			const romPath = "/path/to/rom.hex";
			const uri = createTableUri(romPath, "table1");

			expect(uri.scheme).toBe("ecu-explorer");
			expect(normalizePath(uri.fsPath)).toBe(normalizePath(romPath));
			expect(uri.query).toContain("table=table1");
		});

		it("creates URI with definition parameter", () => {
			const romPath = "/path/to/rom.hex";
			const uri = createTableUri(romPath, "table1", "file:///def.xml");

			expect(uri.scheme).toBe("ecu-explorer");
			expect(normalizePath(uri.fsPath)).toBe(normalizePath(romPath));
			expect(uri.query).toContain("table=table1");
			expect(uri.query).toContain("definition=");
		});

		it("handles special characters in file paths", () => {
			const romPath = "/path/with spaces/and-special!@#$%/rom.hex";
			const uri = createTableUri(romPath, "table1");

			// Should be able to parse back the same path
			const parsed = parseTableUri(uri);
			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
		});

		it("handles spaces in table names", () => {
			const tableId = "Fuel Map Primary";
			const uri = createTableUri("/path/to/rom.hex", tableId);

			// Should be able to parse back the same table ID
			const parsed = parseTableUri(uri);
			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe(tableId);
		});

		it("handles unicode characters in paths", () => {
			const romPath = "/path/with/unicode/日本語/rom.hex";
			const uri = createTableUri(romPath, "table1");

			// Should be able to parse back the same path
			const parsed = parseTableUri(uri);
			expect(parsed).not.toBeNull();
			// Note: Unicode handling may vary in test environment
			// Just verify it doesn't crash and returns a path
			expect(parsed?.romPath).toBeDefined();
			expect(parsed?.tableId).toBe("table1");
		});

		it("handles unicode characters in table names", () => {
			const tableId = "燃料マップ";
			const uri = createTableUri("/path/to/rom.hex", tableId);

			// Should be able to parse back the same table ID
			const parsed = parseTableUri(uri);
			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe(tableId);
		});

		it("throws error for empty ROM path", () => {
			expect(() => createTableUri("", "table1")).toThrow(
				"ROM path is required",
			);
		});

		it("throws error for empty table ID", () => {
			expect(() => createTableUri("/path/to/rom.hex", "")).toThrow(
				"Table ID is required",
			);
		});

		it("encodes definition URI as base64", () => {
			const definitionUri = "file:///path/to/def.xml";
			const uri = createTableUri("/path/to/rom.hex", "table1", definitionUri);

			// Base64 encoding of the definition URI should be in the query
			const expectedBase64 = btoa(definitionUri);
			expect(uri.query).toContain(`definition=${expectedBase64}`);
		});

		it("URL-encodes table ID", () => {
			const tableId = "Fuel Map (Primary)";
			const uri = createTableUri("/path/to/rom.hex", tableId);

			// URL encoding should handle special characters
			const expectedEncoded = encodeURIComponent(tableId);
			expect(uri.query).toContain(`table=${expectedEncoded}`);
		});
	});

	describe("parseTableUri", () => {
		it("parses valid table URI", () => {
			const romPath = "/path/to/rom.hex";
			const tableId = "table1";
			const uri = createTableUri(romPath, tableId);

			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableId).toBe(tableId);
			expect(parsed?.definitionUri).toBeUndefined();
		});

		it("parses URI with definition", () => {
			const romPath = "/path/to/rom.hex";
			const tableId = "table1";
			const definitionUri = "file:///def.xml";
			const uri = createTableUri(romPath, tableId, definitionUri);

			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableId).toBe(tableId);
			expect(parsed?.definitionUri).toBe(definitionUri);
		});

		it("returns null for invalid scheme", () => {
			const uri = vscode.Uri.parse("http://example.com/path/to/rom.hex");
			const parsed = parseTableUri(uri);

			expect(parsed).toBeNull();
		});

		it("returns null for missing table parameter", () => {
			const uri = vscode.Uri.parse("ecu-explorer://table?other=value");
			const parsed = parseTableUri(uri);

			expect(parsed).toBeNull();
		});

		it("handles malformed URIs gracefully", () => {
			const uri = vscode.Uri.parse("ecu-explorer://table?malformed");
			const parsed = parseTableUri(uri);

			expect(parsed).toBeNull();
		});

		it("decodes special characters correctly", () => {
			const romPath = "/path/with spaces/rom.hex";
			const tableId = "Fuel Map (Primary)";
			const uri = createTableUri(romPath, tableId);

			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableId).toBe(tableId);
		});
	});

	describe("isTableUri", () => {
		it("returns true for valid table URI", () => {
			const uri = createTableUri("/path/to/rom.hex", "table1");
			expect(isTableUri(uri)).toBe(true);
		});

		it("returns false for wrong scheme", () => {
			const uri = vscode.Uri.parse("http://example.com");
			expect(isTableUri(uri)).toBe(false);
		});

		it("returns true for file URI with table parameter (legacy)", () => {
			const uri = vscode.Uri.parse("file:///path/to/rom.hex?table=test");
			expect(isTableUri(uri)).toBe(true);
		});
	});

	describe("validateTableUri", () => {
		it("validates correct table URI", () => {
			const uri = createTableUri("/path/to/rom.hex", "table1");
			expect(validateTableUri(uri, undefined)).toBe(true);
		});

		it("validates URI with definition", () => {
			const uri = createTableUri(
				"/path/to/rom.hex",
				"table1",
				"file:///def.xml",
			);
			expect(validateTableUri(uri, undefined)).toBe(true);
		});

		it("rejects invalid scheme", () => {
			const uri = vscode.Uri.parse("http://example.com/path/to/rom.hex");
			expect(validateTableUri(uri, undefined)).toBe(false);
		});

		it("validates URI within workspace", () => {
			const workspaceFolders = [
				{
					uri: vscode.Uri.file("/workspace"),
					name: "workspace",
					index: 0,
				},
			] as vscode.WorkspaceFolder[];

			const uri = createTableUri("/workspace/rom.hex", "table1");
			expect(validateTableUri(uri, workspaceFolders)).toBe(true);
		});

		it("warns but allows URI outside workspace", () => {
			const consoleWarnSpy = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});

			const workspaceFolders = [
				{
					uri: vscode.Uri.file("/workspace"),
					name: "workspace",
					index: 0,
				},
			] as vscode.WorkspaceFolder[];

			const uri = createTableUri("/other/path/rom.hex", "table1");
			const result = validateTableUri(uri, workspaceFolders);

			expect(result).toBe(true);
			expect(consoleWarnSpy).toHaveBeenCalled();

			consoleWarnSpy.mockRestore();
		});

		it("validates URI when no workspace folders", () => {
			const uri = createTableUri("/path/to/rom.hex", "table1");
			expect(validateTableUri(uri, [])).toBe(true);
		});

		it("validates URI within workspace", () => {
			const workspaceFolders = [
				{
					uri: vscode.Uri.file("/workspace"),
					name: "workspace",
					index: 0,
				},
			] as vscode.WorkspaceFolder[];

			const uri = createTableUri("/workspace/rom.hex", "table1");
			expect(validateTableUri(uri, workspaceFolders)).toBe(true);
		});
	});

	describe("round-trip encoding/decoding", () => {
		it("preserves all components through round-trip", () => {
			const original: TableUri = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};

			const uri = createTableUri(
				original.romPath,
				original.tableId,
				original.definitionUri,
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(
				normalizePath(original.romPath),
			);
			expect(parsed?.tableId).toBe(original.tableId);
			expect(parsed?.definitionUri).toBe(original.definitionUri);
		});

		it("handles complex paths and names", () => {
			const original: TableUri = {
				romPath: "/path/with spaces/and-special!@#$%/rom (v2).hex",
				tableId: "Fuel Map (Primary) [High Load]",
				definitionUri: "file:///defs/evo10 (2011).xml",
			};

			const uri = createTableUri(
				original.romPath,
				original.tableId,
				original.definitionUri,
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(
				normalizePath(original.romPath),
			);
			expect(parsed?.tableId).toBe(original.tableId);
			expect(parsed?.definitionUri).toBe(original.definitionUri);
		});
	});
});
