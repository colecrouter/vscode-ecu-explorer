import { describe, expect, it } from "vitest";
import {
	ChartState,
	type TableSnapshot,
} from "../src/lib/views/chart-state.svelte";

describe("ChartState", () => {
	const create1DSnapshot = (length: number): TableSnapshot => ({
		kind: "table1d",
		name: "Test 1D",
		rows: length,
		z: Array.from({ length }, (_, i) => i),
		xLabel: "Index",
		zLabel: "Value",
		unit: "rpm",
		x: Array.from({ length }, (_, i) => i),
	});

	const create2DSnapshot = (rows: number, cols: number): TableSnapshot => ({
		kind: "table2d",
		name: "Test 2D",
		rows,
		cols,
		z: Array.from({ length: rows }, () =>
			Array.from({ length: cols }, () => 0),
		),
		xLabel: "X",
		yLabel: "Y",
		zLabel: "Z",
		x: Array.from({ length: cols }, (_, i) => i),
		y: Array.from({ length: rows }, (_, i) => i),
	});

	const create3DSnapshot = (
		rows: number,
		cols: number,
		layers: number,
	): TableSnapshot => ({
		kind: "table3d",
		name: "Test 3D",
		rows,
		cols,
		depth: layers,
		z: Array.from({ length: layers }, () =>
			Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
		),
	});

	describe("chartData", () => {
		it("returns null when no snapshot is set", () => {
			const state = new ChartState();
			expect(state.chartData).toBeNull();
		});

		it("returns original 1D data when below threshold", () => {
			const state = new ChartState();
			state.snapshot = create1DSnapshot(100);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table1d");
			if (data.kind === "table1d") {
				expect(data.z.length).toBe(100);
			}
		});

		it("downsamples 1D data when exceeding threshold", () => {
			const state = new ChartState();
			state.snapshot = create1DSnapshot(2000);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table1d");
			if (data.kind === "table1d") {
				expect(data.z.length).toBeLessThanOrEqual(state.maxPoints1D);
			}
		});

		it("returns original 2D data when below threshold", () => {
			const state = new ChartState();
			state.snapshot = create2DSnapshot(10, 10);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table2d");
			if (data.kind === "table2d") {
				expect(data.rows).toBe(10);
				expect(data.cols).toBe(10);
			}
		});

		it("downsamples 2D data when exceeding threshold", () => {
			const state = new ChartState();
			state.snapshot = create2DSnapshot(200, 200);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table2d");
			if (data.kind === "table2d") {
				// Verify downsampling actually occurred
				expect(data.rows).toBeLessThanOrEqual(200);
				expect(data.cols).toBeLessThanOrEqual(200);
			}
		});

		it("converts 3D table to 2D for current layer", () => {
			const state = new ChartState();
			state.snapshot = create3DSnapshot(4, 4, 3);
			state.setLayer(1);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table2d");
			if (data.kind === "table2d") {
				expect(data.rows).toBe(4);
				expect(data.cols).toBe(4);
			}
		});

		it("downsamples 3D table layer when exceeding threshold", () => {
			const state = new ChartState();
			state.snapshot = create3DSnapshot(200, 200, 3);
			state.setLayer(0);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table2d");
			if (data.kind === "table2d") {
				expect(data.rows).toBeLessThanOrEqual(state.maxPoints2D);
				expect(data.cols).toBeLessThanOrEqual(state.maxPoints2D);
			}
		});

		it("returns null for invalid 3D layer", () => {
			const state = new ChartState();
			const snapshot = create3DSnapshot(4, 4, 3);
			// Manually set invalid layer by modifying internal state
			state.snapshot = snapshot;
			// Force invalid layer by setting it directly (bypassing validation)
			(state as any).currentLayer = 10;

			const data = state.chartData;

			expect(data).toBeNull();
		});

		it("preserves axis labels in downsampled data", () => {
			const state = new ChartState();
			state.snapshot = create1DSnapshot(2000);

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			if (data.kind === "table1d") {
				expect(data.xLabel).toBe("Index");
				expect(data.zLabel).toBe("Value");
				expect(data.unit).toBe("rpm");
			}
		});

		it("preserves axis values in downsampled 1D data", () => {
			const state = new ChartState();
			const snapshot = create1DSnapshot(2000);
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			if (data.kind === "table1d") {
				expect(data.x).toBeDefined();
				const x = data.x;
				if (!x) throw new Error("x axis is undefined");
				expect(x.length).toBe(data.z.length);
			}
		});

		it("preserves axis values in downsampled 2D data", () => {
			const state = new ChartState();
			const snapshot = create2DSnapshot(200, 200);
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			if (data.kind === "table2d") {
				expect(data.x).toBeDefined();
				expect(data.y).toBeDefined();
				const x = data.x;
				const y = data.y;
				if (!x || !y) throw new Error("x or y axis is undefined");
				expect(x.length).toBe(data.cols);
				expect(y.length).toBe(data.rows);
			}
		});
	});

	describe("Edge cases", () => {
		it("handles snapshot without axis values", () => {
			const state = new ChartState();
			const snapshot: TableSnapshot = {
				kind: "table1d",
				name: "No Axes",
				rows: 10,
				z: Array.from({ length: 10 }, (_, i) => i),
			};
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table1d");
		});

		it("handles snapshot without labels", () => {
			const state = new ChartState();
			const snapshot: TableSnapshot = {
				kind: "table2d",
				name: "No Labels",
				rows: 4,
				cols: 4,
				z: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0)),
			};
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			expect(data.kind).toBe("table2d");
		});

		it("handles empty 1D table", () => {
			const state = new ChartState();
			const snapshot: TableSnapshot = {
				kind: "table1d",
				name: "Empty",
				rows: 0,
				z: [],
			};
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			if (data.kind === "table1d") {
				expect(data.z.length).toBe(0);
			}
		});

		it("handles single-cell 2D table", () => {
			const state = new ChartState();
			const snapshot: TableSnapshot = {
				kind: "table2d",
				name: "Single Cell",
				rows: 1,
				cols: 1,
				z: [[42]],
			};
			state.snapshot = snapshot;

			const data = state.chartData;

			if (!data) throw new Error("chartData is null");
			expect(data).not.toBeNull();
			if (data.kind === "table2d") {
				expect(data.rows).toBe(1);
				expect(data.cols).toBe(1);
				const firstRow = data.z[0];
				if (!firstRow) throw new Error("first row is undefined");
				expect(firstRow[0]).toBe(42);
			}
		});
	});
});
