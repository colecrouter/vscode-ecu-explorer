# MUT3 CAN-Primary Logging Strategy

## Summary

The shipping MUT-III live-data path should be CAN-first, profile-driven, and backend-aware.

The current raw Mode 23 implementation is valuable because it proved the OpenPort serial/CAN transport, session control, and live polling loop on real hardware. It should remain in the codebase only as commented or internal research scaffolding for now. It should not remain an exposed fallback or production abstraction for MUT-III logging.

The reason is profile drift. EvoScan XML request IDs vary across year, market, and application variants, even within closely related Evo X files. A single hardcoded Mode 23 address map is therefore not a stable production contract.

## Problem

Today, `Mut3Protocol` chooses the CAN live-data path by transport:

- `openport2` -> traced raw Mode 23 polling
- `kline` -> RAX `E0/E5/E1` polling

That is enough to prove functionality, but it bakes in the wrong abstraction boundary:

- it assumes one globally stable CAN request map
- it does not model EvoScan's symbolic `CANx-y` / "MUTIII CAN" family as a separate backend
- it does not let UI/CLI choose or infer a logging profile
- it does not track confidence/provenance of imported channels

## Goals

- Ship CAN logging as the primary MUT-III live-data path.
- Support multiple EvoScan-style CAN request families without rewriting the transport/session layer.
- Normalize channel identity across profiles so UI and logs do not depend on raw request IDs.
- Make per-profile drift explicit rather than pretending one map fits all cars.

## Non-Goals

- Delete the low-level Mode 23 research helpers.
- Replace the working OpenPort serial transport/session implementation.
- Collapse all MUT-III logging backends into one synthetic universal request family.

## Proposed Model

### 1. Canonical channel catalog

Create a canonical MUT-III channel catalog with stable identities such as:

- `RPM`
- `Boost`
- `ECT`
- `IAT`
- `Battery`
- `TPS`
- `MAF Airflow`

The catalog owns:

- display name
- normalized unit
- decoder/scaling
- aliases
- optional grouping and presentation metadata

### 2. Profile-bound request maps

Each supported EvoScan profile contributes a request map from canonical channels to request definitions.

Examples:

- `2011 USDM Evo X GSR`
- `2012 USDM Evo X GSR`
- future JDM / EDM / SST / ROM-specific variants

Each mapping entry should include:

- canonical channel id
- backend kind
- request identifier or address
- response size / extraction metadata
- source provenance (`trace-confirmed`, `xml-derived`, `ambiguous`, `manual`)

### 3. Logging backend abstraction

Profiles should select a backend explicitly. At minimum:

- `mode23`
- `mutiii-can`
- `rax-kline`

This avoids forcing all CAN logging through the current Mode 23 implementation when EvoScan may actually be using a different request family.

### 4. Profile selection

UI and CLI should ask for or infer a logging profile, not merely a protocol.

For example:

- protocol: `MUT-III`
- profile: `2011 USDM Evo X GSR`
- backend: `mutiii-can`

Fallback behavior:

- if profile unknown, do not silently fall back to the current hardcoded Mode 23 map
- if profile known but backend partially supported, fail explicitly rather than exposing misleading data

## Implementation Direction

### Phase 1: Stabilize the current CAN foundation

- Keep the working OpenPort serial transport/session path.
- Keep the current raw Mode 23 code available only as disabled/internal scaffolding.
- Do not expose the existing hardcoded Mode 23 table as a selectable or automatic fallback.

### Phase 2: Import EvoScan profile data

- Parse EvoScan MUT-III XML files into profile-bound request maps.
- Normalize channels into the canonical catalog.
- Preserve per-profile request drift instead of flattening it away.

### Phase 3: Add backend-aware execution

- Refactor `Mut3Protocol.streamLiveData()` so CAN logging dispatches by selected logging backend, not by transport alone.
- Support `mode23` and later `mutiii-can` as separate executors.

### Phase 4: Expose selection in CLI and UI

- CLI: accept profile/backend selection for `inspect-device log`
- UI: surface profile choice or robust inference before starting CAN logging

## Acceptance Criteria

- CAN logging is the default production MUT-III live-data path.
- Raw Mode 23 remains available as an explicit fallback/debug path.
- At least one EvoScan-derived CAN profile is imported without flattening profile-specific request IDs into a fake universal map.
- The logging runtime can distinguish between `mode23` and `mutiii-can` backends.
- UI/CLI can identify which profile/backend is active.
- Channel provenance is visible in code or imported metadata.

## Immediate Next Step

Implement a profile data model first, before further expanding the hardcoded Mode 23 table.

That gives the project a place to put:

- per-profile request drift
- future `CANx-y` mappings
- normalized channels
- confidence metadata

Without that layer, every new CAN channel added today increases the risk that the temporary bring-up table gets mistaken for a production logging contract.
