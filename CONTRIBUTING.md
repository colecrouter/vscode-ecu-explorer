# Contributing to ECU Explorer

Thank you for your interest in contributing to ECU Explorer! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

This project is committed to providing a welcoming and inclusive environment for all contributors. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm 10 or higher
- VSCode (for testing the extension)

### Development Setup

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/vscode-ecu-explorer.git
   cd vscode-ecu-explorer
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start development mode**:
   ```bash
   npm run dev
   ```

## Contribution Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/my-feature-name
```

Use descriptive branch names that reflect the feature or fix (e.g., `feature/add-nissan-support`, `fix/checksum-validation`).

### 2. Before You Start

- Read the relevant specification in the [`specs/`](specs/) folder
- Review [`ARCHITECTURE.md`](ARCHITECTURE.md) to understand the system design
- Check [`DEVELOPMENT.md`](DEVELOPMENT.md) for current development phases
- Review [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for known limitations

### 3. Make Your Changes

- Follow the existing code style (enforced by Biome and Prettier)
- Add JSDoc comments to all new functions and exported types
- Write tests alongside your implementation (see Testing Requirements)
- Follow the patterns documented in [`AGENTS.md`](AGENTS.md)
- Reference task-specific guidelines in [`skills/`](skills/) folder

### 4. Write Tests

- Create tests before implementing (TDD approach)
- Aim for code coverage
- Test edge cases, error conditions, and boundary conditions
- Run tests locally before committing:
  ```bash
  npm run check
  npm run test
  npm run test:coverage
  ```

### 5. Code Quality Checks

Before committing, ensure your code passes all checks:

```bash
# Type checking
npm run check

# Full test suite
npm run test

# Format code
npm run format

# Run linter
npm run lint
```

### 6. Commit Your Changes

Use clear, descriptive commit messages that explain the *what* and *why*:

```
feat: Add Nissan checksum support

- Implement CRC-32 checksum algorithm
- Add validation in ROM save workflow
- Update ROM definition parser
- Tests: 12 new tests added
- Link to spec: specs/nissan-checksum-implementation.md
```

**Commit message format**:
- Start with type: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`
  - For specific package changes, use `feat(core):`, `fix(device/whatever):`, etc.
- Keep first line under 72 characters
- Reference related specs or issues
- Include coverage information for significant changes

### 7. Push and Create a Pull Request

```bash
git push origin feature/my-feature-name
```

Then create a Pull Request on GitHub:

- **Title**: Clear description of changes
- **Description**: Explain what changed and why
- **Link to spec**: Reference the specification (if applicable)
- **Test results**: Include coverage metrics
- **Checklist**: Verify all items completed

## Testing Requirements

### Unit Tests

- **Location**: `packages/*/test/` directories
- **Coverage targets**: ≥85% line coverage, ≥75% branch coverage
- **What to test**: Normal cases, edge cases, error cases, boundary conditions

### E2E Tests

- **Location**: `apps/vscode/test/` directory
- **What to test**: User workflows, command handlers, webview interactions

### Integration Tests

- **Location**: `packages/*/test/` directory
- **What to test**: Component interactions, state management, event handling

### Running Tests

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage
```

## Documentation

### Update Documentation When Implementing Features

1. **JSDoc comments**: Add proportionally detailed comments to exported/reusable functions
1. **Update specs**: Update/correct implementation notes
1. **Update README.md**: Add user-facing features or major changes
1. **Add code examples**: Include usage examples when relevant

## Code Style

The project uses **Biome** for code formatting and **Prettier** as fallback. Configuration is in:

- [`biome.json`](biome.json) - Primary formatter
- [`.prettierrc`](.prettierrc) - Fallback formatter

Run formatting automatically:

```bash
npm run format
```

## Conventions

### Error Handling

### Avoid `any`

Never use `any` — it defeats the entire purpose of TypeScript's type system. The project uses strict settings that make `any` dangerous:

- `noUncheckedIndexedAccess` — array accesses return `T | undefined`
- `exactOptionalPropertyTypes` — optional properties are `T | undefined`, not `T`

```typescript
// ❌ Never do this
function process(data: any): any { }

// ✅ Use proper types instead
function process(data: Data[]): Result[] { }
```

### Avoid Non-Null Assertions (`!`)

The `!` operator tells TypeScript "trust me, this is defined" — it's a bug waiting to happen. Use optional chaining or conditional checks instead.

```typescript
// ❌ Avoid
const first = values[0]!;

// ✅ Prefer: use `as const` for test fixtures
const values = [1, 2, 3] as const;
const first = values[0]; // typed as 1 (readonly)

// ✅ Or use conditional checks to return early
const first = values[0];
if (first === undefined) return; // handle undefined case or throw error (when appropriate)
```

### Avoid Type Casting

Resist the urge to cast types to make the compiler happy. Instead, refactor to use proper type definitions or type guards.

```typescript
// ❌ Avoid
const data2d = data as Uint8Array[][];

// ✅ Prefer: allow TypeScript to infer types (when possible)
const data2d = data;

// ✅ Or use inline narrowing for simple, one-off cases (use only methods that TypeScript will narrow with)
if (Array.isArray(data)) { }

// ✅ Or create reusable type guards for complex cases
function is2DArray(data: unknown): data is Uint8Array[][] {
  return Array.isArray(data) &&
         data.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'number'));
}

if (is2DArray(data)) {
  // data is typed correctly here without casting
}
```

**Exception**: When interfacing with external systems (e.g., parsing XML from ROM definitions), casting may be necessary. In those cases, create narrow wrapper types rather than casting to `any`:

```typescript
// ✅ Acceptable: narrow wrapper type
type RawXmlData = { [key: string]: unknown };
const rom = parsedXml as RawXmlData;
```

### Prefer Implicit Type Inference and `satisfies`

When declaring constants, [prefer `satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator) to validate the shape while preserving literal types:

```typescript
// ✅ Good: validates shape, keeps literal types
const config = { port: 3000 } satisfies ServerConfig;
// config.port is typed as 3000, not number

// ❌ Avoid: loses literal type info
const config: ServerConfig = { port: 3000 };
// config.port is now number
```

```typescript
// ✅ Good
const sampleRom = {
  id: '56890009',
  tables: [
    { name: 'FuelMap', address: 0x1000 } as const
  ]
};

// ❌ Avoid
const sampleRom = {
  id: '56890009',
  tables: [
    { name: 'FuelMap', address: 0x1000 }
  ]
} as RomStub;
```

```typescript
// ✅ Good: allow inference
const sampleRom2 = {
	...sampleRom,
	extraInfo: 'This is fine'
}

// ❌ Avoid: declaring types for inferrable objects
interface RomStubWithExtra extends RomStub {
	extraInfo: string;
}
const sampleRom2: RomStubWithExtra = {
	...sampleRom,
	extraInfo: 'This is fine'
}
```

> [!NOTE]
> Aggressive casting/typing causes headaches when testing and refactoring. By allowing TypeScript to infer types, you get better DX and more easily maintainable code.

#### Prefer Early Returns

Instead of nested conditionals, use early returns to handle error cases and keep the "happy path" less indented:

```typescript
// ✅ Good: early returns
if (!data) return; // handle null/undefined case
doSomething(data);

// ❌ Avoid: nested conditionals
if (data) {
  doSomething(data);
}
```

## Pull Request Review Process

When you submit a PR:

1. **CI checks** run automatically (Biome, TypeScript, linting)
2. **Tests** must pass and maintain coverage >80%
3. **Code review** by maintainers
4. **Approval** required before merge
5. **Squash merge** to keep history clean

### Review Checklist

Your PR will be reviewed against:

- ✅ All tests pass
- ✅ Coverage meets expectations (>80%)
- ✅ Code follows project patterns
- ✅ Documentation is updated
- ✅ No breaking changes
- ✅ Commits are clear and descriptive

## Release Process

For maintainers: See [`.github/workflows/release.yml`](.github/workflows/release.yml) for automated release workflow.

---

**Thank you for contributing!** 🎉
