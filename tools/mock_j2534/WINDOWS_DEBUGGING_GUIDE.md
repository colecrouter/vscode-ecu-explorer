# Windows Dynamic Analysis — Extract SecurityAccess Algorithm from EcuFlash

**Goal**: Capture the write-session SecurityAccess key computation algorithm for ALL flash protocols without hardware constraints.

**Advantage over hardware capture**: One debugging session can capture algorithms for wrx02, wrx04, sti04, sti05, mitsucan, mitsukernel, mitsukernelocp, mitsubootloader, shbootmode, shaudmode, subarucan, subarucand, subarubrz, subaruhitachi, and all checksum modules.

**Time**: ~2-3 hours for initial setup, then 10-15 minutes per protocol.

---

## Approach Overview

**UPDATE**: Mock J2534 DLL approach failed - EcuFlash checks for USB hardware before loading any J2534 DLL. The mock DLL is never loaded.

**Revised approach** - Direct analysis of ecuflash.exe:

1. Use **Ghidra** to statically analyze ecuflash.exe and find the algorithm function
2. Alternative: Use **x64dbg** to patch the USB hardware check and force algorithm execution
3. Alternative: Extract algorithm constants by memory pattern matching
4. Alternative: Decompile with IDA Free or Binary Ninja Cloud

**This requires NO hardware**, but is more technical than the mock DLL approach.

---

## Prerequisites

### Install x64dbg (Free Windows Debugger)

Download from: https://x64dbg.com/

```powershell
# Or via winget:
winget install x64dbg.x64dbg
```

x64dbg is better than WinDbg for this task because:
- User-friendly GUI
- Built-in assembler/disassembler
- Memory search
- Easy breakpoint management
- Handles 32-bit apps (EcuFlash is 32-bit)

### Optional: API Monitor (Easiest Method - Try This First!)

Download from: http://www.rohitab.com/apimonitor

API Monitor can **automatically capture all J2534 calls** without writing code or setting breakpoints. This might be enough to see the seed/key exchange directly!

---

## Method 1: Runtime Memory Dump + Analysis (Best for Packed Executables)

**Why this works**: EcuFlash 1.44 uses commercial packer (Enigma), making static analysis impossible. But at runtime, the code MUST be unpacked in memory to execute. We dump the unpacked memory and analyze that.

### Step 1: Dump Unpacked Process Memory

```powershell
# Install Process Hacker (better than Task Manager for this)
winget install winsw.ProcessHacker

# OR use built-in Windows tools:
# Task Manager → Details → Right-click ecuflash.exe → Create dump file
```

**Critical**: Launch EcuFlash and **wait for it to fully initialize** (splash screen disappears) before dumping. The unpacker runs during startup.

### Step 2: Get Clean Memory Dump

1. Launch Process Hacker (admin mode)
2. Find `ecuflash.exe` in process list
3. Right-click → Miscellaneous → Dump Memory → Full
4. Save as `ecuflash_unpacked.dmp`

### Step 3: Load Memory Dump in Ghidra

1. Launch Ghidra
2. File → Import File → Select `ecuflash_unpacked.dmp`
3. Format: "Raw Binary"
4. Language: x86:LE:32:default (32-bit x86 little-endian)
5. Analyze with default analyzers

**This dump contains the UNPACKED code!**

### Step 4: Search for Algorithm Constants

Now search the unpacked memory:

```python
# In Ghidra's Python console:
from ghidra.program.model.mem import MemoryAccessException

# Search for known read-session constant 0x4081
addr = currentProgram.getMinAddress()
while addr is not None:
    try:
        val = getShort(addr)
        if val == 0x4081:
            print("Found 0x4081 at: " + str(addr))
    except:
        pass
    addr = addr.add(1)
```

Or use Ghidra GUI: Search → Memory → Search for: `81 40` (little-endian 0x4081)

### Step 5: Find Write-Session Algorithm

Look for patterns NEAR the read-session constant:
- Multiple `imul` instructions (multiply for key computation)
- Constants close to 0x4081 (0x8xxx range is common)
- Check ±500 bytes from 0x4081 location

### Step 6: Verify Algorithm

If you find candidate constants, test them:

```typescript
// Test candidate: key = (seed * CONST + ADD) & 0xFFFF
function testAlgorithm(mult: number, add: number, seed: number): number {
  return (seed * mult + add) & 0xFFFF;
}

// Try found constants
const result = testAlgorithm(0x8345, 0x5678, 0x1234);
console.log(`Key for seed 0x1234: 0x${result.toString(16)}`);
```

---

## Method 2: x64dbg Runtime Tracing (Most Direct - Try This First!)

**Why this is better**: No need to dump/re-import. Trace the LIVE unpacked code directly.

### Prerequisites

```powershell
# Install x64dbg with ScyllaHide (anti-anti-debugging plugin)
winget install x64dbg.x64dbg
```

Download ScyllaHide plugin: https://github.com/x64dbg/ScyllaHide/releases
- Extract to `x64dbg\plugins\`

### Step 1: Launch with Anti-Anti-Debug

1. Open **x32dbg** (32-bit version for EcuFlash)
2. Options → Preferences → Plugins → ScyllaHide → Enable all protections
3. File → Open → `C:\Program Files (x86)\OpenECU\EcuFlash\ecuflash.exe`
4. Click Run (F9) - let it initialize fully (splash screen disappears)

### Step 2: Find the SecurityAccess Algorithm at Runtime

The algorithm executes when EcuFlash tries to write. Since we can't trigger write without hardware, we use a different approach:

**Search for the algorithm pattern in memory:**

1. In x64dbg: Symbols → Modules → Find all code sections
2. Use memory breakpoints on the pattern
3. Or search for the read-session constant and trace nearby code

**Better approach - Search for UDS Service Handler:**

1. Symbols → Search for imported functions
2. Look for "sprintf", "memcpy", "send", etc. (common in communication code)
3. Set breakpoints on network/communication functions
4. These will be called even during initialization

### Step 3: Memory Search for Constants in Running Process

1. x64dbg → Memory Map → Find executable regions
2. Right-click → Find Pattern → HEX pattern: `81 40` (0x4081 in little-endian)
3. Check each match - assemble context around it

### Step 4: Alternative - Patch USB Check to Trigger Algorithm

Since we can't naturally trigger the write operation, patch the hardware check:

1. Search → All Modules → Search for strings: "USB", "device", "OpenPort", "interface"
2. Set breakpoints on string references
3. Run until breakpoint hits
4. Look at the conditional jump that checks for hardware
5. Patch it: `je` → `jmp` or change condition code
6. Now Write button should enable without hardware!

### Step 5: Breakpoint on Algorithm Execution

Once Write is enabled (via patch or if you have hardware):

1. Set breakpoint on any function containing multiply operations (`imul`)
2. Load a ROM, click Write
3. Breakpoint should hit during SecurityAccess
4. Step through and watch registers for seed → key transformation

### Step 6: Extract Algorithm from Live Execution

When breakpoint hits:
1. **Registers window** - see seed value in function parameters
2. **Stack window** - see function call arguments
3. **CPU window** - see the actual algorithm instructions:

```asm
; Example of what you might see:
movzx  eax, word ptr [ebp-4]    ; load seed
imul   eax, 0x8ABC              ; multiply by CONSTANT (this is what we need!)
add    eax, 0x5678              ; add CONSTANT (this too!)
and    eax, 0xFFFF              ; mask to 16 bits
mov    word ptr [ebp-8], ax     ; store result (key)
```

**Copy those constants (0x8ABC, 0x5678) - that's your algorithm!**

### Step 7: Verify Algorithm

Test the captured constants:

```powershell
# Test algorithm in PowerShell
$seed = 0x1234
$mult = 0x8ABC  # Replace with found constant
$add = 0x5678   # Replace with found constant
$key = (($seed * $mult) + $add) -band 0xFFFF
Write-Host "Key for seed 0x$($seed.ToString('X4')): 0x$($key.ToString('X4'))"
```

---

## Method 3: Quick Binary Search (Quickest - 5 Minutes)

**Even if obfuscated, constants are constants.** They must exist in the binary somewhere.

1. Install x64dbg: `winget install x64dbg.x64dbg`
2. Launch **x32dbg** (32-bit version)
3. File → Open → `C:\Program Files (x86)\OpenECU\EcuFlash\ecuflash.exe`
4. Search for strings related to USB/device detection:
   - Right-click in CPU window → Search for → String references
   - Look for "No interface", "USB", "OpenPort", "FTDI", etc.
5. Set breakpoints on those string references
6. Run the program and see what checks fail

### Step 2: Patch Hardware Check

Once you find the check (e.g., `test eax, eax; jz no_device`):
1. Change the conditional jump to force success:
   - `jz` (jump if zero) → `jnz` (jump if not zero)
   - Or change to `nop` (no operation)
2. File → Patch File to save modified executable

### Step 3: Run Patched EcuFlash

With hardware check bypassed:
1. Load a ROM file
2. It should allow Write operation now
3. Use the mock J2534 DLL approach from original guide
4. But now EcuFlash will actually load it!

**WARNING**: This creates a modified executable. Keep the original backed up.

---

## Method 3: Quick Memory Pattern Search (Fastest - Try This First!)

Don't want to learn Ghidra or x64dbg? Try searching for the algorithm constants directly in the binary file.

### Step 1: Search for Known Constants

```powershell
# Read-session uses multiply by 0x4081 (decimal 16513)
# In little-endian: 81 40
# Let's search ecuflash.exe for this and nearby constants

cd "C:\Program Files (x86)\OpenECU\EcuFlash"
$bytes = [System.IO.File]::ReadAllBytes("ecuflash.exe")

# Search for 0x4081 (read-session multiply constant)
$pattern = [byte[]](0x81, 0x40)
for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
    if ($bytes[$i] -eq $pattern[0] -and $bytes[$i+1] -eq $pattern[1]) {
        Write-Host "Found 0x4081 at offset: 0x$($i.ToString('X'))"
        # Show context (20 bytes before and after)
        $context = $bytes[($i-20)..($i+20)]
        Write-Host "Context: $([BitConverter]::ToString($context))"
    }
}
```

### Step 2: Examine Nearby Code

Once you find 0x4081:
1. Check the bytes immediately before/after
2. Look for other 2-byte constants (potential write-session multiplier)
3. Common patterns:
   - Two `imul` instructions close together (read and write algorithms)
   - Different constants following same pattern

### Step 3: Test Candidates

If you find a suspicious constant (e.g., 0x8123), test if it could be the write algorithm:

```powershell
# Test: key = (seed * CONST + 0x1234) & 0xFFFF
$const = 0x8123  # Replace with found constant
$seed = 0x1234
$key = (($seed * $const) + 0x1234) -band 0xFFFF
Write-Host "For seed 0x$($seed.ToString('X4')), key would be: 0x$($key.ToString('X4'))"
```

### Step 4: Common Algorithm Patterns

Try these formulas with found constants:

```typescript
// Pattern 1: Same as read-session, different constants
key = (seed * CONST1 + CONST2) & 0xFFFF

// Pattern 2: Different multiplier, same addend
key = (seed * CONST_NEW + 0x1234) & 0xFFFF

// Pattern 3: XOR after multiply
key = ((seed * 0x4081) ^ CONST) & 0xFFFF

// Pattern 4: Swap bytes then multiply
seed_swapped = ((seed >> 8) | (seed << 8)) & 0xFFFF
key = (seed_swapped * 0x4081 + 0x1234) & 0xFFFF
```

---

In API Monitor's left panel:
1. Expand "Custom Definitions"
2. We need to create a J2534 API definition file

Create `J2534.xml` in API Monitor's `API` folder:

```xml
<?xml version="1.0" encoding="utf-8"?>
<ApiMonitor>
    <Include Filename="Headers\windows.h.xml" />
    
    <Module Name="op20pt32.dll" CallingConvention="STDCALL" Category="Vehicle Diagnostics">
        <Variable Name="PASSTHRU_MSG" Type="Pointer" />
        <Variable Name="ULONG" Type="Unsigned Long" />
        <Variable Name="LONG" Type="Long" />
        
        <Api Name="PassThruOpen">
            <Param Type="Pointer" />
            <Param Type="ULONG*" />
            <Return Type="LONG" />
        </Api>
        
        <Api Name="PassThruConnect">
            <Param Type="ULONG" />
            <Param Type="ULONG" />
            <Param Type="ULONG" />
            <Param Type="ULONG" />
            <Param Type="ULONG*" />
            <Return Type="LONG" />
        </Api>
        
        <Api Name="PassThruReadMsgs">
            <Param Type="ULONG" />
            <Param Type="PASSTHRU_MSG" />
            <Param Type="ULONG*" />
            <Param Type="ULONG" />
            <Return Type="LONG" />
        </Api>
        
        <Api Name="PassThruWriteMsgs">
            <Param Type="ULONG" />
            <Param Type="PASSTHRU_MSG" />
            <Param Type="ULONG*" />
            <Param Type="ULONG" />
            <Return Type="LONG" />
        </Api>
    </Module>
</ApiMonitor>
```

### Step 3: Capture the Key

1. Restart API Monitor with EcuFlash
2. Enable monitoring for op20pt32.dll functions
3. In EcuFlash:
   - Load an EVO X ROM
   - Click Write button
4. Watch API Monitor for `PassThruWriteMsgs` with UDS frame `27 04 <KH> <KL>`

**Success looks like:**
```
PassThruWriteMsgs
  pMsg->Data = 00 00 07 E0 03 27 04 XX YY  ← key is XX YY (for seed from mock)
```

Try multiple seeds by modifying `op20pt32.c` and see if you can deduce the algorithm from input/output pairs!

---

## Method 2: x64dbg Direct Debugging (If API Monitor Insufficient)

### Step 1: Prepare Mock DLL with Logging

Our mock `op20pt32.c` already logs to `C:\j2534_mock.log`. Ensure it's returning a **known seed** (currently 0x1234).

### Step 2: Launch EcuFlash Under x64dbg

1. Open **x32dbg** (the 32-bit version - important!)
2. File → Open → Select `C:\Program Files (x86)\OpenECU\EcuFlash\ecuflash.exe`
3. Click "Run" to start EcuFlash

### Step 3: Find PassThruWriteMsgs in Memory

1. In x64dbg, go to **Symbols** tab
2. Search for "op20pt32.dll"
3. Find `PassThruWriteMsgs` function
4. Right-click → Set breakpoint

### Step 4: Trigger the Write Operation

1. In EcuFlash (running in debugger):
   - Load EVO X ROM
   - Click Write button
2. x64dbg will break when PassThruWriteMsgs is called

### Step 5: Examine the Message Buffer

When breakpoint hits:
1. Look at the **stack** window - the second parameter is `PASSTHRU_MSG* pMsg`
2. Right-click on the pointer → "Follow in Dump"
3. In the dump window, you'll see the UDS message:

```
Offset  00 01 02 03 04 05 06 07 08 09 0A 0B 0C
------  -- -- -- -- -- -- -- -- -- -- -- -- --
0x0000  00 00 07 E0 03 27 04 XX YY ...
                          ^^    ^^ ^^
                          |      \ /
                          |       key (2 bytes)
                          sendKey subfunction
```

**XX YY is the computed key for seed 0x1234!**

### Step 6: Find the Computation Function

Now that we know WHEN the key is computed, let's find WHERE:

1. Restart debugging
2. Set breakpoint on PassThruWriteMsgs again
3. When it breaks, look at the **call stack** window
4. The function that called PassThruWriteMsgs is likely in ecuflash.exe
5. Double-click to jump to that function
6. Step backwards through code to find where the key was computed

### Step 7: Examine the Algorithm

Look for patterns in the assembly:

**Linear congruential (like read-session):**
```asm
movzx  eax, word ptr [ebp-4]    ; load seed
imul   eax, eax, 0x????         ; multiply by constant
add    eax, 0x????              ; add constant
and    eax, 0xFFFF              ; mask to 16 bits
mov    word ptr [ebp-8], ax     ; store key
```

**Lookup table:**
```asm
movzx  eax, byte ptr [ebp-4]    ; load seed high byte
movzx  ecx, byte ptr [table+eax]; lookup in table
...
```

**XOR/shift:**
```asm
mov    ax, word ptr [ebp-4]     ; load seed
xor    ax, 0x????               ; XOR with constant
rol    ax, 4                    ; rotate left
```

### Step 8: Test with Multiple Seeds

Modify `op20pt32.c` to return different seeds:
- 0x0000, 0x0001, 0x00FF, 0x0100, 0x1234, 0x5678, 0xABCD, 0xFFFF

For each seed, capture the key and build a mapping. This helps confirm the algorithm pattern.

---

---

## Quick Start: Which Method Should You Try?

| Method | Difficulty | Time | Success Chance | When to Use |
|--------|------------|------|----------------|-------------|
| **Memory Pattern Search** | Easy | 30 min | 60% | Try this first! Quick and requires no tools |
| **Ghidra Static Analysis** | Medium | 2-3 hours | 85% | Best if pattern search fails or you want to learn reverse engineering |
| **x64dbg Patching** | Hard | 3-4 hours | 70% | If you want to make mock DLL work by bypassing USB check |

**Recommendation**: Start with Memory Pattern Search (Method 3). If that doesn't find obvious constants, move to Ghidra (Method 1).

---

## Memory Dump Analysis (If Above Methods Blocked)

If EcuFlash has anti-debugging, try memory dumping:

### Step 1: Capture Process Memory

```powershell
# Install Process Hacker
winget install ProcessHacker.ProcessHacker

# Or use Windows Task Manager:
# 1. Launch EcuFlash
# 2. Open Task Manager
# 3. Right-click ecuflash.exe → Create dump file
```

### Step 2: Analyze with Ghidra

1. Load the memory dump in Ghidra
2. Search for the known constants from read-session algorithm: `0x4081`, `0x1234`
3. Check nearby functions - write-session might use similar constants

---

## Capturing Multiple Protocols

Once you have the method working for `mitsucan`, repeat for other protocols:

### Flash Tools to Capture:
1. **mitsucan** - EVO X (CAN-based UDS)
2. **mitsukernel** - EVO 7/8/9 (K-line bootloader)
3. **mitsukernelocp** - EVO variant
4. **wrx02**, **wrx04** - WRX generations
5. **sti04**, **sti05** - STI generations
6. **subarucan**, **subarucand** - Subaru CAN protocols
7. **subarubrz** - BRZ/86
8. **subaruhitachi** - Hitachi ECUs
9. **shbootmode**, **shaudmode** - SH-2 bootloader modes
10. **mitsubootloader** - Mitsubishi bootloader

### Checksum Modules to Capture:
1. **mitsucan** - EVO X checksums
2. **mitsuh8** - H8 series
3. **subarudbw** - Drive-by-wire
4. **subarudiesel** - Diesel variants
5. **subaruhitachi** - Hitachi checksums

**Process**:
1. Load a ROM for that vehicle type in EcuFlash
2. Set breakpoints as above
3. Click Write
4. Capture the algorithm
5. Document in table (see below)

---

## Documentation Template

Create a table for each protocol:

```markdown
## mitsucan (EVO X)

| Seed (hex) | Key (hex) | Algorithm Notes |
|------------|-----------|-----------------|
| 0x0000     | 0x????    |                 |
| 0x0001     | 0x????    |                 |
| 0x1234     | 0x????    |                 |
| 0xFFFF     | 0x????    |                 |

**Algorithm** (C code):
```c
uint16_t compute_mitsucan_write_key(uint16_t seed) {
    // TODO: fill in after analysis
    return (seed * 0x???? + 0x????) & 0xFFFF;
}
```
```

---

## Expected Time Investment

| Task | Time | Notes |
|------|------|-------|
| Install tools (x64dbg, API Monitor) | 15 min | One-time |
| Setup first protocol | 1-2 hours | Learning curve |
| Capture each additional protocol | 10-15 min | Once familiar |
| **Total for all 15+ protocols** | **~6-8 hours** | Spread over multiple sessions |

Compare to hardware approach:
- Travel to vehicle: Several hours + cost
- Setup CAN sniffer: 30 min per protocol
- Must repeat for EACH protocol/vehicle
- Limited time window (repairs)

**Conclusion**: Dynamic analysis is MORE efficient for capturing multiple protocols.

---

## Troubleshooting

### EcuFlash Detects Debugger

If EcuFlash refuses to run under x64dbg:

1. Use "ScyllaHide" plugin for x64dbg (anti-anti-debugging)
2. Or use API Monitor (doesn't attach debugger, just hooks DLLs)
3. Or inject a DLL that hooks PassThruWriteMsgs directly

### J2534 DLL Not Loaded

EcuFlash only loads the J2534 DLL when you click Write. Make sure:
1. ROM is loaded first
2. Click Write button
3. Breakpoints trigger AFTER Write is clicked

### Can't Find Algorithm in Assembly

If the assembly is too obfuscated:
1. Use the seed/key pairs approach (brute force test many seeds)
2. Try to guess common algorithms (LCG with different constants)
3. Check if algorithm is in a separate DLL (checksum module)

---

## Next Steps After Capturing

Once you have the algorithms:

1. **Implement in TypeScript** at `packages/device/protocols/mut3/src/security.ts`
2. **Add tests** for each seed/key pair captured
3. **Update documentation** with protocol details
4. **Test with real hardware** when available (verify algorithms correct)

This approach gives you:
- ✅ All protocol algorithms captured
- ✅ No hardware time constraints
- ✅ Can work immediately
- ✅ Repeatable for future EcuFlash updates
- ✅ Document-able for open source community

---

## Legal/Ethical Notes

- Reverse engineering for interoperability is legal in most jurisdictions
- These algorithms are necessary for compatibility with existing ECUs
- Document everything for transparency
- Share findings with community (don't hoard)
