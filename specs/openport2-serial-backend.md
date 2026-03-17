# OpenPort 2.0 macOS Serial Backend

## Summary

OpenPort 2.0 on macOS desktop should prefer the CDC ACM serial endpoint exposed as `/dev/cu.usbmodem*`. The shared OpenPort transport remains responsible for adapter protocol semantics, while desktop entrypoints inject a serial backend implemented with Node-only dependencies.

This spec now sits beneath the broader shared-hardware architecture described in [`specs/shared-hardware-runtime-foundation.md`](./shared-hardware-runtime-foundation.md). OpenPort serial fallback remains a concrete consumer of that shared foundation rather than the architectural center of all serial-backed hardware support.

## Design

- `packages/device/transports/openport2` owns:
  - `ati`
  - `ata`
  - `ato...`
  - `att...`
  - `AR...` packet parsing
- Desktop entrypoints inject serial runtime support.
- Browser/web runtimes continue to rely on WebUSB, with HID remaining provisional until validated end-to-end.

## Runtime matrix

| Runtime | Preferred OpenPort backend |
|---------|----------------------------|
| VS Code web / browser | WebUSB |
| VS Code desktop on macOS | CDC ACM serial |
| CLI on macOS | CDC ACM serial |
| Other desktop runtimes | transport-specific, not guaranteed |

## Acceptance targets

- `inspect-device list` can enumerate OpenPort over serial.
- `inspect-device raw --transport serial` can complete adapter handshake and raw exchange without hanging.
- VS Code desktop can inject the serial backend without polluting the web build graph with Node-only modules.
- HID remains documented as provisional until validated for connect, probe, log, and ROM-read.

## Current findings

- macOS OpenPort access is reliable through the CDC ACM serial device, not through libusb on this host.
- `ati`, `ata`, `ato6 0 500000 0`, and `atf...` succeed over serial.
- The adapter accepts J2534-style framed writes once CAN headers and filter setup are included.
- ECU RX traffic is still unverified; current experiments only show transmit-side adapter packets and no confirmed ECU response.
- Windows EvoScan decompilation confirms OpenPort 2.0 uses the J2534 `op20pt32.dll` path, while OpenPort 1.3 uses FTDI `FTD2XX.dll`; the two backends should be documented separately.
- EvoScan's ISO15765 setup originally differed from the project's assumptions: it connects with protocol `6`, `flags=0`, starts **`PASS_FILTER` (`filter type 1`)**, then issues `READ_VBATT`, `CLEAR_TX_BUFFER`, and `CLEAR_RX_BUFFER` style `Ioctl` calls around channel setup before normal reads/writes.
- The project transport has since been updated to mirror the `PASS_FILTER` choice and the `READ_VBATT` / local buffer-clear behavior, but ECU RX is still unverified.
- Deeper EvoScan decompilation shows that live logging treats `PassThruReadMsgs` as a low-level byte source, accumulating one J2534 message at a time into higher-level responses in application code.
- The previously noted extra `SET_CONFIG` values are now attributed to EvoScan's `MUTII` branch rather than its ISO15765 branch, so they should not currently be treated as OpenPort 2.0 logging requirements.
- The remaining ISO15765-specific hints are smaller but still relevant: EvoScan likely treats read return codes `9` and `16` as normal poll states (`TIMEOUT` / `BUFFER_EMPTY`), explicitly clears TX/RX buffers after setup, clears RX before at least some writes, and appears to set config `3 = 0` on the ISO15765 branch, which may correspond to `LOOPBACK = 0`.
- That shifts the leading remaining RX hypothesis away from the basic setup sequence and toward receive semantics: parser breadth, tolerated read statuses, and any missing ISO15765-specific monitoring behavior.
- The extracted Mitsubishi "PassThru CAN" payload is more substantial than first assumed: `data2.cab` contains `PTCAN.exe`, `MUT_VCI.dll`, `VciCRepro.dll`, `ptc32.dll`, and `ini_common/ClearDiagCANID.ini`.
- Mitsubishi's tooling confirms `REQ1=7E0` / `RES1=7E8` in `ClearDiagCANID.ini`, so the project's assumed MUT/UDS CAN IDs remain plausible.
- Mitsubishi appears to use a D-PDU / MUT-3 stack (`MUT_VCI.dll`) with queue-clearing and battery-voltage IOCTL concepts similar to the J2534 sequence seen in EvoScan, but it is not a drop-in OpenPort 2.0 J2534 reference.
- Mitsubishi's transport metadata also reinforces session-level expectations that may matter for RX validation: fixed 8-byte CAN padding with `0xFF`, tester-present payload `02 3E 02 FF FF FF FF FF`, and default diagnostic-session lifecycle values corresponding to `10 92` on start and `10 81` on exit.
- Mitsubishi's protocol metadata includes explicit CAN monitoring/filter controls (`CP_CANMONITORING`, `CP_CANMONITORINGFILTER`, `CP_CANMONITORINGIDENTIFIER`) and named response filters for positive, negative, wait, repeat, and tester-present handling. That strengthens the hypothesis that missing RX may be a filtering/monitoring configuration gap rather than a bad request payload.
- Further CAN ID / filter / flag tuning should be driven by an external CAN sniffer capture rather than blind iteration.

## Deferred follow-up

- Compare the project's `readProtocolMessage()` behavior against EvoScan's one-message-at-a-time accumulation model before continuing blind RX experiments.
- Keep EvoScan's `MUTII`-branch `SET_CONFIG` tuning documented for future MUT-II work, but do not mirror it into the ISO15765 serial backend without hardware evidence.
- Decide whether the transport should model EvoScan's likely `TIMEOUT` / `BUFFER_EMPTY` tolerance and ISO15765 `LOOPBACK = 0` behavior, or leave those for hardware-driven validation.
- Reuse the shared device runtime foundation for user-facing multi-device selection and reconnect flows.
- Keep OpenPort-specific transport semantics separate from shared endpoint discovery, persistence, and matching.
- Track wideband and other non-ECU integrations as adapter-level follow-ups on top of the shared device runtime foundation.

## Immediate next diagnosis plan (March 2026)

Based on recent `no ECU response` reports and decompilation-backed transport evidence, the highest-probability regression remains receive-side parser behavior rather than ECU command generation.

### Current top suspicion ordering

1. `readProtocolMessage()` should tolerate fragmented RX and should not depend solely on `PACKET_RX_END` to emit a completed message.
2. Transport read loops should model poll-timeout behavior as non-fatal (`timeout` / `buffer empty` style states) instead of immediate hard failure during streaming.
3. Multi-frame command/read sessions should prioritize accumulation and parsing breadth over strict per-command assumptions.
4. Serial-side explicit buffer management should verify whether `clearTxBuffer()` should issue a true TX-side clear path (currently a no-op in code) and preserve existing read-side clear order.
5. ISO15765 receive behavior should be explicitly validated for `LOOPBACK = 0` and any required CAN monitoring/filter controls after parser adjustments.

### Verification-first milestones

- [ ] Add short-frame logging (hex dump) around `sendFrame()` -> `readProtocolMessage()` and confirm adapter AR payloads are arriving with payload boundaries.
- [ ] Extend parser handling to accumulate until timeout or explicit terminator if terminator is absent, and ensure this does not regress adapter command acknowledgements.
- [ ] Treat the equivalent of `timeout` / `buffer-empty` as expected polling states in streaming contexts.
- [ ] Re-run `inspect-device raw --transport serial` on a command that should generate a known ECU response and compare with earlier “transmit-only” logs.
- [ ] Re-test live data/streaming only after parser changes are validated with raw framing traces.

### Exit criteria for this phase

- A confirmed raw ECU response is observed in logs from a serial raw/inspect flow.
- Streaming path advances without immediate timeout abort when ECU traffic is delayed/spread across fragments.
- No new failures are introduced in existing raw adapter handshake and command flows.
