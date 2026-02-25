# USB Device Integration Specification

## Overview

This specification describes the architecture for integrating USB hardware devices (ECU interfaces) into ECU Explorer. The feature enables reading ROM data directly from a connected ECU, writing modified ROMs back to the ECU, streaming live sensor data, and reading/clearing diagnostic trouble codes (DTCs).

### Design Philosophy: Provider-Based Architecture

The system follows a provider-based design to ensure extensibility across different hardware and protocols.

1.  **`DeviceTransport`**: Abstracts the physical connection (USB, Serial, Bluetooth).
2.  **`EcuProtocol`**: Abstracts the communication language (MUT-III, SSM, CAN, OBD-II).
3.  **`DeviceManager`**: Orchestrates discovery and pairing of transports with protocols.

This separation allows adding support for a new hardware device (e.g., a J2534 passthru) without modifying the ECU protocol logic, and vice versa.

### Technology Choice: `navigator.usb` vs `node-usb`

We have chosen to use **WebUSB (`navigator.usb`)** via VS Code's web extension runtime instead of a native Node.js dependency like `node-usb`.

**Tradeoffs & Rationale:**
- **Portability**: WebUSB works in both VS Code Desktop and `vscode.dev` (web).
- **No Native Binaries**: Avoids the complexity of `node-gyp`, Electron ABI matching, and pre-compiled binaries for different OS/architectures.
- **Security**: Leverages the browser/VS Code's built-in permission model for hardware access.
- **Constraint**: Requires a "Browser WebWorker" extension host, meaning Node.js APIs (`fs`, `child_process`) are unavailable. All file I/O must use `vscode.workspace.fs`.
- **Constraint**: On Windows, users may need to use Zadig to switch the device driver to WinUSB.

## Reference Implementations

The following open-source projects are the primary references for protocol implementation. All code should include inline comments linking back to the corresponding sections of these references.

| Reference | URL | Purpose |
|---|---|---|
| **libmut** (Donour Sizemore) | https://github.com/harshadura/libmut | MUT-III protocol implementation for OpenPort cable. Python + C. Primary reference for MUT-III session layer, frame structure, and service IDs. |
| **NikolaKozina/j2534** | https://github.com/NikolaKozina/j2534 | Cross-platform J2534 PassThru implementation using libusb. C. Primary reference for OpenPort 2.0 AT command protocol and USB bulk transfer framing. |

**Attribution requirement**: Any code ported or derived from these references must include a comment of the form:
```typescript
// Ref: https://github.com/harshadura/libmut/blob/master/libmut/mut.py#L42
// Implements the MUT-III SecurityAccess seed/key response
```

---

## Monorepo Structure Changes

### Rename: `packages/providers/` → `packages/definitions/`

The existing `packages/providers/` folder is renamed to `packages/definitions/` to better reflect its purpose (parsing ROM definition files) and to avoid naming confusion with the new device provider system and VSCode's own provider APIs.

**Affected files:**
- `packages/providers/ecuflash/` → `packages/definitions/ecuflash/`
- `packages/providers/tsconfig.json` → `packages/definitions/tsconfig.json`
- All imports in `apps/vscode/src/` that reference `@repo/providers-ecuflash`
- `ARCHITECTURE.md`, `DEVELOPMENT.md`, `README.md`

The `ROMDefinitionProvider` interface name in `packages/core/src/definition/provider.ts` is **not** renamed in this pass — that is a separate, larger refactor.

### New Package: `packages/device/`

```
packages/device/
├── package.json                     # @repo/device
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public API: interfaces + DeviceManager
│   └── types.ts                     # Shared types
├── transports/
│   └── openport2/                   # OpenPort 2.0 transport
│       ├── package.json             # @repo/device-transport-openport2
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
└── protocols/
    ├── mut3/                        # MUT-III protocol (Mitsubishi)
    │   ├── package.json             # @repo/device-protocol-mut3
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       └── security.ts          # Seed/key algorithm
    └── obd2/                        # Generic OBD-II Mode 01
        ├── package.json             # @repo/device-protocol-obd2
        ├── tsconfig.json
        └── src/
            └── index.ts
```

---

## Core Interfaces

### `DeviceTransport`

Abstracts the physical hardware interface. One implementation per hardware device type.

```typescript
// packages/device/src/index.ts

/**
 * Abstracts a physical USB/Serial hardware interface.
 *
 * Implementations:
 * - OpenPort2Transport: Tactrix OpenPort 2.0 via navigator.usb
 * - (future) ELM327Transport: ELM327 adapters via navigator.serial
 * - (future) BluetoothTransport: Bluetooth OBD-II adapters
 */
export interface DeviceTransport {
  /** Human-readable name, e.g. "Tactrix OpenPort 2.0" */
  readonly name: string;

  /**
   * Enumerate connected devices of this type.
   * On first call, triggers the browser USB device picker via
   * `workbench.experimental.requestUsbDevice`.
   */
  listDevices(): Promise<DeviceInfo[]>;

  /** Open a connection to a specific device by ID */
  connect(deviceId: string): Promise<DeviceConnection>;
}

/**
 * An open, active connection to a hardware device.
 * Exposes raw frame-level send/receive for use by EcuProtocol implementations.
 */
export interface DeviceConnection {
  readonly deviceInfo: DeviceInfo;

  /**
   * Send a protocol frame and wait for a response.
   * The frame format is transport-specific (e.g., AT command for OpenPort 2.0).
   */
  sendFrame(data: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;

  /**
   * Start receiving frames asynchronously (for live data streaming).
   * Calls onFrame for each received frame until stopStream() is called.
   */
  startStream(onFrame: (frame: Uint8Array) => void): void;
  stopStream(): void;

  close(): Promise<void>;
}
```

### `EcuProtocol`

Abstracts the ECU-side diagnostic protocol. One implementation per ECU protocol family.

```typescript
/**
 * Abstracts an ECU diagnostic protocol.
 *
 * All methods are optional — implementations declare which capabilities
 * they support. The extension checks for method presence before showing
 * related commands.
 *
 * Implementations:
 * - Mut3Protocol: MUT-III for Mitsubishi ECUs (ref: libmut)
 * - Obd2Protocol: Generic OBD-II Mode 01 (live data only, no security)
 * - (future) SsmProtocol: Subaru Select Monitor
 * - (future) Kwp2000Protocol: KWP2000 for older Mitsubishi/European ECUs
 */
export interface EcuProtocol {
  /** Human-readable name, e.g. "MUT-III (Mitsubishi)" */
  readonly name: string;

  /**
   * Probe the connection to determine if this protocol can communicate
   * with the connected ECU. Used for auto-detection.
   */
  canHandle(connection: DeviceConnection): Promise<boolean>;

  // ── ROM Operations ──────────────────────────────────────────────────────

  /**
   * Read the full ROM binary from the ECU.
   * Requires security access (seed/key handshake) for most ECUs.
   * Reports progress via onProgress callback.
   */
  readRom?(
    connection: DeviceConnection,
    onProgress: (progress: RomProgress) => void
  ): Promise<Uint8Array>;

  /**
   * Write a ROM binary to the ECU.
   * HIGH RISK: A failed or interrupted flash can brick the ECU.
   * Implementations must verify checksum before erasing flash.
   */
  writeRom?(
    connection: DeviceConnection,
    rom: Uint8Array,
    onProgress: (progress: RomProgress) => void,
    options?: WriteOptions
  ): Promise<void>;

  /**
   * Perform a "Dry Run" of the write process.
   * Simulates the communication without actually erasing or writing flash.
   * Used to verify connection stability and security access.
   */
  dryRunWrite?(
    connection: DeviceConnection,
    rom: Uint8Array,
    onProgress: (progress: RomProgress) => void
  ): Promise<void>;

  // ── Diagnostics ─────────────────────────────────────────────────────────

  /** Read stored diagnostic trouble codes (DTCs) */
  readDtcs?(connection: DeviceConnection): Promise<DtcCode[]>;

  /** Clear all stored DTCs */
  clearDtcs?(connection: DeviceConnection): Promise<void>;

  // ── Live Data ────────────────────────────────────────────────────────────

  /**
   * Return the list of PIDs (parameter IDs) supported by this ECU.
   * Used to populate the live data PID selector UI.
   */
  getSupportedPids?(connection: DeviceConnection): Promise<PidDescriptor[]>;

  /**
   * Begin streaming live data for the specified PIDs.
   * Returns a LiveDataSession that can be used to stop streaming
   * and optionally record the session to a file.
   */
  streamLiveData?(
    connection: DeviceConnection,
    pids: number[],
    onFrame: (frame: LiveDataFrame) => void
  ): LiveDataSession;
}
```

### Shared Types

```typescript
// packages/device/src/types.ts

export interface DeviceInfo {
  id: string;
  name: string;           // e.g. "Tactrix OpenPort 2.0 (USB)"
  transportName: string;  // e.g. "openport2"
  connected: boolean;
}

export interface RomProgress {
  phase: "reading" | "writing" | "erasing" | "verifying";
  bytesProcessed: number;
  totalBytes: number;
  percentComplete: number;
  estimatedSecondsRemaining?: number;
}

export interface DtcCode {
  code: string;           // e.g. "P0300"
  description?: string;
  status: "stored" | "pending" | "permanent";
}

export interface PidDescriptor {
  pid: number;
  name: string;           // e.g. "Engine RPM"
  unit: string;           // e.g. "rpm"
  minValue: number;
  maxValue: number;
}

export interface LiveDataFrame {
  timestamp: number;      // ms since session start
  pid: number;
  value: number;
  unit: string;
}

export interface WriteOptions {
  /** If true, skip the actual flash erase/write but perform all other steps */
  dryRun?: boolean;
  /** Verify checksums in the ROM before writing */
  verifyChecksums?: boolean;
}

export interface LiveDataSession {
  stop(): void;
  /** Save the recorded session to a file (CSV or binary) */
  saveRecording?(uri: vscode.Uri): Promise<void>;
}
```

### `DeviceManager`

Registered in the extension host. Manages transport and protocol registries.

```typescript
// apps/vscode/src/device-manager.ts

export class DeviceManager {
  private transports: Map<string, DeviceTransport> = new Map();
  private protocols: EcuProtocol[] = [];

  registerTransport(id: string, transport: DeviceTransport): void;
  registerProtocol(protocol: EcuProtocol): void;

  /** List all connected devices across all registered transports */
  listAllDevices(): Promise<DeviceInfo[]>;

  /**
   * Show a QuickPick to select a device, then auto-detect the ECU protocol.
   * Returns the matched protocol and open connection.
   */
  selectDeviceAndProtocol(): Promise<{ connection: DeviceConnection; protocol: EcuProtocol }>;

  dispose(): void;
}
```

---

## USB Transport: `navigator.usb`

### Why `navigator.usb`

VSCode 1.69 (June 2022) added experimental support for WebUSB, Web Serial, and WebHID in web extensions via `workbench.experimental.requestUsbDevice`. Critically, **the web extension runtime runs on VSCode desktop too** — a web extension (using the `browser` entry point in `package.json`) runs in a Browser WebWorker on both desktop VSCode and vscode.dev.

This means `navigator.usb` is available in the extension host on all platforms without any native addons, `node-gyp` compilation, or Electron ABI concerns.

### Extension Entry Point Change

To enable `navigator.usb`, the extension must add a `browser` entry point:

```json
// apps/vscode/package.json
{
  "main": "./dist/extension.js",
  "browser": "./dist/web/extension.js"
}
```

The `browser` bundle is compiled with `target: "webworker"` and cannot use Node.js APIs (`fs`, `path`, `child_process`). File system operations must use `vscode.workspace.fs`. This is a **non-trivial migration** — see the Migration section below.

### Device Selection Flow

```typescript
// packages/device/transports/openport2/src/index.ts

// Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L1
// OpenPort 2.0 USB identifiers
const VENDOR_ID = 0x0403;
const PRODUCT_ID = 0xcc4d;

export class OpenPort2Transport implements DeviceTransport {
  readonly name = "Tactrix OpenPort 2.0";

  async listDevices(): Promise<DeviceInfo[]> {
    // Trigger the browser USB device picker
    // Ref: https://code.visualstudio.com/updates/v1_69#_webusb-web-serial-and-webhid-access-on-web
    await vscode.commands.executeCommand('workbench.experimental.requestUsbDevice', {
      filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }]
    });

    const devices = await navigator.usb.getDevices();
    return devices
      .filter(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID)
      .map(d => ({
        id: `${d.vendorId}:${d.productId}:${d.serialNumber ?? 'unknown'}`,
        name: d.productName ?? this.name,
        transportName: 'openport2',
        connected: true,
      }));
  }

  async connect(deviceId: string): Promise<DeviceConnection> {
    const devices = await navigator.usb.getDevices();
    const usbDevice = devices.find(d => /* match by id */);
    return new OpenPort2Connection(usbDevice);
  }
}
```

### AT Command Protocol

The OpenPort 2.0 communicates via a text-based AT command protocol over USB bulk transfers. This is a TypeScript port of the protocol implemented in `j2534.c`.

```typescript
// packages/device/transports/openport2/src/index.ts

class OpenPort2Connection implements DeviceConnection {
  // Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L310
  // USB endpoint addresses for OpenPort 2.0
  private readonly ENDPOINT_IN = 0x81;
  private readonly ENDPOINT_OUT = 0x02;

  async sendFrame(data: Uint8Array, timeoutMs = 2000): Promise<Uint8Array> {
    // Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L390
    // usb_send_expect() — send data and wait for response
    await this.device.transferOut(this.ENDPOINT_OUT, data);
    const result = await this.device.transferIn(this.ENDPOINT_IN, 256);
    return new Uint8Array(result.data!.buffer);
  }

  // AT command helpers
  // Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L470
  // PassThruOpen() — "ati\r\n" to identify, "ata\r\n" to open
  private async initialize(): Promise<void> {
    await this.sendAtCommand('ati');  // identify firmware
    await this.sendAtCommand('ata');  // open device
  }

  // Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L540
  // PassThruConnect() — "oto{protocol} {flags} {baud}\r\n"
  async openChannel(protocol: number, flags: number, baud: number): Promise<void> {
    await this.sendAtCommand(`oto${protocol} ${flags} ${baud}`);
  }

  // Ref: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c#L700
  // PassThruWriteMsgs() — "att{channel} {len} {flags}\r\n{data}"
  async writeMessage(channelId: number, data: Uint8Array, flags = 0): Promise<void> {
    const header = new TextEncoder().encode(`att${channelId} ${data.length} ${flags}\r\n`);
    const frame = new Uint8Array(header.length + data.length);
    frame.set(header);
    frame.set(data, header.length);
    await this.sendFrame(frame);
  }
}
```

---

## MUT-III Protocol

### Overview

MUT-III (Mitsubishi's diagnostic protocol) runs over ISO 15765-4 (CAN) at 500 kbps. It uses UDS (ISO 14229) service IDs for diagnostic operations.

**Primary reference**: https://github.com/harshadura/libmut

```
CAN ID 0x7E0 → ECU (tester to ECU)
CAN ID 0x7E8 ← ECU (ECU to tester)
```

### ROM Readback Sequence

```typescript
// packages/device/protocols/mut3/src/index.ts

// Ref: https://github.com/harshadura/libmut/blob/master/libmut/mut.py
// MUT-III ROM readback sequence

export class Mut3Protocol implements EcuProtocol {
  readonly name = "MUT-III (Mitsubishi)";

  async readRom(
    connection: DeviceConnection,
    onProgress: (p: RomProgress) => void
  ): Promise<Uint8Array> {
    // Step 1: Extended Diagnostic Session
    // Ref: libmut mut.py — start_session()
    // UDS service 0x10 subfunction 0x03 (extendedDiagnosticSession)
    await this.sendUds(connection, [0x10, 0x03]);

    // Step 2: Security Access — request seed
    // Ref: libmut mut.py — security_access()
    // UDS service 0x27 subfunction 0x01 (requestSeed)
    const seedResponse = await this.sendUds(connection, [0x27, 0x01]);
    const seed = seedResponse.slice(2); // bytes after 0x67 0x01

    // Step 3: Compute key from seed
    // Ref: Community reverse-engineering documentation for Mitsubishi 4B11T ECU
    // See: security.ts
    const key = computeSecurityKey(seed);

    // Step 4: Security Access — send key
    // UDS service 0x27 subfunction 0x02 (sendKey)
    await this.sendUds(connection, [0x27, 0x02, ...key]);

    // Step 5: Read ROM in blocks
    // Ref: libmut mut.py — read_memory()
    // UDS service 0x23 (readMemoryByAddress)
    const ROM_START = 0x000000;
    const ROM_SIZE = 0x100000; // 1MB for EVO X
    const BLOCK_SIZE = 0x80;   // 128 bytes per request
    const rom = new Uint8Array(ROM_SIZE);

    for (let offset = 0; offset < ROM_SIZE; offset += BLOCK_SIZE) {
      const response = await this.sendUds(connection, [
        0x23,
        0x14,                          // addressAndLengthFormatIdentifier
        (ROM_START + offset) >> 16,    // address high byte
        (ROM_START + offset) >> 8,     // address mid byte
        (ROM_START + offset) & 0xFF,   // address low byte
        BLOCK_SIZE,
      ]);
      rom.set(response.slice(1), offset); // skip 0x63 response code

      onProgress({
        phase: "reading",
        bytesProcessed: offset + BLOCK_SIZE,
        totalBytes: ROM_SIZE,
        percentComplete: Math.round(((offset + BLOCK_SIZE) / ROM_SIZE) * 100),
      });
    }

    return rom;
  }
}
```

### Security Access (Seed/Key)

The seed/key algorithm is specific to the ECU family. For Mitsubishi 4B11T (EVO X):

```typescript
// packages/device/protocols/mut3/src/security.ts

/**
 * Compute the MUT-III security access key from a seed.
 *
 * This algorithm is specific to Mitsubishi 4B11T ECUs (EVO X).
 * Derived from community reverse-engineering documentation.
 *
 * References:
 * - https://github.com/harshadura/libmut (libmut project)
 * - Community documentation on EvoScan forums
 *
 * NOTE: This is NOT derived from EcuFlash source code.
 * The algorithm has been independently documented by the community.
 */
export function computeSecurityKey(seed: Uint8Array): Uint8Array {
  // Implementation based on community documentation
  // TODO: Fill in once algorithm is confirmed from libmut source
  throw new Error("Security key algorithm not yet implemented — see security.ts");
}
```

> **Note**: The exact algorithm must be sourced from `libmut` source code or community documentation before this can be implemented. The `libmut` project's license must be reviewed before porting any code.

---

## Extension Integration

### VS Code Sidebar Integration

A new "Device Management" view will be added to the ECU Explorer sidebar.

**Features:**
- **Device List**: Shows discovered USB devices and their connection status.
- **Connection Toggle**: Connect/Disconnect buttons for each device.
- **Protocol Status**: Displays the auto-detected or manually selected ECU protocol.
- **Action Buttons**: Quick access to "Read ROM", "Write ROM", "Live Data", and "DTCs".
- **Logging Console**: A dedicated Output Channel for low-level USB and protocol communication logs (essential for debugging timing issues).

### New Commands

```typescript
// apps/vscode/src/extension.ts (additions)

// ROM: Read from Device
vscode.commands.registerCommand('ecuExplorer.readRomFromDevice', async () => {
  const { connection, protocol } = await deviceManager.selectDeviceAndProtocol();
  if (!protocol.readRom) {
    vscode.window.showErrorMessage(`${protocol.name} does not support ROM readback`);
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Reading ROM from ECU...',
    cancellable: false,
  }, async (progress) => {
    const romBytes = await protocol.readRom!(connection, (p) => {
      progress.report({ message: `${p.percentComplete}% — ${p.phase}` });
    });

    // Open the ROM bytes as a new untitled document
    // (same flow as opening a .hex file from disk)
    await openRomFromBytes(romBytes, 'ECU ROM (from device)');
  });

  await connection.close();
});

// ROM: Write to Device
vscode.commands.registerCommand('ecuExplorer.writeRomToDevice', async () => {
  // ... similar pattern, with confirmation dialog before write
});

// Device: Read DTCs
vscode.commands.registerCommand('ecuExplorer.readDtcs', async () => { ... });

// Device: Clear DTCs
vscode.commands.registerCommand('ecuExplorer.clearDtcs', async () => { ... });

// Device: Start Live Data
vscode.commands.registerCommand('ecuExplorer.startLiveData', async () => { ... });
```

### Device Registration

```typescript
// apps/vscode/src/extension.ts (activate function)

import { DeviceManager } from './device-manager';
import { OpenPort2Transport } from '@repo/device-transport-openport2';
import { Mut3Protocol } from '@repo/device-protocol-mut3';
import { Obd2Protocol } from '@repo/device-protocol-obd2';

const deviceManager = new DeviceManager();
deviceManager.registerTransport('openport2', new OpenPort2Transport());
deviceManager.registerProtocol(new Mut3Protocol());
deviceManager.registerProtocol(new Obd2Protocol());

context.subscriptions.push(deviceManager);
```

---

## Browser Entry Point Migration

Adding a `browser` entry point requires replacing Node.js APIs with VSCode equivalents:

| Node.js API | Web Extension Equivalent |
|---|---|
| `fs.readFile()` | `vscode.workspace.fs.readFile()` |
| `fs.writeFile()` | `vscode.workspace.fs.writeFile()` |
| `path.join()` | `vscode.Uri.joinPath()` |
| `child_process.spawn()` | Not available — use Web Workers |
| `require('some-native-addon')` | Not available — use `navigator.usb` etc. |

### Background Processing & Performance

Since the extension runs in a WebWorker, it does not block the VS Code UI thread. However, long-running operations like ROM flashing or high-frequency live data streaming must be handled carefully:

- **Streaming**: Use `requestAnimationFrame` or `setInterval` patterns that are friendly to the worker environment.
- **Memory**: Large ROM buffers should be handled as `Uint8Array` to minimize overhead.
- **Logging**: Use a dedicated `vscode.OutputChannel` to avoid flooding the main extension log.

The `packages/definitions/ecuflash/` package uses `fs` for XML file reading. This must be updated to use `vscode.workspace.fs` before the `browser` entry point can be added (research needed because we read outside of the workspace folder, e.g. C:\\Program Files\\OpenEcu\\).

**Migration effort estimate**: Medium. The file I/O surface is contained in `packages/definitions/ecuflash/src/index.ts` and `apps/vscode/src/`. The core binary parsing in `packages/core/` is already isomorphic and requires no changes.

---

## Phased Implementation Plan

### Phase 1 — Foundation (v1)

**Goal**: Establish the package structure and interfaces. No hardware required to merge.

- [ ] Rename `packages/providers/` → `packages/definitions/`
- [ ] Update all imports and documentation
- [ ] Create `packages/device/src/index.ts` with `DeviceTransport`, `EcuProtocol`, `DeviceManager` interfaces
- [ ] Create `packages/device/src/types.ts` with shared types
- [ ] Add `DeviceManager` stub to `apps/vscode/src/device-manager.ts`
- [ ] Register placeholder commands in `extension.ts` (hidden behind `when` clause)

**Acceptance criteria**: All existing tests pass. No new functionality exposed to users.

### Phase 2 — OpenPort 2.0 Transport + ROM Readback (v1)

**Goal**: Read a ROM from a connected ECU. Read-only — no flash risk.

- [ ] Implement `packages/device/transports/openport2/` (AT command protocol)
  - Reference: https://github.com/NikolaKozina/j2534/blob/master/j2534/j2534.c
- [ ] Implement `packages/device/protocols/mut3/` (MUT-III session layer)
  - Reference: https://github.com/harshadura/libmut
- [ ] Implement `security.ts` seed/key algorithm for 4B11T ECU
- [ ] Add `browser` entry point to `apps/vscode/package.json`
- [ ] Migrate file I/O to `vscode.workspace.fs`
- [ ] Implement `ecuExplorer.readRomFromDevice` command with progress reporting
- [ ] ROM bytes open as a new untitled document in ECU Explorer

**Acceptance criteria**:
- User can connect OpenPort 2.0 to EVO X, run "Read ROM from Device", and get a ROM document
- Progress notification shows percentage and phase
- Read ROM matches a known-good ROM file (byte-for-byte verification)

### Phase 3 — ROM Flash (v1.x)

**Goal**: Write a modified ROM back to the ECU.

**Prerequisites**: Phase 2 complete and validated with real hardware.

- [ ] Implement `Mut3Protocol.writeRom()` (erase/program/verify sequence)
- [ ] Mandatory pre-flash backup (save current ROM to disk before erasing)
- [ ] Block-level checksum verification before and after each block write
- [ ] Confirmation dialog with explicit warning about brick risk
- [ ] Cancellation support (safe abort before erase begins)
- [ ] Implement `ecuExplorer.writeRomToDevice` command

**Acceptance criteria**:
- User cannot flash without first confirming the warning dialog
- A backup `.hex` file is created before any erase operation
- A failed flash leaves the ECU in a recoverable state (if possible)

### Phase 4 — Live Data Streaming (v1.x)

**Goal**: Stream real-time sensor values from the ECU.

- [ ] Implement `Mut3Protocol.getSupportedPids()` and `streamLiveData()`
- [ ] Implement `packages/device/protocols/obd2/` for generic OBD-II Mode 01 PIDs
- [ ] New "Live Data" webview panel (separate from table editor)
- [ ] PID selector UI
- [ ] Session recording to CSV
- [ ] Overlay live data on table breakpoints (integration with graph visualization)

### Phase 5 — Additional Hardware (v2+)

- [ ] ELM327 transport (`navigator.serial`)
- [ ] SSM protocol (Subaru)
- [ ] KWP2000 protocol (older Mitsubishi, European ECUs)
- [ ] Bluetooth OBD-II adapters

---

## Known Constraints and Risks

| Constraint | Impact | Mitigation |
|---|---|---|
| `workbench.experimental.requestUsbDevice` is marked experimental | May change or be removed in future VSCode versions | Monitor VSCode changelog; the API has been stable since 1.69 |
| Driver requirement on Windows | Users must replace Tactrix driver with WinUSB via Zadig | Document in setup guide; link to Zadig |
| Driver requirement on Linux | Users must add udev rule | Document in setup guide |
| Seed/key algorithm sourcing | Must not use EcuFlash code (license unclear) | Source from libmut and community documentation only |
| ECU brick risk on failed flash | Catastrophic for user | Mandatory backup, block-level verification, safe abort |
| `browser` entry point migration | Medium refactor effort | Migrate file I/O incrementally; keep `main` as fallback |
| MUT-III protocol variations | Different ECU families may use different parameters | Start with 4B11T (EVO X); make parameters configurable |

---

## Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — System architecture overview
- [`DEVELOPMENT.md`](../DEVELOPMENT.md) — Feature roadmap and status
- [`specs/PROVIDER_GUIDE.md`](PROVIDER_GUIDE.md) — How to implement definition providers (analogous pattern)
- [`packages/core/src/definition/provider.ts`](../packages/core/src/definition/provider.ts) — Existing `ROMDefinitionProvider` interface (pattern reference)

## External References

- [VSCode Web Extensions Guide](https://code.visualstudio.com/api/extension-guides/web-extensions) — Web extension runtime documentation
- [VSCode 1.69 Release Notes — WebUSB](https://code.visualstudio.com/updates/v1_69#_webusb-web-serial-and-webhid-access-on-web) — `workbench.experimental.requestUsbDevice` API
- [libmut](https://github.com/harshadura/libmut) — MUT-III protocol reference (Donour Sizemore)
- [NikolaKozina/j2534](https://github.com/NikolaKozina/j2534) — OpenPort 2.0 AT command protocol reference
- [WebUSB API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) — `navigator.usb` API reference
