# Implement a Feature from Specification

This guide explains how to implement a feature from a specification in ECU Explorer.

## Prerequisites

- Read [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Current development phase
- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- Understand the feature specification in [`specs/`](../specs/)
- Understand testing requirements: [`specs/TESTING.md`](../specs/TESTING.md)

## Step-by-Step Implementation Process

### 1. Read and Understand the Specification

**File**: `specs/[feature-name].md`

Read the entire specification and understand:

- **What**: What does the feature do?
- **Why**: Why is this feature needed?
- **How**: How should it work?
- **Acceptance Criteria**: What must be true for the feature to be complete?

**Example**:

```markdown
# CSV Export Feature

## Overview
Allow users to export table data to CSV format for use in spreadsheets.

## Acceptance Criteria
- [ ] User can right-click table and select "Export as CSV"
- [ ] CSV file is created with correct headers
- [ ] All table data is included in CSV
- [ ] CSV can be opened in Excel/Sheets
- [ ] File is saved to user-selected location
```

### 2. Check Acceptance Criteria

List all acceptance criteria from the spec:

```markdown
## Acceptance Criteria Checklist

- [ ] User can right-click table and select "Export as CSV"
- [ ] CSV file is created with correct headers
- [ ] All table data is included in CSV
- [ ] CSV can be opened in Excel/Sheets
- [ ] File is saved to user-selected location
- [ ] Error handling for invalid tables
- [ ] Performance acceptable for large tables
- [ ] Documentation updated
```

### 3. Plan Implementation

Break down the feature into tasks:

```markdown
## Implementation Plan

### Phase 1: Core Logic
- [ ] Create CSV export function in core package
- [ ] Handle 1D, 2D, 3D tables
- [ ] Format headers correctly
- [ ] Format data correctly

### Phase 2: VSCode Integration
- [ ] Add "Export as CSV" command
- [ ] Add context menu item
- [ ] Handle file save dialog
- [ ] Show success/error messages

### Phase 3: Testing
- [ ] Write unit tests for CSV export
- [ ] Write integration tests for command
- [ ] Test with various table types
- [ ] Test error cases

### Phase 4: Documentation
- [ ] Update README with feature
- [ ] Add JSDoc comments
- [ ] Update DEVELOPMENT.md
```

### 4. Write Tests First (TDD)

Create test file for your feature:

**File**: `packages/core/test/csv-export.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { exportTableToCsv } from '../src/csv-export';
import { createTable1D, createTable2D } from './fixtures/sample-tables';

describe('CSV Export', () => {
  it('exports 1D table to CSV', () => {
    const table = createTable1D();
    const csv = exportTableToCsv(table);
    
    expect(csv).toContain('Name');
    expect(csv).toContain('Value');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });
  
  it('exports 2D table to CSV', () => {
    const table = createTable2D();
    const csv = exportTableToCsv(table);
    
    expect(csv).toContain('Row');
    expect(csv).toContain('Column');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });
  
  it('handles empty tables', () => {
    const table = createTable1D();
    table.data = [];
    
    const csv = exportTableToCsv(table);
    expect(csv).toContain('Name');
  });
  
  it('throws on invalid table', () => {
    expect(() => exportTableToCsv(null)).toThrow();
  });
});
```

### 5. Implement Core Logic

Implement the feature in the core package:

**File**: `packages/core/src/csv-export.ts`

```typescript
import type { Table } from './definition/table';

/**
 * Export table data to CSV format
 * 
 * Converts table data to CSV with headers and values.
 * Handles 1D, 2D, and 3D tables.
 * 
 * @param table - Table to export
 * @returns CSV string
 * @throws Error if table is invalid
 * @example
 * const csv = exportTableToCsv(table);
 * fs.writeFileSync('table.csv', csv);
 */
export function exportTableToCsv(table: Table): string {
  if (!table) {
    throw new Error('Table is required');
  }
  
  switch (table.type) {
    case '1d':
      return exportTable1D(table);
    case '2d':
      return exportTable2D(table);
    case '3d':
      return exportTable3D(table);
    default:
      throw new Error(`Unsupported table type: ${table.type}`);
  }
}

function exportTable1D(table: Table1D): string {
  const lines: string[] = [];
  
  // Add header
  lines.push('Index,Name,Value');
  
  // Add data
  table.data.forEach((value, index) => {
    const name = table.headers?.[index] || '';
    lines.push(`${index},"${name}",${value}`);
  });
  
  return lines.join('\n');
}

function exportTable2D(table: Table2D): string {
  const lines: string[] = [];
  
  // Add header row
  const header = ['Row', 'Column', ...table.columnHeaders.map(h => `"${h}"`)];
  lines.push(header.join(','));
  
  // Add data rows
  table.data.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const rowName = table.rowHeaders?.[rowIndex] || '';
      const colName = table.columnHeaders?.[colIndex] || '';
      lines.push(`"${rowName}","${colName}",${value}`);
    });
  });
  
  return lines.join('\n');
}

function exportTable3D(table: Table3D): string {
  // Similar implementation for 3D tables
  // ...
}
```

### 6. Run Tests

Run the tests to verify implementation:

```bash
npm run test -- csv-export.test.ts
```

All tests should pass.

### 7. Integrate with VSCode

Add VSCode command for the feature:

**File**: `apps/vscode/src/extension.ts`

```typescript
import { exportTableToCsv } from '@ecu-explorer/core';

/**
 * Handle export table as CSV command
 */
async function exportTableCsvHandler(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Get current table from webview
    const table = getCurrentTable();
    if (!table) {
      vscode.window.showErrorMessage('No table selected');
      return;
    }
    
    // Generate CSV
    const csv = exportTableToCsv(table);
    
    // Show save dialog
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${table.name}.csv`),
      filters: { 'CSV files': ['csv'] },
    });
    
    if (!uri) return;
    
    // Write file
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(csv));
    
    vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
  } catch (error) {
    logger.error('Export failed', { error });
    vscode.window.showErrorMessage(`Export failed: ${error.message}`);
  }
}

// Register command
const exportCommand = vscode.commands.registerCommand(
  'ecu-explorer.exportCsv',
  () => exportTableCsvHandler(context)
);
context.subscriptions.push(exportCommand);
```

### 8. Add to Command Palette

**File**: `apps/vscode/package.json`

```json
{
  "contributes": {
    "commands": [
      {
        "command": "ecu-explorer.exportCsv",
        "title": "ECU Explorer: Export Table as CSV",
        "category": "ECU Explorer"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "ecu-explorer.exportCsv",
          "when": "resourceExtname == .hex",
          "group": "1_modification"
        }
      ]
    }
  }
}
```

### 9. Write Integration Tests

**File**: `apps/vscode/test/csv-export.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension';

describe('CSV Export Command', () => {
  it('exports table as CSV', async () => {
    const context = createMockContext();
    activate(context);
    
    const result = await vscode.commands.executeCommand('ecu-explorer.exportCsv');
    
    expect(result).toBeDefined();
  });
  
  it('shows error when no table selected', async () => {
    const context = createMockContext();
    activate(context);
    
    const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage');
    
    await vscode.commands.executeCommand('ecu-explorer.exportCsv');
    
    expect(showErrorSpy).toHaveBeenCalled();
  });
});
```

### 10. Update Documentation

Update README and specs:

**File**: [`README.md`](../README.md)

```markdown
## Features

- Open and view ROM files
- Edit table values
- **Export tables to CSV** - Export table data for use in spreadsheets
- Undo/redo support
```

**File**: [`DEVELOPMENT.md`](../DEVELOPMENT.md)

```markdown
## Phase 3: Data Export

- [x] CSV Export - Export table data to CSV format
  - Completed: 2024-01-15
  - Commit: abc1234
  - Coverage: 85% → 88%
```

### 11. Verify Against Acceptance Criteria

Check all acceptance criteria:

```markdown
## Acceptance Criteria Verification

- [x] User can right-click table and select "Export as CSV"
- [x] CSV file is created with correct headers
- [x] All table data is included in CSV
- [x] CSV can be opened in Excel/Sheets
- [x] File is saved to user-selected location
- [x] Error handling for invalid tables
- [x] Performance acceptable for large tables
- [x] Documentation updated
```

### 12. Run Full Test Suite

Run all tests to ensure no regressions:

```bash
npm run test:coverage
```

Verify:

- All tests pass
- Coverage meets targets
- No new warnings

### 13. Commit Changes

Commit with clear message:

```bash
git add .
git commit -m "feat: Implement CSV export feature

- Add exportTableToCsv function to core package
- Support 1D, 2D, 3D table export
- Add 'Export as CSV' command to VSCode
- Add context menu integration
- Comprehensive test coverage

Link to spec: specs/csv-export.md
Coverage: 85% → 88%
Tests: 8 new tests added

Closes #42"
```

## Common Mistakes and Fixes

### Mistake 1: Not Reading Spec Completely

**Problem**: Implement wrong feature or miss requirements

**Fix**: Read spec multiple times:

1. First read: Understand overview
2. Second read: Note acceptance criteria
3. Third read: Check edge cases and error handling

### Mistake 2: Skipping Tests

**Problem**: Code breaks later, coverage drops

**Fix**: Write tests first (TDD):

1. Write failing tests
2. Implement code to pass tests
3. Refactor if needed

### Mistake 3: Not Updating Documentation

**Problem**: Feature is forgotten, hard to use

**Fix**: Update all documentation:

1. Update README
2. Add JSDoc comments
3. Update DEVELOPMENT.md
4. Update spec if needed

## Verification Checklist

- [ ] Specification read and understood
- [ ] Acceptance criteria listed
- [ ] Implementation plan created
- [ ] Tests written first
- [ ] Core logic implemented
- [ ] Tests passing
- [ ] VSCode integration added
- [ ] Command registered
- [ ] Integration tests written
- [ ] Documentation updated
- [ ] All acceptance criteria met
- [ ] Full test suite passes
- [ ] Coverage meets targets
- [ ] No regressions
- [ ] Commit message clear
- [ ] DEVELOPMENT.md updated

## Links to Related Documentation

- [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Development plan
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`specs/TESTING.md`](../specs/TESTING.md) - Testing requirements
- [`specs/`](../specs/) - Feature specifications
