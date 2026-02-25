# Checksum Architecture Analysis

## Current Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                     ROM Definition (XML)                         │
│  <checksummodule>mitsucan</checksummodule>                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              ECUFlash Provider (Parser)                          │
│  packages/providers/ecuflash/src/index.ts                       │
│                                                                  │
│  parseChecksumModule(checksumModule: string)                    │
│    ├─ "mitsucan" → ChecksumDefinition                          │
│    │    algorithm: "crc32"  ⚠️ INCORRECT MAPPING               │
│    │    regions: [{ start: 0, end: 0x7fffc }]                  │
│    │    storage: { offset: 0x7fffc, size: 4, endianness: "le" }│
│    └─ Returns ChecksumDefinition                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Core Type Definition                            │
│  packages/core/src/definition/rom.ts                            │
│                                                                  │
│  type ChecksumAlgorithm = "crc32" | "sum" | "xor" | "custom"   │
│                                                                  │
│  interface ChecksumDefinition {                                 │
│    algorithm: ChecksumAlgorithm                                 │
│    regions: ChecksumRegion[]                                    │
│    storage: ChecksumStorage                                     │
│    customFunction?: (data: Uint8Array) => number                │
│  }                                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Checksum Manager (Orchestrator)                     │
│  packages/core/src/checksum/manager.ts                          │
│                                                                  │
│  recomputeChecksum(romBytes, checksumDef)                       │
│    ├─ Validates regions                                         │
│    ├─ Zeros out checksum storage location                       │
│    ├─ Collects data from regions                                │
│    └─ Calls computeChecksum() ──────────────┐                  │
│                                              │                  │
│  validateChecksum(romBytes, checksumDef)     │                  │
│    ├─ Reads stored checksum                 │                  │
│    ├─ Recomputes checksum                   │                  │
│    └─ Compares values                        │                  │
│                                              │                  │
│  writeChecksum(romBytes, checksum, def)      │                  │
│    └─ Writes checksum with correct endianness│                  │
│                                              │                  │
│  readChecksum(romBytes, checksumDef)         │                  │
│    └─ Reads checksum with correct endianness │                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│           Algorithm Implementations (Pure Functions)             │
│  packages/core/src/checksum/algorithms.ts                       │
│                                                                  │
│  computeChecksum(data, algorithm, customFunction?)              │
│    ├─ "crc32"  → crc32(data)                                   │
│    ├─ "sum"    → sumChecksum(data)                             │
│    ├─ "xor"    → xorChecksum(data)                             │
│    └─ "custom" → customFunction(data)                           │
│                                                                  │
│  crc32(data: Uint8Array): number                                │
│    └─ Standard CRC32 with polynomial 0xEDB88320                 │
│                                                                  │
│  sumChecksum(data: Uint8Array): number                          │
│    └─ Simple byte sum with u8 wrapping                          │
│                                                                  │
│  xorChecksum(data: Uint8Array): number                          │
│    └─ XOR all bytes together                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Modularity Assessment

### ✅ **Strengths (Good Modularity)**

1. **Clean Separation of Concerns**
   - Type definitions in [`rom.ts`](packages/core/src/definition/rom.ts)
   - Algorithm implementations in [`algorithms.ts`](packages/core/src/checksum/algorithms.ts)
   - Orchestration logic in [`manager.ts`](packages/core/src/checksum/manager.ts)
   - Provider-specific parsing in [`ecuflash/src/index.ts`](packages/providers/ecuflash/src/index.ts)

2. **Pure Functions**
   - All algorithm functions are pure (no side effects)
   - Easy to test in isolation
   - Easy to add new algorithms

3. **Flexible Region Support**
   - Supports multiple checksum regions
   - Regions can be non-contiguous
   - Easy to configure different ROM layouts

4. **Custom Function Support**
   - Already has `"custom"` algorithm type
   - Accepts custom functions via `customFunction` parameter
   - Can be used as workaround for mitsucan

5. **Endianness Handling**
   - Properly handles both little-endian and big-endian
   - Centralized in read/write functions

### ⚠️ **Weaknesses (Areas for Improvement)**

1. **Limited Algorithm Types**
   - Only 4 algorithm types: `"crc32" | "sum" | "xor" | "custom"`
   - No way to add named algorithms without modifying core types
   - `"custom"` requires passing functions around (not serializable)

2. **Provider Hardcodes Algorithm Mapping**
   - ECUFlash provider maps "mitsucan" → "crc32" (incorrect)
   - No way to register new algorithms dynamically
   - Each provider must know about all algorithms

3. **No Algorithm Registry**
   - Algorithms are hardcoded in switch statement
   - Can't register new algorithms at runtime
   - Can't extend without modifying core code

4. **Type Safety Issues with Custom**
   - `customFunction` is optional but required for `"custom"`
   - TypeScript can't enforce this relationship
   - Runtime error if custom function is missing

## Recommended Architecture Improvements

### Option 1: Add "mitsucan" as Named Algorithm (Simple)

**Pros:**
- Minimal changes
- Type-safe
- Clear intent

**Cons:**
- Still requires modifying core types for each new algorithm
- Not truly extensible

**Changes needed:**
```typescript
// packages/core/src/definition/rom.ts
export type ChecksumAlgorithm = "crc32" | "sum" | "xor" | "mitsucan" | "custom";

// packages/core/src/checksum/algorithms.ts
export function mitsucan(data: Uint8Array): number {
  // Implement Mitsubishi CAN checksum
  // ...
}

// packages/core/src/checksum/manager.ts
function computeChecksum(data, algorithm, customFunction?) {
  switch (algorithm) {
    case "crc32": return crc32(data);
    case "sum": return sumChecksum(data);
    case "xor": return xorChecksum(data);
    case "mitsucan": return mitsucan(data);  // Add this
    case "custom": return customFunction(data);
  }
}
```

### Option 2: Algorithm Registry Pattern (Extensible)

**Pros:**
- Fully extensible
- Providers can register their own algorithms
- No core modifications needed for new algorithms
- Still type-safe with proper design

**Cons:**
- More complex
- Requires refactoring
- Need to handle serialization

**Architecture:**
```typescript
// packages/core/src/checksum/registry.ts
type ChecksumFunction = (data: Uint8Array) => number;

class ChecksumRegistry {
  private algorithms = new Map<string, ChecksumFunction>();
  
  register(name: string, fn: ChecksumFunction): void {
    this.algorithms.set(name, fn);
  }
  
  get(name: string): ChecksumFunction | undefined {
    return this.algorithms.get(name);
  }
  
  has(name: string): boolean {
    return this.algorithms.has(name);
  }
}

// Global registry
export const checksumRegistry = new ChecksumRegistry();

// Register built-in algorithms
checksumRegistry.register("crc32", crc32);
checksumRegistry.register("sum", sumChecksum);
checksumRegistry.register("xor", xorChecksum);

// Providers can register their own
// packages/providers/ecuflash/src/algorithms/mitsucan.ts
import { checksumRegistry } from "@repo/core";

export function mitsucan(data: Uint8Array): number {
  // Implementation
}

checksumRegistry.register("mitsucan", mitsucan);
```

### Option 3: Hybrid Approach (Recommended)

Combine both approaches:
- Keep named algorithms for common/built-in ones
- Add registry for provider-specific algorithms
- Use `"custom"` for one-off implementations

**Type definition:**
```typescript
// Core algorithms (built-in)
export type CoreChecksumAlgorithm = "crc32" | "sum" | "xor";

// Extended type that includes registered algorithms
export type ChecksumAlgorithm = CoreChecksumAlgorithm | string;

export interface ChecksumDefinition {
  algorithm: ChecksumAlgorithm;
  regions: ChecksumRegion[];
  storage: ChecksumStorage;
  // Optional custom function for one-off implementations
  customFunction?: (data: Uint8Array) => number;
}
```

**Manager implementation:**
```typescript
function computeChecksum(
  data: Uint8Array,
  algorithm: ChecksumAlgorithm,
  customFunction?: (data: Uint8Array) => number,
): number {
  // Try custom function first
  if (customFunction) {
    return customFunction(data);
  }
  
  // Try built-in algorithms
  switch (algorithm) {
    case "crc32": return crc32(data);
    case "sum": return sumChecksum(data);
    case "xor": return xorChecksum(data);
  }
  
  // Try registry
  const registeredFn = checksumRegistry.get(algorithm);
  if (registeredFn) {
    return registeredFn(data);
  }
  
  throw new Error(`Unknown checksum algorithm: ${algorithm}`);
}
```

## Summary

### Current State: ⭐⭐⭐⭐ (4/5 stars)

The architecture is **quite modular** with good separation of concerns. Adding a new algorithm is straightforward:

**To add mitsucan today:**
1. Add `"mitsucan"` to `ChecksumAlgorithm` type (1 line)
2. Implement `mitsucan()` function in `algorithms.ts` (~20 lines)
3. Add case to switch statement in `manager.ts` (1 line)
4. Update ECUFlash provider mapping (1 line)

**Total: ~4 file changes, ~25 lines of code**

### Recommended Improvements: ⭐⭐⭐⭐⭐ (5/5 stars)

With the **Hybrid Approach**, the architecture would be:
- ✅ Fully extensible (providers can add algorithms)
- ✅ Type-safe (TypeScript knows about core algorithms)
- ✅ Backward compatible (existing code still works)
- ✅ No core modifications needed for provider-specific algorithms
- ✅ Serializable (algorithm names are strings)

The current architecture is already good enough to add mitsucan easily. The registry pattern would be a nice-to-have for future extensibility but isn't strictly necessary.
