# Injector Scaling

This reference is intentionally narrow.

Use it when injector scalar, latency, or small-pulse fueling behavior may be a
credible cause of the problem. Do not use it as a generic substitute for MAF,
fueling-mode, or broader diagnostic analysis.

## Core Rules

1. Most common injector models have known reference data available online.
   Start there before trying to infer values from logs.
2. Only troubleshoot injector scaling when fueling problems appear across the
   relevant fueling modes, not just in one narrow region.

## Start With Reference Data

Before proposing injector-scaling changes, try to determine:

- exact injector model or part number
- nominal flow rating
- pressure basis for that flow rating
- available published deadtime or latency data
- whether the hardware is OEM, aftermarket, or unknown

If the injector model is known, prefer published reference data over guessing
from logs.

## When Injector Scaling Is Plausible

Injector scaling becomes a stronger candidate when:

- injector hardware is known or recently changed
- current scalar or latency values look implausible for the installed hardware
- fueling error appears broadly across closed-loop and open-loop regions
- the problem does not disappear when switching analysis modes

This is the key filter: injector-scaling issues are often more global than
single-mode MAF or boost-related errors.

## When Not To Attempt It

Do not focus on injector scaling first when:

- fueling issues exist only in one narrow operating region
- MAF scaling or fueling mode is still unresolved
- injector hardware is unknown
- fuel pressure basis is unknown or unstable
- the ROM provenance is unknown and many fueling tables may already be corrupted

In those cases, gather hardware and baseline context first.

## Practical Procedure

Use this sequence:

1. identify the injector hardware if possible
2. research reference flow and latency data
3. compare current ROM values against those references
4. determine whether the fueling problem exists across relevant fueling modes
5. if yes, treat injector scaling as plausible
6. if no, prefer mode-specific causes such as MAF, compensation, or boost-related issues

## Reporting Rules

When presenting injector-scaling findings, include:

1. injector model confidence
2. reference data source or lack thereof
3. whether the observed fueling problem is broad or mode-specific
4. whether injector scaling is the leading hypothesis or only one candidate
5. what additional information would confirm or weaken the conclusion

## Refusal Conditions

Do not present confident injector-scaling recommendations when:

- the injector hardware cannot be identified
- no trustworthy reference data is available and the log evidence is weak
- the fueling issue appears only in one mode or one narrow region
- broader diagnostic questions are still unresolved

In those cases, report that injector scaling is not yet a justified first move.
