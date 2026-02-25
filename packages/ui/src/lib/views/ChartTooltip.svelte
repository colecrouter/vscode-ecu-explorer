<script lang="ts">
	/**
	 * Chart tooltip component
	 *
	 * Displays hover information for chart cells including:
	 * - X/Y axis values with labels
	 * - Z value (data value) with formatting
	 * - Cell coordinates
	 * - Smooth fade in/out transitions
	 *
	 * @component
	 * @example
	 * ```svelte
	 * <ChartTooltip {hoveredCell} {snapshot} {mousePosition} />
	 * ```
	 */

	import type { HoveredCell, TableSnapshot } from "./chart-state.svelte.js";

	/**
	 * Component props
	 * @property {HoveredCell | null} hoveredCell - Currently hovered cell data
	 * @property {TableSnapshot | null} snapshot - Table snapshot for labels and units
	 * @property {{ x: number; y: number }} [mousePosition] - Mouse position for tooltip placement
	 */
	interface Props {
		hoveredCell: HoveredCell | null;
		snapshot: TableSnapshot | null;
		mousePosition?: { x: number; y: number };
	}

	let { hoveredCell, snapshot, mousePosition }: Props = $props();

	// Tooltip visibility and position
	const visible = $derived(hoveredCell !== null && snapshot !== null);
	const tooltipX = $derived(mousePosition?.x ?? 0);
	const tooltipY = $derived(mousePosition?.y ?? 0);

	// Format value with appropriate precision
	function formatValue(value: number, precision: number = 2): string {
		if (Number.isNaN(value)) return "N/A";
		if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";

		// Use fixed precision for small numbers, exponential for very large/small
		if (Math.abs(value) < 0.001 || Math.abs(value) > 1e6) {
			return value.toExponential(precision);
		}

		return value.toFixed(precision);
	}

	// Get axis labels
	const xLabel = $derived(snapshot?.xLabel ?? "X");
	const yLabel = $derived.by(() => {
		if (!snapshot) return "Y";
		if (snapshot.kind === "table1d") return "Y";
		return snapshot.yLabel ?? "Y";
	});
	const zLabel = $derived(snapshot?.zLabel ?? "Value");
	const unit = $derived(snapshot?.unit ?? "");

	// Format tooltip content
	const xValue = $derived.by(() => {
		if (!hoveredCell) return null;
		if (hoveredCell.xValue !== undefined) {
			return formatValue(hoveredCell.xValue);
		}
		return hoveredCell.col.toString();
	});

	const yValue = $derived.by(() => {
		if (!hoveredCell) return null;
		if (hoveredCell.yValue !== undefined) {
			return formatValue(hoveredCell.yValue);
		}
		return hoveredCell.row.toString();
	});

	const zValue = $derived.by(() => {
		if (!hoveredCell) return null;
		return formatValue(hoveredCell.value);
	});

	// Position tooltip to avoid going off-screen
	const tooltipStyle = $derived.by(() => {
		if (!visible) return "display: none;";

		// Offset from cursor to avoid blocking view
		const offsetX = 15;
		const offsetY = 15;

		// Calculate position (will be adjusted by CSS if needed)
		const left = tooltipX + offsetX;
		const top = tooltipY + offsetY;

		return `left: ${left}px; top: ${top}px;`;
	});
</script>

{#if visible && hoveredCell}
	<div
		class="chart-tooltip"
		style={tooltipStyle}
		role="tooltip"
		aria-live="polite"
	>
		<div class="tooltip-content">
			<!-- X axis value -->
			{#if snapshot && snapshot.kind !== "table1d"}
				<div class="tooltip-row">
					<span class="tooltip-label">{xLabel}:</span>
					<span class="tooltip-value">{xValue}</span>
				</div>
			{/if}

			<!-- Y axis value (for 2D/3D tables) -->
			{#if snapshot && (snapshot.kind === "table2d" || snapshot.kind === "table3d")}
				<div class="tooltip-row">
					<span class="tooltip-label">{yLabel}:</span>
					<span class="tooltip-value">{yValue}</span>
				</div>
			{/if}

			<!-- Z value (data value) -->
			<div class="tooltip-row tooltip-row-primary">
				<span class="tooltip-label">{zLabel}:</span>
				<span class="tooltip-value">
					{zValue}
					{#if unit}
						<span class="tooltip-unit">{unit}</span>
					{/if}
				</span>
			</div>

			<!-- Cell coordinates -->
			<div class="tooltip-row tooltip-row-secondary">
				<span class="tooltip-label">Cell:</span>
				<span class="tooltip-value">
					{#if snapshot && snapshot.kind === "table1d"}
						({hoveredCell.col})
					{:else}
						({hoveredCell.row}, {hoveredCell.col})
					{/if}
				</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.chart-tooltip {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		animation: fadeIn 0.15s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.tooltip-content {
		background: var(--vscode-editorHoverWidget-background);
		border: 1px solid var(--vscode-editorHoverWidget-border);
		border-radius: 4px;
		padding: 0.5rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		min-width: 150px;
		max-width: 300px;
	}

	.tooltip-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.25rem 0;
		font-size: 12px;
		line-height: 1.4;
	}

	.tooltip-row:not(:last-child) {
		border-bottom: 1px solid var(--vscode-editorHoverWidget-border);
	}

	.tooltip-row-primary {
		font-weight: 600;
		color: var(--vscode-editorHoverWidget-foreground);
	}

	.tooltip-row-secondary {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
	}

	.tooltip-label {
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
	}

	.tooltip-value {
		color: var(--vscode-editorHoverWidget-foreground);
		font-family: var(--vscode-editor-fontFamily);
		text-align: right;
		white-space: nowrap;
	}

	.tooltip-unit {
		margin-left: 0.25rem;
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
	}

	/* Ensure tooltip stays on screen */
	.chart-tooltip {
		max-width: calc(100vw - 20px);
	}

	/* Adjust position if too close to edges */
	@media (max-width: 768px) {
		.tooltip-content {
			font-size: 11px;
			padding: 0.375rem;
			min-width: 120px;
		}

		.tooltip-row {
			font-size: 11px;
		}

		.tooltip-row-secondary {
			font-size: 10px;
		}
	}
</style>
