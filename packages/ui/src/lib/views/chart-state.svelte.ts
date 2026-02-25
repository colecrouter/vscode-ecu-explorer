/**
 * Chart state management using Svelte 5 runes
 *
 * Manages reactive state for chart visualization including zoom, pan,
 * layer selection, and hover interactions.
 */

import { downsample2D, downsampleData, shouldDownsample } from "./chartUtils";

/**
 * Table snapshot for chart rendering
 *
 * Represents a point-in-time view of table data optimized for visualization.
 */
export type TableSnapshot =
	| {
			kind: "table1d";
			name: string;
			rows: number;
			description?: string;
			address?: number;
			x?: number[]; // Axis values (optional)
			z: number[]; // Data values
			unit?: string;
			xLabel?: string;
			zLabel?: string;
	  }
	| {
			kind: "table2d";
			name: string;
			rows: number;
			description?: string;
			cols: number;
			address?: number;
			x?: number[]; // Column axis values
			y?: number[]; // Row axis values
			z: number[][]; // Data matrix
			unit?: string;
			xLabel?: string;
			yLabel?: string;
			zLabel?: string;
	  }
	| {
			kind: "table3d";
			name: string;
			description?: string;
			rows: number;
			address?: number;
			cols: number;
			depth: number;
			x?: number[]; // Column axis values
			y?: number[]; // Row axis values
			z: number[][][]; // Data cube [depth][row][col]
			unit?: string;
			xLabel?: string;
			yLabel?: string;
			zLabel?: string;
			layerNames?: string[];
	  };

/**
 * Cell hover information
 */
export interface HoveredCell {
	row: number;
	col: number;
	value: number;
	xValue?: number;
	yValue?: number;
}

/**
 * Chart type selection
 */
export type ChartType = "auto" | "line" | "heatmap";

/**
 * Chart state management class using Svelte 5 runes
 *
 * Manages all reactive state for chart visualization including zoom, pan,
 * layer selection, and hover interactions. Uses Svelte 5's $state and $derived
 * runes for reactive updates.
 *
 * @example
 * const chartState = new ChartState();
 * chartState.zoomIn();
 * chartState.setLayer(1);
 * const data = chartState.chartData;
 */
export class ChartState {
	// Reactive state properties - must be public for Svelte 5 reactivity
	snapshot = $state<TableSnapshot | null>(null);
	selectedCell = $state<{ row: number; col: number } | null>(null);
	zoomLevel = $state(1);
	panX = $state(0);
	panY = $state(0);
	hoveredCell = $state<HoveredCell | null>(null);
	currentLayer = $state(0);
	chartType = $state<ChartType>("auto");
	showGrid = $state(true);

	// Zoom constraints
	readonly minZoom = 0.5;
	readonly maxZoom = 10;

	// Downsampling thresholds
	readonly maxPoints1D = 1000;
	readonly maxPoints2D = 100; // 100x100 = 10,000 cells

	/**
	 * Derived: Effective chart type based on auto-detection
	 */
	get effectiveChartType(): "line" | "heatmap" {
		if (this.chartType !== "auto") {
			return this.chartType;
		}

		// Auto-detect based on snapshot
		if (!this.snapshot) return "line";

		if (this.snapshot.kind === "table1d") {
			return "line";
		}

		return "heatmap";
	}

	/**
	 * Derived: Layer count for 3D tables
	 */
	get layerCount(): number {
		if (!this.snapshot || this.snapshot.kind !== "table3d") {
			return 0;
		}
		return this.snapshot.depth;
	}

	/**
	 * Derived: Downsampled chart data
	 *
	 * Returns data optimized for rendering based on size thresholds.
	 */
	get chartData(): TableSnapshot | null {
		if (!this.snapshot) return null;

		const snapshot = this.snapshot;

		// 1D table downsampling
		if (snapshot.kind === "table1d") {
			if (shouldDownsample(snapshot.z.length, this.maxPoints1D)) {
				const { indices, values } = downsampleData(
					snapshot.z,
					this.maxPoints1D,
				);

				const x = snapshot.x;
				const downsampledSnapshot: TableSnapshot = {
					...snapshot,
					z: values,
					x: x
						? indices.map((i) => {
								const val = x[i];
								if (val === undefined)
									throw new Error(`Expected x[${i}] to be defined`);
								return val;
							})
						: indices,
				};

				return downsampledSnapshot;
			}
			return snapshot;
		}

		// 3D table: downsample current layer as 2D
		if (snapshot.kind === "table3d") {
			const layer = snapshot.z[this.currentLayer];
			if (!layer) return null;

			const layer2D: TableSnapshot = {
				kind: "table2d",
				name: `${snapshot.name} - Layer ${this.currentLayer}`,
				rows: snapshot.rows,
				cols: snapshot.cols,
				z: layer,
				...(snapshot.x && { x: snapshot.x }),
				...(snapshot.y && { y: snapshot.y }),
				...(snapshot.unit && { unit: snapshot.unit }),
				...(snapshot.xLabel && { xLabel: snapshot.xLabel }),
				...(snapshot.yLabel && { yLabel: snapshot.yLabel }),
				...(snapshot.zLabel && { zLabel: snapshot.zLabel }),
			};

			// Apply 2D downsampling
			if (
				shouldDownsample(layer2D.rows, this.maxPoints2D) ||
				shouldDownsample(layer2D.cols, this.maxPoints2D)
			) {
				const downsampledZ = downsample2D(
					layer2D.z,
					this.maxPoints2D,
					this.maxPoints2D,
				);

				const rowStep = Math.ceil(layer2D.rows / this.maxPoints2D);
				const colStep = Math.ceil(layer2D.cols / this.maxPoints2D);

				const downsampledSnapshot: TableSnapshot = {
					...layer2D,
					rows: downsampledZ.length,
					cols: downsampledZ[0]?.length ?? 0,
					z: downsampledZ,
					...(layer2D.x && {
						x: layer2D.x.filter((_: number, i: number) => i % colStep === 0),
					}),
					...(layer2D.y && {
						y: layer2D.y.filter((_: number, i: number) => i % rowStep === 0),
					}),
				};

				return downsampledSnapshot;
			}

			return layer2D;
		}

		return snapshot;
	}

	/**
	 * Select a cell
	 *
	 * @param row - Row index
	 * @param col - Column index
	 */
	selectCell(row: number, col: number): void {
		this.selectedCell = { row, col };
	}

	/**
	 * Clear cell selection
	 */
	clearSelection(): void {
		this.selectedCell = null;
	}

	/**
	 * Zoom in
	 */
	zoomIn(): void {
		this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel * 1.2);
	}

	/**
	 * Zoom out
	 */
	zoomOut(): void {
		this.zoomLevel = Math.max(this.minZoom, this.zoomLevel / 1.2);
	}

	/**
	 * Set zoom level
	 *
	 * @param level - Zoom level (clamped to min/max)
	 */
	setZoom(level: number): void {
		this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
	}

	/**
	 * Set pan offset
	 *
	 * @param x - X offset
	 * @param y - Y offset
	 */
	setPan(x: number, y: number): void {
		this.panX = x;
		this.panY = y;
	}

	/**
	 * Reset view to default zoom and pan
	 */
	resetView(): void {
		this.zoomLevel = 1;
		this.panX = 0;
		this.panY = 0;
	}

	/**
	 * Set hovered cell
	 *
	 * @param cell - Hovered cell information or null
	 */
	setHoveredCell(cell: HoveredCell | null): void {
		this.hoveredCell = cell;
	}

	/**
	 * Set current layer (for 3D tables)
	 *
	 * @param layer - Layer index
	 */
	setLayer(layer: number): void {
		if (!this.snapshot || this.snapshot.kind !== "table3d") {
			return;
		}

		this.currentLayer = Math.max(0, Math.min(this.snapshot.depth - 1, layer));
	}

	/**
	 * Set chart type
	 *
	 * @param type - Chart type
	 */
	setChartType(type: ChartType): void {
		this.chartType = type;
	}

	/**
	 * Toggle grid visibility
	 */
	toggleGrid(): void {
		this.showGrid = !this.showGrid;
	}

	/**
	 * Set grid visibility
	 *
	 * @param visible - Grid visibility
	 */
	setGridVisibility(visible: boolean): void {
		this.showGrid = visible;
	}

	/**
	 * Check if zoom in is possible
	 */
	get canZoomIn(): boolean {
		return this.zoomLevel < this.maxZoom;
	}

	/**
	 * Check if zoom out is possible
	 */
	get canZoomOut(): boolean {
		return this.zoomLevel > this.minZoom;
	}
}
