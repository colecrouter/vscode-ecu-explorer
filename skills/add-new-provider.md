# Implement a New ROM Definition Provider

This guide explains how to implement a new ROM definition provider (e.g., TunerPro, Cobb Accessport) for ECU Explorer.

## Prerequisites

- Read [`specs/PROVIDER_GUIDE.md`](../specs/PROVIDER_GUIDE.md) - Understand provider architecture
- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Understand system design
- Review existing provider: [`packages/providers/ecuflash/src/index.ts`](../packages/providers/ecuflash/src/index.ts)
- Understand the ROM definition format for your target provider
- Understand the table schema: [`specs/TABLE_SCHEMA.md`](../specs/TABLE_SCHEMA.md)

## Step-by-Step Implementation

### 1. Create Provider Package

Create a new package for your provider:

```bash
mkdir -p packages/providers/your-provider/src
mkdir -p packages/providers/your-provider/test
```

**File**: `packages/providers/your-provider/package.json`

```json
{
  "name": "@ecu-explorer/provider-your-provider",
  "version": "1.0.0",
  "description": "Your Provider ROM definition provider",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "dependencies": {
    "@ecu-explorer/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### 2. Define Provider Interface

**File**: `packages/providers/your-provider/src/index.ts`

Implement the provider interface:

```typescript
import { RomDefinitionProvider, RomDefinition } from '@ecu-explorer/core';

export class YourProviderDefinitionProvider implements RomDefinitionProvider {
  name = 'Your Provider';
  
  /**
   * Check if a file is a valid Your Provider definition
   */
  canHandle(filePath: string, content: Uint8Array): boolean {
    // Check file extension
    if (!filePath.endsWith('.xml')) return false;
    
    // Check for Your Provider XML signature
    const text = new TextDecoder().decode(content.subarray(0, 1000));
    return text.includes('YourProviderSignature');
  }
  
  /**
   * Parse Your Provider definition file
   */
  async parse(filePath: string, content: Uint8Array): Promise<RomDefinition> {
    const text = new TextDecoder().decode(content);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    
    return {
      name: this.extractName(doc),
      version: this.extractVersion(doc),
      tables: this.extractTables(doc),
      fingerprints: this.extractFingerprints(doc),
    };
  }
  
  private extractName(doc: Document): string {
    // Extract definition name from XML
    const nameElement = doc.querySelector('name');
    return nameElement?.textContent || 'Unknown';
  }
  
  private extractVersion(doc: Document): string {
    // Extract version from XML
    const versionElement = doc.querySelector('version');
    return versionElement?.textContent || '1.0.0';
  }
  
  private extractTables(doc: Document): Table[] {
    // Extract all tables from XML
    const tables: Table[] = [];
    const tableElements = doc.querySelectorAll('table');
    
    tableElements.forEach(element => {
      const table = this.parseTable(element);
      if (table) tables.push(table);
    });
    
    return tables;
  }
  
  private parseTable(element: Element): Table | null {
    const type = element.getAttribute('type');
    
    switch (type) {
      case '1d':
        return this.parseTable1D(element);
      case '2d':
        return this.parseTable2D(element);
      case '3d':
        return this.parseTable3D(element);
      default:
        return null;
    }
  }
  
  private parseTable1D(element: Element): Table1D {
    return {
      type: '1d',
      name: element.getAttribute('name') || '',
      address: parseInt(element.getAttribute('address') || '0', 16),
      length: parseInt(element.getAttribute('length') || '0'),
      dataType: (element.getAttribute('dataType') || 'u8') as DataType,
      endianness: (element.getAttribute('endianness') || 'big') as Endianness,
      headers: this.parseHeaders(element),
    };
  }
  
  private parseTable2D(element: Element): Table2D {
    return {
      type: '2d',
      name: element.getAttribute('name') || '',
      address: parseInt(element.getAttribute('address') || '0', 16),
      rows: parseInt(element.getAttribute('rows') || '0'),
      columns: parseInt(element.getAttribute('columns') || '0'),
      dataType: (element.getAttribute('dataType') || 'u8') as DataType,
      endianness: (element.getAttribute('endianness') || 'big') as Endianness,
      rowHeaders: this.parseHeaders(element, 'row'),
      columnHeaders: this.parseHeaders(element, 'column'),
    };
  }
  
  private parseTable3D(element: Element): Table3D {
    return {
      type: '3d',
      name: element.getAttribute('name') || '',
      address: parseInt(element.getAttribute('address') || '0', 16),
      rows: parseInt(element.getAttribute('rows') || '0'),
      columns: parseInt(element.getAttribute('columns') || '0'),
      depth: parseInt(element.getAttribute('depth') || '0'),
      dataType: (element.getAttribute('dataType') || 'u8') as DataType,
      endianness: (element.getAttribute('endianness') || 'big') as Endianness,
      rowHeaders: this.parseHeaders(element, 'row'),
      columnHeaders: this.parseHeaders(element, 'column'),
      depthHeaders: this.parseHeaders(element, 'depth'),
    };
  }
  
  private parseHeaders(element: Element, type?: string): number[] {
    // Extract header values from XML
    const selector = type ? `headers[type="${type}"] value` : 'headers value';
    const headerElements = element.querySelectorAll(selector);
    
    return Array.from(headerElements).map(el => 
      parseFloat(el.textContent || '0')
    );
  }
  
  private extractFingerprints(doc: Document): RomFingerprint[] {
    // Extract ROM fingerprints for matching
    const fingerprints: RomFingerprint[] = [];
    const fpElements = doc.querySelectorAll('fingerprint');
    
    fpElements.forEach(element => {
      fingerprints.push({
        offset: parseInt(element.getAttribute('offset') || '0', 16),
        bytes: element.textContent || '',
      });
    });
    
    return fingerprints;
  }
}

export default new YourProviderDefinitionProvider();
```

### 3. Add Tests

**File**: `packages/providers/your-provider/test/your-provider.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import provider from '../src/index';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Your Provider', () => {
  it('recognizes Your Provider definition files', () => {
    const content = readFileSync(
      join(__dirname, 'fixtures/sample-definition.xml')
    );
    
    expect(provider.canHandle('definition.xml', content)).toBe(true);
  });
  
  it('rejects non-Your Provider files', () => {
    const content = new TextEncoder().encode('This is not a valid definition file');
    expect(provider.canHandle('definition.xml', content)).toBe(false);
  });
  
  it('parses Your Provider definitions', async () => {
    const content = readFileSync(
      join(__dirname, 'fixtures/sample-definition.xml')
    );
    
    const definition = await provider.parse('definition.xml', content);
    
    expect(definition.name).toBeDefined();
    expect(definition.tables.length).toBeGreaterThan(0);
  });
  
  it('extracts table metadata', async () => {
    const content = readFileSync(
      join(__dirname, 'fixtures/sample-definition.xml')
    );
    
    const definition = await provider.parse('definition.xml', content);
    const table = definition.tables[0];
    
    expect(table.name).toBeDefined();
    expect(table.address).toBeGreaterThan(0);
    expect(table.type).toMatch(/1d|2d|3d/);
  });
});
```

### 4. Create Test Fixtures

**File**: `packages/providers/your-provider/test/fixtures/sample-definition.xml`

Create a sample definition file for testing:

```xml
<?xml version="1.0" encoding="utf-8"?>
<YourProviderDefinition>
  <name>Sample ECU Definition</name>
  <version>1.0.0</version>
  
  <table type="1d" name="Idle RPM" address="0x1000" length="16" dataType="u16" endianness="big">
    <headers type="row">
      <value>500</value>
      <value>1000</value>
      <!-- ... more values ... -->
    </headers>
  </table>
  
  <fingerprint offset="0x0">SIGNATURE_BYTES</fingerprint>
</YourProviderDefinition>
```

### 5. Register Provider in Extension

**File**: [`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)

Register your provider:

```typescript
import yourProvider from '@ecu-explorer/provider-your-provider';

export function activate(context: vscode.ExtensionContext) {
  // Register your provider
  definitionManager.registerProvider(yourProvider);
  
  // ... rest of activation code
}
```

### 6. Update Package Dependencies

**File**: `package.json` (root)

Add your provider to the workspace:

```json
{
  "workspaces": [
    "packages/core",
    "packages/ui",
    "packages/providers/ecuflash",
    "packages/providers/your-provider"
  ]
}
```

## Common Mistakes and Fixes

### Mistake 1: Incorrect Offset Calculation

**Problem**: Tables are read from wrong ROM addresses

**Fix**: Ensure offsets are parsed correctly:
```typescript
// ✅ Correct: Parse hex offset
const address = parseInt(element.getAttribute('address') || '0', 16);

// ❌ Wrong: Parse as decimal
const address = parseInt(element.getAttribute('address') || '0');
```

### Mistake 2: Missing Endianness Handling

**Problem**: Multi-byte values are decoded incorrectly

**Fix**: Always specify and respect endianness:
```typescript
// ✅ Correct: Include endianness
const table = {
  type: '1d',
  endianness: (element.getAttribute('endianness') || 'big') as Endianness,
  // ...
};

// ❌ Wrong: Assume endianness
const table = {
  type: '1d',
  // Missing endianness specification
};
```

### Mistake 3: Not Validating Input

**Problem**: Invalid definitions cause crashes

**Fix**: Validate parsed data:
```typescript
// ✅ Correct: Validate before returning
if (!definition.name || definition.tables.length === 0) {
  throw new Error('Invalid definition: missing name or tables');
}

// ❌ Wrong: No validation
return definition;
```

## Verification Checklist

- [ ] Provider package created with correct structure
- [ ] Provider interface implemented correctly
- [ ] All table types (1D, 2D, 3D) parsed correctly
- [ ] Endianness handled properly
- [ ] Offsets calculated correctly
- [ ] Tests written and passing
- [ ] Test fixtures created
- [ ] Provider registered in extension
- [ ] Package dependencies updated
- [ ] Coverage meets targets (≥80%)
- [ ] JSDoc comments added
- [ ] DEVELOPMENT.md updated with completion

## Links to Related Documentation

- [`specs/PROVIDER_GUIDE.md`](../specs/PROVIDER_GUIDE.md) - Provider architecture guide
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`specs/TABLE_SCHEMA.md`](../specs/TABLE_SCHEMA.md) - Table schema specification
- [`packages/providers/ecuflash/src/index.ts`](../packages/providers/ecuflash/src/index.ts) - Example provider
- [`packages/core/src/definition/provider.ts`](../packages/core/src/definition/provider.ts) - Provider interface
