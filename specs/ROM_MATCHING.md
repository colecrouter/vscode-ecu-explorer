# ROM Matching

## Fingerprint Format

### What Is a Fingerprint

A fingerprint is a set of byte sequences at specific ROM addresses used to identify which definition file matches a given ROM binary. Fingerprints enable automatic ROM-to-definition matching without user intervention.

### How Fingerprints Are Extracted from ROM Files

Fingerprints are extracted from ROM definition files (e.g., ECUFlash XML) during the `peek()` phase. They are not extracted from the ROM binary itself; instead, they are pre-defined in the definition file and then compared against the ROM binary.

### Fingerprint Structure

A fingerprint consists of:

```typescript
export interface ROMFingerprint {
	/** Address and length of bytes to read */
	reads: { address: number; length: number }[];

	/** Expected bytes, as hex strings aligned with `reads` order (whitespace is ignored). */
	expectedHex: string[];

	/** Optional weights aligned with `reads` order; defaults to 100 each. */
	weights?: number[];

	/** Optional human readable fingerprint description */
	description?: string;
}
```

**Fields**:
- `reads`: Array of address/length pairs specifying where to read bytes in the ROM
- `expectedHex`: Array of hex strings (one per read) specifying expected byte values
- `weights`: Optional array of weights (one per read) for scoring; defaults to 100
- `description`: Optional human-readable description (e.g., "internalidhex at 0x50000")

### Example Fingerprints

**Single-read fingerprint** (ECUFlash internal ID):
```typescript
{
	reads: [{ address: 0x50000, length: 4 }],
	expectedHex: ["56890009"],
	description: "internalidhex 56890009 at 0x50000"
}
```

**Multi-read fingerprint** (multiple checks):
```typescript
{
	reads: [
		{ address: 0x50000, length: 4 },
		{ address: 0x60000, length: 2 },
		{ address: 0x70000, length: 1 }
	],
	expectedHex: ["56890009", "ABCD", "FF"],
	weights: [100, 50, 25],
	description: "Multi-point fingerprint for Evo X"
}
```

---

## Fingerprint Extraction

### How ECUFlash Provider Extracts Fingerprints

The ECUFlash provider extracts fingerprints from the `<romid>` section during `peek()`:

```typescript
async peek(definitionUri: string): Promise<ROMDefinitionStub> {
	const doc = await this.readXml(definitionUri);
	const rom = extractRom(doc);
	if (!rom) {
		return {
			uri: definitionUri,
			name: "ECUFlash Definition",
			fingerprints: [],
		};
	}

	const romid = (rom as Raw)["romid"] as Raw | undefined;
	const xmlid = extractText(romid?.["xmlid"]);
	const internalidaddress = extractText(romid?.["internalidaddress"]);
	const internalidhex = extractText(romid?.["internalidhex"]);

	const name = xmlid ?? internalidhex ?? "ECUFlash Definition";
	const fingerprints: ROMFingerprint[] = [];
	if (internalidaddress && internalidhex) {
		const addr = parseNumberish(internalidaddress) ?? 0;
		const expected = normalizeHex(internalidhex);
		fingerprints.push({
			reads: [{ address: addr, length: expected.length / 2 }],
			expectedHex: [expected],
			description: `internalidhex ${expected} at 0x${addr.toString(16)}`,
		});
	}

	return { uri: definitionUri, name, fingerprints };
}
```

**XML structure**:
```xml
<rom>
	<romid>
		<xmlid>56890009</xmlid>
		<internalidaddress>0x50000</internalidaddress>
		<internalidhex>56890009</internalidhex>
	</romid>
	<!-- ... tables ... -->
</rom>
```

### Multiple Fingerprints per Definition

A definition can have multiple fingerprints for different ROM variants:

```typescript
const fingerprints: ROMFingerprint[] = [];

// Primary fingerprint
if (internalidaddress && internalidhex) {
	fingerprints.push({
		reads: [{ address: addr, length: expected.length / 2 }],
		expectedHex: [expected],
		description: `internalidhex at 0x${addr.toString(16)}`,
	});
}

// Secondary fingerprint (e.g., checksum location)
if (checksumAddress && checksumValue) {
	fingerprints.push({
		reads: [{ address: checksumAddr, length: 4 }],
		expectedHex: [checksumValue],
		description: `checksum at 0x${checksumAddr.toString(16)}`,
	});
}

return { uri: definitionUri, name, fingerprints };
```

### Fingerprint Validation

Validate fingerprints during parsing:

```typescript
function validateFingerprint(fp: ROMFingerprint): boolean {
	// Check reads and expectedHex arrays match
	if (fp.reads.length !== fp.expectedHex.length) {
		console.warn("Fingerprint reads/expectedHex length mismatch");
		return false;
	}

	// Check weights if provided
	if (fp.weights && fp.weights.length !== fp.reads.length) {
		console.warn("Fingerprint weights length mismatch");
		return false;
	}

	// Validate each read
	for (const read of fp.reads) {
		if (read.address < 0 || read.length <= 0) {
			console.warn(`Invalid read: address=${read.address}, length=${read.length}`);
			return false;
		}
	}

	// Validate hex strings
	for (const hex of fp.expectedHex) {
		if (!/^[0-9a-fA-F]*$/.test(hex.replace(/\s/g, ""))) {
			console.warn(`Invalid hex string: ${hex}`);
			return false;
		}
	}

	return true;
}
```

---

## Scoring Algorithm

### How ROMs Are Matched to Definitions

The matching process:

1. Discover all available definitions via providers
2. For each definition, call `peek()` to get fingerprints
3. Score each definition against the ROM binary
4. Sort by score (highest first)
5. If top score is unique, auto-select; otherwise show QuickPick

### Scoring Logic from match.ts

The scoring algorithm is implemented in [`packages/core/src/definition/match.ts`](../packages/core/src/definition/match.ts):

```typescript
/**
 * Compute a score for a fingerprint against the given ROM image.
 *
 * @returns 0..sum(weights)
 */
export function scoreRomFingerprint(
	romBytes: Uint8Array,
	fp: ROMFingerprint,
): number {
	const weights = fp.weights ?? fp.reads.map(() => 100);
	let score = 0;

	for (let i = 0; i < fp.reads.length; i++) {
		const read = fp.reads[i];
		if (!read) continue;
		const expectedHex = fp.expectedHex[i] ?? "";
		const weight = weights[i] ?? 100;
		if (!expectedHex) continue;
		if (read.address < 0 || read.length <= 0) continue;
		if (read.address + read.length > romBytes.length) continue;

		const actual = romBytes.subarray(read.address, read.address + read.length);
		const expected = hexToBytes(expectedHex);
		if (bytesEqual(actual, expected)) score += weight;
	}

	return score;
}

/** Score a stub by taking the best score among its fingerprints. */
export function scoreRomDefinition(
	romBytes: Uint8Array,
	stub: ROMDefinitionStub,
): number {
	let best = 0;
	for (const fp of stub.fingerprints) {
		const s = scoreRomFingerprint(romBytes, fp);
		if (s > best) best = s;
	}
	return best;
}
```

### Score Calculation

**Per-fingerprint scoring**:
1. For each read in the fingerprint:
   - Extract bytes from ROM at specified address
   - Compare with expected hex bytes
   - If match: add weight to score
   - If mismatch: add 0 to score
2. Return total score

**Per-definition scoring**:
1. Score each fingerprint in the definition
2. Return the highest score (best match)

**Example**:
```
Fingerprint 1: reads=[{addr: 0x50000, len: 4}], expectedHex=["56890009"], weights=[100]
  ROM bytes at 0x50000: 56 89 00 09
  Match: YES
  Score: 100

Fingerprint 2: reads=[{addr: 0x60000, len: 2}], expectedHex=["ABCD"], weights=[50]
  ROM bytes at 0x60000: AB CD
  Match: YES
  Score: 50

Definition score: max(100, 50) = 100
```

### Why Some Scores Are Better Than Others

**Higher scores indicate better matches**:
- Exact matches on all reads score highest
- Partial matches (some reads match, some don't) score lower
- No matches score 0

**Weighted scoring allows prioritization**:
- Critical fingerprints get higher weights
- Secondary checks get lower weights
- Example: internal ID (weight 100) vs checksum (weight 50)

**Multiple fingerprints provide fallback matching**:
- If primary fingerprint doesn't match, secondary fingerprint may
- Useful for ROM variants with different internal IDs

---

## Ambiguity Resolution

### What Happens When Multiple Definitions Match

When multiple definitions have the same highest score, the user must choose:

```typescript
if (
	!chosen ||
	(candidates.length > 1 &&
		candidates[0] &&
		candidates[1] &&
		candidates[0].score === candidates[1].score)
) {
	const picked = await vscode.window.showQuickPick(
		candidates.map((c) => ({
			label: `${c.provider.label}: ${c.peek.name}`,
			description: c.peek.uri,
			detail: `score ${c.score}`,
			raw: c,
		})),
		{ placeHolder: "Select a definition" },
	);
	if (!picked) return;
	chosen = picked.raw;
}
```

### QuickPick UI for User Selection

The QuickPick shows:
- **Label**: Provider name and definition name
- **Description**: Definition file URI
- **Detail**: Score value

**Example**:
```
ECUFlash: 2011 Lancer Evo X 5MT
  file:///path/to/56890009.xml
  score 100

ECUFlash: 2011 Lancer Evo X 6MT
  file:///path/to/56890010.xml
  score 100
```

### Score Thresholds

Currently, any score > 0 is considered a match. Future versions may implement:

```typescript
const MIN_SCORE_THRESHOLD = 50; // Require at least 50% match

const candidates = [];
for (const p of registry.list()) {
	const uris = await p.discoverDefinitionUris();
	for (const u of uris) {
		const peek = await p.peek(u);
		const score = scoreRomDefinition(bytes, peek);
		if (score >= MIN_SCORE_THRESHOLD) {
			candidates.push({ provider: p, peek, score });
		}
	}
}
```

### Confidence Levels

Confidence can be computed as a percentage of maximum possible score:

```typescript
function computeConfidence(score: number, maxScore: number): number {
	return (score / maxScore) * 100;
}

// Example
const maxScore = 100; // Sum of all weights
const score = 100;
const confidence = computeConfidence(score, maxScore); // 100%

const score2 = 50;
const confidence2 = computeConfidence(score2, maxScore); // 50%
```

---

## Edge Cases and Limitations

### Corrupted ROM Data

**Problem**: ROM bytes are corrupted or partially read.

**Behavior**:
- Fingerprint matching still works if uncorrupted regions match
- Partial matches may occur
- User should validate ROM integrity before opening

**Mitigation**:
```typescript
// Check ROM size is reasonable
if (romBytes.length < 1024) {
	vscode.window.showWarningMessage("ROM file is suspiciously small");
}

// Check for common ROM sizes
const commonSizes = [256 * 1024, 512 * 1024, 1024 * 1024];
if (!commonSizes.includes(romBytes.length)) {
	vscode.window.showWarningMessage(`Unusual ROM size: ${romBytes.length} bytes`);
}
```

### Missing Fingerprints

**Problem**: Definition has no fingerprints.

**Behavior**:
- Score is 0
- Definition won't auto-match
- User can manually select via QuickPick

**Mitigation**:
```typescript
if (stub.fingerprints.length === 0) {
	console.warn(`Definition ${stub.name} has no fingerprints`);
	// Still include in candidates with score 0
	candidates.push({ provider: p, peek: stub, score: 0 });
}
```

### Partial Matches

**Problem**: Some fingerprint reads match, others don't.

**Behavior**:
- Score is partial (e.g., 50 out of 100)
- Definition ranks lower than full matches
- May be selected if no full matches exist

**Example**:
```
Definition A: score 100 (full match)
Definition B: score 50 (partial match)
Definition C: score 0 (no match)

Auto-select: Definition A
```

### Performance with Large ROM Files

**Problem**: Matching large ROM files is slow.

**Behavior**:
- Fingerprint matching is O(n*m) where n=definitions, m=reads per fingerprint
- Each read requires subarray extraction and comparison
- Typically fast (< 100ms for 1000 definitions)

**Optimization**:
```typescript
// Cache fingerprint scores
const scoreCache = new Map<string, number>();

for (const p of registry.list()) {
	const uris = await p.discoverDefinitionUris();
	for (const u of uris) {
		const cacheKey = `${p.id}:${u}`;
		if (scoreCache.has(cacheKey)) {
			const score = scoreCache.get(cacheKey)!;
			candidates.push({ provider: p, peek, score });
			continue;
		}

		const peek = await p.peek(u);
		const score = scoreRomDefinition(bytes, peek);
		scoreCache.set(cacheKey, score);
		candidates.push({ provider: p, peek, score });
	}
}
```

---

## Performance Considerations

### Fingerprint Matching Speed

**Typical performance**:
- Single fingerprint: < 1ms
- 100 definitions: < 100ms
- 1000 definitions: < 1s

**Bottlenecks**:
- Hex string parsing (convert hex to bytes)
- Byte comparison (subarray extraction)
- File I/O for `peek()` calls

### Memory Usage

**Per-definition memory**:
- Fingerprint object: ~200 bytes
- Hex strings: ~50 bytes per read
- Total per definition: ~300 bytes

**For 1000 definitions**: ~300KB

### Optimization Opportunities

**Lazy loading**:
```typescript
// Don't peek at all definitions upfront
// Only peek at definitions from enabled providers
const enabledProviders = settings.get("providers.enabled");
for (const p of registry.list()) {
	if (!enabledProviders.includes(p.id)) continue;
	// ... peek and score
}
```

**Parallel scoring**:
```typescript
// Score multiple definitions in parallel
const scores = await Promise.all(
	definitions.map(def => scoreRomDefinition(bytes, def))
);
```

**Fingerprint caching**:
```typescript
// Cache fingerprints after first peek
const fingerprintCache = new Map<string, ROMFingerprint[]>();

async function getCachedFingerprints(uri: string): Promise<ROMFingerprint[]> {
	if (fingerprintCache.has(uri)) {
		return fingerprintCache.get(uri)!;
	}
	const stub = await provider.peek(uri);
	fingerprintCache.set(uri, stub.fingerprints);
	return stub.fingerprints;
}
```

---

## Future Improvements

### Machine Learning Approaches

**Concept**: Train a model to predict definition from ROM bytes.

**Advantages**:
- Handle corrupted or variant ROMs
- Learn patterns from historical matches
- Improve over time

**Challenges**:
- Requires training data
- Model size and inference time
- Maintenance burden

### Fuzzy Matching

**Concept**: Allow partial byte matches (e.g., 95% match instead of 100%).

**Advantages**:
- Handle minor ROM variations
- Tolerate bit flips or corruption

**Challenges**:
- Increased false positives
- Slower matching
- Threshold tuning

**Implementation**:
```typescript
function fuzzyBytesEqual(actual: Uint8Array, expected: Uint8Array, tolerance = 0.95): boolean {
	if (actual.length !== expected.length) return false;
	let matches = 0;
	for (let i = 0; i < actual.length; i++) {
		if (actual[i] === expected[i]) matches++;
	}
	return matches / actual.length >= tolerance;
}
```

### Checksum Validation

**Concept**: Verify ROM integrity using checksums.

**Advantages**:
- Detect corrupted ROMs
- Validate ROM authenticity

**Challenges**:
- Checksum algorithm varies by provider
- May not be available for all ROMs

**Implementation**:
```typescript
interface ROMFingerprint {
	reads: { address: number; length: number }[];
	expectedHex: string[];
	weights?: number[];
	description?: string;
	checksum?: {
		algorithm: "crc32" | "sum8" | "xor";
		address: number;
		expectedValue: string;
	};
}

function validateChecksum(romBytes: Uint8Array, fp: ROMFingerprint): boolean {
	if (!fp.checksum) return true;
	
	const computed = computeChecksum(romBytes, fp.checksum.algorithm);
	const expected = fp.checksum.expectedValue;
	return computed === expected;
}
```

---

## Summary

ROM matching enables automatic definition discovery:

1. **Fingerprints** are pre-defined byte sequences in definition files
2. **Scoring** compares ROM bytes against fingerprints
3. **Ambiguity resolution** shows QuickPick when multiple definitions match
4. **Edge cases** are handled gracefully (corrupted data, missing fingerprints, etc.)
5. **Performance** is optimized for typical use cases
6. **Future improvements** include ML, fuzzy matching, and checksum validation

Key principles:
- Fingerprints are extracted from definitions, not ROMs
- Scoring is weighted and supports multiple fingerprints per definition
- Higher scores indicate better matches
- User selection is required for ambiguous matches
- Graceful degradation for edge cases
