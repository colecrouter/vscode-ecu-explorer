# MUT3 CAN-Primary Logging Strategy

## Summary

The shipping MUT-III live-data path should be CAN-first, profile-driven, and backend-aware.

The current raw Mode 23 implementation is valuable because it proved the OpenPort serial/CAN transport, session control, and live polling loop on real hardware. It should remain in the codebase only as commented or internal research scaffolding for now. It should not remain an exposed fallback or production abstraction for MUT-III logging.

The reason is profile drift. EvoScan XML request IDs vary across year, market, and application variants, even within closely related Evo X files. A single hardcoded Mode 23 address map is therefore not a stable production contract.

The XML set also shows that some files are mixed-backend profiles, not clean one-backend bundles. A mostly-Mode23 profile may still embed `CANx-y` channels for transmission data and `WDB` channels for external wideband input. The importer therefore has to model backend kind per channel, not just per file.

Implementation update:

- the repo now contains a normalized EvoScan parser and a built-in `Mitsubishi EvoX CAN MUTIII` channel catalog
- the repo now also includes a CLI inspection tool for real EvoScan XML files:
  - `npm run tools:inspect-mut3-profile -- --xml "<path-to-xml>"`
- `Mut3Protocol.getSupportedPids()` now exposes that built-in CAN profile for `openport2`
- decompilation of `EvoScanV3.1.exe` now shows that `CANx-y` is parsed as a real runtime concept:
  - `x` is a bank index
  - `y` is a slot within that bank
  - the logger caches one 12-byte response per bank and reads channel values from byte positions derived from that slot
- live execution is still blocked only by the unresolved bank lookup table values, not by the higher-level executor shape

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
- decode formulas (`Eval`, `MetricEval`)
- unit metadata (`Unit`, `MetricUnit`)
- optional secondary request token (`RequestID2`)
- source provenance (`trace-confirmed`, `xml-derived`, `ambiguous`, `manual`)

### 3. Logging backend abstraction

Profiles should select a backend explicitly. At minimum:

- `mutiii-can`
- `mode23`
- `rax-kline`
- `calc`

This avoids forcing all CAN logging through the current Mode 23 implementation when EvoScan may actually be using a different request family.

### 3a. EvoScan importer model

The importer should preserve the request family exactly as encoded in the XML:

- `CANx-y` -> `mutiii-can`
- `2380....` style request tokens -> `mode23`
- `CALC` -> `calc`
- `WDB` -> external wideband source
- other request token formats -> opaque/manual review

The current repo-side model lives in:

- [`packages/device/protocols/mut3/src/logging-profiles.ts`](../packages/device/protocols/mut3/src/logging-profiles.ts)

That model intentionally separates:

- profile metadata
- normalized channel keys
- backend-aware request definitions
- decode/unit metadata
- provenance

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
- This is now partially implemented in:
  - [`packages/device/protocols/mut3/src/logging-profiles.ts`](../packages/device/protocols/mut3/src/logging-profiles.ts)
  - [`packages/device/protocols/mut3/src/mutiii-can-profile.ts`](../packages/device/protocols/mut3/src/mutiii-can-profile.ts)

### Phase 3: Add backend-aware execution

- Refactor `Mut3Protocol.streamLiveData()` so CAN logging dispatches by selected logging backend, not by transport alone.
- Support `mutiii-can` and later other executors as separate backends.

Recovered executor model from EvoScan decompilation:

- `CANx-y` is not passive symbolic naming and not one-request-per-channel.
- EvoScan parses `CANx-y` into:
  - a resolved bank key string
  - a slot index
- EvoScan sends one CAN/J2534 request per bank, waits for a matching response header, and caches the returned 12-byte payload by bank.
- Channels in the same bank then read their data from the cached response using `slot`-based indexing, most commonly `reply[7 + slot]` for single-byte values and nearby multi-byte extraction patterns for larger fields.
- This means the production backend should be built around grouped bank polling, not around a flat PID table.

Remaining blocker:

- the built-in `CAN MUTIII` profile is modeled correctly enough to expose channels and synthetic PIDs
- but the bank lookup arrays inside EvoScan are still obfuscated, so we do not yet know the concrete bank request strings for every `CANx-y` family
- until that bank table is recovered from decompilation, interception, or runtime evidence, the runtime should fail explicitly rather than pretending the XML is executable by itself

Runtime evidence update from paired EvoScan CSV + raw CAN capture (`2026-03-30`):

- a real EvoScan `Mitsubishi EvoX CAN MUTIII` session was captured with both:
  - a CAN dump containing request/response traffic
  - the paired EvoScan CSV export from the same session
- the CSV channel set matches the built-in CAN catalog exactly enough to treat the session as strong `mutiii-can` evidence
- the wire requests are short `0x21xx` requests, not `0x23 0x80 ...` `mode23` memory reads
- only 14 unique request payloads were observed for 31 logged channels
- this strongly supports the banked/grouped request model:
  - one request feeds several visible channels
  - `CANx-y` should still be treated as a bank-plus-slot family rather than one-request-per-channel

What the capture does and does not prove:

- high confidence:
  - `CANx-y` is backed by grouped `0x21xx` request families
  - several stable request groups can now be discussed concretely:
    - `0x2108` appears to carry the current `CAN11`-style timing/knock family
    - `0x2107` appears to carry the trim family
    - `0x2105` appears to carry the injector pulse width family
    - `0x2103` appears to carry the boost/MAP family
    - `0x210A`, `0x2112`, `0x2118`, and `0x2114` also show useful channel-group structure
- lower confidence:
  - the current per-channel labels and slot assignments in the built-in profile are globally correct
  - the captured session produced several physically implausible channel equivalences, such as:
    - `Battery = TargetIdleRPM`
    - `TPS = RPM`
    - `AirTemp = CoolantTemp`
    - `VVTIntake = VVTExhaust`
    - `ISCLearnACon = AirFlow`
  - that strongly suggests the current built-in label/slot table is still provisional even though the grouped-request model is likely correct

Current interpretation:

- trust the grouped request family evidence more than the current human-readable labels
- treat the existing `mutiii-can-profile.ts` channel naming as a research scaffold, not as a confirmed production mapping
- future captures should be designed to break ambiguous pairs apart by intentionally selecting channels whose physical behavior diverges under simple state changes

Proposed executor shape:

1. Group selected channels by `mutiii-can` bank.
2. Resolve each bank to its concrete request string from imported profile data.
3. Send one 12-byte CAN request per bank.
4. Wait for the expected response header for that bank.
5. Cache the 12-byte bank response for this polling cycle.
6. Decode each channel in the bank from its cached response using the imported slot and response-width metadata.

Data model requirement:

- `mutiii-can` request definitions should store at least:
  - `bankFamily`
  - `bankIndex`
  - `slot`
  - `responseBytes`
  - `endianness` or extraction mode when needed
  - optional concrete `requestHex` once recovered
  - optional `expectedResponseHeader` once recovered

### Phase 4: Expose selection in CLI and UI

- CLI: accept profile/backend selection for `inspect-device log`
- UI: surface profile choice or robust inference before starting CAN logging

## Acceptance Criteria

- CAN logging is the default production MUT-III live-data path.
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
