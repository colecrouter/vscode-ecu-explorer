# SecurityAccess Write-Session Algorithm — Candidate Constants

**Status**: 10 candidates identified, awaiting hardware verification  
**Date**: 2026-02-23  
**Method**: Binary pattern search of ecuflash.exe near known read-session constant (0x4081)  

---

## Algorithm Pattern

All candidates assume the same pattern as read-session:

```typescript
function computeWriteSessionKey(seed: number): number {
    return ((seed * MULTIPLIER + 0x1234) & 0xFFFF);
}
```

Where `MULTIPLIER` is one of the candidates below, and addend `0x1234` is assumed to match read-session.

**Read-session (known)**:
```typescript
key = (seed * 0x4081 + 0x1234) & 0xFFFF
```

---

## Top 10 Candidates (Ranked by Likelihood)

| Rank | Multiplier | Seed 0x0000 | Seed 0x0001 | Seed 0x1234 | Seed 0x5555 | Seed 0xAAAA | Seed 0xFFFF |
|------|------------|-------------|-------------|-------------|-------------|-------------|-------------|
| 1 | **0x882D** | 0x1234 | 0x9A61 | 0xE558 | 0x3A25 | 0x6216 | 0x8A07 |
| 2 | **0x92A7** | 0x1234 | 0xA4DB | 0x9A20 | 0x36A7 | 0x5B1A | 0x7F8D |
| 3 | **0x9D0B** | 0x1234 | 0xAF3F | 0xBE70 | 0xDDDB | 0xA982 | 0x7529 |
| 4 | 0xDEB3 | 0x1234 | 0xF0E7 | 0xE490 | 0x72A3 | 0xD312 | 0x3381 |
| 5 | 0x7FDE | 0x1234 | 0x9212 | 0xA74C | 0x3CEA | 0x67A0 | 0x9256 |
| 6 | 0xA77F | 0x1234 | 0xB9B3 | 0x0600 | 0xDA5F | 0xA28A | 0x6AB5 |
| 7 | 0xD0A7 | 0x1234 | 0xE2DB | 0x3220 | 0xCCA7 | 0x871A | 0x418D |
| 8 | 0x913B | 0x1234 | 0xA36F | 0xB830 | 0xE1CB | 0xB162 | 0x80F9 |
| 9 | 0xBE91 | 0x1234 | 0xD0C5 | 0xF9A8 | 0x7D59 | 0xE87E | 0x53A3 |
| 10 | 0x4C44 | 0x1234 | 0x5E78 | 0x5804 | 0xF8C8 | 0xDF5C | 0xC5F0 |

**Top 3 most likely**: 0x882D, 0x92A7, 0x9D0B (appear near 0x4081 in binary)

---

## How to Verify

### Option A: Hardware CAN Capture (Recommended)

1. Connect CAN sniffer to EVO X ($25-50 hardware cost)
2. Run EcuFlash write operation
3. Capture SecurityAccess exchange:
   ```
   ECU → Tester: 67 03 [SH] [SL]      (seed)
   Tester → ECU: 27 04 [KH] [KL]      (key)
   ```
4. Compute seed/key as 16-bit values
5. Look up seed in table above to find which multiplier produces that key

**Guide**: See [CAN_CAPTURE_GUIDE.md](CAN_CAPTURE_GUIDE.md)

### Option B: Test with Real ECU (Requires Hardware)

**⚠️ WARNING**: Wrong keys might lock ECU temporarily. Only attempt with understanding of risks.

Try each candidate one by one:
1. Connect OpenPort to EVO X
2. Implement candidate algorithm
3. Attempt write operation
4. If access granted → correct algorithm found!
5. If access denied → try next candidate
6. Cycle ignition between attempts to reset counter

### Option C: Automated Verification Script

```powershell
# Test which algorithm produces a specific key for a captured seed
# Usage: .\verify_algorithm.ps1 -Seed 0x1234 -ExpectedKey 0xE558

param([uint16]$Seed, [uint16]$ExpectedKey)

$candidates = @(0x882D, 0x92A7, 0x9D0B, 0xDEB3, 0x7FDE, 0xA77F, 0xD0A7, 0x913B, 0xBE91, 0x4C44)

foreach ($mult in $candidates) {
    $key = (($Seed * $mult) + 0x1234) -band 0xFFFF
    if ($key -eq $ExpectedKey) {
        Write-Host "✓ MATCH: Multiplier = 0x$($mult.ToString('X4'))" -ForegroundColor Green
        exit 0
    }
}

Write-Host "✗ No match found. Seed/key might not follow pattern." -ForegroundColor Red
```

---

## Testing Tools

All tools located in `tools/mock_j2534/`:

### test_algorithm.ps1

Test all candidates with various seeds:
```powershell
.\test_algorithm.ps1 -TestCandidates
```

Test specific multiplier:
```powershell
.\test_algorithm.ps1 -Multiplier 0x882D -Addend 0x1234
```

### search_constants.ps1

Search ecuflash.exe for algorithm constants:
```powershell
.\search_constants.ps1
```

---

## Implementation Template

Once correct multiplier identified, implement in TypeScript:

```typescript
// packages/device/protocols/mut3/src/security.ts

/**
 * Compute write-session SecurityAccess key (level 0x03/0x04)
 * Algorithm: key = (seed * MULTIPLIER + 0x1234) & 0xFFFF
 * 
 * @param seed - 16-bit seed from ECU (from 67 03 response)
 * @returns 16-bit key to send in 27 04 request
 */
export function computeWriteSessionKey(seed: number): number {
    // MULTIPLIER verified via CAN capture on 2026-02-XX
    const MULTIPLIER = 0x882D;  // Replace with verified value
    const ADDEND = 0x1234;       // Same as read-session
    
    return ((seed * MULTIPLIER + ADDEND) & 0xFFFF);
}
```

### Add Tests

```typescript
// packages/device/protocols/mut3/test/security.test.ts

describe('computeWriteSessionKey', () => {
    it('computes correct key for known seed/key pair from hardware capture', () => {
        // Captured from EVO X ECU on 2026-02-XX
        const seed = 0x1234;
        const expectedKey = 0xE558;  // Replace with captured value
        
        expect(computeWriteSessionKey(seed)).toBe(expectedKey);
    });
    
    it('handles edge cases', () => {
        expect(computeWriteSessionKey(0x0000)).toBe(0x1234);
        expect(computeWriteSessionKey(0xFFFF)).toBe(0x8A07);  // Adjust based on verified multiplier
    });
});
```

---

## Known Constraints

### Assumptions

1. **Addend is 0x1234** (same as read-session) — if wrong, algorithm may be:
   ```
   key = (seed * MULTIPLIER + DIFFERENT_ADDEND) & 0xFFFF
   ```

2. **Linear congruential pattern** — if wrong, algorithm may use:
   - XOR operations
   - Lookup tables
   - More complex transformations

3. **16-bit arithmetic** — confirmed by UDS specification (2-byte seed/key)

### Verification Required

- ✅ Pattern identified via binary search
- ✅ 10 candidates narrowed from infinite possibilities
- ❌ **Awaiting hardware verification** to determine correct multiplier
- ❌ Addend (0x1234) not yet verified

### Next Steps

1. **Order hardware**: CANable USB-CAN adapter ($25-35) from https://canable.io/
2. **Schedule vehicle access**: 30 minutes needed for capture
3. **Capture seed/key pair**: Follow CAN_CAPTURE_GUIDE.md procedure
4. **Identify correct multiplier**: Match captured values against table above
5. **Implement and test**: Add to security.ts with hardware-verified constant
6. **Document**: Update research plan with verification date and ECU details

---

## References

- **Research Plan**: [MITSUCAN_WRITE_RESEARCH_PLAN.md](../MITSUCAN_WRITE_RESEARCH_PLAN.md)
- **CAN Capture Guide**: [CAN_CAPTURE_GUIDE.md](CAN_CAPTURE_GUIDE.md)
- **Mock J2534 Details**: [README.md](README.md)
- **Full Analysis**: Research plan Appendix H

---

**Last Updated**: 2026-02-23  
**Status**: Ready for hardware verification
