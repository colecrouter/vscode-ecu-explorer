# EVO X `mitsucan` Flash-Session Research Plan

**Status**: Flash-session key solved and implemented; traced dry runs now cover the BA branch through the `0x31 E0 -> 0x7F 0x31 0x78` continuation boundary and the D4 reset branch through positive reset acknowledgement  
**Target ECU**: Mitsubishi 4B11T (Lancer Evolution X), Renesas M32186F8  
**EcuFlash method**: `mitsucan`  
**Last updated**: 2026-03-28

## Current Understanding

Live CAN traces captured on 2026-03-27 and 2026-03-28 show the flash path uses:

1. ECU identification / preflight requests
2. `0x10 0x92`
3. `0x10 0x85`
4. `0x27 0x05` requestSeed
5. `0x27 0x06` sendKey
6. `0x3B 0x9A`
7. `0x34 0x20 00 00 01 00 00 02` then a tiny `0x36` branch token (`BA 02` or `D4 D4`) and `0x37`
8. `0x34 0x80 85 38 01 00 00 D0`
9. first traced bulk `0x36 0xCC ...` block
10. `0x37`
11. `0x31 E1 01` on the traced BA branch

The flash-session key for the traced `0x05/0x06` exchange is now solved and implemented.

## Confirmed Trace Facts

The repository test corpus now includes 157 unique observed seed/key pairs from local, non-repo CAN trace captures.

Sample pairs:

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
- the tiny `BA` and `D4` transfer tokens are distinct branch selectors, not random payload variation
- the real-write BA branch reaches `0x31 E1 01` after the first `0x36 0xCC ...` bulk block
- the `D4` branch reaches `0x31 E1 02` and is observed with `0x7F 0x31 0x78` response-pending before `0x71 E1 00`
- after `0x71 E1 00`, the clean D4 branch in the concrete write captures immediately issues `0x11 0x01` (ECUReset), receives `0x7F 0x11 0x78`, then a positive `0x51` reset acknowledgement
- after the positive reset acknowledgement, the traces switch to functional-broadcast recovery traffic (`0x3E 0x02`, `0x10 0x81`, `0x10 0x92`) before ECU identification resumes
- this D4/reset sequence is the strongest current protocol-level candidate for the "exiting programming mode" stage described in EcuFlash logs, but that mapping remains an inference from traces plus logs
- on the BA continuation side, `0x31 E1 01` is consistently followed by `0x31 E0`, `0x7F 0x31 0x78`, then a 251-byte ISO-TP request starting `0x3E 0x3D 0x1E 0xD6 0x75 0xBA ...`, followed by a large `0x5B ...` ECU response
- the BA-side 251-byte `0x3E 0x3D ...` request and matching long ECU response are not byte-identical across `ecu write 1`, `ecu write 2`, and `ecu write test 1`, so they should be treated as an observed payload family rather than a single reusable constant
- the first observed BA payload family splits into at least two concrete paired variants:
  - `ecu write 1` uses one BA continuation family
  - `ecu write 2` and `ecu write test 1` use a second BA continuation family with the same overall 251-byte shape and only a 21-byte window changed between the two captured requests
- because `ecu write test 1` matches `ecu write 2` at this boundary while its overall image-diff targets match the opposite real-write direction, the first BA payload family does not appear to be selected by "test write" versus "real write" alone
- the stable transcript prefix leading into this split (`0x31 E1 01 -> 0x71 E1 00 -> 0x31 E0 -> 0x7F 31 78`) is identical across all three captures, so the selector likely lives outside that prefix
- the same comparison suggests the BA payload-family selector depends on a deeper internal write sub-stage or data-dependent state, not simply on whether the operation is a dry/test flash or on the coarse FB10/FB16 image-diff direction alone
- the session-test corpus is dominated by exact matches to the `ecu write 2` BA request shape; the remaining session-test outliers keep the same `0x3E 0x3D 0x1E 0xD6 0x75 0xBA ...` skeleton but look reordered or truncated, so they are currently treated as transcript-export/pairing artifacts rather than a third stable BA family
- direct `.candump` parsing shows the BA continuation is not "one long request followed by one long ECU response"; instead, after `0x31 E0 -> 0x7F 0x31 0x78`, the tester sends a burst of many 251-byte ISO-TP blocks while the ECU only returns flow-control frames during the burst
- after that tester burst, the first stable ECU payload in the concrete write traces is a 44-byte multi-frame response beginning `0x81 0x4F 0x70 0x65 0x6E 0x45 0x43 0x55 ...`, i.e. the ASCII kernel banner `OpenECU Mitsubishi M32186 CAN Kernel V1.09\x00`
- this raw-dump view matches the EcuFlash logs' `-- connecting to kernel --` / `kernel get version` stage and suggests the BA branch is transitioning from bootloader staging into kernel upload/handshake, not directly into a single ECU response family

## Solved Flash Key Algorithm

The traced flash-session key derivation implemented in `packages/device/protocols/mut3/src/security.ts` is:

```text
affine(x) = (0x89 * x + 0xD2) & 0xFF

key[1] = affine(seed[1])
key[3] = affine(seed[3])
key[0] = (affine(seed[0]) + 0x8F + (((0x89 * seed[1] + 0xD0) >>> 8) & 0xFF)) & 0xFF
key[2] = (affine(seed[2]) + 0x8F + (((0x89 * seed[3] + 0xD1) >>> 8) & 0xFF)) & 0xFF
```

This formula matches all 157 committed fixture pairs exactly.

## What Is No Longer Unknown

These items are now confirmed:

- The EVO X MUT-III flash session is not blocked on missing traffic captures
- The flash-session SecurityAccess level is `0x05/0x06`
- The flash flow uses session changes before key exchange
- `0x3B 0x9A` is part of the observed write path
- Download/transfer traffic follows the security exchange

## What Is Still Unknown

These items remain open:

- The exact semantic meaning of the `0x3B 0x9A` payload
- The exact semantic role of the `BA` vs `D4` branch selector tokens
- Whether a complete native direct-write path exists after `0x31 E0`, or whether the traced EcuFlash/OpenECU method fundamentally relies on the RAM-resident kernel handoff
- The exact OpenECU kernel command set after the BA-side handoff
- The exact consequence of the D4-side `0x31 E1 02 -> 0x11 0x01 -> 0x51` transition
- How to model the post-reset functional-broadcast recovery traffic in production code
- The exact shape the final `mut3.writeRom()` implementation should take in this repo

## Implementation Priorities

1. Keep specs and transcript-driven tests aligned as new branch facts are confirmed.
2. Treat the kernel handoff after the BA branch as the primary known gap for `writeRom()`.
3. Determine whether a complete native direct-write continuation exists without the OpenECU kernel.
4. If direct write does not materialize, model the kernel command set and handoff explicitly.
5. Implement `writeRom()` only after one of those end-to-end paths is defensibly modeled.

## Immediate Constraints

- Reverse-engineering helper scripts and ad hoc analysis tools stay local and must not be committed.
- Reusable test fixtures and repo-facing protocol tests are fine to commit.
- The repository should not retain stale flash-path claims in specs or code comments.

## Related Files

- [`specs/HANDSHAKE_ANALYSIS.md`](./HANDSHAKE_ANALYSIS.md)
- [`packages/device/protocols/mut3/src/security.ts`](../packages/device/protocols/mut3/src/security.ts)
- [`packages/device/protocols/mut3/src/index.ts`](../packages/device/protocols/mut3/src/index.ts)
- [`packages/device/protocols/mut3/test/`](../packages/device/protocols/mut3/test/)
