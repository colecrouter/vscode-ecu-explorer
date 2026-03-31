# MUT3 Logging System Model

## Summary

MUT-III logging needs three separate concepts:

1. `transport/session`
2. `request family`
3. `decode family`

Earlier shorthand like "RAX means K-line" is not accurate enough for the current XML and decompilation evidence.

## Why This Matters

The EvoScan data set mixes several ideas that were previously being flattened together:

- `CANx-y` in `Mitsubishi EvoX CAN MUTIII.xml`
- raw `2380....` Mode 23 requests in multiple `Mode23` files
- `CALC` channels derived from other raw blocks
- `WDB` external wideband channels
- `RAX` block names inside `Mitsubishi EvoX Mode23 RAX Patch.xml`

That means names like `RAX` are not sufficient by themselves to tell us transport or wire format.

## Corrected Model

### 1. Transport / Session

This answers: "How do we talk to the ECU?"

Examples:

- `can-iso15765`
- `kline`

This layer owns:

- adapter selection
- session control
- security access
- read/write frame transport

### 2. Request Family

This answers: "What kind of request token do we send?"

Examples:

- `mutiii-can-bank`
- `mode23`
- future opaque/vendor request families

This layer owns:

- request construction
- response matching
- polling grouping
- bank/cache behavior

### 3. Decode Family

This answers: "How do we turn the response into channel values?"

Examples:

- `direct-scalar`
- `rax-bitfield-calc`
- generic `formula-calc`
- `external-wideband`

This layer owns:

- byte extraction
- bitfield extraction
- endianness
- eval / metric eval formulas
- unit normalization

## What RAX Means

`RAX` should be treated as a decode/profile family, not a transport.

Evidence:

- [`Mitsubishi EvoX Mode23 RAX Patch.xml`](/Users/colecrouter/Library/CloudStorage/OneDrive-Personal/Documents/EvoScan%20v2.9/DataSettings/Mitsubishi%20EvoX%20Mode23%20RAX%20Patch.xml)
  contains raw block requests like `238051ac`, `238051a8`, `238051b0`, etc.
- Those are `mode23` requests over CAN, not K-line requests.
- The visible channels in that file are mostly `CALC` channels derived from those raw `RAX_*_Dat` blocks with `BITS(...)` formulas.

So a better interpretation is:

- `RAX` = a block layout and calculation scheme
- not = a transport
- not = automatically K-line

## Example Mappings

### Evo X CAN MUTIII

- transport/session: `can-iso15765`
- request family: `mutiii-can-bank`
- decode family: mostly `direct-scalar`

Evidence update from paired EvoScan CSV + CAN capture:

- the observed wire traffic for a real `Mitsubishi EvoX CAN MUTIII` logging session used short `0x21xx` requests rather than `mode23` `0x23 0x80 ...` memory reads
- only 14 unique requests were observed while EvoScan logged 31 visible channels
- this is strong evidence that the request family is genuinely banked/grouped and that several visible channels are decoded from the same reply
- however, the same capture also showed several implausible channel equalities in the exported CSV, which means the currently modeled labels/slots should still be treated as provisional research data rather than confirmed semantics

### Evo X Mode23 USA

- transport/session: `can-iso15765`
- request family: `mode23`
- decode family: mostly `direct-scalar`
- mixed with a few `mutiii-can-bank` channels and `external-wideband`

### Evo X Mode23 RAX Patch

- transport/session: `can-iso15765`
- request family: `mode23`
- decode family: `rax-bitfield-calc`
- mixed with `external-wideband`

### Future K-line RAX Path

If implemented later, it should be modeled as:

- transport/session: `kline`
- request family: whatever the K-line logger actually uses
- decode family: potentially `rax-bitfield-calc`

That preserves the important point:

- the same decode family may appear on more than one transport/request path

## Practical Consequence For Implementation

The system should not model logging as a single enum like:

- `mutiii-can`
- `mode23`
- `rax-kline`

That collapses too many dimensions.

Instead, the long-term model should let a channel or profile describe:

- `transportFamily`
- `requestFamily`
- `decodeFamily`

The current codebase does not need to perform that full refactor immediately, but future executor work should avoid baking in assumptions that `RAX` implies K-line.

## Immediate Engineering Guidance

- `mutiii-can` scaffold work can continue as the primary CAN shipping path.
- `mode23` should stay modeled but non-shipping for now.
- `RAX Patch` should be treated as proof that `RAX` logic can sit on top of `mode23`.
- Future architectural cleanup should split current backend ideas into:
  - transport/session
  - request family
  - decode family
