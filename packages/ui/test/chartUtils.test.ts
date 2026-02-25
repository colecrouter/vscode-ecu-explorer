/**
 * Tests for chart utility functions
 *
 * Tests downsampling algorithms, formatting utilities, and helper functions
 * used for chart data processing and display.
 */

import { describe, expect, it, vi } from "vitest";
import {
	debounce,
	downsample2D,
	downsampleData,
	formatAxisLabel,
	formatTooltipValue,
	shouldDownsample,
} from "../src/lib/views/chartUtils";

describe("chartUtils", () => {
	describe("shouldDownsample", () => {
		it("returns false when data length is below threshold", () => {
			expect(shouldDownsample(500, 1000)).toBe(false);
			expect(shouldDownsample(1000, 1000)).toBe(false);
		});

		it("returns true when data length exceeds threshold", () => {
			expect(shouldDownsample(1001, 1000)).toBe(true);
			expect(shouldDownsample(5000, 1000)).toBe(true);
		});

		it("uses default threshold of 1000", () => {
			expect(shouldDownsample(999)).toBe(false);
			expect(shouldDownsample(1001)).toBe(true);
		});

		it("handles edge cases", () => {
			expect(shouldDownsample(0, 1000)).toBe(false);
			expect(shouldDownsample(1, 1000)).toBe(false);
		});
	});

	describe("downsampleData", () => {
		it("returns original data when length is below maxPoints", () => {
			const data = [1, 2, 3, 4, 5];
			const result = downsampleData(data, 10);

			expect(result.values).toEqual(data);
			expect(result.indices).toEqual([0, 1, 2, 3, 4]);
		});

		it("returns original data when length equals maxPoints", () => {
			const data = [1, 2, 3, 4, 5];
			const result = downsampleData(data, 5);

			expect(result.values).toEqual(data);
			expect(result.indices).toEqual([0, 1, 2, 3, 4]);
		});

		it("downsamples data using LTTB algorithm", () => {
			// Create data with clear peaks
			const data = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
			const result = downsampleData(data, 5);

			expect(result.values.length).toBe(5);
			expect(result.indices.length).toBe(5);

			// First and last points should always be preserved
			expect(result.indices[0]).toBe(0);
			expect(result.indices[result.indices.length - 1]).toBe(data.length - 1);
			expect(result.values[0]).toBe(0);
			expect(result.values[result.values.length - 1]).toBe(0);
		});

		it("preserves peaks and valleys", () => {
			// Create data with a clear peak
			const data = [0, 0, 0, 10, 0, 0, 0];
			const result = downsampleData(data, 4);

			// Peak should be preserved
			expect(result.values).toContain(10);
		});

		it("handles large datasets", () => {
			const data = Array.from({ length: 10000 }, (_, i) => Math.sin(i / 100));
			const result = downsampleData(data, 100);

			expect(result.values.length).toBe(100);
			expect(result.indices.length).toBe(100);

			// Verify indices are in ascending order
			for (let i = 1; i < result.indices.length; i++) {
				const current = result.indices[i];
				const previous = result.indices[i - 1];
				if (current === undefined || previous === undefined)
					throw new Error("Expected indices to be defined");
				expect(current).toBeGreaterThan(previous);
			}
		});

		it("handles empty array", () => {
			const data: number[] = [];
			const result = downsampleData(data, 10);

			expect(result.values).toEqual([]);
			expect(result.indices).toEqual([]);
		});

		it("handles single element array", () => {
			const data = [42];
			const result = downsampleData(data, 10);

			expect(result.values).toEqual([42]);
			expect(result.indices).toEqual([0]);
		});

		it("handles two element array", () => {
			const data = [1, 2];
			const result = downsampleData(data, 10);

			expect(result.values).toEqual([1, 2]);
			expect(result.indices).toEqual([0, 1]);
		});

		it("maintains correct index-value correspondence", () => {
			const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
			const result = downsampleData(data, 5);

			// Verify each value corresponds to correct index
			for (let i = 0; i < result.values.length; i++) {
				const index = result.indices[i];
				if (index === undefined)
					throw new Error(`Expected index at ${i} to be defined`);
				expect(result.values[i]).toBe(data[index]);
			}
		});
	});

	describe("downsample2D", () => {
		it("returns original matrix when dimensions are below max", () => {
			const matrix = [
				[1, 2, 3],
				[4, 5, 6],
			];
			const result = downsample2D(matrix, 10, 10);

			expect(result).toEqual(matrix);
		});

		it("returns original matrix when dimensions equal max", () => {
			const matrix = [
				[1, 2, 3],
				[4, 5, 6],
			];
			const result = downsample2D(matrix, 2, 3);

			expect(result).toEqual(matrix);
		});

		it("downsamples rows when exceeding maxRows", () => {
			const matrix = [
				[1, 2],
				[3, 4],
				[5, 6],
				[7, 8],
			];
			const result = downsample2D(matrix, 2, 10);

			expect(result.length).toBe(2);
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow.length).toBe(2);
		});

		it("downsamples columns when exceeding maxCols", () => {
			const matrix = [
				[1, 2, 3, 4],
				[5, 6, 7, 8],
			];
			const result = downsample2D(matrix, 10, 2);

			expect(result.length).toBe(2);
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow.length).toBe(2);
		});

		it("downsamples both dimensions", () => {
			const matrix = [
				[1, 2, 3, 4],
				[5, 6, 7, 8],
				[9, 10, 11, 12],
				[13, 14, 15, 16],
			];
			const result = downsample2D(matrix, 2, 2);

			expect(result.length).toBe(2);
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow.length).toBe(2);
		});

		it("averages values in buckets", () => {
			const matrix = [
				[1, 2],
				[3, 4],
			];
			const result = downsample2D(matrix, 1, 1);

			// Average of all values: (1 + 2 + 3 + 4) / 4 = 2.5
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow[0]).toBe(2.5);
		});

		it("handles empty matrix", () => {
			const matrix: number[][] = [];
			const result = downsample2D(matrix, 10, 10);

			expect(result).toEqual([]);
		});

		it("handles matrix with empty rows", () => {
			const matrix: number[][] = [[]];
			const result = downsample2D(matrix, 10, 10);

			expect(result).toEqual([[]]);
		});

		it("handles large matrices", () => {
			const matrix = Array.from({ length: 200 }, (_, r) =>
				Array.from({ length: 200 }, (_, c) => r * 200 + c),
			);
			const result = downsample2D(matrix, 50, 50);

			expect(result.length).toBe(50);
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow.length).toBe(50);
		});

		it("preserves overall patterns", () => {
			// Create a gradient matrix
			const matrix = Array.from({ length: 10 }, (_, r) =>
				Array.from({ length: 10 }, (_, c) => r + c),
			);
			const result = downsample2D(matrix, 5, 5);

			// Verify gradient is preserved (values increase)
			for (let r = 0; r < result.length - 1; r++) {
				const currentRow = result[r];
				const nextRow = result[r + 1];
				if (!currentRow || !nextRow)
					throw new Error("Expected rows to be defined");
				for (let c = 0; c < currentRow.length - 1; c++) {
					const currentVal = currentRow[c];
					const nextColVal = currentRow[c + 1];
					const nextRowVal = nextRow[c];
					if (
						currentVal === undefined ||
						nextColVal === undefined ||
						nextRowVal === undefined
					) {
						throw new Error("Expected values to be defined");
					}
					expect(nextRowVal).toBeGreaterThan(currentVal);
					expect(nextColVal).toBeGreaterThan(currentVal);
				}
			}
		});

		it("handles non-uniform bucket sizes", () => {
			const matrix = [
				[1, 2, 3],
				[4, 5, 6],
				[7, 8, 9],
			];
			const result = downsample2D(matrix, 2, 2);

			expect(result.length).toBe(2);
			const firstRow = result[0];
			if (!firstRow) throw new Error("Expected first row to be defined");
			expect(firstRow.length).toBe(2);
		});
	});

	describe("formatAxisLabel", () => {
		it("formats value with default precision", () => {
			expect(formatAxisLabel(1234.5678)).toBe("1234.57");
		});

		it("formats value with custom precision", () => {
			expect(formatAxisLabel(1234.5678, undefined, 1)).toBe("1234.6");
			expect(formatAxisLabel(1234.5678, undefined, 3)).toBe("1234.568");
			expect(formatAxisLabel(1234.5678, undefined, 0)).toBe("1235");
		});

		it("formats value with unit", () => {
			expect(formatAxisLabel(1234.5678, "rpm")).toBe("1234.57 rpm");
			expect(formatAxisLabel(25.5, "°C")).toBe("25.50 °C");
		});

		it("formats value with unit and custom precision", () => {
			expect(formatAxisLabel(1234.5678, "rpm", 1)).toBe("1234.6 rpm");
			expect(formatAxisLabel(25.5, "°C", 0)).toBe("26 °C");
		});

		it("handles zero", () => {
			expect(formatAxisLabel(0)).toBe("0.00");
			expect(formatAxisLabel(0, "V")).toBe("0.00 V");
		});

		it("handles negative values", () => {
			expect(formatAxisLabel(-123.456)).toBe("-123.46");
			expect(formatAxisLabel(-123.456, "°C")).toBe("-123.46 °C");
		});

		it("handles very small values", () => {
			expect(formatAxisLabel(0.00123, undefined, 5)).toBe("0.00123");
			expect(formatAxisLabel(0.00123, "V", 5)).toBe("0.00123 V");
		});

		it("handles very large values", () => {
			expect(formatAxisLabel(1234567.89, undefined, 1)).toBe("1234567.9");
			expect(formatAxisLabel(1234567.89, "Hz", 0)).toBe("1234568 Hz");
		});
	});

	describe("formatTooltipValue", () => {
		it("formats large values with 1 decimal place", () => {
			expect(formatTooltipValue(1234.5678)).toBe("1234.6");
			expect(formatTooltipValue(5000.123, "rpm")).toBe("5000.1 rpm");
		});

		it("formats medium values with 2 decimal places", () => {
			expect(formatTooltipValue(123.456)).toBe("123.46");
			expect(formatTooltipValue(50.789, "°C")).toBe("50.79 °C");
		});

		it("formats small values with 4 decimal places", () => {
			expect(formatTooltipValue(0.12345)).toBe("0.1235");
			expect(formatTooltipValue(0.5678, "V")).toBe("0.5678 V");
		});

		it("formats very small values with 5 decimal places", () => {
			expect(formatTooltipValue(0.00123)).toBe("0.00123");
			expect(formatTooltipValue(0.00789, "A")).toBe("0.00789 A");
		});

		it("handles zero", () => {
			// Zero has absValue < 0.01, so gets 5 decimal places
			expect(formatTooltipValue(0)).toBe("0.00000");
			expect(formatTooltipValue(0, "V")).toBe("0.00000 V");
		});

		it("handles negative values", () => {
			expect(formatTooltipValue(-123.456)).toBe("-123.46");
			expect(formatTooltipValue(-0.00123)).toBe("-0.00123");
		});

		it("adjusts precision based on absolute value", () => {
			expect(formatTooltipValue(-1234.5)).toBe("-1234.5");
			expect(formatTooltipValue(-0.00123)).toBe("-0.00123");
		});

		it("handles boundary values", () => {
			// 1000 is NOT > 1000, so it gets precision = 2
			expect(formatTooltipValue(1000)).toBe("1000.00");
			// 1 is >= 1 and <= 1000, so it gets precision = 2
			expect(formatTooltipValue(1)).toBe("1.00");
			// 0.01 is NOT < 0.01, so it gets precision = 4 (< 1 but >= 0.01)
			expect(formatTooltipValue(0.01)).toBe("0.0100");
		});
	});

	describe("debounce", () => {
		it("delays function execution", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			expect(fn).not.toHaveBeenCalled();

			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("cancels previous calls", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced();
			debounced();
			debounced();

			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("passes arguments correctly", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced("arg1", "arg2");

			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(fn).toHaveBeenCalledWith("arg1", "arg2");
		});

		it("uses latest arguments when called multiple times", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 100);

			debounced("first");
			debounced("second");
			debounced("third");

			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(fn).toHaveBeenCalledTimes(1);
			expect(fn).toHaveBeenCalledWith("third");
		});

		it("allows multiple executions after delay", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 50);

			debounced();
			await new Promise((resolve) => setTimeout(resolve, 100));

			debounced();
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(fn).toHaveBeenCalledTimes(2);
		});

		it("handles zero delay", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 0);

			debounced();

			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("handles multiple arguments", async () => {
			const fn = vi.fn();
			const debounced = debounce(fn, 50);

			debounced(1, "two", { three: 3 }, [4]);

			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(fn).toHaveBeenCalledWith(1, "two", { three: 3 }, [4]);
		});
	});
});
