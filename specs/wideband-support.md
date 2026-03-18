# Wideband Support

## Summary

This specification defines the first wideband-specific layer that sits above the shared hardware runtime foundation.

The goal is to add wideband support without forcing wideband devices into ECU-specific abstractions such as `DeviceTransport` and `EcuProtocol`.

The first slice should establish:

- a wideband-specific adapter and session model
- a simple reading contract for devices that report either lambda or AFR
- extension-side composition points for selecting and managing wideband hardware
- a narrow first implementation path that can later be extended to concrete device families

This spec intentionally builds on [`shared-hardware-runtime-foundation.md`](./shared-hardware-runtime-foundation.md).

## Problem Statement

The repository now has a shared hardware runtime and selection foundation that can support:

- extension-host USB and serial sessions
- client-browser WebUSB and WebSerial sessions
- persistent hardware selection and reconnect matching
- host-locality-aware hardware management

What the repository does not yet have is a non-ECU abstraction for hardware whose job is to expose sensor data directly.

Wideband devices are the first important example:

- they may be serial-backed, USB-backed, HID-backed, or browser-owned
- they may stream continuously or expose polled readings
- they may report AFR, lambda, or device-specific raw payloads
- they do not meaningfully fit the `DeviceTransport` plus `EcuProtocol` split

Without a dedicated wideband layer, the project risks:

- forcing widebands into ECU-only abstractions
- duplicating hardware selection and session logic outside the shared runtime work
- mixing raw device framing with user-facing telemetry logic

## Goals

- Define a wideband-native session interface.
- Keep wideband support separate from ECU protocol abstractions.
- Reuse the shared hardware runtime and hardware selection infrastructure.
- Support devices that report either lambda or AFR.
- Keep the first implementation narrow and reviewable.

## Non-Goals

- Supporting every wideband family in the first pass.
- Defining calibration, heater, or device-configuration features in the first pass.
- Reworking the existing ECU device manager to become a generic hardware orchestrator in one step.
- Choosing a universal normalized unit layer before the first real device implementation exists.

## Design Principle

Wideband support should follow the same merge/diverge rule as the shared hardware runtime work:

- merge at discovery, identity, persistence, runtime session ownership, and reconnect matching
- diverge at device semantics, framing, sample parsing, and user workflows

The hardware runtime does not need to know whether a device is an ECU transport or a wideband.

The wideband layer does need to know:

- how to claim a hardware candidate
- how to open a device-family session
- how to turn bytes into meaningful wideband readings

## First-Slice Scope

The first implementation slice should focus on the minimum useful wideband architecture:

1. add wideband-specific contracts in a dedicated package or module
2. add extension-side composition for wideband-capable hardware
3. define a first wideband session lifecycle
4. support live reading delivery for one concrete device family

If the concrete device-family implementation is not ready in the same slice, the contracts and extension composition should still land in a way that does not need to be redone later.

## Wideband Reading Model

The first reading contract should stay intentionally simple.

It should model what the device actually reports, without assuming fuel context or derived conversions:

```typescript
export type WidebandReading =
	| {
			kind: "lambda";
			value: number;
			timestamp: number;
	  }
	| {
			kind: "afr";
			value: number;
			timestamp: number;
	  };
```

Rationale:

- some devices natively report lambda
- some devices natively report AFR
- AFR is fuel-relative, and the device may not know or expose fuel context
- the first contract should avoid pretending it can derive more than it actually knows

If the project later needs display normalization or fuel-specific conversion, that should be layered above this reading contract rather than embedded inside it.

## Core Abstractions

### Wideband Session

```typescript
export interface WidebandSession {
	readonly id: string;
	readonly name: string;
	startStream(onReading: (reading: WidebandReading) => void): Promise<void>;
	stopStream(): Promise<void>;
	close(): Promise<void>;
}
```

Responsibilities:

- own the active device-family session
- deliver parsed readings to callers
- manage start/stop semantics for streaming or polling implementations
- close the underlying runtime session cleanly

### Wideband Adapter

```typescript
export interface WidebandAdapter {
	readonly id: string;
	readonly name: string;
	canOpen(candidate: HardwareCandidate): Promise<boolean> | boolean;
	open(candidate: HardwareCandidate): Promise<WidebandSession>;
}
```

Responsibilities:

- identify whether a hardware candidate belongs to this device family
- open and initialize a device-family session
- hide framing and parsing details from extension-side orchestration

The adapter should consume shared hardware candidates, not raw extension-host runtime objects.

### Extension-Side Composition

The VS Code app should eventually own a small wideband composition layer that can:

- discover wideband-capable candidates from shared hardware selection
- ask registered wideband adapters whether they can handle a candidate
- open a session through the matched adapter
- manage one active wideband session lifecycle

This should remain separate from `DeviceManagerImpl`, which is still ECU-focused.

## Relationship to Shared Hardware Runtime

Wideband support should consume the shared hardware stack rather than bypass it:

- `HardwareCandidate`
- persisted hardware selection
- locality-aware runtime ownership
- request/forget browser-owned hardware actions
- reconnect matching by saved hardware identity

That means a future user flow like this should be possible without duplicating low-level logic:

- connect a wideband over extension-host serial
- reconnect the same wideband later over the same remembered selection
- manage browser-owned wideband hardware through the same picker semantics used by other hardware

## Proposed Package Direction

The preferred direction is a dedicated reusable package under `packages/`.

Possible names:

- `packages/wideband`
- `packages/hardware-wideband`

The important part is the boundary:

- shared wideband contracts and adapters live outside `apps/vscode`
- VS Code orchestration and UI stay in `apps/vscode`
- concrete device-family code can live under the wideband package or device-family submodules

## Extension UX Direction

The first wideband UX should stay narrow.

Recommended first flow:

- select or manage hardware through the shared hardware picker
- connect a wideband session
- surface the active reading in a simple extension-visible location

Initial UX targets could include:

- a status-bar item
- a command that prints or streams the current reading
- a simple output-channel or panel-based stream view

The first slice should not try to solve:

- rich dashboards
- charting
- multi-device mixing
- calibration/configuration UX

## Initial Support Table

The first implementation pass should target AEM serial-output widebands.

| Device family | Transport | Coverage target | Notes |
| --- | --- | --- | --- |
| AEM serial-output widebands | Serial | First implementation target | `9600 8N1` ASCII value stream |
| AEM X-Series serial output | Serial | Planned under same adapter | AEM documents backward-compatible serial output formatting |
| AEM legacy 30-4100 / 30-4110 style serial output | Serial | Planned under same adapter | Same line-based serial output model |
| AEMnet / CAN integrations | CAN | Not in first pass | Separate transport and protocol work |
| Non-AEM widebands | Varies | Not in first pass | To be added as later adapter families |

The first AEM adapter should assume:

- the device is selected as a serial-backed hardware candidate
- serial parameters are `9600 8N1`
- the output stream is line-based ASCII text ending in `\r\n`
- the unit mode is configured by the user as either `afr` or `lambda`

The first implementation should support both host-local serial paths built on the shared serial runtime:

- extension-host serial via the shared Node serial runtime
- client-browser serial via WebSerial through the same shared serial contract

## Logging Integration

Wideband support should integrate with the existing CSV logging flow rather than introducing a separate logger.

The first logging slice should:

- keep existing ECU PID logging intact
- allow named sensor channels alongside ECU PID columns
- log the active wideband reading as a dedicated channel such as `Wideband AFR` or `Wideband Lambda`

This keeps logging unified while still allowing ECU-only, wideband-only, or mixed sessions.

## Initial Implementation Plan

### Commit 1: Add wideband support specification

Objective:

- capture the architectural boundary before implementation begins

### Commit 2: Add wideband contracts and adapter/session package

Objective:

- introduce the reusable wideband-native abstractions

Expected changes:

- add `WidebandReading`
- add `WidebandSession`
- add `WidebandAdapter`
- add minimal tests for the reading and session contracts where appropriate

### Commit 3: Add extension-side wideband composition seam

Objective:

- prepare the VS Code app to work with wideband adapters independently of ECU logic

Expected changes:

- add a wideband manager or composition module in `apps/vscode/src`
- register wideband adapters separately from ECU protocols
- reuse existing hardware selection/runtime infrastructure

### Commit 4: Implement the first concrete wideband adapter

Objective:

- support one real device family end-to-end

Expected changes:

- add device-family parsing and session logic
- add tests for framing and reading decoding
- add a narrow command/UI flow for connecting and observing readings

## Acceptance Criteria

- Wideband support is modeled through wideband-native abstractions rather than `EcuProtocol`.
- The first reading model is a discriminated union of `lambda` or `afr`.
- Wideband sessions reuse the shared hardware runtime and selection foundation.
- Extension-side wideband composition remains separate from the ECU device manager.
- The first implementation path is narrow enough to land in reviewable commits.
