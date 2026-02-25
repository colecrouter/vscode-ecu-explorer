# Nissan Checksum Algorithm Analysis

## Overview

This document provides a detailed analysis of the four Nissan-related checksum algorithms
ported from [RomRaider](https://github.com/RomRaider/RomRaider) into this project:

1. **Nissan STD/ALT ROM Checksum** — validates and updates the 32-bit sum and XOR checksums
   embedded in Nissan ECU ROM images (used when flashing/editing ROMs).
2. **Nissan ALT2 ROM Checksum** — extended variant with four checksum values: 32-bit sum,
   32-bit XOR, 16-bit calibration checksum, and 16-bit code checksum.
3. **NCS K-line Packet Checksum** — validates individual NCS (Nissan Communication System)
   diagnostic packets sent over the K-line (ISO 14230 / KWP2000).
4. **NCS CRC-16** — CRC-16/IBM-SDLC without final XOR, used for data integrity in the NCS
   communication protocol.

All algorithms are implemented in
[`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)
and tested in
[`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts).

---

## Part 1: Nissan STD/ALT ROM Checksum

### Background

Nissan ECUs store two checksum values directly inside the ROM image: a 32-bit arithmetic
sum (`sumt`) and a 32-bit XOR (`xort`). These are computed over a defined region of the ROM
and stored at fixed addresses (`sumloc` and `xorloc`). When the ECU boots, it recomputes
these values and verifies them against the stored values.

The `std` and `alt` checksum types in RomRaider use the **identical algorithm** — the only
difference is the address layout specified in the ROM definition XML. Both are implemented
by a single TypeScript function.

### Original Source

- **Algorithm**: [`CalculateSTD.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateSTD.java)
- **Base class**: [`NissanChecksum.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java)
- **STD wrapper**: [`ChecksumSTD.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumSTD.java)
- **ALT wrapper**: [`ChecksumALT.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT.java)

### Parameters

The algorithm is configured via the ROM definition XML:

| Parameter | Description |
|-----------|-------------|
| `start`   | Start address of the ROM region (inclusive, 4-byte aligned) |
| `end`     | End address of the ROM region (exclusive, 4-byte aligned) |
| `sumloc`  | Address where the 32-bit sum is stored (must be within `[start, end)`) |
| `xorloc`  | Address where the 32-bit XOR is stored (must be within `[start, end)`) |

### ROM Layout

```
ROM region [start, end):
┌──────────────────────────────────────────────────────────────────┐
│  DWORD  DWORD  DWORD  ...  [sumt]  [xort]  ...  DWORD  DWORD   │
│  start  +4     +8          sumloc  xorloc        end-8  end-4   │
└──────────────────────────────────────────────────────────────────┘
                              ↑       ↑
                         skipped  skipped during computation
```

### Algorithm

For a given region `[start, end)`:

1. **Iterate in 4-byte (DWORD) steps** from `start` to `end-4`:
   - Skip the DWORD at `sumloc` (it holds the stored sum)
   - Skip the DWORD at `xorloc` (it holds the stored XOR)
   - Read each DWORD as a **big-endian 32-bit integer**

2. **Compute two values**:
   ```
   sumt = Σ dword32_BE(data[i..i+4])  for i = start, start+4, ..., end-4
          (excluding sumloc and xorloc)
   xort = ⊕ dword32_BE(data[i..i+4])  for i = start, start+4, ..., end-4
          (excluding sumloc and xorloc)
   ```

3. **Store** both values big-endian at their respective locations.

#### Java Source (Original)

```java
// CalculateSTD.java
public final void calculate(
        Map<String, Integer> range,
        byte[] binData,
        Map<String, Integer> results) {
    int sumt = 0;
    int xort = 0;
    int dw = 0;
    for (int i = range.get(START); i < range.get(END); i += 4) {
        if ((i == range.get(SUMLOC)) || (i == range.get(XORLOC))) continue;
        dw = (int) parseByteValue(binData, Settings.Endian.BIG, i, 4, true);
        sumt += dw;
        xort ^= dw;
    }
    results.put(SUMT, sumt);
    results.put(XORT, xort);
}
```

#### TypeScript Port

```typescript
// computeNissanStdChecksum — packages/core/src/checksum/algorithms.ts
export function computeNissanStdChecksum(
    data: Uint8Array,
    start: number,
    end: number,
    sumloc: number,
    xorloc: number,
): NissanStdChecksumResult {
    let sumt = 0;
    let xort = 0;
    for (let i = start; i < end; i += 4) {
        if (i === sumloc || i === xorloc) continue;
        const dw = (((data[i] ?? 0) << 24) | ((data[i+1] ?? 0) << 16) |
                    ((data[i+2] ?? 0) << 8)  | (data[i+3] ?? 0)) >>> 0;
        sumt = (sumt + dw) >>> 0;
        xort = (xort ^ dw) >>> 0;
    }
    return { sumt, xort };
}
```

### Worked Example

Given a 32-byte ROM region with:
- `start = 0x0000`, `end = 0x0020`
- `sumloc = 0x0010`, `xorloc = 0x0014`
- Data: `[0x12345678, 0x00000000, 0x00000000, 0x00000000, (sumloc), (xorloc), 0x00000000, 0x00000000]`

Computation:
```
DWORDs processed: 0x12345678, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
(sumloc and xorloc at 0x0010 and 0x0014 are skipped)

sumt = 0x12345678 + 0 + 0 + 0 + 0 + 0 = 0x12345678
xort = 0x12345678 ^ 0 ^ 0 ^ 0 ^ 0 ^ 0 = 0x12345678
```

### Validation

Validation reads the stored values from the ROM and compares them to the computed values.
Returns the number of valid checksums (0, 1, or 2):

```
valid = 0
if computed.sumt == stored_sumt: valid++
if computed.xort == stored_xort: valid++
return valid  // 2 = both valid, 1 = one valid, 0 = neither valid
```

### Mathematical Properties

- **Sum**: 32-bit unsigned modular arithmetic (mod 2^32). Detects most single-byte errors.
- **XOR**: 32-bit XOR. Detects any odd number of bit flips in each bit position.
- Together, they provide stronger error detection than either alone.

### Which ECUs Use This Algorithm

- Nissan ECUs with `<checksummodule>std</checksummodule>` in their ROM definition
- Nissan ECUs with `<checksummodule>alt</checksummodule>` in their ROM definition
- Includes various Nissan/Infiniti models (Skyline GT-R, 350Z, Frontier, Pathfinder, etc.)

---

## Part 2: Nissan ALT2 ROM Checksum

### Background

The ALT2 checksum is an extended variant used by some Nissan ECUs that require four
checksum values instead of two. It splits the ROM into two regions (calibration and code)
and computes separate checksums for each.

### Original Source

- **Algorithm**: [`CalculateALT2.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateALT2.java)
- **Wrapper**: [`ChecksumALT2.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java)

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `start`   | Start address of the ROM region (inclusive, 4-byte aligned) | — |
| `end`     | End address of the ROM region (exclusive, 4-byte aligned) | — |
| `sumloc`  | Address where the 32-bit sum is stored | — |
| `xorloc`  | Address where the 32-bit XOR is stored | — |
| `skiploc` | Boundary between calibration and code regions | `0x20000` |

### ROM Layout

```
ROM region [start, end):
┌─────────────────────────────────────────────────────────────────────────────┐
│ [calSum] │ start+2 │ ... │ [sumt] │ [xort] │ ... │ [codeSum] │ ... │ end  │
│  start   │         │     │ sumloc │ xorloc │     │  skiploc  │     │      │
└──────────┴─────────┴─────┴────────┴────────┴─────┴───────────┴─────┴──────┘
│←────────────── calibration region ──────────────→│←── code region ────────→│
```

### Four Checksum Values

| Value     | Storage Location | Size    | Description |
|-----------|-----------------|---------|-------------|
| `sumt`    | `sumloc`        | 4 bytes | 32-bit arithmetic sum of DWORDs from `start+4` to `end` |
| `xort`    | `xorloc`        | 4 bytes | 32-bit XOR of DWORDs from `start+4` to `end` |
| `calSum`  | `start`         | 2 bytes | 16-bit word sum from `start+2` to `skiploc` |
| `codeSum` | `skiploc`       | 2 bytes | 16-bit word sum from `skiploc+2` to `end` |

### Algorithm

**Step 1: 32-bit sum and XOR** (from `start+4` to `end`, skipping `sumloc`, `xorloc`, `skiploc`):

```
sumt = Σ dword32_BE(data[i..i+4])  for i = start+4, start+8, ..., end-4
       (excluding sumloc, xorloc, skiploc)
xort = ⊕ dword32_BE(data[i..i+4])  for i = start+4, start+8, ..., end-4
       (excluding sumloc, xorloc, skiploc)
```

Note: The DWORD at `start` is **not** included in the 32-bit checksums (iteration starts at `start+4`).

**Step 2: 16-bit calibration checksum** (from `start+2` to `skiploc`, in 16-bit steps):

```
calSum = 0
for i = start+2, start+4, ..., skiploc-2:
    if i == sumloc:
        calSum += (sumt >> 16) & 0xFFFF  // high half of sumt
        calSum += sumt & 0xFFFF           // low half of sumt
        i += 2  // advance past the 32-bit value
    elif i == xorloc:
        calSum += (xort >> 16) & 0xFFFF  // high half of xort
        calSum += xort & 0xFFFF           // low half of xort
        i += 2  // advance past the 32-bit value
    else:
        calSum += word16_BE(data[i..i+2])
calSum = calSum & 0xFFFF  // truncate to 16 bits
```

The key insight: when the 16-bit iteration reaches `sumloc` or `xorloc`, it includes the
**already-computed** 32-bit values inline (as two 16-bit halves each), rather than reading
from the ROM. This ensures the calibration checksum covers the correct data.

**Step 3: 16-bit code checksum** (from `skiploc+2` to `end`, in 16-bit steps):

```
codeSum = 0
for i = skiploc+2, skiploc+4, ..., end-2:
    codeSum += word16_BE(data[i..i+2])
codeSum = codeSum & 0xFFFF  // truncate to 16 bits
```

Note: The word at `skiploc` itself is **not** included in `codeSum` (iteration starts at `skiploc+2`).

#### Java Source (Original)

```java
// CalculateALT2.java
public final void calculate(
        Map<String, Integer> range,
        byte[] binData,
        Map<String, Integer> results) {

    // 32-bit checksum calculation
    int sumt = 0;
    int xort = 0;
    int dw = 0;
    for (int i = range.get(START) + 4; i < range.get(END); i += 4) {
        if ((i == range.get(SUMLOC))
                || (i == range.get(XORLOC)
                || (i == range.get(SKIPLOC)))) continue;
        dw = (int) parseByteValue(binData, Settings.Endian.BIG, i, 4, true);
        sumt += dw;
        xort ^= dw;
    }
    results.put(SUMT, sumt);
    results.put(XORT, xort);

    // 16-bit calibration checksum calculation
    short sum = 0;
    for (int i = range.get(START) + 2; i < range.get(SKIPLOC); i += 2) {
        if (i == range.get(SUMLOC)) {    // include 32-bit sumt
            dw = results.get(SUMT);
            sum += (short) ((dw >> 16) & 0xffff);
            sum += (short) (dw & 0xffff);
            i += 2; // advance 2 bytes as sumt is 32-bits
            continue;
        }
        if (i == range.get(XORLOC)) {    // include 32-bit xort
            dw = results.get(XORT);
            sum += (short) ((dw >> 16) & 0xffff);
            sum += (short) (dw & 0xffff);
            i += 2; // advance 2 bytes as xort is 32-bits
            continue;
        }
        sum += (short) parseByteValue(binData, Settings.Endian.BIG, i, 2, false);
    }
    results.put(START, (int) sum);

    // 16-bit code checksum calculation
    sum = 0;
    for (int i = range.get(SKIPLOC) + 2; i < range.get(END); i += 2) {
        sum += (short) parseByteValue(binData, Settings.Endian.BIG, i, 2, false);
    }
    results.put(SKIPLOC, (int) sum);
}
```

### Worked Example

Given a 64-byte ROM with:
- `start = 0x00`, `end = 0x40`, `sumloc = 0x18`, `xorloc = 0x1C`, `skiploc = 0x20`
- DWORD at `0x04 = 0x00010002` (all other data is zero)

**Step 1: 32-bit checksums**
```
Iterate from start+4=0x04 to end=0x40 in 4-byte steps, skip 0x18, 0x1C, 0x20:
  0x04: dw = 0x00010002 → sumt += 0x00010002, xort ^= 0x00010002
  0x08..0x14: dw = 0x00000000 → no change
  0x18: SKIP (sumloc)
  0x1C: SKIP (xorloc)
  0x20: SKIP (skiploc)
  0x24..0x3C: dw = 0x00000000 → no change

sumt = 0x00010002
xort = 0x00010002
```

**Step 2: 16-bit calibration checksum**
```
Iterate from start+2=0x02 to skiploc=0x20 in 2-byte steps:
  0x02: word = 0x0000 → calSum += 0
  0x04: word = 0x0001 (high half of DWORD at 0x04) → calSum += 1
  0x06: word = 0x0002 (low half of DWORD at 0x04) → calSum += 2
  0x08..0x16: word = 0x0000 → no change
  0x18: sumloc → include sumt (0x00010002) as two halves:
        calSum += 0x0001 (high half), calSum += 0x0002 (low half), i += 2
  0x1C: xorloc → include xort (0x00010002) as two halves:
        calSum += 0x0001 (high half), calSum += 0x0002 (low half), i += 2

calSum = 0 + 1 + 2 + 0 + 1 + 2 + 1 + 2 = 9 = 0x0009
```

**Step 3: 16-bit code checksum**
```
Iterate from skiploc+2=0x22 to end=0x40 in 2-byte steps:
  All words are 0x0000 → codeSum = 0
```

**Result**: `sumt=0x00010002`, `xort=0x00010002`, `calSum=0x0009`, `codeSum=0x0000`

### Differences Between Java and TypeScript Ports

| Aspect | Java (RomRaider) | TypeScript (Our Port) |
|--------|------------------|-----------------------|
| Integer arithmetic | Java `int` is signed 32-bit; overflow wraps silently | Uses `>>> 0` to force unsigned 32-bit wrapping |
| 16-bit arithmetic | Java `short` wraps at 16 bits | Uses `& 0xFFFF` to truncate to 16 bits |
| Default skiploc | Configured via XML, defaults to `0x20000` | Default parameter `skiploc = 0x20000` |
| Return type | Results stored in `Map<String, Integer>` | Returns `NissanAlt2ChecksumResult` object |
| Error handling | `ArrayIndexOutOfBoundsException` | Explicit bounds checks with descriptive errors |

### Which ECUs Use This Algorithm

- Nissan ECUs with `<checksummodule>alt2</checksummodule>` in their ROM definition
- Typically larger ROMs with a split calibration/code region boundary at `skiploc`
- The default `skiploc = 0x20000` (128KB boundary) suggests 256KB+ ROMs

---

## Part 3: NCS K-line Protocol Checksum

### Background

The **Nissan Communication System (NCS)** protocol is used for ECU communication over the
K-line (ISO 14230 / KWP2000). It is used by Nissan/Infiniti vehicles for diagnostic
communication, ECU flashing, and live data logging.

Each NCS packet ends with a **1-byte checksum** that allows the receiver to detect
transmission errors.

### Original Source

- **File**: [`NCSChecksumCalculator.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java)

### NCS Packet Structure

```
Byte  Field           Description
----  --------------  ------------------------------------------
0     Format          0x80 (long addressing)
1     Target address  ECU address
2     Source address  Diagnostic tool address
3     Data Length     Number of data bytes that follow
4..N  Data            Command/response payload
N+1   Checksum        Sum of all preceding bytes, truncated to 8 bits
```

### Algorithm

The NCS checksum is a **simple unsigned byte sum**, truncated to 8 bits:

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
// NCSChecksumCalculator.java
public static byte calculateChecksum(byte[] bytes) {
    int total = 0;
    for (int i = 0; i < (bytes.length - 1); i++) {
        byte b = bytes[i];
        total += asInt(b);  // unsigned byte addition
    }
    return asByte(total & 0xFF);
}
```

### Example: NCS Packet

```
Packet: [0x80, 0x10, 0xF1, 0x01, 0x3E, 0x00]
          │     │     │     │     │     └── checksum placeholder
          │     │     │     │     └──────── command byte
          │     │     │     └────────────── data length: 1 byte
          │     │     └──────────────────── source: diagnostic tool
          │     └────────────────────────── target: ECU
          └──────────────────────────────── format: 0x80

sum = 0x80 + 0x10 + 0xF1 + 0x01 + 0x3E
    = 128  + 16   + 241  + 1    + 62  = 448 = 0x1C0
checksum = 0x1C0 & 0xFF = 0xC0
```

### Relationship to SSM Checksum

The NCS checksum is **structurally identical** to the Subaru SSM checksum (`ssmChecksum`).
Both compute the unsigned byte sum of all bytes except the last, truncated to 8 bits.
The difference is the protocol context:
- **NCS**: Nissan ECUs over ISO 14230 (KWP2000)
- **SSM**: Subaru ECUs over ISO 9141

### Which ECUs Use This Protocol

- Nissan/Infiniti ECUs that communicate over the K-line (ISO 14230 / KWP2000)
- Includes various Nissan models from the late 1990s through the 2000s

---

## Part 4: NCS CRC-16

### Background

The NCS CRC-16 is used by Nissan ECUs for data integrity verification in the NCS
communication protocol. It is applied to encoded data buffers before transmission.

### Original Source

- **File**: [`NcsCoDec.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java)
- **Reference**: Based on [`nissutils/cli_utils/nislib.c`](https://github.com/fenugrec/nissutils/blob/master/cli_utils/)

### CRC Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Polynomial | `0x8408` | Bit-reversed form of `0x1021` |
| Initial value | `0xFFFF` | |
| Input reflection | true | Processes bits LSB first |
| Output reflection | true | |
| Final XOR | `0x0000` | No final XOR applied |
| Check value | `0x6F91` | CRC of `"123456789"` |

This is **CRC-16/IBM-SDLC without the final XOR**. The standard CRC-16/IBM-SDLC (with
`xorout=0xFFFF`) produces `0x906E` for `"123456789"`. Without the final XOR:
`0x906E ^ 0xFFFF = 0x6F91`.

### Algorithm

The algorithm processes each byte bit-by-bit, LSB first:

```
crc = 0xFFFF
for each byte b in data:
    for j = 0 to 7:
        r6 = crc & 1          // LSB of CRC
        crc = crc >>> 1       // shift CRC right
        if r6 != (b & 1):     // XOR condition
            crc = crc ^ 0x8408
        b = b >>> 1           // shift data byte right
return crc & 0xFFFF
```

#### Java Source (Original)

```java
// NcsCoDec.java
public final short calcCrc(byte[] data) {
    int r6;
    int r5;
    int crc = 0xffff;
    for (int i = 0; i < data.length; i++) {
        r5 = data[i];  // signed byte → int (sign-extended in Java)
        for (int j = 0; j < 8; j++) {
            r6 = crc & 1;
            crc = crc >>> 1;
            if (r6 != (r5 & 1)) {
                crc = crc ^ 0x8408;
            }
            r5 = r5 >> 1;  // arithmetic right shift in Java
        }
    }
    return (short) crc;
}
```

#### TypeScript Port

```typescript
// ncsCrc16 — packages/core/src/checksum/algorithms.ts
export function ncsCrc16(data: Uint8Array): number {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
        let r5 = data[i] ?? 0;  // unsigned byte (0-255)
        for (let j = 0; j < 8; j++) {
            const r6 = crc & 1;
            crc = crc >>> 1;
            if (r6 !== (r5 & 1)) {
                crc = crc ^ 0x8408;
            }
            r5 = r5 >>> 1;  // unsigned right shift
        }
    }
    return crc & 0xffff;
}
```

### Java vs TypeScript: Sign Extension Analysis

In Java, `data[i]` is a **signed byte** (-128 to 127). When assigned to `int r5`, it is
sign-extended. For example, byte `0x80` becomes `r5 = -128 = 0xFFFFFF80`. The arithmetic
right shift `r5 >> 1` then produces `0xFFFFFFC0`, `0xFFFFFFE0`, etc.

In TypeScript, `data[i]` from a `Uint8Array` is **unsigned** (0-255). For byte `0x80`,
`r5 = 128 = 0x00000080`. The unsigned right shift `r5 >>> 1` produces `0x00000040`,
`0x00000020`, etc.

**However, the bit sequence `r5 & 1` is identical in both cases** for all 8 iterations,
because:
- The lower 8 bits of `r5` are the same in both Java and TypeScript
- The sign extension only affects bits 8-31, which don't affect `r5 & 1`
- After 8 right shifts, both Java and TypeScript have processed all 8 bits of the original byte

Therefore, the TypeScript port produces **identical results** to the Java implementation.

### Worked Example: CRC of `[0x00]`

```
Initial: crc = 0xFFFF

Byte 0x00 (all bits are 0):
  j=0: r6 = 0xFFFF & 1 = 1, crc = 0x7FFF, r6(1) != r5&1(0) → crc ^= 0x8408 → crc = 0xFBF7
  j=1: r6 = 0xFBF7 & 1 = 1, crc = 0x7DFB, r6(1) != r5&1(0) → crc ^= 0x8408 → crc = 0xF9F3
  j=2: r6 = 0xF9F3 & 1 = 1, crc = 0x7CF9, r6(1) != r5&1(0) → crc ^= 0x8408 → crc = 0xF8F1
  j=3: r6 = 0xF8F1 & 1 = 1, crc = 0x7C78, r6(1) != r5&1(0) → crc ^= 0x8408 → crc = 0xF870
  j=4: r6 = 0xF870 & 1 = 0, crc = 0x7C38, r6(0) == r5&1(0) → no XOR
  j=5: r6 = 0x7C38 & 1 = 0, crc = 0x3E1C, r6(0) == r5&1(0) → no XOR
  j=6: r6 = 0x3E1C & 1 = 0, crc = 0x1F0E, r6(0) == r5&1(0) → no XOR
  j=7: r6 = 0x1F0E & 1 = 0, crc = 0x0F87, r6(0) == r5&1(0) → no XOR

Result: crc = 0x0F87
```

### Usage in NCS Protocol

From `NcsCoDec.java`, the CRC is used as follows:

1. Encode the data buffer using the NCS codec
2. Compute `crc = calcCrc(encodedData)`
3. Compute `inverted = ~crc & 0xFFFF`
4. Append `inverted` in **little-endian** byte order to the packet:
   ```
   packet[n]   = inverted & 0xFF         // low byte
   packet[n+1] = (inverted >>> 8) & 0xFF // high byte
   ```

The residue (CRC of the full packet including the appended inverted CRC) is a fixed
constant for this algorithm (not necessarily 0x0000).

### Known Test Vectors

| Input | CRC |
|-------|-----|
| `"123456789"` | `0x6F91` |
| `[0x00]` | `0x0F87` |
| `[0xFF]` | `0x00FF` |
| `[]` (empty) | `0xFFFF` (initial value) |

---

## Architecture: How These Algorithms Fit Together

```
┌─────────────────────────────────────────────────────────────────┐
│                     ROM Definition (XML)                         │
│  <checksummodule>std</checksummodule>                           │
│  <checksummodule>alt</checksummodule>                           │
│  <checksummodule>alt2</checksummodule>                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              RomRaider Provider (Parser)                         │
│  Reads checksummodule type and address parameters from XML       │
│  Passes to checksum update/validate functions                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│           Algorithm Implementations (Pure Functions)             │
│  packages/core/src/checksum/algorithms.ts                        │
│                                                                  │
│  computeNissanStdChecksum(data, start, end, sumloc, xorloc)     │
│    └─ Returns { sumt, xort }                                    │
│                                                                  │
│  validateNissanStdChecksum(data, start, end, sumloc, xorloc)    │
│    └─ Returns 0, 1, or 2 (number of valid checksums)            │
│                                                                  │
│  updateNissanStdChecksum(data, start, end, sumloc, xorloc)      │
│    └─ Writes sumt and xort big-endian to ROM in-place           │
│                                                                  │
│  computeNissanAlt2Checksum(data, start, end, sumloc, xorloc,    │
│                             skiploc?)                            │
│    └─ Returns { sumt, xort, calSum, codeSum }                   │
│                                                                  │
│  validateNissanAlt2Checksum(data, start, end, sumloc, xorloc,   │
│                              skiploc?)                           │
│    └─ Returns 0–4 (number of valid checksums)                   │
│                                                                  │
│  updateNissanAlt2Checksum(data, start, end, sumloc, xorloc,     │
│                            skiploc?)                             │
│    └─ Writes all 4 checksums to ROM in-place                    │
│                                                                  │
│  ncsChecksum(packet)                                             │
│    └─ Σ bytes[0..N-2] & 0xFF                                    │
│                                                                  │
│  ncsCrc16(data)                                                  │
│    └─ CRC-16/IBM-SDLC without final XOR                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Test Coverage

Tests are in
[`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts).

### Nissan STD/ALT ROM Checksum Tests

| Test Suite | Test Cases |
|------------|------------|
| `computeNissanStdChecksum` | All-zero region, single DWORD, sumloc/xorloc skipping, two DWORDs, XOR of identical DWORDs, 32-bit overflow, unsigned return, alignment errors, bounds errors, sumloc/xorloc out of region |
| `validateNissanStdChecksum` | Both valid (returns 2), both wrong (returns 0), only sum valid (returns 1), round-trip |
| `updateNissanStdChecksum` | Writes correct bytes, all-zero ROM, round-trip update+validate |

### Nissan ALT2 ROM Checksum Tests

| Test Suite | Test Cases |
|------------|------------|
| `computeNissanAlt2Checksum` | All-zero ROM, start+4 iteration boundary, skiploc skipping, calSum inline sumt/xort, codeSum range, skiploc word exclusion, default skiploc, alignment errors, bounds errors, skiploc boundary errors, unsigned 16-bit values |
| `validateNissanAlt2Checksum` | All valid (returns 4), all wrong (returns 0), round-trip |
| `updateNissanAlt2Checksum` | Writes all 4 checksums to correct locations, round-trip, default skiploc |

### NCS Protocol Checksum Tests

| Test Suite | Test Cases |
|------------|------------|
| `ncsChecksum` | Known NCS packet (0xC0), single-byte packet, two-byte packet, 8-bit wrap, large sum overflow, range check, empty packet error, determinism, all-zero packet, identical to ssmChecksum |

### NCS CRC-16 Tests

| Test Suite | Test Cases |
|------------|------------|
| `ncsCrc16` | Standard test vector (0x6F91), empty data (0xFFFF), single zero byte (0x0F87), single 0xFF byte (0x00FF), unsigned 16-bit return, different data produces different results, determinism, residue property (fixed constant), NcsCoDec test vector, all-zeros data, all-0xFF data |

---

## Key Invariants

### Nissan STD/ALT ROM Checksum

1. **Alignment**: All addresses must be 4-byte aligned (the algorithm reads 32-bit words).
2. **Endianness**: All values are stored **big-endian** in the ROM.
3. **Modular arithmetic**: All sums are computed modulo 2^32 (unsigned 32-bit wrapping).
4. **Skip locations**: `sumloc` and `xorloc` are excluded from the computation.
5. **Invariant**: After `updateNissanStdChecksum()`, `validateNissanStdChecksum()` returns 2.

### Nissan ALT2 ROM Checksum

1. **32-bit iteration starts at `start+4`**: The DWORD at `start` is not included.
2. **Three skipped locations**: `sumloc`, `xorloc`, and `skiploc` are excluded from 32-bit iteration.
3. **Inline inclusion**: The 16-bit calSum includes the computed `sumt` and `xort` values inline.
4. **codeSum starts at `skiploc+2`**: The word at `skiploc` itself is not included.
5. **Invariant**: After `updateNissanAlt2Checksum()`, `validateNissanAlt2Checksum()` returns 4.

### NCS Protocol Checksum

1. **Packet structure**: The checksum is always the **last byte** of the packet.
2. **Scope**: The checksum covers all bytes **except** the last (checksum) byte.
3. **Width**: The checksum is always **8 bits** (1 byte).
4. **Unsigned**: Bytes are treated as unsigned (0–255) during summation.

### NCS CRC-16

1. **Initial value**: `0xFFFF` (not `0x0000`).
2. **No final XOR**: Unlike CRC-16/IBM-SDLC, no final XOR is applied.
3. **LSB-first processing**: Each byte is processed bit-by-bit, LSB first.
4. **16-bit result**: The result is always in range `[0, 0xFFFF]`.

---

## Differences Between Java and TypeScript Ports

| Aspect | Java (RomRaider) | TypeScript (Our Port) |
|--------|------------------|-----------------------|
| Integer arithmetic | Java `int` is signed 32-bit; overflow wraps silently | Uses `>>> 0` to force unsigned 32-bit wrapping |
| 16-bit arithmetic | Java `short` wraps at 16 bits | Uses `& 0xFFFF` to truncate to 16 bits |
| Byte sign | Java `byte` is signed (-128 to 127) | `Uint8Array` values are unsigned (0-255) |
| CRC byte processing | `r5 = data[i]` sign-extends to `int` | `r5 = data[i]` is already unsigned |
| CRC bit shift | `r5 >> 1` (arithmetic, sign-extending) | `r5 >>> 1` (unsigned, zero-filling) |
| CRC result | `(short) crc` truncates to 16 bits | `crc & 0xFFFF` truncates to 16 bits |
| Return types | Various (void, int, short, byte[]) | TypeScript interfaces and numbers |
| Error handling | `ArrayIndexOutOfBoundsException` | Explicit bounds checks with descriptive errors |
| Default parameters | Configured via XML | TypeScript default parameter `skiploc = 0x20000` |

**Note on CRC sign extension**: Although Java sign-extends bytes and TypeScript does not,
the `r5 & 1` operation only looks at the LSB. The bit sequence produced by `r5 & 1` over
8 iterations is identical in both Java and TypeScript for all byte values 0x00–0xFF.
Therefore, the TypeScript port produces **identical CRC results** to the Java implementation.

---

## References

- **RomRaider source** (primary reference):
  - [`CalculateSTD.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateSTD.java)
  - [`CalculateALT2.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/CalculateALT2.java)
  - [`NissanChecksum.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NissanChecksum.java)
  - [`ChecksumSTD.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumSTD.java)
  - [`ChecksumALT.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT.java)
  - [`ChecksumALT2.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/ChecksumALT2.java)
  - [`NCSChecksumCalculator.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/io/protocol/ncs/iso14230/NCSChecksumCalculator.java)
  - [`NcsCoDec.java`](https://github.com/RomRaider/RomRaider/blob/master/src/main/java/com/romraider/maps/checksum/NcsCoDec.java)
- **Our implementation**:
  - [`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)
  - [`packages/core/test/checksum-algorithms.test.ts`](packages/core/test/checksum-algorithms.test.ts)
- **Related documentation**:
  - [`SUBARU_CHECKSUM_ANALYSIS.md`](SUBARU_CHECKSUM_ANALYSIS.md) — Subaru checksum algorithms
  - [`CHECKSUM_ARCHITECTURE_ANALYSIS.md`](CHECKSUM_ARCHITECTURE_ANALYSIS.md) — overall checksum architecture
  - [`ARCHITECTURE.md`](ARCHITECTURE.md) — project architecture overview
