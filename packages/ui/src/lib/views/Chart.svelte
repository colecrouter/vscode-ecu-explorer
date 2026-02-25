<script lang="ts">
	/**
	 * Chart component for visualizing table data
	 *
	 * Renders interactive charts using Plotly.js with support for:
	 * - 1D line plots
	 * - 2D heatmaps
	 * - 3D tables (rendered as 2D layers)
	 * - Lazy loading of Plotly.js
	 * - Canvas rendering for performance
	 * - Cell selection on click
	 * - Zoom and pan interactions
	 * - Keyboard navigation
	 * - Hover tooltips
	 *
	 * @component

	 */

	import { onMount, onDestroy } from "svelte";
	import type { ChartState, HoveredCell } from "./chart-state.svelte";
	import type { ThemeColors } from "./colorMap";
	import { debounce } from "./chartUtils";
	import ChartTooltip from "./ChartTooltip.svelte";

	/**
	 * Component props
	 * @typedef {Object} Props
	 * @property {ChartState} chartState - Chart state manager instance
	 * @property {ThemeColors} [themeColors] - Optional theme colors for gradient
	 * @property {(row: number, col: number) => void} [onCellSelect] - Optional callback when cell is clicked
	 */
	interface Props {
		chartState: ChartState;
		themeColors?: ThemeColors | undefined;
		onCellSelect?: ((row: number, col: number) => void) | undefined;
	}

	let { chartState, themeColors, onCellSelect }: Props = $props();

	// Derived state from chartState
	let snapshot = $derived(chartState.chartData);
	let chartType = $derived(chartState.effectiveChartType);
	let showGrid = $derived(chartState.showGrid);
	let hoveredCell = $derived(chartState.hoveredCell);
	let panX = $derived(chartState.panX);
	let panY = $derived(chartState.panY);

	// Plotly.js types (minimal)
	interface PlotlyHTMLElement extends HTMLDivElement {
		data?: unknown[];
		on?: (event: string, callback: (data: any) => void) => void;
	}

	// State
	let plotDiv = $state<PlotlyHTMLElement | null>(null);
	let containerDiv = $state<HTMLDivElement | null>(null);
	let plotly = $state<typeof import("plotly.js-dist-min") | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let mousePosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	/**
	 * Resolves a CSS variable string to its computed color value at runtime.
	 *
	 * Handles strings of the form `var(--some-variable)` by extracting the
	 * variable name and reading it from `document.body` via
	 * `getComputedStyle`. VSCode injects its theme CSS variables on the `body`
	 * element, not on `:root`/`html`. Falls back to the original string if
	 * resolution fails or the environment does not support `getComputedStyle`
	 * (e.g. tests without a DOM).
	 *
	 * @param color - A color string, possibly a CSS variable reference
	 * @returns The resolved color value, or the original string as a fallback
	 */
	function resolveCssColor(color: string): string {
		const match = color.match(/^var\((--[^)]+)\)$/);
		if (!match) {
			return color;
		}
		try {
			const varName = match[1] ?? "";
			const resolved =
				typeof document !== "undefined"
					? getComputedStyle(document.body).getPropertyValue(varName).trim()
					: "";
			return resolved || color;
		} catch {
			return color;
		}
	}

	/**
	 * Lazy load Plotly.js
	 */
	async function loadPlotly() {
		try {
			const { default: plotlyModule } = await import("plotly.js-dist-min");
			return plotlyModule;
		} catch (err) {
			console.error("[Chart] Failed to load Plotly.js:", err);
			console.error("[Chart] Error details:", {
				message: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			});
			error = "Failed to load chart library";
			return null;
		}
	}

	/**
	 * Build Plotly data for 1D line plot
	 * For 2D data, flattens to show first row as a line
	 */
	function buildLineData(snap: any) {
		// Handle 1D data
		if (snap.kind === "table1d") {
			return [
				{
					x: snap.x || Array.from({ length: snap.z.length }, (_, i) => i),
					y: snap.z,
					type: "scatter",
					mode: "lines+markers",
					name: snap.name,
					marker: { size: 6 },
					line: { width: 2 },
				},
			];
		}

		// Handle 2D data - show first row as line
		if (snap.kind === "table2d") {
			const firstRow = snap.z[0] || [];
			return [
				{
					x: snap.x || Array.from({ length: firstRow.length }, (_, i) => i),
					y: firstRow,
					type: "scatter",
					mode: "lines+markers",
					name: `${snap.name} (Row 0)`,
					marker: { size: 6 },
					line: { width: 2 },
				},
			];
		}

		// Fallback for unknown types
		return [];
	}

	/**
	 * Convert theme colors to Plotly colorscale format
	 * Plotly colorscale is an array of [position, color] tuples
	 * @returns Plotly colorscale array or "Viridis" as fallback
	 */
	function getColorscale(): string | [number, string][] {
		if (!themeColors?.gradient) {
			return "Viridis";
		}

		// Convert theme colors to Plotly format: [[0, color], [0.5, color], [1, color]]
		// Resolve CSS variables to actual color values at render time
		return [
			[0, resolveCssColor(themeColors.gradient.low)],
			[0.5, resolveCssColor(themeColors.gradient.mid)],
			[1, resolveCssColor(themeColors.gradient.high)],
		];
	}

	/**
	 * Build Plotly data for 2D heatmap or 3D surface
	 * For 1D data, converts to a single-row heatmap
	 */
	function buildHeatmapData(snap: any) {
		const colorscale = getColorscale();

		// Handle 2D data
		if (snap.kind === "table2d") {
			// If 3D graph is requested, use surface plot
			if (chartType === "heatmap") {
				return [
					{
						x: snap.x || Array.from({ length: snap.cols }, (_, i) => i),
						y: snap.y || Array.from({ length: snap.rows }, (_, i) => i),
						z: snap.z,
						type: "surface",
						colorscale,
						colorbar: {
							title: snap.zLabel || "Value",
							titleside: "right",
						},
					},
				];
			}

			// Fallback to heatmap if specifically requested (though currently effectiveChartType handles this)
			return [
				{
					x: snap.x || Array.from({ length: snap.cols }, (_, i) => i),
					y: snap.y || Array.from({ length: snap.rows }, (_, i) => i),
					z: snap.z,
					type: "heatmap",
					colorscale,
					colorbar: {
						title: snap.zLabel || "Value",
						titleside: "right",
					},
				},
			];
		}

		// Handle 1D data - convert to single-row heatmap
		if (snap.kind === "table1d") {
			return [
				{
					x: snap.x || Array.from({ length: snap.z.length }, (_, i) => i),
					y: [0], // Single row
					z: [snap.z], // Wrap in array to make it 2D
					type: "heatmap",
					colorscale,
					colorbar: {
						title: snap.zLabel || "Value",
						titleside: "right",
					},
				},
			];
		}

		// Fallback for unknown types
		return [];
	}

	/**
	 * Build Plotly layout
	 * @param snap - Chart data snapshot
	 * @param effectiveType - The effective chart type being rendered
	 */
	function buildLayout(snap: any, effectiveType: string) {
		// Extract theme colors with fallbacks, resolving CSS variables to actual values
		const bgColor = resolveCssColor(
			themeColors?.ui?.background || "transparent",
		);
		const fgColor = resolveCssColor(themeColors?.ui?.foreground || "#333");
		const gridColor = resolveCssColor(themeColors?.ui?.border || "#e0e0e0");

		const baseLayout = {
			title: snap.name,
			autosize: true,
			margin: { l: 60, r: 60, t: 60, b: 60 },
			hovermode: "closest",
			paper_bgcolor: bgColor,
			plot_bgcolor: bgColor,
			font: { color: fgColor },
		};

		// For line charts, always use line chart layout
		if (effectiveType === "line") {
			return {
				...baseLayout,
				xaxis: {
					title: snap.xLabel || "X",
					showgrid: showGrid,
					gridcolor: gridColor,
					linecolor: gridColor,
					titlefont: { color: fgColor },
					tickfont: { color: fgColor },
					zerolinecolor: gridColor,
				},
				yaxis: {
					title: snap.zLabel || "Value",
					showgrid: showGrid,
					gridcolor: gridColor,
					linecolor: gridColor,
					titlefont: { color: fgColor },
					tickfont: { color: fgColor },
					zerolinecolor: gridColor,
				},
			};
		}

		// For heatmaps/surface, use appropriate layout
		if (effectiveType === "heatmap") {
			// 3D Surface layout
			if (snap.kind === "table2d") {
				return {
					...baseLayout,
					scene: {
						xaxis: {
							title: snap.xLabel || "X",
							gridcolor: gridColor,
							titlefont: { color: fgColor },
							tickfont: { color: fgColor },
						},
						yaxis: {
							title: snap.yLabel || "Y",
							gridcolor: gridColor,
							titlefont: { color: fgColor },
							tickfont: { color: fgColor },
						},
						zaxis: {
							title: snap.zLabel || "Value",
							gridcolor: gridColor,
							titlefont: { color: fgColor },
							tickfont: { color: fgColor },
						},
						bgcolor: bgColor,
					},
				};
			}

			// 2D Heatmap layout (for 1D data fallback)
			return {
				...baseLayout,
				xaxis: {
					title: snap.xLabel || "X",
					showgrid: showGrid,
					gridcolor: gridColor,
					linecolor: gridColor,
					titlefont: { color: fgColor },
					tickfont: { color: fgColor },
					zerolinecolor: gridColor,
				},
				yaxis: {
					title: snap.yLabel || (snap.kind === "table1d" ? "Row" : "Y"),
					showgrid: showGrid,
					gridcolor: gridColor,
					linecolor: gridColor,
					titlefont: { color: fgColor },
					tickfont: { color: fgColor },
					zerolinecolor: gridColor,
				},
			};
		}

		return baseLayout;
	}

	/**
	 * Build Plotly config
	 */
	function buildConfig() {
		return {
			responsive: true,
			displayModeBar: false,
			displaylogo: false,
			scrollZoom: true,
		};
	}

	/**
	 * Render chart
	 */
	async function renderChart() {
		if (!plotDiv || !plotly || !snapshot) {
			return;
		}

		try {
			let data = [];

			// Determine chart type based on user selection or auto-detect
			let effectiveType: "line" | "heatmap" = chartType;

			// Build chart data based on effective type
			if (effectiveType === "line") {
				data = buildLineData(snapshot);
			} else if (effectiveType === "heatmap") {
				data = buildHeatmapData(snapshot);
			} else {
				console.error("[Chart] Unsupported chart type:", effectiveType);
				error = "Unsupported chart type";
				return;
			}

			const layout = buildLayout(snapshot, effectiveType);
			const config = buildConfig();

			// Use react for updates, newPlot for initial render
			const hasExistingPlot = !!plotDiv.data;

			if (hasExistingPlot) {
				await plotly.react(plotDiv, data as any, layout as any, config);
			} else {
				await plotly.newPlot(plotDiv, data as any, layout as any, config);
			}

			// Attach click handler
			plotDiv.on?.("plotly_click", (eventData: any) => {
				const point = eventData.points?.[0];
				if (point && onCellSelect) {
					// For heatmap/surface, x/y are indices
					// For line plot, x is index, y is value
					const col = typeof point.x === "number" ? Math.round(point.x) : 0;
					const row = typeof point.y === "number" ? Math.round(point.y) : 0;
					onCellSelect(row, col);
				}
			});

			// Attach hover handler
			plotDiv.on?.("plotly_hover", (eventData: any) => {
				const point = eventData.points?.[0];
				if (point) {
					const col = typeof point.x === "number" ? Math.round(point.x) : 0;
					const row = typeof point.y === "number" ? Math.round(point.y) : 0;
					const value =
						typeof point.z === "number"
							? point.z
							: typeof point.y === "number"
								? point.y
								: 0;

					// Get axis values if available
					let xValue: number | undefined;
					let yValue: number | undefined;

					if (snapshot.kind === "table1d") {
						xValue = snapshot.x?.[col];
					} else if (snapshot.kind === "table2d") {
						xValue = snapshot.x?.[col];
						yValue = snapshot.y?.[row];
					}

					const cell: HoveredCell = {
						row,
						col,
						value,
						...(xValue !== undefined && { xValue }),
						...(yValue !== undefined && { yValue }),
					};

					chartState.setHoveredCell(cell);
				}
			});

			plotDiv.on?.("plotly_unhover", () => {
				chartState.setHoveredCell(null);
			});

			isLoading = false;
		} catch (err) {
			console.error("[Chart] Failed to render chart:", err);
			console.error("[Chart] Render error details:", {
				message: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			});
			error = "Failed to render chart";
			isLoading = false;
		}
	}

	// Debounced render for performance
	const debouncedRender = debounce(renderChart, 100);

	// Initialize Plotly on mount
	onMount(async () => {
		plotly = await loadPlotly();

		if (!plotly) {
			isLoading = false;
		}
		// Note: We don't render here because plotDiv might not be bound yet
		// The effect below will handle rendering once plotDiv is available
	});

	// Render when plotDiv becomes available and when dependencies change
	$effect(() => {
		// Access reactive dependencies - must read them to track them
		// We use these to trigger the effect when they change
		void plotDiv;
		void plotly;
		void snapshot;
		void chartType;
		void showGrid;
		void isLoading;

		// Initial render when all dependencies are ready
		if (plotly && plotDiv && snapshot && isLoading) {
			renderChart();
		} else if (plotly && plotDiv && snapshot && !isLoading) {
			// Subsequent re-renders for data/config changes only
			debouncedRender();
		}
	});

	// Mouse move handler for hover
	function handleMouseMove(event: MouseEvent) {
		// Update mouse position for tooltip
		mousePosition = { x: event.clientX, y: event.clientY };
	}

	// Keyboard handler
	function handleKeyDown(event: KeyboardEvent) {
		// Only handle if chart container is focused
		if (!containerDiv?.contains(document.activeElement)) return;

		switch (event.key) {
			case "+":
			case "=":
				event.preventDefault();
				chartState.zoomIn();
				break;
			case "-":
			case "_":
				event.preventDefault();
				chartState.zoomOut();
				break;
			case "r":
			case "R":
				event.preventDefault();
				chartState.resetView();
				break;
			case "ArrowUp":
				event.preventDefault();
				chartState.setPan(panX, panY - 20);
				break;
			case "ArrowDown":
				event.preventDefault();
				chartState.setPan(panX, panY + 20);
				break;
			case "ArrowLeft":
				event.preventDefault();
				chartState.setPan(panX - 20, panY);
				break;
			case "ArrowRight":
				event.preventDefault();
				chartState.setPan(panX + 20, panY);
				break;
		}
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (plotDiv && plotly) {
			plotly.purge(plotDiv);
		}
	});
</script>

<svelte:window onmousemove={handleMouseMove} onkeydown={handleKeyDown} />

<div
	class="chart-wrapper"
	bind:this={containerDiv}
	role="application"
	aria-label="Chart visualization"
>
	<div class="chart-container">
		{#if isLoading}
			<div class="loading">
				<div class="spinner"></div>
				<p>Loading chart...</p>
			</div>
		{/if}
		{#if error}
			<div class="error">
				<p>{error}</p>
			</div>
		{/if}
		<!-- Always render plotDiv so it can be bound, but hide it when loading/error -->
		<div
			class="plot"
			bind:this={plotDiv}
			style:display={isLoading || error ? "none" : "block"}
		></div>
	</div>

	<ChartTooltip {hoveredCell} snapshot={chartState.snapshot} {mousePosition} />
</div>

<style>
	.chart-wrapper {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--vscode-editor-background);
		color: var(--vscode-editor-foreground);
	}

	.chart-wrapper:focus {
		outline: none;
	}

	.chart-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		border: none;
		background: transparent;
		padding: 0;
		width: 100%;
	}

	.plot {
		width: 100%;
		height: 100%;
	}

	.loading,
	.error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid var(--vscode-editor-foreground);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error {
		color: var(--vscode-errorForeground);
	}

	.error p {
		margin: 0;
	}

	.loading p {
		margin: 0;
		color: var(--vscode-descriptionForeground);
	}
</style>
