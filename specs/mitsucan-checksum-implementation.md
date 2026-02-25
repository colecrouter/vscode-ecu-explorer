# Mitsucan Checksum Implementation Spec

**Status**: ✅ Implemented and Verified  
**Confirmed**: 2026-02-20 via direct analysis of four real Mitsubishi Evo X ROM files  
**Reference**: [`MITSUCAN_ALGORITHM_FINDINGS.md`](../MITSUCAN_ALGORITHM_FINDINGS.md)

---

## Overview

This spec covers the implementation of the mitsucan checksum algorithm for Mitsubishi Evo X ROMs. The algorithm was confirmed by direct analysis of four real ROM files.

The checksum is a **sum of 32-bit big-endian words** over the entire 1MB ROM (`0x000000–0x0FFFFF`). A 4-byte fixup value is stored **big-endian** at `0x0BFFF0` such that the total 32-bit word sum of the entire ROM (including the fixup) equals `0x5AA55AA5`.

**Scope of this spec**:
- Exact algorithm and constants
- Validation logic
- Integration with the existing [`ChecksumDefinition`](../packages/core/src/definition/rom.ts:50) infrastructure
- Test vectors derived from real ROM analysis
- Acceptance criteria for the implementation

---

## Algorithm

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `ROM_SIZE` | `0x100000` | Full 1MB ROM — entire ROM is checksummed |
| `FIXUP_OFFSET` | `0x0BFFF0` | Offset of the 4-byte fixup value in the ROM |
| `FIXUP_SIZE` | `4` | Fixup is a 32-bit (4-byte) value |
| `FIXUP_ENDIANNESS` | `"be"` | Fixup is stored big-endian |
| `TARGET` | `0x5AA55AA5` | Required value of the total 32-bit word sum |

### Compute fixup value

Given a ROM buffer, compute the 32-bit value that must be written big-endian to `0x0BFFF0`:

```typescript
function mitsucanChecksum(data: Uint8Array): number {
    const FIXUP_OFFSET = 0x0bfff0;
    const TARGET = 0x5aa55aa5;

    if (data.length < FIXUP_OFFSET + 4) {
        throw new Error(
            `ROM too small for mitsucan checksum: expected at least ${FIXUP_OFFSET + 4} bytes, got ${data.length}`
        );
    }
    if (data.length % 4 !== 0) {
        throw new Error(
            `ROM size must be 32-bit aligned for mitsucan checksum: got ${data.length} bytes`
        );
    }

    // Sum all 32-bit big-endian words, treating the fixup location as 0x00000000
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (i === FIXUP_OFFSET) continue; // skip fixup location (treat as zero)
        const word = (((data[i] ?? 0) << 24) | ((data[i+1] ?? 0) << 16) |
                      ((data[i+2] ?? 0) << 8)  |  (data[i+3] ?? 0)) >>> 0;
        sum = (sum + word) >>> 0;
    }

    // Compute the fixup value needed to reach the target
    return (TARGET - sum) >>> 0;
}
```

### Validate checksum

A ROM's checksum is valid if and only if the sum of all 32-bit big-endian words (including the fixup at `0x0BFFF0`) equals `0x5AA55AA5`:

```typescript
function validateMitsucanChecksum(data: Uint8Array): boolean {
    const FIXUP_OFFSET = 0x0bfff0;
    const TARGET = 0x5aa55aa5;

    if (data.length < FIXUP_OFFSET + 4 || data.length % 4 !== 0) return false;

    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
        const word = (((data[i] ?? 0) << 24) | ((data[i+1] ?? 0) << 16) |
                      ((data[i+2] ?? 0) << 8)  |  (data[i+3] ?? 0)) >>> 0;
        sum = (sum + word) >>> 0;
    }
    return sum === TARGET;
}
```

### Why `TARGET = 0x5AA55AA5`

The target `0x5AA55AA5` is a constant embedded in EcuFlash's mitsucan checksum implementation. It was confirmed empirically across four real Mitsubishi Evo X ROM files — all have a total 32-bit word sum of exactly `0x5AA55AA5`.

---

## Integration with Existing Infrastructure

The mitsucan checksum uses the `"custom"` algorithm hook in [`ChecksumDefinition`](../packages/core/src/definition/rom.ts:50):

```typescript
const mitsucanChecksumDef: ChecksumDefinition = {
    algorithm: "custom",
    regions: [{ start: 0x0, end: 0x100000 }],  // entire 1MB ROM
    storage: {
        offset: 0x0bfff0,   // fixup stored at 0x0BFFF0
        size: 4,             // 4-byte (32-bit) fixup
        endianness: "be",    // big-endian
    },
    customFunction: mitsucanChecksum,
};
```

### How the custom function integrates with `recomputeChecksum()`

[`recomputeChecksum()`](../packages/core/src/checksum/manager.ts:38) zeroes the storage location before calling the custom function. This means `mitsucanChecksum()` receives the ROM with the fixup location zeroed — which is exactly what the algorithm requires (the fixup location is treated as `0x00000000` when computing the sum).

The custom function returns the 32-bit fixup value. [`writeChecksum()`](../packages/core/src/checksum/manager.ts:95) then writes it big-endian at `0x0BFFF0`.

[`validateChecksum()`](../packages/core/src/checksum/manager.ts:170) reads the stored fixup, recomputes it (with fixup zeroed), and compares. This is mathematically equivalent to checking that the total word32 sum equals `0x5AA55AA5`.

---

## Test Vectors

These test vectors are derived from direct analysis of real Mitsubishi Evo X ROM files.

### Vector 1 — ROM 56890009 (stock)

| Property | Value |
|----------|-------|
| File | `56890009_2011_USDM_5MT.hex` (raw binary, 1MB) |
| Word32 sum with fixup zeroed | `0x5AA55AA6` |
| Expected fixup (BE at `0x0BFFF0`) | `(0x5AA55AA5 - 0x5AA55AA6) & 0xFFFFFFFF = 0xFFFFFFFF` |
| Actual fixup at `0x0BFFF0` | `0xFFFFFFFF` |
| Total word32 sum (with fixup) | `0x5AA55AA5` |
| Checksum valid? | ✅ Yes |

### Vector 2 — ROM 56890313 (test2.bin)

| Property | Value |
|----------|-------|
| File | `test2.bin` (raw binary, 1MB) |
| Word32 sum with fixup zeroed | `0xAE4CF381` |
| Expected fixup (BE at `0x0BFFF0`) | `(0x5AA55AA5 - 0xAE4CF381) & 0xFFFFFFFF = 0xAC086724` |
| Actual fixup at `0x0BFFF0` | `0xAC086724` |
| Total word32 sum (with fixup) | `0x5AA55AA5` |
| Checksum valid? | ✅ Yes |

### Vector 3 — test3.bin

| Property | Value |
|----------|-------|
| File | `test3.bin` (raw binary, 1MB) |
| Actual fixup at `0x0BFFF0` | `0x187E1B42` |
| Total word32 sum (with fixup) | `0x5AA55AA5` |
| Checksum valid? | ✅ Yes |

### Vector 4 — test4.bin

| Property | Value |
|----------|-------|
| File | `test4.bin` (raw binary, 1MB) |
| Actual fixup at `0x0BFFF0` | `0xFFFFFFFF` |
| Total word32 sum (with fixup) | `0x5AA55AA5` |
| Checksum valid? | ✅ Yes |
