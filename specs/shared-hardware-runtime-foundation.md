# Shared Hardware Runtime Foundation

## Summary

This specification defines a shared hardware-runtime foundation for desktop and future web-connected hardware that is broader than ECU-only connection management and narrower than protocol/business logic.

The goal is to centralize the code that should be shared by:

- OpenPort 2.0 serial fallback on macOS
- future desktop serial-backed ECU adapters
- future wideband devices
- future non-ECU telemetry devices that still rely on the same host-side transport primitives

The key design decision is:

- merge at transport/runtime, device identity, discovery, selection, persistence, and session lifecycle
- diverge at device semantics, framing, capabilities, and user-facing workflows

This avoids forcing widebands into ECU protocol abstractions while also avoiding duplicate serial backend code across unrelated hardware families.

## Problem Statement

The current codebase contains useful but narrowly-scoped pieces:

- `apps/vscode/src/desktop-serial.ts` implements desktop serial discovery and path normalization
- `apps/vscode/src/openport2-desktop-runtime.ts` injects a serial backend for OpenPort 2.0 on desktop
- `apps/vscode/src/workspace-state.ts` already persists selected hardware identities
- `packages/device` models ECU transports and ECU protocols

Today these pieces are shaped around the current OpenPort and ECU workflows, which creates two problems:

1. shared host-side serial concerns risk being duplicated for future wideband and sensor integrations
2. non-ECU devices do not fit cleanly into `DeviceTransport` + `EcuProtocol`

Wideband devices can be serial, USB, HID, or other host-exposed device types. Some may stream continuously, some may respond to commands, and some may require device-specific initialization. The host/runtime layer should not need to care whether the connected device is "an ECU transport" or "a wideband." It should only care how to discover, identify, persist, and open it.

## Design Principle

The model should answer two separate questions:

1. How do we discover, identify, and open a host-visible device endpoint?
2. Once open, what kind of hardware behavior does this session expose?

Those are different abstraction boundaries and should remain separate.

There is also an important host-model constraint for this repository:

- the project primarily targets web-compatible TypeScript builds
- desktop-only runtime integrations must remain isolated, tree-shakeable, and safe for non-Node targets

That means runtime abstractions should prefer shared contracts where they naturally exist, and project-owned contracts where host ecosystems diverge.

## Goals

- Reuse the same desktop serial backend code for OpenPort and non-ECU serial devices.
- Keep transport/runtime code below ECU- and wideband-specific logic.
- Support persistent hardware selection without tying persistence to ECU workflows.
- Allow OpenPort serial fallback, generic serial devices, USB devices, and HID devices to share identity/discovery patterns where reasonable.
- Make room for future web support without forcing the desktop implementation details into browser builds.
- Avoid making widebands implement `EcuProtocol`.

## Non-Goals

- Defining a full wideband feature set or wideband UI in this spec.
- Replacing the existing `DeviceTransport` / `EcuProtocol` model for ECU operations in one step.
- Solving every transport family immediately.
- Broadening the current OpenPort protocol semantics in this spec.

## Merge / Diverge Model

### Merge: Shared Runtime Concerns

The following concerns should live in shared hardware-runtime infrastructure:

- host-visible device discovery
- stable device identity normalization
- duplicate path consolidation
- device display naming
- user selection flow
- workspace persistence of selected hardware identity
- reconnect matching against previously selected devices
- low-level open/close/read/write lifecycle
- runtime-specific adapters for Node desktop vs web

### Diverge: Device Semantics

The following concerns should remain device-family-specific:

- adapter command framing
- ECU protocol detection and diagnostic semantics
- wideband stream parsing and calibration semantics
- capability declarations such as `readRom`, `writeRom`, `streamLambda`, or `streamPids`
- device-specific initialization and error recovery
- UI and command flows

## Proposed Layering

### Layer 1: Runtime Backend

Runtime backends provide access to physical host APIs.

Examples:

- Node desktop serial via `serialport`
- Web Serial
- WebUSB
- WebHID
- future Bluetooth runtime

This layer knows how to enumerate and open a host-visible endpoint, but does not know what the device "means."

For this repository, runtime backend design should follow a simple rule:

- use one USB backend shape per host family
- keep serial as a separate runtime family
- avoid duplicating host backends unless hardware evidence shows a real reliability or capability advantage

### Layer 2: Shared Hardware Foundation

This layer provides cross-device logic for:

- normalized endpoint metadata
- stable device identity
- device matching and preference ranking
- persisted user selection
- device registry / provider registration
- selection UX inputs and reconnect lookup

This is the main foundation defined by this spec.

### Layer 3: Device Adapters

Device adapters claim endpoints from the shared foundation and expose device-family sessions.

Examples:

- `OpenPortAdapter`
- `WidebandAdapter`
- future `Elm327Adapter`
- future `GenericSerialSensorAdapter`

An adapter can expose one or more higher-level capabilities, but it should not own generic serial enumeration logic.

### Layer 4: Domain-Specific APIs

These remain separate:

- ECU-facing APIs such as `DeviceTransport`, `DeviceConnection`, and `EcuProtocol`
- wideband-facing APIs such as lambda/AFR streaming, calibration, heater status, or device configuration

This is where ECU and wideband concerns intentionally diverge.

## Core Abstractions

The exact type names can change, but the shape should follow this split.

### Runtime Endpoint

```typescript
export interface RuntimeEndpointInfo {
  id: string;
  transport: "serial" | "usb" | "hid" | "bluetooth";
  path?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  manufacturer?: string;
  productName?: string;
  friendlyName?: string;
}

export interface RuntimeEndpointSession {
  readonly endpoint: RuntimeEndpointInfo;
  open(): Promise<void>;
  close(): Promise<void>;
  read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
}

export interface RuntimeBackend {
  readonly transport: RuntimeEndpointInfo["transport"];
  listEndpoints(): Promise<RuntimeEndpointInfo[]>;
  openEndpoint(id: string): Promise<RuntimeEndpointSession>;
}
```

This is the reusable host/runtime boundary.

### USB Runtime Contract

USB is the easiest place to share a cross-host contract.

Where possible, the project should standardize on a WebUSB-compatible runtime shape:

- web host: native `navigator.usb`
- desktop Node host: a WebUSB-compatible adapter built on a Node USB library

If the Node USB layer can satisfy the same contract, higher layers should not need a separate Node-specific USB abstraction.

This keeps USB support aligned with the repository's web-first build strategy and minimizes host-specific branching above the runtime layer.

### Serial Runtime Contract

Serial should not assume the same level of cross-host API compatibility.

Instead, the project should define and own a small serial runtime contract:

```typescript
export interface SerialPortInfo {
  id: string;
  path?: string;
  serialNumber?: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
}

export interface SerialPortSession {
  readonly port: SerialPortInfo;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
}

export interface SerialRuntime {
  listPorts(): Promise<readonly SerialPortInfo[]>;
  openPort(id: string): Promise<SerialPortSession>;
}
```

Preferred implementations:

- desktop Node host: `serialport`-backed runtime
- web host: WebSerial-backed runtime when needed and available

The important design point is that both implementations conform to a project-owned serial contract rather than forcing Node serial packages to look browser-native.

### Shared Hardware Identity

```typescript
export interface HardwareIdentity {
  id: string;
  runtimeEndpointId: string;
  transport: RuntimeEndpointInfo["transport"];
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
  manufacturer?: string;
  productName?: string;
  allPaths?: string[];
}

export interface HardwareSelectionRecord {
  slot: string;
  adapterKind: string;
  identity: HardwareIdentity;
}
```

This is the persistence boundary.

`HardwareSelectionRecord` should not depend on ECU protocol names or ECU-only terminology.

### Hardware Adapter

```typescript
export interface HardwareAdapter<TSession> {
  readonly kind: string;
  readonly displayName: string;

  match(endpoint: RuntimeEndpointInfo): boolean;
  describe(endpoint: RuntimeEndpointInfo): {
    name: string;
    identity: HardwareIdentity;
  };

  open(
    backend: RuntimeBackend,
    endpoint: RuntimeEndpointInfo,
  ): Promise<TSession>;
}
```

This is where OpenPort and wideband device-family logic begins.

### ECU Adapter Relationship

An ECU adapter should be free to expose the existing ECU abstractions:

```typescript
interface EcuAdapterSession {
  transport: DeviceTransport;
}
```

or adapt directly into `DeviceConnection`-oriented flows, depending on the transport family.

The important rule is that the shared runtime foundation must not depend on `EcuProtocol`.

### Wideband Adapter Relationship

A wideband adapter should expose wideband-native capabilities, for example:

```typescript
interface WidebandSession {
  startStream(onSample: (sample: WidebandSample) => void): void;
  stopStream(): void;
  configure?(settings: WidebandSettings): Promise<void>;
}
```

The important rule is that a wideband adapter must not be forced into `DeviceTransport` if its device is not meaningfully "transporting" ECU traffic.

## How Existing Features Map

### OpenPort 2.0 on macOS

OpenPort macOS serial fallback should move toward:

- shared serial backend for endpoint enumeration and opening
- OpenPort-specific adapter matching by VID/PID and known identifiers
- existing OpenPort protocol semantics remaining in `packages/device/transports/openport2`

This means the serial implementation currently in `apps/vscode/src/openport2-desktop-runtime.ts` should eventually consume a shared serial runtime rather than owning its own specialized discovery logic.

### Existing Device Selection Persistence

The existing `WorkspaceState.deviceSelections` model is directionally correct, but the naming and wiring should become adapter-aware rather than ECU-flow-aware.

Persistence should be able to answer:

- "reconnect to the previously selected OpenPort"
- "reconnect to the previously selected wideband"
- "reconnect to the previously selected serial telemetry device"

without assuming all of those selections participate in ECU protocol auto-detection.

### Current `DeviceManagerImpl`

`DeviceManagerImpl` should remain focused on ECU-oriented connection flows.

It may consume the shared device foundation for:

- listing candidate hardware
- restoring persisted selections
- opening runtime sessions

but it should not become the home for every non-ECU device workflow.

## Proposed Package Boundaries

### `packages/device`

Keep ECU abstractions here:

- `DeviceTransport`
- `DeviceConnection`
- `EcuProtocol`

Add only shared runtime abstractions here if they are truly reusable and not VS Code-specific.

### New shared host/runtime package

Preferred direction:

- introduce a new package for shared endpoint/runtime foundations, for example `packages/hardware-runtime` or `packages/hardware`

This package would own:

- runtime endpoint metadata
- runtime backends
- endpoint identity normalization helpers
- adapter registry primitives

This avoids making `packages/device` carry non-ECU domain assumptions.

### `apps/vscode`

VS Code should own:

- Quick Pick UX
- workspace-state persistence wiring
- context keys
- status bar integration
- composition of shared runtime backends with registered adapters

## Runtime Matrix

| Concern | Desktop Node | Web |
|---|---|---|
| Serial endpoint enumeration | project-owned `SerialRuntime` backed by `serialport` | project-owned `SerialRuntime` backed by WebSerial when available |
| USB endpoint enumeration | WebUSB-compatible runtime backed by Node USB only if justified | WebUSB |
| HID endpoint enumeration | Node-specific runtime if needed | WebHID |
| Selection persistence | workspace state | workspace state / web extension state |
| Adapter matching | shared | shared |

The transport/runtime implementation changes by host, but adapter matching and selection persistence should be mostly shared.

## Host Support Policy

The project should not carry duplicate host backends unless there is a concrete reason.

### USB

Supporting both WebUSB and Node USB only makes sense across different host families:

- web host uses WebUSB
- desktop Node host may use a WebUSB-compatible Node implementation if the host actually needs it

Within a single host family, duplicate USB backends should be avoided unless hardware evidence shows that one backend materially improves reliability, permissions, or capability.

### Serial

Serial is materially different from USB and should remain a first-class parallel backend:

- it solves a different class of host/device exposure
- it is already relevant for OpenPort on macOS
- it may also be relevant for future wideband devices

So the meaningful multi-backend story is primarily:

- USB per host family
- serial per host family

not "multiple USB implementations everywhere."

## Incremental Migration Plan

### Phase 1: Formalize Shared Runtime Types

- introduce shared runtime endpoint and runtime backend abstractions
- document USB as a WebUSB-compatible contract where feasible
- define a project-owned serial runtime contract
- move desktop serial endpoint normalization into shared code
- keep OpenPort behavior unchanged

### Phase 2: Rewire OpenPort Desktop Serial Fallback

- make OpenPort desktop runtime consume the shared serial backend
- keep OpenPort adapter semantics specific to OpenPort
- preserve current macOS `/dev/cu.*` preference

### Phase 3: Generalize Selection Persistence

- rename or reshape persisted device-selection records to be adapter-aware
- wire selection restore into the VS Code host
- keep ECU-specific connect flow using the shared selection foundation

### Phase 4: Add Non-ECU Device Adapter Support

- add at least one non-ECU adapter using the same shared runtime layer
- validate that the shared foundation is sufficient for wideband-style sessions

## Risks

- forcing too much into `packages/device` would keep non-ECU abstractions artificially ECU-shaped
- over-generalizing too early could slow down the immediate OpenPort and wideband work
- making persistence too endpoint-path-specific could break across macOS device-path churn
- assuming every device supports the same read/write semantics could make USB/HID adapters awkward

## Acceptance Criteria

- A shared runtime/backend abstraction exists for host-visible device endpoints without ECU-specific naming.
- Desktop serial discovery, identity normalization, and duplicate-path ranking can be reused by multiple device families.
- OpenPort serial fallback can consume the shared runtime/backend without regressing its current behavior.
- Persisted device selection is modeled in terms of adapter/device identity, not ECU protocol detection.
- The design explicitly supports a future wideband adapter without requiring it to implement `EcuProtocol`.
- VS Code device selection UX can be reused by ECU and non-ECU device integrations while allowing different post-connect workflows.

## Open Questions

- Should shared runtime abstractions live in `packages/device` initially for velocity, or in a new package immediately for cleaner boundaries?
- Do we want a single adapter registry for all hardware families, or separate registries for ECU and non-ECU flows backed by the same runtime types?
- Which transport families need to be present in v1: serial only, or serial plus USB/HID type shapes even if only serial is implemented?

## Immediate Recommendation

For issue `#4` and its follow-ons, the next implementation step should not be "persist serial devices for ECU connection." It should be:

- establish a shared desktop endpoint foundation
- route OpenPort desktop serial fallback through it
- make selection persistence adapter-aware
- leave ECU protocol detection above that layer

That gives the project one place to build serial-backed device support without painting wideband integrations into an ECU-only corner.

Implementation plan:

- [`plans/shared-hardware-runtime-migration-plan.md`](../plans/shared-hardware-runtime-migration-plan.md)

Implementation sequencing is tracked in [`shared-hardware-runtime-implementation-plan.md`](./shared-hardware-runtime-implementation-plan.md).
