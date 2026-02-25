# Table Schema and XML Definition Format

This document describes the XML definition format for ROM tables, including table types, axis definitions, data layout, and scaling expressions.

## Overview

ECU Explorer supports three table types:

- **1D Tables**: Single-dimensional lookup tables (e.g., fuel injector scaling)
- **2D Tables**: Two-dimensional maps with X and Y axes (e.g., fuel map by RPM and load)
- **3D Tables**: Three-dimensional surfaces with X, Y, and Z axes (e.g., ignition timing by RPM, load, and temperature)

Each table consists of:
- **Axes**: Breakpoints that define the table's dimensions
- **Z Data**: The actual table values stored in ROM

## Axis Definitions

Axes define the breakpoints (labels) for table dimensions. They can be either static (embedded in XML) or dynamic (stored in ROM).

### Static Axes

Static axes have their values embedded directly in the XML definition:

```xml
<table name="FuelMap" type="2D">
  <table name="XAxis" type="X Axis">
    <data>1000</data>
    <data>2000</data>
    <data>3000</data>
    <data>4000</data>
  </table>
</table>
```

**Characteristics**:
- Values are fixed and cannot be edited
- Useful for standard breakpoints (e.g., RPM ranges)
- Reduces ROM size by not storing axis data

### Dynamic Axes

Dynamic axes are stored in ROM and can be read at runtime:

```xml
<table name="FuelMap" type="2D">
  <table name="XAxis" type="X Axis" address="0x1000" elements="16">
    <scaling name="RPMScaling"/>
  </table>
</table>
```

**Characteristics**:
- Address points to ROM location
- Elements specifies number of breakpoints
- Scaling defines how raw bytes are converted to physical units
- Can be edited (with monotonicity constraints)

### Axis Templates and Merging

Base XML files define axis templates that are inherited by child definitions:

**Base XML (evo10base.xml)**:
```xml
<rom>
  <table name="FuelMap" type="2D">
    <table name="XAxis" type="X Axis" elements="16">
      <scaling name="RPMScaling"/>
    </table>
    <table name="YAxis" type="Y Axis" elements="8">
      <scaling name="LoadScaling"/>
    </table>
  </table>
</rom>
```

**Child XML (2011_USDM_5MT.xml)**:
```xml
<rom>
  <include>evo10base</include>
  <table name="FuelMap" address="0x5000"/>
</rom>
```

**Merge Result**:
- Child's address (0x5000) overrides base's address
- Axis definitions (elements, scaling) come from base
- Axis addresses can be overridden in child if needed

## Z-Data Layout and Addressing

Z-data is the actual table values stored in ROM. The layout depends on the table type and optional stride overrides.

### Address Calculation

#### 1D Tables

For a 1D table with N elements:

```
offset = z.address + index * byteSize(z.dtype)
```

Example: 16-element u16 table at 0x1000
```
Element 0: 0x1000
Element 1: 0x1002
Element 2: 0x1004
...
Element 15: 0x101E
```

#### 2D Tables (Row-Major)

For a 2D table with R rows and C columns:

```
offset = z.address + row * rowStride + col * colStride
```

Default strides:
- `rowStride = cols * byteSize(dtype)`
- `colStride = byteSize(dtype)`

Example: 8×16 u8 table at 0x2000
```
Row 0: 0x2000 - 0x200F (16 bytes)
Row 1: 0x2010 - 0x201F (16 bytes)
Row 2: 0x2020 - 0x202F (16 bytes)
...
Row 7: 0x2070 - 0x207F (16 bytes)
```

#### 2D Tables (Column-Major with swapxy)

When `swapxy="true"`, the table is stored column-major:

```xml
<table name="Map" type="2D" swapxy="true" address="0x2000">
  <table name="XAxis" type="X Axis" elements="16"/>
  <table name="YAxis" type="Y Axis" elements="8"/>
</table>
```

This is equivalent to transposing the logical table layout.

#### 3D Tables

For a 3D table with R rows, C columns, and D depth layers:

```
offset = z.address + layer * (rows * cols * byteSize) + row * rowStride + col * colStride
```

### Endianness Handling

Endianness specifies byte order for multi-byte values:

```xml
<scaling name="RPMScaling" storagetype="uint16" endian="big">
  <toexpr>x * 0.25</toexpr>
</scaling>
```

**Supported Values**:
- `"little"` or `"le"`: Little-endian (LSB first) - default
- `"big"` or `"be"`: Big-endian (MSB first)

**Example**: Reading 0x1234 as u16
- Little-endian: 0x3412 = 13330
- Big-endian: 0x1234 = 4660

### Data Type Support

Supported scalar types for Z-data and axes:

| Type | Size | Range | Use Case |
|------|------|-------|----------|
| `u8` | 1 byte | 0 to 255 | Percentages, small values |
| `i8` | 1 byte | -128 to 127 | Signed small values |
| `u16` | 2 bytes | 0 to 65535 | RPM, load, timing |
| `i16` | 2 bytes | -32768 to 32767 | Signed values |
| `u32` | 4 bytes | 0 to 4294967295 | Large values |
| `i32` | 4 bytes | -2147483648 to 2147483647 | Signed large values |
| `f32` | 4 bytes | IEEE 754 float | Floating-point values |

## Scaling Expressions

Scaling expressions convert raw ROM values to physical units using affine transformations.

### Affine Transformations

Only linear (affine) transformations are supported:

```
physical = raw * scale + offset
```

This is extracted from `toexpr` by testing linearity:

```xml
<scaling name="RPMScaling" storagetype="uint16">
  <toexpr>x * 0.25</toexpr>
  <units>RPM</units>
</scaling>
```

Parsed as: `scale = 0.25, offset = 0`

### Expression Parsing Rules

Valid expressions must:
1. Contain only `x` (or `X`), digits, operators (`+`, `-`, `*`, `/`), and parentheses
2. Be linear in `x` (no `x^2`, `sin(x)`, etc.)
3. Evaluate to finite numbers

**Valid Examples**:
- `x * 0.25` → scale=0.25, offset=0
- `x * 1000 / 256` → scale=3.90625, offset=0
- `(x - 128) / 2` → scale=0.5, offset=-64
- `14.7 * 128 / x` → **INVALID** (non-linear)
- `x * x` → **INVALID** (non-linear)

### Why Non-Linear Expressions Are Not Supported

Non-linear expressions (e.g., `14.7 * 128 / x` for AFR) cannot be inverted for editing:

```
physical = 14.7 * 128 / raw
raw = 14.7 * 128 / physical  ← Requires division, not simple arithmetic
```

This makes it impossible to safely convert user edits back to ROM values. Future versions may support non-linear expressions with explicit inverse functions.

## Base/Child XML Merging Rules

ROM-specific XMLs often inherit from base definitions, overriding only addresses.

### Include Resolution

```xml
<rom>
  <include>evo10base</include>
  <table name="FuelMap" address="0x5000"/>
</rom>
```

**Resolution Process**:
1. Look for `evo10base.xml` in same directory
2. Parse base file recursively (base can include other bases)
3. Build template index from base tables
4. Merge child tables with templates

### Address Overrides

Child definitions can override addresses:

```xml
<!-- Base: evo10base.xml -->
<table name="FuelMap" address="0x4000">
  <table name="XAxis" address="0x3000" elements="16"/>
  <table name="YAxis" address="0x3020" elements="8"/>
</table>

<!-- Child: 2011_USDM_5MT.xml -->
<table name="FuelMap" address="0x5000">
  <table name="XAxis" address="0x4000"/>
</table>
```

**Result**:
- Z-data address: 0x5000 (from child)
- X-axis address: 0x4000 (from child override)
- Y-axis address: 0x3020 (from base, not overridden)

### Template Inheritance

Axis templates define structure that's inherited:

```xml
<!-- Base -->
<table name="FuelMap" type="2D">
  <table name="XAxis" type="X Axis" elements="16">
    <scaling name="RPMScaling"/>
  </table>
  <table name="YAxis" type="Y Axis" elements="8">
    <scaling name="LoadScaling"/>
  </table>
</table>

<!-- Child -->
<table name="FuelMap" address="0x5000"/>

<!-- Merged -->
<table name="FuelMap" type="2D" address="0x5000">
  <table name="XAxis" type="X Axis" address="0x3000" elements="16">
    <scaling name="RPMScaling"/>
  </table>
  <table name="YAxis" type="Y Axis" address="0x3020" elements="8">
    <scaling name="LoadScaling"/>
  </table>
</table>
```

## Complete XML Examples

### 1D Table Example (Simple Lookup)

```xml
<rom>
  <scaling name="InjectorScaling" storagetype="uint8">
    <toexpr>x * 0.1</toexpr>
    <units>ms</units>
  </scaling>

  <table name="InjectorPulseWidth" type="1D" address="0x1000" scaling="InjectorScaling">
    <table name="RPMAxis" type="X Axis" elements="16">
      <scaling name="RPMScaling"/>
    </table>
  </table>
</rom>
```

**Structure**:
- 16 elements of u8 data at 0x1000
- Each element scaled by 0.1 to get milliseconds
- X-axis provides RPM breakpoints

### 2D Table Example (Map with X/Y Axes)

```xml
<rom>
  <scaling name="FuelScaling" storagetype="uint16" endian="little">
    <toexpr>x * 0.001</toexpr>
    <units>ms</units>
  </scaling>

  <scaling name="RPMScaling" storagetype="uint16">
    <toexpr>x * 0.25</toexpr>
    <units>RPM</units>
  </scaling>

  <scaling name="LoadScaling" storagetype="uint8">
    <toexpr>x</toexpr>
    <units>%</units>
  </scaling>

  <table name="FuelMap" type="2D" address="0x5000" scaling="FuelScaling">
    <table name="RPMAxis" type="X Axis" address="0x3000" elements="16">
      <scaling name="RPMScaling"/>
    </table>
    <table name="LoadAxis" type="Y Axis" address="0x3020" elements="8">
      <scaling name="LoadScaling"/>
    </table>
  </table>
</rom>
```

**Structure**:
- 16 × 8 table (16 RPM breakpoints, 8 load breakpoints)
- Z-data: 256 u16 values at 0x5000 (512 bytes)
- X-axis: 16 u16 values at 0x3000 (32 bytes)
- Y-axis: 8 u8 values at 0x3020 (8 bytes)

**Memory Layout**:
```
0x3000-0x301F: RPM axis (16 × u16)
0x3020-0x3027: Load axis (8 × u8)
0x5000-0x51FF: Fuel map (16 × 8 × u16)
```

### 3D Table Example (3D Map with X/Y/Z Axes)

```xml
<rom>
  <scaling name="IgnitionScaling" storagetype="int8">
    <toexpr>x * 0.5</toexpr>
    <units>degrees</units>
  </scaling>

  <table name="IgnitionMap" type="3D" address="0x6000" scaling="IgnitionScaling">
    <table name="RPMAxis" type="X Axis" address="0x3000" elements="16">
      <scaling name="RPMScaling"/>
    </table>
    <table name="LoadAxis" type="Y Axis" address="0x3020" elements="8">
      <scaling name="LoadScaling"/>
    </table>
    <table name="TempAxis" type="Z Axis" address="0x3028" elements="4">
      <scaling name="TempScaling"/>
    </table>
  </table>
</rom>
```

**Structure**:
- 16 × 8 × 4 table (16 RPM, 8 load, 4 temperature layers)
- Z-data: 512 i8 values at 0x6000 (512 bytes)
- Each layer is 128 values (16 × 8)

### Base XML with Child Override Example

**Base (evo10base.xml)**:
```xml
<rom>
  <scaling name="FuelScaling" storagetype="uint16">
    <toexpr>x * 0.001</toexpr>
    <units>ms</units>
  </scaling>

  <table name="FuelMap" type="2D" address="0x5000" scaling="FuelScaling">
    <table name="RPMAxis" type="X Axis" address="0x3000" elements="16">
      <scaling name="RPMScaling"/>
    </table>
    <table name="LoadAxis" type="Y Axis" address="0x3020" elements="8">
      <scaling name="LoadScaling"/>
    </table>
  </table>
</rom>
```

**Child (2011_USDM_5MT.xml)**:
```xml
<rom>
  <include>evo10base</include>

  <table name="FuelMap" address="0x8000">
    <table name="RPMAxis" address="0x7000"/>
  </table>
</rom>
```

**Merged Result**:
- Z-data address: 0x8000 (from child)
- X-axis address: 0x7000 (from child override)
- Y-axis address: 0x3020 (from base, not overridden)
- Scaling: FuelScaling (from base)
- Type: 2D (from base)

## Validation Rules

### Required Fields

| Element | Required | Notes |
|---------|----------|-------|
| `table.name` | Yes | Unique identifier |
| `table.address` | Yes | Byte offset in ROM |
| `table.type` | Yes | 1D, 2D, or 3D |
| `axis.elements` | Yes (dynamic) | Number of breakpoints |
| `axis.address` | Yes (dynamic) | ROM location |
| `scaling.storagetype` | No | Defaults to u8 |
| `scaling.toexpr` | No | Defaults to identity (x) |

### Address Bounds Checking

- Address must be non-negative
- Address + data size must not exceed ROM size
- Overlapping tables should be detected and warned

### Axis Monotonicity

Dynamic axes should be monotonically increasing or decreasing:

```
axis[0] < axis[1] < axis[2] < ... < axis[n-1]
```

Violations indicate:
- Incorrect axis definition
- Byte order (endianness) mismatch
- Scaling expression error

### Data Type Constraints

- Z-data dtype must match scaling storagetype
- Axis dtype must match scaling storagetype
- Scaling expressions must produce values within dtype range

## Validation Checklist

When creating or modifying XML definitions:

- [ ] All table names are unique
- [ ] All addresses are within ROM bounds
- [ ] All data sizes fit within ROM
- [ ] Axes are monotonic (if dynamic)
- [ ] Scaling expressions are linear
- [ ] Endianness matches actual ROM layout
- [ ] Data types are consistent
- [ ] Include paths resolve correctly
- [ ] No circular includes
- [ ] Fingerprints match actual ROM bytes

## Related Documentation

- **Setup Guide**: [`SETUP.md`](../SETUP.md) - Development environment
- **Architecture**: [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System design
- **Testing Guide**: [`TESTING.md`](TESTING.md) - Testing patterns
- **Development Plan**: [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Roadmap
