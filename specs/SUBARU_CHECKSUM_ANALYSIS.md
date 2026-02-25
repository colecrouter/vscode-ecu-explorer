# Subaru Checksum Algorithm Analysis

## Overview

This document provides a detailed analysis of the two Subaru-related checksum algorithms
ported from [RomRaider](https://github.com/RomRaider/RomRaider) into this project:

1. **Subaru/Denso ROM Checksum** — validates and updates the integrity table embedded in
   Subaru ECU ROM images (used when flashing/editing ROMs).
2. **SSM Protocol Checksum** — validates individual Subaru Select Monitor (SSM) diagnostic
   packets sent over the K-line (ISO 9141).

Both algorithms are implemented in
[`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)
and tested in
[`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts).

---

## Part 1: Subaru/Denso ROM Checksum

### Background

Subaru ECUs manufactured by Denso store a **checksum table** directly inside the ROM image.
This table contains one or more entries, each describing a region of the ROM and the expected
checksum for that region. When the ECU boots, it reads this table and verifies each region.
If any checksum fails, the ECU may refuse to run or enter a failsafe mode.

When a tuner modifies a ROM (e.g., changes fuel maps or boost targets), the checksum table
must be recomputed to reflect the new data. RomRaider exposes this as a special table called
**"Checksum Fix"** in the ROM definition XML.

### Original Source

- **File**: [`RomChecksum.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java)
- **Constant**: [`Settings.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/Settings.java) — `CHECK_TOTAL = 0x5AA5A55A`
- **Usage**: [`TableSwitch.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/TableSwitch.java) — validates on ROM load
- **Usage**: [`Rom.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/Rom.java) — updates on ROM save

### The Magic Constant: `CHECK_TOTAL = 0x5AA5A55A`

The Subaru/Denso checksum algorithm uses a fixed target constant:

```
CHECK_TOTAL = 0x5AA5A55A
```

This is defined in RomRaider's `Settings.java`:

```java
public static final int CHECK_TOTAL = 0x5AA5A55A;
```

> **Note**: This is distinct from the Mitsubishi target (`0x5AA55AA5`). The two constants
> differ only in the middle two bytes — they are byte-swapped relative to each other:
>
> | ECU Family    | Target Constant | Hex Bytes          |
> |---------------|-----------------|--------------------|
> | Subaru/Denso  | `0x5AA5A55A`    | `5A A5 A5 5A`      |
> | Mitsubishi    | `0x5AA55AA5`    | `5A A5 5A A5`      |

### Checksum Table Layout

The checksum table is a contiguous array of **12-byte entries** stored at a fixed offset
in the ROM. Each entry has the following structure:

```
Offset  Size  Field       Description
------  ----  ----------  ------------------------------------------
+0      4     startAddr   Start of the ROM region (big-endian u32, inclusive)
+4      4     endAddr     End of the ROM region (big-endian u32, exclusive)
+8      4     checksum    Stored checksum value (big-endian u32)
```

The table offset and size are specified in the ROM definition XML (via the `storageAddress`
and `dataSize` attributes of the "Checksum Fix" table entry).

#### Sentinel Entry (Disabled Checksums)

A special **sentinel entry** signals that all checksums have been disabled:

```
startAddr = 0x00000000
endAddr   = 0x00000000
checksum  = CHECK_TOTAL (0x5AA5A55A)
```

When the first entry is a sentinel, RomRaider returns `-1` from `validateRomChecksum()`,
indicating "all checksums disabled". This is used by tuners who want to bypass checksum
validation entirely.

### Algorithm: Computing a Single Region Checksum

For a given region `[startAddr, endAddr)`:

1. **Sum all 32-bit big-endian words** in the region:
   ```
   byteSum = Σ word32_BE(data[i..i+4])  for i = startAddr, startAddr+4, ..., endAddr-4
   ```

2. **Compute the checksum** as the value that, when added to `byteSum`, equals `CHECK_TOTAL`:
   ```
   checksum = (CHECK_TOTAL - byteSum) mod 2^32
   ```

3. **Validation** checks that `CHECK_TOTAL - storedChecksum - byteSum == 0`:
   ```
   result = CHECK_TOTAL - storedChecksum - byteSum
   valid  = (result == 0)
   ```

#### Java Source (Original)

```java
// calculateChecksum — computes the checksum for a region
private static byte[] calculateChecksum(byte[] input, int startAddr, int endAddr) {
    int byteSum = 0;
    for (int i = startAddr; i < endAddr; i += 4) {
        byteSum += (int) parseByteValue(input, BIG, i, 4, true);
    }
    return parseIntegerValue((Settings.CHECK_TOTAL - byteSum), Settings.Endian.BIG, 4);
}

// validateChecksum — validates a stored checksum for a region
private static int validateChecksum(byte[] input, int startAddr, int endAddr, int diff) {
    int byteSum = 0;
    for (int i = startAddr; i < endAddr; i += 4) {
        byteSum += (int) parseByteValue(input, BIG, i, 4, true);
    }
    int result = (Settings.CHECK_TOTAL - diff - byteSum);
    return result;  // 0 means valid
}
```

#### TypeScript Port

```typescript
// computeSubaruDensoChecksum — packages/core/src/checksum/algorithms.ts
export function computeSubaruDensoChecksum(
    data: Uint8Array,
    startAddr: number,
    endAddr: number,
): number {
    let byteSum = 0;
    for (let i = startAddr; i < endAddr; i += 4) {
        const word = (((data[i] ?? 0) << 24) | ((data[i+1] ?? 0) << 16) |
                      ((data[i+2] ?? 0) << 8)  | (data[i+3] ?? 0)) >>> 0;
        byteSum = (byteSum + word) >>> 0;
    }
    return (SUBARU_DENSO_CHECK_TOTAL - byteSum) >>> 0;
}
```

### Algorithm: Updating the Full Checksum Table

The `calculateRomChecksum()` function in RomRaider iterates over all 12-byte entries in
the checksum table and rewrites the checksum field of each entry:

```java
private static void calculateRomChecksum(byte[] input, int storageAddress, int dataSize, int offset) {
    storageAddress = storageAddress - offset;
    for (int i = storageAddress; i < storageAddress + dataSize; i += 12) {
        int startAddr = (int) parseByteValue(input, BIG, i,   4, true);
        int endAddr   = (int) parseByteValue(input, BIG, i+4, 4, true);
        int off = offset;
        // 0 means checksum is disabled, keep it
        if (startAddr == 0 && endAddr == 0) {
            off = 0;
        }
        byte[] newSum = calculateChecksum(input, startAddr - off, endAddr - off);
        System.arraycopy(newSum, 0, input, i + 8, 4);
    }
}
```

> **Note on `offset`**: In RomRaider, `offset` is the RAM offset — the difference between
> the ROM's physical storage address and its runtime address in the ECU's memory map. Our
> TypeScript port does not apply this offset because we work directly with ROM file offsets.
> The addresses stored in the checksum table are already ROM-relative in the files we process.

### Algorithm: Validating the Full Checksum Table

The `validateRomChecksum()` function returns:
- `0`  — all checksums are valid
- `-1` — all checksums are disabled (first entry is the sentinel)
- `N`  — the 1-based index of the first invalid checksum entry

```java
private static int validateRomChecksum(byte[] input, int storageAddress, int dataSize, int offset) {
    storageAddress = storageAddress - offset;
    int result = 0;
    int[] results = new int[dataSize / 12];
    int j = 0;
    for (int i = storageAddress; i < storageAddress + dataSize; i += 12) {
        int startAddr = (int) parseByteValue(input, BIG, i,   4, true);
        int endAddr   = (int) parseByteValue(input, BIG, i+4, 4, true);
        int diff      = (int) parseByteValue(input, BIG, i+8, 4, true);
        // ...
        if (j == 0 && startAddr == 0 && endAddr == 0 && diff == Settings.CHECK_TOTAL) {
            return result = -1;  // all checksums disabled
        } else {
            results[j] = validateChecksum(input, startAddr, endAddr, diff);
        }
        j++;
    }
    for (j = 0; j < (dataSize / 12); j++) {
        if (results[j] != 0) {
            return j + 1;  // 1-based position of first invalid checksum
        }
    }
    return result;  // 0, all valid
}
```

### Mathematical Explanation

The algorithm is a **32-bit modular sum with a target constant**. The invariant is:

```
Σ word32_BE(region) + checksum ≡ CHECK_TOTAL  (mod 2^32)
```

This means:
- `checksum = (CHECK_TOTAL - Σ region) mod 2^32`
- Validation: `(CHECK_TOTAL - checksum - Σ region) mod 2^32 == 0`

The choice of `0x5AA5A55A` as the target is arbitrary — it is a "magic number" chosen by
Denso engineers. The alternating `5A`/`A5` byte pattern (`0101 1010` / `1010 0101`) is a
common choice for magic constants because it has good bit distribution and is easy to
recognize in a hex dump.

### Differences Between Java and TypeScript Ports

| Aspect | Java (RomRaider) | TypeScript (Our Port) |
|--------|------------------|-----------------------|
| Integer arithmetic | Java `int` is signed 32-bit; overflow wraps silently | Uses `>>> 0` to force unsigned 32-bit wrapping |
| RAM offset | Subtracts `offset` from addresses | Not applied (ROM-relative addresses assumed) |
| Return type | `byte[]` (4 bytes, big-endian) | `number` (unsigned 32-bit integer) |
| Error handling | `ArrayIndexOutOfBoundsException` | Explicit bounds checks with descriptive errors |
| Sentinel detection | Checks `startAddr == 0 && endAddr == 0` | Same logic |

### Which ECUs Use This Algorithm

The Subaru/Denso ROM checksum is used by **all Subaru ECUs supported by RomRaider** that
have a "Checksum Fix" table in their ROM definition. This includes:

- **Subaru Impreza WRX/STI** (EJ20/EJ25 engines, various model years)
- **Subaru Forester XT** (EJ20/EJ25 engines)
- **Subaru Legacy GT/Outback XT** (EJ20/EJ25 engines)
- **Subaru BRZ / Toyota 86** (FA20 engine, some variants)

The ECU hardware is manufactured by **Denso** (a major Japanese automotive supplier).
The same checksum algorithm is used across all Denso-manufactured Subaru ECUs regardless
of the specific ROM size or layout.

In RomRaider's XML definitions, the checksum table is identified by a table named
`"Checksum Fix"` (or `"checksum fix"` — case-insensitive). The table's `storageAddress`
and `dataSize` attributes specify where the 12-byte entries are located in the ROM.

---

## Part 2: SSM Protocol Checksum

### Background

The **Subaru Select Monitor (SSM)** protocol is Subaru's proprietary OBD diagnostic
protocol, used for ECU communication over the K-line (ISO 9141). It predates the
standardized OBD-II/CAN protocols and is used for:

- Reading live sensor data (RPM, boost, AFR, etc.)
- Reading/writing ECU memory addresses
- ECU initialization and identification

Each SSM packet ends with a **1-byte checksum** that allows the receiver to detect
transmission errors.

### Original Source

- **File**: [`SSMChecksumCalculator.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java)
- **Usage**: [`SSMProtocol.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMProtocol.java) — appended to every outgoing packet
- **Usage**: [`SSMResponseProcessor.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMResponseProcessor.java) — validated on every incoming packet

### SSM Packet Structure

A typical SSM packet has the following structure:

```
Byte  Field           Description
----  --------------  ------------------------------------------
0     Header          0x80 (fixed)
1     Destination     0x10 = ECU, 0xF0 = diagnostic tool
2     Source          0xF0 = diagnostic tool, 0x10 = ECU
3     Data Length     Number of data bytes that follow
4..N  Data            Command/response payload
N+1   Checksum        Sum of all preceding bytes, truncated to 8 bits
```

### Algorithm

The SSM checksum is a **simple unsigned byte sum**, truncated to 8 bits:

1. Sum all bytes in the packet **except the last byte** (the checksum placeholder):
   ```
   total = Σ packet[i]  for i = 0, 1, ..., length-2
   ```

2. Truncate to 8 bits:
   ```
   checksum = total & 0xFF
   ```

#### Java Source (Original)

```java
public static byte calculateChecksum(byte[] bytes) {
    int total = 0;
    for (int i = 0; i < (bytes.length - 1); i++) {
        byte b = bytes[i];
        total += asInt(b);  // unsigned byte addition
    }
    return asByte(total - ((total >>> 16) << 16));
    // total - ((total >>> 16) << 16) = total & 0xFFFF
    // asByte(x) = (byte)(x & 0xFF)
    // net result: total & 0xFF
}
```

The Java expression `total - ((total >>> 16) << 16)` is equivalent to `total & 0xFFFF`
(it clears the upper 16 bits). Then `asByte()` truncates to 8 bits. The net result is
simply `total & 0xFF`.

#### TypeScript Port

```typescript
// ssmChecksum — packages/core/src/checksum/algorithms.ts
export function ssmChecksum(packet: Uint8Array): number {
    if (packet.length === 0) {
        throw new Error("SSM packet must not be empty");
    }
    let total = 0;
    for (let i = 0; i < packet.length - 1; i++) {
        total += packet[i] ?? 0;
    }
    return total & 0xff;
}
```

### Example: SSM Init Request

The SSM ECU initialization request packet is:

```
[0x80, 0x10, 0xF0, 0x01, 0xBF, 0x00]
  │     │     │     │     │     └── checksum placeholder
  │     │     │     │     └──────── command: 0xBF = ECU init
  │     │     │     └────────────── data length: 1 byte
  │     │     └──────────────────── source: 0xF0 = diagnostic tool
  │     └────────────────────────── destination: 0x10 = ECU
  └──────────────────────────────── header: 0x80
```

Checksum calculation:
```
total = 0x80 + 0x10 + 0xF0 + 0x01 + 0xBF
      = 128  + 16   + 240  + 1    + 191
      = 576
      = 0x240
checksum = 0x240 & 0xFF = 0x40
```

Final packet: `[0x80, 0x10, 0xF0, 0x01, 0xBF, 0x40]`

### Mathematical Explanation

The SSM checksum is a **modular sum** — the simplest possible checksum. It detects:
- Single-byte errors (any single byte changed will change the sum)
- Most multi-byte errors (unless the changes cancel out)

It does **not** detect:
- Byte transpositions (swapping two bytes gives the same sum)
- Errors that sum to a multiple of 256

The 16-bit intermediate accumulation in the Java code (`total` is an `int`) prevents
overflow during summation of long packets, but the final result is always truncated to
8 bits.

### Differences Between Java and TypeScript Ports

| Aspect | Java (RomRaider) | TypeScript (Our Port) |
|--------|------------------|-----------------------|
| Byte sign | `asInt(b)` converts signed byte to unsigned int | `packet[i] ?? 0` is already unsigned (Uint8Array) |
| Intermediate type | `int` (32-bit signed) | `number` (64-bit float, no overflow risk) |
| Truncation | `total - ((total >>> 16) << 16)` then `asByte()` | `total & 0xFF` (equivalent, simpler) |
| Error handling | No validation | Throws on empty packet |

### Which ECUs Use This Protocol

The SSM protocol is used by **all Subaru ECUs** that communicate over the K-line (ISO 9141).
This includes virtually all Subaru vehicles from the mid-1990s through the mid-2000s, and
some later models that retained K-line support alongside CAN:

- **Subaru Impreza WRX/STI** (1993–2014, K-line models)
- **Subaru Forester** (1997–2013, K-line models)
- **Subaru Legacy/Outback** (1994–2012, K-line models)
- **Subaru BRZ** (2012+, some variants)

The SSM protocol is also used by some **Mazda** vehicles (which share Denso ECU hardware
with Subaru in some cases).

---

## Architecture: How These Algorithms Fit Together

```
┌─────────────────────────────────────────────────────────────────┐
│                     ROM Definition (XML)                         │
│  <table name="Checksum Fix" storageAddress="0x7FFF0"            │
│          dataSize="48" .../>                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              ECUFlash/RomRaider Provider (Parser)                │
│  Reads storageAddress and dataSize from XML                      │
│  Passes to checksum update/validate functions                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│           Algorithm Implementations (Pure Functions)             │
│  packages/core/src/checksum/algorithms.ts                        │
│                                                                  │
│  SUBARU_DENSO_CHECK_TOTAL = 0x5AA5A55A                          │
│                                                                  │
│  readSubaruDensoChecksumTable(data, tableOffset, tableSize)     │
│    └─ Parses 12-byte entries from ROM                           │
│                                                                  │
│  computeSubaruDensoChecksum(data, startAddr, endAddr)           │
│    └─ (CHECK_TOTAL - Σ words) mod 2^32                          │
│                                                                  │
│  validateSubaruDensoChecksum(data, start, end, stored)          │
│    └─ (CHECK_TOTAL - stored - Σ words) == 0                     │
│                                                                  │
│  updateSubaruDensoChecksums(data, tableOffset, tableSize)       │
│    └─ Rewrites checksum field of each table entry in-place      │
│                                                                  │
│  validateSubaruDensoChecksums(data, tableOffset, tableSize)     │
│    └─ Returns 0 (valid), -1 (disabled), or N (first invalid)    │
│                                                                  │
│  ssmChecksum(packet)                                             │
│    └─ Σ bytes[0..N-2] & 0xFF                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Test Coverage

Tests are in
[`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts).

### Subaru/Denso ROM Checksum Tests

| Test Suite | Test Cases |
|------------|------------|
| `SUBARU_DENSO_CHECK_TOTAL` | Constant value is `0x5AA5A55A` |
| `computeSubaruDensoChecksum` | All-zero region, single word, two words, round-trip, unsigned 32-bit, alignment errors, bounds errors, 32-bit overflow |
| `validateSubaruDensoChecksum` | Correct checksum, incorrect checksum, zero checksum on non-zero data, non-aligned addresses, out-of-bounds, round-trip |
| `readSubaruDensoChecksumTable` | Single entry, two entries, non-multiple-of-12 size, out-of-bounds |
| `updateSubaruDensoChecksums` | Single entry update, sentinel skip, round-trip update+validate, non-multiple-of-12 size |
| `validateSubaruDensoChecksums` | All valid (returns 0), first invalid (returns 1), all disabled (returns -1), second invalid (returns 2), error cases |

### SSM Protocol Checksum Tests

| Test Suite | Test Cases |
|------------|------------|
| `ssmChecksum` | Known SSM init packet (`0x40`), single-byte packet, two-byte packet, 8-bit wrap, 16-bit overflow, range check, empty packet error, determinism, all-zero packet |

---

## Key Invariants

### Subaru/Denso ROM Checksum

1. **Alignment**: All addresses must be 4-byte aligned (the algorithm reads 32-bit words).
2. **Endianness**: All values (addresses and checksums) are stored **big-endian** in the ROM.
3. **Modular arithmetic**: All sums are computed modulo 2^32 (unsigned 32-bit wrapping).
4. **Invariant**: After `updateSubaruDensoChecksums()`, `validateSubaruDensoChecksums()` must return `0`.
5. **Sentinel**: An entry with `startAddr == 0 && endAddr == 0` is skipped during update and signals "disabled" during validation.

### SSM Protocol Checksum

1. **Packet structure**: The checksum is always the **last byte** of the packet.
2. **Scope**: The checksum covers all bytes **except** the last (checksum) byte.
3. **Width**: The checksum is always **8 bits** (1 byte).
4. **Unsigned**: Bytes are treated as unsigned (0–255) during summation.

---

## References

- **RomRaider source** (primary reference):
  - [`RomChecksum.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/RomChecksum.java)
  - [`Settings.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/Settings.java) (defines `CHECK_TOTAL`)
  - [`SSMChecksumCalculator.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ssm/iso9141/SSMChecksumCalculator.java)
  - [`TableSwitch.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/TableSwitch.java) (validates on ROM load)
  - [`Rom.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/Rom.java) (updates on ROM save)
- **Our implementation**:
  - [`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)
  - [`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts)
- **Related documentation**:
  - [`CHECKSUM_ARCHITECTURE_ANALYSIS.md`](CHECKSUM_ARCHITECTURE_ANALYSIS.md) — overall checksum architecture
  - [`ARCHITECTURE.md`](ARCHITECTURE.md) — project architecture overview
