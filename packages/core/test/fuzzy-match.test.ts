import { describe, expect, it } from "vitest";
import {
	findClosestMatches,
	levenshteinDistance,
} from "../src/definition/fuzzy-match";

describe("levenshteinDistance", () => {
	it("returns 0 for identical strings", () => {
		expect(levenshteinDistance("hello", "hello")).toBe(0);
	});

	it("returns correct distance for single character substitution", () => {
		expect(levenshteinDistance("hello", "hallo")).toBe(1);
	});

	it("returns correct distance for single character insertion", () => {
		expect(levenshteinDistance("hello", "hello")).toBe(0);
		expect(levenshteinDistance("hello", "hallo")).toBe(1);
		expect(levenshteinDistance("hello", "helloo")).toBe(1);
	});

	it("returns correct distance for single character deletion", () => {
		expect(levenshteinDistance("hello", "helo")).toBe(1);
	});

	it("returns correct distance for completely different strings", () => {
		expect(levenshteinDistance("abc", "xyz")).toBe(3);
	});

	it("handles empty strings", () => {
		expect(levenshteinDistance("", "hello")).toBe(5);
		expect(levenshteinDistance("hello", "")).toBe(5);
		expect(levenshteinDistance("", "")).toBe(0);
	});

	it("is case sensitive", () => {
		expect(levenshteinDistance("Hello", "hello")).toBe(1);
	});
});

describe("findClosestMatches", () => {
	const candidates = [
		"Fuel_Table",
		"Timing_Table",
		"Boost_Table",
		"Idle_Table",
		"Rev_Limit",
		"Injector_Flow",
	];

	it("returns exact match when found", () => {
		const result = findClosestMatches("Fuel_Table", candidates);
		expect(result).toContain("Fuel_Table");
	});

	it("returns case-insensitive matches", () => {
		const result = findClosestMatches("fuel_table", candidates);
		expect(result).toContain("Fuel_Table");
	});

	it("finds close matches for typos", () => {
		const result = findClosestMatches("Fuel_Tabl", candidates);
		expect(result[0]).toBe("Fuel_Table");
	});

	it("returns multiple matches sorted by similarity", () => {
		const result = findClosestMatches("table", candidates, 3);
		// Should return tables that contain "table" (case-insensitive)
		// "Fuel_Table", "Timing_Table", "Boost_Table", "Idle_Table" all contain "table"
		expect(result.length).toBeGreaterThan(0);
		// First result should be the closest match
		expect(result[0]).toMatch(/Table$/);
	});

	it("returns default of 3 results", () => {
		const result = findClosestMatches("xyz", candidates);
		expect(result.length).toBe(3);
	});

	it("respects maxResults parameter", () => {
		const result = findClosestMatches("table", candidates, 1);
		expect(result.length).toBe(1);
	});

	it("returns empty array for empty input", () => {
		const result = findClosestMatches("", candidates);
		expect(result).toEqual([]);
	});

	it("returns empty array for empty candidates", () => {
		const result = findClosestMatches("table", []);
		expect(result).toEqual([]);
	});

	it("returns empty array for undefined/null input", () => {
		const result = findClosestMatches(null as unknown as string, candidates);
		expect(result).toEqual([]);
	});

	it("returns empty array for undefined/null candidates", () => {
		const result = findClosestMatches("table", null as unknown as string[]);
		expect(result).toEqual([]);
	});

	it("returns original case from candidates", () => {
		const result = findClosestMatches("timing_table", [
			"Timing_Table",
			"TIMING_TABLE",
		]);
		// Should return the original case from candidates
		expect(result).toContain("Timing_Table");
	});

	it("handles completely unrelated input", () => {
		const result = findClosestMatches("xyz123", candidates);
		// Should still return results (the closest matches regardless of similarity)
		expect(result.length).toBe(3);
	});

	// Test the core bug fix scenario
	it("prioritizes substring match over shorter unrelated candidates", () => {
		const result = findClosestMatches(
			"Boost Target #1B",
			["Boost Target #1B (High Gear Range)", "Boost", "Rev_Limit"],
			1,
		);
		expect(result[0]).toBe("Boost Target #1B (High Gear Range)");
	});

	// Test with maxDistance=20 (matches MCP usage in read-table.ts)
	it("finds substring match with maxDistance=20", () => {
		const result = findClosestMatches(
			"Boost Target #1B",
			["Boost Target #1B (High Gear Range)"],
			1,
			20,
		);
		expect(result[0]).toBe("Boost Target #1B (High Gear Range)");
	});

	// Test extractBaseName behavior via matching
	it("matches via extracted base name when input is base", () => {
		const result = findClosestMatches(
			"Boost Target",
			["Boost Target (High Gear)", "Other Table"],
			1,
		);
		expect(result[0]).toBe("Boost Target (High Gear)");
	});

	// Test reverse direction (input longer than base name)
	it("handles input longer than candidate base name", () => {
		const result = findClosestMatches(
			"Boost Target High Gear",
			["Boost Target (High Gear)", "Fuel Table (Low)"],
			1,
		);
		expect(result[0]).toBe("Boost Target (High Gear)");
	});

	// Ensure Levenshtein fallback still works for typos
	it("falls back to Levenshtein for typo correction", () => {
		const result = findClosestMatches(
			"Fuel_Tabl",
			["Fuel_Table", "Rev_Limit"],
			1,
		);
		expect(result[0]).toBe("Fuel_Table");
	});

	// Test nested parentheses
	it("handles nested parentheses in candidate name", () => {
		const result = findClosestMatches(
			"Table A",
			["Table A (variant (v2))", "Table B"],
			1,
		);
		expect(result[0]).toBe("Table A (variant (v2))");
	});
});
