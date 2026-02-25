# Add Support for a New Table Type

This guide explains how to add support for a new table type (e.g., 4D table, 5D table) to the ECU Explorer.

## Prerequisites

- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Understand the table system architecture
- Read [`specs/TABLE_SCHEMA.md`](../specs/TABLE_SCHEMA.md) - Understand table schema definitions
- Understand existing table types (1D, 2D, 3D) by reviewing [`packages/core/src/view/table.ts`](../packages/core/src/view/table.ts)
- Understand the ROM definition format by reviewing [`specs/PROVIDER_GUIDE.md`](../specs/PROVIDER_GUIDE.md)

## Step-by-Step Instructions

### 1. Define the Table Type Schema

First, update the table schema to support the new table type.

**File**: [`packages/core/src/definition/table.ts`](../packages/core/src/definition/table.ts)

Add a new interface for your table type:

```typescript
export interface Table4D extends TableBase {
  type: '4d';
  rows: number;
  columns: number;
  depth: number;
  width: number;
  rowHeaders: number[];
  columnHeaders: number[];
  depthHeaders: number[];
  widthHeaders: number[];
  data: number[][][][];
}
```

Update the `Table` union type to include your new type:

```typescript
export type Table = Table1D | Table2D | Table3D | Table4D;
```

### 2. Add Type Guards

Add type guard functions to check if a table is your new type:

```typescript
export function isTable4D(table: Table): table is Table4D {
  return table.type === '4d';
}
```

### 3. Implement Table View Logic

Update the table view to handle the new type.

**File**: [`packages/core/src/view/table.ts`](../packages/core/src/view/table.ts)

Add methods to handle loading and editing your table type:

```typescript
private loadTable4D(definition: Table4D, rom: Uint8Array): void {
  // Implement 4D table loading logic
  // Extract data from ROM using definition offsets
  // Handle row/column/depth/width headers
}

private stageCell4D(row: number, col: number, depth: number, width: number, value: number): void {
  // Implement 4D cell staging logic
  // Validate value against table constraints
  // Stage the edit for commit
}
```

### 4. Update UI Components

Update the Svelte UI to display the new table type.

**File**: [`packages/ui/src/lib/views/TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte)

Add rendering logic for your table type:

```svelte
{#if table.type === '4d'}
  <div class="table-4d">
    <!-- Render 4D table UI -->
    <!-- Use nested loops for dimensions -->
  </div>
{/if}
```

### 5. Add Tests

Create comprehensive tests for your new table type.

**File**: [`packages/core/test/table.test.ts`](../packages/core/test/table.test.ts)

Add test cases:

```typescript
describe('Table4D', () => {
  it('loads 4D table from ROM', () => {
    const definition = createTable4DDefinition();
    const rom = createSampleRom();
    const table = new TableView(definition);
    table.loadFromROM(rom);
    
    expect(table.data).toBeDefined();
    expect(table.data.length).toBe(definition.rows);
  });

  it('stages 4D cell edits', () => {
    const table = createTable4D();
    table.stageCell(0, 0, 0, 0, 100);
    
    expect(table.staged.size).toBe(1);
  });

  it('commits 4D edits', () => {
    const table = createTable4D();
    table.stageCell(0, 0, 0, 0, 100);
    table.commit();
    
    expect(table.data[0][0][0][0]).toBe(100);
  });
});
```

### 6. Update ROM Definition Provider

Update the provider to parse your new table type from ROM definitions.

**File**: [`packages/providers/ecuflash/src/index.ts`](../packages/providers/ecuflash/src/index.ts)

Add parsing logic:

```typescript
function parseTable4D(element: Element): Table4D {
  const rows = parseInt(element.getAttribute('rows') || '0');
  const columns = parseInt(element.getAttribute('columns') || '0');
  const depth = parseInt(element.getAttribute('depth') || '0');
  const width = parseInt(element.getAttribute('width') || '0');
  
  return {
    type: '4d',
    name: element.getAttribute('name') || '',
    address: parseInt(element.getAttribute('address') || '0', 16),
    rows,
    columns,
    depth,
    width,
    // ... parse headers and other properties
  };
}
```

### 7. Update CSV Export/Import

Update CSV handling to support your new table type.

**File**: [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)

Add export logic:

```typescript
function exportTable4DToCSV(table: Table4D): string {
  // Implement 4D table CSV export
  // Format: headers + flattened data
  // Include dimension information
}

function importTable4DFromCSV(csv: string, table: Table4D): Table4D {
  // Implement 4D table CSV import
  // Parse headers and data
  // Validate against table constraints
}
```

## Common Mistakes and Fixes

### Mistake 1: Not Handling All Dimensions

**Problem**: Table data is incomplete or corrupted

**Fix**: Ensure all dimensions are properly initialized and accessed:
```typescript
// ✅ Correct: Initialize all dimensions
const data = Array(rows).fill(null).map(() =>
  Array(columns).fill(null).map(() =>
    Array(depth).fill(null).map(() =>
      Array(width).fill(0)
    )
  )
);

// ❌ Wrong: Missing nested initialization
const data = Array(rows).fill(Array(columns).fill(0));
```

### Mistake 2: Incorrect Offset Calculation

**Problem**: Data is read from wrong ROM addresses

**Fix**: Calculate offsets correctly for multi-dimensional tables:
```typescript
// ✅ Correct: Calculate offset for all dimensions
const offset = address + 
  (row * columns * depth * width + 
   col * depth * width + 
   d * width + 
   w) * bytesPerValue;

// ❌ Wrong: Missing dimension multipliers
const offset = address + (row + col + d + w) * bytesPerValue;
```

### Mistake 3: Not Updating Type Guards

**Problem**: New table type not recognized in type checks

**Fix**: Update all type guard functions and union types:
```typescript
// ✅ Correct: Include new type in union
export type Table = Table1D | Table2D | Table3D | Table4D;

// ✅ Correct: Add type guard
export function isTable4D(table: Table): table is Table4D {
  return table.type === '4d';
}
```

## Verification Checklist

- [ ] New table type interface defined in `table.ts`
- [ ] Type guards added for new type
- [ ] Table view methods implemented for loading/editing
- [ ] UI components updated to render new type
- [ ] Comprehensive tests written and passing
- [ ] ROM definition provider updated to parse new type
- [ ] CSV export/import updated for new type
- [ ] All existing tests still pass
- [ ] Coverage meets targets (≥80% lines, ≥75% branches)
- [ ] JSDoc comments added to new functions
- [ ] DEVELOPMENT.md updated with completion

## Links to Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`specs/TABLE_SCHEMA.md`](../specs/TABLE_SCHEMA.md) - Table schema specification
- [`specs/PROVIDER_GUIDE.md`](../specs/PROVIDER_GUIDE.md) - ROM definition provider guide
- [`packages/core/src/view/table.ts`](../packages/core/src/view/table.ts) - Table view implementation
- [`packages/core/test/table.test.ts`](../packages/core/test/table.test.ts) - Table tests
