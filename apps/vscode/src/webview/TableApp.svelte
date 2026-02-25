<script module lang="ts">
	// VSCode API for webview messaging
	declare const acquireVsCodeApi: () => {
		postMessage: (message: unknown) => void;
		getState: () => unknown;
		setState: (state: unknown) => void;
	};
</script>

<script lang="ts">
	import type { TableDefinition } from "@ecu-explorer/core";
	import { TableView, TableGrid } from "@ecu-explorer/ui";
	import type { ThemeColors } from "@ecu-explorer/ui";
	import { onMount } from "svelte";

	let vscode: ReturnType<typeof acquireVsCodeApi>;
	try {
		vscode = acquireVsCodeApi();
	} catch (error) {
		console.error("Failed to acquire VSCode API:", error);
		throw error;
	}

	// State
	let tableView: TableView<TableDefinition> | null = $state(null);
	let definition: TableDefinition | null = $state(null);
	let tableName = $state("");
	let isReady = $state(false);
	let isSaving = $state(false);
	let saveStatus: "idle" | "saving" | "success" | "error" = $state("idle");
	let saveError = $state("");
	let isInitialLoad = $state(true); // Track if this is the initial load
	let themeColors: ThemeColors | undefined = $state(undefined);

	// Reactive state for table data
	let tableSnapshot = $state<any>(null);

	// Watch for selection changes
	$effect(() => {
		if (tableView) {
			const selection = tableView.getSelectedCells();
			// Only report if we have a selection and it's not the initial load
			// or if it's an empty selection after having one
			vscode.postMessage({
				type: "selectionChange",
				selection,
			});
		}
	});

	// Handle messages from extension host
	onMount(() => {
		window.addEventListener("message", handleMessage);

		// Handle keyboard shortcuts for undo/redo at document level
		function handleKeyDown(event: KeyboardEvent) {
			// Undo: Ctrl+Z or Cmd+Z (without Shift)
			if (
				(event.ctrlKey || event.metaKey) &&
				event.key === "z" &&
				!event.shiftKey
			) {
				event.preventDefault();
				handleUndo();
				return;
			}

			// Redo: Ctrl+Y or Cmd+Shift+Z
			if (
				((event.ctrlKey || event.metaKey) && event.key === "y") ||
				((event.ctrlKey || event.metaKey) &&
					event.shiftKey &&
					event.key === "z")
			) {
				event.preventDefault();
				handleRedo();
				return;
			}

			// Math operation hotkeys: =, +, -, *, /
			// Handle at document level to work even when input is focused
			if (
				event.key === "=" ||
				event.key === "+" ||
				event.key === "-" ||
				event.key === "*" ||
				event.key === "/"
			) {
				// Check if there are selected cells
				if (tableView && tableView.getSelectionCount() > 0) {
					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
					vscode.postMessage({ type: "mathOpHotkey", key: event.key });
				}
				return;
			}

			// Save: Ctrl+S or Cmd+S - removed, now handled by VSCode native save
			// VSCode's CustomEditor will handle Cmd+S natively
		}

		document.addEventListener("keydown", handleKeyDown, true);

		// Signal readiness to extension host
		vscode.postMessage({ type: "ready" });

		return () => {
			window.removeEventListener("message", handleMessage);
			document.removeEventListener("keydown", handleKeyDown);
		};
	});

	function handleMessage(event: MessageEvent) {
		const msg = event.data;
		if (!msg || typeof msg !== "object") return;

		switch (msg.type) {
			case "init":
				handleInit(msg);
				break;
			case "update":
				handleUpdate(msg);
				break;
			case "error":
				handleError(msg);
				break;
			case "saveComplete":
				handleSaveComplete();
				break;
			case "saveError":
				handleSaveError(msg);
				break;
			case "mathOp":
				handleMathOp(msg);
				break;
			case "themeChanged":
				handleThemeChanged(msg);
				break;
			case "switchTable":
				handleSwitchTable(msg);
				break;
			case "selectCells":
				handleSelectCells(msg);
				break;
		}
	}

	function handleSelectCells(msg: {
		type: "selectCells";
		selection: { row: number; col: number; depth?: number }[];
	}) {
		if (tableView) {
			tableView.clearSelection();
			for (const coord of msg.selection) {
				tableView.selectCell(coord, "add");
			}
		}
	}

	function handleInit(msg: {
		type: "init";
		snapshot: {
			kind: string;
			name: string;
			rows: number;
			cols?: number;
			x?: number[];
			y?: number[];
			z: number[] | number[][];
		};
		definition: TableDefinition;
		rom: Uint8Array;
		themeColors?: ThemeColors;
	}) {
		tableName = msg.snapshot.name;
		definition = msg.definition;
		tableSnapshot = msg.snapshot;

		// Extract theme colors if provided
		if (msg.themeColors) {
			themeColors = msg.themeColors;
		}

		// Create TableView with ROM bytes
		const rom = new Uint8Array(msg.rom);
		tableView = new TableView(rom, msg.definition);

		isReady = true;
	}

	/**
	 * Handle theme change message
	 */
	function handleThemeChanged(msg: {
		type: "themeChanged";
		themeColors: ThemeColors;
	}) {
		if (msg.themeColors) {
			themeColors = msg.themeColors;
		}
	}

	/**
	 * Handle switch table message
	 * Called when user clicks on a different table in the tree view while ROM is already open
	 */
	function handleSwitchTable(msg: { type: "switchTable"; tableName: string }) {
		// Request the extension to load the new table
		vscode.postMessage({
			type: "requestTableSwitch",
			tableName: msg.tableName,
		});
	}

	function handleUpdate(msg: {
		type: "update";
		snapshot: any;
		rom?: number[];
		reason?: string;
	}) {
		// Update reactive snapshot
		tableSnapshot = msg.snapshot;

		// Reload table view from updated ROM
		if (tableView && definition) {
			// Preserve transaction history when recreating TableView
			const savedTransactions = [...tableView.history];
			const savedUndone = [...tableView.redoHistory];

			// Use updated ROM bytes if provided, otherwise use existing ROM
			const rom = msg.rom ? new Uint8Array(msg.rom) : tableView["rom"];
			tableView = new TableView(
				rom,
				definition,
				savedTransactions,
				savedUndone,
			);
		}
	}

	function handleError(msg: { type: "error"; message: string }) {
		console.error("Error from host:", msg.message);
		// TODO: Show error notification in UI
	}

	function handleSaveComplete() {
		isSaving = false;
		saveStatus = "success";
		// Clear success status after 3 seconds
		setTimeout(() => {
			if (saveStatus === "success") {
				saveStatus = "idle";
			}
		}, 3000);
	}

	function handleSaveError(msg: { type: "saveError"; error: string }) {
		isSaving = false;
		saveStatus = "error";
		saveError = msg.error;
		console.error("Save error:", msg.error);
		// Clear error status after 5 seconds
		setTimeout(() => {
			if (saveStatus === "error") {
				saveStatus = "idle";
				saveError = "";
			}
		}, 5000);
	}

	function handleMathOp(msg: {
		type: "mathOp";
		operation: "add" | "multiply" | "clamp" | "smooth" | "set";
		constant?: number;
		factor?: number;
		min?: number;
		max?: number;
		kernelSize?: number;
		iterations?: number;
		boundaryMode?: "pad" | "repeat" | "mirror";
		value?: number;
	}) {
		if (!tableView) {
			console.error("No table view available for math operation");
			return;
		}

		// Check if cells are selected
		if (tableView.getSelectionCount() === 0) {
			console.warn("No cells selected for math operation");
			// Show error via extension
			vscode.postMessage({
				type: "error",
				message:
					"No cells selected. Please select cells before applying math operations.",
			});
			return;
		}

		try {
			let result;
			let transaction;

			switch (msg.operation) {
				case "add":
					if (msg.constant === undefined) {
						throw new Error("Constant value is required for add operation");
					}
					({ result, transaction } = tableView.applyAddOperation(msg.constant));
					break;

				case "multiply":
					if (msg.factor === undefined) {
						throw new Error("Factor value is required for multiply operation");
					}
					({ result, transaction } = tableView.applyMultiplyOperation(
						msg.factor,
					));
					break;

				case "set":
					if (msg.value === undefined) {
						throw new Error("Value is required for set operation");
					}
					({ result, transaction } = tableView.applySetValueOperation(
						msg.value,
					));
					break;

				case "clamp":
					if (msg.min === undefined || msg.max === undefined) {
						throw new Error(
							"Min and max values are required for clamp operation",
						);
					}
					({ result, transaction } = tableView.applyClampOperation(
						msg.min,
						msg.max,
					));
					break;

				case "smooth":
					if (msg.kernelSize === undefined) {
						throw new Error("Kernel size is required for smooth operation");
					}
					({ result, transaction } = tableView.applySmoothOperation(
						msg.kernelSize,
						msg.iterations ?? 1,
						msg.boundaryMode ?? "pad",
					));
					break;

				default:
					throw new Error(`Unknown math operation: ${msg.operation}`);
			}

			// Show warnings if any
			if (result.warnings.length > 0) {
				console.warn("Math operation warnings:", result.warnings);
				// Could show a notification here
			}

			// Notify extension that changes were made
			if (transaction) {
				vscode.postMessage({
					type: "mathOpComplete",
					operation: msg.operation,
					changedCount: result.changedCount,
					warnings: result.warnings,
					edits: transaction.edits.map((edit) => ({
						address: edit.address,
						after: Array.from(edit.after),
					})),
				});
			}
		} catch (error) {
			console.error("Math operation failed:", error);
			vscode.postMessage({
				type: "error",
				message: `Math operation failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	// Handle undo/redo from UI
	function handleUndo() {
		if (!tableView) return;
		const transaction = tableView.undo();
		if (transaction) {
			// Notify extension for persistence
			vscode.postMessage({ type: "undo" });
		}
	}

	function handleRedo() {
		if (!tableView) return;
		const transaction = tableView.redo();
		if (transaction) {
			// Notify extension for persistence
			vscode.postMessage({ type: "redo" });
		}
	}

	// Handle cell edits - commit to host (reactive approach)
	$effect(() => {
		if (!tableView) return;

		// Skip auto-commit during initial load to prevent immediate dirty state
		if (isInitialLoad) {
			// Set to false after the first effect run
			isInitialLoad = false;
			return;
		}

		// Watch for pending changes reactively
		if (tableView.isPending) {
			const transaction = tableView.commit("Cell edit");
			if (transaction) {
				// Update local snapshot immediately for responsiveness
				tableSnapshot = tableView.snapshot;

				// Send edit to host
				for (const edit of transaction.edits) {
					// Find cell location from address
					const location = tableView["cellIndex"].get(edit.address);
					if (location) {
						vscode.postMessage({
							type: "cellEdit",
							row: location.row,
							col: location.col,
							depth: location.depth,
							value: edit.after,
							label: transaction.label,
						});
					}
				}
			}
		}
	});
</script>

<div class="table-app">
	{#if isReady && tableView && definition && tableSnapshot}
		<div class="toolbar">
			<h2>{tableName}</h2>
		</div>
		<div class="table-container">
			<TableGrid view={tableView} {definition} {themeColors} disabled={false} />
		</div>
	{:else}
		<div class="loading">Loading table...</div>
	{/if}
</div>

<style>
	.table-app {
		padding: 1rem;
		font-family: var(--vscode-font-family, system-ui, sans-serif);
		font-size: var(--vscode-font-size, 13px);
		color: var(--vscode-foreground);
		background-color: var(--vscode-editor-background);
	}

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

	.table-container {
		overflow: auto;
		max-height: calc(100vh - 8rem);
		height: calc(100vh - 8rem);
	}

	.loading {
		display: flex;
		justify-content: center;
		align-items: center;
		height: 50vh;
		font-size: 1.1rem;
		color: var(--vscode-descriptionForeground);
	}
</style>
