# OpenPort 2.0 macOS Serial Backend

## Summary

OpenPort 2.0 on macOS desktop should prefer the CDC ACM serial endpoint exposed as `/dev/cu.usbmodem*`. The shared OpenPort transport remains responsible for adapter protocol semantics, while desktop entrypoints inject a serial backend implemented with Node-only dependencies.

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
- Further CAN ID / filter / flag tuning should be driven by an external CAN sniffer capture rather than blind iteration.

## Deferred follow-up

- Add user-facing multi-device hardware selection in the VS Code extension.
- Persist selected hardware identities in workspace state for reconnect flows.
- Track wideband and other non-OpenPort serial integrations as a separate follow-up once OpenPort protocol validation is complete.
