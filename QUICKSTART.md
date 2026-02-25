# Development Setup Guide

This guide covers setting up the development environment, building packages, and running tests for the ECU Explorer project.

## Prerequisites

- **Node.js**: 24.10 or later
- **npm**: 10 or later
- **Git**: For cloning and version control
- **VS Code**: Recommended for extension development (v1.75.0+)

Verify your installation:

```bash
node --version  # Should be v24.10.0 or later
npm --version   # Should be 10.x or later
```

## Workspace Setup

This is a monorepo using npm workspaces with the following structure:

- `packages/core` - Core types, binary I/O, table reading/writing
- `packages/definitions/ecuflash` - ECUFlash XML definition provider
- `packages/ui` - Svelte UI components (TableGrid, TableCell, colorMap)
- `apps/vscode` - VS Code extension host and webview management

### Installation

1. Clone the repository:

```bash
git clone https://github.com/colecrouter/vscode-ecu-explorer.git
cd vscode-ecu-explorer
```

2. Install dependencies for all packages:

```bash
npm install
```

This command installs dependencies for the root workspace and all packages defined in `package.json` workspaces.

## Building

### Build All Packages

```bash
npm run build
```

This runs the build script in each package:
- `@repo/core`: TypeScript compilation to `dist/`
- `@repo/ui`: Svelte Kit packaging and Vite bundling
- `@repo/providers-ecuflash`: TypeScript compilation
- `vscode-rom-explorer`: Extension bundling with esbuild

### Build Individual Packages

```bash
# Build core package
npm run build --workspace=packages/core

# Build UI package
npm run build --workspace=packages/ui

# Build ECUFlash provider
npm run build --workspace=packages/definitions/ecuflash

# Build VS Code extension
npm run build --workspace=apps/vscode
```

## Development Server

Supported applications provide a `npm run dev` script for development mode.

### Extension Debugging

To debug the VS Code extension:

1. Open the project in VS Code
2. Press `F5` or go to **Run → Start Debugging**
3. This launches a new VS Code window with the extension loaded
4. Set breakpoints in `apps/vscode/src/extension.ts` and other files
5. Use the Debug Console to inspect variables and logs

For more details, see the [VS Code Extension Development Guide](https://code.visualstudio.com/api/get-started/your-first-extension).

## Testing

### Run All Tests

```bash
npm run test
```

Runs unit tests across all packages using Vitest.

### Coverage Reports

```bash
npm run test:coverage
```

Generates coverage reports in `coverage/` directory. Open `coverage/index.html` in a browser to view detailed coverage.

### Test Specific Package

```bash
# Test core package
npm run test --workspace=packages/core

# Test UI package
npm run test --workspace=packages/ui

# Test ECUFlash provider
npm run test --workspace=packages/definitions/ecuflash
```

## Code Quality

### Type Checking

```bash
npm run check
```

Runs TypeScript type checking and Biome linting across all packages.

### Formatting

```bash
npm run format
```

Formats code using Prettier and Biome, with automatic fixes applied.

## Common Workflows

### Adding a New Dependency

```bash
# Add to a specific package
npm install <package-name> --workspace=packages/core

# Add as dev dependency
npm install --save-dev <package-name> --workspace=packages/core
```

### Rebuilding After Cross-Package Changes

When making changes that affect multiple packages (e.g., updating `@repo/core` types used by `@repo/ui`):

```bash
npm run build
```

This ensures all packages are rebuilt in dependency order.

### Testing a Single File

```bash
# Run tests for a specific file
npm run test -- packages/core/src/binary.test.ts
```

## Troubleshooting

### "Module not found" errors

**Problem**: After installing dependencies or switching branches, you see "Cannot find module" errors.

**Solution**:
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Port 5173 already in use

**Problem**: The UI dev server fails to start because port 5173 is in use.

**Solution**:
```bash
# Find and kill the process using port 5173
# On Windows:
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# On macOS/Linux:
lsof -i :5173
kill -9 <PID>
```

### TypeScript compilation errors

**Problem**: `npm run check` or `npm run build` fails with TypeScript errors.

**Solution**:
```bash
# Verify TypeScript version
npm list typescript

# Rebuild from scratch
npm run build --workspaces -- --force
```

### Extension not loading in VS Code

**Problem**: The extension doesn't appear in VS Code after pressing F5.

**Solution**:
1. Ensure the extension is built: `npm run build --workspace=apps/vscode`
2. Check the Debug Console for error messages
3. Verify `apps/vscode/package.json` has correct `main` entry point
4. Try restarting the debug session

### Tests failing with "jsdom not found"

**Problem**: Vitest tests fail with module resolution errors.

**Solution**:
```bash
# Ensure vitest is installed
npm install --save-dev vitest

# Rebuild and retry
npm run build
npm run test
```

## Project Structure Reference

For detailed information about the project architecture and component interactions, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

For XML definition format and table schema details, see [`specs/TABLE_SCHEMA.md`](specs/TABLE_SCHEMA.md).

For testing guidelines and patterns, see [`specs/TESTING.md`](specs/TESTING.md).

## Next Steps

1. **First Build**: Run `npm install && npm run build` to set up the project
2. **Run Tests**: Execute `npm run test` to verify everything works
3. **Start Development**: Use `npm run dev --workspace=packages/ui` for UI development
4. **Debug Extension**: Press F5 in VS Code to debug the extension
5. **Read Architecture**: Review [`ARCHITECTURE.md`](ARCHITECTURE.md) to understand the system design
