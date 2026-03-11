<script lang="ts">
	import type { TableDefinition } from "@ecu-explorer/core";
	import TableCell from "./TableCell.svelte";
	import type { TableView } from "./table.svelte";
	import { computeNormalizedValues } from "./colorMap.js";
	import type { ThemeColors } from "./colorMap.js";
	import { formatAxisValue, formatUnitLabel, loadAxisValues } from "./table.js";
	import { onDestroy, onMount } from "svelte";

	type GridCell = {
		row: number;
		col: number;
		depth: number;
	};

	interface Props {
		view: TableView<TableDefinition>;
		definition: TableDefinition;
		themeColors?: ThemeColors;
		disabled?: boolean;
	}

	let { view, definition, themeColors, disabled = false }: Props = $props();

	let activeDepth = $state(0);
	let gridRoot: HTMLElement | undefined = $state(undefined);
	let isMouseDown = $state(false);
	let dragStartCell: { row: number; col: number } | null = $state(null);
	let activeCell = $state<GridCell>({ row: 0, col: 0, depth: 0 });
	let editingCell = $state<GridCell | null>(null);
	let editSeed = $state<string | undefined>(undefined);

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
	const hasYAxis = $derived((yAxisValues?.length ?? 0) > 0);

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

		const rows = view.data as Uint8Array[];
		return [rows];
	});

	const rowCount = $derived(matrix?.length ?? 0);
	const colCount = $derived(matrix?.[0]?.length ?? 0);

	const depthOptions = $derived.by(() =>
		Array.from({ length: maxDepth }, (_, index) => index),
	);

	const unitSummaries = $derived.by(() => {
		const summaries: Array<{ key: string; label: string; value: string }> = [];

		if (definition.z.unit?.symbol) {
			summaries.push({
				key: "z",
				label: "Value Unit",
				value: formatUnitLabel(definition.z.unit),
			});
		}

		if (definition.x?.unit?.symbol) {
			summaries.push({
				key: "x",
				label: "X Unit",
				value: formatUnitLabel(definition.x.unit),
			});
		}

		if (
			(definition.kind === "table2d" || definition.kind === "table3d") &&
			definition.y?.unit?.symbol
		) {
			summaries.push({
				key: "y",
				label: "Y Unit",
				value: formatUnitLabel(definition.y.unit),
			});
		}

		return summaries;
	});

	$effect(() => {
		const maxRow = Math.max(0, rowCount - 1);
		const maxCol = Math.max(0, colCount - 1);
		if (activeCell.depth !== effectiveDepth) {
			activeCell = {
				row: Math.min(activeCell.row, maxRow),
				col: Math.min(activeCell.col, maxCol),
				depth: effectiveDepth,
			};
			return;
		}

		if (activeCell.row > maxRow || activeCell.col > maxCol) {
			activeCell = {
				row: Math.min(activeCell.row, maxRow),
				col: Math.min(activeCell.col, maxCol),
				depth: effectiveDepth,
			};
		}
	});

	$effect(() => {
		if (editingCell && editingCell.depth !== effectiveDepth) {
			editingCell = null;
			editSeed = undefined;
		}
	});

	function getCellCoord(row: number, col: number): GridCell {
		return { row, col, depth: effectiveDepth };
	}

	function sameCell(
		left: { row: number; col: number; depth?: number } | null,
		right: { row: number; col: number; depth?: number } | null,
	): boolean {
		return (
			left?.row === right?.row &&
			left?.col === right?.col &&
			(left?.depth ?? 0) === (right?.depth ?? 0)
		);
	}

	function isActiveCell(row: number, col: number): boolean {
		return sameCell(activeCell, getCellCoord(row, col));
	}

	function isEditingCell(row: number, col: number): boolean {
		return sameCell(editingCell, getCellCoord(row, col));
	}

	function focusGrid(): void {
		gridRoot?.focus();
	}

	export function focusActiveCell(): void {
		focusGrid();
	}

	function ensureActiveCellSelected(): void {
		view.selectCell(activeCell, "replace");
	}

	function getNextCell(
		row: number,
		col: number,
		direction: "up" | "down" | "left" | "right" | "next" | "prev",
		jumpToEdge = false,
	): GridCell | null {
		const maxRow = rowCount - 1;
		const maxCol = colCount - 1;
		if (maxRow < 0 || maxCol < 0) return null;

		if (jumpToEdge) {
			switch (direction) {
				case "up":
					return getCellCoord(0, col);
				case "down":
					return getCellCoord(maxRow, col);
				case "left":
					return getCellCoord(row, 0);
				case "right":
					return getCellCoord(row, maxCol);
				default:
					return null;
			}
		}

		switch (direction) {
			case "up":
				return row > 0 ? getCellCoord(row - 1, col) : null;
			case "down":
				return row < maxRow ? getCellCoord(row + 1, col) : null;
			case "left":
				return col > 0 ? getCellCoord(row, col - 1) : null;
			case "right":
				return col < maxCol ? getCellCoord(row, col + 1) : null;
			case "next":
				if (col < maxCol) return getCellCoord(row, col + 1);
				if (row < maxRow) return getCellCoord(row + 1, 0);
				return getCellCoord(0, 0);
			case "prev":
				if (col > 0) return getCellCoord(row, col - 1);
				if (row > 0) return getCellCoord(row - 1, maxCol);
				return getCellCoord(maxRow, maxCol);
		}
	}

	function moveActiveCell(
		direction: "up" | "down" | "left" | "right" | "next" | "prev",
		options?: {
			extendSelection?: boolean;
			jumpToEdge?: boolean;
		},
	): boolean {
		const next = getNextCell(
			activeCell.row,
			activeCell.col,
			direction,
			options?.jumpToEdge ?? false,
		);
		if (!next) return false;

		activeCell = next;
		view.selectCell(next, options?.extendSelection ? "range" : "replace");
		return true;
	}

	function enterEditMode(seed?: string): void {
		ensureActiveCellSelected();
		editingCell = activeCell;
		editSeed = seed;
	}

	function exitEditMode(move: "next" | "prev" | null): void {
		editingCell = null;
		editSeed = undefined;
		if (move) {
			moveActiveCell(move);
		} else {
			ensureActiveCellSelected();
		}
		focusGrid();
	}

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

		view.stageCell({ row: 0, col: colIndex }, next);
	}

	const dtypeLookup = $derived(definition.z.dtype);
	const endiannessLookup = $derived(definition.z.endianness ?? "le");
	const scaleLookup = $derived(definition.z.scale ?? 1);
	const offsetLookup = $derived(definition.z.offset ?? 0);
	const transformLookup = $derived(definition.z.transform);
	const inverseTransformLookup = $derived(definition.z.inverseTransform);

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

	const gradientCssVars = $derived.by(() => {
		if (!themeColors?.gradient) return "";
		const { low, mid, high } = themeColors.gradient;
		return `--gradient-low: ${low}; --gradient-mid: ${mid}; --gradient-high: ${high};`;
	});

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

	function handleCellMouseDown(row: number, col: number, event: MouseEvent) {
		if (disabled) return;

		const nextCell = getCellCoord(row, col);
		if (editingCell && !sameCell(editingCell, nextCell)) {
			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLInputElement) {
				activeElement.blur();
			}
			if (editingCell) {
				return;
			}
		}

		activeCell = nextCell;
		if (event.shiftKey && view.anchor) {
			event.preventDefault();
			view.selectCell(activeCell, "range");
		} else if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			view.selectCell(activeCell, "add");
		} else {
			event.preventDefault();
			view.selectCell(activeCell, "replace");
			isMouseDown = true;
			dragStartCell = { row, col };
		}

		focusGrid();
	}

	function handleCellMouseEnter(row: number, col: number, event: MouseEvent) {
		if (isMouseDown && dragStartCell) {
			event.preventDefault();
			activeCell = getCellCoord(row, col);
			view.selectCell(activeCell, "range");
		}
	}

	function handleMouseUp() {
		isMouseDown = false;
		dragStartCell = null;
	}

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

	function shouldHandleKeyEvent(): boolean {
		if (!gridRoot) return false;
		const activeElement = document.activeElement;
		return activeElement === gridRoot || gridRoot.contains(activeElement);
	}

	function isNumericEditKey(event: KeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return false;
		}

		return event.key.length === 1 && /[0-9.-]/.test(event.key);
	}

	async function handleDocumentKeyDown(event: KeyboardEvent): Promise<void> {
		if (disabled) return;
		if (!shouldHandleKeyEvent()) return;
		if (editingCell) return;

		const isCtrlOrMeta = event.ctrlKey || event.metaKey;

		if (
			event.key === "ArrowUp" ||
			event.key === "ArrowDown" ||
			event.key === "ArrowLeft" ||
			event.key === "ArrowRight"
		) {
			const moved = moveActiveCell(
				event.key === "ArrowUp"
					? "up"
					: event.key === "ArrowDown"
						? "down"
						: event.key === "ArrowLeft"
							? "left"
							: "right",
				{
					extendSelection: event.shiftKey,
					jumpToEdge: isCtrlOrMeta,
				},
			);
			if (moved) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			enterEditMode();
			return;
		}

		if (isNumericEditKey(event)) {
			event.preventDefault();
			event.stopPropagation();
			enterEditMode(event.key);
			return;
		}

		if (isCtrlOrMeta && event.key === "a") {
			event.preventDefault();
			event.stopPropagation();
			view.selectAll();
			return;
		}

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

		if (isCtrlOrMeta && event.key === "v") {
			event.preventDefault();
			event.stopPropagation();
			try {
				const text = await navigator.clipboard.readText();
				if (!text) return;

				const selected = view.getSelectedCells();
				const anchor =
					selected.length > 0
						? {
								row: Math.min(...selected.map((cell) => cell.row)),
								col: Math.min(...selected.map((cell) => cell.col ?? 0)),
							}
						: { row: activeCell.row, col: activeCell.col };

				const region = view.pasteFromTSV(
					text,
					anchor.row,
					anchor.col,
					effectiveDepth,
				);

				if (region) {
					activeCell = getCellCoord(region.minRow, region.minCol);
					view.selectCell(activeCell, "replace");
					view.selectCell(getCellCoord(region.maxRow, region.maxCol), "range");
				}
			} catch (err) {
				console.error("Failed to paste from clipboard:", err);
			}
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			view.clearSelection();
			return;
		}
	}

	onMount(() => {
		if (view.getSelectionCount() === 0) {
			ensureActiveCellSelected();
		}
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

<div
	class="table-wrapper"
	tabindex="0"
	role="grid"
	bind:this={gridRoot}
	onfocus={() => ensureActiveCellSelected()}
	onmousedown={() => focusGrid()}
>
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

	{#if unitSummaries.length > 0}
		<div class="table-grid__meta" aria-label="Table unit summary">
			{#each unitSummaries as summary (summary.key)}
				<span class="table-grid__meta-item">
					<span class="table-grid__meta-label">{summary.label}:</span>
					<span>{summary.value}</span>
				</span>
			{/each}
		</div>
	{/if}

	<table
		class="table-grid"
		style={`${gradientCssVars} --data-column-count: ${Math.max(1, colCount)}; --legend-column-width: ${hasYAxis ? "88px" : "0px"}; --cell-min-width: 56px;`}
	>
		<colgroup>
			{#if hasYAxis}
				<col class="table-grid__col table-grid__col--legend" />
			{/if}
			{#each Array.from( { length: colCount }, ) as _, colIndex (`col-${colIndex}`)}
				<col class="table-grid__col table-grid__col--data" />
			{/each}
		</colgroup>
		{#if xAxisValues && xAxisValues.length > 0}
			<thead>
				<tr>
					{#if hasYAxis}
						<th class="table-grid__corner" aria-hidden="true"></th>
					{/if}
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
					{#if yAxisValues && yAxisValues.length > rowIndex}
						<th class="table-grid__axis-header table-grid__axis-header--y">
							{formatAxisValue(yAxisValues[rowIndex] ?? 0)}
						</th>
					{/if}
					{#each row as cell, colIndex (`${rowIndex}-${colIndex}`)}
						<td
							style={getCellStyle(rowIndex, colIndex)}
							class:selected={view.isSelected(getCellCoord(rowIndex, colIndex))}
							class:active={isActiveCell(rowIndex, colIndex)}
							class:editing={isEditingCell(rowIndex, colIndex)}
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
								transform={transformLookup}
								inverseTransform={inverseTransformLookup}
								isActive={isActiveCell(rowIndex, colIndex)}
								isEditing={isEditingCell(rowIndex, colIndex)}
								editSeed={isEditingCell(rowIndex, colIndex)
									? editSeed
									: undefined}
								on:commit={(event: CustomEvent) =>
									handleCommit(rowIndex, colIndex, event)}
								on:complete={(event: CustomEvent) =>
									exitEditMode(event.detail.move)}
								on:cancel={() => {
									editingCell = null;
									editSeed = undefined;
									ensureActiveCellSelected();
									focusGrid();
								}}
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
		width: max(
			100%,
			calc(
				var(--legend-column-width) +
					(var(--data-column-count) * var(--cell-min-width))
			)
		);
		border-collapse: collapse;
		table-layout: fixed;
		--gradient-low: #73c991;
		--gradient-mid: #e2c08d;
		--gradient-high: #f48771;
	}

	.table-grid__col--legend {
		width: var(--legend-column-width);
	}

	.table-grid__col--data {
		width: max(
			var(--cell-min-width),
			calc((100% - var(--legend-column-width)) / var(--data-column-count))
		);
	}

	.table-grid td {
		padding: 0;
		border: 1px solid var(--vscode-panel-border);
		height: 32px;
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

	.table-grid__axis-header {
		background-color: var(--vscode-editor-background);
		color: var(--vscode-editor-foreground);
		border-color: var(--vscode-panel-border);
		font-size: 0.875rem;
	}

	.table-grid__axis-header--y {
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

	.table-grid__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.75rem;
		margin-bottom: 1rem;
		font-size: 0.75rem;
		color: var(--vscode-descriptionForeground);
	}

	.table-grid__meta-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 999px;
		background: color-mix(
			in srgb,
			var(--vscode-editor-background) 80%,
			var(--vscode-editorWidget-background, transparent)
		);
		white-space: normal;
	}

	.table-grid__meta-label {
		font-weight: 600;
	}

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
		background-color: var(--vscode-list-activeSelectionBackground);
		pointer-events: none;
		z-index: -1;
	}

	.table-grid td.editing {
		outline: 3px solid var(--vscode-focusBorder);
		outline-offset: -3px;
	}

	.table-grid td.active:not(.selected) {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}

	.table-grid td {
		cursor: pointer;
		user-select: none;
	}

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
