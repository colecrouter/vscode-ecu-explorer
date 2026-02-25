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
- Aim for >80% code coverage
- Test edge cases, error conditions, and boundary conditions
- Run tests locally before committing:
  ```bash
  npm run test
  npm run test:coverage
  ```

### 5. Code Quality Checks

Before committing, ensure your code passes all checks:

```bash
# Full test suite
npm run test

# Format code
npm run format

# Type checking
npm run check

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

# Run tests in watch mode
npm run test:watch

# Coverage report location
# After running test:coverage, check: coverage/index.html
```

## Documentation

### Update Documentation When Implementing Features

1. **JSDoc comments**: Add detailed comments to all new functions
   ```typescript
   /**
    * Brief description of function
    * 
    * Longer explanation of what it does and how
    * 
    * @param paramName - Description
    * @returns Description of return value
    * @throws Description of exceptions
    * @example
    * const result = myFunction(param);
    */
   function myFunction(param: string): Result {
     // implementation
   }
   ```

2. **Update specs**: Mark features as in-progress, add implementation notes
3. **Update DEVELOPMENT.md**: Mark feature as complete with commit link
4. **Update README.md**: Add user-facing features or major changes
5. **Add code examples**: Include usage examples in JSDoc or spec files

## Code Style

The project uses **Biome** for code formatting and **Prettier** as fallback. Configuration is in:
- [`biome.json`](biome.json) - Primary formatter
- [`.prettierrc`](.prettierrc) - Fallback formatter

**Key guidelines**:
- 2-space indentation
- Single quotes for strings (JavaScript/TypeScript)
- Semicolons at end of statements
- Max line length: 100 characters
- No unused variables or imports

Run formatting automatically:
```bash
npm run format
```

## Architecture and Patterns

### Key Resources

- **Architecture**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Development Guide**: [`DEVELOPMENT.md`](DEVELOPMENT.md)
- **Agent Workflows**: [`AGENTS.md`](AGENTS.md)
- **Testing Philosophy**: [`TESTING_IDEOLOGY.md`](TESTING_IDEOLOGY.md)

### Feature Implementation Process

1. Find available feature in [`DEVELOPMENT.md`](DEVELOPMENT.md)
2. Read specification in [`specs/`](specs/) folder
3. Use task templates from [`skills/`](skills/) folder:
   - [`skills/add-new-table-type.md`](skills/add-new-table-type.md)
   - [`skills/add-new-command.md`](skills/add-new-command.md)
   - [`skills/implement-feature-from-spec.md`](skills/implement-feature-from-spec.md)
   - And more...

### Protocol Implementation

- Device protocols: [`packages/device/protocols/`](packages/device/protocols/)
- Protocol documentation: [`PROTOCOL_SUPPORT.md`](PROTOCOL_SUPPORT.md)
- Transport layers: [`TRANSPORT_LAYERS.md`](TRANSPORT_LAYERS.md)

### Checksum Algorithms

- Core algorithms: [`packages/core/src/checksum/`](packages/core/src/checksum/)
- Algorithm analysis: [`specs/mitsucan-checksum-implementation.md`](specs/mitsucan-checksum-implementation.md)
- Coverage: See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for supported algorithms

## Performance Considerations

- Profile code before optimizing
- Avoid unnecessary re-renders in UI components
- Test with large ROM files (1MB+) and large datasets
- Document performance characteristics in comments

## Security

- Never commit sensitive data (keys, tokens, credentials)
- Validate all user input
- Use environment variables for configuration (see `.env.example`)
- Report security issues responsibly (see SECURITY.md when available)

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

## Troubleshooting

### Common Issues

**Issue**: Tests fail locally but pass in CI
- Solution: Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm install`

**Issue**: Type errors after pulling changes
- Solution: Run `npm run check` to type-check all packages

**Issue**: Biome formatter conflicts with VSCode
- Solution: Install Biome VSCode extension and set as default formatter

**Issue**: Build fails
- Solution: Run `npm run build` to see detailed error, check [`SETUP.md`](SETUP.md)

### Getting Help

- **Questions**: Create a discussion or check existing issues
- **Bug reports**: Use the GitHub issue template (bug_report.md)
- **Architecture questions**: Reference [`ARCHITECTURE.md`](ARCHITECTURE.md) or ask in PR discussion

## Release Process

For maintainers: See [`.github/workflows/release.yml`](.github/workflows/release.yml) for automated release workflow.

## Recognition

All contributors are recognized in the project. Your contributions help make ECU Explorer better for everyone!

---

**Thank you for contributing!** 🎉
