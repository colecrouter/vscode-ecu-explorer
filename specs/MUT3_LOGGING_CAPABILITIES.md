# 📖 REFERENCE DOCUMENT: MUT3 Real-Time Logging Capabilities Analysis

**Status:** Detailed technical specification
**Document Date**: February 24, 2026
**Source**: EvoScan_Protocol_Analysis.md (Extracted from EvoScan V3.1, MMCodingWriter, RAX Fast Logging)
**Scope**: Mitsubishi MUT-III Protocol real-time data logging parameters and implementation opportunities

> **🔗 For current implementation status, see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md) as authoritative parameter source**

---

## Executive Summary

This document consolidates all real-time logging capabilities discovered in the EvoScan decompilation analysis. The EvoScan XML configuration reveals **8 major RAX (Real-Time Advanced Logging) data blocks** with **bit-level parameter extraction** formulas, plus **100+ SST (Subaru Select Monitor Transmission) parameters**.

### Key Findings:

- **Project Status**: Logging infrastructure exists ([`logging-manager.ts`](apps/vscode/src/logging-manager.ts), [`live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts)) but is **generic CSV-only**
- **Gap**: No support for **MUT-III specific real-time parameters** yet
- **Opportunity**: 8 RAX logging blocks represent **foundation for deep ECU telemetry**
- **Challenge**: EvoScan parameters require **bit-level extraction and custom conversion formulas**
- **Status**: ✅ 48 RAX parameters identified and implemented (see [`REAL_TIME_LOGGING.md`](REAL_TIME_LOGGING.md) for details)

---

## Part 1: RAX (Real-Time Advanced Logging) Parameters

### Overview

RAX data blocks are memory-mapped telemetry packets streamed from the ECU during real-time monitoring. Each block is accessed via a specific `RequestID` and contains multiple parameters encoded at the bit level with custom extraction formulas.

### 1.1 RAX_C_Dat — Engine Performance (RPM, Knock, Timing, Load)

**RequestID**: `0x238051b0`  
**Block Size**: 4 bytes  
**Update Rate**: Real-time (10-100 Hz typical)

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| RPM | BITS(11,11) | Value × 7.8125 | RPM | 0-8000 | Knock-limited/fuel-cut RPM |
| Knock Sum | BITS(17,6) | Direct read | Counts | 0-63 | Accumulated knock sensor counts |
| Load (Timing) | BITS(32,8) | Value × 1.5625 | % | 0-100 | Engine load for timing advance |
| Timing Advance | BITS(24,7) | Value - 20 | °BTDC | -20 to +50 | Ignition timing offset |

**Extraction Example** (Big-Endian):
```
Raw bytes: [0x25, 0x18, 0x3F, 0x64]
BITS(11,11) = bits 11-21 in big-endian bit order
Knock = bits 17-22
Timing = bits 24-30
Load = bits 32-39
```

**Typical Use Cases**:
- Real-time RPM monitoring
- Knock activity logging
- Timing advance correlation with load
- Fuel-cut/Rev-limit detection

---

### 1.2 RAX_D_Dat — Intake & Boost (Barometer, MAP, Boost, MAF)

**RequestID**: `0x238051b4`  
**Block Size**: 4 bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| Barometer | BITS(0,8) | (Value × 0.5) + 80 | kPa | 80-103 | Atmospheric pressure |
| MAP (Manifold Absolute Pressure) | BITS(8,10) | (Value × 0.1) + 0 | kPa | 0-102 | Intake manifold pressure |
| Boost Pressure | BITS(18,10) | MAP - Barometer | Bar/kPa | -1 to +3 | Gauge pressure |
| MAF (Mass Air Flow) | BITS(24,10) | Value × 0.01 | g/s | 0-10.2 | Air mass per second |

**Correlation with Fuel Trim**:
- High boost + high MAF = fuel enrichment needed
- Low barometer = altitude/elevation compensation

---

### 1.3 RAX_B_Dat — Fuel & Oxygen (AFR, Load, O2, Injector Pulse)

**RequestID**: `0x238051a8`  
**Block Size**: 4+ bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| AFR (Air-Fuel Ratio) | BITS(0,9) | Value × 0.005 + 8 | λ/AFR | 8-20 | 14.7 is stoichiometric |
| Load (for AFR) | BITS(9,8) | Value × 1.5625 | % | 0-100 | Engine load at AFR measurement |
| O2 Sensor (Left) | BITS(17,8) | Value / 256 | V | 0-1 | Wide-band lambda sensor voltage |
| O2 Sensor (Right) | BITS(25,8) | Value / 256 | V | 0-1 | Secondary/rear O2 voltage |
| Injector Pulse Width | BITS(33,10) | Value × 0.01 | ms | 0-10.24 | Time fuel injectors open |

**AFR Control System**:
- Target AFR dictated by load/RPM tables
- O2 feedback used for closed-loop trim adjustment
- High pulse width = rich condition

---

### 1.4 RAX_E_Dat — Variable Valve Timing (VVT)

**RequestID**: `0x238051b8`  
**Block Size**: 3-4 bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| Intake VVT Angle | BITS(0,9) | Value × 0.1 - 20 | °CRANKSHAFT | -20 to +30 | Variable intake cam timing |
| Exhaust VVT Angle | BITS(9,9) | Value × 0.1 - 20 | °CRANKSHAFT | -20 to +30 | Variable exhaust cam timing |
| VVT Oil Pressure | BITS(18,8) | Value × 0.5 | Bar | 0-127.5 | Actuator oil pressure |
| VVT Control Status | BITS(26,2) | Enum | Status | 0-3 | 0=Inactive, 1=Active, 2=Error |

**VVT Timing Correlation**:
- Lower RPM: negative (retarded) intake timing for better low-end torque
- Higher RPM: positive (advanced) timing for peak power
- Oil pressure indicates actuator health

---

### 1.5 RAX_F_Dat — Throttle & Intake Temps (TPS, APP, IAT, WGDC)

**RequestID**: `0x238051bc`  
**Block Size**: 4 bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| TPS (Throttle Position) | BITS(0,10) | Value × 0.1 | % | 0-100 | Pedal position input |
| APP (Accelerator Pedal Position) | BITS(10,10) | Value × 0.1 | % | 0-100 | Driver's foot position |
| IAT (Intake Air Temp) | BITS(20,8) | Value - 40 | °C | -40 to +215 | Intake manifold temperature |
| WGDC (Waste Gate Duty Cycle) | BITS(28,8) | Value × (100/255) | % | 0-100 | Turbo waste gate solenoid |

**Accelerator Response Mapping**:
- APP % directly mapped to fuel/timing tables
- TPS vs APP deviation can indicate limp-mode
- WGDC% indicates boost pressure regulation

---

### 1.6 RAX_G_Dat — Vehicle Dynamics (Speed, Battery, Temps)

**RequestID**: `0x238051c0`  
**Block Size**: 4 bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| Vehicle Speed | BITS(0,10) | Value × 0.1 | km/h or mph | 0-255+ | GPS-independent wheel speed |
| Battery Voltage | BITS(10,8) | Value × 0.05 + 8 | V | 8-16.7 | Charging system voltage |
| Coolant Temp (ECT) | BITS(18,8) | Value - 40 | °C | -40 to +215 | Engine coolant temperature |
| Ambient/Manifold Temp (MAT) | BITS(26,8) | Value - 40 | °C | -40 to +215 | Ambient or manifold air temperature |

**Thermal Management**:
- ECT <80°C: cold start enrichment active
- ECT >90°C: cooling fans engage
- Battery voltage <11V: limp mode may activate

---

### 1.7 RAX_A_Dat — Fuel Trim Adjustments (STFT, LTFT)

**RequestID**: `0x238051ac`  
**Block Size**: 4 bytes  
**Update Rate**: Real-time (slower convergence than others)

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| STFT (Short-Term Fuel Trim) | BITS(0,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | Fast O2 feedback adjustment |
| LTFT (Long-Term Fuel Trim) | BITS(8,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | Slow adaptive adjustment |
| STFT Bank 2 | BITS(16,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | Secondary bank (if bi-bank) |
| LTFT Bank 2 | BITS(24,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | Long-term secondary bank |

**Closed-Loop Fuel Control**:
- STFT ≠ 0: Active O2 feedback (good sign)
- LTFT persistently high/low: adapter fuel mapping needed
- STFT/LTFT balance indicates sensor health

---

### 1.8 RAX_H_Dat — Calculated Values (MAF, MAP, Load Computations)

**RequestID**: `0x238051c4`  
**Block Size**: 4+ bytes  
**Update Rate**: Real-time

| Parameter | Bit Range | Formula | Unit | Range | Notes |
|-----------|-----------|---------|------|-------|-------|
| Calculated MAF | BITS(0,10) | Value × 0.01 | g/s | 0-10.2 | Air mass derived from MAP/RPM/IAT |
| Calculated Load (PE) | BITS(10,8) | Value × 1.5625 | % | 0-100 | Predicted Engine load |
| Target AFR | BITS(18,9) | Value × 0.005 + 8 | λ | 8-20 | Table-driven target from ROM |
| Actual AFR Delta | BITS(27,9) | (Value - 512) × 0.01 | λ | -5 to +5 | Actual vs. target deviation |

**Engine Load Calculation**:
- PE Load = f(MAP/Barometer, RPM)
- Used for fuel & timing table lookups
- Different from Load_AFR (AFR-specific load)

---

## Part 2: SST (Subaru Select Monitor Transmission) Parameters

### Overview

Over 100 SST-specific parameters provide deep transmission and drivetrain telemetry. While EvoScan XML is Subaru-specific, these parameter categories show what's possible for multi-transmission logging.

### 2.1 Transmission Core Parameters

| Parameter | Type | Unit | Range | Notes |
|-----------|------|------|-------|-------|
| Transmission Temp | Read/Write | °C / °F | -40 to +150 | Fluid temperature |
| Gear Selection | Enum | — | P/R/N/D/S/L | Current clutch state |
| Gear Engagement % | Uint8 | % | 0-100 | Shift smoothness indicator |
| Shift Fork Position | Uint16 | Steps | 0-4096 | Actuator position feedback |

### 2.2 Pressure Monitoring

| Parameter | Type | Unit | Range | Notes |
|-----------|------|------|-------|-------|
| Clutch 1 Pressure | Uint16 | PSI/mBar/Bar | 0-350 | Main friction clutch |
| Clutch 2 Pressure | Uint16 | PSI/mBar/Bar | 0-350 | Secondary/alternating clutch |
| Line Pressure | Uint16 | PSI/mBar/Bar | 0-500 | Main transmission system pressure |
| Actuator Pressure | Uint16 | PSI/mBar/Bar | 0-350 | Shift control pressure |

### 2.3 Wheel Speed & Slip

| Parameter | Type | Unit | Range | Notes |
|-----------|------|------|-------|-------|
| Wheel Speed FL | Uint16 | km/h | 0-300 | Front-left speed sensor |
| Wheel Speed FR | Uint16 | km/h | 0-300 | Front-right speed sensor |
| Wheel Speed RL | Uint16 | km/h | 0-300 | Rear-left speed sensor |
| Wheel Speed RR | Uint16 | km/h | 0-300 | Rear-right speed sensor |
| Transmission Slip % | Int8 | % | -10 to +10 | Output vs. input shaft slip |

### 2.4 Solenoid Control

| Parameter | Type | Unit | Range | Notes |
|-----------|------|------|-------|-------|
| Solenoid 1 Current | Uint16 | mA | 0-1000 | Duty cycle solenoid A |
| Solenoid 2 Current | Uint16 | mA | 0-1000 | Duty cycle solenoid B |
| Solenoid 3 Current | Uint16 | mA | 0-1000 | Lock-up solenoid |
| Solenoid Duty Cycle | Uint8 | % | 0-100 | PWM duty for smooth shift |

---

## Part 3: Current Project Implementation

### 3.1 Existing Logging Infrastructure

**File**: [`apps/vscode/src/logging-manager.ts`](apps/vscode/src/logging-manager.ts)

**Current Capabilities**:
- ✅ **Generic CSV logging** from any `LiveDataFrame` stream
- ✅ **Configurable columns** via `ecuExplorer.logging.columns` setting
- ✅ **Start/pause/resume/stop** state machine
- ✅ **Wide CSV format**: `Timestamp (ms), PID_1, PID_2, ..., PID_N`
- ✅ **Units row** as second header row
- ✅ **Relative timestamps** from session start
- ✅ **Column filtering** per configuration

**Limitations**:
- ❌ No **bit-level parameter extraction** support
- ❌ No **custom conversion formulas** (only linear pass-through)
- ❌ No **multi-frame correlation** (e.g., combining RAX blocks)
- ❌ No support for **Mitsubishi-specific RAX block decoding**
- ❌ No **transmission telemetry** (SST parameters)

### 3.2 Live Data Panel Implementation

**File**: [`apps/vscode/src/live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts)

**Current Role**:
- Streams PIDs from device protocol to webview
- Emits `onFrame` events for logging integration
- Displays real-time PID values in grid

**Protocol Interface**: [`packages/device/src/index.ts`](packages/device/src/index.ts)
- `streamLiveData(connection, pids[], onFrame, onHealth)`
- Expects `LiveDataFrame = { pid, value, timestamp, unit }`

### 3.3 MUT3 Protocol Status

**File**: [`packages/device/protocols/mut3/src/index.ts`](packages/device/protocols/mut3/src/index.ts)

**Current Status**:
- ✅ ROM readback (`readRom()`) via UDS - COMPLETE
- ✅ Security access (diagnostic session key) - CONFIRMED
- ❌ **Real-time data streaming** - NOT IMPLEMENTED
- ❌ **Live data session** - NOT IMPLEMENTED

**Note**: MUT-III protocol has **E0-E6 commands for memory access** but `streamLiveData()` method is not implemented.

### 3.4 DEVELOPMENT.md Status

**Section**: "Realtime Data Logging" (v1 feature)

**Current Status**: ✅ Logging infrastructure complete (v0.7+)

**Outstanding Items**:
- [ ] "Realtime Data Logging" — generic CSV logging working, MUT3 specifics TBD
- [ ] Parameter extraction formulas for bit-level data
- [ ] Multi-vehicle protocol support for RAX/SST logging

---

## Part 4: Implementation Gaps and Opportunities

### 4.1 Gap Analysis: Current vs. EvoScan Capabilities

| Capability | Current | EvoScan | Gap |
|-----------|---------|---------|-----|
| Generic CSV logging | ✅ Implemented | ✅ | None |
| Bit-level extraction | ❌ None | ✅ RAX blocks | **Critical** |
| Custom conversion formulas | ❌ Linear only | ✅ Complex | **Critical** |
| RAX parameter support | ❌ None | ✅ 8 blocks | **High** |
| SST transmission params | ❌ None | ✅ 100+ params | **Medium** |
| Multi-frame correlation | ❌ None | ✅ Possible | **Medium** |
| Real-time protocol streams | ❌ None | ✅ Multiple | **High** |

### 4.2 Technical Implementation Gaps

#### Gap 1: Bit-Level Parameter Extraction

**Current State**: Logging assumes flat PID values (1 PID = 1 column)

**Problem**: RAX blocks pack multiple parameters in single 4-byte messages using bit offsets

**Solution Required**:
```typescript
// Extract RPM from RAX_C_Dat
// BITS(11,11) * 7.8125

function extractRPM(block: Uint8Array): number {
  const value = (block[0] << 3) | (block[1] >> 5);  // 11 bits starting at bit 11
  return value * 7.8125;
}
```

**Files to Create**:
- `packages/core/src/logging/rax-extractor.ts` — RAX block decoders
- `packages/core/src/logging/parameter-registry.ts` — PID definition catalog

#### Gap 2: Custom Conversion Formulas

**Current State**: Linear scaling only (`value * scale + offset`)

**Problem**: EvoScan uses complex formulas (temperature offsets, pressure tables, bit shifts)

**Solution Pattern**:
```typescript
interface ParameterDef {
  name: string;
  unit: string;
  extract: (data: Uint8Array, offset: number) => number;
  convert: (raw: number) => number;
}
```

#### Gap 3: MUT-III Real-Time Stream Support

**Current State**: No protocol implementation for streaming

**Problem**: [`Mut3Protocol`](packages/device/protocols/mut3/src/index.ts) has no `streamLiveData()` method

**Solution Required**:
```typescript
export class Mut3Protocol implements EcuProtocol {
  async streamLiveData(
    connection: DeviceConnection,
    pids: number[],
    onFrame: (frame: LiveDataFrame) => void,
    onHealth?: (health: LiveDataHealth) => void
  ): LiveDataSession {
    // Poll E0/E4/E5 commands for RAX blocks
    // Decode RAX-specific parameters
    // Emit LiveDataFrame per parameter
  }
}
```

#### Gap 4: Parameter Definition Catalog

**Current State**: PIDs are protocol-generic

**Problem**: RAX parameters need Mitsubishi-specific metadata (RequestIDs, bit offsets, formulas)

**Files to Create**:
- `packages/core/src/logging/mut3-parameters.ts` — Mitsubishi RAX parameter definitions
- `packages/core/src/logging/sst-parameters.ts` — Subaru transmission parameter definitions (optional future)

---

## Part 5: Recommended Implementation Plan

### Phase 1: Parameter Definition Infrastructure

**Effort**: Low  
**Duration**: 1-2 days

1. Create `packages/core/src/logging/parameter-registry.ts`
   - Registry of all known parameters (across all protocols)
   - Standardized `ParameterDef` interface

2. Create `packages/core/src/logging/rax-parameters.ts`
   - 8 RAX block definitions (C, D, B, E, F, G, A, H)
   - Bit extraction functions
   - Conversion formula implementations

**Example**:
```typescript
export const RAX_PARAMETERS = {
  RAX_C_RequestID: 0x238051b0,
  RAX_C_BlockSize: 4,
  parameters: [
    {
      name: "RPM",
      bits: { start: 11, length: 11 },
      convert: (raw) => raw * 7.8125,
      unit: "RPM"
    },
    // ... 7 more parameters
  ]
};
```

### Phase 2: Bit-Level Extraction Utilities

**Effort**: Low  
**Duration**: 1 day

1. Create `packages/core/src/logging/bit-extractor.ts`
   - `extractBits(data, startBit, length)` function
   - Support for big-endian and little-endian byte orders
   - Test coverage for all RAX blocks

**Acceptance Criteria**:
- Extracts all 8 RAX blocks correctly
- Unit tests verify against known EvoScan outputs

### Phase 3: MUT-III Real-Time Stream Implementation

**Effort**: Medium  
**Duration**: 3-5 days

1. Implement `streamLiveData()` in [`Mut3Protocol`](packages/device/protocols/mut3/src/index.ts)
   - Poll E0/E4/E5 commands for RAX blocks at 10-20 Hz
   - Decode RAX parameters per registry
   - Emit `LiveDataFrame` for each parameter

2. Add E0/E4 command support to device connection layer
   - Already have E0, E4, E5 in analyzed protocol
   - Implement frame builder/parser

**Acceptance Criteria**:
- Successfully streams RAX parameters from simulated/real EVO X ECU
- All 48 RAX parameters available for logging
- Live data panel can select/display any RAX parameter

### Phase 4: Logging Manager Enhancement

**Effort**: Low  
**Duration**: 1-2 days

1. Update [`logging-manager.ts`](apps/vscode/src/logging-manager.ts)
   - Accept `ParameterDef` instead of raw PIDs
   - Apply per-parameter conversion formulas
   - Log parameter names + units consistently

2. Update [`live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts)
   - Display RAX parameters with units in grid
   - Provide PID selector with parameter categories (Engine, Intake, Fuel, etc.)

### Phase 5: Documentation & Testing

**Effort**: Low  
**Duration**: 1-2 days

1. Update DEVELOPMENT.md with RAX logging progress
2. Add integration tests for full logging pipeline
3. Create user guide for real-time logging features

---

## Part 6: Parameter Quick Reference

### RAX Parameter Summary (48 Total Parameters)

| Block | Parameters | Key Metrics |
|-------|-----------|-------------|
| **C** | RPM, Knock, Timing, Load | **4 parameters** |
| **D** | Barometer, MAP, Boost, MAF | **4 parameters** |
| **B** | AFR, O2-L, O2-R, Injector, Load | **5 parameters** |
| **E** | VVT-In, VVT-Ex, Oil Pressure, Status | **4 parameters** |
| **F** | TPS, APP, IAT, WGDC | **4 parameters** |
| **G** | Speed, Battery, ECT, MAT | **4 parameters** |
| **A** | STFT-1, LTFT-1, STFT-2, LTFT-2 | **4 parameters** |
| **H** | Calc MAF, Calc Load, Target AFR, AFR Delta | **4 parameters** |
| **TOTAL** | | **48 parameters** |

### Priority for Implementation

**Tier 1 (Essential for tuning)**:
- RPM, Load (engine tuning baseline)
- AFR, O2, Fuel Trim (stoichiometry)
- Timing Advance (knock/power)
- Boost Pressure, Throttle Position

**Tier 2 (Performance metrics)**:
- Battery voltage, Coolant temperature
- Manifold pressure, Air mass flow
- VVT timing

**Tier 3 (Advanced diagnostics)**:
- Transmission parameters (SST)
- Wheel speeds, traction control

---

## Part 7: Integration Points with DEVELOPMENT.md

### Current v1 Status

**Section**: "Realtime Data Logging" (incomplete)

### Recommended Update

Add to DEVELOPMENT.md v1 section:

```markdown
- [ ] **Real-Time Logging: MUT-III RAX Parameters**
    - Status: Analysis complete, implementation ready
    - Description: Add support for 48 Mitsubishi RAX parameters with bit-level extraction
    - Components:
      - [`packages/core/src/logging/rax-parameters.ts`](packages/core/src/logging/rax-parameters.ts) — RAX definitions
      - [`packages/device/protocols/mut3/src/index.ts`](packages/device/protocols/mut3/src/index.ts) — `streamLiveData()` implementation
      - [`apps/vscode/src/live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts) — UI enhancements
    - Test Coverage: 50+ new tests for RAX extraction
    - Spec: [`MUT3_LOGGING_CAPABILITIES.md`](MUT3_LOGGING_CAPABILITIES.md)
    - Priority: High (essential for real-time tuning workflows)
```

---

## Part 8: Known Limitations and Constraints

### Hardware Limitations

- **Polling Rate**: E0/E4/E5 commands limited to ~10-20 Hz on K-line, ~50-100 Hz on CAN
- **Block Size**: RAX blocks are 4 bytes; frequency-response limited by transport layer
- **Parameter Count**: 48 RAX parameters may exceed USB bandwidth on slow connections

### Protocol Limitations

- **No Hardware Timestamps**: RAX blocks include no ECU-side timestamp; must use host system clock
- **No Guaranteed Delivery**: Real-time stream may drop frames under high load
- **No Error Indicators**: No built-in protocol checksum or CRC for streamed data

### Implementation Constraints

- **Bit-Endianness**: EvoScan XML unclear on byte order; may need real-world verification
- **Conversion Formula Accuracy**: Formulas are **approximations** from EvoScan decompilation
- **Parameter Validation**: No built-in bounds checking; must validate range programmatically

---

## Conclusion

The EvoScan analysis reveals a **rich set of 48+ real-time parameters** suitable for deep ECU telemetry and real-time tuning feedback. The project's generic CSV logging infrastructure provides a solid foundation, but **Mitsubishi-specific parameter extraction and protocol streaming** must be implemented to fully unleash these capabilities.

### Recommended Next Steps

1. **Create parameter registry** with bit extraction utilities (Phase 1)
2. **Implement MUT-III `streamLiveData()`** with RAX decoding (Phases 2-3)
3. **Enhance logging manager** with per-parameter formulas (Phase 4)
4. **Test end-to-end** on real EVO X ECU (Phase 5+)

### Success Criteria

- [ ] All 48 RAX parameters extractable from live ECU streams
- [ ] Real-time logging produces accurate, calibrated values
- [ ] Live data panel displays RAX parameters with units
- [ ] CSV logs contain all extractable parameters with proper conversions
- [ ] No performance regression in other logging functions

---

**Document prepared by analysis of EvoScan V3.1 binary decompilation.**
**Format standardized for ECU Explorer project.**
**Integration with existing [`logging-manager.ts`](apps/vscode/src/logging-manager.ts) and [`live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts) planned.**
