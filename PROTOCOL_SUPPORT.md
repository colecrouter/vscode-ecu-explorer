# Protocol Support Matrix

Comprehensive reference for vehicle support, protocol capabilities, and parameter availability across ECU Explorer.

**Quick Links**: [Mitsubishi](#mitsubishi) | [Subaru](#subaru) | [Nissan](#nissan) | [OBD-II](#obd-ii-generic)

---

## Protocol Support Overview

| Make/Model | Protocol | ROM Read | ROM Write | Real-Time Data | Transport | Notes |
|------------|----------|----------|-----------|-----------------|-----------|-------|
| **Mitsubishi EVO X 4B11T** | MUT-III (UDS) | ✅ | ❌* | ⏳ | CAN 500kbps | Bootloader method works for write |
| **Mitsubishi EVO X 4B11T** | Bootloader | ✅ | ✅ | ❌ | CAN 500kbps | **Recommended for ROM write** |
| **Subaru WRX/STI/Forester** | KWP2000 | ✅ | ✅ | ⏳** | CAN 500kbps | Real-time logging awaits K-line |
| **Nissan (older ECUs)** | NCS K-line | ❌ | ❌ | ❌ | K-line (planned) | Checksums implemented; protocols pending |
| **Nissan (modern CAN)** | NCS CAN | ❌ | ❌ | ❌ | CAN (future) | Checksums implemented; protocols pending |
| **Any OBD-II Vehicle** | ISO 14229-1 | ❌ | ❌ | ✅ | CAN 500kbps | 8 standard PIDs only |

**Legend**: ✅ = Complete, ⏳ = In Progress, ❌ = Not Implemented, ❌* = Blocked on security key, ❌** = Requires K-line hardware

---

## Mitsubishi

### EVO X (4B11T) – MUT-III Protocol (UDS over CAN)

**CPU**: Renesas M32186F8  
**ROM Size**: 1 MB (1,048,576 bytes)  
**CAN IDs**: 0x7E0 (request), 0x7E8 (response)  
**Baud**: 500 kbps (ISO 15765-4)  
**Transport**: OpenPort 2.0 (USB WebUSB)

#### ROM Operations

| Operation | Status | Details |
|-----------|--------|---------|
| **Read ROM** | ✅ Complete | UDS 0x23 (ReadMemoryByAddress) with 0x80-byte blocks |
| **Write ROM** | ❌ Blocked* | UDS 0x34 (RequestDownload) requires write-session security key (algorithm unknown) |
| **Security Access** | ✅ Partial | Diagnostic session key: `(seed * 0x4081 + 0x1234) & 0xFFFF` ✅ Write session key: ❌ Unknown |
| **Checksum Update** | ✅ Complete | Mitsucan ROM checksum automatically recomputed on save |
| **Sector Erase** | ✅ Simulated | Diff-based: only changed sectors erased via bootloader alternative |

**See also**: [`packages/device/protocols/mut3/src/index.ts`](packages/device/protocols/mut3/src/index.ts)

#### Real-Time Parameters (RAX Blocks)

**Status**: ⏳ Infrastructure complete; streaming awaits K-line implementation

**Available Parameters**: 48 across 8 blocks

| Block | RequestID | Parameters | Example PIDs |
|-------|-----------|------------|--------------|
| **RAX_C** | 0x238051b0 | 4 | RPM (0.5), Knock Sum (1), Timing Adv. (2), Load (3) |
| **RAX_D** | 0x238051b4 | 4 | Barometer (4), MAP (5), Boost (6), MAF (7) |
| **RAX_B** | 0x238051a8 | 5 | AFR (8), O2-Left (9), O2-Right (10), Inj. Pulse (11), Load-AFR (12) |
| **RAX_E** | 0x238051b8 | 4 | VVT-In (13), VVT-Ex (14), Oil Press. (15), VVT Status (16) |
| **RAX_F** | 0x238051bc | 4 | TPS (17), APP (18), IAT (19), WGDC (20) |
| **RAX_G** | 0x238051c0 | 4 | Speed (21), Battery (22), ECT (23), MAT (24) |
| **RAX_A** | 0x238051ac | 4 | STFT-1 (25), LTFT-1 (26), STFT-2 (27), LTFT-2 (28) |
| **RAX_H** | 0x238051c4 | 4 | Calc. MAF (29), Calc. Load (30), Target AFR (31), AFR Delta (32) |

**Full parameter details**: See [`MUT3_LOGGING_CAPABILITIES.md`](MUT3_LOGGING_CAPABILITIES.md)

---

### EVO X (4B11T) – Bootloader Method (7-Byte Framing)

**Status**: ✅ **Recommended for ROM write**

**CPU**: Renesas M32186F8  
**ROM Size**: 1 MB  
**CAN IDs**: 0x7E0 (request), 0x7E8 (response)  
**Baud**: 500 kbps (ISO 15765-4)  
**Transport**: OpenPort 2.0 (USB WebUSB)  
**Flash Memory**: 64 KB sectors

#### ROM Operations

| Operation | Status | Details |
|-----------|--------|---------|
| **Read ROM** | ✅ Complete | CMD 0x31 with sequential block reads |
| **Write ROM** | ✅ Complete | CMD 0x20 (erase), 0x40 (write), 0x50 (verify) per sector |
| **Security Access** | ✅ Complete | Bootloader handshake: 0x55 → 0xAA → CHA_B challenge |
| **Checksum Update** | ✅ Complete | Mitsucan ROM checksum recomputed before write |
| **Sector Erase** | ✅ Complete | Full sector-by-sector erase with progress reporting |

**See also**: [`packages/device/protocols/mitsubishi-bootloader/src/index.ts`](packages/device/protocols/mitsubishi-bootloader/src/index.ts)

#### Parameter Support

- ❌ Real-time data: Not available via bootloader (ROM-only access)
- ✅ ROM calibration tables: Full read/write support

---

## Subaru

### WRX/STI/Forester – KWP2000 Protocol (CAN)

**CPU**: Denso SH7058  
**ROM Size**: 1 MB (1,048,576 bytes)  
**CAN IDs**: 0x7E0 (request), 0x7E8 (response)  
**Baud**: 500 kbps  
**Transport**: OpenPort 2.0 (USB WebUSB)

#### ROM Operations

| Operation | Status | Details |
|-----------|--------|---------|
| **Read ROM** | ✅ Complete | KWP2000 0x22 (ReadDataByAddress) with S-box seed-key |
| **Write ROM** | ✅ Complete | KWP2000 0x34 (RequestDownload) + 0x36 (TransferData) + 0x37 (RequestTransferExit) |
| **Security Access** | ✅ Complete | S-box nibble-swap algorithm for seed → key transformation |
| **Checksum Update** | ✅ Complete | Subaru/Denso magic constant 0x5AA5A55A checksum |
| **Sector Erase** | ✅ Complete | Diff-based: only changed sectors erased |

**See also**: 
- [`packages/device/protocols/subaru/src/index.ts`](packages/device/protocols/subaru/src/index.ts)
- [`packages/device/protocols/subaru/src/security.ts`](packages/device/protocols/subaru/src/security.ts)
- [`HANDSHAKE_ANALYSIS.md`](HANDSHAKE_ANALYSIS.md) § 4 – Security algorithm analysis

#### Real-Time Parameters (SSM-II + SST)

**Status**: ⏳ Parameter registry complete (Phase 3); streaming awaits K-line transport

**Available Parameters**: 100+ transmission-focused

| Category | Parameters | Example PIDs | Notes |
|----------|-----------|--------------|-------|
| **Transmission Core** | 4 | Temp, Gear, Engagement, Fork Pos | DTC-relevant |
| **Pressures** | 4+ | Clutch 1/2, Line, Actuator | Shift quality feedback |
| **Wheel Speed & Slip** | 5 | Speed FL/FR/RL/RR + Transmission Slip | Traction control integration |
| **Solenoid Control** | 3 | Solenoid 1/2/3 current, PWM Duty | Real-time control validation |
| **VIN/Security** | 3 | VIN lock state, ECU behavior, write counter | Security features |

**Full SST parameter details**: See [`SUBARU_EVOSCAN_FINDINGS.md`](SUBARU_EVOSCAN_FINDINGS.md) § 4

#### Transport Note

- ✅ CAN (KWP2000) — ROM operations
- ⏳ K-Line (SSM-II) — Real-time logging (hardware testing in progress)

**Real-time logging blocker**: K-line transport layer not yet implemented in device layer

---

## Nissan

### Older ECUs – NCS K-Line Protocol

**Status**: ❌ Not Started  
**Priority**: Medium (community demand)

#### Implemented Checksum Algorithms

| Algorithm | Type | Status |
|-----------|------|--------|
| **nissan-std** | ROM checksum | ✅ Complete |
| **nissan-alt** | ROM checksum alt | ✅ Complete |
| **nissan-alt2** | Extended ROM checksum | ✅ Complete |
| **ncsChecksum** | K-line byte sum | ✅ Complete |
| **ncsCrc16** | CRC-16/IBM-SDLC | ✅ Complete |

**See also**: [`NISSAN_CHECKSUM_ANALYSIS.md`](NISSAN_CHECKSUM_ANALYSIS.md)

#### Blockers

- ❌ K-line transport not implemented
- ❌ NCS protocol layer not implemented
- ❌ Seed-key algorithm unknown

#### Implementation Path

1. Implement K-line transport abstraction (shared with Subaru)
2. Implement NCS protocol layer (ROM read/write)
3. Add parameter registry if real-time logging desired

---

## OBD-II (Generic)

### Any OBD-II Vehicle – ISO 14229-1 Protocol (CAN)

**Status**: ✅ Real-time logging ready

**ROM Support**: ❌ Not implemented (OBD-II standard omits ROM access)  
**Real-Time Data**: ✅ 8 standard PIDs  
**CAN IDs**: 0x7DF (broadcast request), 0x7E8+ (response)  
**Baud**: 500 kbps  
**Transport**: OpenPort 2.0 (USB WebUSB)

#### Real-Time Parameters

| PID | Parameter | Unit | Range | Notes |
|-----|-----------|------|-------|-------|
| **0x0C** | RPM | RPM | 0-8000 | Engine speed |
| **0x0D** | Speed | km/h | 0-255 | Vehicle speed |
| **0x04** | Load | % | 0-100 | Engine load |
| **0x05** | ECT | °C | -40-215 | Coolant temperature |
| **0x0F** | IAT | °C | -40-215 | Intake air temperature |
| **0x0B** | MAP | kPa | 0-255 | Manifold absolute pressure |
| **0x10** | MAF | g/s | 0-655 | Mass air flow |
| **0x11** | TPS | % | 0-100 | Throttle position |

**See also**: [`packages/device/protocols/obd2/src/index.ts`](packages/device/protocols/obd2/src/index.ts)

---

## Transport Layers & Hardware

See **[TRANSPORT_LAYERS.md](TRANSPORT_LAYERS.md)** for detailed hardware specifications and transport abstractions.

| Transport | Hardware | Baud/Speed | Protocols | Status |
|-----------|----------|-----------|-----------|--------|
| **CAN (ISO 15765-4)** | OpenPort 2.0 | 500 kbps | UDS, KWP2000, OBD-II | ✅ Complete |
| **K-Line (ISO 14230)** | OpenPort 2.0 (mode toggle) | 10.4 kbaud | SSM, MUT-III*, NCS | ⏳ Phase 2 |
| **Serial/UART** | USB-to-serial adapter | 9600+ | Future | ❌ Planned v2.x |

*MUT-III can also work over K-line for real-time logging (E0/E5 commands) but requires hardware switch from CAN mode.

---

## Checksum Support Matrix

| Manufacturer | Algorithm | ROM Type | Packet Type | Status | Validation |
|--------------|-----------|----------|-------------|--------|------------|
| Mitsubishi Bootloader | `mitsucan` | ROM checksum | — | ✅ Complete | 127+ unit tests |
| Mitsubishi MUT-III | `mitsucan` | ROM checksum | — | ✅ Complete | Reuses bootloader |
| Subaru/Denso | `subarudenso` | ROM checksum | — | ✅ Complete | 89+ unit tests |
| Subaru K-Line | `ssmChecksum` | — | Packet frame | ✅ Complete | 8+ unit tests |
| Nissan Standard | `nissan-std` | ROM checksum | — | ✅ Complete | 20+ unit tests |
| Nissan Alternative | `nissan-alt` | ROM checksum | — | ✅ Complete | 15+ unit tests |
| Nissan Extended | `nissan-alt2` | ROM checksum | — | ✅ Complete | 15+ unit tests |
| Nissan K-Line | `ncsChecksum` | — | Packet frame | ✅ Complete | 5+ unit tests |
| Nissan Data | `ncsCrc16` | — | Data block | ✅ Complete | 5+ unit tests |

**See also**: [`packages/core/src/checksum/algorithms.ts`](packages/core/src/checksum/algorithms.ts)

---

## Real-Time Logging Status

| Platform | Infrastructure | Parameter Registry | Streaming | Status |
|----------|-----------------|-------------------|-----------|--------|
| **MUT-III (Mitsubishi)** | ✅ CSV logging | ✅ 48 RAX params | ⏳ K-line ready | 25% complete |
| **Subaru SST (Transmission)** | ✅ CSV logging | ✅ 100+ params | ⏳ K-line ready | 20% complete |
| **OBD-II** | ✅ CSV logging | ✅ 8 PIDs (CAN) | ✅ Streaming ready | 100% complete |

**See also**: [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md)

---

## Implementation Priority

### Tier 1 (Current Focus)

1. ✅ **Mitsubishi ROM Read/Write** — Complete (both UDS and Bootloader)
2. ✅ **Subaru ROM Read/Write** — Complete (KWP2000)
3. ✅ **OBD-II Real-Time Logging** — Complete (8 PIDs)
4. ⏳ **K-Line Transport** — Phase 3 testing underway

### Tier 2 (Next Quarter)

5. ⏳ **MUT-III Real-Time Logging** — 48 RAX parameters (awaits K-line)
6. ⏳ **Subaru Real-Time Logging** — 100+ SST parameters (awaits K-line)
7. ❌ **Nissan Protocol** — Checksum done; protocol awaits K-line

### Tier 3 (Future)

8. ❌ **TunerPro Provider** — Architecture ready; implementation needed
9. ❌ **WinOLS Provider** — Architecture ready; implementation needed
10. ❌ **VIN Lock Protection** — SST parameters available; security policy pending

---

## Known Limitations

### Mitsubishi EVO X (MUT-III)

- ❌ **ROM Write Blocked**: Write-session security key algorithm unknown
  - **Workaround**: Use Bootloader method (0x55 handshake)
  - **Progress**: See [`MITSUCAN_WRITE_RESEARCH_PLAN.md`](MITSUCAN_WRITE_RESEARCH_PLAN.md)

- ⏳ **Real-Time Logging**: Requires K-line transport (CAN only for now)
  - **Status**: Infrastructure ready; awaiting K-line hardware testing

### Subaru WRX/STI

- ⏳ **Real-Time Logging**: Requires K-line transport (CAN only for now)
  - **Status**: SST parameter registry complete; awaiting K-line streaming

- ❌ **K-Line Hardware**: OpenPort 2.0 K-line mode not yet tested in project
  - **Path**: Verify K-line init sequence; toggle transport mode

### Nissan

- ❌ **Checksum Algorithms**: 5 algorithms implemented ✅
- ❌ **Protocol Layer**: Not implemented yet
- ❌ **K-Line Transport**: Shared blocker with Subaru; awaits implementation

### OBD-II

- ✅ **Standard PIDs**: 8 supported (RPM, speed, temps, pressures, etc.)
- ❌ **Manufacturer Extensions**: Not supported (proprietary PIDs beyond 0x00-0xFF)
- ❌ **ROM Access**: OBD-II standard doesn't allow ROM read/write

---

## Device Support

### Tactrix OpenPort 2.0

**Status**: ✅ Fully Supported

| Feature | Status | Details |
|---------|--------|---------|
| **USB Interface** | ✅ | WebUSB (vendor ID 0x0403, product ID 0xcc4d) |
| **CAN Mode** | ✅ | 500 kbps ISO 15765-4, fully tested |
| **K-Line Mode** | ⏳ | 10.4 kbaud; initialization sequence under review |
| **Serial Upgrade** | ❌ | Not supported (v2.x feature) |

**See also**: [`TRANSPORT_LAYERS.md`](TRANSPORT_LAYERS.md) § CAN Transport

### Other Adapters

- ❌ **Elm327 (OBD-II only)**: Not planned (no ROM access)
- ❌ **Serial/USB Direct**: Planned for v2.x
- ⏳ **Libusb**: Planned for K-line standalone support

---

## Cross-References

- **["Recent Additions" in README](README.md#recent-additions-v1x)** — What's new this release
- **[REAL_TIME_LOGGING.md](REAL_TIME_LOGGING.md)** — Detailed parameter catalogs (48 MUT-III, 100+ Subaru)
- **[TRANSPORT_LAYERS.md](TRANSPORT_LAYERS.md)** — Hardware and protocol abstraction layers
- **[FEATURES.md](FEATURES.md)** — Feature comparison matrix (optional)
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — Full roadmap and progress tracking
- **[KNOWN_ISSUES.md](KNOWN_ISSUES.md)** — Detailed limitations and workarounds

---

**Last Updated**: February 24, 2026  
**Document Version**: 1.x  
**Focus**: Vehicles actively supported or in active development
