# Testing Guidelines and Patterns

This document describes the testing strategy, patterns, and best practices for the ECU Explorer project.

## Testing Strategy Overview

ECU Explorer uses a multi-layered testing approach:

### Unit Tests (jsdom environment)

**Purpose**: Fast feedback on individual functions and components

**Environment**: jsdom (simulated DOM)

**Speed**: ~100ms per test file

**Use Cases**:
- Binary I/O functions (readScalar, writeScalar)
- Scaling calculations
- Table validation
- Color map computation
- Fingerprint matching

**Benefits**:
- Fast execution (no browser startup)
- Deterministic results
- Easy to debug
- Good for TDD

### E2E Tests (Vitest browser mode)

**Purpose**: Test component interactions and user workflows

**Environment**: Real browser (Chromium via Playwright)

**Speed**: ~1-5s per test file

**Use Cases**:
- Component rendering (TableGrid, TableCell)
- User interactions (clicks, typing, selection)
- State management (Svelte stores)
- Webview messaging
- ROM flow integration

**Benefits**:
- Tests real browser behavior
- Catches rendering issues
- Validates user workflows
- Screenshots on failure

### Integration Tests (mocked VS Code API)

**Purpose**: Test extension host with mocked dependencies

**Environment**: Node.js with mocked vscode API

**Speed**: ~500ms per test file

**Use Cases**:
- Command registration and execution
- ROM file loading
- Definition discovery and matching
- Webview lifecycle
- Message routing

**Benefits**:
- Tests extension logic without VS Code
- Faster than full extension debugging
- Reproducible test environment
- Easy to mock external dependencies

## Running Tests

### Run All Tests

```bash
npm run test
```

Runs all test files across all packages using Vitest.

### Watch Mode

```bash
npm run test:watch
```

Automatically reruns tests when files change. Useful during development.

### UI Dashboard

```bash
npm run test:ui
```

Opens the Vitest UI dashboard at `http://localhost:51204` for interactive test exploration:
- View test results in real-time
- Filter by package or test name
- Re-run individual tests
- View coverage per file

### Coverage Reports

```bash
npm run test:coverage
```

Generates coverage reports in `coverage/` directory:
- `coverage/index.html` - Interactive coverage report
- `coverage/coverage-final.json` - Machine-readable format

**Coverage Targets**:
- `@repo/core`: 80%+ (critical path)
- `@repo/ui`: 70%+ (component rendering)
- `@repo/providers-ecuflash`: 75%+ (parsing logic)
- `apps/vscode`: 60%+ (extension host)

### Debug Mode

```bash
npm run test:debug
```

Runs tests with debugging enabled:
- Detailed trace output
- Breakpoint support
- Variable inspection
- Slower execution (for debugging)

### Test Specific Package

```bash
# Test core package
npm run test --workspace=packages/core

# Test UI package
npm run test --workspace=packages/ui

# Test ECUFlash provider
npm run test --workspace=packages/providers/ecuflash

# Test extension
npm run test --workspace=apps/vscode
```

### Test Specific File

```bash
npm run test -- packages/core/src/binary.test.ts
```

### Test Specific Pattern

```bash
# Run tests matching pattern
npm run test -- --grep "binary"

# Run tests in watch mode with pattern
npm run test:watch -- --grep "scaling"
```

## Writing Unit Tests

### Example: Binary Decoding Test

**File**: `packages/core/src/binary.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readScalar } from "./binary";

describe("readScalar", () => {
  it("reads u8 values correctly", () => {
    const buffer = new Uint8Array([0x42]);
    const value = readScalar(buffer, 0, "u8", "le");
    expect(value).toBe(0x42);
  });

  it("reads u16 little-endian correctly", () => {
    const buffer = new Uint8Array([0x34, 0x12]);
    const value = readScalar(buffer, 0, "u16", "le");
    expect(value).toBe(0x1234);
  });

  it("reads u16 big-endian correctly", () => {
    const buffer = new Uint8Array([0x12, 0x34]);
    const value = readScalar(buffer, 0, "u16", "be");
    expect(value).toBe(0x1234);
  });

  it("reads i16 negative values correctly", () => {
    const buffer = new Uint8Array([0xff, 0xff]);
    const value = readScalar(buffer, 0, "i16", "le");
    expect(value).toBe(-1);
  });

  it("reads f32 values correctly", () => {
    const buffer = new Float32Array([3.14159]);
    const value = readScalar(new Uint8Array(buffer.buffer), 0, "f32", "le");
    expect(value).toBeCloseTo(3.14159, 5);
  });

  it("throws on out-of-bounds access", () => {
    const buffer = new Uint8Array([0x42]);
    expect(() => readScalar(buffer, 10, "u8", "le")).toThrow();
  });
});
```

**Test Structure**:
1. **Describe block**: Group related tests
2. **It block**: Individual test case
3. **Arrange**: Set up test data
4. **Act**: Call function under test
5. **Assert**: Verify results

### Example: Fingerprint Scoring Test

**File**: `packages/core/src/definition/match.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { scoreFingerprint } from "./match";

describe("scoreFingerprint", () => {
  it("returns 1.0 for perfect match", () => {
    const rom = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const fingerprint = {
      reads: [{ address: 0, length: 4 }],
      expectedHex: ["12345678"],
      description: "test",
    };
    const score = scoreFingerprint(rom, fingerprint);
    expect(score).toBe(1.0);
  });

  it("returns 0.0 for no match", () => {
    const rom = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const fingerprint = {
      reads: [{ address: 0, length: 4 }],
      expectedHex: ["12345678"],
      description: "test",
    };
    const score = scoreFingerprint(rom, fingerprint);
    expect(score).toBe(0.0);
  });

  it("returns partial score for partial match", () => {
    const rom = new Uint8Array([0x12, 0x34, 0xcc, 0xdd]);
    const fingerprint = {
      reads: [{ address: 0, length: 4 }],
      expectedHex: ["12345678"],
      description: "test",
    };
    const score = scoreFingerprint(rom, fingerprint);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("handles multiple reads", () => {
    const rom = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xaa, 0xbb]);
    const fingerprint = {
      reads: [
        { address: 0, length: 2 },
        { address: 4, length: 2 },
      ],
      expectedHex: ["1234", "aabb"],
      description: "test",
    };
    const score = scoreFingerprint(rom, fingerprint);
    expect(score).toBe(1.0);
  });
});
```

### Example: Table Validation Test

**File**: `packages/core/src/definition/table.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { validateTableDefinition } from "./table";

describe("validateTableDefinition", () => {
  it("validates correct 2D table", () => {
    const def = {
      kind: "table2d" as const,
      name: "FuelMap",
      rows: 8,
      cols: 16,
      x: {
        kind: "dynamic" as const,
        name: "RPM",
        address: 0x1000,
        length: 16,
        dtype: "u16" as const,
      },
      y: {
        kind: "dynamic" as const,
        name: "Load",
        address: 0x1020,
        length: 8,
        dtype: "u8" as const,
      },
      z: {
        name: "Z",
        address: 0x2000,
        dtype: "u16" as const,
      },
    };
    const errors = validateTableDefinition(def, 0x10000);
    expect(errors).toHaveLength(0);
  });

  it("detects address out of bounds", () => {
    const def = {
      kind: "table2d" as const,
      name: "FuelMap",
      rows: 8,
      cols: 16,
      z: {
        name: "Z",
        address: 0xf000,
        dtype: "u16" as const,
      },
    };
    const errors = validateTableDefinition(def, 0x10000);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: "address_out_of_bounds",
      })
    );
  });

  it("detects overlapping tables", () => {
    const def1 = {
      kind: "table1d" as const,
      name: "Table1",
      rows: 1,
      z: {
        name: "Z",
        address: 0x1000,
        dtype: "u16" as const,
        length: 10,
      },
    };
    const def2 = {
      kind: "table1d" as const,
      name: "Table2",
      rows: 1,
      z: {
        name: "Z",
        address: 0x1010,
        dtype: "u16" as const,
        length: 10,
      },
    };
    const errors = validateTableDefinition(def2, 0x10000, [def1]);
    expect(errors).toContainEqual(
      expect.objectContaining({
        type: "overlapping_table",
      })
    );
  });
});
```

## Writing E2E Tests (Vitest Browser Mode)

### Example: Component Rendering Test

**File**: `packages/ui/src/lib/views/TableGrid.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "vitest-browser-svelte";
import TableGrid from "./TableGrid.svelte";

describe("TableGrid", () => {
  it("renders table with correct dimensions", async () => {
    const { container } = render(TableGrid, {
      props: {
        rows: 8,
        cols: 16,
        data: Array(8)
          .fill(null)
          .map(() => Array(16).fill(0)),
        xAxis: Array(16)
          .fill(null)
          .map((_, i) => i * 1000),
        yAxis: Array(8)
          .fill(null)
          .map((_, i) => i * 10),
      },
    });

    const cells = container.querySelectorAll("[data-testid='cell']");
    expect(cells).toHaveLength(128); // 8 * 16
  });

  it("renders axis labels correctly", async () => {
    render(TableGrid, {
      props: {
        rows: 2,
        cols: 3,
        data: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        xAxis: [100, 200, 300],
        yAxis: [10, 20],
      },
    });

    expect(screen.getByText("100")).toBeDefined();
    expect(screen.getByText("200")).toBeDefined();
    expect(screen.getByText("300")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByText("20")).toBeDefined();
  });

  it("applies heatmap colors correctly", async () => {
    const { container } = render(TableGrid, {
      props: {
        rows: 2,
        cols: 2,
        data: [
          [0, 100],
          [50, 100],
        ],
        colorMap: {
          "0-0": "#440154",
          "0-1": "#fde724",
          "1-0": "#35b779",
          "1-1": "#fde724",
        },
      },
    });

    const cells = container.querySelectorAll("[data-testid='cell']");
    expect(cells[0]).toHaveStyle("background-color: #440154");
    expect(cells[3]).toHaveStyle("background-color: #fde724");
  });
});
```

### Example: Component Interaction Test

**File**: `packages/ui/src/lib/views/TableGrid.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { render, screen, userEvent } from "vitest-browser-svelte";
import TableGrid from "./TableGrid.svelte";

describe("TableGrid interactions", () => {
  it("handles cell click", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();

    render(TableGrid, {
      props: {
        rows: 2,
        cols: 2,
        data: [
          [1, 2],
          [3, 4],
        ],
        onCellClick,
      },
    });

    const cell = screen.getByTestId("cell-0-1");
    await user.click(cell);

    expect(onCellClick).toHaveBeenCalledWith(
      expect.objectContaining({
        row: 0,
        col: 1,
      })
    );
  });

  it("handles cell edit", async () => {
    const user = userEvent.setup();
    const onCellEdit = vi.fn();

    render(TableGrid, {
      props: {
        rows: 2,
        cols: 2,
        data: [
          [1, 2],
          [3, 4],
        ],
        editable: true,
        onCellEdit,
      },
    });

    const cell = screen.getByTestId("cell-0-0");
    await user.click(cell);
    await user.type(cell, "42");
    await user.keyboard("{Enter}");

    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        row: 0,
        col: 0,
        value: 42,
      })
    );
  });

  it("handles keyboard navigation", async () => {
    const user = userEvent.setup();

    render(TableGrid, {
      props: {
        rows: 3,
        cols: 3,
        data: Array(3)
          .fill(null)
          .map(() => Array(3).fill(0)),
      },
    });

    const cell = screen.getByTestId("cell-0-0");
    cell.focus();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByTestId("cell-0-1"));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("cell-1-1"));
  });
});
```

## Writing Extension Tests

### Example: Command Registration Test

**File**: `apps/vscode/src/extension.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { activate } from "./extension";

describe("Extension activation", () => {
  let mockContext: any;
  let mockVscode: any;

  beforeEach(() => {
    mockContext = {
      subscriptions: [],
      extensionPath: "/test/path",
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    mockVscode = {
      commands: {
        registerCommand: vi.fn(),
      },
      window: {
        showOpenDialog: vi.fn(),
        showQuickPick: vi.fn(),
      },
    };
  });

  it("registers ROM open command", async () => {
    await activate(mockContext);

    expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
      "rom.open",
      expect.any(Function)
    );
  });

  it("registers table open command", async () => {
    await activate(mockContext);

    expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
      "rom.openTable",
      expect.any(Function)
    );
  });

  it("registers export CSV command", async () => {
    await activate(mockContext);

    expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
      "rom.exportTableCsv",
      expect.any(Function)
    );
  });
});
```

## Test Utilities and Fixtures

### Fixture Locations

Test fixtures are stored in `packages/*/test/fixtures/`:

```
packages/
├── core/test/fixtures/
│   ├── sample.hex          # Sample ROM file
│   ├── sample.bin          # Binary ROM
│   └── definitions/        # Sample XML definitions
├── providers/ecuflash/test/fixtures/
│   ├── evo10base.xml       # Base definition
│   └── 2011_USDM_5MT.xml   # Child definition
└── ui/test/fixtures/
    ├── table-data.json     # Sample table data
    └── colors.json         # Sample color maps
```

### Test ROM File Format

> **⚠️ IMPORTANT**: The test ROM file `56890009_2011_USDM_5MT.hex` in the project root is **raw binary data**, NOT Intel hex format.

**Key facts**:
- Despite the `.hex` extension, this file contains raw binary ROM data (1,033,186 bytes = ~1MB)
- The `.hex` extension is used by EcuFlash for raw binary ROM images
- **DO NOT** attempt to parse this file as Intel hex format
- Intel hex files are ASCII text with lines starting with `:` (colon)
- This file contains binary data with no ASCII line structure

**How to verify**:
- Raw binary: First bytes are `0x56 0x89 0x00 0x09` (ROM ID in big-endian)
- Intel hex: First character is `:` followed by ASCII hex digits

**Related documentation**: [`specs/mitsucan-checksum-implementation.md`](mitsucan-checksum-implementation.md) confirms this is "raw binary, 1MB"

### Creating Sample ROMs

```typescript
// Create a minimal ROM for testing
function createSampleRom(size: number = 0x10000): Uint8Array {
  const rom = new Uint8Array(size);
  // Fill with test data
  for (let i = 0; i < size; i++) {
    rom[i] = (i * 7) % 256; // Pseudo-random pattern
  }
  return rom;
}

// Create ROM with specific values at addresses
function createRomWithData(
  size: number,
  data: { address: number; bytes: number[] }[]
): Uint8Array {
  const rom = new Uint8Array(size);
  for (const { address, bytes } of data) {
    rom.set(bytes, address);
  }
  return rom;
}
```

### Helper Functions for Common Test Setup

```typescript
// Create a table definition for testing
function createTableDef(overrides?: Partial<Table2DDefinition>): Table2DDefinition {
  return {
    kind: "table2d",
    name: "TestTable",
    rows: 8,
    cols: 16,
    x: {
      kind: "dynamic",
      name: "X",
      address: 0x1000,
      length: 16,
      dtype: "u16",
    },
    y: {
      kind: "dynamic",
      name: "Y",
      address: 0x1020,
      length: 8,
      dtype: "u8",
    },
    z: {
      name: "Z",
      address: 0x2000,
      dtype: "u16",
    },
    ...overrides,
  };
}

// Create a ROM definition for testing
function createRomDef(overrides?: Partial<ROMDefinition>): ROMDefinition {
  return {
    uri: "file:///test/definition.xml",
    name: "Test Definition",
    fingerprints: [],
    platform: {},
    tables: [createTableDef()],
    ...overrides,
  };
}
```

## Coverage Expectations

### Target Coverage by Package

| Package | Lines | Branches | Functions | Statements |
|---------|-------|----------|-----------|------------|
| @repo/core | 80% | 75% | 85% | 80% |
| @repo/ui | 70% | 65% | 75% | 70% |
| @repo/providers-ecuflash | 75% | 70% | 80% | 75% |
| apps/vscode | 60% | 55% | 65% | 60% |

### Interpreting Coverage Reports

**Line Coverage**: Percentage of lines executed
- Target: 80%+
- Gaps: Untested error paths, edge cases

**Branch Coverage**: Percentage of conditional branches taken
- Target: 75%+
- Gaps: Missing if/else combinations

**Function Coverage**: Percentage of functions called
- Target: 85%+
- Gaps: Unused utility functions

**Statement Coverage**: Percentage of statements executed
- Target: 80%+
- Similar to line coverage

### Identifying Coverage Gaps

1. Open `coverage/index.html` in browser
2. Click on file to see line-by-line coverage
3. Red lines = uncovered code
4. Yellow lines = partially covered (some branches)
5. Green lines = fully covered

**Common Gaps**:
- Error handling paths (throw statements)
- Edge cases (empty arrays, null values)
- Fallback logic (default cases)
- Rarely-used features

## Agent-Friendly Output

### JSON Test Reports

Run tests with JSON reporter:

```bash
npm run test -- --reporter=json > test-results.json
```

**Format**:
```json
{
  "success": true,
  "numTotalTests": 42,
  "numPassedTests": 40,
  "numFailedTests": 2,
  "numPendingTests": 0,
  "testResults": [
    {
      "name": "packages/core/src/binary.test.ts",
      "status": "passed",
      "numTests": 10,
      "numPassed": 10,
      "numFailed": 0
    }
  ]
}
```

### Coverage Report Parsing

Coverage reports are in `coverage/coverage-final.json`:

```json
{
  "packages/core/src/binary.ts": {
    "lines": { "total": 50, "covered": 45 },
    "branches": { "total": 20, "covered": 15 },
    "functions": { "total": 8, "covered": 7 },
    "statements": { "total": 50, "covered": 45 }
  }
}
```

### Screenshot Analysis for Visual Debugging

E2E tests capture screenshots on failure:

```bash
npm run test:ui
```

Screenshots are saved to `.vitest/screenshots/` with test name and timestamp.

**Analyzing Screenshots**:
1. Check component rendering (layout, colors, text)
2. Verify interactive elements (buttons, inputs)
3. Confirm state changes (highlighting, selection)
4. Look for visual regressions

### Interpreting Test Failures

**Assertion Failures**:
```
Expected: 42
Received: 41
```
→ Logic error or off-by-one bug

**Type Errors**:
```
Cannot read property 'length' of undefined
```
→ Missing null check or incorrect type

**Timeout Errors**:
```
Test timeout after 5000ms
```
→ Async operation not completing, missing await

**Snapshot Mismatches**:
```
Snapshot mismatch: expected 'foo' but got 'bar'
```
→ Component output changed, review and update snapshot

## Best Practices

1. **Test Behavior, Not Implementation**: Test what the function does, not how it does it
2. **Use Descriptive Names**: Test names should explain what's being tested
3. **One Assertion Per Test**: Keep tests focused and easy to debug
4. **Use Fixtures**: Reuse test data to reduce duplication
5. **Mock External Dependencies**: Isolate code under test
6. **Test Edge Cases**: Empty arrays, null values, boundary conditions
7. **Keep Tests Fast**: Avoid unnecessary delays or complex setup
8. **Maintain Coverage**: Aim for 80%+ coverage on critical paths
9. **Review Failures**: Understand why tests fail before fixing
10. **Document Complex Tests**: Add comments explaining non-obvious test logic

## Related Documentation

- **Setup Guide**: [`SETUP.md`](../SETUP.md) - Development environment
- **Architecture**: [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- **Table Schema**: [`TABLE_SCHEMA.md`](TABLE_SCHEMA.md) - XML format
- **Development Plan**: [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Roadmap
