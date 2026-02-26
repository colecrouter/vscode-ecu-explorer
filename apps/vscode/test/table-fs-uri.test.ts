/**
 * Tests for table-fs-uri.ts
 *
 * Tests the Virtual File System URI utilities for table URIs
 */

import { describe, expect, it } from "vitest";

import * as vscode from "vscode";
import { createTableUri, isTableUri, parseTableUri } from "../src/table-fs-uri";

/**
 * Normalizes a path to use forward slashes for platform-agnostic comparison
 */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/");
}

describe("table-fs-uri", () => {
	describe("createTableUri", () => {
		it("creates a valid table URI with absolute path", () => {
			const romPath = "/Users/test/rom.hex";
			const uri = createTableUri(romPath, "Fuel Map");
			expect(uri.scheme).toBe("ecu-table");
			expect(normalizePath(uri.path)).toContain(normalizePath(romPath));
			// jest-mock-vscode might not encode spaces in path property depending on version/config
			expect(uri.toString()).toContain("Fuel%20Map");
		});

		it("creates a valid table URI with relative path", () => {
			const romPath = "rom.hex";
			const uri = createTableUri(romPath, "Boost Target");
			expect(uri.scheme).toBe("ecu-table");
			expect(normalizePath(uri.path)).toContain(romPath);
			expect(uri.toString()).toContain("Boost%20Target");
		});

		it("throws error if ROM path is empty", () => {
			expect(() => createTableUri("", "Table")).toThrow("ROM path is required");
		});

		it("throws error if table name is empty", () => {
			expect(() => createTableUri("/test/rom.hex", "")).toThrow(
				"Table name is required",
			);
		});
	});

	describe("parseTableUri", () => {
		it("parses a valid table URI", () => {
			const romPath = "/Users/test/rom.hex";
			const uri = vscode.Uri.parse(`ecu-table://${romPath}?table=Fuel%20Map`);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableName).toBe("Fuel Map");
		});

		it("decodes URL-encoded table names", () => {
			const uri = vscode.Uri.parse(
				"ecu-table:///test/rom.hex?table=Fuel%20Map%20(High%20Octane)",
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableName).toBe("Fuel Map (High Octane)");
		});

		it("supports table names containing slash", () => {
			const tableName = "Fuel/Timing Blend";
			const uri = createTableUri("/test/rom.hex", tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableName).toBe(tableName);
		});

		it("parses legacy path-based URI format", () => {
			const uri = vscode.Uri.parse("ecu-table:///test/rom.hex/Fuel%20Map");
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableName).toBe("Fuel Map");
		});

		it("returns null for non-table URI", () => {
			const uri = vscode.Uri.parse("file:///test/rom.hex");
			const parsed = parseTableUri(uri);

			expect(parsed).toBeNull();
		});
	});

	describe("isTableUri", () => {
		it("returns true for table URI", () => {
			const uri = vscode.Uri.parse("ecu-table:///test/rom.hex/Table");

			expect(isTableUri(uri)).toBe(true);
		});

		it("returns false for file URI", () => {
			const uri = vscode.Uri.parse("file:///test/rom.hex");

			expect(isTableUri(uri)).toBe(false);
		});

		it("returns false for http URI", () => {
			const uri = vscode.Uri.parse("http://example.com");

			expect(isTableUri(uri)).toBe(false);
		});
	});

	describe("round-trip", () => {
		it("creates and parses URI correctly", () => {
			const romPath = "/Users/test/rom.hex";
			const tableName = "Fuel Map";

			const uri = createTableUri(romPath, tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableName).toBe(tableName);
		});

		it("handles special characters in round-trip", () => {
			const romPath = "/Users/test/rom.hex";
			const tableName = "Fuel Map (High Octane) [Test]";

			const uri = createTableUri(romPath, tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableName).toBe(tableName);
		});
	});
});
