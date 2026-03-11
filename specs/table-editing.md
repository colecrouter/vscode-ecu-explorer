# Table Editing Specification

## Overview

Enable users to edit ROM calibration table values directly in the VS Code grid interface with full undo/redo support and real-time validation.

### Current State

- [`TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte) already renders editable numeric cells
- Clipboard selection operations exist (`Ctrl/Cmd+A`, `C`, `X`, `V`, `Escape`)
- Undo/redo exists at the webview and extension layers
- Keyboard navigation is inconsistent because cells are always native `<input type="number">` elements
- Native input behavior currently competes with intended grid navigation hotkeys

### User Value Proposition

- Edit ROM values directly in VS Code without external tools
- Spreadsheet-style keyboard navigation that feels intentional rather than browser-driven
- Clear separation between moving around the grid and editing a cell value
- Real-time validation feedback
- Full undo/redo support (Ctrl+Z / Ctrl+Y)
- Reactive graph updates on cell changes

### Acceptance Criteria

- [ ] Grid has an explicit active cell independent of native browser input focus
- [ ] Table navigation uses a dedicated navigation mode and does not rely on native `<input>` arrow-key behavior
- [ ] Arrow keys move the active cell in navigation mode
- [ ] Shift+Arrow extends the current selection
- [ ] Ctrl/Cmd+Arrow jumps to the edge of the current row or column
- [ ] Enter starts edit mode from navigation mode
- [ ] Typing a numeric character, decimal point, or minus sign starts edit mode and seeds the draft value
- [ ] Enter in edit mode commits the value
- [ ] Escape in edit mode cancels the value change and returns to navigation mode
- [ ] Tab/Shift+Tab commit and move next/previous cell with wrapping
- [ ] Validation errors prevent commit
- [ ] Undo/redo restores previous values
- [ ] Graph updates reactively on cell change
- [ ] Multiple cells can be edited in sequence
- [ ] 1D and 2D tables use consistent navigation semantics

---

## Architecture

### Data Flow: Navigation → Edit → Validation → Commit → Broadcast

```
User clicks cell or uses navigation hotkeys
    ↓
TableGrid sets active cell
    ↓
User presses Enter or types a value
    ↓
TableCell enters edit mode for the active cell
    ↓
User edits draft value
    ↓
User presses Enter / Tab / Shift+Tab to commit
    ↓
Webview sends "cellEdit" message to host
    ↓
Host validates value (range, dtype, monotonic)
    ↓
Host updates ROM bytes
    ↓
Host sends "cellCommit" or "error" message
    ↓
Webview receives response
    ↓
If commit: update snapshot, re-render cell, update graph
If error: show error, revert to old value
    ↓
Undo/redo stack updated on host
```

### Component Modifications

#### [`TableCell.svelte`](../packages/ui/src/lib/views/TableCell.svelte)

**Current**: Always renders as a numeric input and commits primarily on blur

**Changes**:

- Render plain cell content in navigation mode
- Render an input only for the active editing cell
- Accept external `isActive` / `isEditing` state from the grid
- Add `editValue` state (string)
- Add `error` state (string | null)
- Handle keyboard events for edit mode only (Enter, Escape, Tab, Shift+Tab)
- Show error message below cell if validation fails
- Highlight cell with error color on validation failure

**New Props**:

```typescript
interface TableCellProps {
  value: number;
  row: number;
  col: number;
  onEdit: (row: number, col: number, value: number) => Promise<void>;
  onNavigate: (
    direction: "up" | "down" | "left" | "right" | "next" | "prev"
  ) => void;
  isActive?: boolean;
  isEditing?: boolean;
  error?: string;
}
```

#### [`table.svelte.ts`](../packages/ui/src/lib/views/table.svelte.ts)

**Current**: Manages table snapshot state

**Changes**:

- Track `activeCell` separately from `editingCell`
- Track navigation mode vs edit mode
- Normalize 1D and 2D coordinates so the rendered grid owns navigation semantics
- Add helpers for next/previous cell movement and edge jumps
- Keep undo/redo methods and commit behavior aligned with host persistence

**New Methods**:

```typescript
export function applyEdit(row: number, col: number, value: number): void
export function undo(): void
export function redo(): void
export function cancelEdit(): void
export function setActiveCell(row: number, col: number, depth?: number): void
export function moveActiveCell(
  direction: "up" | "down" | "left" | "right" | "next" | "prev",
  options?: { extendSelection?: boolean; jumpToEdge?: boolean }
): void
export function getEditingCell(): { row: number; col: number; oldValue: number } | null
```

#### [`TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte)

**Current**: Renders the grid and partially intercepts keyboard shortcuts at document level

**Changes**:

- Own the active-cell model for the whole table
- Own navigation mode keyboard handling at the grid level
- Enter edit mode only for the active cell
- Pass `onEdit` callback to TableCell
- Pass `onNavigate` callback to TableCell
- Handle keyboard shortcuts for navigation, selection growth, and edge jumps
- Manage active cell, selection, and focus transitions
- Debounce graph re-renders on rapid edits

**New Event Handlers**:

```typescript
function handleCellEdit(row: number, col: number, value: number): void
function handleCellNavigate(direction: "up" | "down" | "left" | "right"): void
function handleKeyDown(event: KeyboardEvent): void
function handleJumpToEdge(direction: "up" | "down" | "left" | "right"): void
function enterEditMode(seedValue?: string): void
function exitEditMode(options?: { commit?: boolean; move?: "next" | "prev" | "down" }): void
```

### Webview Message Types

#### `cellEdit` - Webview → Host

```typescript
interface CellEditMessage {
  type: "cellEdit";
  row: number;
  col: number;
  value: number;
  label?: string; // e.g., "Edit cell (3, 5)"
}
```

**Host Behavior**:

1. Validate value (range, dtype, monotonic)
2. Call `TableView.set(row, col, value)` to update ROM bytes
3. Push edit to undo stack
4. Send `cellCommit` or `error` message
5. Broadcast `update` to all webviews

#### `cellCommit` - Host → Webview

```typescript
interface CellCommitMessage {
  type: "cellCommit";
  row: number;
  col: number;
  value: number;
  oldValue: number;
}
```

**Webview Behavior**:

1. Update local snapshot
2. Re-render affected cell
3. Update graph (debounced)
4. Clear edit state

#### `undo` / `redo` - Webview → Host

```typescript
interface UndoMessage {
  type: "undo";
}

interface RedoMessage {
  type: "redo";
}
```

**Host Behavior**:

1. Pop from undo/redo stack
2. Revert ROM bytes to previous state
3. Send `update` message with new snapshot

#### `update` - Host → Webview

```typescript
interface UpdateMessage {
  type: "update";
  snapshot: TableSnapshot;
  reason?: string; // "undo", "redo", "external", etc.
}
```

### Undo/Redo Stack Management

**Host-Side Stack** (in extension.ts):

```typescript
interface EditOperation {
  row: number;
  col: number;
  oldValue: number;
  newValue: number;
  timestamp: number;
  label?: string;
}

class UndoRedoManager {
  private undoStack: EditOperation[] = [];
  private redoStack: EditOperation[] = [];

  push(op: EditOperation): void {
    this.undoStack.push(op);
    this.redoStack = []; // Clear redo on new edit
  }

  undo(): EditOperation | null {
    const op = this.undoStack.pop();
    if (op) this.redoStack.push(op);
    return op;
  }

  redo(): EditOperation | null {
    const op = this.redoStack.pop();
    if (op) this.undoStack.push(op);
    return op;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
```

**Webview-Side State**:

- Track active cell and editing cell separately
- Keep transient draft/error state local to the editing cell
- Sync committed edits with the host on commit/undo/redo

---

## Implementation

### Files to Create

None (all modifications to existing files)

### Files to Modify

1. **[`packages/ui/src/lib/views/TableCell.svelte`](../packages/ui/src/lib/views/TableCell.svelte)**
   - Split navigation-mode display from edit-mode input
   - Handle edit-mode keyboard events
   - Show validation errors

2. **[`packages/ui/src/lib/views/table.svelte.ts`](../packages/ui/src/lib/views/table.svelte.ts)**
   - Add active-cell and navigation state management
   - Normalize 1D/2D navigation coordinates
   - Add movement helpers, including edge jumps

3. **[`packages/ui/src/lib/views/TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte)**
   - Pass callbacks and mode state to TableCell
   - Handle navigation-mode keyboard shortcuts
   - Manage active cell, edit mode, and selection expansion

4. **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)**
   - Add `UndoRedoManager` class
   - Handle `cellEdit` message
   - Handle `undo` / `redo` messages
   - Validate edits before commit

### Type Definitions

```typescript
// packages/ui/src/lib/types/transaction.ts

export interface EditOperation {
  row: number;
  col: number;
  oldValue: number;
  newValue: number;
  timestamp: number;
  label?: string;
}

export interface EditState {
  isEditing: boolean;
  row: number;
  col: number;
  oldValue: number;
  editValue: string;
  error: string | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
}
```

### Validation Logic

```typescript
// packages/core/src/view/table.ts

export interface ValidationOptions {
  minValue?: number;
  maxValue?: number;
  dtype?: ScalarType;
  monotonic?: boolean;
}

export function validateCellValue(
  value: number,
  options: ValidationOptions
): { valid: boolean; error?: string } {
  // Check dtype range
  if (options.dtype) {
    const range = getScalarTypeRange(options.dtype);
    if (value < range.min || value > range.max) {
      return {
        valid: false,
        error: `Value ${value} out of range [${range.min}, ${range.max}] for ${options.dtype}`
      };
    }
  }

  // Check min/max
  if (options.minValue !== undefined && value < options.minValue) {
    return {
      valid: false,
      error: `Value ${value} below minimum ${options.minValue}`
    };
  }

  if (options.maxValue !== undefined && value > options.maxValue) {
    return {
      valid: false,
      error: `Value ${value} exceeds maximum ${options.maxValue}`
    };
  }

  return { valid: true };
}
```

### Undo/Redo Implementation

**Host-side** (extension.ts):

```typescript
class TableEditManager {
  private undoStack: EditOperation[] = [];
  private redoStack: EditOperation[] = [];
  private activeRom: RomInstance;
  private tableDef: TableDefinition;

  async handleCellEdit(row: number, col: number, value: number): Promise<void> {
    const oldValue = this.tableView.get(row, col, "physical");
    
    // Validate
    const validation = validateCellValue(value, {
      dtype: this.tableDef.z.dtype,
      minValue: this.tableDef.z.minValue,
      maxValue: this.tableDef.z.maxValue
    });

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Update ROM
    this.tableView.set(row, col, value, "physical");

    // Push to undo stack
    this.undoStack.push({
      row,
      col,
      oldValue,
      newValue: value,
      timestamp: Date.now(),
      label: `Edit cell (${row}, ${col})`
    });

    // Clear redo stack
    this.redoStack = [];

    // Broadcast update
    this.broadcastUpdate("cellCommit", { row, col, value, oldValue });
  }

  async handleUndo(): Promise<void> {
    const op = this.undoStack.pop();
    if (!op) return;

    // Revert ROM
    this.tableView.set(op.row, op.col, op.oldValue, "physical");

    // Push to redo stack
    this.redoStack.push(op);

    // Broadcast update
    this.broadcastUpdate("update", { reason: "undo" });
  }

  async handleRedo(): Promise<void> {
    const op = this.redoStack.pop();
    if (!op) return;

    // Apply ROM
    this.tableView.set(op.row, op.col, op.newValue, "physical");

    // Push to undo stack
    this.undoStack.push(op);

    // Broadcast update
    this.broadcastUpdate("update", { reason: "redo" });
  }
}
```

---

## Testing

### Unit Tests

**File**: `packages/core/test/table.test.ts`

```typescript
describe("TableView.set()", () => {
  it("writes scaled value to ROM bytes", () => {
    // Test with scale/offset
  });

  it("validates value before write", () => {
    // Test validation
  });

  it("throws on out-of-range value", () => {
    // Test error handling
  });
});

describe("validateCellValue()", () => {
  it("validates dtype range", () => {
    // u8: [0, 255], i16: [-32768, 32767], etc.
  });

  it("validates min/max constraints", () => {
    // Custom min/max
  });

  it("returns error message on failure", () => {
    // Error message format
  });
});
```

### E2E Tests

**File**: `packages/ui/test/TableCell.test.ts`

```typescript
describe("TableCell editing", () => {
  it("renders plain text in navigation mode", () => {
    // Render cell, verify input is not active until editing begins
  });

  it("enters edit mode on Enter", () => {
    // Focus active cell, press Enter, verify input appears
  });

  it("commits value on Enter in edit mode", () => {
    // Type value, press Enter, verify onEdit called
  });

  it("cancels edit on Escape", () => {
    // Type value, press Escape, verify onEdit not called
  });

  it("commits and navigates on Tab", () => {
    // Press Tab, verify onEdit called and onNavigate called with "next"
  });

  it("shows validation error", () => {
    // Type invalid value, verify error message shown
  });
});

describe("TableGrid undo/redo", () => {
  it("moves active cell on Arrow keys in navigation mode", () => {
    // Focus cell, press ArrowRight, verify active cell changed
  });

  it("extends selection on Shift+Arrow", () => {
    // Focus cell, press Shift+ArrowRight, verify range selection
  });

  it("jumps to row edge on Ctrl+ArrowRight", () => {
    // Focus interior cell, press Ctrl+ArrowRight, verify last column selected
  });

  it("undoes cell edit on Ctrl+Z", () => {
    // Edit cell, press Ctrl+Z, verify value reverted
  });

  it("redoes cell edit on Ctrl+Y", () => {
    // Edit, undo, redo, verify value restored
  });

  it("clears redo stack on new edit", () => {
    // Edit, undo, edit different cell, verify redo unavailable
  });
});
```

### Integration Tests

**File**: `apps/vscode/test/table-editing.test.ts`

```typescript
describe("Table editing flow", () => {
  it("edits cell and broadcasts update", async () => {
    // Open ROM, open table, edit cell, verify update sent to webview
  });

  it("validates edit before commit", async () => {
    // Try to edit with invalid value, verify error sent
  });

  it("undoes edit and reverts ROM bytes", async () => {
    // Edit cell, undo, verify ROM bytes reverted
  });

  it("handles multiple edits in sequence", async () => {
    // Edit multiple cells, verify all committed
  });
});
```

---

## Accessibility

### Keyboard Navigation

- **Navigation mode**: Arrow keys move the active cell
- **Shift+Arrow**: Extend selection from the anchor cell
- **Ctrl/Cmd+Arrow**: Jump to the edge of the row or column
- **Enter**: Enter edit mode for the active cell
- **Typing numeric input**: Replace current cell display with a draft and enter edit mode
- **Tab**: Commit and move to next cell (right, then wrap)
- **Shift+Tab**: Commit and move to previous cell (left, then wrap)
- **Escape**: Cancel edit and return to navigation mode
- **Ctrl+Z**: Undo
- **Ctrl+Y**: Redo

### Screen Reader Support

- Announce cell coordinates on focus: "Row 3, Column 5"
- Announce edit mode: "Editing cell (3, 5), value 42.5"
- Announce validation error: "Error: Value exceeds maximum 255"
- Announce undo/redo: "Undo: Edit cell (3, 5)"

### Error Messages

- Clear, actionable error messages
- Highlight affected cell with error color
- Show error below cell in edit mode
- Persist error until user corrects or cancels

---

## Performance

### Large Table Editing

- Debounce graph re-renders (100ms)
- Batch multiple edits before broadcast
- Use virtual scrolling to limit DOM nodes
- Cache validation results

### Memory Usage with Undo Stack

- Limit undo stack to 100 operations (configurable)
- Store only row, col, oldValue, newValue (not full snapshot)
- Clear redo stack on new edit
- Implement memory-efficient stack with circular buffer

### Optimization Strategies

```typescript
// Debounce graph updates
const debouncedUpdateGraph = debounce(() => {
  updateGraph(snapshot);
}, 100);

// Batch edits
const batchEdits: EditOperation[] = [];
function flushBatch() {
  if (batchEdits.length > 0) {
    broadcastUpdate("update", { edits: batchEdits });
    batchEdits = [];
  }
}

// Limit undo stack
const MAX_UNDO_STACK = 100;
if (undoStack.length > MAX_UNDO_STACK) {
  undoStack.shift(); // Remove oldest
}
```

---

## Clipboard Operations (Implemented in v0.5)

### Overview

**Status**: Implemented (2026-02-12) ✅

Clipboard operations allow users to copy, cut, and paste table values using standard keyboard shortcuts. Data is formatted as Tab-Separated Values (TSV) for compatibility with Excel and other spreadsheet applications.

### Copy Operation (Ctrl+C / Cmd+C)

**Purpose**: Copy selected cell values to clipboard without modifying the table.

**Behavior**:
1. User selects cells in table grid
2. User presses Ctrl+C (Windows/Linux) or Cmd+C (Mac)
3. Selected values are formatted as TSV
4. TSV is written to system clipboard
5. Visual feedback shows "Copied to clipboard" toast

**Implementation**:
- Handler: [`handleCopy()`](../packages/ui/src/lib/views/TableGrid.svelte) in TableGrid.svelte
- Method: [`view.getSelectedValuesAsTSV()`](../packages/ui/src/lib/views/table.svelte.ts)
- API: `navigator.clipboard.writeText()`

**TSV Format**:
- Single cell: `"42.5"`
- Row: `"10\t20\t30\t40"`
- Column: `"10\n20\n30\n40"`
- Matrix: `"10\t20\n30\t40"`
- Empty cells (non-contiguous): `"10\t\t30"` (empty string for missing cells)

**Example**:
```typescript
// 2x2 selection
const tsv = view.getSelectedValuesAsTSV();
// Result: "10\t20\n30\t40"
```

### Cut Operation (Ctrl+X / Cmd+X)

**Purpose**: Copy selected cell values to clipboard and clear them from the table.

**Behavior**:
1. User selects cells in table grid
2. User presses Ctrl+X (Windows/Linux) or Cmd+X (Mac)
3. Selected values are formatted as TSV
4. TSV is written to system clipboard
5. Selected cells are cleared (set to 0)
6. Visual feedback shows "Cut to clipboard" toast
7. Undo transaction is created for the clear operation

**Implementation**:
- Handler: [`handleCut()`](../packages/ui/src/lib/views/TableGrid.svelte) in TableGrid.svelte
- Methods:
  - [`view.getSelectedValuesAsTSV()`](../packages/ui/src/lib/views/table.svelte.ts) - Get TSV
  - [`view.clearSelectedCells()`](../packages/ui/src/lib/views/table.svelte.ts) - Clear cells
- API: `navigator.clipboard.writeText()`

**Undo Support**:
- Cut operation creates undo transaction
- Transaction label: "Clear N cells"
- Undo restores original values
- Redo re-applies the clear

**Example**:
```typescript
// Cut 2x2 selection
const tsv = view.getSelectedValuesAsTSV(); // "10\t20\n30\t40"
await navigator.clipboard.writeText(tsv);
view.clearSelectedCells(); // Sets all to 0
// Can undo with Ctrl+Z
```

### Paste Operation

**Status**: Not implemented (planned for v1+)

**Planned Behavior**:
1. User selects starting cell
2. User presses Ctrl+V (Windows/Linux) or Cmd+V (Mac)
3. TSV data is read from clipboard
4. Values are parsed and validated
5. Values are written to table starting at selected cell
6. Undo transaction is created

**Challenges**:
- Validation of pasted values (dtype, range, constraints)
- Handling paste that exceeds table bounds
- Parsing TSV with different formats (Excel, Google Sheets, etc.)
- Undo/redo for batch paste operations

### Keyboard Shortcuts

| Shortcut | Operation | Description |
|----------|-----------|-------------|
| Arrow Keys | Move Active Cell | Move active cell in navigation mode |
| Shift+Arrow | Extend Selection | Expand selection one cell in the pressed direction |
| Ctrl+Arrow / Cmd+Arrow | Jump to Edge | Jump to first/last cell in row or column |
| Enter | Enter Edit Mode | Edit the active cell |
| Tab / Shift+Tab | Commit + Move | Commit current edit and move next/previous with wrapping |
| Escape | Cancel Edit / Clear Selection | Cancel edit mode; in navigation mode clears selection |
| Ctrl+C / Cmd+C | Copy | Copy selected cells to clipboard as TSV |
| Ctrl+X / Cmd+X | Cut | Copy to clipboard and clear selected cells |
| Ctrl+V / Cmd+V | Paste | Paste clipboard TSV into the current selection anchor |
| Ctrl+A / Cmd+A | Select All | Select all cells in table |
| Delete | Clear | Clear selected cells (set to 0) |

### TSV Format Specification

**Format**: Tab-Separated Values (TSV)

**Structure**:
- Cells in a row are separated by tabs (`\t`)
- Rows are separated by newlines (`\n`)
- Empty cells are represented as empty strings
- Values are formatted as numbers (no quotes)

**Compatibility**:
- Excel: ✅ Can paste directly into Excel
- Google Sheets: ✅ Can paste directly into Google Sheets
- LibreOffice Calc: ✅ Can paste directly into Calc
- Text editors: ✅ Can view/edit as plain text

**Example TSV**:
```
10	20	30
40	50	60
70	80	90
```

### Visual Feedback

**Copy Feedback**:
- Toast notification: "Copied to clipboard"
- Duration: 1 second
- Position: Fixed, top-right of viewport
- Style: Green background, white text

**Cut Feedback**:
- Toast notification: "Cut to clipboard"
- Duration: 1 second
- Position: Fixed, top-right of viewport
- Style: Orange background, white text

**Implementation**:
```svelte
{#if copyFeedback}
  <div class="clipboard-feedback">Copied to clipboard</div>
{/if}

{#if cutFeedback}
  <div class="clipboard-feedback">Cut to clipboard</div>
{/if}
```

### Error Handling

**Clipboard Access Denied**:
- Browser may deny clipboard access
- Error is logged to console
- User sees no feedback (silent failure)
- Workaround: User can manually select and copy text

**No Selection**:
- Copy/cut operations do nothing if no cells selected
- No error message shown
- Silent no-op

**Input Focus**:
- Copy/cut handlers check if user is typing in input field
- If so, handlers return early to allow native browser behavior
- This prevents interfering with text editing in cells

### Testing

**Test Coverage**:
- [`packages/ui/test/TableGrid-clipboard.test.ts`](../packages/ui/test/TableGrid-clipboard.test.ts)
- Tests for `getSelectedValuesAsMatrix()`
- Tests for `getSelectedValuesAsTSV()`
- Tests for `clearSelectedCells()`
- Tests for TSV format compatibility

**Test Cases**:
- Single cell copy
- Row copy
- Column copy
- Matrix copy
- Non-contiguous selection (with empty cells)
- Cut with undo/redo
- TSV format validation

---

## Safety

### Validation Before Commit

- Check dtype range (u8, i16, f32, etc.)
- Check min/max constraints
- Check monotonic constraints (for axes)
- Check ROM bounds (address within file)

### Error Recovery

- Revert to old value on validation failure
- Show error message to user
- Allow user to correct and retry
- Maintain undo/redo stack integrity

### User Confirmation

- Show confirmation dialog for large batch edits (> 100 cells)
- Show warning if editing axis (monotonicity risk)
- Show warning if checksum will be affected
- Require explicit save (Ctrl+S) to persist to file

---

## Future Enhancements

- [ ] Multi-cell selection and batch edit
- [ ] Find and replace with regex
- [ ] Paste from clipboard (CSV format)
- [ ] Undo/redo integration with VS Code native undo
- [ ] Cell comments and annotations
- [ ] Edit history view
- [ ] Collaborative editing (multiple users)

---

## Status

- [ ] Design approved
- [ ] Implementation started
- [ ] Code review
- [ ] Testing complete
- [ ] Documentation complete

---

## Related Documentation

- [`specs/WEBVIEW_PROTOCOL.md`](WEBVIEW_PROTOCOL.md) - Message types and lifecycle
- [`specs/validation.md`](validation.md) - Validation rules and constraints
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design and component interactions
- [`specs/TESTING.md`](TESTING.md) - Testing guidelines and patterns
