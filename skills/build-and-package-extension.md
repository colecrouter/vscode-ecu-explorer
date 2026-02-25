# Build and Package the VSCode Extension

This guide explains how to build and package the ECU Explorer VSCode extension for distribution.

## Prerequisites

- Read [`SETUP.md`](../SETUP.md) - Development environment setup
- Read [`README.md`](../README.md) - Project structure
- Have Node.js and npm installed
- Have VSCode installed for testing

## Building the Extension

### Build All Packages

Build all packages in the monorepo:

```bash
npm run build
```

This builds:
- `packages/core` - Core library
- `packages/ui` - UI components
- `packages/providers/*` - ROM definition providers
- `apps/vscode` - VSCode extension

**Output**:
```
> npm run build

> @ecu-explorer/core build
✓ Built in 2.34s

> @ecu-explorer/ui build
✓ Built in 3.45s

> @ecu-explorer/provider-ecuflash build
✓ Built in 1.23s

> @ecu-explorer/vscode build
✓ Built in 4.56s

All packages built successfully!
```

### Build Specific Package

Build a single package:

```bash
cd packages/core && npm run build
```

Or from root:

```bash
npm run build -- packages/core
```

### Build with Watch Mode

Build and watch for changes:

```bash
npm run build:watch
```

This is useful during development.

## Packaging the Extension

### Create VSIX Package

Create a distributable VSIX package:

```bash
cd apps/vscode
npm run package
```

This creates `ecu-explorer-X.Y.Z.vsix` in the `apps/vscode` directory.

**Output**:
```
> npm run package

Packaging extension...
✓ Created ecu-explorer-1.0.0.vsix (2.5 MB)

Package ready for distribution!
```

### Package with Specific Version

Package with a specific version:

```bash
cd apps/vscode
npm run package -- --version 1.0.0
```

### Package for Pre-release

Create a pre-release package:

```bash
cd apps/vscode
npm run package -- --pre-release
```

This creates `ecu-explorer-1.0.0-pre.vsix`.

## Testing the Packaged Extension

### Install Packaged Extension Locally

Install the VSIX file in VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X)
3. Click "..." menu → "Install from VSIX..."
4. Select the `.vsix` file

Or use command line:

```bash
code --install-extension ecu-explorer-1.0.0.vsix
```

### Test Extension Functionality

After installing, test:

1. **Open ROM file** - File → Open → Select ROM file
2. **View tables** - Should display available tables
3. **Edit table** - Click on table to edit
4. **Export CSV** - Right-click table → Export as CSV
5. **Check console** - No errors in developer console (Ctrl+Shift+J)

### Run Extension Tests

Run the extension test suite:

```bash
npm run test
```

Or with coverage:

```bash
npm run test:coverage
```

### Debug Extension

Debug the extension in VSCode:

1. Open `apps/vscode` in VSCode
2. Press F5 to start debugging
3. A new VSCode window opens with the extension loaded
4. Set breakpoints and debug

## Publishing to VSCode Marketplace

### Prerequisites

- VSCode Marketplace account
- Personal Access Token (PAT) from Azure DevOps
- `vsce` CLI tool installed: `npm install -g vsce`

### Create Publisher Account

1. Go to https://marketplace.visualstudio.com/
2. Sign in with Microsoft account
3. Create a new publisher
4. Generate Personal Access Token

### Publish Extension

Publish to the marketplace:

```bash
cd apps/vscode
vsce publish
```

**Output**:
```
Publishing ecu-explorer v1.0.0...
✓ Published to Visual Studio Marketplace
✓ Published to Open VSX Registry

Your extension is now available!
```

### Publish Pre-release

Publish as pre-release:

```bash
cd apps/vscode
vsce publish --pre-release
```

### Update Extension

Update an existing extension:

```bash
cd apps/vscode
# Update version in package.json
npm version patch  # or minor, major

# Publish update
vsce publish
```

## Verifying the Package

### Check Package Contents

List files in the VSIX package:

```bash
# VSIX is a ZIP file
unzip -l ecu-explorer-1.0.0.vsix
```

**Expected contents**:
```
Archive:  ecu-explorer-1.0.0.vsix
  Length      Date    Time    Name
---------  ---------- -----   ----
     1234  2024-01-15 10:30   extension/package.json
     5678  2024-01-15 10:30   extension/dist/extension.js
     9012  2024-01-15 10:30   extension/dist/webview.js
     3456  2024-01-15 10:30   [Content_Types].xml
     7890  2024-01-15 10:30   extension.vsixmanifest
```

### Verify Package Integrity

Verify the package is valid:

```bash
vsce ls ecu-explorer-1.0.0.vsix
```

### Check File Sizes

Ensure package size is reasonable:

```bash
ls -lh ecu-explorer-1.0.0.vsix
```

Should be < 10 MB.

## Common Issues and Fixes

### Issue 1: Build Fails

**Error**:
```
Error: Cannot find module '@ecu-explorer/core'
```

**Fix**: Rebuild dependencies:
```bash
npm install
npm run build
```

### Issue 2: Package Too Large

**Error**:
```
Package size is 15 MB, exceeds limit of 10 MB
```

**Fix**: Exclude unnecessary files in `.vscodeignore`:
```
node_modules/
test/
coverage/
*.test.ts
*.md
```

### Issue 3: Extension Won't Load

**Error**:
```
Extension activation failed
```

**Fix**: Check extension logs:
1. Open Developer Console (Ctrl+Shift+J)
2. Look for error messages
3. Check `apps/vscode/src/extension.ts` for issues

### Issue 4: Marketplace Publish Fails

**Error**:
```
Authentication failed
```

**Fix**: Check Personal Access Token:
```bash
vsce login
# Enter publisher name and PAT
```

## Verification Checklist

- [ ] All packages build successfully
- [ ] No build errors or warnings
- [ ] VSIX package created
- [ ] Package size < 10 MB
- [ ] Package contents verified
- [ ] Extension installs without errors
- [ ] All features work in installed extension
- [ ] Tests pass
- [ ] No console errors
- [ ] Version number updated
- [ ] Changelog updated
- [ ] Published to marketplace (if applicable)
- [ ] Pre-release marked correctly
- [ ] Documentation updated

## Build and Package Scripts

**File**: `apps/vscode/package.json`

```json
{
  "scripts": {
    "build": "vite build",
    "build:watch": "vite build --watch",
    "package": "vsce package",
    "package:pre": "vsce package --pre-release",
    "publish": "vsce publish",
    "publish:pre": "vsce publish --pre-release",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  }
}
```

## Links to Related Documentation

- [`SETUP.md`](../SETUP.md) - Development setup
- [`README.md`](../README.md) - Project structure
- [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Development plan
- [VSCode Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) - Official guide
- [VSCE Documentation](https://github.com/microsoft/vscode-vsce) - VSCE CLI tool
