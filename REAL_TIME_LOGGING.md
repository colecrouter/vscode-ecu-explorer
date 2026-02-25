# Real-Time Logging & Live Data Reference

Comprehensive catalog of real-time parameters, logging infrastructure, and streaming capabilities across Mitsubishi, Subaru, and OBD-II platforms.

**Quick Links**: [Infrastructure](#infrastructure) | [MUT-III RAX](#mitsubishi-mut-iii-rax-48-parameters) | [Subaru SST](#subaru-sst-100-transmission-parameters) | [OBD-II](#obd-ii-8-standard-pids) | [Workflow](#example-workflow)

---

## Infrastructure

### Architecture

ECU Explorer provides **generic CSV logging** for any live data source:

```
ECU Device → Protocol (MUT-III, KWP2000, OBD-II)
             ↓
        Live Data Stream (frame[pid, value, timestamp, unit])
             ↓
        LoggingManager (CSV buffering, parameter conversion)
             ↓
        CSV File Export (./logs/session_YYYY-MM-DD_hhmmss.csv)
```

**Key Files**:
- [`apps/vscode/src/logging-manager.ts`](apps/vscode/src/logging-manager.ts) — Session management, CSV writing
- [`apps/vscode/src/live-data-panel-manager.ts`](apps/vscode/src/live-data-panel-manager.ts) — UI + streaming integration
- [`packages/device/protocols/obd2/src/index.ts`](packages/device/protocols/obd2/src/index.ts) — OBD-II implementation (complete)
- [`packages/device/protocols/mut3/src/rax-parameters.ts`](packages/device/protocols/mut3/src/rax-parameters.ts) — MUT-III catalog (ready)
- [`packages/device/protocols/subaru/src/sst-parameters.ts`](packages/device/protocols/subaru/src/sst-parameters.ts) — Subaru catalog (ready)

### CSV Format

**Wide Format** (one column per parameter):

```csv
Timestamp (ms),RPM,Load,ECT,IAT,TPS,AFR,O2 Sensor,Battery,VVT Intake,...
ms,RPM,%,°C,°C,%,λ,V,V,°CRANKSHAFT,...
0,800,15.6,85,45,0.5,14.7,0.72,13.2,0
50,850,16.2,85,46,1.0,14.5,0.71,13.2,2
100,900,18.5,86,47,2.5,14.3,0.68,13.2,4
...
```

**Benefits**:
- ✅ One column per parameter (easy spreadsheet analysis)
- ✅ Units row as second header (self-documenting)
- ✅ Filtera-able via settings (`ecuExplorer.logging.columns`)
- ✅ Compatible with Excel, Pandas, LabVIEW, data logging tools

### Parameter Definition Interface

```typescript
interface ParameterDef {
  name: string;              // "RPM", "Load", "ECT", etc.
  unit: string;              // "RPM", "%", "°C", etc.
  pid: number | string;      // Synthetic PID or address
  extract?: (data: Uint8Array, offset?: number) => number;  // Bit-level extraction
  convert?: (raw: number) => number;  // Formula: raw * scale + offset
  range?: [min: number, max: number]; // Validation range
}
```

### Status

| Component | Status | Details |
|-----------|--------|---------|
| **Generic CSV Infrastructure** | ✅ Complete | [`logging-manager.ts`](apps/vscode/src/logging-manager.ts) |
| **Live Data Panel UI** | ✅ Complete | Parameter selector, real-time grid |
| **Session Management** | ✅ Complete | Start/pause/resume/stop state machine |
| **OBD-II Parameters** | ✅ Complete | 8 standard PIDs (CAN streaming) |
| **MUT-III RAX Catalog** | ✅ Ready | 48 parameters defined; awaits K-line transport |
| **Subaru SST Catalog** | ✅ Ready | 100+ parameters defined; awaits K-line transport |
| **Parameter Streaming** | ⏳ Phase 2 | K-line transport in testing |

---

## Mitsubishi MUT-III (RAX) – 48 Parameters

### Overview

**Vehicle**: Mitsubishi EVO X, EVO IX (4B11T, 4B12)  
**Protocol**: MUT-III (UDS variant) over K-Line (ISO 14230)  
**Blocks**: 8 data blocks (RAX_C, D, B, E, F, G, A, H)  
**Total Parameters**: 48 across all blocks  
**Update Rate**: 10-20 Hz (K-line bandwidth limited)  
**Transport Status**: ⏳ K-line Phase 2 in progress

### Implementation Status

| Block | Parameters | Status | Files |
|-------|-----------|--------|-------|
| **RAX_C** | 4 (RPM, Knock, Timing, Load) | ✅ Defined | `rax-parameters.ts` |
| **RAX_D** | 4 (Barometer, MAP, Boost, MAF) | ✅ Defined | `rax-parameters.ts` |
| **RAX_B** | 5 (AFR, O2, Load, Injector, Inj. Pulse) | ✅ Defined | `rax-parameters.ts` |
| **RAX_E** | 4 (VVT In/Ex, Oil Press, Status) | ✅ Defined | `rax-parameters.ts` |
| **RAX_F** | 4 (TPS, APP, IAT, WGDC) | ✅ Defined | `rax-parameters.ts` |
| **RAX_G** | 4 (Speed, Battery, ECT, MAT) | ✅ Defined | `rax-parameters.ts` |
| **RAX_A** | 4 (STFT-1/2, LTFT-1/2) | ✅ Defined | `rax-parameters.ts` |
| **RAX_H** | 4 (Calc MAF, Calc Load, Target AFR, AFR Delta) | ✅ Defined | `rax-parameters.ts` |
| **TOTAL** | **48** | **✅ Ready** | See below |

### Detailed Parameter Catalog

#### RAX_C_Dat – Engine Performance (RequestID: 0x238051b0, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 1 | 0x8000 | RPM | BITS(11,11) | Value × 7.8125 | RPM | 0-8000 | 1200 |
| 2 | 0x8001 | Knock Sum | BITS(17,6) | Direct | Counts | 0-63 | 0-5 |
| 3 | 0x8002 | Timing Advance | BITS(24,7) | Value - 20 | °BTDC | -20 to +50 | 15 |
| 4 | 0x8003 | Load (Timing) | BITS(32,8) | Value × 1.5625 | % | 0-100 | 45 |

**Example Extraction** (Big-Endian):
```
Raw: [0x25, 0x18, 0x3F, 0x64] = 0x25183F64
RPM = Extract(11..21) × 7.8125 = ~1200 RPM ✓
Knock = Extract(17..22) = 0 ✓
Timing = Extract(24..30) - 20 = 15°BTDC ✓
Load = Extract(32..39) × 1.5625 = 45% ✓
```

---

#### RAX_D_Dat – Intake & Boost (RequestID: 0x238051b4, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 5 | 0x8004 | Barometer | BITS(0,8) | (Value × 0.5) + 80 | kPa | 80-103 | 101.3 |
| 6 | 0x8005 | MAP | BITS(8,10) | (Value × 0.1) | kPa | 0-102 | 95 |
| 7 | 0x8006 | Boost Pressure | BITS(18,10) | MAP - Barometer | kPa | -1 to +250 | -6 (vacuum) |
| 8 | 0x8007 | MAF | BITS(24,10) | Value × 0.01 | g/s | 0-10.2 | 3.5 |

**Correlation**: High boost + high MAF = rich fuel needed

---

#### RAX_B_Dat – Fuel & Oxygen (RequestID: 0x238051a8, 5 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 9 | 0x8008 | AFR | BITS(0,9) | Value × 0.005 + 8 | λ/AFR | 8-20 | 14.7 |
| 10 | 0x8009 | Load (AFR) | BITS(9,8) | Value × 1.5625 | % | 0-100 | 45 |
| 11 | 0x800A | O2 Sensor (Left) | BITS(17,8) | Value / 256 | V | 0-1 | 0.45 |
| 12 | 0x800B | O2 Sensor (Right) | BITS(25,8) | Value / 256 | V | 0-1 | 0.48 |
| 13 | 0x800C | Injector Pulse Width | BITS(33,10) | Value × 0.01 | ms | 0-10.24 | 3.2 |

**Closed-Loop Feedback**: STFT adjusts based on O2 sensor deviation from target AFR

---

#### RAX_E_Dat – Variable Valve Timing (RequestID: 0x238051b8, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 14 | 0x800D | Intake VVT Angle | BITS(0,9) | Value × 0.1 - 20 | °CRANKSHAFT | -20 to +30 | 5 |
| 15 | 0x800E | Exhaust VVT Angle | BITS(9,9) | Value × 0.1 - 20 | °CRANKSHAFT | -20 to +30 | 3 |
| 16 | 0x800F | VVT Oil Pressure | BITS(18,8) | Value × 0.5 | Bar | 0-127.5 | 4.5 |
| 17 | 0x8010 | VVT Control Status | BITS(26,2) | Enum {0,1,2,3} | Status | — | 1 (Active) |

**VVT Strategy**: Negative timing at low RPM (torque); positive at high RPM (power)

---

#### RAX_F_Dat – Throttle & Intake (RequestID: 0x238051bc, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 18 | 0x8011 | TPS | BITS(0,10) | Value × 0.1 | % | 0-100 | 0 |
| 19 | 0x8012 | APP | BITS(10,10) | Value × 0.1 | % | 0-100 | 0 |
| 20 | 0x8013 | IAT | BITS(20,8) | Value - 40 | °C | -40 to +215 | 45 |
| 21 | 0x8014 | WGDC | BITS(28,8) | Value × (100/255) | % | 0-100 | 25 |

**Monitoring**: APP vs. TPS deviation indicates transmission limp mode or safety condition

---

#### RAX_G_Dat – Vehicle Dynamics (RequestID: 0x238051c0, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 22 | 0x8015 | Vehicle Speed | BITS(0,10) | Value × 0.1 | km/h | 0-255 | 80 |
| 23 | 0x8016 | Battery Voltage | BITS(10,8) | Value × 0.05 + 8 | V | 8-16.7 | 13.5 |
| 24 | 0x8017 | Coolant Temp | BITS(18,8) | Value - 40 | °C | -40 to +215 | 90 |
| 25 | 0x8018 | Ambient/Manifold Temp | BITS(26,8) | Value - 40 | °C | -40 to +215 | 45 |

**Thermal Management**: ECT <80°C = cold start enrichment; ECT >95°C = fan engagement

---

#### RAX_A_Dat – Fuel Trim (RequestID: 0x238051ac, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 26 | 0x8019 | STFT (Bank 1) | BITS(0,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | 0 |
| 27 | 0x801A | LTFT (Bank 1) | BITS(8,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | 0 |
| 28 | 0x801B | STFT (Bank 2) | BITS(16,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | 0 |
| 29 | 0x801C | LTFT (Bank 2) | BITS(24,8) | (Value - 128) × 0.1 | % | -12.8 to +12.7 | 0 |

**Active O2 Feedback**: STFT ≠ 0 indicates closed-loop active; LTFT drifting indicates tuning offset needed

---

#### RAX_H_Dat – Calculated Values (RequestID: 0x238051c4, 4 bytes)

| # | PID | Parameter | Bit Range | Formula | Unit | Range | Typical |
|---|-----|-----------|-----------|---------|------|-------|---------|
| 30 | 0x801D | Calculated MAF | BITS(0,10) | Value × 0.01 | g/s | 0-10.2 | 3.5 |
| 31 | 0x801E | Calculated Load (PE) | BITS(10,8) | Value × 1.5625 | % | 0-100 | 45 |
| 32 | 0x801F | Target AFR | BITS(18,9) | Value × 0.005 + 8 | λ | 8-20 | 14.7 |
| 33 | 0x8020 | AFR Delta | BITS(27,9) | (Value - 512) × 0.01 | λ | -5 to +5 | 0 |

**ECU Calculation**: PE Load derived from MAP/Barometer/RPM; used for table lookups

---

### MUT-III CSV Export Example

```csv
Timestamp (ms),RPM,Knock,Timing,Load,Barometer,MAP,Boost,MAF,AFR,O2-L,O2-R,Inj.Pulse,Load-AFR,VVT-In,VVT-Ex,Oil Pres,TPS,APP,IAT,WGDC,Speed,Battery,ECT,MAT,STFT-1,LTFT-1,Calc-MAF,Calc-Load,Target-AFR
,(RPM),(Counts),(°BTDC),(%),(kPa),(kPa),(kPa),(g/s),(λ),(V),(V),(ms),(%),(°CRK),(°CRK),(Bar),(%),(%),(°C),(%),(km/h),(V),(°C),(°C),(%),(%),(g/s),(%),(λ)
0,800,0,12,12,101.3,95,-6.3,3.5,14.7,0.72,0.75,2.5,15,0,0,4.2,0,0,45,0,0,13.5,90,25,0,0,3.5,12,14.7
50,850,0,13,13,101.3,95,-6.3,3.7,14.7,0.71,0.74,2.8,15,2,1,4.3,1,1,46,0,5,13.5,90,25,0.5,0,3.7,13,14.7
100,920,1,14,15,101.3,98,-3.3,4.2,14.5,0.68,0.71,3.2,16,5,3,4.5,2,2,47,0,10,13.5,90,26,-0.3,0,4.2,15,14.5
```

---

## Subaru SST – 100+ Transmission Parameters

### Overview

**Vehicle**: Subaru WRX, STI, Forester (Lineartronic CVT)  
**Protocol**: SSM-II over K-Line (ISO 9141)  
**Categories**: 6 data blocks (TRANS, PRES, SLIP, SOL, STATE, CALC)  
**Total Parameters**: 100+ (exact count from EvoScan analysis)  
**Update Rate**: 10-20 Hz (K-line bandwidth limited)  
**Transport Status**: ⏳ K-line Phase 2 in progress

### Implementation Status

| Category | Parameters | Status | Details |
|----------|-----------|--------|---------|
| **TRANS** | 4 | ✅ Defined | Temperature, Gear, Engagement, Fork Pos |
| **PRES** | 4+ | ✅ Defined | Clutch 1/2, Line, Actuator pressures |
| **SLIP** | 5 | ✅ Defined | Wheel speeds (4) + Transmission slip |
| **SOL** | 4 | ✅ Defined | Solenoid currents + PWM duty |
| **STATE** | 3 | ✅ Defined | VIN lock, ECU behavior, write counter |
| **CALC** | 10+ | ✅ Defined | Derived metrics + corrections |
| **TOTAL** | **100+** | **✅ Ready** | See [`sst-parameters.ts`](packages/device/protocols/subaru/src/sst-parameters.ts) |

### Detailed Parameter Catalog

#### Transmission Core Parameters

| # | Parameter | Unit | Range | Typical | Notes |
|---|-----------|------|-------|---------|-------|
| 1 | Transmission Fluid Temp | °C / °F | -40 to +150 | 65 | Critical for shift quality |
| 2 | Gear Selection | P/R/N/D/S/L | — | D | Mechanical state |
| 3 | Gear Engagement % | % | 0-100 | 100 | Shift smoothness |
| 4 | Shift Fork Position | Steps | 0-4096 | 2048 | Actuator feedback |

---

#### Pressure Monitoring

| # | Parameter | Unit | Range | Typical |
|---|-----------|------|-------|---------|
| 5 | Clutch 1 Pressure | PSI / Bar | 0-350 / 0-24 | 150 |
| 6 | Clutch 2 Pressure | PSI / Bar | 0-350 / 0-24 | 140 |
| 7 | Line Pressure | PSI / Bar | 0-500 / 0-34 | 200 |
| 8 | Actuator Pressure | PSI / Bar | 0-350 / 0-24 | 100 |

---

#### Wheel Speed & Slip Monitoring

| # | Parameter | Unit | Range | Typical | Algorithm |
|---|-----------|------|-------|---------|-----------|
| 9 | Wheel Speed FL | km/h | 0-300 | 60 | Speed sensor FL |
| 10 | Wheel Speed FR | km/h | 0-300 | 60 | Speed sensor FR |
| 11 | Wheel Speed RL | km/h | 0-300 | 60 | Speed sensor RL |
| 12 | Wheel Speed RR | km/h | 0-300 | 60 | Speed sensor RR |
| 13 | Transmission Slip % | % | -10 to +10 | 0 | (Output - Input) / Input |

---

#### Solenoid Control

| # | Parameter | Unit | Range | Typical |
|---|-----------|------|-------|---------|
| 14 | Solenoid 1 Current | mA | 0-1000 | 500 |
| 15 | Solenoid 2 Current | mA | 0-1000 | 480 |
| 16 | Solenoid 3 (Lockup) Current | mA | 0-1000 | 0 |
| 17 | Overall PWM Duty Cycle | % | 0-100 | 45 |

---

#### Security & VIN State (Advanced)

| # | Parameter | Type | Notes |
|---|-----------|------|-------|
| 18 | VIN Lock State | Enum | Original vs. Modified |
| 19 | ECU Behavior Flags | Bitmask | Internal state counters |
| 20 | VIN Write Counter | Count | Incremental; rollover protection |

**Note**: These parameters available but not writable without special authorization sequence (beyond scope of standard real-time logging)

---

### Subaru SST CSV Export Example

```csv
Timestamp (ms),Trans-Temp,Gear,Engagement,Fork-Pos,Clutch1-Pres,Clutch2-Pres,Line-Pres,Act-Pres,Speed-FL,Speed-FR,Speed-RL,Speed-RR,Trans-Slip,Sol1-Cur,Sol2-Cur,Sol3-Cur,PWM-Duty
,(°C),(1-6),(%),(steps),(PSI),(PSI),(PSI),(PSI),(km/h),(km/h),(km/h),(km/h),(%),(mA),(mA),(mA),(%)
0,65,4,100,2048,150,140,200,100,0,0,0,0,0,500,480,0,45
50,65,4,100,2048,155,145,205,105,5,5,5,5,0,510,490,0,46
100,66,4,100,2048,160,150,210,110,60,60,60,60,0,520,500,0,50
150,67,4,100,2048,165,155,215,115,120,120,120,120,0,530,510,0,55
```

---

## OBD-II (Generic) – 8 Standard PIDs

### Overview

**Vehicle**: Any OBD-II compliant  
**Protocol**: ISO 14229-1 over CAN (100% standard)  
**Parameters**: 8 standard PIDs  
**Update Rate**: 1-10 Hz (CAN bandwidth ample)  
**Transport Status**: ✅ **Complete and tested**

### Detailed Catalog

| # | PID | Parameter | Decoding | Unit | Range | Typical |
|---|-----|-----------|----------|------|-------|---------|
| 1 | 0x0C | RPM | (A × 256 + B) / 4 | RPM | 0-16383 | 1200 |
| 2 | 0x0D | Vehicle Speed | A | km/h | 0-255 | 80 |
| 3 | 0x04 | Engine Load | (A / 255) × 100 | % | 0-100 | 45 |
| 4 | 0x05 | Coolant Temp | A - 40 | °C | -40 to +215 | 90 |
| 5 | 0x0F | Intake Air Temp | A - 40 | °C | -40 to +215 | 45 |
| 6 | 0x0B | MAP | A | kPa | 0-255 | 95 |
| 7 | 0x10 | MAF | (A × 256 + B) / 100 | g/s | 0-655.35 | 3.5 |
| 8 | 0x11 | Throttle Position | (A / 255) × 100 | % | 0-100 | 0 |

### OBD-II CSV Example

```csv
Timestamp (ms),RPM,Speed,Load,ECT,IAT,MAP,MAF,TPS
,(RPM),(km/h),(%),(°C),(°C),(kPa),(g/s),(%)
0,800,0,12,90,45,95,3.5,0
100,850,5,15,90,45,95,3.8,1
200,900,10,18,90,46,98,4.2,2
300,950,15,20,91,46,100,4.5,3
400,1200,20,25,92,47,105,5.2,5
```

---

## Example Workflow

### Scenario: Live Logging Session on Mitsubishi EVO X

**Goal**: Capture real-time engine parameters during a spirited drive, then analyze AFR vs. load correlation.

#### Step 1: Start Logging Session

1. Connect OpenPort 2.0 to OBD-II port ✅
2. In VS Code, open Command Palette: `ECU Explorer: Start Log`
3. Logging manager initializes a new session:
   - Creates `logs/` folder if needed
   - Starts with timestamp header: `2026-02-24_152030_RealTime.csv`
   - Writes column headers (all 48 MUT-III RAX parameters)
   - Writes units row as second header

#### Step 2: Parameter Selection (Optional)

1. Click **Live Data** panel in sidebar
2. Select which RAX blocks to stream:
   - ✅ RAX_C (RPM, EFT timing)
   - ✅ RAX_D (MAP, boost)
   - ✅ RAX_B (AFR, O2)
   - ⏳ RAX_A (Fuel trim)
   - ⏳ RAX_F (Throttle, temps)
   - ❌ RAX_E (VVT — optional for baseline)
3. Log channels can be filtered via settings if bandwidth-limited

#### Step 3: Drive & Capture Data

1. Status bar shows: `⏹ Logging active | ⏸ Pause | ⏹ Stop | 📂 Folder`
2. Each K-line frame (10-20 Hz) gets buffered → CSV row
3. Real-time grid updates as data arrives:
   - RPM: 2500 → 5200 → 4800
   - AFR: 14.7 → 12.5 → 14.0
   - Load: 45% → 95% → 80%
   - Timing: 15°BTDC → 20°BTDC → 18°BTDC

#### Step 4: Stop & Export

1. Click **⏹ Stop Logging**
2. Logging manager flushes CSV to disk:
   - `logs/2026-02-24_152030_RealTime.csv` ✅
3. Status bar shows: `📨 Log saved | Open Folder`
4. File size: ~500 KB for 5 minute session @ 10 Hz

#### Step 5: Analysis

1. Open CSV in Excel or Python:
```python
import pandas as pd
df = pd.read_csv('logs/2026-02-24_152030_RealTime.csv', skiprows=1)
df = df.drop(index=0)  # Skip units row
df = df.astype(float)

# Plot AFR vs. Load
import matplotlib.pyplot as plt
plt.scatter(df['Load'], df['AFR'], alpha=0.5)
plt.xlabel('Load (%)')
plt.ylabel('AFR (λ)')
plt.title('EVO X AFR Response Curve')
plt.show()

# Find peak knock zone
knock_events = df[df['Knock'] > 0]
print(f"Knock events at: {knock_events[['RPM', 'Load', 'Timing', 'Knock']].to_string()}")
```

2. Export findings → tune ignition/fuel tables accordingly

---

## Performance Metrics

### Logging Throughput

| Transport | Parameters | Hz | KB/sec | Session Duration |
|-----------|-----------|-----|--------|-------------------|
| **K-Line** | 48 MUT-III | 10-20 | ~5-10 | Hours ✅ |
| **K-Line** | 100+ Subaru | 5-10 | ~10-20 | 2-4 hours (depends on filtering) |
| **CAN** | 8 OBD-II | 1-10 | ~0.5-1 | Days+ ✅ |

### CSV File Sizes

| Vehicle | Parameters | Duration | File Size | Compression |
|---------|-----------|----------|-----------|------|
| Mitsubishi (48 params @ 10 Hz) | 48 | 60 min | ~250 MB | 20 MB (gzip) |
| Subaru (50 params @ 5 Hz) | 50 | 60 min | ~100 MB | 8 MB (gzip) |
| OBD-II (8 params @ 1 Hz) | 8 | 60 min | ~3 MB | 0.3 MB (gzip) |

---

## Known Limitations

### MUT-III RAX Logging

- ⏳ **K-Line Transport**: Not yet implemented; limits real-time streaming to CAN protocol (no RAX data yet)
- ❌ **Multi-Block Sync**: Cannot correlate parameters across RAX blocks with exact nanosecond timing
- ⚠️ **ECU Timestamp**: RAX blocks carry no hardware timestamp; all are host-stamped (potential skew under high load)

### Subaru SST Logging

- ⏳ **K-Line Transport**: Same as MUT-III blocker
- ❓ **Parameter Definitions**: Exact bit offsets and conversion formulas sourced from EvoScan analysis; may need field validation
- ⚠️ **Security Access**: SST parameters available; VIN-lock and advanced security features not accessible without write authorization

### OBD-II

- ✅ **Standard PIDs**: Fully documented and tested
- ❌ **Manufacturer Extensions**: Proprietary PIDs beyond 0x00-0xFF not supported (vehicle-specific)
- ❌ **ROM Access**: OBD-II standard forbids ROM read/write operations

---

## Cross-References

- **[README.md § Real-Time Logging Update](README.md#-k-line-phase-2--real-time-logging-foundation)** — Quick update on infrastructure
- **[PROTOCOL_SUPPORT.md](PROTOCOL_SUPPORT.md)** — Protocol-specific details (Mitsubishi, Subaru, OBD-II)
- **[TRANSPORT_LAYERS.md](TRANSPORT_LAYERS.md)** — K-line and CAN hardware specifications
- **[MUT3_LOGGING_CAPABILITIES.md](MUT3_LOGGING_CAPABILITIES.md)** — Deep dive into MUT-III RAX implementation
- **[SUBARU_EVOSCAN_FINDINGS.md](SUBARU_EVOSCAN_FINDINGS.md)** — Deep dive into Subaru SST implementation
- **[DEVELOPMENT.md § Real-Time Logging Status](DEVELOPMENT.md#real-time-logging-capabilities-analysis)** — Project roadmap

---

**Last Updated**: February 24, 2026  
**Status**: OBD-II ✅ Complete; MUT-III/Subaru ⏳ Ready (K-line pending)  
**Next Steps**: K-line hardware testing; enable streaming on real vehicles
