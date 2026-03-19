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

	import { Chart } from "@ecu-explorer/ui";
	import { onMount } from "svelte";
	import {
		GraphSessionController,
		type GraphHostMessage,
		type PersistedGraphPanelState,
	} from "./graph-session-controller.svelte.js";

	// VSCode API
	let vscode: ReturnType<typeof acquireVsCodeApi>;
	try {
		vscode = acquireVsCodeApi();
	} catch (error) {
		console.error("[ChartViewerApp] Failed to acquire VSCode API:", error);
		throw error;
	}

	const persistedState = vscode.getState() as
		| PersistedGraphPanelState
		| undefined;
	const controller = new GraphSessionController(vscode, persistedState);
	const chartState = controller.chartState;
	let viewModel = $state(controller.getViewModel());

	$effect(() => {
		chartState.snapshot = viewModel.snapshot;
	});

	$effect(() => {
		controller.syncSelectionChange();
	});

	$effect(() => {
		controller.persistState();
	});

	/**
	 * Handle messages from extension host
	 */
	function handleMessage(event: MessageEvent) {
		const message = event.data;
		if (!message || typeof message !== "object") return;
		controller.handleHostMessage(message as GraphHostMessage);
		viewModel = controller.getViewModel();
	}

	/**
	 * Handle cell selection in chart - send to extension host
	 */
	function handleCellSelect(row: number, col: number) {
		controller.handleChartCellSelect(row, col);
	}

	// Lifecycle
	onMount(() => {
		window.addEventListener("message", handleMessage);

		controller.signalReady();

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	});
</script>

<div class="chart-viewer">
	<header class="chart-header">
		<div class="chart-title">
			<div class="toolbar">
				<!-- Future toolbar buttons can go here -->
				<h2>{viewModel.tableName}</h2>
				{#if viewModel.romPath}
					<span class="rom-path">{viewModel.romPath}</span>
				{/if}
			</div>
		</div>
	</header>

	<div class="chart-content">
		{#if !viewModel.isReady}
			<div class="loading">
				<div class="spinner"></div>
				<p>Loading chart...</p>
			</div>
		{:else if !viewModel.hasData}
			<div class="no-data">
				<p>No data available</p>
			</div>
		{:else}
			<Chart
				{chartState}
				themeColors={viewModel.themeColors}
				onCellSelect={handleCellSelect}
			/>
		{/if}
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--vscode-panel-border);
	}

	.toolbar h2 {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 600;
	}

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

	.chart-title {
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
