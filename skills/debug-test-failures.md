# Debug Failing Tests

This guide explains how to debug failing tests in ECU Explorer.

## Prerequisites

- Read [`specs/TESTING.md`](../specs/TESTING.md) - Testing strategy
- Understand test structure: [`packages/core/test/`](../packages/core/test/)
- Understand Vitest: https://vitest.dev/

## Understanding Test Output

### Test Failure Format

When a test fails, Vitest shows:

```
FAIL  packages/core/test/binary.test.ts
  ✗ decodeScalar handles u16 big-endian
    AssertionError: expected 0x3412 to equal 0x1234
      at test.ts:42:15
      at processTicksAndRejections (internal/timers.js:1-1)

    42 |     expect(decodeScalar(bytes, 'u16', 'big')).toBe(0x1234);
       |                                                    ^
```

**Key information**:
- File and test name
- Assertion that failed
- Expected vs actual value
- Line number and code context

### Stack Trace Analysis

Stack traces show the call chain:

```
Error: ROM file is too small
  at loadRom (packages/core/src/definition/rom.ts:42:15)
  at Object.<anonymous> (packages/core/test/rom.test.ts:15:8)
  at processTicksAndRejections (internal/timers.js:1-1)
```

**Reading the stack**:
1. Error message and location
2. Call chain from bottom to top
3. Most relevant line is usually near the top

## Running Tests in Debug Mode

### Run Single Test File

Run a specific test file:

```bash
npm run test -- binary.test.ts
```

### Run Tests Matching Pattern

Run tests matching a pattern:

```bash
npm run test -- --grep "decodeScalar"
```

This runs all tests with "decodeScalar" in the name.

### Run with Verbose Output

Run with detailed output:

```bash
npm run test -- --reporter=verbose
```

**Output**:
```
✓ packages/core/test/binary.test.ts (12 tests)
  ✓ decodeScalar handles u16 big-endian (2ms)
  ✓ decodeScalar handles u16 little-endian (1ms)
  ✓ decodeScalar throws on invalid type (3ms)
  ✗ encodeScalar handles u16 big-endian (5ms)
    AssertionError: expected 0x3412 to equal 0x1234
```

### Run with Detailed Error Messages

Run with detailed error output:

```bash
npm run test -- --reporter=verbose --no-coverage
```

## Using Vitest UI

### Launch Vitest UI

Run tests with interactive UI:

```bash
npm run test -- --ui
```

This opens a browser-based UI at `http://localhost:51204/__vitest__/`

**Features**:
- See all tests in a tree view
- Click to run individual tests
- View detailed error messages
- Filter tests by name
- Re-run failed tests
- View code coverage

### Debug in Vitest UI

1. Open Vitest UI
2. Click on failing test
3. View error message and stack trace
4. Click "Show code" to see test code
5. Modify test and re-run

## Adding Debug Logging

### Log Values in Tests

Add console.log to understand test behavior:

```typescript
it('decodes scalar correctly', () => {
  const bytes = new Uint8Array([0x12, 0x34]);
  console.log('Input bytes:', bytes);
  console.log('Input hex:', bytes.toString('hex'));
  
  const result = decodeScalar(bytes, 'u16', 'big');
  console.log('Result:', result);
  console.log('Result hex:', result.toString(16));
  
  expect(result).toBe(0x1234);
});
```

Run with:
```bash
npm run test -- --reporter=verbose
```

### Log in Implementation Code

Add logging to the code being tested:

```typescript
export function decodeScalar(
  bytes: Uint8Array,
  type: DataType,
  endianness: Endianness
): number {
  console.log('decodeScalar called with:', { type, endianness, bytes: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('') });
  
  if (type === 'u16') {
    const value = endianness === 'big'
      ? bytes.readUInt16BE(0)
      : bytes.readUInt16LE(0);
    console.log('Decoded u16:', value.toString(16));
    return value;
  }
  
  throw new Error(`Unsupported type: ${type}`);
}
```

## Using Node Debugger

### Debug with Node Inspector

Run tests with Node debugger:

```bash
node --inspect-brk ./node_modules/vitest/vitest.mjs run
```

Then:
1. Open `chrome://inspect` in Chrome
2. Click "inspect" on the test process
3. Set breakpoints in DevTools
4. Step through code

### Debug Specific Test

Debug a single test:

```bash
node --inspect-brk ./node_modules/vitest/vitest.mjs run binary.test.ts
```

## Analyzing Test Failures

### Assertion Failures

**Problem**: Expected value doesn't match actual

```
AssertionError: expected 0x3412 to equal 0x1234
```

**Debug steps**:
1. Check the input data
2. Trace through the function logic
3. Verify endianness handling
4. Check for off-by-one errors

**Example fix**:
```typescript
// ❌ Wrong: Incorrect endianness
const value = bytes.readUInt16LE(0); // Little-endian

// ✅ Correct: Use big-endian
const value = bytes.readUInt16BE(0); // Big-endian
```

### Timeout Failures

**Problem**: Test takes too long

```
Timeout - Async operation did not complete within 5000ms
```

**Debug steps**:
1. Check if async operation is actually completing
2. Look for infinite loops
3. Check for missing `await` statements
4. Increase timeout if operation is legitimately slow

**Example fix**:
```typescript
// ❌ Wrong: Missing await
it('loads ROM', async () => {
  const rom = loadRom('test.hex'); // Not awaited
  expect(rom).toBeDefined();
});

// ✅ Correct: Await async operation
it('loads ROM', async () => {
  const rom = await loadRom('test.hex');
  expect(rom).toBeDefined();
});
```

### Type Errors

**Problem**: Type mismatch

```
TypeError: Cannot read property 'length' of undefined
```

**Debug steps**:
1. Check if object is defined
2. Verify object type
3. Add null checks
4. Use type guards

**Example fix**:
```typescript
// ❌ Wrong: No null check
it('processes array', () => {
  const result = processArray(undefined);
  expect(result.length).toBe(0);
});

// ✅ Correct: Check for null/undefined
it('processes array', () => {
  const result = processArray(undefined);
  expect(result).toBeDefined();
  expect(result.length).toBe(0);
});
```

### Snapshot Failures

**Problem**: Snapshot doesn't match

```
Snapshot does not match
```

**Debug steps**:
1. Review the diff
2. Determine if change is intentional
3. Update snapshot if correct
4. Fix code if incorrect

**Update snapshot**:
```bash
npm run test -- -u
```

## Common Test Failures and Fixes

### Failure 1: Module Not Found

**Error**:
```
Cannot find module '@ecu-explorer/core'
```

**Fix**: Rebuild packages:
```bash
npm run build
npm run test
```

### Failure 2: Flaky Test

**Error**: Test passes sometimes, fails other times

**Fix**: Look for timing issues:
```typescript
// ❌ Wrong: Timing dependent
it('processes data', async () => {
  startAsyncOperation();
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(result).toBeDefined();
});

// ✅ Correct: Wait for actual completion
it('processes data', async () => {
  const result = await performAsyncOperation();
  expect(result).toBeDefined();
});
```

### Failure 3: Test Isolation

**Error**: Test passes alone, fails with other tests

**Fix**: Ensure tests don't share state:
```typescript
// ❌ Wrong: Shared state
let globalState = {};

it('test 1', () => {
  globalState.value = 1;
  expect(globalState.value).toBe(1);
});

it('test 2', () => {
  expect(globalState.value).toBe(undefined); // Fails!
});

// ✅ Correct: Isolated state
it('test 1', () => {
  const state = { value: 1 };
  expect(state.value).toBe(1);
});

it('test 2', () => {
  const state = {};
  expect(state.value).toBe(undefined);
});
```

## Debugging Specific Scenarios

### Debug ROM Loading

```typescript
it('loads ROM correctly', async () => {
  const romPath = 'test.hex';
  console.log('Loading ROM from:', romPath);
  
  const rom = await loadRom(romPath);
  console.log('ROM size:', rom.length);
  console.log('ROM header:', rom.slice(0, 16).toString('hex'));
  
  expect(rom).toBeDefined();
  expect(rom.length).toBeGreaterThan(0);
});
```

### Debug Table Parsing

```typescript
it('parses table correctly', () => {
  const definition = createTableDefinition();
  console.log('Table definition:', definition);
  
  const table = new TableView(definition);
  console.log('Table created:', table);
  
  const rom = createSampleRom();
  table.loadFromROM(rom);
  console.log('Table data:', table.data);
  
  expect(table.data).toBeDefined();
});
```

### Debug Webview Messages

```typescript
it('handles webview message', () => {
  const message = {
    type: 'openTable',
    data: { tableId: 'test' },
  };
  console.log('Sending message:', message);
  
  const result = handleMessage(message);
  console.log('Result:', result);
  
  expect(result).toBeDefined();
});
```

## Verification Checklist

- [ ] Test failure understood
- [ ] Root cause identified
- [ ] Debug logging added
- [ ] Stack trace analyzed
- [ ] Fix implemented
- [ ] Test passes locally
- [ ] No new failures introduced
- [ ] Coverage maintained
- [ ] Debug logging removed (or kept if helpful)
- [ ] Commit message references issue

## Links to Related Documentation

- [`specs/TESTING.md`](../specs/TESTING.md) - Testing strategy
- [`packages/core/test/`](../packages/core/test/) - Test examples
- [Vitest Documentation](https://vitest.dev/) - Official Vitest docs
- [Node Inspector](https://nodejs.org/en/docs/guides/debugging-getting-started/) - Node debugging guide
