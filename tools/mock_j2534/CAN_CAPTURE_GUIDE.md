# CAN Bus Capture Guide — SecurityAccess Algorithm Verification

**Goal**: Capture the write-session SecurityAccess seed/key exchange from EcuFlash's communication with the EVO X ECU to identify which algorithm is correct.

**Time Required**: ~30 minutes setup + 5 minutes per protocol
**Hardware Cost**: $20-100 for CAN interface
**Success Rate**: 100% (seed/key are transmitted in plaintext on CAN bus)

---

## Why This Works

The SecurityAccess exchange happens over CAN bus in plaintext:

```
ECU → Tester:  [7E8] 04 67 03 [SH] [SL]        ← ECU sends seed (2 bytes)
Tester → ECU:  [7E0] 04 27 04 [KH] [KL]        ← EcuFlash sends computed key (2 bytes)
ECU → Tester:  [7E8] 02 67 04                  ← ECU grants access (or 7F 27 35 if wrong)
```

We simply:
1. Sniff the CAN bus while EcuFlash writes
2. Capture the seed and key
3. Look up the seed in our candidate table to see which algorithm produced that key
4. Done!

---

## Hardware Options

### Option A: PCAN-USB ($35-50) — RECOMMENDED
- **Product**: PEAK-System PCAN-USB adapter
- **Link**: https://www.peak-system.com/PCAN-USB.199.0.html
- **Pros**: Professional, good software, widely supported
- **Cons**: Most expensive option

### Option B: CANable ($25-35) — BEST VALUE
- **Product**: CANable USB-CAN adapter (open source hardware)
- **Link**: https://canable.io/
- **Pros**: Cheap, excellent Linux support, open source
- **Cons**: Windows drivers less polished

### Option C: CANUSB ($20-30) — BUDGET OPTION
- **Product**: CANUSB adapter (LAWICEL)
- **Link**: Various sellers on Amazon/eBay
- **Pros**: Cheapest option
- **Cons**: Slower, older design

### Option D: OBDLink SX ($70-100) — IF YOU ALREADY HAVE IT
- **Product**: OBDLink SX (professional OBD-II tool)
- **Pros**: You might already own one!
- **Cons**: Overkill for this task

**Recommendation**: Get the **CANable** - best value and works great with free software.

---

## Software Options

### Option A: Wireshark + SocketCAN (Linux) — RECOMMENDED
- **Pros**: Professional, powerful filtering, free
- **Cons**: Requires Linux (VM or dual boot)
- **Best for**: Complete capture of all traffic

### Option B: PCAN-View (Windows)
- **Pros**: Free with PCAN hardware, easy to use
- **Cons**: Only works with PEAK hardware
- **Best for**: Quick captures

### Option C: SavvyCAN (Cross-platform) — EASIEST
- **Pros**: Free, works with many adapters, user-friendly
- **Cons**: Less features than Wireshark
- **Best for**: Beginners, quick analysis

### Option D: python-can Script (Cross-platform) — AUTOMATED
- **Pros**: Can auto-detect SecurityAccess frames, saves to CSV
- **Cons**: Requires Python knowledge
- **Best for**: Automation, multiple captures

**Recommendation**: Start with **SavvyCAN** for ease of use, or use the **Python script** I'll provide below for automation.

---

## Step-by-Step Procedure

### Phase 1: Hardware Setup (10 minutes)

1. **Locate OBD-II Port**
   - EVO X: Below steering wheel, driver side
   - Port has 16 pins in 2 rows

2. **Identify CAN Pins**
   - **Pin 6**: CAN-H (High)
   - **Pin 14**: CAN-L (Low)
   - **Pin 16**: +12V (optional, for powering adapter)
   - **Pin 4/5**: Ground (optional)

3. **Connect CAN Adapter**
   - **PASSIVE TAP** (recommended):
     - Use Y-splitter cable
     - One end → OBD-II port
     - Other end → OpenPort 2.0 (for EcuFlash)
     - Tap → CAN adapter → Computer
   
   - **ALTERNATIVE - Series connection**:
     - Computer → CAN adapter → EVO X OBD-II
     - OpenPort 2.0 also connected to same port
     - Both devices see same traffic

4. **Verify Connection**
   - Turn ignition to ON (don't start engine)
   - CAN adapter LED should blink (traffic present)
   - CAN bus runs at **500 kbps** for EVO X

### Phase 2: Software Setup (10 minutes)

#### Option A: SavvyCAN Setup

1. Download SavvyCAN: https://www.savvycan.com/
2. Install and launch
3. Connection → Add New Device Connection
4. Select your CAN adapter
5. Set bus speed: **500000** (500 kbps)
6. Click "Enable" - should see traffic flowing

#### Option B: Python Script (Automated)

Save this script as `capture_security_access.py`:

```python
#!/usr/bin/env python3
"""
Capture UDS SecurityAccess seed/key exchange from CAN bus
Specifically looks for service 0x27 (SecurityAccess)
"""
import can
import sys
from datetime import datetime

# CAN IDs for EVO X UDS
ECU_ID = 0x7E8  # ECU response
TESTER_ID = 0x7E0  # Tester request

def parse_uds_message(msg):
    """Parse UDS message and return service/subfunction"""
    if len(msg.data) < 2:
        return None, None
    
    # ISO-TP frame - skip length byte for single frames
    if msg.data[0] <= 0x07:  # Single frame
        length = msg.data[0]
        service = msg.data[1]
        data = msg.data[2:2+length-1]
        return service, data
    
    return None, None

def main():
    # Setup CAN interface
    # For SocketCAN (Linux): channel='can0'
    # For PCAN: channel='PCAN_USBBUS1', bustype='pcan'
    # For CANable: channel='slcan0', bustype='slcan'
    
    try:
        bus = can.interface.Bus(channel='can0', bustype='socketcan', bitrate=500000)
        print("Connected to CAN bus at 500 kbps")
    except Exception as e:
        print(f"Failed to connect to CAN bus: {e}")
        print("Make sure your CAN adapter is connected and configured")
        sys.exit(1)
    
    print("Listening for SecurityAccess (0x27) messages...")
    print("Start the write operation in EcuFlash now!\n")
    
    seed = None
    key = None
    
    try:
        for msg in bus:
            service, data = parse_uds_message(msg)
            
            if service is None:
                continue
            
            # SecurityAccess requestSeed (0x27 0x03)
            if service == 0x27 and len(data) > 0 and data[0] == 0x03:
                print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] Tester → ECU: RequestSeed (write-level)")
            
            # SecurityAccess requestSeed positive response (0x67 0x03)
            elif service == 0x67 and len(data) >= 3 and data[0] == 0x03:
                seed_bytes = data[1:3]
                seed = (seed_bytes[0] << 8) | seed_bytes[1]
                print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] ECU → Tester: Seed = 0x{seed:04X}")
                print(f"  Raw bytes: {' '.join(f'{b:02X}' for b in seed_bytes)}")
            
            # SecurityAccess sendKey (0x27 0x04)
            elif service == 0x27 and len(data) >= 3 and data[0] == 0x04:
                key_bytes = data[1:3]
                key = (key_bytes[0] << 8) | key_bytes[1]
                print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] Tester → ECU: Key = 0x{key:04X}")
                print(f"  Raw bytes: {' '.join(f'{b:02X}' for b in key_bytes)}")
                
                if seed is not None:
                    print("\n" + "="*60)
                    print("CAPTURED SECURITY ACCESS EXCHANGE!")
                    print("="*60)
                    print(f"Seed: 0x{seed:04X}")
                    print(f"Key:  0x{key:04X}")
                    print("\nNow check which algorithm produces this result:")
                    print(f"  cd tools/mock_j2534")
                    print(f"  .\\test_algorithm.ps1 -TestCandidates | Select-String '0x{seed:04X}'")
                    print("="*60 + "\n")
            
            # SecurityAccess sendKey positive response (0x67 0x04)
            elif service == 0x67 and len(data) > 0 and data[0] == 0x04:
                print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] ECU → Tester: Access GRANTED ✓")
                print("\nSUCCESS! The key was correct.\n")
                
                if seed and key:
                    print("Captured exchange saved to security_access_log.txt")
                    with open('security_access_log.txt', 'a') as f:
                        f.write(f"{datetime.now().isoformat()} - Seed: 0x{seed:04X}, Key: 0x{key:04X}\n")
                    
                    # Exit after successful capture
                    print("\nCapture complete. Exiting...")
                    break
            
            # Negative response (0x7F)
            elif service == 0x7F and len(data) >= 2 and data[0] == 0x27:
                error_code = data[1] if len(data) > 1 else 0
                print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] ECU → Tester: Access DENIED ✗ (Error: 0x{error_code:02X})")
                if error_code == 0x35:
                    print("  Error 0x35: Invalid key (wrong algorithm!)")
                elif error_code == 0x36:
                    print("  Error 0x36: Exceeded number of attempts")
    
    except KeyboardInterrupt:
        print("\nCapture stopped by user")
    finally:
        bus.shutdown()
        print("CAN bus disconnected")

if __name__ == "__main__":
    main()
```

Install dependencies:
```bash
pip install python-can
```

Run:
```bash
python capture_security_access.py
```

### Phase 3: Capture Session (5 minutes)

1. **Start Capture**
   - Launch SavvyCAN or Python script
   - Verify CAN traffic flowing (should see periodic messages)

2. **Trigger SecurityAccess in EcuFlash**
   - Launch EcuFlash
   - Load your EVO X ROM file
   - Click **Write** button
   - EcuFlash will immediately send SecurityAccess request

3. **Observe Traffic**
   - Watch for CAN ID **0x7E0** (tester request)
   - Watch for CAN ID **0x7E8** (ECU response)
   - Look for UDS service **0x27** (SecurityAccess)

4. **Identify Seed/Key**
   ```
   Time        ID  Data
   ----------  --- ---------------------------------
   10:23:45.123 7E0  03 27 03 00 00 00 00 00      ← RequestSeed (write-level)
   10:23:45.145 7E8  04 67 03 [SH] [SL] 00 00 00  ← Seed response (SH=high byte, SL=low byte)
   10:23:45.167 7E0  04 27 04 [KH] [KL] 00 00 00  ← SendKey (KH=high byte, KL=low byte)
   10:23:45.189 7E8  02 67 04 00 00 00 00 00      ← Access granted!
   ```

5. **Record Values**
   - **Seed**: Combine SH and SL → `(SH << 8) | SL`
   - **Key**: Combine KH and KL → `(KH << 8) | KL`

### Phase 4: Identify Algorithm (2 minutes)

Run the test script with the captured seed:

```powershell
cd E:\Repos\github.com\colecrouter\vscode-ecu-explorer\tools\mock_j2534

# Check which algorithm produces the captured key for the captured seed
.\test_algorithm.ps1 -TestCandidates | Select-String '0xYOUR_SEED'
```

Example:
```powershell
# If captured: Seed=0x1234, Key=0xE558
.\test_algorithm.ps1 -TestCandidates | Select-String '0x1234'

# Output will show which multiplier produces 0xE558 for seed 0x1234
# Result: 0x882D produces 0xE558 ← THIS IS THE CORRECT ALGORITHM!
```

---

## Capture Multiple Protocols

Since you have access to the vehicle, capture ALL protocols while you're there:

1. **mitsucan** (EVO X)
   - Use your EVO X ROM
   - Capture as above

2. **Subaru protocols** (if you have Subaru ROMs)
   - Load WRX/STI ROM in EcuFlash
   - Repeat capture
   - Each protocol may have different algorithm

3. **Other Mitsubishi protocols**
   - If you have EVO 7/8/9 access
   - Capture mitsukernel exchanges (K-line, not CAN)

### Quick Multi-Protocol Capture Plan

For each ROM type:
1. Load ROM in EcuFlash
2. Click Write
3. Immediately see seed/key (1-2 seconds)
4. Cancel write operation (don't actually flash!)
5. Record seed/key pair
6. Load next ROM type

**Total time**: 5 minutes per protocol = 30-60 minutes for all protocols

---

## Troubleshooting

### No CAN Traffic Visible

**Problem**: Adapter connected, but no messages
**Solutions**:
- Verify ignition is ON (not ACC, not START)
- Check CAN bus speed is 500 kbps
- Try different CAN interface (can0, can1, etc.)
- Verify pins: Pin 6 = CAN-H, Pin 14 = CAN-L

### Traffic Visible But No SecurityAccess

**Problem**: Seeing general CAN traffic, but no 0x27 service
**Solutions**:
- EcuFlash needs physical OpenPort connected
- Make sure you clicked "Write" button
- Check filter: look for ID 0x7E0 and 0x7E8
- SecurityAccess happens in first 1-2 seconds of write

### Access Denied (Error 0x35)

**Problem**: ECU rejects the key
**Solutions**:
- This is EXPECTED (we don't know algorithm yet!)
- We're just capturing, not testing
- The seed/key pair is still valid for analysis

### Multiple Failed Attempts Warning

**Problem**: ECU locks after 3-5 wrong keys
**Solutions**:
- Only do ONE capture attempt per ignition cycle
- Cycle ignition OFF/ON between attempts
- Wait 10 seconds between cycles
- ECU reset clears attempt counter

---

## Expected Results

After capture, you should have:

```
Seed: 0x1234
Key:  0xE558
```

Then verify which algorithm matches:

```powershell
# Test all candidates
$seed = 0x1234
$candidates = @{
    0x882D = 0xE558
    0x92A7 = 0x9A20
    0x9D0B = 0xBE70
    # ... etc
}

foreach ($mult in $candidates.Keys) {
    $testKey = (($seed * $mult) + 0x1234) -band 0xFFFF
    if ($testKey -eq 0xE558) {
        Write-Host "MATCH! Multiplier: 0x$($mult.ToString('X4'))" -ForegroundColor Green
    }
}
```

---

## Implementation After Capture

Once you identify the correct algorithm (e.g., multiplier = 0x882D):

1. **Update security.ts**:
   ```typescript
   // packages/device/protocols/mut3/src/security.ts
   
   export function computeWriteSessionKey(seed: number): number {
       return ((seed * 0x882D + 0x1234) & 0xFFFF);
   }
   ```

2. **Add tests**:
   ```typescript
   // packages/device/protocols/mut3/test/security.test.ts
   
   describe('computeWriteSessionKey', () => {
       it('computes correct key for captured seed', () => {
           expect(computeWriteSessionKey(0x1234)).toBe(0xE558);
       });
   });
   ```

3. **Document in research plan**:
   - Update MITSUCAN_WRITE_RESEARCH_PLAN.md
   - Note the capture date, ECU model, result
   - Mark as VERIFIED with hardware

---

## Safety Notes

- **DO NOT complete the write operation** - cancel immediately after SecurityAccess
- **Have backup ROM** on hand in case of accidental flash
- **Vehicle battery** should be fully charged
- **Document everything** - you might need to reference this later
- **One attempt per ignition cycle** - avoid ECU lockout

---

## Cost Summary

| Item | Cost | Notes |
|------|------|-------|
| CAN Adapter (CANable) | $25-35 | One-time purchase, keeps forever |
| Y-Splitter Cable (optional) | $10-15 | Cleaner setup |
| SavvyCAN Software | Free | Open source |
| Python + python-can | Free | Optional automation |
| **Total** | **$25-50** | Plus your time |

---

## Time Budget

| Task | Time | Notes |
|------|------|-------|
| Order hardware (if needed) | 3-7 days | Shipping |
| Setup hardware | 10 min | First time only |
| Setup software | 10 min | First time only |
| Capture one protocol | 5 min | Per protocol |
| Identify algorithm | 2 min | Compare with table |
| **Total first protocol** | **~30 min** | Plus shipping wait |
| **Each additional protocol** | **~5 min** | Once setup done |

---

## Next Steps

1. **Order CAN adapter** (recommended: CANable from https://canable.io/)
2. **Save this guide** for when hardware arrives
3. **Schedule vehicle access** (30-60 minutes needed)
4. **Prepare ROM files** for all protocols you want to capture
5. **Test python-can setup** on your computer beforehand

When hardware arrives and you have vehicle access, you'll capture all the algorithms in one session!

**Let me know when you have the hardware and I'll help with the capture process in real-time!**
