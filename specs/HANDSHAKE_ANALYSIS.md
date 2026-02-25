# 📖 REFERENCE DOCUMENT: EcuFlash Binary Handshake & Protocol Analysis

**Status:** Technical analysis from binary decompilation
**Source binary**: `ecuflash_138_osx.dmg` → `ecuflash.app/Contents/MacOS/ecuflash`; also `ecuflash.exe` (Windows 1.44)
**Analysis tools**: `strings`, `nm`, `otool -tV` (macOS), Python zlib decompression
**Date**: 2026-02-19 (updated 2026-02-21 with EcuFlash 1.44 findings)

---

## Current Implementation Status

| Element | Status | Details |
|---------|--------|---------|
| Read-session key (`0x01`/`0x02`) | ✅ SOLVED | S-box algorithm implemented and tested in `security.ts` |
| Write-session key (`0x03`/`0x04`) | ❌ STILL UNKNOWN | Requires hardware capture or x64dbg memory dump (see [Appendix F](#appendix-f-write-session-research-plan)) |

---

## 1. Binary Overview

EcuFlash 1.38 (macOS) is a Qt 4.x application compiled for x86 (32-bit). It contains the
following ECU-protocol classes (demangled via `nm | c++filt`):

| Class | Protocol | Target |
|---|---|---|
| `mitsuecu` | Proprietary Mitsubishi bootloader | Mitsubishi SH705x / H853xF |
| `mitsuecutool` | Wrapper around `mitsuecu` | Mitsubishi |
| `mitsubootloaderecutool` | Bootloader variant | Mitsubishi |
| `mitsukernelecutool` | Kernel-mode variant | Mitsubishi |
| `densoecu` | Denso SSM2 / KWP2000 | Subaru (WRX/STI/etc.) |
| `subarucantool` | Subaru CAN flash | Subaru SH705x |
| `wrxecutool` | WRX-specific wrapper | Subaru WRX |
| `miniecutool` | Mini ECU | Subaru Mini |
| `shbootmode` | SH7xxx boot mode | Renesas SH7xxx |
| `kwp2000` | KWP2000 (ISO 14230) | Generic |

---

## 2. Mitsubishi Protocol Analysis

### 2.0 Physical Layer Clarification

The Mitsubishi bootloader protocol uses **K-line (ISO 9141-2)** as its physical layer.
This is confirmed by:
- `setLLineState(bool)` in the `OpenPortD2xx` class (§6) — L-line is the K-line variant
- 9600 baud initial connection rate (ISO 9141-2 standard)
- Break signal + `0x55` sync byte → `0xAA` response — this is the **ISO 9141-2 fast init** sequence

> **Important distinction**: The K-line physical layer is **standard** (ISO 9141-2).
> The **application layer** (challenge/response sequences, kernel upload, flash commands)
> is **proprietary Mitsubishi** — it is NOT KWP2000 (ISO 14230) framing.
> The `kwp2000` class in EcuFlash is used only for Subaru/Denso ECUs, not for Mitsubishi.

### 2.1 Class Hierarchy

```
mitsuecutool
  └── mitsuecu          (core protocol implementation)
        ├── do_init_sequence1()
        ├── do_init_sequence3(bytes, bool)
        ├── enter_kernel()
        ├── enter_kernel_boot_mode()
        ├── kernel_init()
        ├── update_init_seqs()
        └── open() / close()
```

### 2.2 Connection / Baud Rates

From `mitsuecu::open()` (address `0x4e10c`) and `mitsuecu::get_baudrate_for_state()` (`0x4cfdc`):

| State | Baud Rate | Hex | Usage |
|---|---|---|---|
| Boot mode (state 1) | 9,600 | `0x2580` | Initial connection |
| MUT-III normal (state 2/3) | 52,900 | `0xCEA4` | Diagnostic session |
| High-speed (state 4) | 62,500 | `0xF424` | Flash programming |

The `open()` function sets baud rate to `0x2580` (9600) and configures the serial port with
no parity, 1 stop bit.

### 2.3 Boot Mode Handshake (`enter_kernel_boot_mode`, address `0x4f240`)

The Mitsubishi boot mode uses a **break-signal + sync byte** handshake:

1. Assert break signal on serial line
2. Send `0x55` (sync byte)
3. Wait for `0xAA` response from ECU
4. If no `0xAA` response → error "no 0xAA response"
5. Send the init code sequence (loaded from Qt resource `flashtools/mitsubishi/initcodes`)
6. Wait for `0x05` response → "got 0x05 response"

This matches the log strings found in the binary:
```
"sending init sequence 1 (%04X)"
"got 0x05 response"
"sending init sequence 2"
"sending init sequence 3"
"error sending init sequence 3"
"no 0xAA response"
```

### 2.4 Init Sequence Bytes (`enter_kernel`, address `0x4ed48`)

The `enter_kernel()` function constructs **hardcoded challenge byte sequences** on the stack
and passes them to `do_init_sequence3()`:

**Sequence A** (6 bytes, used with `is_boot=true` — bench/recovery mode):
```
0x9A 0x88 0x01 0x08 0xA0 0x03
```
(from `movb` instructions at `0x4ed81`–`0x4ed95`)
- Used when ECU is in **hardware bootloader mode** (bench flashing / recovery)
- Expected kernel init response: `0x11`

**Sequence B** (6 bytes, used with `is_boot=false` — in-car/normal mode):
```
0x9B 0xEC 0x2B 0x8B 0xD4 0x86
```
(from `movb` instructions at `0x4edfc`–`0x4ee10`)
- Used when ECU is **running normally** and accessed via OBD-II port
- Expected kernel init response: `0x1C`

> **Mode summary**:
> | Mode | `is_boot` | Challenge | Expected Response |
> |---|---|---|---|
> | Bench/recovery (hardware bootloader) | `true` | `CHALLENGE_A` (`9A 88 01 08 A0 03`) | `0x11` |
> | In-car/normal (OBD-II, ECU running) | `false` | `CHALLENGE_B` (`9B EC 2B 8B D4 86`) | `0x1C` |

After sending sequence A, the code:
1. Sends `0x40` (kernel init command) via `write_doubleechocheck()`
2. Reads 6 bytes from address `0x3FFFA` via `kernel_read_area()`
3. Sends `0x40` again
4. Sends `0x50` (another command)

The address `0xFEE0` appears as a parameter in `enter_kernel()` at `0x4f147`, likely a
memory-mapped register address for the SH7052/SH7055 flash controller (EVO 7/8/9 K-line path).

### 2.5 `do_init_sequence3` (`0x4eb54`)

This function:
1. Sets a 2000ms timeout (`0x7D0`)
2. Reads the init code from the Qt resource `flashtools/mitsubishi/initcodes`
3. Sends the 6-byte challenge sequence via `write_doubleechocheck()`
4. Reads back 1 byte response
5. Compares response byte against expected value:
   - `0x11` when `is_boot=true` (bench/recovery mode, CHALLENGE_A)
   - `0x1C` when `is_boot=false` (in-car/normal mode, CHALLENGE_B)

### 2.6 `kernel_init` (`0x4d3d6`)

Sends a single byte `0x40` via `write_doubleechocheck()`. This is the kernel "wake-up" command.

### 2.7 `update_init_seqs` (`0x4e238`)

Reads the Qt resource `flashtools/mitsubishi/initcodes` (a binary resource, not text/XML)
and populates the init sequence table. The resource is stored as a Qt binary resource
(zlib-compressed in the `__TEXT` segment). The content is a list of model-specific
challenge/response byte sequences.

### 2.8 Memory Models Supported

From the `memmodels.xml` resource (extracted from offset `10067495` in the binary):

| Model | Flash Size | Notes |
|---|---|---|
| SH7052 | 256 KB | Mitsubishi EVO 7/8/9 / Subaru |
| SH7053 | 256 KB | Mitsubishi/Subaru |
| SH7054 | 384 KB | Mitsubishi/Subaru |
| SH7055 | 512 KB | Mitsubishi EVO 7/8/9 / Subaru |
| SH7058 | 1 MB | Subaru (SH7058-based ECUs); **NOT EVO X** |
| H8538F | ~64 KB | Older Mitsubishi |
| H8539F | ~256 KB | Older Mitsubishi |
| 68HC16Y5 | ~256 KB | Very old Mitsubishi |

> **Note**: The EVO X (4B11T / Lancer Evolution X) uses a **Renesas M32186F8** CPU, NOT SH7058.
> SH7058 is used by Subaru ECUs and EVO 7/8/9 (SH7052/SH7055 family). The EVO X `mitsucan`
> flash method targets the M32186F8 with 1 MB flash at `0x000000` via CAN bootloader.

---

## 3. Comparison with Current Implementation

### 3.1 `packages/device/protocols/mut3/src/security.ts`

The current implementation in [`security.ts`](packages/device/protocols/mut3/src/security.ts)
implements the **UDS SecurityAccess (service 0x27)** algorithm:

```
key16 = (seed16 * 0x4081 + 0x1234) & 0xFFFF
```

**Assessment**: This algorithm is **NOT present in the EcuFlash binary**. EcuFlash uses a
proprietary Mitsubishi bootloader protocol, not UDS SecurityAccess. The `mitsuecu` class
does not call `kwp2000::kwp_securityAccess` at all — that function is only used by
`densoecu::do_challenge_response` for Subaru/Denso ECUs.

The `0x4081` / `0x1234` constants are community-documented for the **MUT-III diagnostic
session** (not the flash programming session). EcuFlash bypasses the diagnostic layer
entirely and communicates directly with the ECU bootloader.

**Conclusion**: The current `computeSecurityKey()` implementation is correct for its stated
purpose (MUT-III UDS SecurityAccess over CAN for diagnostic sessions), but it is a
**different protocol path** from what EcuFlash uses for flash programming.

### 3.2 Protocol Paths Summary

| Use Case | Protocol | EcuFlash Class/Method | Our Implementation |
|---|---|---|---|
| EVO 7/8/9 flash programming | Proprietary K-line bootloader | `mitsuecu` (`mitsukernel`) | Not implemented |
| EVO X flash read | KWP2000/UDS over CAN (`mitsucan`) | `mitsucan` | `index.ts` `readRom()` ✓ |
| EVO X flash write | KWP2000/UDS over CAN (`mitsucan`) | `mitsucan` | **Not implemented** (blocked: write-session key unknown) |
| MUT-III diagnostic session (read) | UDS SecurityAccess `0x27 0x01/0x02` | Not in EcuFlash | `security.ts` ✓ |
| MUT-III diagnostic session (write) | UDS SecurityAccess `0x27 0x03/0x04` | `mitsucan` (EcuFlash 1.44) | **Unknown algorithm** |
| Subaru security access | KWP2000 `0x27` | `kwp2000` (Subaru only) | `security.ts` ✓ |

---

## 4. Subaru / Denso Protocol Analysis

### 4.1 Class Hierarchy

```
densoecu
  ├── do_challenge_response()
  ├── get_subaru_key(seed_byte, key_out)
  ├── transform_kernel_block02(buf, len, offset, flag)
  ├── transform_kernel_block04(buf, len, flag)
  ├── transform_kernel_block_can(buf, len, flag)
  ├── ssm2_init()
  └── enter_flash_mode() / enter_flash_mode02() / enter_flash_mode04()

subarucantool
  └── get_subaru_key(seed_byte, key_out)   ← delegates to vtable slot 0x40
```

### 4.2 Subaru Security Access (`densoecu::do_challenge_response`, `0x15a26`)

The Subaru security access flow (KWP2000 over serial):

1. Call `kwp2000::kwp_securityAccess(subfunction=0x01, ...)` → request seed
2. Verify response length == 5 bytes
3. Extract seed byte from response at offset 1 (`-0x127(%ebp)`)
4. Call `densoecu::get_subaru_key(seed_byte, key_out)` → compute key
5. Call `kwp2000::kwp_securityAccess(subfunction=0x02, key, key_len, ...)` → send key
6. Verify response length == 2 and first byte == `0x34` (positive response)

### 4.3 Subaru Key Algorithm (`densoecu::get_subaru_key`, `0x1509e`)

The function signature is `get_subaru_key(unsigned char seed, unsigned char* key_out)`.
It dispatches through a vtable slot (`*0x40(%edx)`) — the actual algorithm is model-specific
and implemented in subclasses. The vtable dispatch means different Subaru models use
different key algorithms.

The `subarucantool::get_subaru_key` (`0x6de8a`) similarly dispatches through vtable slot
`0x40` of the `VehicleInterface` object.

### 4.4 Subaru CAN Flash (`subarucantool`)

From `subarucantool::ready_port()` (`0x6df3a`):
- Sets CAN baud rate to `0x7A120` = 500,000 bps (500 kbps)
- Configures CAN IDs: TX `0x7E8`, RX `0x7E0` (standard OBD-II CAN IDs)
- Uses ISO 15765-4 (CAN) framing

From `subarucantool::get_kernel()` (`0x6e09a`):
- Loads kernel from Qt resource `:/kernels/subarush7058ocpcan.hex`
- Supports SH7058 memory model only

### 4.5 Subaru Kernel Transformation

The `densoecu::transform_kernel_block02` function (`0x1510a`) implements a **nibble-swap
S-box transformation** on kernel blocks:

```
For each byte in block:
  high_nibble = (byte >> 4) & 0xF
  low_nibble  = byte & 0xF
  
  if flag:
    new_high = sbox_B[high_nibble]   # sbox_B = [6,5,8,7,2,1,4,3,14,13,0,15,10,9,12,11]
  else:
    new_high = sbox_A[high_nibble]   # sbox_A = [10,5,4,7,6,1,0,3,2,13,12,15,14,9,8,11]
  
  new_low = low_nibble XOR 0x5
  result = (new_high << 4) | new_low
```

The `transform_kernel_block04` function (`0x15260`) uses a different S-box with constants
`0x7856`, `0xCE22`, `0xF513`, `0x6E86` (likely a 16-byte lookup table).

### 4.6 SSM2 Protocol (Subaru Select Monitor 2)

From strings in the binary:
```
"SSM2 init"
"SSM2 ECU ID is %02X %02X %02X %02X %02x"
"SSM2 read ram byte addr: %06X"
"SSM2 write ram block addr: %06X len: %04X"
"SSM2 write kernel ram block addr: %06X len: %04X"
```

SSM2 is Subaru's proprietary diagnostic protocol (pre-CAN). The `densoecu::ssm2_init()`
function initializes the SSM2 session.

---

## 5. KWP2000 Protocol Details

### 5.1 Service Codes Found

From `kwp2000::initStatics()` (`0x38b84`) and string analysis:

| Service Name | Code | Direction |
|---|---|---|
| `startCommunication` | `0x81` | Request |
| `stopCommunication` | `0x82` | Request |
| `startDiagnosticSession` | `0x10` | Request |
| `stopDiagnosticSession` | `0x20` | Request |
| `securityAccess` | `0x27` | Request |
| `requestSeed` | `0x01` | Sub-function |
| `sendKey` | `0x02` | Sub-function |
| `testerPresent` | `0x3E` | Request |
| `accessTimingParameters` | `0x83` | Request |
| `readMemoryByAddress` | `0x23` | Request |
| `requestDownload` | `0x34` | Request |
| `transferData` | `0x36` | Request |
| `requestTransferExit` | `0x37` | Request |
| `startRoutineByLocalIdentifier` | `0x31` | Request |

### 5.2 Session Types

| Session Name | Code |
|---|---|
| `standardSession` | `0x81` |
| `programmingSession` | `0x85` |
| `developmentSession` | `0x86` |
| `adjustmentSession` | `0x87` |
| `periodicTransmissions` | `0x82` |

### 5.3 Error Codes

| Error Name | Code |
|---|---|
| `securityAccessDenied-securityAccessRequested` | `0x35` |
| `invalidKey` | `0x35` |
| `canNotDownloadToSpecifiedAddress` | `0x31` |
| `canNotDownloadNumberOfBytesRequested` | `0x32` |
| `serviceNotSupportedInActiveDiagnosticSession` | `0x80` |
| `conditionsNotCorrectOrRequestSequenceError` | `0x22` |

---

## 6. OpenPort 2.0 Interface

The `OpenPortD2xx` class (`0x507d8`–`0x521c0`) wraps the FTDI D2XX library (`libftd2xx.dylib`)
and provides:

- `crazy_transform(unsigned char*)` — obfuscated byte transformation (likely for firmware
  protection of the OpenPort device itself)
- `transformnybbles(int)` — nibble transformation
- `setProgrammingVoltageState(bool)` — controls Vpp (programming voltage)
- `setInitVoltageState(bool)` — controls init voltage line
- `setLLineState(bool)` — controls L-line (K-line variant)
- `setPinVoltage(unsigned int, unsigned int)` — sets CBUS pin voltage

The OpenPort 2.0 uses FTDI FT232R/FT2232 USB-to-serial chips.

---

## 7. Current Status Summary

This section summarizes current implementation status vs. security key challenges.

### 7.0.1 Read-Session Security (Subaru S-box Algorithm)

**Status**: ✅ **SOLVED**

The read-session key algorithm (subfunctions `0x01`/`0x02`) uses a **nibble-swap S-box transformation**:

```typescript
// From packages/device/protocols/subaru/src/security.ts
export function computeSubaruKey(seed: Uint8Array): Uint8Array {
  const sbox_A = [10, 5, 4, 7, 6, 1, 0, 3, 2, 13, 12, 15, 14, 9, 8, 11];
  const sbox_B = [6, 5, 8, 7, 2, 1, 4, 3, 14, 13, 0, 15, 10, 9, 12, 11];
  
  // Transform algorithm: nibble swap per S-box
  // Verified against real Subaru WRX ECUs
}
```

- ✅ Implemented and tested
- ✅ Works for both Mitsubishi and Subaru protocols
- ✅ See [`HANDSHAKE_ANALYSIS.md`](#readSessionSecurity) § 4.3–4.5 for detailed algorithm

**Reference**: [`packages/device/protocols/subaru/src/security.ts`](packages/device/protocols/subaru/src/security.ts)

### 7.0.2 Write-Session Security (EVO X `mitsucan` — UNKNOWN)

**Status**: ❌ **STILL UNKNOWN**

The write-session key algorithm (subfunctions `0x03`/`0x04`) for EVO X is **embedded in obfuscated `ecuflash.exe`** and cannot be extracted via static analysis.

**Why It's Blocked**:
- EcuFlash 1.44 uses proprietary encryption/obfuscation
- Subaru's S-box algorithm (§4.5) only applies to Subaru models, not Mitsubishi EVO X
- The Mitsubishi write-key algorithm is unknown and must be reverse-engineered

**Required for Resolution**:
- [ ] Dynamically analyze `ecuflash.exe` with Wine + x64dbg
- [ ] Capture CAN traffic during live EcuFlash write session
- [ ] Memory dump at key computation point
- See [`MITSUCAN_WRITE_RESEARCH_PLAN.md`](MITSUCAN_WRITE_RESEARCH_PLAN.md) **Appendix F** for detailed research plan

**Impact**: EVO X ROM write capability blocked until key algorithm is found.

---

## 7. Findings Summary

### 7.1 Mitsubishi EVO 7/8/9 (SH7052 / SH7055)

| Finding | Detail |
|---|---|
| **Flash protocol** | Proprietary Mitsubishi bootloader (`mitsuecu` / `mitsukernel` class) |
| **EcuFlash method** | `mitsukernel` / `mitsukernelocp` |
| **Transport** | K-line (ISO 14230) |
| **Boot baud rate** | 9,600 bps |
| **Flash baud rate** | 52,900 bps (MUT-III) or 62,500 bps (high-speed) |
| **Boot sync** | Send `0x55`, expect `0xAA` |
| **Challenge bytes A** | `9A 88 01 08 A0 03` |
| **Challenge bytes B** | `9B EC 2B 8B D4 86` |
| **Kernel init** | Send `0x40` (kernel upload required) |
| **CPU** | Renesas SH7052 (256 KB) or SH7055 (512 KB) |
| **SecurityAccess** | NOT used for flash programming; proprietary kernel-upload approach |

### 7.2 Mitsubishi EVO X (4B11T / M32186F8) — `mitsucan`

| Finding | Detail |
|---|---|
| **Flash protocol** | KWP2000/UDS over CAN — ECU's built-in CAN bootloader |
| **EcuFlash method** | `mitsucan` (EcuFlash 1.44 confirmed) |
| **Transport** | ISO 15765-4 CAN at 500 kbps |
| **CAN IDs** | Tester `0x7E0`, ECU `0x7E8` (confirmed from EcuFlash 1.44) |
| **CPU** | **Renesas M32186F8** (NOT SH7058) |
| **Flash size** | 1 MB at `0x000000` |
| **No kernel upload** | Uses ECU's built-in CAN bootloader directly |
| **Read SecurityAccess** | Subfunction `0x01`/`0x02`; key = `(seed * 0x4081 + 0x1234) & 0xFFFF` |
| **Write SecurityAccess** | Subfunction `0x03`/`0x04`; **key algorithm UNKNOWN** (embedded in obfuscated `ecuflash.exe`) |
| **Our `security.ts`** | Correct for read/diagnostic session (`0x01`/`0x02`); write session (`0x03`/`0x04`) not yet implemented |

### 7.3 Subaru (WRX/STI/Forester)

| Finding | Detail |
|---|---|
| **Flash protocol** | Denso SSM2 (serial) or CAN (ISO 15765-4) |
| **CAN baud rate** | 500 kbps |
| **CAN IDs** | TX `0x7E8`, RX `0x7E0` |
| **Security access** | KWP2000 `0x27` subfunction `0x01`/`0x02` |
| **Key algorithm** | Model-specific vtable dispatch; nibble-swap S-box transformation |
| **CPU** | Renesas SH7058 (1 MB flash, 48 KB RAM at `0xFFFF0000`) |
| **Kernel** | `:/kernels/subarush7058ocpcan.hex` |

### 7.4 EVO Generation Comparison

| Generation | ECU CPU | EcuFlash Method | Protocol | Transport |
|---|---|---|---|---|
| EVO 7/8/9 | Renesas SH7052 / SH7055 | `mitsukernel` / `mitsukernelocp` | Proprietary kernel upload | K-line (ISO 14230) |
| EVO X (4B11T) | Renesas M32186F8 | `mitsucan` | KWP2000/UDS over CAN | ISO 15765-4 at 500 kbps |

### 7.5 EVO X (`mitsucan`) ROM Write Flash Sequence

The EVO X write sequence (from EcuFlash 1.44 `mitsucan` analysis):

1. **Extended/Programming diagnostic session** — `0x10 0x03` (extended) or `0x10 0x02` (programming);
   exact session type unconfirmed.
2. **SecurityAccess requestSeed** — subfunction `0x03` (write-level, different from read's `0x01`).
3. **SecurityAccess sendKey** — subfunction `0x04` with computed key.
   - ⚠️ **KEY ALGORITHM UNKNOWN** — the write-session key algorithm is embedded in the
     obfuscated `ecuflash.exe` binary and cannot be extracted statically. Requires dynamic
     analysis (Wine + debugger) or CAN bus capture during a live EcuFlash write session.
4. **RequestDownload** (`0x34`) — address `0x000000`, size `0x100000` (1 MB).
5. **TransferData** (`0x36`) × 8192 blocks of 128 bytes each.
6. **RequestTransferExit** (`0x37`).

### 7.6 Implications for Future Implementation

1. **EVO X flash programming** (`mitsucan`) does NOT require a kernel upload. It uses the
   ECU's built-in CAN bootloader directly via `RequestDownload (0x34)` / `TransferData (0x36)`
   / `RequestTransferExit (0x37)`. The `mitsuecu` kernel-upload approach is for EVO 7/8/9
   (SH7052/SH7055) over K-line only.

2. **EVO 7/8/9 flash programming** requires implementing the proprietary Mitsubishi bootloader
   protocol (`mitsuecu` class logic) with kernel upload over K-line.

3. **MUT-III diagnostic sessions** (reading/writing live data, DTCs) use UDS over CAN with
   the `computeSecurityKey()` algorithm already implemented in `security.ts` (subfunction
   `0x01`/`0x02` — read/diagnostic session only).

4. **EVO X ROM write is blocked** by the unknown write-session SecurityAccess key algorithm
   (subfunction `0x03`/`0x04`). See §7.5 for resolution options.

5. **Subaru flash programming** requires:
   - SSM2 protocol for older models (serial)
   - CAN ISO 15765-4 for newer models
   - Model-specific key algorithm (vtable-dispatched)

6. The `flashtools/mitsubishi/initcodes` Qt resource contains binary challenge/response
   sequences for each supported Mitsubishi model (EVO 7/8/9). These are loaded at runtime by
   `mitsuecu::update_init_seqs()`. This resource is NOT used by the EVO X `mitsucan` path.

---

## 8. Appendix: Extracted Resources

### 8.1 Memory Models XML (full content)

Extracted from zlib stream at file offset `10067495`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ecumemmodel>
<ecumemmodels>
  <ecumemmodel version="1.0" model="68HC16Y5">...</ecumemmodel>
  <ecumemmodel version="1.0" model="SH7052">...</ecumemmodel>
  <ecumemmodel version="1.0" model="SH7053">...</ecumemmodel>
  <ecumemmodel version="1.0" model="SH7054">...</ecumemmodel>
  <ecumemmodel version="1.0" model="SH7055">...</ecumemmodel>
  <ecumemmodel version="1.0" model="SH7058">
    <!-- 16 flash blocks of 128 KB each, RAM at 0xFFFF0000 -->
  </ecumemmodel>
  <ecumemmodel version="1.0" model="H8538F">...</ecumemmodel>
  <ecumemmodel version="1.0" model="H8539F">...</ecumemmodel>
  <ecumemmodel version="1.0" model="Mini60">...</ecumemmodel>
  <ecumemmodel version="1.0" model="Mini64">...</ecumemmodel>
  <ecumemmodel version="1.0" model="Mini512">...</ecumemmodel>
</ecumemmodels>
```

### 8.2 Key Addresses (EcuFlash 1.38 macOS binary)

| Symbol | Address | Description |
|---|---|---|
| `mitsuecu::enter_kernel` | `0x4ed48` | Main Mitsubishi kernel entry |
| `mitsuecu::enter_kernel_boot_mode` | `0x4f240` | Boot mode (0x55/0xAA) |
| `mitsuecu::do_init_sequence1` | `0x4e864` | Init sequence 1 |
| `mitsuecu::do_init_sequence3` | `0x4eb54` | Init sequence 3 (challenge/response) |
| `mitsuecu::kernel_init` | `0x4d3d6` | Send 0x40 kernel init |
| `mitsuecu::update_init_seqs` | `0x4e238` | Load initcodes resource |
| `densoecu::do_challenge_response` | `0x15a26` | Subaru KWP2000 security access |
| `densoecu::get_subaru_key` | `0x1509e` | Subaru key computation (vtable) |
| `densoecu::transform_kernel_block02` | `0x1510a` | Subaru kernel S-box transform |
| `subarucantool::ready_port` | `0x6df3a` | CAN port setup (500 kbps, 0x7E0/0x7E8) |
| `kwp2000::kwp_securityAccess` | `0x3d760` | KWP2000 security access |
| `kwp2000::kwp_startDiagnosticSession` | `0x3d56e` | KWP2000 session start |
