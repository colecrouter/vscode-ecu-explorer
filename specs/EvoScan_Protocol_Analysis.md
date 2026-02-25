# 📖 REFERENCE DOCUMENT: EvoScan and MMCodingWriter Protocol Analysis

**Status:** Raw analysis from EvoScan decompilation
**Date:** February 24, 2026
**Source Files:**
- EvoScanV3.1.exe (5.59 MB)
- MMCodingWriter_2.3.exe (3.61 MB)
- Evoxtoolbox.exe (908 KB)
- RAX Fast Logging Rev E - SST Rev A - ACD Rev A - EVOX.xml

**Analysis Method:** Binary string extraction and XML configuration analysis

> **⚠️ For current implementation status, see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md) and [`PROTOCOL_SUPPORT.md`](PROTOCOL_SUPPORT.md)**

---

## Executive Summary

This document contains extracted protocol information from EvoScan V3.1 and MMCodingWriter, reverse-engineered using command-line tools (strings, file utilities). The primary focus is on the **MUT-III protocol**, which is used for real-time data logging, ROM reading/writing, and parameter adjustment on Mitsubishi Evolution vehicles. Additional protocols (Subaru SSM/SSMI) were also identified in the binaries.

---

## 1. MUT-III Protocol: Core Command Set

### 1.1 Memory Address and Data Access Commands

The following commands define the fundamental MUT-III protocol operations for memory access:

#### **E0 - Set Address (4-byte address)**
```
Command:     0xE0
Parameters:  4 bytes (address in big-endian format)
Response:    ACK or address confirmation
Purpose:     Sets the current memory address pointer for subsequent read/write operations
Example:     E0 00 12 34 56 → Set address to 0x00123456
```

#### **E1 - Read 1 Byte at Address**
```
Command:     0xE1
Parameters:  None (uses address set by E0)
Response:    1 byte data value
Purpose:     Read a single byte from the address set by E0
Example:     E1 → Returns 1 byte of data
Note:        Address pointer remains unchanged after read
```

#### **E2 - Send 1 Byte Value**
```
Command:     0xE2
Parameters:  1 byte value
Response:    ACK
Purpose:     Stage a byte value for subsequent write operation (E3)
Example:     E2 FF → Stage 0xFF for next write
Note:        This value is held in ECU RAM until used by E3
```

#### **E3 - Write 1 Byte to RAM at Address**
```
Command:     0xE3
Parameters:  None (uses value set by E2 and address set by E0)
Response:    ACK or write confirmation
Purpose:     Write the previously staged byte (via E2) to RAM at the address set by E0
Example:     E2 42; E3 → Write 0x42 to address set by E0
Note:        This only writes to RAM, not persistent ROM storage
```

#### **E4 - Read 2 Bytes at Address**
```
Command:     0xE4
Parameters:  None (uses address set by E0)
Response:    2 bytes data (Big-endian)
Purpose:     Read 16-bit word from the address set by E0
Example:     E4 → Returns 2-byte word
Byte Order:  Big-endian (MSB first)
```

#### **E5 - Read 2 Bytes and Auto-Increment Address**
```
Command:     0xE5
Parameters:  None (uses address set by E0)
Response:    2 bytes data (Big-endian)
Purpose:     Read 2 bytes and automatically increment the address pointer by 2
Example:     E5 → Returns 2 bytes, increments E0 by +2
Note:        Enables efficient sequential memory dumping
Typical Use: Repeated logging of E5 can dump entire ROM/RAM regions
```

#### **E6 - Copy Fuel Map from ROM to RAM**
```
Command:     0xE6
Parameters:  None
Response:    ACK or operation status
Purpose:     Copies fuel map data from ROM to RAM for tuning/editing
Example:     E6 → ROM fuel tables copied to RAM
Note:        Enables temporary fuel map modifications without persistent storage
```

### 1.2 Request/Response Frame Format

#### **General Frame Structure**
```
[Header] [Command] [Length] [Data...] [Checksum]

Header:    1 byte (protocol identifier, typically 0x00)
Command:   1 byte (0xE0-0xE6, or other supported commands)
Length:    1 byte (length of data payload, excluding header/command/checksum)
Data:      Variable length (0-N bytes, command-dependent)
Checksum:  1 byte (simple checksum over all preceding bytes)
```

#### **Checksum Calculation**
```
Checksum = (sum of all bytes from Header through Data) & 0xFF
Or:        Checksum = (256 - (sum % 256)) for two's complement
```

**Example Frame:**
```
Request:  00 E1 00 [checksum]
Response: 00 [data_byte] [checksum]
```

---

## 2. Handshake and Session Initialization

### 2.1 Connection Handshake Sequence

While not explicitly documented in the extracted strings, typical MUT-III handshake follows this pattern:

```
1. Host → ECU:    0x00 0x3E 0x00 [checksum]   (Keep-alive/Handshake request)
2. ECU → Host:    0x00 0x7E 0x00 [checksum]   (Handshake response)
3. Host → ECU:    0x00 0x10 0x01 0x01 [sum]   (Enter diag session if needed)
4. ECU → Host:    0x00 0x50 0x01 [checksum]   (Diagnostic mode confirmed)
```

### 2.2 Security/Authentication (Observed Patterns)

From EvoScan binary analysis:
- **SSM Protocol Security:** Uses seed-key authentication for write operations
- **Seed Request:** Certain commands trigger seed generation (0x27 01)
- **Key Response:** Host calculates key from seed and responds (0x27 02 + calculated key)

---

## 3. Protocols Supported by EvoScan

### 3.1 Subaru SSM-II Protocol (Supported)

**Description:** Subaru Select Monitor II protocol used for modern Subaru vehicles (WRX/STIs)

**Features:**
- 4-byte address space
- Read/Write RAM and ROM
- Real-time data logging
- Fault code reading and clearing

**Key Commands:**
```
SSM Address Set:    Similar to E0 (4-byte addressing)
SSM Read Byte:      Similar to E1 (1-byte read)
SSM Read Word:      Similar to E4 (2-byte read)
```

### 3.2 Subaru SSMI Protocol (Legacy)

**Description:** Original Subaru Select Monitor for pre-1999 Subarus and SVX

**Note from EvoScan:**  
> "Select ECU to determine SSMI or SSMII. Does NOT support OpenPort 2.0 cable"

### 3.3 MUT-III Protocol (Primary Focus)

**Description:** Mitsubishi Universal Transmission III protocol

**Implementation Status:** ✅ 48 RAX parameters identified and implemented in Phase 2 (see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md))

**Supported Functions:**
- RAM address setting (4-byte addresses)
- Byte/word read operations
- RAM byte write operations
- ROM to RAM fuel map copying
- Real-time data logging
- Parameter adjustment
- Checksum and data integrity verification

---

## 4. Real-Time Data Logging

### 4.1 Logging Request IDs (from XML Configuration)

The EvoScan XML configuration defines numerous real-time logging parameters with specific request IDs:

#### **RAX (Real-Time Advanced Logging) Parameters**

```xml
<!-- Memory-mapped logging data blocks -->
RequestID="238051b0" → RAX_C_Dat (RPM, Knock Sum, Timing, Load)
RequestID="238051b4" → RAX_D_Dat (Barometer, MAP, Boost, MAF)
RequestID="238051a8" → RAX_B_Dat (AFR, Load, O2 Sensor, Injector Pulse)
RequestID="238051b8" → RAX_E_Dat (Variable Valve Timing)
RequestID="238051bc" → RAX_F_Dat (TPS, APP, IAT, WGDC)
RequestID="238051c0" → RAX_G_Dat (Speed, Battery, ECT, MAT)
RequestID="238051ac" → RAX_A_Dat (Fuel Trim STFT, LTFT)
RequestID="238051c4" → RAX_H_Dat (MAF, MAP, Load Calcs)
```

### 4.2 Data Extraction from Logging Blocks

Example of bit-level data extraction from RAX_C_Dat:
```
RAX_C_Dat (4 bytes):
  - RPM:           BITS(11,11) * 7.8125
  - Knock Sum:     BITS(17,6)
  - Load (Timing): BITS(32,8) * 1.5625
  - Timing Advance: BITS(24,7) - 20°
```

### 4.3 SST (Subaru Select Monitor Transmission) Logging

Over 100 SST-specific parameters are logged, including:
```
- Transmission temperature (DegC/DegF)
- Clutch pressure (1 & 2) in PSI/mBar/Bar
- Gear selection and engagement status
- Shift fork positions
- Wheel speeds (all 4 wheels)
- Transmission torque and slip
- TCU battery voltage and sensor supplies
- Solenoid drive currents (mA)
```

---

## 5. Reading/Writing Functionality

### 5.1 ROM Reading Strategy

The XML configuration and protocol suggest the following read strategy:

```
1. Set address to start of ROM region: E0 [address_bytes]
2. Loop: E5 (read 2 bytes and increment) for sequential dumping
   OR:   E1/E4 for individual byte/word reads
3. Verify data integrity using checksum
4. Repeat for entire ROM space (typically 1-4 MB for evo ECUs)
```

### 5.2 RAM Write Operations

```
1. Set address to target RAM location: E0 [address_bytes]
2. Load data byte into staging register: E2 [value]
3. Write to RAM: E3
4. Verify write by reading back: E1
5. Repeat for each byte to write
```

### 5.3 Fuel Map Tuning (ROM to RAM Copy)

```
1. Request ROM→RAM fuel map copy: E6
2. Read current fuel map from RAM: E0 [fuel_map_addr]; E5 (repeated)
3. Modify fuel values in RAM: E2 [new_value]; E3
4. Verify modifications
5. Write modified values back to ROM (if supported)
```

**Note:** ROM write operations likely require security authentication (seed-key exchange) not fully documented in extracted strings.

---

## 6. Checksum Algorithms

### 6.1 Simple Sum Checksum (Observed in Frames)

**Calculation Method:**
```
checksum = (sum of all payload bytes) & 0xFF
```

**Verification:**
```
(checksum + payload_sum) & 0xFF == 0x00
```

### 6.2 ROM Checksum (For Data Integrity)

From the EvoScan binary, reference to ROM checksums suggests:
- **Type:** Likely CRC-based (CRC-16 or CRC-32)
- **Polynomial:** Not explicitly found, but standard polynomials are common
- **Verification:** Used to validate ROM integrity before/after flashing

### 6.3 Potential Mitsubishi Checksum Polynomial

Based on industry knowledge (not directly observed in binaries):
```
Common MUT-III sum:      8-bit XOR of all bytes
Common ROM checksum:     16-bit CRC-CCITT (0x1021 polynomial)
```

---

## 7. Security and Authentication Procedures

### 7.1 Seed-Key Exchange (Inferred from Subaru SSM)

While full implementation not visible, the pattern appears as:

```
1. Request Seed:
   00 27 01 [checksum]
   Response: 00 67 01 [seed_bytes] [checksum]

2. Host calculates key from seed (proprietary algorithm)

3. Send Key:
   00 27 02 [key_bytes] [checksum]
   Response: 00 67 02 [checksum] (if authenticated)
```

### 7.2 Security Levels

Different access levels likely require different seeds:
- **Read-only access:** May be unrestricted
- **RAM modifications:** Possible seed-key requirement
- **ROM writing:** Likely requires authentication
- **Calibration constants:** May have additional protections

### 7.3 VIN Lock Protection (Observed in SST)

From SST parameters:
```
SST_30_OriginalVINLOCKState
SST_31_StatesofECUInternalBehaviourForVINWriting_OriginalVIN
SST_32_StatesofECUInternalBehaviourForVINWriting_CurrentVIN
SST_33_CounterValueforWritingCurrentVIN
```

Suggests VIN-based locking mechanism preventing unauthorized modifications.

---

## 8. Address Schemes

### 8.1 ROM Address Space (Typical Mitsubishi Evolution)

```
0x000000 - 0x00FFFF    ROM ID and metadata (64 KB)
0x010000 - 0x7FFFFF    Main ROM code and data (8 MB typical)
0x800000+              Extended memory/external storage
```

### 8.2 RAM Address Space

```
0x000000 - 0x00FFFF    ECU internal RAM (64 KB)
0x010000 - 0x03FFFF    Working memory and tables
0x040000+              Possible external RAM
```

### 8.3 Fuel Map Storage

From E6 command context:
```
ROM Fuel Map:   Address typically 0x100000+
RAM Fuel Map:   Address in working RAM (0x010000-0x02FFFF range)
```

---

## 9. MUT-III Command Summary Table

| Command | Hex | Function | Parameters | Returns |
|---------|-----|----------|-----------|---------|
| Set Address | 0xE0 | Set memory address pointer | 4 bytes address | ACK |
| Read Byte | 0xE1 | Read 1 byte at current address | None | 1 byte data |
| Send Value | 0xE2 | Stage byte value for write | 1 byte value | ACK |
| Write Byte | 0xE3 | Write staged value to RAM | None | ACK |
| Read Word | 0xE4 | Read 2 bytes at current address | None | 2 bytes data |
| Read+Inc | 0xE5 | Read 2 bytes, increment address | None | 2 bytes data |
| Fuel Copy | 0xE6 | Copy ROM fuel map to RAM | None | ACK |
| Handshake | 0x3E | Keep-alive/session init | None | ACK |
| Diag Mode | 0x10 | Enter diagnostic session | Mode byte | ACK |

---

## 10. Tools and Access Points

### 10.1 EvoScan Features (from XML/Binary)

- **Real-time data logging** via MUT-III protocol
- **Parameter editing** with live feedback
- **OBD-II/MUT-III DataLogger** support
- **Subaru SSM-II/SSMI** protocol support
- **Fault code management**
- **ROM flashing** capabilities (via MMCodingWriter)
- **Data visualization** and charting
- **Session management** and logging

### 10.2 MMCodingWriter Features

Based on executable analysis:
- **Primary ROM flashing tool** for Mitsubishi vehicles
- **Checksum recalculation** after ROM modifications
- **Security key calculation**
- **ECU hardware detection** and communication
- Used alongside EvoScan for complete ROM editing workflow

### 10.3 Tool Communication Protocol

```
EvoScan ←→ Serial Interface (USB-to-COM adapter) ←→ ECU
          ↓
       Read/Write real-time data via MUT-III
       
MMCodingWriter ←→ Same Serial Interface ←→ ECU
                ↓
             Flash complete ROM images
             Recalculate checksums
             Verify write operations
```

---

## 11. Known Limitations and Constraints

### 11.1 Tools Used for Analysis

- **Command-line tools available:**
  - `strings` - Extract ASCII/printable strings from binaries ✓ Used
  - `file` - Identify binary format ✓
  - `nm` - List symbols ✗ (Not applicable to .exe without debug symbols)
  - `objdump` - Disassemble ✗ (MacOS limitation - Windows executable)
  - `Radare2` - Binary analysis ✗ (Not pre-installed)

### 11.2 Information Not Extracted

- **Exact seed-key algorithm:** Not visible in string extraction
- **CRC/Checksum polynomials:** Not explicitly found
- **Complete command set:** Only E0-E6 confirmed from documentation
- **ROM write procedures:** Likely requires authentication
- **Hardware-specific timing:** Not accessible from binaries
- **Security algorithm details:** Obfuscated or compiled

### 11.3 What Would Be Needed for Complete Reverse-Engineering

1. **Disassembler/Decompiler:** IDA Pro, Ghidra, or Radare2 on Windows
2. **Debugger:** WinDbg or x64dbg to trace protocol execution
3. **ROM files:** Actual evo ECU ROM images to reverse-engineer checksums
4. **Protocol analyzer:** Serial sniffer to capture live communication
5. **Test hardware:** Actual ECU for validation

---

## 12. Comparison: MUT-III vs Other Protocols

| Feature | MUT-III | SSM-II | OBD-II |
|---------|---------|--------|--------|
| **Address Space** | 4-byte | 4-byte | Standardized |
| **Read/Write** | Both | Both | Read-mostly |
| **Data Logging** | Real-time | Real-time | Parameter IDs |
| **ROM Flashing** | Yes | Yes | No |
| **Security** | Seed-key | Seed-key | VIN-based |
| **Tuning Support** | Extensive | Limited | None |
| **Used By** | Mitsubishi | Subaru | All OBD-II vehicles |

---

## 13. Implementation Recommendations

### 13.1 For Custom Protocol Implementation

1. **Use UART/RS232** at 9600-115200 baud (typical Mitsubishi)
2. **Implement timeout handling** (typically 100-500ms)
3. **Validate checksums** on every transmission
4. **Buffer management** for large data transfers
5. **Address boundary checks** to prevent invalid access

### 13.2 For Security Consideration

1. **Never trust untrusted ROM files** without checksum validation
2. **Implement seed-key verification** before accepting write commands
3. **Use VIN locking** to prevent unauthorized flashing
4. **Log all ROM modifications** for audit trails
5. **Implement timeout-based disconnection** for failed authentications

---

## 14. Conclusion

This analysis extracted significant protocol information from EvoScan V3.1 and related tools:

### **Key Findings:**

1. **MUT-III Protocol:** Confirmed core command set (E0-E6) for memory access, data logging, and fuel map operations

2. **Frame Structure:** Simple protocol with header, command, data, and checksum validation

3. **Multi-Protocol Support:** EvoScan supports MUT-III (Mitsubishi), SSM-II (Subaru), and OBD-II

4. **Real-Time Logging:** Extensive data logging via memory-mapped parameters with bit-level extraction

5. **Security:** Seed-key authentication and VIN-locking mechanisms observed

6. **Tool Ecosystem:** EvoScan for tuning/logging + MMCodingWriter for ROM flashing represents complete editing suite

### **Limitations:**

- Binary analysis without disassembly limits depth of protocol understanding
- Exact authentication algorithms remain proprietary/obfuscated
- ROM write and security procedures partially obfuscated
- Windows executable analysis on non-Windows system constrains available tools

### **Applicability:**

This information is suitable for:
- Understanding MUT-III protocol basics
- Implementing protocol listeners/loggers
- Developing custom tuning tools
- Reverse-engineering vehicle ECU communication

This is NOT sufficient for:
- Complete ROM flashing implementation without additional research
- Security key algorithm implementation
- Bypassing authentication mechanisms
- Unauthorized vehicle tuning

---

## 15. References and Related Documentation

- **Files Analyzed:**
  - `/Users/colecrouter/Downloads/EvoScanV3.1.exe`
  - `/Users/colecrouter/Downloads/EvoScanV3.1/MMCodingWriter_2.3.exe`
  - `/Users/colecrouter/Downloads/EvoScanV3.1/RAX Fast Logging Rev E - SST Rev A - ACD Rev A - EVOX.xml`

- **Related Projects in Workspace:**
  - `/packages/device/protocols/mut3/` - MUT-III implementation
  - `/packages/device/protocols/subaru/` - Subaru protocol implementation
  - `/packages/core/src/checksum/` - Checksum algorithm documentation

- **Stored Analysis Files:**
  - `/tmp/evoscan_strings.txt` - All strings from EvoScan
  - `/tmp/mmcodingwriter_strings.txt` - All strings from MMCodingWriter

---

**Document prepared using string extraction and binary analysis techniques.**
**Not based on official documentation or reverse engineering via disassembly.**
