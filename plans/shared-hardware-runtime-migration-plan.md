# Shared Hardware Runtime Migration Plan

## Goal

Adapt the current OpenPort-centric implementation to the shared hardware runtime architecture described in [`specs/shared-hardware-runtime-foundation.md`](../specs/shared-hardware-runtime-foundation.md), while:

- preserving current OpenPort behavior during the transition
- keeping desktop-only runtime code isolated and tree-shakeable
- retaining mirrored and shared logic in the diagnostic/help tools under [`packages/tools`](../packages/tools)
- shipping the migration across multiple reviewable commits instead of one large refactor

## Problem Summary

Today the repository already contains the ingredients of the future architecture, but they are spread across ECU-focused and tool-specific locations:

- desktop serial discovery and normalization live in [`apps/vscode/src/desktop-serial.ts`](../apps/vscode/src/desktop-serial.ts)
- OpenPort desktop serial runtime wiring lives in [`apps/vscode/src/openport2-desktop-runtime.ts`](../apps/vscode/src/openport2-desktop-runtime.ts)
- the extension owns device selection and persistence through [`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts) and [`apps/vscode/src/workspace-state.ts`](../apps/vscode/src/workspace-state.ts)
- the diagnostic/help tooling in [`packages/tools/inspect-device.js`](../packages/tools/inspect-device.js) mirrors some of the same host-runtime logic independently

Without a staged plan, the project risks:

- duplicating serial runtime logic between the extension and tools
- baking non-ECU hardware concerns into ECU-only abstractions
- increasing TypeScript target friction by mixing Node-only code into web-oriented packages
- making the OpenPort migration harder to review because behavior and architecture would change at the same time

## Architecture Direction

The target model is:

- one USB backend per host family where justified
- one project-owned serial runtime contract per host family
- a shared hardware/runtime foundation above host APIs
- device-family adapters above the runtime foundation
- ECU-specific and non-ECU-specific workflows above the adapters

For the near term, the most important practical rule is:

- shared host/runtime logic should be authored once and consumed by both the extension and the diagnostic/help tools

## Scope

In scope:

- extracting shared runtime contracts for serial and hardware identity
- moving desktop serial endpoint logic into a reusable shared location
- updating the extension to consume the shared runtime foundation
- updating the help tools to consume the same shared runtime logic
- keeping OpenPort runtime behavior stable while the structure changes
- documenting commit-by-commit migration steps and verification expectations

Out of scope:

- implementing wideband device support
- rewriting all device selection UI in a single pass
- introducing Node USB support unless a concrete follow-up commit justifies it
- changing OpenPort protocol semantics beyond the minimum required for runtime extraction

## Constraints

- The repository primarily targets web-compatible TypeScript builds.
- Node-only code must remain isolated from web bundles and tree-shake cleanly.
- Existing CLI/help tools must continue to mirror relevant extension-side runtime behavior.
- The migration should preserve the current OpenPort serial fallback on macOS.
- Each commit should be reviewable and leave the repository in a working state.

## Shared Logic Policy

To retain mirrored/shared logic in the help tools, the migration should follow this rule:

- if host/runtime behavior is needed by both the extension and a help tool, extract it into shared code instead of copying it

Examples:

- serial endpoint normalization
- stable hardware identity generation
- duplicate path ranking such as `/dev/cu.*` vs `/dev/tty.*`
- adapter matching metadata
- reusable serial runtime interfaces

The tools may still own:

- CLI-only argument parsing
- CLI-only formatting and tracing output
- standalone Node bootstrap code

## Proposed Package and File Direction

Preferred shared locations:

- shared runtime contracts and identity helpers in a reusable package, likely under `packages/`
- Node-specific runtime implementations in a Node-safe package or Node-only entrypoints
- VS Code composition and persistence wiring remaining in `apps/vscode`
- CLI/help tool orchestration remaining in `packages/tools`

The exact package naming can be finalized during implementation, but the split should preserve tree-shakeable boundaries between:

- shared contracts
- Node-only runtime implementations
- extension-specific composition
- CLI/help tool composition

## Commit-by-Commit Plan

### Commit 1: Introduce shared runtime contracts and identity helpers

Objective:

- add the minimum shared types needed to stop re-describing the runtime boundary differently in each place

Expected changes:

- add shared contracts for:
  - serial runtime
  - serial port info and sessions
  - hardware identity
  - selection records or adapter identity payloads
- add shared helpers for:
  - USB identifier normalization
  - stable hardware identity generation
  - preferred path ranking

Likely touchpoints:

- new shared package or module under `packages/`
- minimal type-only imports in:
  - [`apps/vscode/src/desktop-serial.ts`](../apps/vscode/src/desktop-serial.ts)
  - [`apps/vscode/src/workspace-state.ts`](../apps/vscode/src/workspace-state.ts)
  - [`packages/tools/inspect-device.js`](../packages/tools/inspect-device.js)

Verification:

- `npm run check`
- focused test additions for identity/path helpers

### Commit 2: Extract reusable Node serial runtime implementation

Objective:

- move the desktop serial implementation out of the VS Code app layer into shared, reusable Node-only code

Expected changes:

- extract:
  - serial enumeration
  - duplicate-path grouping
  - Node serial session open/read/write lifecycle
- keep the project-owned serial runtime contract as the only API seen by higher layers

Likely touchpoints:

- shared Node-only runtime module under `packages/`
- [`apps/vscode/src/openport2-desktop-runtime.ts`](../apps/vscode/src/openport2-desktop-runtime.ts)
- [`packages/tools/inspect-device.js`](../packages/tools/inspect-device.js)

Verification:

- `npm run check`
- `npm run test`
- confirm desktop serial runtime code is no longer duplicated between app and tools

### Commit 3: Rewire OpenPort desktop runtime to consume the shared serial runtime

Objective:

- preserve current OpenPort behavior while making it a consumer of the shared runtime rather than the owner of it

Expected changes:

- simplify [`apps/vscode/src/openport2-desktop-runtime.ts`](../apps/vscode/src/openport2-desktop-runtime.ts) to compose:
  - shared Node serial runtime
  - OpenPort-specific matcher/filtering
- keep existing matching and path preference behavior unless tests prove a safe change

Likely touchpoints:

- [`apps/vscode/src/openport2-desktop-runtime.ts`](../apps/vscode/src/openport2-desktop-runtime.ts)
- [`packages/device/transports/openport2/src/index.ts`](../packages/device/transports/openport2/src/index.ts)
- OpenPort transport tests

Verification:

- `npm run check`
- `npm run test -w packages/device/transports/openport2`

### Commit 4: Rewire diagnostic/help tools to the same shared runtime foundation

Objective:

- keep tool behavior mirrored with the extension by consuming the same shared runtime modules

Expected changes:

- replace tool-local copies of serial identity/discovery logic with shared imports
- keep CLI/bootstrap behavior local to the tool
- preserve current output and diagnostics behavior

Likely touchpoints:

- [`packages/tools/inspect-device.js`](../packages/tools/inspect-device.js)
- tool-local helpers that duplicate runtime behavior

Verification:

- `npm run check`
- `npm run tools:inspect-device -- connect --verbose`
  - use a safe dry diagnostic command or equivalent local tool probe where hardware is available

### Commit 5: Generalize selection persistence around shared hardware identity

Objective:

- make persistence adapter-aware and hardware-oriented without entangling it with ECU-only semantics

Expected changes:

- reshape persisted selection data in [`apps/vscode/src/workspace-state.ts`](../apps/vscode/src/workspace-state.ts) as needed
- add migration-safe sanitization for older persisted state
- keep current OpenPort selection behavior intact

Likely touchpoints:

- [`apps/vscode/src/workspace-state.ts`](../apps/vscode/src/workspace-state.ts)
- [`apps/vscode/test/workspace-state.test.ts`](../apps/vscode/test/workspace-state.test.ts)
- possibly [`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts)

Verification:

- `npm run check`
- `npm run test -- workspace-state.test.ts`

### Commit 6: Introduce shared hardware selection composition in the extension

Objective:

- prepare the extension for future non-ECU hardware without forcing the entire workflow into `DeviceManagerImpl`

Expected changes:

- add extension-side composition for:
  - listing hardware candidates
  - restoring persisted selections
  - resolving runtime sessions from shared identities
- keep ECU-specific protocol detection above this layer

Likely touchpoints:

- new extension composition module under `apps/vscode/src/`
- [`apps/vscode/src/device-manager.ts`](../apps/vscode/src/device-manager.ts)
- selection-related tests

Verification:

- `npm run check`
- `npm run test`

### Commit 7: Documentation and follow-up cleanup

Objective:

- close the migration loop with architecture docs and implementation notes

Expected changes:

- update:
  - [`specs/openport2-serial-backend.md`](../specs/openport2-serial-backend.md)
  - [`specs/shared-hardware-runtime-foundation.md`](../specs/shared-hardware-runtime-foundation.md)
  - optionally [`ARCHITECTURE.md`](../ARCHITECTURE.md) if the package boundaries materially change

Verification:

- `npm run check`
- `npm run test`

## Suggested Commit Messages

Examples:

- `refactor(runtime): add shared hardware runtime contracts`
- `refactor(runtime): extract node serial runtime`
- `refactor(openport2): consume shared serial runtime`
- `refactor(tools): reuse shared hardware runtime logic`
- `refactor(vscode): persist shared hardware identities`
- `docs(runtime): update shared hardware runtime architecture`

## Testing Strategy

Unit tests should focus on stable reusable behavior first:

- hardware identity generation
- path ranking and duplicate grouping
- persistence sanitization and compatibility
- OpenPort matching behavior after extraction

Integration and workflow verification should cover:

- extension-side device enumeration
- help tool parity with extension runtime behavior
- no accidental Node-only leakage into web-targeted build paths

## Risks and Mitigations

### Risk: shared extraction breaks tree-shaking or target boundaries

Mitigation:

- keep shared contracts separate from Node implementations
- prefer small modules with explicit entrypoints
- run `npm run check` after each stage

### Risk: extension and tools silently drift again

Mitigation:

- extract shared host/runtime logic first
- keep tool-specific code limited to orchestration and output
- add tests around the extracted helpers instead of duplicate behavior tests

### Risk: OpenPort behavior changes during architectural cleanup

Mitigation:

- preserve matcher behavior and serial fallback semantics until after extraction is complete
- keep protocol changes out of these commits unless strictly necessary

## Definition of Done

- shared runtime contracts exist and are consumed by both the extension and help tools where appropriate
- Node serial runtime logic is no longer duplicated across the extension and help tooling
- OpenPort desktop serial fallback still works through the new structure
- persisted selection data is shaped around shared hardware identity rather than ECU-only assumptions
- the migration lands through multiple reviewable commits with passing checks at each stage
