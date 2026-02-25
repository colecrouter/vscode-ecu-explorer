# Validation Specification

## Overview

Implement comprehensive validation rules to prevent invalid data entry, ensuring ROM integrity and safety during editing operations.

### User Value Proposition

- Real-time validation feedback on cell edits
- Prevent invalid values from being saved
- Clear error messages with correction suggestions
- Monotonic axis validation
- Data type range enforcement
- Custom validation rules per table

### Acceptance Criteria

- [x] Validate min/max constraints on edit
- [x] Validate data type ranges (u8, i16, f32, etc.)
- [x] Validate monotonic constraints on axes
- [x] Show validation errors in real-time
- [x] Prevent commit of invalid values
- [x] Suggest valid value ranges
- [x] Support custom validation rules
- [x] Validate on import
- [x] Validate on save
- [x] Highlight invalid cells

## Implementation Status

**Status**: ✅ Complete (v0.6)

**Completion Date**: 2026-02-14

**Implementation Notes**:
- Validation module implemented in [`packages/core/src/validation/`](../../packages/core/src/validation/)
- Real-time validation integrated into TableCell component
- CSV import validation prevents invalid data entry
- All validation rules tested with 64 test cases
- Coverage: 85%+ for validation module

**Key Features Implemented**:
1. Min/Max constraint validation with range suggestions
2. Data type range validation for all scalar types
3. Monotonic axis validation for 1D/2D/3D tables
4. Real-time validation feedback in UI
5. CSV import validation with error reporting
6. Custom validation rule support
7. Invalid cell highlighting in table grid

**Test Coverage**:
- Unit tests: 64 tests in [`packages/core/test/validation.test.ts`](../../packages/core/test/validation.test.ts)
- Integration tests: CSV import validation in [`apps/vscode/test/csv-import.test.ts`](../../apps/vscode/test/csv-import.test.ts)
- UI tests: TableCell validation in [`packages/ui/test/table.svelte.test.ts`](../../packages/ui/test/table.svelte.test.ts)

**Deferred Features** (v1.x):
- 3D table validation (deferred to v1.x for performance optimization)
- Advanced validation rules (regex patterns, custom formulas)
- Validation rule versioning and migration

---

## Validation Rules

### Min/Max Validation

**Purpose**: Ensure values stay within defined range

**Definition**:
```typescript
interface MinMaxConstraint {
  min: number;
  max: number;
  description?: string; // e.g., "Boost pressure (kPa)"
}
```

**Validation Logic**:
```typescript
function validateMinMax(
  value: number,
  constraint: MinMaxConstraint
): ValidationResult {
  if (value < constraint.min) {
    return {
      valid: false,
      error: `Value ${value} below minimum ${constraint.min}`,
      code: "VALUE_BELOW_MIN",
      suggestion: `Use minimum value ${constraint.min}`
    };
  }

  if (value > constraint.max) {
    return {
      valid: false,
      error: `Value ${value} exceeds maximum ${constraint.max}`,
      code: "VALUE_ABOVE_MAX",
      suggestion: `Use maximum value ${constraint.max}`
    };
  }

  return { valid: true };
}
```

**Example**:
```
Table: Boost Target Engine Load
Min: 0.0 kPa
Max: 300.0 kPa
User enters: 350.0 kPa
Error: "Value 350.0 exceeds maximum 300.0 kPa"
Suggestion: "Use maximum value 300.0"
```

### Data Type Validation

**Purpose**: Ensure values fit within scalar type range

**Scalar Types**:
- `u8`: [0, 255]
- `i8`: [-128, 127]
- `u16`: [0, 65535]
- `i16`: [-32768, 32767]
- `u32`: [0, 4294967295]
- `i32`: [-2147483648, 2147483647]
- `f32`: [-3.4e38, 3.4e38]

**Validation Logic**:
```typescript
function getScalarTypeRange(dtype: ScalarType): { min: number; max: number } {
  switch (dtype) {
    case "u8":
      return { min: 0, max: 255 };
    case "i8":
      return { min: -128, max: 127 };
    case "u16":
      return { min: 0, max: 65535 };
    case "i16":
      return { min: -32768, max: 32767 };
    case "u32":
      return { min: 0, max: 4294967295 };
    case "i32":
      return { min: -2147483648, max: 2147483647 };
    case "f32":
      return { min: -3.4e38, max: 3.4e38 };
    default:
      throw new Error(`Unknown scalar type: ${dtype}`);
  }
}

function validateDataType(
  value: number,
  dtype: ScalarType
): ValidationResult {
  const range = getScalarTypeRange(dtype);

  if (value < range.min || value > range.max) {
    return {
      valid: false,
      error: `Value ${value} out of range for ${dtype} type`,
      code: "TYPE_OUT_OF_RANGE",
      suggestion: `Use value between ${range.min} and ${range.max}`
    };
  }

  // Check for floating-point precision
  if (dtype === "f32" && !Number.isFinite(value)) {
    return {
      valid: false,
      error: `Value ${value} is not a valid number`,
      code: "INVALID_NUMBER",
      suggestion: "Enter a valid decimal number"
    };
  }

  return { valid: true };
}
```

**Example**:
```
Table: Fuel Injection Timing (u8)
User enters: 300
Error: "Value 300 out of range for u8 type"
Suggestion: "Use value between 0 and 255"
```

### Monotonic Validation

**Purpose**: Ensure axis values are strictly increasing or decreasing

**Definition**:
```typescript
interface MonotonicConstraint {
  direction: "increasing" | "decreasing";
  strict?: boolean; // true = strictly increasing, false = non-decreasing
}
```

**Validation Logic**:
```typescript
function validateMonotonic(
  values: number[],
  constraint: MonotonicConstraint
): ValidationResult {
  const { direction, strict = true } = constraint;

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];

    if (direction === "increasing") {
      if (strict && curr <= prev) {
        return {
          valid: false,
          error: `Values not strictly increasing at index ${i}: ${prev} >= ${curr}`,
          code: "NOT_STRICTLY_INCREASING",
          suggestion: `Use value > ${prev}`
        };
      }

      if (!strict && curr < prev) {
        return {
          valid: false,
          error: `Values not increasing at index ${i}: ${prev} > ${curr}`,
          code: "NOT_INCREASING",
          suggestion: `Use value >= ${prev}`
        };
      }
    } else {
      if (strict && curr >= prev) {
        return {
          valid: false,
          error: `Values not strictly decreasing at index ${i}: ${prev} <= ${curr}`,
          code: "NOT_STRICTLY_DECREASING",
          suggestion: `Use value < ${prev}`
        };
      }

      if (!strict && curr > prev) {
        return {
          valid: false,
          error: `Values not decreasing at index ${i}: ${prev} < ${curr}`,
          code: "NOT_DECREASING",
          suggestion: `Use value <= ${prev}`
        };
      }
    }
  }

  return { valid: true };
}
```

**Example**:
```
Table: RPM Axis (strictly increasing)
Current values: [1000, 1500, 2000, 2500, 3000]
User edits index 2 to: 1800
Error: "Values not strictly increasing at index 2: 1500 >= 1800"
Suggestion: "Use value > 1500"
```

### Custom Validation Rules

**Purpose**: Support table-specific validation logic

**Definition**:
```typescript
interface CustomValidationRule {
  name: string;
  description: string;
  validate: (value: number, context: ValidationContext) => ValidationResult;
}

interface ValidationContext {
  row: number;
  col: number;
  oldValue: number;
  newValue: number;
  table: TableDefinition;
  snapshot: TableSnapshot;
}
```

**Example**:
```typescript
const boostTargetRule: CustomValidationRule = {
  name: "boost-target-consistency",
  description: "Boost target must increase with RPM",
  validate: (value: number, context: ValidationContext) => {
    const { row, col, snapshot } = context;

    // Check if value is less than previous row
    if (row > 0 && snapshot.z[row - 1][col] > value) {
      return {
        valid: false,
        error: `Boost target ${value} less than previous row ${snapshot.z[row - 1][col]}`,
        code: "INCONSISTENT_BOOST",
        suggestion: `Use value >= ${snapshot.z[row - 1][col]}`
      };
    }

    return { valid: true };
  }
};
```

---

## Validation Timing

### On Cell Edit (Real-Time)

**Trigger**: User types value in cell

**Validation**:
1. Check data type range
2. Check min/max constraints
3. Check custom rules

**Feedback**:
- Show error message below cell
- Highlight cell with error color
- Disable Enter key (prevent commit)
- Show suggestion

**Example**:
```
User types: 300 (in u8 field)
    ↓
Validation runs
    ↓
Error shown: "Value 300 out of range for u8 type"
    ↓
Enter key disabled
    ↓
User corrects to: 255
    ↓
Error cleared
    ↓
Enter key enabled
```

### On Cell Commit (Before Save)

**Trigger**: User presses Enter or clicks away

**Validation**:
1. All real-time validations
2. Monotonic constraints (if axis)
3. Custom rules

**Feedback**:
- If valid: commit to ROM, send cellCommit message
- If invalid: show error, revert to old value

**Example**:
```
User presses Enter
    ↓
Validation runs
    ↓
If valid: ROM updated, cellCommit sent
If invalid: error shown, value reverted
```

### On Import (Before Apply)

**Trigger**: User confirms CSV import

**Validation**:
1. Dimension validation
2. Data type validation
3. Min/max validation
4. Monotonic validation (for axes)
5. Custom rules

**Feedback**:
- Show validation errors in preview
- Prevent import if critical errors
- Allow import with warnings

**Example**:
```
User imports CSV
    ↓
Preview shown with validation results
    ↓
Errors: "2 values exceed maximum"
Warnings: "Axis not strictly increasing"
    ↓
User can cancel or proceed with warnings
```

### On Save (Final Validation)

**Trigger**: User saves ROM

**Validation**:
1. All cell validations
2. Checksum validation
3. ROM bounds validation

**Feedback**:
- If valid: save proceeds
- If invalid: show error, abort save

**Example**:
```
User presses Ctrl+S
    ↓
Final validation runs
    ↓
If valid: ROM saved
If invalid: error shown, save aborted
```

---

## Error Handling

### Error Messages

**Format**: `<error_message> <suggestion>`

**Examples**:
```
"Value 300 exceeds maximum 255 for u8 type. Use value between 0 and 255."
"Values not strictly increasing at index 2: 1500 >= 1800. Use value > 1500."
"Boost target 50 less than previous row 60. Use value >= 60."
```

**Clarity**:
- Use plain language
- Avoid technical jargon
- Include current and expected values
- Provide actionable suggestion

### Highlighting Invalid Cells

**Visual Feedback**:
- Red border around cell
- Red background (light)
- Error icon
- Error message below cell

**Example**:
```
┌─────────────────────┐
│ ┌─────────────────┐ │
│ │ 300 ✗           │ │
│ └─────────────────┘ │
│ Value exceeds max   │
│ Use value ≤ 255     │
└─────────────────────┘
```

### Suggestions for Correction

**Types**:
- Clamp to valid range: "Use value between 0 and 255"
- Use previous value: "Use value >= 1500"
- Use default value: "Use default value 100"

**Implementation**:
```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  suggestion?: string;
  suggestedValue?: number;
}
```

### Undo Invalid Changes

**Process**:
1. User enters invalid value
2. Validation fails
3. User presses Escape or clicks away
4. Value reverts to previous

**Example**:
```
Old value: 100
User types: 300
Error shown
User presses Escape
Value reverts to: 100
```

---

## Implementation

### Files to Create

1. **`packages/core/src/validation/rules.ts`** - Validation rule definitions
2. **`packages/core/src/validation/validator.ts`** - Validation logic

### Files to Modify

1. **[`packages/ui/src/lib/views/TableCell.svelte`](../packages/ui/src/lib/views/TableCell.svelte)**
   - Show validation errors
   - Highlight invalid cells
   - Disable commit on error

2. **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)**
   - Validate on cellEdit message
   - Return error if invalid

### Validation Functions

```typescript
// packages/core/src/validation/validator.ts

export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  suggestion?: string;
  suggestedValue?: number;
}

export interface ValidationContext {
  row: number;
  col: number;
  oldValue: number;
  newValue: number;
  table: TableDefinition;
  snapshot: TableSnapshot;
}

export class Validator {
  constructor(
    private table: TableDefinition,
    private snapshot: TableSnapshot,
    private customRules?: CustomValidationRule[]
  ) {}

  validate(row: number, col: number, value: number): ValidationResult {
    // 1. Data type validation
    const typeResult = validateDataType(value, this.table.z.dtype);
    if (!typeResult.valid) return typeResult;

    // 2. Min/max validation
    if (this.table.z.minValue !== undefined || this.table.z.maxValue !== undefined) {
      const minMaxResult = validateMinMax(value, {
        min: this.table.z.minValue ?? -Infinity,
        max: this.table.z.maxValue ?? Infinity
      });
      if (!minMaxResult.valid) return minMaxResult;
    }

    // 3. Monotonic validation (for axes)
    if (this.isAxisCell(row, col)) {
      const monoResult = this.validateAxisMonotonic(row, col, value);
      if (!monoResult.valid) return monoResult;
    }

    // 4. Custom rules
    if (this.customRules) {
      const context: ValidationContext = {
        row,
        col,
        oldValue: this.snapshot.z[row][col],
        newValue: value,
        table: this.table,
        snapshot: this.snapshot
      };

      for (const rule of this.customRules) {
        const result = rule.validate(value, context);
        if (!result.valid) return result;
      }
    }

    return { valid: true };
  }

  private isAxisCell(row: number, col: number): boolean {
    // Check if this is an axis cell (X or Y)
    // Implementation depends on table structure
    return false;
  }

  private validateAxisMonotonic(
    row: number,
    col: number,
    value: number
  ): ValidationResult {
    // Validate monotonic constraint for axis
    // Implementation depends on axis definition
    return { valid: true };
  }
}
```

### Error Display Component

```svelte
<!-- packages/ui/src/lib/views/ValidationError.svelte -->

<script lang="ts">
  import type { ValidationResult } from "@repo/core";

  export let error: ValidationResult | null = null;
  export let isEditing = false;

  $: showError = error && !error.valid && isEditing;
</script>

{#if showError}
  <div class="validation-error">
    <div class="error-icon">✗</div>
    <div class="error-content">
      <div class="error-message">{error.error}</div>
      {#if error.suggestion}
        <div class="error-suggestion">{error.suggestion}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .validation-error {
    display: flex;
    gap: 8px;
    padding: 8px;
    background-color: #fee;
    border: 1px solid #f00;
    border-radius: 4px;
    font-size: 12px;
    color: #c00;
  }

  .error-icon {
    font-weight: bold;
    flex-shrink: 0;
  }

  .error-message {
    font-weight: 500;
  }

  .error-suggestion {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 4px;
  }
</style>
```

---

## Testing

### Unit Tests

**File**: `packages/core/test/validation.test.ts`

```typescript
describe("Validation Rules", () => {
  describe("Min/Max Validation", () => {
    it("validates value within range", () => {
      const result = validateMinMax(50, { min: 0, max: 100 });
      expect(result.valid).toBe(true);
    });

    it("rejects value below minimum", () => {
      const result = validateMinMax(-10, { min: 0, max: 100 });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("VALUE_BELOW_MIN");
    });

    it("rejects value above maximum", () => {
      const result = validateMinMax(150, { min: 0, max: 100 });
      expect(result.valid).toBe(false);
      expect(result.code).toBe("VALUE_ABOVE_MAX");
    });
  });

  describe("Data Type Validation", () => {
    it("validates u8 range", () => {
      expect(validateDataType(0, "u8").valid).toBe(true);
      expect(validateDataType(255, "u8").valid).toBe(true);
      expect(validateDataType(256, "u8").valid).toBe(false);
      expect(validateDataType(-1, "u8").valid).toBe(false);
    });

    it("validates i16 range", () => {
      expect(validateDataType(-32768, "i16").valid).toBe(true);
      expect(validateDataType(32767, "i16").valid).toBe(true);
      expect(validateDataType(-32769, "i16").valid).toBe(false);
      expect(validateDataType(32768, "i16").valid).toBe(false);
    });
  });

  describe("Monotonic Validation", () => {
    it("validates strictly increasing", () => {
      const result = validateMonotonic([1, 2, 3, 4, 5], {
        direction: "increasing",
        strict: true
      });
      expect(result.valid).toBe(true);
    });

    it("rejects non-increasing", () => {
      const result = validateMonotonic([1, 2, 2, 4, 5], {
        direction: "increasing",
        strict: true
      });
      expect(result.valid).toBe(false);
    });

    it("validates non-decreasing", () => {
      const result = validateMonotonic([1, 2, 2, 4, 5], {
        direction: "increasing",
        strict: false
      });
      expect(result.valid).toBe(true);
    });
  });
});
```

### E2E Tests

**File**: `packages/ui/test/validation.test.ts`

```typescript
describe("Validation UI", () => {
  it("shows error on invalid input", () => {
    // Type invalid value, verify error shown
  });

  it("disables Enter on error", () => {
    // Type invalid value, press Enter, verify not committed
  });

  it("clears error on valid input", () => {
    // Type invalid, then valid value, verify error cleared
  });

  it("shows suggestion", () => {
    // Type invalid value, verify suggestion shown
  });

  it("highlights invalid cell", () => {
    // Type invalid value, verify cell highlighted
  });
});
```

---

## Performance

### Real-Time Validation Performance

**Target**: < 10ms per validation

**Optimization**:
- Cache validation results
- Debounce validation on rapid input (50ms)
- Lazy validate custom rules
- Parallel validation for independent rules

### Large Table Validation

**Target**: < 500ms for full table validation

**Optimization**:
- Validate only changed cells
- Batch validation for imports
- Use Web Workers for heavy validation
- Cache axis validation results

---

## Accessibility

### WCAG Compliance

- Error messages announced by screen reader
- Error color not sole indicator (use icon + text)
- Keyboard navigation to error messages
- High contrast error colors

### Screen Reader Support

```html
<div role="alert" aria-live="polite">
  <span class="error-icon" aria-label="Error">✗</span>
  <span class="error-message">Value 300 exceeds maximum 255</span>
</div>
```

---

## Future Enhancements

- [ ] Custom validation rule editor
- [ ] Validation rule templates
- [ ] Batch validation with progress
- [ ] Validation history
- [ ] Validation statistics
- [ ] Machine learning-based anomaly detection
- [ ] Cross-table validation rules

---

## Status

- [ ] Design approved
- [ ] Implementation started
- [ ] Code review
- [ ] Testing complete
- [ ] Documentation complete

---

## Related Documentation

- [`specs/table-editing.md`](table-editing.md) - Table editing
- [`specs/csv-import-export.md`](csv-import-export.md) - CSV import validation
- [`specs/rom-save.md`](rom-save.md) - Save validation
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- [`specs/TESTING.md`](TESTING.md) - Testing guidelines
