# AGENTS

Instructions:

- Use `context7` tools to access documentation for the latest libraries, frameworks, or APIs.
- Use `svelte-docs` to get the proper Svelte 5 documentation. Don't rely on your memory for Svelte 5 conventions/features.
  - Use `svelte-autofixer` to get fixes in Svelte code.
- Use `problems` to identify and fix code syntax issues.
- Make use of NPM scripts if available for tasks like building, testing, or linting.
- Make sure to rebuild the project after making cross-package changes, or else they will not update.
- [`README.md`](README.md) describes the project structure and technical details.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) outlines the development plan and architecture.
- [`TESTING_IDEOLOGY.md`](TESTING_IDEOLOGY.md) codifies our testing principles (Contract-focused, Transcript-driven).

---

## Agent Workflows

### How to Find What to Work On

1. **Check DEVELOPMENT.md** - Review the current phase and feature status
2. **Review PROGRESS matrix** - See which features are in progress, blocked, or ready
3. **Check KNOWN_ISSUES.md** - Identify bugs that need fixing
4. **Look for TODO comments** - Search codebase for `TODO:` and `FIXME:` markers
5. **Review open specs** - Check `specs/` folder for features awaiting implementation

**Decision**: Pick a feature that is:

- Marked as "Ready" in DEVELOPMENT.md
- Has clear acceptance criteria in its spec
- Has no blocking dependencies
- Matches your current expertise level

### How to Understand a Feature

1. **Read the specification** - Located in `specs/` folder
2. **Check acceptance criteria** - Listed at end of spec
3. **Review related documentation** - Check ARCHITECTURE.md, WEBVIEW_PROTOCOL.md, etc.
4. **Review testing ideology** - Check [`TESTING_IDEOLOGY.md`](TESTING_IDEOLOGY.md) for testing patterns
5. **Look at existing tests** - Understand expected behavior from test files
6. **Check KNOWN_ISSUES.md** - Understand any limitations or edge cases

**Output**: You should be able to explain:

- What the feature does
- How it integrates with existing code
- What tests need to pass
- What documentation needs updating

### How to Implement a Feature

1. **Follow the specification** - Implement exactly what the spec describes
2. **Write tests first** - Create test cases before implementation (TDD approach)
3. **Implement the code** - Write implementation to pass tests
4. **Update documentation** - Add JSDoc comments, update specs if needed
5. **Verify against spec** - Ensure all acceptance criteria are met
6. **Update DEVELOPMENT.md** - Mark feature as complete, link to commit

**Process**:

```
1. Create feature branch: git checkout -b feature/name
2. Write tests in appropriate test file
3. Implement code to pass tests
4. Run full test suite: npm run test:coverage
5. Update DEVELOPMENT.md with completion
6. Commit with message linking to spec
7. Create pull request
```

### How to Verify Changes

1. **Run tests** - Execute `npm run test:coverage` to run all tests
2. **Check coverage** - Ensure coverage meets targets (see Testing Requirements)
3. **Review code** - Use code review checklist below
4. **Test manually** - If applicable, test in VSCode extension
5. **Check for regressions** - Verify existing functionality still works

**Verification checklist**:

- [ ] All tests pass
- [ ] Coverage meets expectations
- [ ] No console errors or warnings
- [ ] Code follows project patterns
- [ ] Documentation is updated
- [ ] No breaking changes

### How to Commit Changes

1. **Update DEVELOPMENT.md** - Mark feature as complete with date
2. **Link to specification** - Reference the spec file in commit message
3. **Write clear commit message** - Explain what changed and why
4. **Include test results** - Note coverage improvements
5. **Reference related issues** - Link to any related documentation

**Commit message format**:

```
feat: Implement [feature name]

- Brief description of changes
- Link to spec: specs/[feature].md
- Coverage: XX% → YY%
- Tests: N new tests added

Closes #[issue-number]
```

---

## Decision Framework

### When to Implement vs When to Ask for Help

**Implement if**:

- Requirements are clear and unambiguous
- You understand the architecture and patterns
- No architectural decisions needed
- No performance concerns
- No security implications
- No breaking changes required

**Ask for help if**:

- Requirements are unclear or conflicting
- Architectural decision needed
- Performance optimization required
- Security concerns present
- Breaking changes required
- Blocked by external dependencies

### How to Prioritize Features

1. **Check DEVELOPMENT.md** - Follow the phase order
2. **Identify dependencies** - Features that block others should be done first
3. **Consider complexity** - Simpler features first to build momentum
4. **Check test coverage** - Features with existing tests are lower risk
5. **Review acceptance criteria** - Features with clear criteria are easier to complete

**Priority order**:

1. Bug fixes (highest priority)
2. Features blocking other features
3. Features with clear specs and tests
4. Features with high user impact
5. Technical debt and refactoring (lowest priority)

### How to Handle Blockers

1. **Identify the blocker** - What is preventing progress?
2. **Document the issue** - Add to KNOWN_ISSUES.md with details
3. **Suggest solutions** - Propose 2-3 ways to unblock
4. **Escalate if needed** - Ask for architectural guidance
5. **Work on alternatives** - Pick another feature while waiting

**Blocker types**:

- **Architectural**: Need design decision → Ask for guidance
- **Technical**: Missing dependency or tool → Install or configure
- **External**: Waiting for external API → Mock or stub for now
- **Knowledge**: Don't understand how something works → Read code and tests

### How to Manage Technical Debt

1. **Identify debt** - Look for code smells, duplicated code, poor tests
2. **Estimate effort** - How long to fix?
3. **Prioritize** - Is it blocking new features?
4. **Schedule** - Add to DEVELOPMENT.md as a task
5. **Execute** - Refactor with tests to ensure no regressions

**When to refactor**:

- Code is duplicated in 3+ places
- Function is >50 lines and does multiple things
- Test coverage is <50%
- Performance is degraded
- New feature requires similar code

**When NOT to refactor**:

- Feature is blocked waiting for refactor
- Refactor would introduce breaking changes
- Test coverage is already low
- Deadline is approaching

---

## Code Review Checklist

Use this checklist when reviewing code changes:

- [ ] **Tests written and passing**
  - All new code has corresponding tests
  - All tests pass locally and in CI
  - No skipped or pending tests
  
- [ ] **Coverage meets expectations**
  - Line coverage ≥ 80%
  - Branch coverage ≥ 70%
  - Function coverage ≥ 85%
  - No coverage regressions
  
- [ ] **Documentation updated**
  - JSDoc comments added for new functions
  - README or spec updated if needed
  - DEVELOPMENT.md updated with completion
  - Code examples provided where helpful
  
- [ ] **Code follows patterns**
  - Follows existing code style
  - Uses established patterns from codebase
  - No unnecessary complexity
  - Proper error handling
  
- [ ] **No breaking changes**
  - Existing APIs unchanged
  - Backward compatibility maintained
  - Deprecation warnings if needed
  - Migration guide if major change
  
- [ ] **Performance acceptable**
  - No performance regressions
  - Large operations are optimized
  - Memory usage is reasonable
  - No unnecessary re-renders (UI code)

---

## Error Handling Patterns

### How to Handle Errors Gracefully

**Pattern 1: Try-Catch with Recovery**

```typescript
try {
  const result = riskyOperation();
  return result;
} catch (error) {
  logger.error('Operation failed', { error });
  return defaultValue;
}
```

**Pattern 2: Result Type (Prefer for business logic)**

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function operation(): Result<Data> {
  try {
    return { ok: true, value: processData() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
```

**Pattern 3: Validation Before Operation**

```typescript
function processRom(rom: Uint8Array): Result<RomData> {
  if (!rom || rom.length === 0) {
    return { ok: false, error: 'ROM is empty' };
  }
  // Process ROM...
}
```

### When to Throw vs When to Return Error

**Throw if**:

- Programming error (invalid argument type)
- Unexpected system error (file system failure)
- Unrecoverable error (out of memory)
- Error should stop execution

**Return error if**:

- Expected error (invalid user input)
- Recoverable error (file not found)
- Error is part of normal flow
- Caller should decide how to handle

### User-Facing Error Messages

**Good error messages**:

- Clear and concise (1-2 sentences)
- Explain what went wrong
- Suggest how to fix it
- Use plain language (no jargon)

**Examples**:

- ✅ "ROM file is too small. Expected at least 1MB."
- ❌ "Invalid ROM size"
- ✅ "Could not find table at address 0x1000. Check ROM definition."
- ❌ "Table lookup failed"

### Logging and Debugging

**Log levels**:

- **ERROR**: Something failed that user should know about
- **WARN**: Something unexpected but recoverable
- **INFO**: Important state changes or milestones
- **DEBUG**: Detailed information for troubleshooting

**Logging pattern**:

```typescript
logger.error('Failed to load ROM', {
  file: romPath,
  error: error.message,
  stack: error.stack
});
```

---

## Testing Requirements

### Unit Tests for Business Logic

**Location**: `packages/core/test/`

**Coverage targets**:

- Lines: ≥ 85%
- Branches: ≥ 75%
- Functions: ≥ 90%

**What to test**:

- Normal cases (happy path)
- Edge cases (empty, null, max values)
- Error cases (invalid input, exceptions)
- Boundary conditions

**Example**:

```typescript
describe('decodeScalar', () => {
  it('decodes u16 big-endian', () => {
    const bytes = Uint8Array.from([0x12, 0x34]);
    expect(decodeScalar(bytes, 'u16', 'big')).toBe(0x1234);
  });
  
  it('throws on invalid type', () => {
    expect(() => decodeScalar(Uint8Array.from([]), 'invalid')).toThrow();
  });
});
```

### E2E Tests for User Interactions

**Location**: `apps/vscode/test/`

**Coverage targets**:

- All major user flows
- All command handlers
- All webview interactions

**What to test**:

- Opening ROM files
- Editing tables
- Exporting data
- Error scenarios

### Integration Tests for Component Interactions

**Location**: `packages/ui/test/`

**Coverage targets**:

- Component interactions
- State management
- Event handling

**What to test**:

- Component props and events
- State changes
- User interactions
- Data flow between components

### How to Run Tests

**Run all tests**:

```bash
npm run test
```

**Run tests with coverage**:

```bash
npm run test:coverage
```

**Run tests in watch mode**:

```bash
npm run test:watch
```

**Run tests for specific package**:

```bash
cd packages/core && npm run test
```

**Run specific test file**:

```bash
npm run test -- binary.test.ts
```

### How to Interpret Results

**Test output format**:

```
✓ packages/core/test/binary.test.ts (12 tests)
✓ packages/core/test/match.test.ts (8 tests)
✗ packages/core/test/table.test.ts (1 failed, 9 passed)

FAIL  packages/core/test/table.test.ts
  ✗ loadFromROM handles invalid data
    Expected 0x1234 but got 0x3412
    at test.ts:42:15
```

**Interpreting coverage**:

- **Lines**: Percentage of code lines executed
- **Branches**: Percentage of if/else branches taken
- **Functions**: Percentage of functions called
- **Statements**: Percentage of statements executed

**Coverage report location**: `coverage/` folder after running `npm run test:coverage`

---

## Documentation Requirements

### Update Specs When Implementing Features

1. **Mark as In Progress** - Update spec with implementation status
2. **Add implementation notes** - Document any deviations from spec
3. **Update acceptance criteria** - Mark completed criteria
4. **Add examples** - Include code examples of feature usage
5. **Link to code** - Reference implementation files

### Add JSDoc Comments for New Functions

**Format**:

```typescript
/**
 * Brief description of what function does
 * 
 * Longer description explaining:
 * - What it does
 * - How it works
 * - Important side effects
 * 
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws Description of exceptions
 * @example
 * // Example usage
 * const result = functionName(param);
 */
```

**Required for**:

- All exported functions
- All public class methods
- All complex internal functions
- All types and interfaces

### Update DEVELOPMENT.md Progress

1. **Mark feature as complete** - Update status in DEVELOPMENT.md
2. **Add completion date** - Include date completed
3. **Link to commit** - Reference the commit hash
4. **Note any blockers** - Document any remaining issues
5. **Update metrics** - Update test coverage and code metrics

### Link to Related Documentation

- Link to spec file in commit message
- Link to related documentation in JSDoc
- Link to test files in code comments
- Link to DEVELOPMENT.md in feature descriptions

### Include Code Examples

**Where to include examples**:

- JSDoc comments for complex functions
- README files for major features
- Spec files for user-facing features
- Test files as usage examples

---

## Common Pitfalls

### Test ROM File Format Confusion

**Problem**: The test ROM file `56890009_2011_USDM_5MT.hex` is **raw binary data**, NOT Intel hex format.

**Key facts**:
- Despite the `.hex` extension, this file contains raw binary ROM data (1,033,186 bytes = ~1MB)
- The `.hex` extension is used by EcuFlash for raw binary ROM images
- **DO NOT** attempt to parse this file as Intel hex format
- Intel hex files are ASCII text with lines starting with `:` (colon)
- This file contains binary data with no ASCII line structure

**How to verify**:
- Raw binary: First bytes are `0x56 0x89 0x00 0x09` (ROM ID in big-endian)
- Intel hex: First character is `:` followed by ASCII hex digits

**Related documentation**: [`specs/mitsucan-checksum-implementation.md`](specs/mitsucan-checksum-implementation.md) confirms this is "raw binary, 1MB"

### Not Reading Specs Before Implementing

**Problem**: Implementing wrong feature or missing requirements

**Solution**:

1. Always read the spec first
2. Understand acceptance criteria
3. Ask questions if unclear
4. Document any assumptions

### Forgetting to Write Tests

**Problem**: Code breaks later, coverage drops, bugs introduced

**Solution**:

1. Write tests before implementation (TDD)
2. Aim for >80% coverage
3. Test edge cases and errors
4. Run full test suite before committing

### Not Updating Documentation

**Problem**: Future developers don't understand code, features are forgotten

**Solution**:

1. Add JSDoc comments to all new functions
2. Update DEVELOPMENT.md when feature is complete
3. Update spec if implementation differs
4. Include code examples

### Breaking Existing Functionality

**Problem**: Regressions, tests fail, users affected

**Solution**:

1. Run full test suite before committing
2. Check for breaking changes in API
3. Maintain backward compatibility
4. Add deprecation warnings if needed

### Performance Regressions

**Problem**: App becomes slower, users complain, hard to debug

**Solution**:

1. Profile code before optimizing
2. Measure performance impact
3. Test with large datasets
4. Document performance characteristics

---

## When to Ask for Help

### Unclear Requirements

**Ask if**:

- Spec is ambiguous or conflicting
- Acceptance criteria are unclear
- Multiple interpretations possible
- Requirements seem wrong

**How to ask**:

- Quote the confusing part
- Explain your interpretation
- Suggest 2-3 possible solutions
- Ask for clarification

### Architectural Decisions

**Ask if**:

- Need to add new module or package
- Changing core data structures
- Adding new abstraction layer
- Significant refactoring needed

**How to ask**:

- Explain the problem
- Propose 2-3 solutions
- Discuss pros/cons of each
- Ask for recommendation

### Performance Issues

**Ask if**:

- Performance is degraded
- Optimization is complex
- Trade-offs between speed and memory
- Need profiling expertise

**How to ask**:

- Show performance metrics
- Explain the bottleneck
- Propose solutions
- Ask for guidance

### Security Concerns

**Ask if**:

- Handling sensitive data
- User input validation needed
- Cryptography involved
- Security implications unclear

**How to ask**:

- Explain the security concern
- Describe the threat model
- Propose mitigations
- Ask for security review

### Breaking Changes

**Ask if**:

- Changing public API
- Removing features
- Changing data formats
- Affecting users

**How to ask**:

- Explain why change is needed
- Describe impact on users
- Propose migration path
- Ask for approval

---

## Feature Status Reference

### Current Development Status

- **DEVELOPMENT.md** - [`DEVELOPMENT.md`](DEVELOPMENT.md) - Current phase and feature status
- **Specifications** - [`specs/`](specs/) - Detailed feature specifications
- **Known Issues** - [`KNOWN_ISSUES.md`](specs/KNOWN_ISSUES.md) - Limitations and bugs
- **Architecture** - [`ARCHITECTURE.md`](ARCHITECTURE.md) - System design and patterns

### How to Check Feature Status

1. Open [`DEVELOPMENT.md`](DEVELOPMENT.md)
2. Find your feature in the current phase
3. Check the status (Ready, In Progress, Blocked, Complete)
4. Read the spec file for details
5. Check KNOWN_ISSUES.md for limitations

### How to Update Feature Status

1. Open [`DEVELOPMENT.md`](DEVELOPMENT.md)
2. Find your feature
3. Update status and date
4. Add link to commit
5. Note any blockers or issues

---

## Skills and Task Templates

For detailed step-by-step instructions on common tasks, see the [`skills/`](skills/) folder:

- [`skills/add-new-table-type.md`](skills/add-new-table-type.md) - Add support for new table types
- [`skills/add-new-provider.md`](skills/add-new-provider.md) - Implement new ROM definition provider
- [`skills/add-new-command.md`](skills/add-new-command.md) - Add new VSCode command
- [`skills/add-new-webview-message.md`](skills/add-new-webview-message.md) - Add webview message type
- [`skills/add-new-ui-component.md`](skills/add-new-ui-component.md) - Create new Svelte component
- [`skills/run-tests-and-check-coverage.md`](skills/run-tests-and-check-coverage.md) - Run tests and check coverage
- [`skills/build-and-package-extension.md`](skills/build-and-package-extension.md) - Build and package extension
- [`skills/debug-test-failures.md`](skills/debug-test-failures.md) - Debug failing tests
- [`skills/implement-feature-from-spec.md`](skills/implement-feature-from-spec.md) - Implement feature from spec
