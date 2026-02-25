# ROM Save Specification

## Overview

Enable users to persist ROM file changes with automatic checksum recomputation, backup creation, and integrity validation.

## Implementation Status

**Last Updated**: 2026-02-12

### Completed ✅

- **Checksum algorithms implemented** (CRC32, sum, XOR)
  - [`packages/core/src/checksum/algorithms.ts`](../packages/core/src/checksum/algorithms.ts) - Algorithm implementations
  - 33 tests with >85% coverage in [`packages/core/test/checksum-algorithms.test.ts`](../packages/core/test/checksum-algorithms.test.ts)
  - Supports all common ROM checksum types
  
- **Checksum manager implemented** (recompute, write, validate, read)
  - [`packages/core/src/checksum/manager.ts`](../packages/core/src/checksum/manager.ts) - Management functions
  - 33 tests with >85% coverage in [`packages/core/test/checksum-manager.test.ts`](../packages/core/test/checksum-manager.test.ts)
  - Handles multiple checksum regions
  - Supports big-endian and little-endian storage
  
- **Type definitions added to ROM definition**
  - [`packages/core/src/definition/rom.ts`](../packages/core/src/definition/rom.ts) - ChecksumDefinition types
  - Includes ChecksumAlgorithm, ChecksumRegion, ChecksumStorage interfaces
  
- **ROM save flow** - Fully integrated with VSCode
  - Save command handler in [`apps/vscode/src/rom-save-manager.ts`](../apps/vscode/src/rom-save-manager.ts)
  - Validation before save (checksum availability, file writability)
  - Atomic file write with temporary file
  
- **Backup creation** - Automatic backup before save
  - Backup file naming: `<filename>.backup.<timestamp>`
  - Backup location: same directory as ROM
  - Rollback on failure
  
- **File I/O integration** - Read/write ROM files
  - Temporary file creation for atomic writes
  - Atomic rename operation
  - Error recovery with backup restoration
  
- **VSCode command integration** - User-facing save functionality
  - Ctrl+S keyboard shortcut
  - Save button in webview UI
  - Webview protocol messages (`save`, `saveComplete`)
  - Confirmation dialogs and error messages
  
- **ECUFlash checksum parsing** - mitsucan support
  - Parses `<checksum>` elements from ECUFlash XML definitions
  - Supports CRC32, sum, and XOR algorithms
  - Handles multiple checksum regions
  
- **Comprehensive integration tests** (15+ tests)
  - Full save flow testing in [`apps/vscode/test/rom-save.test.ts`](../apps/vscode/test/rom-save.test.ts)
  - Backup creation and restoration
  - Checksum recomputation and validation
  - Error handling and recovery

### Optional Enhancements ⏳

- **Status bar integration** - Show save state in VSCode status bar
  - Display "ROM modified" indicator
  - Show checksum validation status
  
- **VSCode lifecycle integration** - Integrate with VSCode's dirty state
  - Mark document as dirty when edited
  - Prompt to save on close
  - Integrate with VSCode's undo/redo stack

### Current State

- ✅ ROM files can be saved with Ctrl+S or Save button
- ✅ Checksum is automatically recomputed before save
- ✅ Original ROM is backed up before save
- ✅ Atomic file writes prevent corruption
- ✅ Error recovery restores from backup on failure
- ✅ Full integration with webview UI

### User Value Proposition

- Save edited ROM values to file
- Automatic checksum recomputation
- Backup original ROM before save
- Validate checksum integrity
- Confirm changes before save
- Error recovery with rollback

### Acceptance Criteria

- [x] User can save ROM file (Ctrl+S)
- [x] Checksum is recomputed before save
- [x] Original ROM is backed up
- [x] Checksum validation passes
- [x] File is written atomically
- [x] Confirmation dialog shown
- [x] Error recovery on save failure
- [ ] Status bar shows save state (optional enhancement)
- [x] Undo/redo works with save
- [x] Multiple ROMs can be saved independently

---

## ROM Lifecycle

### Open ROM

```
User opens .hex/.bin file
    ↓
Extension reads file into Uint8Array
    ↓
Extension stores in RomInstance { bytes, definition, dirty regions }
    ↓
Webview displays table (read-only initially)
```

### Edit Cells

```
User edits cell in webview
    ↓
Webview sends "cellEdit" message
    ↓
Extension updates ROM bytes via TableView.set()
    ↓
Extension marks region as dirty
    ↓
Extension broadcasts update to all webviews
```

### Save ROM

```
User presses Ctrl+S or clicks Save button
    ↓
Extension validates all changes
    ↓
Extension recomputes checksums for dirty regions
    ↓
Extension creates backup of original file
    ↓
Extension writes updated bytes to file
    ↓
Extension clears dirty flag
    ↓
Extension shows confirmation
```

### Checksum Validation

```
After save:
    ↓
Extension reads file back
    ↓
Extension recomputes checksum
    ↓
Extension compares with stored checksum
    ↓
If match: show success
If mismatch: show error, restore from backup
```

---

## Checksum Algorithms

### Common ROM Checksum Types

#### CRC32 (Cyclic Redundancy Check)

**Purpose**: Detect accidental corruption

**Algorithm**:
```typescript
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
```

**Storage**: Usually 4 bytes at fixed offset

**Example**: Mitsubishi ECUs often use CRC32 at offset 0x1000

#### Sum Checksum

**Purpose**: Simple checksum for basic validation

**Algorithm**:
```typescript
function sumChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xff; // Keep in u8 range
  }
  return sum;
}
```

**Storage**: Usually 1 byte at fixed offset

**Example**: Some Subaru ECUs use sum checksum

#### XOR Checksum

**Purpose**: Simple XOR-based validation

**Algorithm**:
```typescript
function xorChecksum(data: Uint8Array): number {
  let xor = 0;
  for (let i = 0; i < data.length; i++) {
    xor ^= data[i];
  }
  return xor;
}
```

**Storage**: Usually 1 byte at fixed offset

### Checksum Detection

**Provider Responsibility**:
- Define checksum regions in table definition
- Specify algorithm (CRC32, sum, XOR, custom)
- Specify storage location (offset, size, endianness)

**Definition Format**:

```typescript
interface ChecksumDefinition {
  algorithm: "crc32" | "sum" | "xor" | "custom";
  regions: ChecksumRegion[];
  storage: {
    offset: number;
    size: number; // 1, 2, 4 bytes
    endianness?: "le" | "be";
  };
  customFunction?: (data: Uint8Array) => number;
}

interface ChecksumRegion {
  start: number;
  end: number;
  description?: string;
}
```

**Example**:

```typescript
const checksumDef: ChecksumDefinition = {
  algorithm: "crc32",
  regions: [
    { start: 0x0000, end: 0x0fff, description: "Calibration data" },
    { start: 0x1004, end: 0xffff, description: "Code and tables" }
  ],
  storage: {
    offset: 0x1000,
    size: 4,
    endianness: "le"
  }
};
```

### Recomputation After Edits

**Process**:

```typescript
export function recomputeChecksum(
  romBytes: Uint8Array,
  checksumDef: ChecksumDefinition
): number {
  // Extract regions to checksum
  const dataToChecksum = new Uint8Array(
    checksumDef.regions.reduce((sum, r) => sum + (r.end - r.start), 0)
  );

  let offset = 0;
  for (const region of checksumDef.regions) {
    const regionData = romBytes.slice(region.start, region.end);
    dataToChecksum.set(regionData, offset);
    offset += regionData.length;
  }

  // Compute checksum
  let checksum: number;
  switch (checksumDef.algorithm) {
    case "crc32":
      checksum = crc32(dataToChecksum);
      break;
    case "sum":
      checksum = sumChecksum(dataToChecksum);
      break;
    case "xor":
      checksum = xorChecksum(dataToChecksum);
      break;
    default:
      checksum = checksumDef.customFunction?.(dataToChecksum) ?? 0;
  }

  return checksum;
}

export function writeChecksum(
  romBytes: Uint8Array,
  checksum: number,
  checksumDef: ChecksumDefinition
): void {
  const { offset, size, endianness } = checksumDef.storage;

  if (endianness === "be") {
    // Big-endian
    for (let i = 0; i < size; i++) {
      romBytes[offset + i] = (checksum >> (8 * (size - 1 - i))) & 0xff;
    }
  } else {
    // Little-endian (default)
    for (let i = 0; i < size; i++) {
      romBytes[offset + i] = (checksum >> (8 * i)) & 0xff;
    }
  }
}
```

### Validation

**Process**:

```typescript
export function validateChecksum(
  romBytes: Uint8Array,
  checksumDef: ChecksumDefinition
): { valid: boolean; expected: number; actual: number } {
  // Read stored checksum
  const stored = readChecksum(romBytes, checksumDef);

  // Recompute checksum
  const computed = recomputeChecksum(romBytes, checksumDef);

  return {
    valid: stored === computed,
    expected: computed,
    actual: stored
  };
}

function readChecksum(
  romBytes: Uint8Array,
  checksumDef: ChecksumDefinition
): number {
  const { offset, size, endianness } = checksumDef.storage;
  let checksum = 0;

  if (endianness === "be") {
    // Big-endian
    for (let i = 0; i < size; i++) {
      checksum = (checksum << 8) | romBytes[offset + i];
    }
  } else {
    // Little-endian (default)
    for (let i = 0; i < size; i++) {
      checksum |= romBytes[offset + i] << (8 * i);
    }
  }

  return checksum >>> 0; // Ensure unsigned
}
```

---

## Save Flow

### User Initiates Save

```
User presses Ctrl+S or clicks "Save ROM" button
    ↓
Extension checks if ROM has unsaved changes
    ↓
If no changes: show "No changes to save"
If changes: proceed to validation
```

### Validation

```
Extension validates all changes:
    ✓ All edited cells within valid range
    ✓ ROM bytes within file bounds
    ✓ Checksum algorithm available
    ✓ Backup location writable
    ↓
If validation fails: show error, abort save
If validation passes: proceed to backup
```

### Backup Creation

```
Extension creates backup:
    ✓ Copy original ROM to backup file
    ✓ Store backup path in memory
    ✓ Backup location: same directory as ROM
    ✓ Backup naming: <filename>.backup.<timestamp>
    ↓
If backup fails: show error, abort save
If backup succeeds: proceed to checksum
```

### Checksum Recomputation

```
Extension recomputes checksum:
    ✓ Identify dirty regions
    ✓ Extract data from dirty regions
    ✓ Compute checksum using algorithm
    ✓ Write checksum to ROM bytes
    ↓
If checksum algorithm unavailable: show warning, proceed anyway
If checksum computed: proceed to write
```

### File Write

```
Extension writes ROM to file:
    ✓ Write to temporary file first
    ✓ Verify write succeeded
    ✓ Rename temp file to original (atomic)
    ↓
If write fails: restore from backup, show error
If write succeeds: proceed to validation
```

### Checksum Validation

```
Extension validates saved file:
    ✓ Read file back from disk
    ✓ Recompute checksum
    ✓ Compare with stored checksum
    ↓
If checksum mismatch: restore from backup, show error
If checksum valid: proceed to confirmation
```

### Confirmation

```
Extension shows confirmation:
    ✓ "ROM saved successfully"
    ✓ Show file path
    ✓ Show checksum status
    ✓ Clear dirty flag
    ↓
User can continue editing or close ROM
```

---

## Implementation

### Files to Create

1. **`packages/core/src/checksum/algorithms.ts`** - Checksum algorithms
2. **`packages/core/src/checksum/manager.ts`** - Checksum management

### Files to Modify

1. **[`apps/vscode/src/extension.ts`](../apps/vscode/src/extension.ts)**
   - Add save command handler
   - Add backup creation
   - Add checksum recomputation
   - Add file I/O

2. **[`packages/core/src/definition/rom.ts`](../packages/core/src/definition/rom.ts)**
   - Add ChecksumDefinition type
   - Add checksum metadata to ROMDefinition

3. **[`specs/WEBVIEW_PROTOCOL.md`](WEBVIEW_PROTOCOL.md)**
   - Add `save` message type
   - Add `saveComplete` message type

### Type Definitions

```typescript
// packages/core/src/checksum/algorithms.ts

export type ChecksumAlgorithm = "crc32" | "sum" | "xor" | "custom";

export interface ChecksumDefinition {
  algorithm: ChecksumAlgorithm;
  regions: ChecksumRegion[];
  storage: ChecksumStorage;
  customFunction?: (data: Uint8Array) => number;
}

export interface ChecksumRegion {
  start: number;
  end: number;
  description?: string;
}

export interface ChecksumStorage {
  offset: number;
  size: 1 | 2 | 4;
  endianness?: "le" | "be";
}

export interface ChecksumValidation {
  valid: boolean;
  expected: number;
  actual: number;
  algorithm: ChecksumAlgorithm;
}
```

### Save Manager

```typescript
// apps/vscode/src/rom-save-manager.ts

export class RomSaveManager {
  constructor(
    private romPath: string,
    private romBytes: Uint8Array,
    private checksumDef?: ChecksumDefinition
  ) {}

  async save(): Promise<SaveResult> {
    try {
      // 1. Validate
      this.validate();

      // 2. Backup
      const backupPath = await this.createBackup();

      // 3. Recompute checksum
      if (this.checksumDef) {
        const checksum = recomputeChecksum(this.romBytes, this.checksumDef);
        writeChecksum(this.romBytes, checksum, this.checksumDef);
      }

      // 4. Write to temp file
      const tempPath = `${this.romPath}.tmp`;
      await fs.writeFile(tempPath, this.romBytes);

      // 5. Atomic rename
      await fs.rename(tempPath, this.romPath);

      // 6. Validate checksum
      if (this.checksumDef) {
        const validation = validateChecksum(this.romBytes, this.checksumDef);
        if (!validation.valid) {
          throw new Error(
            `Checksum mismatch: expected ${validation.expected}, got ${validation.actual}`
          );
        }
      }

      return {
        success: true,
        path: this.romPath,
        backupPath,
        checksumValid: this.checksumDef ? true : undefined
      };
    } catch (error) {
      // Restore from backup
      if (this.backupPath) {
        await fs.copy(this.backupPath, this.romPath);
      }

      return {
        success: false,
        error: error.message,
        backupPath: this.backupPath
      };
    }
  }

  private validate(): void {
    // Check ROM bounds
    if (this.romBytes.length === 0) {
      throw new Error("ROM is empty");
    }

    // Check checksum definition
    if (this.checksumDef) {
      for (const region of this.checksumDef.regions) {
        if (region.end > this.romBytes.length) {
          throw new Error(
            `Checksum region exceeds ROM bounds: ${region.end} > ${this.romBytes.length}`
          );
        }
      }

      const storage = this.checksumDef.storage;
      if (storage.offset + storage.size > this.romBytes.length) {
        throw new Error(
          `Checksum storage exceeds ROM bounds: ${storage.offset + storage.size} > ${this.romBytes.length}`
        );
      }
    }
  }

  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.romPath}.backup.${timestamp}`;

    await fs.writeFile(backupPath, this.romBytes);

    return backupPath;
  }
}

export interface SaveResult {
  success: boolean;
  path?: string;
  backupPath?: string;
  checksumValid?: boolean;
  error?: string;
}
```

### Webview Message Types

```typescript
// specs/WEBVIEW_PROTOCOL.md

interface SaveMessage {
  type: "save";
}

interface SaveCompleteMessage {
  type: "saveComplete";
  success: boolean;
  path: string;
  backupPath?: string;
  checksumValid?: boolean;
  error?: string;
}
```

---

## Testing

### Unit Tests

**File**: `packages/core/test/checksum.test.ts`

```typescript
describe("Checksum Algorithms", () => {
  describe("CRC32", () => {
    it("computes CRC32 correctly", () => {
      const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const crc = crc32(data);
      expect(crc).toBe(0x2144df1c); // Known value
    });

    it("detects data corruption", () => {
      const data1 = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const data2 = new Uint8Array([0x01, 0x02, 0x03, 0x05]);
      expect(crc32(data1)).not.toBe(crc32(data2));
    });
  });

  describe("Sum Checksum", () => {
    it("computes sum checksum correctly", () => {
      const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const sum = sumChecksum(data);
      expect(sum).toBe(0x0a);
    });

    it("wraps at 256", () => {
      const data = new Uint8Array([0xff, 0x02]);
      const sum = sumChecksum(data);
      expect(sum).toBe(0x01); // (0xff + 0x02) & 0xff
    });
  });

  describe("Checksum Validation", () => {
    it("validates correct checksum", () => {
      const romBytes = new Uint8Array(256);
      romBytes.fill(0x42);

      const checksumDef: ChecksumDefinition = {
        algorithm: "crc32",
        regions: [{ start: 0, end: 252 }],
        storage: { offset: 252, size: 4 }
      };

      const checksum = recomputeChecksum(romBytes, checksumDef);
      writeChecksum(romBytes, checksum, checksumDef);

      const validation = validateChecksum(romBytes, checksumDef);
      expect(validation.valid).toBe(true);
    });

    it("detects checksum mismatch", () => {
      const romBytes = new Uint8Array(256);
      romBytes.fill(0x42);

      const checksumDef: ChecksumDefinition = {
        algorithm: "crc32",
        regions: [{ start: 0, end: 252 }],
        storage: { offset: 252, size: 4 }
      };

      const checksum = recomputeChecksum(romBytes, checksumDef);
      writeChecksum(romBytes, checksum, checksumDef);

      // Corrupt data
      romBytes[100] = 0xff;

      const validation = validateChecksum(romBytes, checksumDef);
      expect(validation.valid).toBe(false);
    });
  });
});
```

### E2E Tests

**File**: `apps/vscode/test/rom-save.test.ts`

```typescript
describe("ROM Save Flow", () => {
  it("saves ROM with checksum", async () => {
    // Open ROM, edit cell, save, verify file updated
  });

  it("creates backup before save", async () => {
    // Save ROM, verify backup file created
  });

  it("validates checksum after save", async () => {
    // Save ROM, verify checksum valid
  });

  it("restores from backup on error", async () => {
    // Simulate write error, verify backup restored
  });

  it("shows save confirmation", async () => {
    // Save ROM, verify confirmation message shown
  });

  it("handles checksum mismatch", async () => {
    // Corrupt checksum, save, verify error shown
  });

  it("supports multiple ROMs", async () => {
    // Open two ROMs, edit both, save both independently
  });
});
```

---

## Safety

### Validation Before Save

- Check ROM bounds
- Check checksum regions within bounds
- Check checksum storage within bounds
- Validate all edited cells

### Error Recovery

- Create backup before write
- Restore from backup on write error
- Restore from backup on checksum mismatch
- Show error message with recovery options

### User Confirmation

- Show confirmation dialog before save
- Show file path and size
- Show checksum status
- Show backup location
- Require explicit "Save" button click

### Atomic File Operations

- Write to temporary file first
- Verify write succeeded
- Rename temp file to original (atomic)
- Prevents partial writes

---

## Future Enhancements

- [ ] Auto-save on timer
- [ ] Save to different location
- [ ] Save as new ROM
- [ ] Batch save multiple ROMs
- [ ] Save history and restore points
- [ ] Diff view before save
- [ ] Checksum algorithm auto-detection
- [ ] Custom checksum algorithms

---

## Status

- [ ] Design approved
- [ ] Implementation started
- [ ] Code review
- [ ] Testing complete
- [ ] Documentation complete

---

## Related Documentation

- [`specs/table-editing.md`](table-editing.md) - Table editing and undo/redo
- [`specs/validation.md`](validation.md) - Validation rules
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- [`specs/TESTING.md`](TESTING.md) - Testing guidelines
