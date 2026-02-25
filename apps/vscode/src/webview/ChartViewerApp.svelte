<script module lang="ts">
	// VSCode API for webview messaging
	declare const acquireVsCodeApi: () => {
		postMessage: (message: unknown) => void;
		getState: () => unknown;
		setState: (state: unknown) => void;
	};
</script>

<script lang="ts">
	/**
	 * ChartViewerApp - Standalone chart viewer for separate graph windows
	 *
	 * This component is a standalone Svelte application that displays graphs
	 * in separate VSCode webview panels. It reuses existing Chart.svelte,
	 * ChartControls.svelte, and ChartState components.
	 *
	 * Message Protocol:
	 * - Receives: init, update, selectCell
	 * - Sends: ready, cellSelect
	 */

	import { Chart, ChartState } from "@ecu-explorer/ui";
	import type { TableSnapshot, ThemeColors } from "@ecu-explorer/ui";
	import { onMount } from "svelte";

	// VSCode API
	let vscode: ReturnType<typeof acquireVsCodeApi>;
	try {
		vscode = acquireVsCodeApi();
	} catch (error) {
		console.error("[ChartViewerApp] Failed to acquire VSCode API:", error);
		throw error;
	}

	// State
	let chartState = new ChartState();
	let snapshot = $state<TableSnapshot | null>(null);
	let tableName = $state("");
	let romPath = $state("");
	let isReady = $state(false);
	let themeColors = $state<ThemeColors | undefined>(undefined);

	// Sync chartState with snapshot reactively
	$effect(() => {
		if (snapshot) {
			chartState.snapshot = snapshot;
		}
	});

	// Derived state
	const hasData = $derived(snapshot !== null);

	// Watch for selection changes in chartState
	$effect(() => {
		if (chartState.selectedCell) {
			vscode.postMessage({
				type: "selectionChange",
				selection: [chartState.selectedCell],
			});
		}
	});

	/**
	 * Handle messages from extension host
	 */
	function handleMessage(event: MessageEvent) {
		const message = event.data;
		if (!message || typeof message !== "object") return;

		switch (message.type) {
			case "init":
				handleInit(message);
				break;
			case "update":
				handleUpdate(message);
				break;
			case "selectCell":
				handleSelectCell(message);
				break;
			case "selectCells":
				handleSelectCells(message);
				break;
			case "themeChanged":
				handleThemeChanged(message);
				break;
		}
	}

	function handleSelectCells(message: {
		type: "selectCells";
		selection: { row: number; col: number; depth?: number }[];
	}) {
		if (message.selection && message.selection.length > 0) {
			const first = message.selection[0];
			if (first) {
				chartState.selectCell(first.row, first.col);
			}
		}
	}

	/**
	 * Handle init message - initial table snapshot
	 */
	function handleInit(message: {
		type: "init";
		snapshot: TableSnapshot;
		tableName: string;
		romPath: string;
		preferredChartType?: "line" | "heatmap";
		themeColors?: ThemeColors;
	}) {
		snapshot = message.snapshot;
		tableName = message.tableName;
		romPath = message.romPath;

		if (message.preferredChartType) {
			chartState.setChartType(message.preferredChartType);
		}

		// Extract theme colors if provided
		if (message.themeColors) {
			themeColors = message.themeColors;
		}

		isReady = true;
	}

	/**
	 * Handle theme change message
	 */
	function handleThemeChanged(message: {
		type: "themeChanged";
		themeColors: ThemeColors;
	}) {
		if (message.themeColors) {
			themeColors = message.themeColors;
		}
	}

	/**
	 * Handle update message - updated table snapshot after edits
	 */
	function handleUpdate(message: {
		type: "update";
		snapshot: TableSnapshot;
		preferredChartType?: "line" | "heatmap";
	}) {
		snapshot = message.snapshot;
		if (message.preferredChartType) {
			chartState.setChartType(message.preferredChartType);
		}
	}

	/**
	 * Handle selectCell message - highlight cell in chart
	 */
	function handleSelectCell(message: {
		type: "selectCell";
		row: number;
		col: number;
	}) {
		chartState.selectCell(message.row, message.col);
	}

	/**
	 * Handle cell selection in chart - send to extension host
	 */
	function handleCellSelect(row: number, col: number) {
		vscode.postMessage({
			type: "cellSelect",
			row,
			col,
		});
	}

	// Lifecycle
	onMount(() => {
		window.addEventListener("message", handleMessage);

		// Signal readiness to extension host
		vscode.postMessage({ type: "ready" });

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	});
</script>

<div class="chart-viewer">
	<header class="chart-header">
		<div class="chart-title">
			<h1>{tableName || "Graph Viewer"}</h1>
			{#if romPath}
				<span class="rom-path">{romPath}</span>
			{/if}
		</div>
	</header>

	<div class="chart-content">
		{#if !isReady}
			<div class="loading">
				<div class="spinner"></div>
				<p>Loading chart...</p>
			</div>
		{:else if !hasData}
			<div class="no-data">
				<p>No data available</p>
			</div>
		{:else}
			<Chart {chartState} {themeColors} onCellSelect={handleCellSelect} />
		{/if}
	</div>
</div>

<style>
	.chart-viewer {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		overflow: hidden;
		background-color: var(--vscode-editor-background);
		color: var(--vscode-editor-foreground);
	}

	.chart-header {
		padding: 12px 16px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background-color: var(--vscode-editor-background);
	}

	.chart-title {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.chart-title h1 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--vscode-editor-foreground);
	}

	.rom-path {
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
		font-family: var(--vscode-editor-fontFamily);
	}

	.chart-content {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.loading,
	.no-data {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 16px;
	}

	.loading p,
	.no-data p {
		margin: 0;
		font-size: 14px;
		color: var(--vscode-descriptionForeground);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--vscode-panel-border);
		border-top-color: var(--vscode-progressBar-background);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
