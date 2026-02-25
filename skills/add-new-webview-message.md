# Add a New Host ↔ Webview Message Type

This guide explains how to add a new message type for communication between the VSCode host and the webview.

## Prerequisites

- Read [`specs/WEBVIEW_PROTOCOL.md`](../specs/WEBVIEW_PROTOCOL.md) - Understand message protocol
- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Understand system architecture
- Review existing messages in [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)
- Understand the webview implementation in [`packages/ui/src/routes/+page.svelte`](../packages/ui/src/routes/+page.svelte)

## Step-by-Step Instructions

### 1. Define Message Types

Define your message types in a shared location:

**File**: `apps/vscode/src/types/messages.ts` (create if doesn't exist)

```typescript
/**
 * Message sent from host to webview
 */
export interface HostToWebviewMessage {
  type: 'yourMessageType';
  data: {
    // Your message data
    param1: string;
    param2: number;
  };
}

/**
 * Message sent from webview to host
 */
export interface WebviewToHostMessage {
  type: 'yourMessageResponse';
  data: {
    // Your response data
    result: string;
    success: boolean;
  };
}

/**
 * All possible messages from host to webview
 */
export type HostMessage = 
  | { type: 'openRom'; data: { path: string } }
  | { type: 'openTable'; data: { tableId: string } }
  | { type: 'yourMessageType'; data: YourMessageData }
  | /* ... other message types ... */;

/**
 * All possible messages from webview to host
 */
export type WebviewMessage = 
  | { type: 'tableEdited'; data: { tableId: string; changes: any } }
  | { type: 'yourMessageResponse'; data: YourResponseData }
  | /* ... other message types ... */;
```

### 2. Add Host Handler

Add a handler in the VSCode extension:

**File**: `apps/vscode/src/extension.ts`

```typescript
/**
 * Handle message from webview
 */
function handleWebviewMessage(message: WebviewMessage): void {
  switch (message.type) {
    case 'yourMessageResponse':
      handleYourMessageResponse(message.data);
      break;
    
    case 'tableEdited':
      handleTableEdited(message.data);
      break;
    
    default:
      logger.warn('Unknown message type', { type: message.type });
  }
}

/**
 * Handle your message response from webview
 */
function handleYourMessageResponse(data: YourResponseData): void {
  logger.info('Received your message response', { data });
  
  // Process response
  if (data.success) {
    vscode.window.showInformationMessage(data.result);
  } else {
    vscode.window.showErrorMessage(`Error: ${data.result}`);
  }
}

/**
 * Send message to webview
 */
function sendToWebview(message: HostMessage): void {
  const panel = getActiveWebviewPanel();
  if (panel) {
    panel.webview.postMessage(message);
  }
}

/**
 * Send your message to webview
 */
function sendYourMessage(param1: string, param2: number): void {
  sendToWebview({
    type: 'yourMessageType',
    data: {
      param1,
      param2,
    },
  });
}
```

### 3. Add Webview Handler

Add a handler in the Svelte webview:

**File**: `packages/ui/src/routes/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { HostMessage, WebviewMessage } from '../../../apps/vscode/src/types/messages';
  
  /**
   * Handle message from host
   */
  function handleHostMessage(event: MessageEvent<HostMessage>): void {
    const message = event.data;
    
    switch (message.type) {
      case 'yourMessageType':
        handleYourMessage(message.data);
        break;
      
      case 'openRom':
        handleOpenRom(message.data);
        break;
      
      default:
        console.warn('Unknown message type', message.type);
    }
  }
  
  /**
   * Handle your message from host
   */
  function handleYourMessage(data: any): void {
    console.log('Received your message', data);
    
    // Process message
    const result = processYourMessage(data.param1, data.param2);
    
    // Send response back to host
    sendToHost({
      type: 'yourMessageResponse',
      data: {
        result,
        success: true,
      },
    });
  }
  
  /**
   * Send message to host
   */
  function sendToHost(message: WebviewMessage): void {
    if (window.acquireVsCodeApi) {
      const vscode = window.acquireVsCodeApi();
      vscode.postMessage(message);
    }
  }
  
  /**
   * Process your message
   */
  function processYourMessage(param1: string, param2: number): string {
    // Implement your logic here
    return `Processed: ${param1} with ${param2}`;
  }
  
  onMount(() => {
    window.addEventListener('message', handleHostMessage);
    
    return () => {
      window.removeEventListener('message', handleHostMessage);
    };
  });
</script>
```

### 4. Add Tests

Create tests for your message handling:

**File**: `apps/vscode/test/webview-messages.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebviewMessage, sendToWebview } from '../src/extension';
import type { WebviewMessage, HostMessage } from '../src/types/messages';

describe('Webview Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('handles your message response', () => {
    const message: WebviewMessage = {
      type: 'yourMessageResponse',
      data: {
        result: 'Success',
        success: true,
      },
    };
    
    expect(() => handleWebviewMessage(message)).not.toThrow();
  });
  
  it('sends your message to webview', () => {
    const sendSpy = vi.spyOn(global, 'postMessage');
    
    const message: HostMessage = {
      type: 'yourMessageType',
      data: {
        param1: 'test',
        param2: 42,
      },
    };
    
    sendToWebview(message);
    
    expect(sendSpy).toHaveBeenCalled();
  });
  
  it('handles errors in message processing', () => {
    const message: WebviewMessage = {
      type: 'yourMessageResponse',
      data: {
        result: 'Error occurred',
        success: false,
      },
    };
    
    expect(() => handleWebviewMessage(message)).not.toThrow();
  });
});
```

### 5. Add Webview Tests

Create tests for webview message handling:

**File**: `packages/ui/test/webview-messages.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Page from '../src/routes/+page.svelte';

describe('Webview Message Handling', () => {
  it('processes your message from host', () => {
    const { container } = render(Page);
    
    const message = {
      data: {
        type: 'yourMessageType',
        data: {
          param1: 'test',
          param2: 42,
        },
      },
    };
    
    window.dispatchEvent(new MessageEvent('message', message));
    
    // Verify message was processed
    expect(container).toBeDefined();
  });
  
  it('sends response back to host', () => {
    const postMessageSpy = vi.fn();
    window.acquireVsCodeApi = () => ({
      postMessage: postMessageSpy,
    });
    
    const message = {
      data: {
        type: 'yourMessageType',
        data: {
          param1: 'test',
          param2: 42,
        },
      },
    };
    
    window.dispatchEvent(new MessageEvent('message', message));
    
    expect(postMessageSpy).toHaveBeenCalled();
  });
});
```

### 6. Update Protocol Documentation

Update the webview protocol documentation:

**File**: [`specs/WEBVIEW_PROTOCOL.md`](../specs/WEBVIEW_PROTOCOL.md)

Add your message to the protocol specification:

```markdown
## Your Message Type

### Host → Webview

```json
{
  "type": "yourMessageType",
  "data": {
    "param1": "string",
    "param2": 42
  }
}
```

### Webview → Host

```json
{
  "type": "yourMessageResponse",
  "data": {
    "result": "string",
    "success": true
  }
}
```

### Description

Brief description of what this message does and when it's used.
```

## Common Mistakes and Fixes

### Mistake 1: Not Handling Message Type Correctly

**Problem**: Message handler crashes or ignores messages

**Fix**: Use proper type checking and exhaustive switch statements:
```typescript
// ✅ Correct: Exhaustive type checking
function handleMessage(message: HostMessage): void {
  switch (message.type) {
    case 'yourMessageType':
      handleYourMessage(message.data);
      break;
    case 'openRom':
      handleOpenRom(message.data);
      break;
    default:
      const _exhaustive: never = message;
      return _exhaustive;
  }
}

// ❌ Wrong: Missing type checking
function handleMessage(message: any): void {
  if (message.type === 'yourMessageType') {
    handleYourMessage(message.data);
  }
  // Other types silently ignored
}
```

### Mistake 2: Not Validating Message Data

**Problem**: Invalid data causes crashes

**Fix**: Validate message data before processing:
```typescript
// ✅ Correct: Validate data
function handleYourMessage(data: any): void {
  if (!data.param1 || typeof data.param1 !== 'string') {
    logger.error('Invalid param1', { data });
    return;
  }
  
  if (typeof data.param2 !== 'number') {
    logger.error('Invalid param2', { data });
    return;
  }
  
  processMessage(data);
}

// ❌ Wrong: No validation
function handleYourMessage(data: any): void {
  processMessage(data); // May crash if data is invalid
}
```

### Mistake 3: Not Handling Async Operations

**Problem**: Message handler doesn't wait for async operations

**Fix**: Use async/await for async operations:
```typescript
// ✅ Correct: Handle async operations
async function handleYourMessage(data: any): Promise<void> {
  try {
    const result = await performAsyncOperation(data);
    sendToHost({
      type: 'yourMessageResponse',
      data: { result, success: true },
    });
  } catch (error) {
    sendToHost({
      type: 'yourMessageResponse',
      data: { result: error.message, success: false },
    });
  }
}

// ❌ Wrong: Ignoring async operations
function handleYourMessage(data: any): void {
  performAsyncOperation(data); // Fire and forget
  sendToHost({
    type: 'yourMessageResponse',
    data: { result: 'Done', success: true },
  });
}
```

## Verification Checklist

- [ ] Message types defined in shared location
- [ ] Host handler implemented for webview messages
- [ ] Webview handler implemented for host messages
- [ ] Message validation added
- [ ] Error handling implemented
- [ ] Tests written for host handler
- [ ] Tests written for webview handler
- [ ] Protocol documentation updated
- [ ] Message types exported and typed correctly
- [ ] Async operations handled properly
- [ ] Coverage meets targets (≥80%)
- [ ] JSDoc comments added
- [ ] DEVELOPMENT.md updated with completion

## Links to Related Documentation

- [`specs/WEBVIEW_PROTOCOL.md`](../specs/WEBVIEW_PROTOCOL.md) - Webview protocol specification
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts) - Extension entry point
- [`packages/ui/src/routes/+page.svelte`](../packages/ui/src/routes/+page.svelte) - Webview implementation
