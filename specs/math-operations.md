# Math Operations Specification

## Overview

Enable users to apply mathematical transformations to table values in batch, including add, multiply, clamp, and smooth operations with preview and undo support.

### User Value Proposition

- Batch modify values with formulas (add constant, multiply by factor)
- Constrain values to valid ranges (clamp)
- Smooth neighboring values (for 2D/3D tables)
- Preview changes before applying
- Full undo support
- Keyboard-accessible operations

### Acceptance Criteria

- [ ] Add constant to all selected values
- [ ] Multiply all selected values by constant
- [ ] Clamp values to min/max range
- [ ] Smooth neighboring values (2D/3D)
- [ ] Preview changes in dialog
- [ ] Apply operation with confirmation
- [ ] Undo operation with Ctrl+Z
- [ ] Show operation in undo history
- [ ] Validate results before apply
- [ ] Handle edge cases (overflow, underflow)

---

## Operations

### Add Operation

**Purpose**: Add a constant value to all selected cells

**Formula**: `newValue = oldValue + constant`

**Parameters**:
- `constant`: Number to add (can be negative)

**Validation**:
- Result must be within dtype range
- Result must be within min/max constraints
- Warn if any values will be clamped

**Example**:
```
Table values: [10, 20, 30, 40, 50]
Add: 5
Result: [15, 25, 35, 45, 55]
```

**Edge Cases**:
- Negative constant (subtract)
- Result exceeds max (clamp or error)
- Result below min (clamp or error)

### Multiply Operation

**Purpose**: Multiply all selected cells by a constant factor

**Formula**: `newValue = oldValue * factor`

**Parameters**:
- `factor`: Multiplication factor (can be < 1 for division)

**Validation**:
- Result must be within dtype range
- Result must be within min/max constraints
- Warn if any values will be clamped

**Example**:
```
Table values: [10, 20, 30, 40, 50]
Multiply: 1.5
Result: [15, 30, 45, 60, 75]
```

**Edge Cases**:
- Factor < 1 (division)
- Factor = 0 (all zeros)
- Result exceeds max (clamp or error)
- Floating-point precision

### Clamp Operation

**Purpose**: Constrain all selected cells to a min/max range

**Formula**: `newValue = max(min, min(max, oldValue))`

**Parameters**:
- `min`: Minimum value
- `max`: Maximum value

**Validation**:
- min <= max
- min/max within dtype range
- min/max within table constraints

**Example**:
```
Table values: [5, 15, 25, 35, 45]
Clamp: min=10, max=40
Result: [10, 15, 25, 35, 40]
```

**Edge Cases**:
- min = max (all values become same)
- min > max (error)
- Values already within range (no change)

### Smooth Operation

**Purpose**: Average neighboring values (for 2D/3D tables)

**Formula**: `newValue = average(neighbors)`

**Parameters**:
- `kernelSize`: Size of averaging kernel (3x3, 5x5, etc.)
- `iterations`: Number of smoothing passes

**Validation**:
- Kernel size must be odd (3, 5, 7, etc.)
- Iterations must be positive
- Warn if smoothing will lose detail

**Example** (3x3 kernel):
```
Before:
[10, 20, 30]
[40, 50, 60]
[70, 80, 90]

After (center cell):
50 → average(10, 20, 30, 40, 50, 60, 70, 80, 90) = 50

After (edge cell):
20 → average(10, 20, 30, 40, 50) = 30
```

**Edge Cases**:
- Kernel size larger than table
- Single row/column (1D smoothing)
- Boundary handling (pad with zeros or repeat edge)

---

## UI/UX

### Command-Based Implementation (v0.5)

**Status**: Implemented using VSCode commands with input boxes

Math operations are triggered via VSCode commands that prompt the user for parameters using native VSCode input boxes and quick picks. This provides a lightweight, keyboard-accessible interface without requiring a custom dialog UI.

**Available Commands**:
- `rom.mathOpAdd` - Add constant to selection
- `rom.mathOpMultiply` - Multiply selection by factor
- `rom.mathOpClamp` - Clamp selection to range
- `rom.mathOpSmooth` - Smooth selection (2D/3D only)

### Parameter Input

**Add Operation**:
- Single input box: "Enter constant to add (can be negative)"
- Placeholder: "e.g., 5 or -10"
- Validation: Must be a valid number
- Supports negative values for subtraction

**Multiply Operation**:
- Single input box: "Enter multiplication factor"
- Placeholder: "e.g., 1.5 or 0.5"
- Validation: Must be a valid number
- Supports factors < 1 for division

**Clamp Operation**:
- First input box: "Enter minimum value" (e.g., 0)
- Second input box: "Enter maximum value" (e.g., 255)
- Validation: Both must be numbers, max >= min

**Smooth Operation** (2D/3D tables only):
- Quick pick: Select kernel size (3, 5, 7, 9)
- Input box: "Enter number of iterations" (default: 1)
- Quick pick: Select boundary mode:
  - "Pad with zeros"
  - "Repeat edge values"
  - "Mirror edge values"

### Operation Flow

```
User invokes command (e.g., Ctrl+Shift+P → "Math: Add")
    ↓
VSCode shows input box(es) for parameters
    ↓
User enters values and confirms
    ↓
Extension sends "mathOp" message to webview
    ↓
Webview applies operation to selected cells
    ↓
Webview sends "mathOpComplete" message back
    ↓
Changes are reflected in table and undo stack
```

### Validation and Warnings

**Validation**:
- Parameters are validated in input boxes before sending
- Invalid inputs show error message and prevent submission
- Operations validate constraints (dtype range, min/max)

**Warnings**:
- Clamped values are logged to console
- Warning count included in `mathOpComplete` message
- Example: "2 values clamped to constraints"

**Error Handling**:
- Invalid operations send `error` message to host
- User sees error notification in VSCode
- Operation is not applied if validation fails

### Future Enhancement: Math Operation Dialog

**Status**: Not implemented (planned for v1+)

A custom dialog UI could provide:
- Preview of before/after values
- Visual warnings for out-of-range values
- Real-time validation feedback
- Undo/redo preview

**Planned Layout**:
```
┌─ Math Operation ─────────────────────┐
│ Operation: [Add ▼]                   │
│                                      │
│ Add constant to selected values      │
│                                      │
│ Constant: [_____]                    │
│                                      │
│ Preview (first 5 rows):              │
│ Before: [10, 20, 30, 40, 50]         │
│ After:  [15, 25, 35, 45, 55]         │
│                                      │
│ ⚠ 2 values will exceed max (255)     │
│                                      │
│ [Apply] [Cancel]                     │
└──────────────────────────────────────┘
```

### Undo Support

**Undo History**:
- Operation shown as single entry: "Add 5 to selection"
- Undo reverts all affected cells
- Redo re-applies operation

**Undo Label**:
```
"Add 5 to 45 cells"
"Multiply 1.5 to 45 cells"
"Clamp to [10, 40] for 45 cells"
"Smooth 3x3 kernel for 45 cells"
```

---

## Implementation

### Files to Create

1. **`packages/core/src/math/operations.ts`** - Math operation functions
2. **`packages/ui/src/lib/views/MathOpDialog.svelte`** - Operation dialog component

### Files to Modify

1. **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)**
   - Add "Table: Math Operations" command
   - Handle math operation messages

2. **[`packages/ui/src/lib/views/TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte)**
   - Add "Math Operations" button
   - Show operation dialog

3. **[`specs/WEBVIEW_PROTOCOL.md`](WEBVIEW_PROTOCOL.md)**
   - Add `mathOp` message type

### Operation Functions

```typescript
// packages/core/src/math/operations.ts

export interface MathOpResult {
  values: number[];
  warnings: string[];
  changedCount: number;
}

export function addConstant(
  values: number[],
  constant: number,
  constraints?: { min?: number; max?: number; dtype?: ScalarType }
): MathOpResult {
  const result: number[] = [];
  const warnings: string[] = [];
  let changedCount = 0;

  for (const value of values) {
    let newValue = value + constant;

    // Check constraints
    if (constraints?.min !== undefined && newValue < constraints.min) {
      warnings.push(`Value ${newValue} below minimum ${constraints.min}`);
      newValue = constraints.min;
    }

    if (constraints?.max !== undefined && newValue > constraints.max) {
      warnings.push(`Value ${newValue} exceeds maximum ${constraints.max}`);
      newValue = constraints.max;
    }

    result.push(newValue);
    if (newValue !== value) changedCount++;
  }

  return { values: result, warnings, changedCount };
}

export function multiplyConstant(
  values: number[],
  factor: number,
  constraints?: { min?: number; max?: number; dtype?: ScalarType }
): MathOpResult {
  const result: number[] = [];
  const warnings: string[] = [];
  let changedCount = 0;

  for (const value of values) {
    let newValue = value * factor;

    // Check constraints
    if (constraints?.min !== undefined && newValue < constraints.min) {
      warnings.push(`Value ${newValue} below minimum ${constraints.min}`);
      newValue = constraints.min;
    }

    if (constraints?.max !== undefined && newValue > constraints.max) {
      warnings.push(`Value ${newValue} exceeds maximum ${constraints.max}`);
      newValue = constraints.max;
    }

    result.push(newValue);
    if (newValue !== value) changedCount++;
  }

  return { values: result, warnings, changedCount };
}

export function clampValues(
  values: number[],
  min: number,
  max: number
): MathOpResult {
  if (min > max) {
    throw new Error(`min (${min}) must be <= max (${max})`);
  }

  const result: number[] = [];
  let changedCount = 0;

  for (const value of values) {
    const newValue = Math.max(min, Math.min(max, value));
    result.push(newValue);
    if (newValue !== value) changedCount++;
  }

  return { values: result, warnings: [], changedCount };
}

export function smoothValues(
  matrix: number[][],
  kernelSize: number = 3,
  iterations: number = 1,
  boundaryMode: "pad" | "repeat" | "mirror" = "pad"
): MathOpResult {
  if (kernelSize % 2 === 0) {
    throw new Error("Kernel size must be odd");
  }

  let result = matrix.map(row => [...row]);
  const radius = Math.floor(kernelSize / 2);

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: number[][] = [];

    for (let i = 0; i < result.length; i++) {
      const row: number[] = [];

      for (let j = 0; j < result[i].length; j++) {
        let sum = 0;
        let count = 0;

        for (let di = -radius; di <= radius; di++) {
          for (let dj = -radius; dj <= radius; dj++) {
            const ni = i + di;
            const nj = j + dj;

            if (isValidIndex(ni, nj, result, boundaryMode)) {
              sum += getValueAtIndex(result, ni, nj, boundaryMode);
              count++;
            }
          }
        }

        row.push(sum / count);
      }

      smoothed.push(row);
    }

    result = smoothed;
  }

  // Flatten for comparison
  const originalFlat = matrix.flat();
  const resultFlat = result.flat();
  let changedCount = 0;

  for (let i = 0; i < originalFlat.length; i++) {
    if (Math.abs(resultFlat[i] - originalFlat[i]) > 0.001) {
      changedCount++;
    }
  }

  return {
    values: resultFlat,
    warnings: [`Smoothing applied with ${kernelSize}x${kernelSize} kernel`],
    changedCount
  };
}

function isValidIndex(
  i: number,
  j: number,
  matrix: number[][],
  mode: string
): boolean {
  if (mode === "pad") {
    return i >= 0 && i < matrix.length && j >= 0 && j < matrix[0].length;
  }
  return true; // repeat/mirror always valid
}

function getValueAtIndex(
  matrix: number[][],
  i: number,
  j: number,
  mode: string
): number {
  if (i < 0 || i >= matrix.length || j < 0 || j >= matrix[0].length) {
    if (mode === "pad") return 0;
    if (mode === "repeat") {
      const ii = Math.max(0, Math.min(matrix.length - 1, i));
      const jj = Math.max(0, Math.min(matrix[0].length - 1, j));
      return matrix[ii][jj];
    }
    if (mode === "mirror") {
      const ii = i < 0 ? -i : i >= matrix.length ? 2 * matrix.length - i - 2 : i;
      const jj = j < 0 ? -j : j >= matrix[0].length ? 2 * matrix[0].length - j - 2 : j;
      return matrix[ii][jj];
    }
  }
  return matrix[i][j];
}
```

### Preview Calculation

```typescript
export function calculatePreview(
  values: number[],
  operation: MathOperation,
  maxRows: number = 5
): { before: number[]; after: number[]; warnings: string[] } {
  const before = values.slice(0, maxRows);
  
  let result: MathOpResult;

  switch (operation.type) {
    case "add":
      result = addConstant(before, operation.constant, operation.constraints);
      break;
    case "multiply":
      result = multiplyConstant(before, operation.factor, operation.constraints);
      break;
    case "clamp":
      result = clampValues(before, operation.min, operation.max);
      break;
    default:
      throw new Error(`Unknown operation: ${operation.type}`);
  }

  return {
    before,
    after: result.values,
    warnings: result.warnings
  };
}
```

### Webview Message Type

```typescript
// specs/WEBVIEW_PROTOCOL.md

interface MathOpMessage {
  type: "mathOp";
  operation: "add" | "multiply" | "clamp" | "smooth";
  rows: number[];
  cols: number[];
  constant?: number; // For add
  factor?: number; // For multiply
  min?: number; // For clamp
  max?: number; // For clamp
  kernelSize?: number; // For smooth
  iterations?: number; // For smooth
  label?: string;
}
```

---

## Testing

### Unit Tests

**File**: `packages/core/test/math-operations.test.ts`

```typescript
describe("Math Operations", () => {
  describe("addConstant", () => {
    it("adds constant to all values", () => {
      const result = addConstant([10, 20, 30], 5);
      expect(result.values).toEqual([15, 25, 35]);
      expect(result.changedCount).toBe(3);
    });

    it("handles negative constant (subtract)", () => {
      const result = addConstant([10, 20, 30], -5);
      expect(result.values).toEqual([5, 15, 25]);
    });

    it("clamps to max constraint", () => {
      const result = addConstant([10, 20, 30], 50, { max: 60 });
      expect(result.values).toEqual([10, 20, 30]); // Clamped
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("clamps to min constraint", () => {
      const result = addConstant([10, 20, 30], -50, { min: 0 });
      expect(result.values).toEqual([0, 0, 0]); // Clamped
    });
  });

  describe("multiplyConstant", () => {
    it("multiplies all values by factor", () => {
      const result = multiplyConstant([10, 20, 30], 1.5);
      expect(result.values).toEqual([15, 30, 45]);
    });

    it("handles factor < 1 (division)", () => {
      const result = multiplyConstant([10, 20, 30], 0.5);
      expect(result.values).toEqual([5, 10, 15]);
    });

    it("handles factor = 0", () => {
      const result = multiplyConstant([10, 20, 30], 0);
      expect(result.values).toEqual([0, 0, 0]);
    });
  });

  describe("clampValues", () => {
    it("clamps values to range", () => {
      const result = clampValues([5, 15, 25, 35, 45], 10, 40);
      expect(result.values).toEqual([10, 15, 25, 35, 40]);
      expect(result.changedCount).toBe(2);
    });

    it("throws if min > max", () => {
      expect(() => clampValues([10, 20, 30], 40, 10)).toThrow();
    });
  });

  describe("smoothValues", () => {
    it("smooths 2D matrix with 3x3 kernel", () => {
      const matrix = [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90]
      ];
      const result = smoothValues(matrix, 3, 1);
      expect(result.changedCount).toBeGreaterThan(0);
    });

    it("throws if kernel size is even", () => {
      expect(() => smoothValues([[1, 2], [3, 4]], 4)).toThrow();
    });
  });
});
```

### E2E Tests

**File**: `packages/ui/test/MathOpDialog.test.ts`

```typescript
describe("Math Operation Dialog", () => {
  it("renders operation selector", () => {
    // Verify dropdown with Add, Multiply, Clamp, Smooth
  });

  it("shows parameter inputs for Add", () => {
    // Select Add, verify constant input shown
  });

  it("shows parameter inputs for Multiply", () => {
    // Select Multiply, verify factor input shown
  });

  it("shows parameter inputs for Clamp", () => {
    // Select Clamp, verify min/max inputs shown
  });

  it("updates preview on parameter change", () => {
    // Change constant, verify preview updates
  });

  it("shows validation warnings", () => {
    // Enter value that will exceed max, verify warning shown
  });

  it("applies operation on confirm", () => {
    // Click Apply, verify onApply callback called
  });

  it("cancels operation on cancel", () => {
    // Click Cancel, verify dialog closed
  });
});
```

### Edge Cases

- Overflow (value exceeds dtype max)
- Underflow (value below dtype min)
- Floating-point precision
- Empty selection
- Single cell selection
- Large table (1000+ cells)
- Negative values
- Zero values
- Very large constants
- Very small factors

---

## Safety

### Validation Before Apply

- Check all results within dtype range
- Check all results within min/max constraints
- Show warnings for clamped values
- Require user confirmation if any values will be clamped

### Undo Support

- Operation treated as single undo entry
- User can undo with Ctrl+Z
- Redo support for operation

### User Confirmation

- Show preview before applying
- Show count of affected cells
- Show warnings for out-of-range values
- Require explicit "Apply" button click

### Bounds Checking

```typescript
export function validateMathOp(
  operation: MathOperation,
  values: number[],
  constraints: { min?: number; max?: number; dtype?: ScalarType }
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let result: MathOpResult;

  switch (operation.type) {
    case "add":
      result = addConstant(values, operation.constant, constraints);
      break;
    // ... other operations
  }

  // Check for clamping
  if (result.warnings.length > 0) {
    warnings.push(...result.warnings);
  }

  // Check for all zeros
  if (result.values.every(v => v === 0)) {
    warnings.push("Operation will result in all zeros");
  }

  return {
    valid: true,
    warnings
  };
}
```

---

## Future Enhancements

- [ ] Custom formula support (e.g., `x * 1.5 + 10`)
- [ ] Conditional operations (apply only if value > threshold)
- [ ] Interpolation between two tables
- [ ] Curve fitting
- [ ] Statistical operations (mean, median, std dev)
- [ ] Batch operations on multiple tables
- [ ] Operation history and replay

---

## Status

- [ ] Design approved
- [ ] Implementation started
- [ ] Code review
- [ ] Testing complete
- [ ] Documentation complete

---

## Related Documentation

- [`specs/table-editing.md`](table-editing.md) - Table editing and undo/redo
- [`specs/validation.md`](validation.md) - Validation rules
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- [`specs/TESTING.md`](TESTING.md) - Testing guidelines
