# Transport Layers & Hardware Architecture

Technical reference for communication transports, device hardware, and physical layer integration in ECU Explorer.

**Quick Navigation**: [CAN (ISO 15765-4)](#can-transport-iso-15765-4) | [K-Line](#k-line-transport-iso-14230) | [Hardware](#supported-hardware) | [Architecture](#transport-abstraction-layer)

---

## Overview

The transport layer provides a unified abstraction for diverse physical communication mediums, allowing protocols (MUT-III, KWP2000, SSM, OBD-II) to operate across CAN, K-line, and future serial transports without modification.

```
Protocol Layer (UDS, KWP2000, SSM)
        ↓
Transport Abstraction (DeviceConnection)
        ↓
Hardware Transport (CAN, K-Line, Serial)
        ↓
Physical Device (OpenPort 2.0, USB, etc.)
```

---

## CAN Transport (ISO 15765-4)

### Overview

**Standard**: ISO 15765-4 (CAN protocol for diagnostics)  
**Baud Rate**: 500 kbps (standard for automotive OBD-II/diagnostics)  
**Hardware**: OpenPort 2.0 (Tactrix)  
**Connection**: USB (WebUSB) via host computer  
**Status**: ✅ **Complete and tested**

### Frame Format

```
CAN ID  | Length | Payload (0-7 bytes) | Padding
--------|--------|---------------------|------------------------
0x7E0   | 0x08   | [Data PCI] [Msg]    | [Zeros if < 7 bytes]
  ↑       ↑
Request  Functional ID for multi-frame
```

**Functional Addressing**:
- **0x7E0** (Request): Host → ECU (broadcast to any responding ECU)
- **0x7E8+** (Response): ECU → Host (0x7E8, 0x7E9, etc. per responder)

**Protocol Control Information (PCI)**:
- **0x0N** (N=0-7): Single frame, N bytes of data
- **0x1N**: First frame of multi-frame sequence
- **0x2N**: Consecutive frame
- **0x3N**: Flow control

### Supported Protocols

| Protocol | Vehicle | Status | Details |
|----------|---------|--------|---------|
| **UDS (0x10 / 0x22 / 0x23)** | Mitsubishi MUT-III | ✅ | Diagnostic session, security, memory read |
| **KWP2000 (0x10 / 0x27 / 0x34)** | Subaru | ✅ | Basic services + Subaru extensions |
| **OBD-II (0x01 / 0x02 / 0x03)** | Any OBD-II | ✅ | 8 standard PIDs |

### Implementation

**File**: [`packages/device/transports/openport2/src/index.ts`](packages/device/transports/openport2/src/index.ts)

```typescript
class OpenPort2Transport implements Transport {
  async initialize(): Promise<void>;
  async openChannel(canId: number, direction: 'rx' | 'tx'): Promise<void>;
  async writeMessage(data: Uint8Array): Promise<void>;
  async readMessage(timeoutMs?: number): Promise<Uint8Array>;
  async close(): Promise<void>;
}
```

**Key Features**:
- ✅ WebUSB API for direct hardware access
- ✅ Non-blocking read/write with timeout
- ✅ Automatic frame fragmentation for large payloads
- ✅ Flow control handling (0x30 frames)
- ✅ Mock implementation for testing

### Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **Baud Rate** | 500 kbps | Standard OBD-II speed |
| **Max Frame Size** | 7 bytes | Per CAN frame; multi-frame for larger |
| **Max Message Size** | 4095 bytes | Across multiple frames |
| **Frame Rate** | ~100 Hz | At 500 kbps, 11-bit IDs |
| **Latency** | 10-50 ms | Per round-trip (host + ECU processing) |
| **Bandwidth** | ~62.5 KB/s | Theoretical maximum |
| **Practical ROM Read** | 10-30 KB/s | Including overhead, validation |
| **Practical ROM Write** | 5-20 KB/s | Including erase, verify cycles |

### Tested Vehicles & Protocols

- ✅ **Mitsubishi EVO X (MUT-III)** — Read/write confirmed
- ✅ **Subaru WRX (KWP2000)** — Read/write confirmed  
- ✅ **Generic OBD-II** — Live data streaming confirmed

---

## K-Line Transport (ISO 14230)

### Overview

**Standard**: ISO 14230-1/4 (K-line diagnostic protocol)  
**Baud Rate**: 10.4 kbaud (legacy automotive standard) or 19.2 kbaud (some modern ECUs)  
**Hardware**: OpenPort 2.0 (K-line mode)  
**Status**: ⏳ **Phase 3 (Testing)**

### Physical Layer

```
K-Line: Single wire serial connection
        ↓
Optional L-Line (for debugging; not used in tuning)
        ↓
Typical: K-line from ECU pin 6 (ISO 9141) or pin 7 (UDS variant)
```

**Electrical**:
- **Baud Rate Switching**: 5 baud handshake for initialization
- **Timing**: Very tight tolerances (±3% typical)
- **ECU Response**: ~20 ms typical (much slower than CAN)

### Frame Format

```
[Start Bit] [Header] [Target Address] [Data Length] [Payload] [Checksum] [Stop Bit]
    1           1          1                1          0-N         1        1
```

**Header Byte**:
- **0xBF** (or 0x3C for some protocols): Initiator header
- **0xF1** (or 0x3F for response): ECU response header

**Checksum**: Simple byte sum (all bytes mod 256)

**Typical Baud Sequence**:
1. Host sends 0xC1 at 5 baud → Slow handshake request
2. ECU responds with 0x7E at 5 baud → Slow handshake response
3. Both sides switch to 10.4k baud
4. Normal protocol communication begins

### Supported Protocols

| Protocol | Vehicle | Status | Transport Notes |
|----------|---------|--------|------------------|
| **MUT-III (E0-E5 commands)** | Mitsubishi | ⏳ Phase 2 | Real-time logging via K-line (faster than CAN for streaming) |
| **SSM-II** | Subaru | ⏳ Phase 2.5 | Real-time data + parameter access |
| **NCS** | Nissan | ❌ Planned | When K-line support complete |

### Implementation Status

**Current**: ⏳ In active development (Phase 3)

**Blockers**:
- ❌ OpenPort 2.0 K-line initialization sequence not yet fully verified
- ⏳ K-line timeout/retry logic under development
- ⏳ Hardware testing pending (real WRX/STI or EVO X needed)

**Architecture**: Abstracted in [`packages/device/transports/`](packages/device/transports/). When complete, supports:
```typescript
class KLineTransport implements Transport {
  async initialize(baudRate?: 10400 | 19200): Promise<void>;
  async sendMessage(data: Uint8Array): Promise<void>;
  async receiveMessage(timeoutMs?: number): Promise<Uint8Array>;
  async close(): Promise<void>;
}
```

### Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **Baud Rate** | 10.4 kbaud | Standard (19.2k for newer ECUs) |
| **Max Frame Size** | Variable | Typically 20-30 bytes per frame |
| **Common Message Size** | 4-8 bytes | RAX blocks, SST blocks |
| **Frame Rate** | ~10-20 Hz | Bandwidth-limited by 10.4k baud |
| **Echo Handling** | Required | Sender receives own transmission; must validate |
| **Latency** | 50-200 ms | Per message (handshaking + processing) |
| **Bandwidth** | ~1.3 KB/s | Theoretical; much slower than CAN |
| **Practical ROM Read** | 0.5-2 KB/s | Would be very slow; not recommended |
| **Practical Logging** | 8-16 params @ 10-20 Hz | Suitable for real-time parameter streaming |

### K-Line vs CAN Comparison

| Aspect | K-Line | CAN | Best For |
|--------|--------|-----|----------|
| **Speed** | 10.4 kbaud | 500 kbps | **CAN** (50x faster) |
| **Complexity** | Simple 1-wire | Differential 2-wire | **K-Line** (simpler) |
| **Real-time Capable** | ✅ 10-50 Hz | ✅ 100+ Hz | **CAN** (higher rate) |
| **ROM Transfer** | Hours | Minutes | **CAN** (practical) |
| **Hardware** | Ubiquitous | Modern cars | **K-Line** (older cars) |
| **Handshake** | Complex (5-baud sync) | Simple | **CAN** (easier init) |

---

## Serial/UART Transport (Planned v2.x)

### Status

❌ **Planned for future release** — Not yet implemented

### Use Cases

- Direct serial connection to bench power supplies
- Standalone adapters (not WebUSB-based)
- Libusb-based USB-to-serial bridges
- Development/test scenarios

### Planned Features

- 9600-115200 baud configurable
- DTR/RTS handshaking support
- Minimal framing (direct UDS/KWP2000 over UART)
- Linux/macOS/Windows support via libserialport or similar

---

## Hardware Support

### Supported Devices

#### Tactrix OpenPort 2.0 (Primary)

**Status**: ✅ **Fully Supported**

| Feature | CAN | K-Line | Support |
|---------|-----|--------|---------|
| **USB Interface** | ✅ | ✅ | WebUSB (vendor 0x0403, product 0xcc4d) |
| **CAN Mode** | ✅ | — | 500 kbps, fully tested |
| **K-Line Mode** | — | ⏳ | Under testing; init sequence being verified |
| **Dual-Channel** | N/A | — | Can switch modes; not simultaneous |
| **Power Supply** | 12V | 12V | External 12V required |

**Connection**:
- **OBD-II Port**: 16-pin header on ECU
- **Typical Pins Used**:
  - Pin 6: CAN High (standard)
  - Pin 14: CAN Low (standard)
  - Pin 7: K-Line (legacy)
  - Pin 4/5: Ground/12V

**Firmware**: v1.x supports CAN; K-line firmware variant under evaluation

**See also**: [`packages/device/transports/openport2/`](packages/device/transports/openport2/) for implementation

### Future Devices

| Device | Status | Notes |
|--------|--------|-------|
| **Elm327 Clone** | ❌ Planned | OBD-II only; no ROM access (not a priority) |
| **Libusb Serial Adapter** | ❌ Planned v2.x | For K-line standalone without OpenPort |
| **Native K-Line Adapter** | ❌ Community interest | Depends on demand |

---

## Transport Abstraction Layer

### Architecture

All transports implement the `Transport` interface:

```typescript
// File: packages/device/src/index.ts
interface DeviceConnection {
  // Write bytes to device (variable-length)
  sendFrame(data: Uint8Array): Promise<void>;
  
  // Read response (with optional timeout)
  receiveFrame(timeoutMs?: number): Promise<Uint8Array>;
  
  // Drain any pending data
  drain(): Promise<void>;
  
  // Optional: raw byte read/write for protocol debugging
  sendRawBytes?(data: Uint8Array): Promise<void>;
  receiveRawBytes?(count: number, timeoutMs?: number): Promise<Uint8Array>;
}
```

**Protocol Abstraction**:

```typescript
interface EcuProtocol {
  readRom(
    connection: DeviceConnection,
    onProgress: (progress: RomProgress) => void,
    onEvent?: (event: EcuEvent) => void,
  ): Promise<Uint8Array>;

  writeRom(
    connection: DeviceConnection,
    rom: Uint8Array,
    onProgress: (progress: RomProgress) => void,
    options?: WriteOptions,
    onEvent?: (event: EcuEvent) => void,
  ): Promise<void>;

  streamLiveData(
    connection: DeviceConnection,
    pids: number[],
    onFrame: (frame: LiveDataFrame) => void,
    onHealth?: (health: LiveDataHealth) => void,
  ): LiveDataSession;
}
```

### Device Manager Integration

**File**: [`apps/vscode/src/device-manager.ts`](apps/vscode/src/device-manager.ts)

The `DeviceManager` coordinates transports and protocols:

```
1. User selects device (e.g., "OpenPort 2.0 at USB:0403:CC4D")
2. DeviceManager instantiates OpenPort2Transport
3. User selects operation (read ROM, write ROM, log data)
4. DeviceManager looks up protocol (MUT-III, KWP2000, etc.)
5. Protocol uses transport for I/O
6. DeviceManager reports progress/errors to UI
```

---

## Frame Timing & Synchronization

### CAN Frame Timing

```
Single Frame (7 bytes max):
  ├─ Send time: ~1 ms @ 500 kbps
  ├─ ECU processing: 10-50 ms
  ├─ Response send: ~1 ms
  ├─ USB round-trip latency: 1-10 ms
  └─ Total: 12-62 ms

Multi-Frame (4095 bytes max):
  ├─ First Frame send: ~1 ms
  ├─ Consecutive Frames (N): N × 1-5 ms (with flow control waiting)
  ├─ ECU processing: 10-100 ms
  ├─ Response frames: M × 1 ms
  └─ Total: ~100-500 ms (depending on size and ECU responsiveness)
```

### K-Line Frame Timing

```
Single Message (20 bytes typical):
  ├─ Send time: ~20 ms @ 10.4 kbaud
  ├─ Echo receive: ~20 ms (sender hears own frame)
  ├─ ECU processing: 20-50 ms
  ├─ Response: ~20 ms
  └─ Total: 80-110 ms (significantly slower than CAN)

Note: K-line echo handling requires receiver to validate
      that echo matches sent bytes before processing response
```

### Timeout Strategy

**Recommended Timeouts**:
- **CAN single frame**: 100 ms
- **CAN multi-frame** (4KB): 1000 ms
- **K-Line single message**: 500 ms  
- **K-Line streaming**: 2000 ms (for session init)

---

## Error Handling & Recovery

### CAN Error Scenarios

| Error | Cause | Recovery |
|-------|-------|----------|
| **Timeout** | No response from ECU | Retry 2-3x; then fail with clear error |
| **Bad Checksum** | Corrupted frame | Discard; don't retry (ECU will resend if needed) |
| **Unexpected CAN ID** | Wrong responder | Verify target ECU; check configuration |
| **Flow Control Timeout** | ECU not ready for next frame | Retry flow control sequence; increase timeout |

### K-Line Error Scenarios

| Error | Cause | Recovery |
|-------|-------|----------|
| **Baud Sync Loss** | 5-baud handshake failed | Reinitialize 10.4k baud; clear buffers |
| **Echo Mismatch** | Sent bytes don't echo back | Check wiring/termination; re-sync |
| **Checksum Error** | Frame corruption | Discard; don't retry |
| **No Response** | ECU offline or hung | Check power; try soft reset; timeout |

---

## Performance Optimization

### CAN Optimization Tips

- **Batch Operations**: Combine parameters into single multi-frame message where possible
- **Message Pipelining**: Send next request while processing previous response
- **Parallel Operations**: Multiple CAN IDs can operate simultaneously (if ECU supports)

### K-Line Optimization Tips

- **Message Compression**: Minimize parameter requests (K-line is narrow bandwidth)
- **Polling Strategy**: Filter to essential parameters; increase polling interval if stuck
- **Flow Control Tuning**: Adjust timeout/retry based on ECU responsiveness

---

## Testing & Debugging

### Mock Transports

**File**: [`packages/device/test/`](packages/device/test/)

```typescript
// Mock that simulates MUT-III responses
class MockMut3Transport implements Transport {
  async sendFrame(data: Uint8Array): Promise<void> {
    // Simulate protocol state machine
    // Return appropriate responses for E0, E1, E4, E5 commands
  }
}

// Mock for KWP2000
class MockSubaruTransport implements Transport {
  // Similar pattern for Subaru security handshake + reads
}
```

### Protocol Debugger

**Usage**:
```typescript
// Enable verbose logging for troubleshooting
export DEBUG=ecuexplorer:protocol npm run test

// Captures all frames sent/received for analysis
```

---

## Cross-References

- **Hardware Setup**: [PROTOCOL_SUPPORT.md § Device Support](PROTOCOL_SUPPORT.md#device-support)
- **Real-Time Logging**: [REAL_TIME_LOGGING.md](REAL_TIME_LOGGING.md) — Parameter streaming over transports
- **Protocol Details**: [PROTOCOL_SUPPORT.md](PROTOCOL_SUPPORT.md) — CAN/K-line specific protocols
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md) — Module dependencies and design patterns
- **Implementation**: [`packages/device/`](packages/device/) — Source code

---

**Last Updated**: February 24, 2026  
**Status**: CAN ✅ Complete; K-Line ⏳ Phase 3; Serial ❌ Planned v2.x  
**Maintainers**: Community contributions welcome
