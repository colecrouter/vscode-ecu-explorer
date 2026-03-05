# AGENTS

Instructions:

- Make use of NPM scripts if available for tasks like building, testing, or linting.
- Make sure to rebuild the project after making cross-package changes, or else they will not update.
- [`README.md`](README.md) describes the project structure and technical details.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) describes how to contribute to the project, including code style and conventions.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) outlines internal, long-term developments.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) describes the architecture of the project.
- [`TESTING_IDEOLOGY.md`](TESTING_IDEOLOGY.md) codifies our testing principles (Contract-focused, Transcript-driven).

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
4. **Run type check** - Execute `npm run check` to verify TypeScript types
5. **Run linting** - Execute `npm run lint` to verify code style
6. **Run tests** - Execute `npm run test:coverage` to verify tests pass
7. **Update documentation** - Add JSDoc comments, update specs if needed
8. **Verify against spec** - Ensure all acceptance criteria are met
9. **Update DEVELOPMENT.md** - Mark feature as complete (if present)


## Code Review Checklist

Review [CONTRIBUTING.md](CONTRIBUTING.md) and follow those guidelines.

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
npm run test -w packages/core
```

**Run specific test file**:

```bash
npm run test -- binary.test.ts
```

## Documentation Requirements

### Update Specs When Implementing Features

1. **Mark as In Progress** - Update spec with implementation status
2. **Add implementation notes** - Document any deviations from spec
3. **Update acceptance criteria** - Mark completed criteria
4. **Add examples** - Include code examples of feature usage
5. **Link to code** - Reference implementation files

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

## Common Pitfalls

### Test ROM File Format Confusion

**Problem**: Sample ROM files with `.hex` extension are **raw binary data**, NOT Intel hex format.

**Key facts**:
- The `.hex` extension is used by EcuFlash for raw binary ROM images
- **DO NOT** attempt to parse this file as Intel hex format
- Intel hex files are ASCII text with lines starting with `:` (colon)
- This file contains binary data with no ASCII line structure

**How to verify**:
- Raw binary: First bytes are `0x56 0x89 0x00 0x09` (ROM ID in big-endian)
- Intel hex: First character is `:` followed by ASCII hex digits

### Breaking Existing Functionality

**Problem**: Regressions, tests fail, users affected

**Solution**:

1. Run full test suite before committing
2. Check for breaking changes in API
3. Consult the user about breaking changes and deprecation strategy

### Linting/Type Errors

**Problem**: Code does not compile, linting errors, fails CI checks

**Solution**: Find the source of the discrepancy, execute a plan to resolve it.

> [!WARNING] Do not ignore linting or type errors, _ever_. This is the lowest form of technical solutions, and provides no value. PRs that disable/bypass these in _any_ capacity will be immediately rejected.