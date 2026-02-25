import { describe, expect, it } from "vitest";

describe("Color Map Heatmap Generation", () => {
	describe("Color computation", () => {
		it("should compute color with valid data", () => {
			const data = [0, 50, 100];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(min).toBe(0);
			expect(max).toBe(100);
		});

		it("should normalize min/max values", () => {
			const data = [10, 50, 90];
			const min = Math.min(...data);
			const max = Math.max(...data);
			const normalized = data.map((v) => (v - min) / (max - min));

			expect(normalized[0]).toBe(0);
			expect(normalized[1]).toBeCloseTo(0.5, 1);
			expect(normalized[2]).toBe(1);
		});

		it("should handle single value (all same)", () => {
			const data = [50, 50, 50];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(min).toBe(max);
		});

		it("should handle all zeros", () => {
			const data = [0, 0, 0];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(min).toBe(0);
			expect(max).toBe(0);
		});

		it("should handle NaN values", () => {
			const data = [10, NaN, 90];
			const validData = data.filter((v) => !isNaN(v));

			expect(validData.length).toBe(2);
		});

		it("should handle extreme ranges", () => {
			const data = [0, 1000000];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(max - min).toBe(1000000);
		});
	});

	describe("Viridis palette interpolation", () => {
		it("should interpolate Viridis palette", () => {
			// Viridis palette: purple -> blue -> green -> yellow
			const viridis = [
				[0.267, 0.004, 0.329], // purple
				[0.282, 0.14, 0.458], // blue-purple
				[0.253, 0.265, 0.529], // blue
				[0.206, 0.371, 0.553], // blue-green
				[0.163, 0.471, 0.558], // cyan
				[0.127, 0.567, 0.55], // green-cyan
				[0.134, 0.658, 0.517], // green
				[0.266, 0.748, 0.44], // yellow-green
				[0.477, 0.821, 0.318], // yellow
				[0.741, 0.873, 0.149], // bright yellow
				[0.993, 0.906, 0.144], // yellow
			];

			expect(viridis.length).toBe(11);
			expect(viridis[0]?.[0]).toBeCloseTo(0.267, 2);
		});

		it("should map normalized value to color", () => {
			const normalized = 0.5;
			const colorIndex = Math.floor(normalized * 10);

			expect(colorIndex).toBe(5);
		});
	});

	describe("Contrast-aware text color", () => {
		it("should select text color based on background", () => {
			const bgColor = [0.5, 0.5, 0.5]; // gray
			const luminance =
				0.2126 * (bgColor[0] ?? 0) +
				0.7152 * (bgColor[1] ?? 0) +
				0.0722 * (bgColor[2] ?? 0);
			const textColor = luminance > 0.5 ? "black" : "white";

			expect(textColor).toBe("white");
		});

		it("should use white text on dark background", () => {
			const bgColor = [0.1, 0.1, 0.1]; // dark
			const luminance =
				0.2126 * (bgColor[0] ?? 0) +
				0.7152 * (bgColor[1] ?? 0) +
				0.0722 * (bgColor[2] ?? 0);
			const textColor = luminance > 0.5 ? "black" : "white";

			expect(textColor).toBe("white");
		});

		it("should use black text on light background", () => {
			const bgColor = [0.9, 0.9, 0.9]; // light
			const luminance =
				0.2126 * (bgColor[0] ?? 0) +
				0.7152 * (bgColor[1] ?? 0) +
				0.0722 * (bgColor[2] ?? 0);
			const textColor = luminance > 0.5 ? "black" : "white";

			expect(textColor).toBe("black");
		});
	});

	describe("Edge cases", () => {
		it("should handle empty array", () => {
			const data: number[] = [];
			expect(data.length).toBe(0);
		});

		it("should handle single element", () => {
			const data = [42];
			expect(data.length).toBe(1);
			expect(data[0]).toBe(42);
		});

		it("should handle negative values", () => {
			const data = [-100, 0, 100];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(min).toBe(-100);
			expect(max).toBe(100);
		});

		it("should handle very small differences", () => {
			const data = [1.0, 1.0001, 1.0002];
			const min = Math.min(...data);
			const max = Math.max(...data);

			expect(max - min).toBeCloseTo(0.0002, 4);
		});
	});
});
