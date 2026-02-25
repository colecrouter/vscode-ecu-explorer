import { describe, expect, it } from "vitest";
import {
	addConstant,
	clampValues,
	multiplyConstant,
	smoothValues,
} from "../src/math/operations";

describe("Math Operations", () => {
	describe("addConstant", () => {
		it("adds constant to all values", () => {
			const result = addConstant([10, 20, 30], 5);
			expect(result.values).toEqual([15, 25, 35]);
			expect(result.changedCount).toBe(3);
			expect(result.warnings).toEqual([]);
		});

		it("handles negative constant (subtract)", () => {
			const result = addConstant([10, 20, 30], -5);
			expect(result.values).toEqual([5, 15, 25]);
			expect(result.changedCount).toBe(3);
		});

		it("clamps to max constraint", () => {
			const result = addConstant([10, 20, 30], 50, { max: 40 });
			expect(result.values).toEqual([40, 40, 40]);
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.changedCount).toBe(3);
		});

		it("clamps to min constraint", () => {
			const result = addConstant([10, 20, 30], -50, { min: 0 });
			expect(result.values).toEqual([0, 0, 0]);
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.changedCount).toBe(3);
		});

		it("handles mixed clamping", () => {
			const result = addConstant([10, 20, 30, 40, 50], 10, {
				min: 0,
				max: 45,
			});
			expect(result.values).toEqual([20, 30, 40, 45, 45]);
			expect(result.changedCount).toBe(5);
		});

		it("handles no changes when adding zero", () => {
			const result = addConstant([10, 20, 30], 0);
			expect(result.values).toEqual([10, 20, 30]);
			expect(result.changedCount).toBe(0);
		});

		it("handles empty array", () => {
			const result = addConstant([], 5);
			expect(result.values).toEqual([]);
			expect(result.changedCount).toBe(0);
		});

		it("handles floating point values", () => {
			const result = addConstant([10.5, 20.5, 30.5], 5.5);
			expect(result.values).toEqual([16, 26, 36]);
			expect(result.changedCount).toBe(3);
		});
	});

	describe("multiplyConstant", () => {
		it("multiplies all values by factor", () => {
			const result = multiplyConstant([10, 20, 30], 1.5);
			expect(result.values).toEqual([15, 30, 45]);
			expect(result.changedCount).toBe(3);
		});

		it("handles factor < 1 (division)", () => {
			const result = multiplyConstant([10, 20, 30], 0.5);
			expect(result.values).toEqual([5, 10, 15]);
			expect(result.changedCount).toBe(3);
		});

		it("handles factor = 0", () => {
			const result = multiplyConstant([10, 20, 30], 0);
			expect(result.values).toEqual([0, 0, 0]);
			expect(result.changedCount).toBe(3);
		});

		it("handles factor = 1 (no change)", () => {
			const result = multiplyConstant([10, 20, 30], 1);
			expect(result.values).toEqual([10, 20, 30]);
			expect(result.changedCount).toBe(0);
		});

		it("clamps to max constraint", () => {
			const result = multiplyConstant([10, 20, 30], 10, { max: 100 });
			expect(result.values).toEqual([100, 100, 100]);
			expect(result.warnings.length).toBeGreaterThan(0);
		});

		it("clamps to min constraint", () => {
			const result = multiplyConstant([10, 20, 30], -1, { min: 0 });
			expect(result.values).toEqual([0, 0, 0]);
			expect(result.warnings.length).toBeGreaterThan(0);
		});

		it("handles negative factor", () => {
			const result = multiplyConstant([10, 20, 30], -2);
			expect(result.values).toEqual([-20, -40, -60]);
			expect(result.changedCount).toBe(3);
		});

		it("handles empty array", () => {
			const result = multiplyConstant([], 2);
			expect(result.values).toEqual([]);
			expect(result.changedCount).toBe(0);
		});

		it("handles floating point precision", () => {
			const result = multiplyConstant([10.1, 20.2, 30.3], 1.5);
			expect(result.values[0]).toBeCloseTo(15.15, 2);
			expect(result.values[1]).toBeCloseTo(30.3, 2);
			expect(result.values[2]).toBeCloseTo(45.45, 2);
		});
	});

	describe("clampValues", () => {
		it("clamps values to range", () => {
			const result = clampValues([5, 15, 25, 35, 45], 10, 40);
			expect(result.values).toEqual([10, 15, 25, 35, 40]);
			expect(result.changedCount).toBe(2);
			expect(result.warnings).toEqual([]);
		});

		it("throws if min > max", () => {
			expect(() => clampValues([10, 20, 30], 40, 10)).toThrow(
				"min (40) must be <= max (10)",
			);
		});

		it("handles min = max", () => {
			const result = clampValues([5, 15, 25, 35, 45], 20, 20);
			expect(result.values).toEqual([20, 20, 20, 20, 20]);
			expect(result.changedCount).toBe(5);
		});

		it("handles values already within range", () => {
			const result = clampValues([15, 20, 25], 10, 30);
			expect(result.values).toEqual([15, 20, 25]);
			expect(result.changedCount).toBe(0);
		});

		it("handles empty array", () => {
			const result = clampValues([], 10, 40);
			expect(result.values).toEqual([]);
			expect(result.changedCount).toBe(0);
		});

		it("handles negative ranges", () => {
			const result = clampValues([-50, -10, 0, 10, 50], -20, 20);
			expect(result.values).toEqual([-20, -10, 0, 10, 20]);
			expect(result.changedCount).toBe(2);
		});

		it("handles floating point values", () => {
			const result = clampValues([5.5, 15.5, 25.5], 10.0, 20.0);
			expect(result.values).toEqual([10.0, 15.5, 20.0]);
			expect(result.changedCount).toBe(2);
		});
	});

	describe("smoothValues", () => {
		it("smooths 2D matrix with 3x3 kernel", () => {
			const matrix = [
				[10, 20, 30],
				[40, 50, 60],
				[70, 80, 90],
			];
			const result = smoothValues(matrix, 3, 1);
			expect(result.changedCount).toBeGreaterThan(0);
			expect(result.values.length).toBe(9);
			// Center cell should be average of all neighbors
			expect(result.values[4]).toBeCloseTo(50, 0);
		});

		it("throws if kernel size is even", () => {
			expect(() =>
				smoothValues(
					[
						[1, 2],
						[3, 4],
					],
					4,
				),
			).toThrow("Kernel size must be odd");
		});

		it("handles single iteration", () => {
			const matrix = [
				[0, 100, 0],
				[100, 0, 100],
				[0, 100, 0],
			];
			const result = smoothValues(matrix, 3, 1);
			expect(result.changedCount).toBeGreaterThan(0);
		});

		it("handles multiple iterations", () => {
			const matrix = [
				[0, 100, 0],
				[100, 0, 100],
				[0, 100, 0],
			];
			const result = smoothValues(matrix, 3, 2);
			expect(result.changedCount).toBeGreaterThan(0);
		});

		it("handles 5x5 kernel", () => {
			const matrix = [
				[10, 20, 30, 40, 50],
				[15, 25, 35, 45, 55],
				[20, 30, 40, 50, 60],
				[25, 35, 45, 55, 65],
				[30, 40, 50, 60, 70],
			];
			const result = smoothValues(matrix, 5, 1);
			expect(result.values.length).toBe(25);
		});

		it("handles pad boundary mode", () => {
			const matrix = [
				[10, 20],
				[30, 40],
			];
			const result = smoothValues(matrix, 3, 1, "pad");
			expect(result.values.length).toBe(4);
		});

		it("handles repeat boundary mode", () => {
			const matrix = [
				[10, 20],
				[30, 40],
			];
			const result = smoothValues(matrix, 3, 1, "repeat");
			expect(result.values.length).toBe(4);
		});

		it("handles mirror boundary mode", () => {
			const matrix = [
				[10, 20],
				[30, 40],
			];
			const result = smoothValues(matrix, 3, 1, "mirror");
			expect(result.values.length).toBe(4);
		});

		it("handles single row matrix", () => {
			const matrix = [[10, 20, 30, 40, 50]];
			const result = smoothValues(matrix, 3, 1);
			expect(result.values.length).toBe(5);
		});

		it("handles single column matrix", () => {
			const matrix = [[10], [20], [30], [40], [50]];
			const result = smoothValues(matrix, 3, 1);
			expect(result.values.length).toBe(5);
		});

		it("handles uniform matrix (no change)", () => {
			const matrix = [
				[50, 50, 50],
				[50, 50, 50],
				[50, 50, 50],
			];
			const result = smoothValues(matrix, 3, 1);
			// All values should remain 50
			for (const value of result.values) {
				expect(value).toBeCloseTo(50, 0);
			}
		});
	});
});
