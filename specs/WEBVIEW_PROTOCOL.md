# Webview Protocol

## Overview

The webview protocol defines the messaging contract between the VS Code extension host and the webview UI. This enables bidirectional communication for table editing, undo/redo, and export operations.

### Why Webview Messaging Is Needed

- **Process isolation**: Extension host and webview run in separate processes
- **Security**: Webview cannot directly access file system or VS Code APIs
- **Reactivity**: UI updates must be communicated back to host for persistence
- **State management**: Host maintains authoritative state; webview is a view layer

### Host vs Webview Separation

- **Extension Host** (Node.js): Manages ROM data, definitions, file I/O, checksum computation
- **Webview** (Browser): Renders table grid, graph, handles user input
- **Messages**: Typed JSON objects passed between host and webview

### Message Flow Architecture

```
Webview loads
    ↓
Webview sends "ready"
    ↓
Host responds with "init" (table snapshot)
    ↓
User edits cell
    ↓
Webview sends "cellEdit"
    ↓
Host validates and sends "cellCommit" or "error"
    ↓
User clicks undo/redo
    ↓
Webview sends "undo" / "redo"
    ↓
Host applies and sends "update"
    ↓
User exports
    ↓
Webview sends "export"
    ↓
Host saves file and sends "exportComplete"
```

---

## Message Types and Schemas

All messages are JSON objects with a `type` field that discriminates the message kind. Use TypeScript discriminated unions for type safety.

### `ready` - Webview Signals Readiness

**Direction**: Webview → Host

**Purpose**: Signal that webview is loaded and ready to receive data.

**Schema**:
```typescript
interface ReadyMessage {
	type: "ready";
}
```

**Example**:
```javascript
vscode.postMessage({ type: "ready" });
```

**Host behavior**:
- Receive `ready` message
- Send `init` message with table snapshot
- Set `didInit` flag to prevent duplicate sends

---

### `init` - Host Sends Initial Table Data

**Direction**: Host → Webview

**Purpose**: Send complete table snapshot after webview signals readiness.

**Schema**:
```typescript
type TableSnapshot =
	| {
			kind: "table1d";
			name: string;
			rows: number;
			x?: number[];
			z: number[];
	  }
	| {
			kind: "table2d";
			name: string;
			rows: number;
			cols: number;
			x?: number[];
			y?: number[];
			z: number[][];
	  };

/**
 * Theme colors extracted from VSCode theme
 */
interface ThemeColors {
	// Gradient colors (for data visualization)
	gradient: {
		low: string;      // gitDecoration.addedResourceForeground (green)
		mid: string;      // gitDecoration.modifiedResourceForeground (yellow)
		high: string;     // gitDecoration.deletedResourceForeground (red)
	};
	
	// UI colors
	ui: {
		background: string;           // editor.background
		foreground: string;           // editor.foreground
		border: string;               // panel.border
		inputBackground: string;      // input.background
		inputForeground: string;      // input.foreground
		inputBorder: string;          // input.border
		selectionBackground: string;  // list.activeSelectionBackground
		selectionForeground: string;  // list.activeSelectionForeground
		hoverBackground: string;      // list.hoverBackground
		focusBorder: string;          // focusBorder
		buttonBackground: string;     // button.background
		buttonForeground: string;     // button.foreground
		buttonHoverBackground: string; // button.hoverBackground
	};
	
	// High contrast mode flag
	isHighContrast: boolean;
}

interface InitMessage {
	type: "init";
	snapshot: TableSnapshot;
	themeColors: ThemeColors;  // Theme colors for UI and gradient
}
```

**Example**:
```javascript
{
	type: "init",
	snapshot: {
		kind: "table2d",
		name: "Boost Target Engine Load #1A",
		rows: 9,
		cols: 18,
		x: [0, 10, 20, 30, 40, 50, 60, 70, 80],
		y: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000],
		z: [[...], [...], ...]
	},
	themeColors: {
		gradient: {
			low: "#22c55e",
			mid: "#eab308",
			high: "#ef4444"
		},
		ui: {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			border: "#3e3e3e",
			inputBackground: "#3c3c3c",
			inputForeground: "#cccccc",
			inputBorder: "#3c3c3c",
			selectionBackground: "#094771",
			selectionForeground: "#ffffff",
			hoverBackground: "#2a2d2e",
			focusBorder: "#007acc",
			buttonBackground: "#0e639c",
			buttonForeground: "#ffffff",
			buttonHoverBackground: "#1177bb"
		},
		isHighContrast: false
	}
}
```

**Webview behavior**:
- Receive `init` message
- Store snapshot in local state
- Store theme colors for UI and gradient
- Render table grid and graph with theme colors
- Enable editing

---

### `themeChanged` - Theme Color Update

**Direction**: Host → Webview

**Purpose**: Notify webview that VSCode theme colors have changed.

**Schema**:
```typescript
interface ThemeChangedMessage {
	type: "themeChanged";
	themeColors: ThemeColors;
}
```

**Example**:
```javascript
{
	type: "themeChanged",
	themeColors: {
		gradient: {
			low: "#22c55e",
			mid: "#eab308",
			high: "#ef4444"
		},
		ui: {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			border: "#3e3e3e",
			inputBackground: "#3c3c3c",
			inputForeground: "#cccccc",
			inputBorder: "#3c3c3c",
			selectionBackground: "#094771",
			selectionForeground: "#ffffff",
			hoverBackground: "#2a2d2e",
			focusBorder: "#007acc",
			buttonBackground: "#0e639c",
			buttonForeground: "#ffffff",
			buttonHoverBackground: "#1177bb"
		},
		isHighContrast: false
	}
}
```

**Webview behavior**:
- Receive `themeChanged` message
- Update stored theme colors
- Re-render table grid and graph with new colors
- Update gradient color map
- Apply new UI colors to components

**Host behavior**:
- Listen to `vscode.window.onDidChangeActiveColorTheme` event
- Read new theme colors using `getThemeColors()`
- Send `themeChanged` message to all active webviews
- Ensure seamless theme switching without reload

---

### `cellEdit` - Webview Sends Cell Edit

**Direction**: Webview → Host

**Purpose**: Notify host of a cell value change.

**Schema**:
```typescript
interface CellEditMessage {
	type: "cellEdit";
	row: number;
	col: number;
	value: number;
	label?: string; // Optional human-readable label for undo/redo
}
```

**Example**:
```javascript
{
	type: "cellEdit",
	row: 3,
	col: 5,
	value: 42.5,
	label: "Edit cell (3, 5)"
}
```

**Host behavior**:
- Receive `cellEdit` message
- Validate value (range, dtype, etc.)
- Update ROM bytes
- Send `cellCommit` or `error` message
- Emit event for reactive updates to other webviews

---

### `cellCommit` - Host Confirms Edit

**Direction**: Host → Webview

**Purpose**: Confirm that cell edit was accepted and applied.

**Schema**:
```typescript
interface CellCommitMessage {
	type: "cellCommit";
	row: number;
	col: number;
	value: number;
	oldValue: number;
}
```

**Example**:
```javascript
{
	type: "cellCommit",
	row: 3,
	col: 5,
	value: 42.5,
	oldValue: 40.0
}
```

**Webview behavior**:
- Receive `cellCommit` message
- Update local snapshot
- Re-render affected cells
- Update graph if needed

---

### `error` - Error Message

**Direction**: Host → Webview

**Purpose**: Communicate validation or processing errors.

**Schema**:
```typescript
interface ErrorMessage {
	type: "error";
	message: string;
	code?: string; // Optional error code for categorization
	context?: {
		row?: number;
		col?: number;
		value?: number;
	};
}
```

**Example**:
```javascript
{
	type: "error",
	message: "Value 300 exceeds maximum of 255 for u8 type",
	code: "VALUE_OUT_OF_RANGE",
	context: { row: 3, col: 5, value: 300 }
}
```

**Webview behavior**:
- Receive `error` message
- Display error notification to user
- Revert cell to previous value
- Highlight affected cell

---

### `undo` / `redo` - Undo/Redo Commands

**Direction**: Webview → Host

**Purpose**: Request undo or redo operation.

**Schema**:
```typescript
interface UndoMessage {
	type: "undo";
}

interface RedoMessage {
	type: "redo";
}
```

**Example**:
```javascript
vscode.postMessage({ type: "undo" });
vscode.postMessage({ type: "redo" });
```

**Host behavior**:
- Receive `undo` or `redo` message
- Apply operation to ROM bytes
- Send `update` message with new snapshot
- Update undo/redo stack

---

### `update` - Snapshot Update

**Direction**: Host → Webview

**Purpose**: Send updated table snapshot after undo/redo or other changes.

**Schema**:
```typescript
interface UpdateMessage {
	type: "update";
	snapshot: TableSnapshot;
	reason?: string; // Optional: "undo", "redo", "external", etc.
}
```

**Example**:
```javascript
{
	type: "update",
	snapshot: { ... },
	reason: "undo"
}
```

**Webview behavior**:
- Receive `update` message
- Replace local snapshot
- Re-render table and graph
- Maintain scroll position if possible

---

### `export` - Export Request

**Direction**: Webview → Host

**Purpose**: Request to export table to CSV.

**Schema**:
```typescript
interface ExportMessage {
	type: "export";
	format?: "csv"; // Future: "json", "xlsx", etc.
}
```

**Example**:
```javascript
vscode.postMessage({ type: "export", format: "csv" });
```

**Host behavior**:
- Receive `export` message
- Convert table snapshot to CSV
- Show save dialog
- Write file
- Send `exportComplete` message

---

### `exportComplete` - Export Completion

**Direction**: Host → Webview

**Purpose**: Notify webview that export completed successfully.

**Schema**:
```typescript
interface ExportCompleteMessage {
	type: "exportComplete";
	filename: string;
	path: string;
}
```

**Example**:
```javascript
{
	type: "exportComplete",
	filename: "Boost_Target_Engine_Load_1A.csv",
	path: "/path/to/file.csv"
}
```

**Webview behavior**:
- Receive `exportComplete` message
- Show success notification
- Optional: Open file in explorer

---

### `save` - Save ROM Request

**Direction**: Webview → Host

**Purpose**: Request to save the ROM file with all changes.

**Schema**:
```typescript
interface SaveMessage {
	type: "save";
}
```

**Example**:
```javascript
vscode.postMessage({ type: "save" });
```

**Host behavior**:
- Receive `save` message
- Recompute checksums if checksum definition is available
- Write ROM bytes to file
- Create backup if configured
- Send `saveComplete` or `saveError` message

---

### `saveComplete` - Save Completion

**Direction**: Host → Webview

**Purpose**: Notify webview that ROM save completed successfully.

**Schema**:
```typescript
interface SaveCompleteMessage {
	type: "saveComplete";
	path: string;
	checksumValid: boolean;
}
```

**Example**:
```javascript
{
	type: "saveComplete",
	path: "/path/to/rom.bin",
	checksumValid: true
}
```

**Webview behavior**:
- Receive `saveComplete` message
- Show success notification
- Update dirty state indicator
- Display checksum status if available

---

### `saveError` - Save Error

**Direction**: Host → Webview

**Purpose**: Notify webview that ROM save failed.

**Schema**:
```typescript
interface SaveErrorMessage {
	type: "saveError";
	error: string;
}
```

**Example**:
```javascript
{
	type: "saveError",
	error: "Failed to write file: Permission denied"
}
```

**Webview behavior**:
- Receive `saveError` message
- Show error notification to user
- Keep dirty state indicator active

---

### `mathOp` - Math Operation Request

**Direction**: Host → Webview

**Purpose**: Apply a mathematical operation to selected cells (triggered by VSCode commands).

**Schema**:
```typescript
interface MathOpMessage {
	type: "mathOp";
	operation: "add" | "multiply" | "clamp" | "smooth";
	constant?: number; // For add operation
	factor?: number; // For multiply operation
	min?: number; // For clamp operation
	max?: number; // For clamp operation
	kernelSize?: number; // For smooth operation (3, 5, 7, 9)
	iterations?: number; // For smooth operation (default: 1)
	boundaryMode?: "pad" | "repeat" | "mirror"; // For smooth operation (default: "pad")
}
```

**Examples**:
```javascript
// Add constant
{
	type: "mathOp",
	operation: "add",
	constant: 5
}

// Multiply by factor
{
	type: "mathOp",
	operation: "multiply",
	factor: 1.5
}

// Clamp to range
{
	type: "mathOp",
	operation: "clamp",
	min: 0,
	max: 255
}

// Smooth with 3x3 kernel
{
	type: "mathOp",
	operation: "smooth",
	kernelSize: 3,
	iterations: 1,
	boundaryMode: "pad"
}
```

**Webview behavior**:
- Receive `mathOp` message
- Check if cells are selected
- Call appropriate method on TableView:
  - `applyAddOperation(constant)`
  - `applyMultiplyOperation(factor)`
  - `applyClampOperation(min, max)`
  - `applySmoothOperation(kernelSize, iterations, boundaryMode)`
- Display warnings if any values were clamped
- Send `mathOpComplete` or `error` message back to host

**Validation**:
- Add: constant must be a number
- Multiply: factor must be a number
- Clamp: min <= max, both must be numbers
- Smooth: kernelSize must be odd (3, 5, 7, 9), iterations >= 1, only for 2D/3D tables

---

### `mathOpComplete` - Math Operation Completion

**Direction**: Webview → Host

**Purpose**: Notify host that math operation completed successfully.

**Schema**:
```typescript
interface MathOpCompleteMessage {
	type: "mathOpComplete";
	operation: "add" | "multiply" | "clamp" | "smooth";
	changedCount: number;
	warnings: string[];
}
```

**Example**:
```javascript
{
	type: "mathOpComplete",
	operation: "add",
	changedCount: 45,
	warnings: ["2 values were clamped to maximum"]
}
```

**Host behavior**:
- Receive `mathOpComplete` message
- Log operation for debugging
- Optional: Show notification with result

---

### `triggerSave` - Trigger ROM Save

**Direction**: Webview → Host

**Purpose**: Request the host to trigger VSCode's native save command for the ROM file.

**Schema**:
```typescript
interface TriggerSaveMessage {
	type: "triggerSave";
}
```

**Example**:
```javascript
vscode.postMessage({ type: "triggerSave" });
```

**Host behavior**:
- Receive `triggerSave` message
- Execute VSCode's native save command: `workbench.action.files.save`
- VSCode will trigger the custom editor's save flow
- ROM will be saved with checksum recomputation

**Webview behavior**:
- Send `triggerSave` when user clicks Save button in UI
- Wait for `saveComplete` or `saveError` response
- Update UI state based on response

---

### `openGraph` - Open Graph in Separate Window

**Direction**: Webview → Host

**Purpose**: Request to open a graph visualization in a separate VSCode webview panel.

**Schema**:
```typescript
interface OpenGraphMessage {
	type: "openGraph";
	tableId: string;
	tableName: string;
}
```

**Example**:
```javascript
vscode.postMessage({
	type: "openGraph",
	tableId: "Boost Target Engine Load #1A",
	tableName: "Boost Target Engine Load #1A"
});
```

**Host behavior**:
- Receive `openGraph` message
- Verify ROM and table are loaded
- Get current table snapshot
- Call `GraphPanelManager.getOrCreatePanel()` to open or reveal graph window
- Graph window will be created in a separate webview panel
- Graph will sync with table editor automatically

**Webview behavior**:
- Send `openGraph` when user clicks "Open Graph" button in toolbar
- Button should be visible when a table is loaded
- No response expected (graph opens in separate window)

**Related**:
- See [`specs/separate-graph-windows.md`](separate-graph-windows.md) for full feature specification
- Graph windows are managed by `GraphPanelManager` class
- Users can also open graphs via command palette (`Ctrl+Shift+G`) or keyboard shortcut

---

## Lifecycle: ready → init → updates → save

### 1. Webview Loads

```
Webview HTML loads in VS Code panel
↓
JavaScript executes
↓
Webview sends "ready" message
```

**Webview code**:
```javascript
window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg && msg.type === "init") {
		render(msg.snapshot);
	}
});

vscode.postMessage({ type: "ready" });
```

### 2. Host Responds with Init

```
Host receives "ready" message
↓
Host computes table snapshot
↓
Host sends "init" message with snapshot
```

**Host code**:
```typescript
panel.webview.onDidReceiveMessage(async (msg: unknown) => {
	if (!msg || typeof msg !== "object") return;
	const type = (msg as { type?: string }).type;
	if (type === "ready") {
		if (!didInit) {
			didInit = true;
			const snapshot = snapshotTable(def, activeRom.bytes);
			await panel.webview.postMessage({ type: "init", snapshot });
		}
		return;
	}
});
```

### 3. User Edits Cells

```
User clicks cell
↓
Webview shows edit input
↓
User enters new value
↓
Webview sends "cellEdit" message
```

**Webview code**:
```javascript
function onCellEdit(row, col, newValue) {
	vscode.postMessage({
		type: "cellEdit",
		row,
		col,
		value: newValue,
		label: `Edit cell (${row}, ${col})`
	});
}
```

### 4. Host Validates and Commits

```
Host receives "cellEdit" message
↓
Host validates value (range, dtype, etc.)
↓
Host updates ROM bytes
↓
Host sends "cellCommit" or "error" message
```

**Host code**:
```typescript
if (type === "cellEdit") {
	const msg = msg as CellEditMessage;
	try {
		const oldValue = readCell(def, activeRom.bytes, msg.row, msg.col);
		writeCell(def, activeRom.bytes, msg.row, msg.col, msg.value);
		await panel.webview.postMessage({
			type: "cellCommit",
			row: msg.row,
			col: msg.col,
			value: msg.value,
			oldValue
		});
	} catch (error) {
		await panel.webview.postMessage({
			type: "error",
			message: error.message,
			context: { row: msg.row, col: msg.col, value: msg.value }
		});
	}
}
```

### 5. Webview Updates Display

```
Webview receives "cellCommit" message
↓
Webview updates local snapshot
↓
Webview re-renders affected cells
↓
Webview updates graph
```

**Webview code**:
```javascript
window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg && msg.type === "cellCommit") {
		snapshot.z[msg.row][msg.col] = msg.value;
		renderCell(msg.row, msg.col);
		renderChart();
	}
});
```

### 6. User Performs Undo/Redo

```
User presses Ctrl+Z (undo) or Ctrl+Y (redo)
↓
Webview sends "undo" or "redo" message
```

**Webview code**:
```javascript
document.addEventListener("keydown", (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key === "z") {
		event.preventDefault();
		vscode.postMessage({ type: "undo" });
	}
	if ((event.ctrlKey || event.metaKey) && event.key === "y") {
		event.preventDefault();
		vscode.postMessage({ type: "redo" });
	}
});
```

### 7. Host Applies Undo/Redo

```
Host receives "undo" or "redo" message
↓
Host applies operation to ROM bytes
↓
Host computes new snapshot
↓
Host sends "update" message
```

**Host code**:
```typescript
if (type === "undo") {
	tableModel.undo();
	const snapshot = snapshotTable(def, activeRom.bytes);
	await panel.webview.postMessage({ type: "update", snapshot, reason: "undo" });
}
```

### 8. Webview Updates Display

```
Webview receives "update" message
↓
Webview replaces snapshot
↓
Webview re-renders entire table and graph
```

**Webview code**:
```javascript
window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg && msg.type === "update") {
		snapshot = msg.snapshot;
		render(snapshot);
	}
});
```

### 9. User Exports

```
User clicks "Export CSV" button
↓
Webview sends "export" message
```

**Webview code**:
```javascript
document.getElementById("export").addEventListener("click", () => {
	vscode.postMessage({ type: "export", format: "csv" });
});
```

### 10. Host Exports and Saves

```
Host receives "export" message
↓
Host converts snapshot to CSV
↓
Host shows save dialog
↓
Host writes file
↓
Host sends "exportComplete" message
```

**Host code**:
```typescript
if (type === "export") {
	const csv = snapshotToCsv(snapshot);
	const uri = await vscode.window.showSaveDialog({
		filters: { CSV: ["csv"] }
	});
	if (uri) {
		await fs.writeFile(uri.fsPath, csv, "utf8");
		await panel.webview.postMessage({
			type: "exportComplete",
			filename: path.basename(uri.fsPath),
			path: uri.fsPath
		});
	}
}
```

---

## Error Handling Patterns

### Validation Errors

When a cell edit fails validation, send an `error` message:

```typescript
if (msg.value < 0 || msg.value > 255) {
	await panel.webview.postMessage({
		type: "error",
		message: `Value ${msg.value} out of range [0, 255]`,
		code: "VALUE_OUT_OF_RANGE",
		context: { row: msg.row, col: msg.col, value: msg.value }
	});
	return;
}
```

### Retry Logic

For transient errors, implement retry with exponential backoff:

```typescript
async function sendMessageWithRetry(
	panel: vscode.WebviewPanel,
	message: any,
	maxRetries = 3
) {
	for (let i = 0; i < maxRetries; i++) {
		try {
			await panel.webview.postMessage(message);
			return;
		} catch (error) {
			if (i === maxRetries - 1) throw error;
			await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
		}
	}
}
```

### User-Facing Error Messages

Display errors in webview UI:

```javascript
window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg && msg.type === "error") {
		showErrorNotification(msg.message);
		if (msg.context?.row !== undefined && msg.context?.col !== undefined) {
			highlightCell(msg.context.row, msg.context.col);
		}
	}
});

function showErrorNotification(message) {
	const notification = document.createElement("div");
	notification.className = "error-notification";
	notification.textContent = message;
	document.body.appendChild(notification);
	setTimeout(() => notification.remove(), 5000);
}
```

---

## Type-Safe Messaging Patterns

### Discriminated Unions

Use TypeScript discriminated unions for type safety:

```typescript
type Message =
	| { type: "ready" }
	| { type: "init"; snapshot: TableSnapshot }
	| { type: "cellEdit"; row: number; col: number; value: number; label?: string }
	| { type: "cellCommit"; row: number; col: number; value: number; oldValue: number }
	| { type: "error"; message: string; code?: string; context?: any }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "update"; snapshot: TableSnapshot; reason?: string }
	| { type: "export"; format?: "csv" }
	| { type: "exportComplete"; filename: string; path: string }
	| { type: "save" }
	| { type: "saveComplete"; path: string; checksumValid: boolean }
	| { type: "saveError"; error: string };
```

### Type Guards

Implement type guards for message validation:

```typescript
function isReadyMessage(msg: unknown): msg is { type: "ready" } {
	return msg && typeof msg === "object" && (msg as any).type === "ready";
}

function isCellEditMessage(msg: unknown): msg is CellEditMessage {
	return (
		msg &&
		typeof msg === "object" &&
		(msg as any).type === "cellEdit" &&
		typeof (msg as any).row === "number" &&
		typeof (msg as any).col === "number" &&
		typeof (msg as any).value === "number"
	);
}

panel.webview.onDidReceiveMessage((msg: unknown) => {
	if (isReadyMessage(msg)) {
		// msg is { type: "ready" }
	} else if (isCellEditMessage(msg)) {
		// msg is CellEditMessage
	}
});
```

### Example from Extension Code

See [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) for message handling:

```typescript
panel.webview.onDidReceiveMessage(
	async (msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const type = (msg as { type?: string }).type;
		if (type === "ready") {
			if (!didInit) {
				didInit = true;
				await panel.webview.postMessage({ type: "init", snapshot });
			}
			return;
		}
		if (type === "exportCsv") {
			await exportActiveTableCsvFlow(ctx);
		}
	},
	undefined,
	ctx.subscriptions,
);
```

---

## Examples of Adding New Message Types

### Scenario: Add "Math Operations" Message

#### 1. Define Message Type

```typescript
interface MathOpMessage {
	type: "mathOp";
	operation: "add" | "multiply" | "clamp" | "smooth";
	rows: number[];
	cols: number[];
	value?: number; // For add/multiply
	min?: number; // For clamp
	max?: number; // For clamp
	label?: string;
}
```

#### 2. Add to Discriminated Union

```typescript
type Message =
	| { type: "ready" }
	| { type: "init"; snapshot: TableSnapshot }
	| { type: "cellEdit"; row: number; col: number; value: number; label?: string }
	| { type: "mathOp"; operation: string; rows: number[]; cols: number[]; value?: number; label?: string }
	| // ... other message types
```

#### 3. Implement Webview Handler

```javascript
function applyMathOp(operation, rows, cols, value) {
	vscode.postMessage({
		type: "mathOp",
		operation,
		rows,
		cols,
		value,
		label: `Apply ${operation} to selection`
	});
}

document.getElementById("add-button").addEventListener("click", () => {
	const value = prompt("Add value:");
	if (value !== null) {
		applyMathOp("add", selectedRows, selectedCols, parseFloat(value));
	}
});
```

#### 4. Implement Host Handler

```typescript
if (type === "mathOp") {
	const msg = msg as MathOpMessage;
	try {
		for (const row of msg.rows) {
			for (const col of msg.cols) {
				const oldValue = readCell(def, activeRom.bytes, row, col);
				let newValue = oldValue;
				
				switch (msg.operation) {
					case "add":
						newValue = oldValue + (msg.value ?? 0);
						break;
					case "multiply":
						newValue = oldValue * (msg.value ?? 1);
						break;
					case "clamp":
						newValue = Math.max(msg.min ?? 0, Math.min(msg.max ?? 255, oldValue));
						break;
				}
				
				writeCell(def, activeRom.bytes, row, col, newValue);
			}
		}
		
		const snapshot = snapshotTable(def, activeRom.bytes);
		await panel.webview.postMessage({ type: "update", snapshot, reason: msg.label });
	} catch (error) {
		await panel.webview.postMessage({
			type: "error",
			message: error.message,
			code: "MATH_OP_FAILED"
		});
	}
}
```

#### 5. Test the New Message Type

```typescript
it("handles mathOp message", async () => {
	const msg: MathOpMessage = {
		type: "mathOp",
		operation: "add",
		rows: [0, 1, 2],
		cols: [0, 1, 2],
		value: 10,
		label: "Add 10 to selection"
	};
	
	// Simulate webview sending message
	panel.webview.onDidReceiveMessage(msg);
	
	// Verify ROM bytes were updated
	// Verify "update" message was sent to webview
});
```

---

## Summary

The webview protocol enables safe, type-safe communication between the extension host and webview UI:

- **Discriminated unions** for type safety
- **Type guards** for message validation
- **Error handling** for validation and transient failures
- **Lifecycle management** from ready → init → updates → save
- **Extensibility** for adding new message types

Key principles:
- Host maintains authoritative state
- Webview is a view layer
- All messages are JSON with `type` field
- Errors are communicated explicitly
- Undo/redo managed by host
- Export handled by host with file I/O
