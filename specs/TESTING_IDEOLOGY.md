# Testing Ideology

This document codifies the testing principles and patterns for the ECU Explorer project. Our goal is to maintain a high-quality, reliable codebase while avoiding the maintenance burden of fragile, low-value tests.

## Core Principles

### 1. Prefer Contract-Focused Tests
Tests should verify **what** the code does (the contract), not **how** it does it (the implementation).
- **Good**: Asserting that `decodeScalar` returns `0x1234` for a specific byte sequence.
- **Bad**: Asserting that `decodeScalar` calls `DataView.getUint16` exactly once.

### 2. Prefer Transcript-Driven Integration Tests
For complex protocol flows (e.g., ROM reading/writing), use transcript-driven tests that simulate the communication exchange.
- These tests act as "living documentation" of the protocol.
- They verify the state machine logic without mocking internal private methods.
- **Reference**: See `packages/device/protocols/mut3/test/read-rom-flow.test.ts` for examples.

### 3. Avoid Mock-Mirror Assertions
Do not write tests that simply mirror the implementation logic using mocks. If a test fails every time you refactor the code (even if the output remains the same), it is likely a mock-mirror test.
- **Tautological tests**: Tests that essentially say `expect(mock.call()).toBe(mock.return())` provide zero value.

### 4. Pure Logic Unit Tests
Keep unit tests for deterministic, pure logic with explicit expected outputs.
- Mathematical operations, checksum algorithms, and binary parsing are perfect candidates for traditional unit tests.
- Aim for 100% coverage on these core logic modules.

---

## Good vs. Bad Patterns

| Pattern | Bad (Fragile/Low Value) | Good (Robust/High Value) |
|---------|-------------------------|--------------------------|
| **Mocks** | Mocking every internal dependency and asserting call counts. | Mocking only external boundaries (I/O, Hardware, VS Code API). |
| **State** | Manually setting private state variables in tests. | Driving state changes through public methods/events. |
| **Data** | Using random or "dummy" data that doesn't reflect reality. | Using real-world fixtures (e.g., sample ROM segments, actual protocol logs). |
| **Assertions** | `expect(service.doThing).toHaveBeenCalledWith(...)` | `expect(result).toEqual(expectedOutput)` |

---

## Migration Policy

### Phasing Out Low-Value Tests
When encountering a test that is fragile or provides little confidence:
1. **Assess**: Does it test a core contract or an implementation detail?
2. **Rewrite**: If it's an implementation detail, can it be rewritten as a contract-focused test?
3. **Consolidate**: If it's one of many redundant unit tests, consolidate them into a single integration-style test or a parameterized unit test.
4. **Remove**: If it provides no value and is purely tautological, delete it.

### Guardrail Verification
After cleaning up or refactoring tests:
- Run `npm run test:coverage` to ensure no critical logic has lost coverage.
- Verify that the remaining tests still catch intentional regressions (try breaking the code and see if a test fails).

---

## Contributor Checklist

Before submitting a PR with new tests, ensure:
- [ ] Tests focus on public APIs and observable behavior.
- [ ] Protocol flows use the transcript/integration style.
- [ ] No "mock-mirror" assertions are used.
- [ ] Edge cases (empty input, invalid data, timeouts) are covered.
- [ ] Coverage meets project targets (Lines: ≥ 85%, Branches: ≥ 75%, Functions: ≥ 90%).

## Where to Start
- **New to the codebase?** Look at `packages/core/test/binary.test.ts` for pure logic unit tests.
- **Working on protocols?** Study `packages/device/protocols/uds/test/read-rom-flow.test.ts` to understand transcript-driven testing.
