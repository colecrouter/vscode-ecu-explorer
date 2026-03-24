# Boost Control

This reference describes how to troubleshoot boost-related behavior from logs
and calibration data.

Use it for:

- no boost
- underboost
- overboost
- unstable or oscillating boost
- slow spool
- boost taper
- cases where wastegate or WGDC changes are not behaving as expected

## Core Rule

Do not assume boost problems are calibration-only problems.

Boost behavior sits at the intersection of:

- boost targets
- base wastegate duty
- error correction and compensations
- wastegate mechanical behavior
- boost reference plumbing
- turbine and exhaust behavior

When logs and changes do not converge, widen the diagnosis instead of repeating
the same type of correction.

## Required Context

Before making recommendations, gather as much of the following as possible:

- turbocharger type and recent hardware changes
- wastegate type and preload or crack-pressure details
- boost control solenoid type and plumbing layout
- known hardware faults or recent work on charge piping, exhaust, or vacuum lines
- ROM provenance and whether stock or known-good references are available
- boost target tables and relevant boost-control tables
- logs containing boost target, measured boost or MAP, WGDC, throttle, RPM, and load if possible

If key hardware or control-path context is missing, say so explicitly.

## Control-Path Model

Think through the control path in this order:

1. what boost the ECU is trying to achieve
2. what base wastegate duty it is commanding
3. what error correction or compensations are adding or removing
4. what the wastegate hardware is physically doing
5. what the turbo and exhaust system are actually capable of

Do not skip from an observed boost error directly to table changes without
checking where in this chain the mismatch is occurring.

## Quantitative Checks

When the qualitative diagnosis stalls, switch to simple quantitative reasoning.

Useful examples:

- estimate whether airflow and RPM are plausible for the reported boost
- compare target boost, measured boost, and control effort trends
- estimate whether the wastegate system appears to have enough control authority
- consider whether exhaust back pressure or flow limitation could explain why
  boost does not respond to expected wastegate changes (A/R vs. exhaust size, for example)

The exact formulas depend on the available signals, but the principle is the
same: use numbers to test whether the current hypothesis is physically plausible.

## Common Failure Branches

### No Boost

Consider:

- boost leaks or disconnected charge plumbing
- wastegate stuck open or preload too loose
- incorrect boost reference routing
- turbocharger damage or failure to spool
- exhaust leak before the turbine
- calibration commanding very low duty or target

### Underboost

Consider:

- real low target boost
- too little base WGDC
- correction or limits pulling boost down
- boost leaks
- weak actuator or low crack pressure
- exhaust or turbine inefficiency

### Overboost

Consider:

- boost target higher than expected
- excessive base WGDC
- error correction adding too much duty
- wastegate preload too tight
- wastegate flow limitation or creep
- exhaust back pressure causing the wastegate system to lose authority

### Oscillation or Unstable Boost

Consider:

- overly aggressive error correction
- control delay or turbo dynamics mismatch
- plumbing or actuator hysteresis
- noisy or delayed boost feedback

### Slow Spool or Excessive Taper

Consider:

- conservative WGDC or target strategy
- mechanical inefficiency
- exhaust restriction or leak
- turbo sizing mismatch
- control strategy that is correct at peak but poor in transient response

## Mechanical-First Checks

Before making repeated calibration changes, verify the obvious mechanical path:

- pressure and vacuum routing
- boost control solenoid plumbing
- actuator preload and crack pressure
- wastegate arm movement and flapper behavior
- charge leak integrity
- exhaust leak integrity or signs of restriction

If changing preload or duty repeatedly does not produce the expected trend, stop
and investigate the hardware path more directly.

## Calibration Checks

Once the hardware path is plausible, inspect:

- boost target tables
- base wastegate duty tables
- wastegate error correction tables
- compensation and limit tables that may cap boost indirectly
- any dynamics, turbo, or proportional correction tables relevant to the ECU

Compare against stock or known-good calibration data early when available.

## Non-Convergence Rule

If multiple adjustments fail to move the result in the expected direction, do
not continue iterating inside the same hypothesis.

Examples:

- loosening or tightening preload without a matching change in real control authority
- WGDC changes that do not produce corresponding boost changes
- continued overboost despite apparently low commanded control effort

At that point:

1. lower confidence in the current explanation
2. gather more hardware context
3. compare against baseline
4. branch into alternate causes such as plumbing, wastegate flow limitation, or exhaust back pressure

## Reporting Rules

When presenting a boost-control diagnosis, include:

1. current hypothesis
2. confidence in that hypothesis
3. whether the condition may be hazardous
4. whether the suspected cause is mechanical, calibration-side, or still ambiguous
5. what evidence supports the current branch
6. what evidence would falsify it
7. the next recommended check or adjustment

## Refusal Conditions

Do not present confident calibration recommendations when:

- the hardware path is largely unknown
- repeated changes have not converged
- measured boost, target boost, and control effort cannot be related clearly
- the log does not cover the relevant operating region

In those cases, prefer targeted checks and missing-context questions over more
table edits.
