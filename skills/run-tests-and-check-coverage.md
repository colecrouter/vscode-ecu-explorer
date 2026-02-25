# Run Tests and Check Coverage

This guide explains how to run tests and interpret coverage results for ECU Explorer.

## Prerequisites

- Understand the project structure: [`README.md`](../README.md)
- Understand testing requirements: [`specs/TESTING.md`](../specs/TESTING.md)
- Understand the monorepo setup: [`SETUP.md`](../SETUP.md)

## Running Tests

### Run All Tests

Run the complete test suite across all packages:

```bash
npm run test
```

**Output**:
```
✓ packages/core/test/binary.test.ts (12 tests)
✓ packages/core/test/match.test.ts (8 tests)
✓ packages/core/test/table.test.ts (15 tests)
✓ packages/ui/test/TableGrid.test.ts (10 tests)
✓ packages/ui/test/table.svelte.test.ts (8 tests)
✓ apps/vscode/test/extension-activation.test.ts (5 tests)
✓ apps/vscode/test/rom-flow.test.ts (12 tests)
✓ apps/vscode/test/csv-export.test.ts (8 tests)

Test Files  8 passed (8)
     Tests  78 passed (78)
  Start at  22:45:30
  Duration  2.34s
```

### Run Tests with Coverage

Run tests and generate coverage reports:

```bash
npm run test:coverage
```

**Output**:
```
✓ packages/core/test/binary.test.ts (12 tests)
✓ packages/core/test/match.test.ts (8 tests)
✓ packages/core/test/table.test.ts (15 tests)
✓ packages/ui/test/TableGrid.test.ts (10 tests)
✓ packages/ui/test/table.svelte.test.ts (8 tests)
✓ apps/vscode/test/extension-activation.test.ts (5 tests)
✓ apps/vscode/test/rom-flow.test.ts (12 tests)
✓ apps/vscode/test/csv-export.test.ts (8 tests)

Test Files  8 passed (8)
     Tests  78 passed (78)
  Start at  22:45:30
  Duration  2.34s

 % Stmts   % Branch % Funcs % Lines | Uncovered Line #s
-----------|---------|--------|-------|------------------
    85.5   |   72.3  |  90.1  | 85.2  | 
-----------|---------|--------|-------|------------------
All files  |   85.5  |   72.3  |  90.1 | 85.2  |
```

### Run Tests in Watch Mode

Run tests in watch mode for development:

```bash
npm run test:watch
```

This will re-run tests whenever files change.

### Run Tests for Specific Package

Run tests for a single package:

```bash
cd packages/core && npm run test
```

Or from root:

```bash
npm run test -- packages/core
```

### Run Specific Test File

Run a single test file:

```bash
npm run test -- binary.test.ts
```

Or with full path:

```bash
npm run test -- packages/core/test/binary.test.ts
```

### Run Tests Matching Pattern

Run tests matching a pattern:

```bash
npm run test -- --grep "decodeScalar"
```

This runs all tests with "decodeScalar" in the name.

## Interpreting Test Output

### Test Results Format

```
✓ packages/core/test/binary.test.ts (12 tests)
  ✓ decodeScalar handles u16 big-endian
  ✓ decodeScalar handles u16 little-endian
  ✓ decodeScalar throws on invalid type
  ✓ encodeScalar handles u16 big-endian
  ✓ encodeScalar handles u16 little-endian
  ✓ encodeScalar throws on invalid type
  ✓ decodeScalar handles f32 values
  ✓ decodeScalar handles s16 values
  ✓ encodeScalar handles f32 values
  ✓ encodeScalar handles s16 values
  ✓ decodeScalar handles edge cases
  ✓ encodeScalar handles edge cases
```

**Symbols**:
- `✓` - Test passed
- `✗` - Test failed
- `⊙` - Test skipped
- `◐` - Test pending

### Coverage Metrics

Coverage report shows four metrics:

- **% Stmts** - Percentage of statements executed
- **% Branch** - Percentage of if/else branches taken
- **% Funcs** - Percentage of functions called
- **% Lines** - Percentage of code lines executed

**Example**:
```
 % Stmts   % Branch % Funcs % Lines | Uncovered Line #s
-----------|---------|--------|-------|------------------
    85.5   |   72.3  |  90.1  | 85.2  | 
```

This means:
- 85.5% of statements are covered
- 72.3% of branches are covered
- 90.1% of functions are covered
- 85.2% of lines are covered

### Coverage Targets

Target coverage by package:

| Package | Lines | Branches | Functions |
|---------|-------|----------|-----------|
| core | ≥85% | ≥75% | ≥90% |
| ui | ≥80% | ≥70% | ≥85% |
| vscode | ≥75% | ≥65% | ≥80% |

## Checking Coverage Reports

### View HTML Coverage Report

After running `npm run test:coverage`, view the HTML report:

```bash
# Windows
start coverage/index.html

# macOS
open coverage/index.html

# Linux
xdg-open coverage/index.html
```

The HTML report shows:
- Overall coverage statistics
- Per-file coverage breakdown
- Uncovered lines highlighted in red
- Branch coverage details

### Identify Coverage Gaps

Look for files with low coverage:

```
File                          | % Stmts | % Branch | % Funcs | % Lines
------------------------------|---------|----------|---------|--------
All files                     |   85.5  |   72.3   |  90.1   |  85.2
 packages/core/src            |   87.2  |   75.1   |  92.3   |  87.5
  binary.ts                   |   95.0  |   90.0   |  100.0  |  95.0
  match.ts                    |   82.0  |   70.0   |  85.0   |  82.0
  view/table.ts               |   85.0  |   72.0   |  90.0   |  85.0
```

Files with lower coverage need more tests.

### Find Uncovered Lines

In the HTML report, click on a file to see uncovered lines:

```typescript
// Line 42 - NOT COVERED (red highlight)
if (value < 0) {
  throw new Error('Value must be positive');
}

// Line 45 - COVERED (green highlight)
return value * 2;
```

## Common Test Failures and Fixes

### Failure 1: Timeout

**Error**:
```
Timeout - Async operation did not complete within 5000ms
```

**Fix**: Increase timeout or fix async operation:
```typescript
// ✅ Correct: Increase timeout for slow operations
it('loads large ROM file', async () => {
  // ...
}, { timeout: 10000 });

// ✅ Correct: Fix async operation
it('loads ROM file', async () => {
  const rom = await loadRom('test.hex');
  expect(rom).toBeDefined();
});
```

### Failure 2: Assertion Error

**Error**:
```
Expected 0x1234 but got 0x3412
```

**Fix**: Check the assertion and fix the code:
```typescript
// ✅ Correct: Fix endianness handling
const value = decodeScalar(bytes, 'u16', 'big');
expect(value).toBe(0x1234);

// ❌ Wrong: Incorrect expected value
expect(value).toBe(0x3412);
```

### Failure 3: Module Not Found

**Error**:
```
Cannot find module '@ecu-explorer/core'
```

**Fix**: Rebuild the project:
```bash
npm run build
npm run test
```

### Failure 4: Snapshot Mismatch

**Error**:
```
Snapshot does not match
```

**Fix**: Review changes and update snapshot:
```bash
# Review the diff
npm run test -- --reporter=verbose

# Update snapshot if changes are correct
npm run test -- -u
```

## Debugging Test Failures

### Run Tests with Debug Output

Run tests with verbose output:

```bash
npm run test -- --reporter=verbose
```

### Use Vitest UI

Run tests with interactive UI:

```bash
npm run test -- --ui
```

This opens a browser-based UI where you can:
- See test results in real-time
- Filter tests
- Re-run specific tests
- View detailed error messages

### Add Debug Logging

Add logging to understand test behavior:

```typescript
it('decodes scalar correctly', () => {
  const bytes = new Uint8Array([0x12, 0x34]);
  console.log('Input bytes:', bytes);
  
  const result = decodeScalar(bytes, 'u16', 'big');
  console.log('Result:', result);
  
  expect(result).toBe(0x1234);
});
```

Run with:
```bash
npm run test -- --reporter=verbose
```

### Use Debugger

Debug tests with Node debugger:

```bash
node --inspect-brk ./node_modules/vitest/vitest.mjs run
```

Then open `chrome://inspect` in Chrome.

## Improving Coverage

### Identify Untested Code

Look for files with coverage < 80%:

```bash
npm run test:coverage
```

Review the HTML report to find uncovered lines.

### Write Tests for Uncovered Lines

Add tests for uncovered code paths:

```typescript
// Uncovered: error case
it('throws on invalid input', () => {
  expect(() => decodeScalar(new Uint8Array([]), 'invalid')).toThrow();
});

// Uncovered: edge case
it('handles maximum value', () => {
  const bytes = new Uint8Array([0xFF, 0xFF]);
  const result = decodeScalar(bytes, 'u16', 'big');
  expect(result).toBe(0xFFFF);
});
```

### Test Edge Cases

Add tests for boundary conditions:

```typescript
describe('decodeScalar edge cases', () => {
  it('handles zero value', () => {
    const bytes = new Uint8Array([0x00, 0x00]);
    expect(decodeScalar(bytes, 'u16', 'big')).toBe(0);
  });
  
  it('handles minimum value', () => {
    const bytes = new Uint8Array([0x00, 0x01]);
    expect(decodeScalar(bytes, 'u16', 'big')).toBe(1);
  });
  
  it('handles maximum value', () => {
    const bytes = new Uint8Array([0xFF, 0xFF]);
    expect(decodeScalar(bytes, 'u16', 'big')).toBe(0xFFFF);
  });
});
```

## Verification Checklist

- [ ] All tests pass locally
- [ ] Coverage meets targets for all packages
- [ ] No skipped or pending tests
- [ ] HTML coverage report reviewed
- [ ] Uncovered lines identified
- [ ] Edge cases tested
- [ ] Error cases tested
- [ ] Performance acceptable
- [ ] No flaky tests
- [ ] Tests run in CI/CD pipeline
- [ ] Coverage trends tracked

## Links to Related Documentation

- [`specs/TESTING.md`](../specs/TESTING.md) - Testing requirements and strategy
- [`README.md`](../README.md) - Project structure
- [`SETUP.md`](../SETUP.md) - Development setup
- [Vitest Documentation](https://vitest.dev/) - Official Vitest docs
