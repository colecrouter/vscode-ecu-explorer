<script lang="ts">
	import type { TableDefinition } from "@ecu-explorer/core";
	import TableCell from "./TableCell.svelte";
	import type { TableView } from "./table.svelte";
	import { computeNormalizedValues } from "./colorMap";
	import type { ThemeColors } from "./colorMap";
	import { loadAxisValues, formatAxisValue } from "./table";
	import { onMount, onDestroy } from "svelte";

	interface Props {
		view: TableView<TableDefinition>;
		definition: TableDefinition;
		themeColors?: ThemeColors;
		disabled?: boolean;
	}

	let { view, definition, themeColors, disabled = false }: Props = $props();

	let activeDepth = $state(0);

	// Root element reference for ownership check
	let gridRoot: HTMLElement | undefined = $state(undefined);

	// Selection state for drag operations
	let isMouseDown = $state(false);
	let dragStartCell: { row: number; col: number } | null = $state(null);

	// Load axis values
	const xAxisValues = $derived.by(() => {
		if (
			definition.kind === "table1d" ||
			definition.kind === "table2d" ||
			definition.kind === "table3d"
		) {
			return loadAxisValues(definition.x, view.romData);
		}
		return null;
	});

	const yAxisValues = $derived.by(() => {
		if (definition.kind === "table2d" || definition.kind === "table3d") {
			return loadAxisValues(definition.y, view.romData);
		}
		return null;
	});

	const maxDepth = $derived(
		definition.kind === "table3d" ? definition.depth : 1,
	);
	const effectiveDepth = $derived(
		Math.min(activeDepth, Math.max(0, maxDepth - 1)),
	);

	const matrix = $derived.by(() => {
		if (definition.kind === "table3d") {
			return (view.data as Uint8Array[][][])[effectiveDepth];
		}

		if (definition.kind === "table2d") {
			return view.data as Uint8Array[][];
		}

		// For 1D tables, transpose to display as 1 row × N columns
		const rows = view.data as Uint8Array[];
		return [rows];
	});

	const depthOptions = $derived.by(() =>
		Array.from({ length: maxDepth }, (_, index) => index),
	);

	function handleCommit(
		rowIndex: number,
		colIndex: number,
		payload: CustomEvent<{ bytes: Uint8Array }>,
	): void {
		const next = payload.detail.bytes;

		if (definition.kind === "table3d") {
			view.stageCell(
				{ row: rowIndex, col: colIndex, depth: effectiveDepth },
				next,
			);
			return;
		}

		if (definition.kind === "table2d") {
			view.stageCell({ row: rowIndex, col: colIndex }, next);
			return;
		}

		// For 1D tables displayed as a single row, colIndex is the actual cell position.
		// stageCell for table1d uses `location.col ?? location.row`, so pass row: colIndex.
		view.stageCell({ row: colIndex }, next);
	}

	const dtypeLookup = $derived(definition.z.dtype);
	const endiannessLookup = $derived(definition.z.endianness ?? "le");
	const scaleLookup = $derived(definition.z.scale ?? 1);
	const offsetLookup = $derived(definition.z.offset ?? 0);

	// Compute normalized values (0-1) for CSS --t custom property
	const normalizedMap = $derived.by(() => {
		if (!matrix || matrix.length === 0)
			return { values: new Map(), min: 0, max: 0, range: 0 };

		return computeNormalizedValues(
			matrix,
			dtypeLookup,
			endiannessLookup,
			scaleLookup,
			offsetLookup,
		);
	});

	function getCellT(rowIndex: number, colIndex: number): number | undefined {
		const key = `${rowIndex}-${colIndex}`;
		return normalizedMap.values.get(key);
	}

	// CSS variables for gradient colors from theme, set on the table container
	const gradientCssVars = $derived.by(() => {
		if (!themeColors?.gradient) return "";
		const { low, mid, high } = themeColors.gradient;
		return `--gradient-low: ${low}; --gradient-mid: ${mid}; --gradient-high: ${high};`;
	});

	/**
	 * Builds the inline style string for a table cell.
	 * Sets --t (normalized value) and applies color-mix() background.
	 * Using inline style avoids Svelte's CSS parser limitations with nested color-mix().
	 *
	 * 3-stop gradient formula:
	 *   lower half (t: 0→0.5): color-mix(low, mid) with t*2 as the mix ratio
	 *   upper half (t: 0.5→1): color-mix(mid, high) with (t-0.5)*2 as the mix ratio
	 */
	function getCellStyle(rowIndex: number, colIndex: number): string {
		const t = getCellT(rowIndex, colIndex);
		if (t === undefined) return "";
		return (
			`--t: ${t}; ` +
			`background-color: color-mix(in srgb, ` +
			`color-mix(in srgb, var(--gradient-low) calc(clamp(0%, (0.5 - var(--t)) * 200%, 100%)), var(--gradient-mid)), ` +
			`var(--gradient-high) calc(clamp(0%, (var(--t) - 0.5) * 200%, 100%)));` +
			`transition: background-color 0.2s ease;`
		);
	}

	// Mouse interaction handlers for selection
	function handleCellMouseDown(row: number, col: number, event: MouseEvent) {
		if (disabled) return;

		if (event.shiftKey && view.anchor) {
			// Shift+click: extend selection (prevent default to avoid text selection)
			event.preventDefault();
			view.selectCell({ row, col, depth: effectiveDepth }, "range");
		} else if (event.ctrlKey || event.metaKey) {
			// Ctrl/Cmd+click: toggle selection (prevent default to avoid text selection)
			event.preventDefault();
			view.selectCell({ row, col, depth: effectiveDepth }, "add");
		} else {
			// Normal click: select cell and allow editing
			// Don't prevent default - let the click reach the input element
			view.selectCell({ row, col, depth: effectiveDepth }, "replace");
			isMouseDown = true;
			dragStartCell = { row, col };
		}
	}

	function handleCellMouseEnter(row: number, col: number, event: MouseEvent) {
		if (isMouseDown && dragStartCell) {
			// Prevent default during drag to avoid text selection
			event.preventDefault();
			view.selectCell({ row, col, depth: effectiveDepth }, "range");
		}
	}

	function handleMouseUp() {
		isMouseDown = false;
		dragStartCell = null;
	}

	// Visual feedback state
	let copyFeedback = $state(false);
	let cutFeedback = $state(false);

	function showCopyFeedback() {
		copyFeedback = true;
		setTimeout(() => (copyFeedback = false), 1000);
	}

	function showCutFeedback() {
		cutFeedback = true;
		setTimeout(() => (cutFeedback = false), 1000);
	}

	/**
	 * Returns true if the given input element is "dirty" (user has started editing).
	 * Relies on the data-dirty attribute set by TableCell when the user types.
	 * Note: we cannot use input.value !== input.defaultValue as a fallback because
	 * Svelte's bind:value sets the DOM property (not the HTML attribute), so
	 * defaultValue is always "" while value reflects the cell's current data.
	 */
	function isInputDirty(input: HTMLInputElement): boolean {
		return input.dataset["dirty"] === "true";
	}

	/**
	 * Navigates to a new cell given current row/col and direction.
	 * Returns true if navigation occurred.
	 */
	function navigateCell(
		row: number,
		col: number,
		key: string,
		shiftKey: boolean,
	): boolean {
		const def = definition;
		const maxRow = def.rows - 1;
		const maxCol =
			def.kind === "table1d"
				? 0
				: (
						def as
							| import("@ecu-explorer/core").Table2DDefinition
							| import("@ecu-explorer/core").Table3DDefinition
					).cols - 1;

		let newRow = row;
		let newCol = col;
		let shouldMove = false;

		switch (key) {
			case "ArrowUp":
				if (row > 0) {
					newRow = row - 1;
					shouldMove = true;
				}
				break;
			case "ArrowDown":
				if (row < maxRow) {
					newRow = row + 1;
					shouldMove = true;
				}
				break;
			case "ArrowLeft":
				if (col > 0) {
					newCol = col - 1;
					shouldMove = true;
				}
				break;
			case "ArrowRight":
				if (col < maxCol) {
					newCol = col + 1;
					shouldMove = true;
				}
				break;
		}

		if (shouldMove) {
			if (shiftKey) {
				view.selectCell(
					{ row: newRow, col: newCol, depth: effectiveDepth },
					"range",
				);
			} else {
				view.selectCell(
					{ row: newRow, col: newCol, depth: effectiveDepth },
					"replace",
				);
			}

			// Focus the input inside the new cell
			const cellElement = gridRoot?.querySelector(
				`[data-cell="${newRow},${newCol}"] input`,
			) as HTMLElement | null;
			cellElement?.focus();
		}

		return shouldMove;
	}

	/**
	 * Document-level capture handler for grid keyboard shortcuts.
	 * Only fires when the active element is a table cell input inside this grid.
	 */
	async function handleDocumentKeyDown(event: KeyboardEvent): Promise<void> {
		if (disabled) return;

		// Only handle events when focus is inside this grid
		if (!gridRoot?.contains(document.activeElement)) return;

		const activeEl = document.activeElement;

		// Only handle events when a table cell input is focused
		if (!(activeEl instanceof HTMLInputElement)) {
			return;
		}

		const td = activeEl.closest("[data-cell]") as HTMLElement | null;
		if (!td) {
			return;
		}

		const dirty = isInputDirty(activeEl);

		// When the input is dirty (user is actively editing), pass all keys through
		if (dirty) return;

		const isCtrlOrMeta = event.ctrlKey || event.metaKey;

		// Arrow key navigation (only when not dirty)
		if (
			event.key === "ArrowUp" ||
			event.key === "ArrowDown" ||
			event.key === "ArrowLeft" ||
			event.key === "ArrowRight"
		) {
			// Determine current cell coordinates from the td's data-cell attribute
			const [rowStr, colStr] = (td.dataset["cell"] ?? "0,0").split(",");
			const row = parseInt(rowStr ?? "0", 10);
			const col = parseInt(colStr ?? "0", 10);

			const moved = navigateCell(row, col, event.key, event.shiftKey);
			if (moved) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		// Ctrl+A — select all cells
		if (isCtrlOrMeta && event.key === "a") {
			event.preventDefault();
			event.stopPropagation();
			view.selectAll();
			return;
		}

		// Ctrl+C — copy selected cells
		if (isCtrlOrMeta && event.key === "c") {
			event.preventDefault();
			event.stopPropagation();
			const tsv = view.getSelectedValuesAsTSV();
			if (tsv) {
				try {
					await navigator.clipboard.writeText(tsv);
					showCopyFeedback();
				} catch (err) {
					console.error("Failed to copy to clipboard:", err);
				}
			}
			return;
		}

		// Ctrl+X — cut selected cells
		if (isCtrlOrMeta && event.key === "x") {
			event.preventDefault();
			event.stopPropagation();
			const tsv = view.getSelectedValuesAsTSV();
			if (tsv) {
				try {
					await navigator.clipboard.writeText(tsv);
					view.clearSelectedCells();
					showCutFeedback();
				} catch (err) {
					console.error("Failed to cut to clipboard:", err);
				}
			}
			return;
		}

		// Ctrl+V — paste from clipboard
		if (isCtrlOrMeta && event.key === "v") {
			event.preventDefault();
			event.stopPropagation();
			try {
				const text = await navigator.clipboard.readText();
				if (!text) return;

				// Determine anchor cell: top-left of current selection
				const selected = view.getSelectedCells();
				if (selected.length === 0) return;

				const anchorRow = Math.min(...selected.map((c) => c.row));
				const anchorCol = Math.min(...selected.map((c) => c.col ?? 0));

				const region = view.pasteFromTSV(
					text,
					anchorRow,
					anchorCol,
					effectiveDepth,
				);

				if (region) {
					// Update selection to cover the pasted region
					view.selectCell(
						{ row: region.minRow, col: region.minCol, depth: effectiveDepth },
						"replace",
					);
					view.selectCell(
						{ row: region.maxRow, col: region.maxCol, depth: effectiveDepth },
						"range",
					);
				}
			} catch (err) {
				console.error("Failed to paste from clipboard:", err);
			}
			return;
		}

		// Escape — clear selection
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			view.clearSelection();
			return;
		}
	}

	onMount(() => {
		document.addEventListener("keydown", handleDocumentKeyDown, true);
	});

	onDestroy(() => {
		document.removeEventListener("keydown", handleDocumentKeyDown, true);
	});
</script>

<svelte:window onmouseup={handleMouseUp} />

{#if copyFeedback}
	<div class="clipboard-feedback">Copied to clipboard</div>
{/if}

{#if cutFeedback}
	<div class="clipboard-feedback">Cut to clipboard</div>
{/if}

<div class="table-wrapper" tabindex="0" role="grid" bind:this={gridRoot}>
	{#if definition.kind === "table3d" && maxDepth > 1}
		<div class="table-grid__controls">
			<label class="table-grid__depth-label">
				<span>Layer</span>
				<select bind:value={activeDepth}>
					{#each depthOptions as depthIndex (depthIndex)}
						<option value={depthIndex}>Layer {depthIndex + 1}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}

	{#if definition.z.unit?.symbol}
		<div class="table-grid__z-unit">
			Unit: {definition.z.unit.symbol}
		</div>
	{/if}

	<table class="table-grid" style={gradientCssVars}>
		{#if xAxisValues && xAxisValues.length > 0}
			<thead>
				<tr>
					<!-- Corner cell for Y axis label space -->
					{#if yAxisValues && yAxisValues.length > 0}
						<th class="table-grid__corner">
							{#if (definition.kind === "table2d" || definition.kind === "table3d") && definition.y?.unit?.symbol}
								<span class="table-grid__unit table-grid__unit--y">
									{definition.y.unit.symbol}
								</span>
							{/if}
							{#if definition.x?.unit?.symbol}
								<span class="table-grid__unit table-grid__unit--x">
									{definition.x.unit.symbol}
								</span>
							{/if}
						</th>
					{/if}
					<!-- X axis headers -->
					{#each xAxisValues as xValue, colIndex (colIndex)}
						<th class="table-grid__axis-header table-grid__axis-header--x">
							{formatAxisValue(xValue)}
						</th>
					{/each}
				</tr>
			</thead>
		{/if}
		<tbody>
			{#each matrix as row, rowIndex (rowIndex)}
				<tr>
					<!-- Y axis header for this row -->
					{#if yAxisValues && yAxisValues.length > rowIndex}
						<th class="table-grid__axis-header table-grid__axis-header--y">
							{formatAxisValue(yAxisValues[rowIndex] ?? 0)}
						</th>
					{/if}
					<!-- Data cells -->
					{#each row as cell, colIndex (`${rowIndex}-${colIndex}`)}
						<td
							style={getCellStyle(rowIndex, colIndex)}
							class:selected={view.isSelected({
								row: rowIndex,
								col: colIndex,
								depth: effectiveDepth,
							})}
							data-cell="{rowIndex},{colIndex}"
							onmousedown={(e) => handleCellMouseDown(rowIndex, colIndex, e)}
							onmouseenter={(e) => handleCellMouseEnter(rowIndex, colIndex, e)}
						>
							<TableCell
								bytes={cell}
								dtype={dtypeLookup}
								{disabled}
								endianness={endiannessLookup}
								scale={scaleLookup}
								offset={offsetLookup}
								on:commit={(event: CustomEvent) =>
									handleCommit(rowIndex, colIndex, event)}
							/>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-wrapper {
		outline: none;
	}

	.table-wrapper:focus {
		outline: none;
	}

	.table-grid {
		width: 100%;
		border-collapse: collapse;
		/* Default gradient colors (fallback when no themeColors provided) */
		--gradient-low: #73c991;
		--gradient-mid: #e2c08d;
		--gradient-high: #f48771;
	}

	.table-grid td {
		padding: 0;
		border: 1px solid var(--vscode-panel-border);
		min-width: 48px;
		height: 32px;

		/* 
			CSS-based text contrast using pure black and white:
			Uses color-mix() to switch between white and black based on gradient position (--t).
			Very steep multiplier (100000000%) creates sharp threshold at t=0.35:
			- t < 0.35: pure white (dark backgrounds - purple, blue, red)
			- t > 0.35: pure black (bright backgrounds - green, yellow)
		*/
		--cell-text-color: color-mix(
			in srgb,
			white clamp(0%, (0.35 - var(--t, 0.5)) * 100000000%, 100%),
			black clamp(0%, (var(--t, 0.5) - 0.35) * 100000000%, 100%)
		);
	}

	.table-grid th {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--vscode-panel-border);
		font-weight: 600;
		text-align: center;
		white-space: nowrap;
	}

	.table-grid__corner {
		background-color: var(--vscode-editor-background);
		border-color: var(--vscode-panel-border);
		min-width: 48px;
		position: relative;
		padding: 0;
	}

	.table-grid__corner::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			to top right,
			transparent calc(50% - 0.5px),
			var(--vscode-panel-border) 50%,
			transparent calc(50% + 0.5px)
		);
		pointer-events: none;
	}

	.table-grid__unit {
		position: absolute;
		font-size: 0.65rem;
		font-weight: normal;
		color: var(--vscode-descriptionForeground);
		opacity: 0.8;
	}

	.table-grid__unit--y {
		bottom: 2px;
		left: 4px;
	}

	.table-grid__unit--x {
		top: 2px;
		right: 4px;
	}

	.table-grid__axis-header {
		background-color: var(--vscode-editor-background);
		color: var(--vscode-editor-foreground);
		border-color: var(--vscode-panel-border);
		font-size: 0.875rem;
	}

	.table-grid__axis-header--x {
		min-width: 48px;
	}

	.table-grid__axis-header--y {
		min-width: 48px;
		text-align: right;
	}

	.table-grid__controls {
		margin-bottom: 0.5rem;
		display: flex;
		justify-content: flex-end;
	}

	.table-grid__depth-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.table-grid__depth-label select {
		font: inherit;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 0.25rem;
	}

	.table-grid__z-unit {
		font-size: 0.75rem;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 0.25rem;
		text-align: right;
	}

	/* Selection styles */
	.table-grid td.selected {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
		position: relative;
		z-index: 1;
	}

	.table-grid td.selected::after {
		content: "";
		position: absolute;
		inset: 0;
		background-color: var(
			--vscode-list-activeSelectionBackground,
			rgba(0, 122, 204, 0.1)
		);
		pointer-events: none;
		z-index: -1;
	}

	.table-grid td.selected :global(input) {
		color: var(--vscode-list-activeSelectionForeground, inherit) !important;
	}

	.table-grid td {
		cursor: pointer;
		user-select: none;
	}

	.table-grid td:focus {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}

	/* Clipboard feedback toast */
	.clipboard-feedback {
		position: fixed;
		bottom: 20px;
		right: 20px;
		padding: 8px 16px;
		background-color: var(--vscode-notifications-background);
		color: var(--vscode-notifications-foreground);
		border: 1px solid var(--vscode-notifications-border);
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		z-index: 1000;
		animation: fadeIn 0.2s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
