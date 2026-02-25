# Add a New VSCode Command

This guide explains how to add a new VSCode command to ECU Explorer.

## Prerequisites

- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Understand system architecture
- Read [`specs/WEBVIEW_PROTOCOL.md`](../specs/WEBVIEW_PROTOCOL.md) - Understand webview communication
- Review existing commands: [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)
- Understand VSCode command API: https://code.visualstudio.com/api/references/commands

## Step-by-Step Instructions

### 1. Define Command ID

Choose a unique command ID following the pattern: `ecu-explorer.commandName`

**File**: `apps/vscode/src/extension.ts`

```typescript
const COMMAND_IDS = {
  OPEN_ROM: 'ecu-explorer.openRom',
  OPEN_TABLE: 'ecu-explorer.openTable',
  EXPORT_CSV: 'ecu-explorer.exportCsv',
  YOUR_COMMAND: 'ecu-explorer.yourCommand', // Add your command
};
```

### 2. Implement Command Handler

Add the command handler function:

```typescript
/**
 * Handle your command
 * 
 * This command does something useful.
 * 
 * @param context - Extension context
 * @returns Promise that resolves when command completes
 */
async function yourCommandHandler(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Get active editor or show file picker
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor');
      return;
    }
    
    // Perform command logic
    const result = await performYourAction(editor.document);
    
    // Show result to user
    vscode.window.showInformationMessage(`Command completed: ${result}`);
  } catch (error) {
    logger.error('Command failed', { error });
    vscode.window.showErrorMessage(`Command failed: ${error.message}`);
  }
}

async function performYourAction(document: vscode.TextDocument): Promise<string> {
  // Implement your command logic here
  return 'Success';
}
```

### 3. Register Command

Register the command in the `activate` function:

```typescript
export function activate(context: vscode.ExtensionContext) {
  // Register your command
  const yourCommand = vscode.commands.registerCommand(
    COMMAND_IDS.YOUR_COMMAND,
    () => yourCommandHandler(context)
  );
  
  context.subscriptions.push(yourCommand);
  
  // ... rest of activation code
}
```

### 4. Add to Command Palette

Add the command to `package.json` so it appears in the command palette:

**File**: `apps/vscode/package.json`

```json
{
  "contributes": {
    "commands": [
      {
        "command": "ecu-explorer.yourCommand",
        "title": "ECU Explorer: Your Command",
        "description": "Description of what your command does",
        "category": "ECU Explorer"
      }
    ]
  }
}
```

### 5. Add Keyboard Shortcut (Optional)

Add a keyboard shortcut for your command:

```json
{
  "contributes": {
    "keybindings": [
      {
        "command": "ecu-explorer.yourCommand",
        "key": "ctrl+shift+y",
        "mac": "cmd+shift+y",
        "when": "editorFocus"
      }
    ]
  }
}
```

### 6. Add Webview Integration (If Needed)

If your command needs to communicate with the webview:

```typescript
async function yourCommandHandler(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Get webview panel
    const panel = getActiveWebviewPanel();
    if (!panel) {
      vscode.window.showErrorMessage('No active webview');
      return;
    }
    
    // Send message to webview
    panel.webview.postMessage({
      type: 'yourCommandRequest',
      data: {
        // Your data here
      },
    });
    
    // Wait for response
    const response = await waitForWebviewResponse('yourCommandResponse');
    
    // Handle response
    vscode.window.showInformationMessage(`Result: ${response.data}`);
  } catch (error) {
    logger.error('Command failed', { error });
    vscode.window.showErrorMessage(`Command failed: ${error.message}`);
  }
}
```

### 7. Add Tests

Create tests for your command:

**File**: `apps/vscode/test/your-command.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate } from '../src/extension';

describe('Your Command', () => {
  let context: vscode.ExtensionContext;
  
  beforeEach(() => {
    context = createMockContext();
  });
  
  it('registers the command', () => {
    activate(context);
    
    const command = vscode.commands.getCommands().then(commands => 
      commands.includes('ecu-explorer.yourCommand')
    );
    
    expect(command).resolves.toBe(true);
  });
  
  it('executes successfully with valid input', async () => {
    activate(context);
    
    const result = await vscode.commands.executeCommand('ecu-explorer.yourCommand');
    
    expect(result).toBeDefined();
  });
  
  it('shows error message on failure', async () => {
    activate(context);
    
    const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage');
    
    // Trigger error condition
    await vscode.commands.executeCommand('ecu-explorer.yourCommand');
    
    expect(showErrorSpy).toHaveBeenCalled();
  });
});
```

### 8. Update Documentation

Add your command to the README:

**File**: [`README.md`](../README.md)

```markdown
## Commands

- `ECU Explorer: Open ROM` - Open a ROM file
- `ECU Explorer: Open Table` - Open a table from the current ROM
- `ECU Explorer: Export CSV` - Export table data to CSV
- `ECU Explorer: Your Command` - Description of your command
```

## Common Mistakes and Fixes

### Mistake 1: Not Handling Errors

**Problem**: Command crashes without user feedback

**Fix**: Always wrap command logic in try-catch:
```typescript
// ✅ Correct: Handle errors gracefully
async function yourCommandHandler(): Promise<void> {
  try {
    await performAction();
    vscode.window.showInformationMessage('Success');
  } catch (error) {
    logger.error('Command failed', { error });
    vscode.window.showErrorMessage(`Failed: ${error.message}`);
  }
}

// ❌ Wrong: No error handling
async function yourCommandHandler(): Promise<void> {
  await performAction();
  vscode.window.showInformationMessage('Success');
}
```

### Mistake 2: Not Checking Prerequisites

**Problem**: Command fails because required state is missing

**Fix**: Validate prerequisites before executing:
```typescript
// ✅ Correct: Check prerequisites
async function yourCommandHandler(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }
  
  if (!isRomFile(editor.document)) {
    vscode.window.showErrorMessage('Not a ROM file');
    return;
  }
  
  // Proceed with command
}

// ❌ Wrong: No prerequisite checks
async function yourCommandHandler(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  processRom(editor.document); // May crash if editor is null
}
```

### Mistake 3: Not Registering Command

**Problem**: Command doesn't appear in command palette

**Fix**: Register command in both extension.ts and package.json:
```typescript
// ✅ Correct: Register in extension
const command = vscode.commands.registerCommand(
  'ecu-explorer.yourCommand',
  handler
);
context.subscriptions.push(command);

// ✅ Correct: Add to package.json
{
  "contributes": {
    "commands": [
      {
        "command": "ecu-explorer.yourCommand",
        "title": "ECU Explorer: Your Command"
      }
    ]
  }
}
```

## Verification Checklist

- [ ] Command ID defined following naming convention
- [ ] Command handler implemented with error handling
- [ ] Command registered in extension.ts
- [ ] Command added to package.json
- [ ] Keyboard shortcut added (if applicable)
- [ ] Webview integration added (if needed)
- [ ] Tests written and passing
- [ ] Documentation updated in README
- [ ] Command appears in command palette
- [ ] Command executes without errors
- [ ] Error messages are user-friendly
- [ ] Coverage meets targets (≥80%)
- [ ] JSDoc comments added
- [ ] DEVELOPMENT.md updated with completion

## Links to Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`specs/WEBVIEW_PROTOCOL.md`](../specs/WEBVIEW_PROTOCOL.md) - Webview communication protocol
- [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) - Extension entry point
- [`apps/vscode/package.json`](../apps/vscode/package.json) - Extension manifest
- [VSCode Command API](https://code.visualstudio.com/api/references/commands) - Official VSCode documentation
