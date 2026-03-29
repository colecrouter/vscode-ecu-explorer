# OpenPort 2.0 macOS Serial Backend

## Summary

OpenPort 2.0 on macOS desktop should prefer the CDC ACM serial endpoint exposed as `/dev/cu.usbmodem*`. The shared OpenPort transport remains responsible for adapter protocol semantics, while desktop entrypoints inject a serial backend implemented with Node-only dependencies.

This spec now sits beneath the broader shared-hardware architecture described in [`specs/shared-hardware-runtime-foundation.md`](./shared-hardware-runtime-foundation.md). OpenPort serial fallback remains a concrete consumer of that shared foundation rather than the architectural center of all serial-backed hardware support.

## References

- Atlas native OpenPort serial driver: <https://github.com/nonnatee/atlas-ecu>
- Nikola Kozina OpenPort J2534 reference: <https://github.com/NikolaKozina/j2534>

## Design

- `packages/device/transports/openport2` owns:
  - `ati`
  - `ata`
  - `ato...`
  - `att...`
  - `AR...` packet parsing
- Desktop entrypoints inject serial runtime support.
- Browser/web runtimes should prefer WebUSB, but may fall back to WebSerial when the browser exposes the cable as a serial-class device instead.
- HID remains provisional until validated end-to-end.

## Runtime matrix

| Runtime | Preferred OpenPort backend |
|---------|----------------------------|
| VS Code web / browser | WebUSB, with WebSerial fallback when needed |
| VS Code desktop on macOS | CDC ACM serial |
| CLI on macOS | CDC ACM serial |
| Other desktop runtimes | transport-specific, not guaranteed |

## Acceptance targets

- `inspect-device list` can enumerate OpenPort over serial.
- `inspect-device raw --transport serial` can complete adapter handshake and raw exchange without hanging.
- `inspect-device raw --transport serial --data "10 92"` can enter the vendor logging session and receive `50 92`.
- `inspect-device raw --transport serial --data "23 80 87 8c 02"` can receive a positive Mode 23 response.
- `inspect-device log --transport serial --protocol mut3` can stream confirmed live data frames on macOS.
- VS Code desktop can inject the serial backend without polluting the web build graph with Node-only modules.
- HID remains documented as provisional until validated for connect, probe, log, and ROM-read.

## Current findings

- macOS OpenPort access is reliable through the CDC ACM serial device exposed as a VCOM endpoint.
- Windows EvoScan decompilation confirms OpenPort 2.0 uses the J2534 `op20pt32.dll` path, while OpenPort 1.3 uses FTDI `FTD2XX.dll`; the two backends should be documented separately.
- EvoScan's Windows ISO15765 setup uses protocol `6`, `flags=0`, and a zeroed `PASS_FILTER`, which is still the best reference for the USB/J2534-style path.
- Atlas provides the missing serial-side clue: its native OpenPort serial driver uses a real ISO15765 `FLOW_FILTER` on the serial/VCOM path and sends ISO15765 writes as `CAN ID + raw payload` with `txFlags = 0x40`, rather than as prebuilt padded CAN frames.
- The working macOS serial initialization sequence is:
  - `ati`
  - `ata`
  - `atr 16`
  - `ato6 0 500000 0`
  - `atf6 3 64 4` with `mask=FF FF FF FF`, `pattern=00 00 07 E8`, `flow=00 00 07 E0`
- The working macOS serial write shape for MUT/UDS is:
  - `att6 {4 + payload_len} 64`
  - followed by `00 00 07 E0` and the raw UDS payload bytes
- The serial parser must tolerate an interleaved plain ASCII `aro\r\n` acknowledgement between the adapter TX-done packet and the ECU RX packet.
- With those serial-specific behaviors in place, ECU RX is confirmed and live MUT3 logging works on macOS:
  - `raw 10 92 -> 50 92`
  - `raw 23 80 87 8c 02 -> 63 00 00`
  - `log --transport serial --protocol mut3` streams healthy frames
- The extracted Mitsubishi "PassThru CAN" payload is more substantial than first assumed: `data2.cab` contains `PTCAN.exe`, `MUT_VCI.dll`, `VciCRepro.dll`, `ptc32.dll`, and `ini_common/ClearDiagCANID.ini`.
- Mitsubishi's tooling confirms `REQ1=7E0` / `RES1=7E8` in `ClearDiagCANID.ini`, so the project's assumed MUT/UDS CAN IDs remain plausible.
- Mitsubishi appears to use a D-PDU / MUT-3 stack (`MUT_VCI.dll`) with queue-clearing and battery-voltage IOCTL concepts similar to the J2534 sequence seen in EvoScan, but it is not a drop-in OpenPort 2.0 J2534 reference.
- Mitsubishi's transport metadata also reinforces session-level expectations that may matter for RX validation: fixed 8-byte CAN padding with `0xFF`, tester-present payload `02 3E 02 FF FF FF FF FF`, and default diagnostic-session lifecycle values corresponding to `10 92` on start and `10 81` on exit.
- Mitsubishi's protocol metadata includes explicit CAN monitoring/filter controls (`CP_CANMONITORING`, `CP_CANMONITORINGFILTER`, `CP_CANMONITORINGIDENTIFIER`) and named response filters for positive, negative, wait, repeat, and tester-present handling. That strengthens the hypothesis that missing RX may be a filtering/monitoring configuration gap rather than a bad request payload.
- Further CAN ID / filter / flag tuning should be driven by an external CAN sniffer capture rather than blind iteration.

## Deferred follow-up

- Keep EvoScan's `MUTII`-branch `SET_CONFIG` tuning documented for future MUT-II work, but do not mirror it into the ISO15765 serial backend without hardware evidence.
- Decide whether the transport should model EvoScan's likely `TIMEOUT` / `BUFFER_EMPTY` tolerance and ISO15765 `LOOPBACK = 0` behavior on USB/HID, or leave those for hardware-driven validation.
- Reuse the shared device runtime foundation for user-facing multi-device selection and reconnect flows.
- Keep OpenPort-specific transport semantics separate from shared endpoint discovery, persistence, and matching.
- Track wideband and other non-ECU integrations as adapter-level follow-ups on top of the shared device runtime foundation.
