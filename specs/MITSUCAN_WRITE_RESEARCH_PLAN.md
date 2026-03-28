# EVO X `mitsucan` Flash-Session Research Plan

**Status**: CAN capture completed; flash-session flow confirmed; key algorithm still unresolved  
**Target ECU**: Mitsubishi 4B11T (Lancer Evolution X), Renesas M32186F8  
**EcuFlash method**: `mitsucan`  
**Last updated**: 2026-03-27

## Current Understanding

Live CAN traces captured on 2026-03-27 show the flash path uses:

1. ECU identification / preflight requests
2. `0x10 0x92`
3. `0x10 0x85`
4. `0x27 0x05` requestSeed
5. `0x27 0x06` sendKey
6. `0x3B 0x9A`
7. `0x34` / `0x36` download and transfer traffic

The flash-session key is tied to the traced `0x05/0x06` exchange.

## Confirmed Trace Facts

The following seed/key pairs were observed in local, non-repo CAN trace captures:

| Seed (`0x67 0x05`) | Key (`0x27 0x06`) | Source capture |
|---|---|---|
| `8F B2 CE F1` | `48 14 20 CB` | `ecu write 1` |
| `7B 38 68 8F` | `52 CA 56 59` | `ecu write 1` |
| `C4 32 D5 71` | `60 94 9B 4B` | `ecu write 2` |
| `7A 00 62 77` | `AB D2 13 81` | `ecu write 2` |
| `36 F2 13 31` | `C9 54 A7 0B` | `ecu write test 1` |
| `7E E0 7A D7` | `47 B2 1E E1` | `ecu write test 1` |
| `7C 70 6E A7` | `F9 C2 99 31` | `ecu read 1` |

The traces also show:

- `0x10 0x85` may return `0x7F 0x10 0x78` before the positive response
- `0x3B 0x9A` occurs before download starts
- `0x34` and `0x36` traffic are present after security access is granted

## What Is No Longer Unknown

These items are now confirmed:

- The EVO X MUT-III flash session is not blocked on missing traffic captures
- The flash-session SecurityAccess level is `0x05/0x06`
- The flash flow uses session changes before key exchange
- `0x3B 0x9A` is part of the observed write path
- Download/transfer traffic follows the security exchange

## What Is Still Unknown

These items remain open:

- The algorithm that maps each 4-byte `0x05` seed to the 4-byte `0x06` key
- The exact semantic meaning of the `0x3B 0x9A` payload
- The exact shape the final `mut3.writeRom()` implementation should take in this repo

## Implementation Priorities

1. Add transcript-driven tests that lock in the traced session shape:
   - `0x10 0x92`
   - `0x10 0x85`
   - `0x27 0x05/0x06`
   - `0x3B 0x9A`
   - `0x34` / `0x36`
2. Add fixtures for the captured seed/key pairs.
3. Derive the `0x05/0x06` key algorithm from the captured pairs.
4. Implement the flash-session key function in `packages/device/protocols/mut3/src/security.ts`.
5. Implement `writeRom()` around the traced session flow.

## Immediate Constraints

- Reverse-engineering helper scripts and ad hoc analysis tools stay local and must not be committed.
- Reusable test fixtures and repo-facing protocol tests are fine to commit.
- The repository should not retain stale flash-path claims in specs or code comments.

## Related Files

- [`specs/HANDSHAKE_ANALYSIS.md`](./HANDSHAKE_ANALYSIS.md)
- [`packages/device/protocols/mut3/src/security.ts`](../packages/device/protocols/mut3/src/security.ts)
- [`packages/device/protocols/mut3/src/index.ts`](../packages/device/protocols/mut3/src/index.ts)
- [`packages/device/protocols/mut3/test/`](../packages/device/protocols/mut3/test/)
