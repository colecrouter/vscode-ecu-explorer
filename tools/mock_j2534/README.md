# Mock op20pt32.dll — J2534 Key Interceptor

A Windows 32-bit DLL that intercepts EcuFlash's J2534 communications to capture the write-session SecurityAccess key.

## Purpose

`ecuflash.exe` (v1.44.4870) communicates with the ECU through the OpenPort 2.0 J2534 DLL (`op20pt32.dll`). This mock replaces that DLL, responds to UDS frames with a fixed seed (`0x1234`), and logs the key that EcuFlash computes and sends back.

The key value captured from seed `0x1234` reveals the `mitsucan` write-session SecurityAccess algorithm.

## Build (cross-compile from macOS/Linux)

```bash
# Install MinGW-w64 cross-compiler
brew install mingw-w64  # macOS
# or: apt install gcc-mingw-w64-i686  # Linux

# Compile the 32-bit DLL
i686-w64-mingw32-gcc -shared -m32 -o op20pt32.dll op20pt32.c op20pt32.def -Wall
```

## Usage on Windows

1. **Copy** `op20pt32.dll` to the same directory as `ecuflash.exe`
2. **Register** the mock device in the Windows registry:
   ```
   # Run in cmd.exe as Administrator:
   reg add "HKLM\SOFTWARE\PassThruSupport.04.04\OpenPort 2.0" /v FunctionLibrary /t REG_SZ /d "C:\ecuflash\op20pt32.dll" /f
   reg add "HKLM\SOFTWARE\PassThruSupport.04.04\OpenPort 2.0" /v Name /t REG_SZ /d "OpenPort 2.0 (Mock)" /f
   ```
3. **Launch EcuFlash** with an EVO X ROM file loaded
4. **Initiate a Write** — EcuFlash will call `PassThruWriteMsgs` with `27 03`, our mock responds with seed `0x1234`, then EcuFlash calls us again with `27 04 KH KL`
5. **Check the log** at `C:\j2534_mock.log`:
   ```
   *** WRITE SESSION KEY for seed=0x1234: KH=0xXX KL=0xYY (key=0xXXYY) ***
   ```

## Procedure Notes

- EcuFlash doesn't call `PassThruWriteMsgs` until you click **Write** (not just opening the ROM)
- You can cancel the write immediately after the SecurityAccess exchange — no ROM data is sent until `RequestDownload (0x34)` blocks start
- The key is logged to `C:\j2534_mock.log` AND to `stderr`

## Expected Log Output

```
=== Mock op20pt32.dll loaded (ecuflash mitsucan security key interceptor) ===
Magic seed: 0x1234 — watch for key sent in 27 04 response
PassThruOpen called
PassThruConnect(proto=6, baud=500000)
TX (EcuFlash→ECU) [8 bytes]: 00 00 07 E0 02 10 03 00
  → DiagnosticSessionControl(0x03)
TX (EcuFlash→ECU) [8 bytes]: 00 00 07 E0 02 27 03 00
  → SecurityAccess requestSeed (write-level, subfunction 0x03)
  → Responding with seed = 0x12 0x34
TX (EcuFlash→ECU) [9 bytes]: 00 00 07 E0 04 27 04 XX YY
  → SecurityAccess sendKey (write-level, subfunction 0x04)
  *** WRITE SESSION KEY for seed=0x1234: KH=0xXX KL=0xYY (key=0xXXYY) ***
```

## After Capturing the Key

With (seed=0x1234, key=0xXXYY), test which algorithm produces this result:

```python
# Test linear congruential (same family as read-session):
seed = 0x1234
# Read-session: (seed * 0x4081 + 0x1234) & 0xFFFF = ?
read_key = (seed * 0x4081 + 0x1234) & 0xFFFF

# The write key 0xXXYY should match one of:
# (seed * M + A) & 0xFFFF  for some M, A
# or the LFSR from miniecu::generate_key
```

Collect 3+ (seed, key) pairs by power-cycling and repeating, then use the analysis scripts in [§D of the research plan](../../MITSUCAN_WRITE_RESEARCH_PLAN.md#d1-reference-pattern).
