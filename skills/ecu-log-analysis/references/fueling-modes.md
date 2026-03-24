# Fueling Modes

This reference explains how to decide whether a log supports closed-loop,
open-loop, hybrid, or insufficient-data analysis.

Use this before recommending fueling or MAF changes when the operating mode is
unclear.

## Core Rule

Do not assume that a log is suitable for trim-based or wideband-based analysis
just because trim or AFR-like channels exist. Determine what fueling mode the
ECU is actually operating in for the region being analyzed.

## Why This Matters

Different analysis methods are valid in different fueling modes:

- closed-loop regions are usually best for trim-based reasoning
- open-loop regions are usually best for commanded-versus-measured fueling analysis
- hybrid or ambiguous regions require caution
- some logs do not provide enough information to determine mode reliably

Using the wrong method can produce precise-looking but misleading recommendations.

## Canonical Concepts

Try to identify these concepts before choosing a method:

- time
- RPM
- throttle or accelerator input
- load
- manifold pressure / boost / MAP
- coolant temperature
- short-term fuel trim
- long-term fuel trim
- commanded lambda or AFR
- measured lambda or AFR
- closed-loop / open-loop status, if available

The best direct signal is an explicit closed-loop or open-loop status flag. If
that is absent, infer the mode from surrounding evidence and report confidence.

## Mode Selection

### Closed-Loop

Likely when:

- short-term trims are actively moving around zero
- long-term trims are present and meaningful
- commanded fueling remains near stoichiometric behavior
- throttle and load are moderate and stable
- no obvious open-loop enrichment is present

Best use:

- trim-based fueling analysis
- low and moderate load MAF scaling
- cruise and light acceleration diagnostics

### Open-Loop

Likely when:

- commanded lambda or AFR departs clearly from stoichiometric targets
- trims become static, irrelevant, or absent
- throttle/load/boost indicate power enrichment conditions
- the ECU appears to be targeting enrichment directly

Best use:

- commanded-versus-measured lambda or AFR analysis
- higher-load MAF scaling when the required channels are present
- open-loop fueling validation

### Hybrid / Transition

Use this category when:

- the log passes through mixed operating regions
- trims and enrichment behavior overlap in ways that are not cleanly separable
- the ECU may blend strategies, or the status is changing rapidly

Best use:

- split the log into mode-specific regions before analyzing
- do not treat a mixed region as one uniform dataset

### Insufficient Data

Use this category when:

- no reliable closed/open status can be determined
- the required trim or wideband concepts are missing
- the log is dominated by transient or unstable behavior
- the operating region cannot be mapped confidently to a valid analysis mode

Best use:

- refuse or defer conclusions
- state what additional channels or logs are needed

## Practical Heuristics

If there is no explicit fueling-mode flag, use these heuristics carefully:

- moving short-term trim usually suggests closed-loop correction is active
- commanded lambda below stoichiometric usually suggests open-loop enrichment
- high throttle, rising boost, and richer-than-stoich targets often indicate open-loop
- idle and transitions are not automatically good closed-loop evidence

These heuristics are supporting evidence, not proof. If multiple signals
conflict, report the ambiguity instead of forcing a mode.

## Refusal Conditions

Do not choose an analysis mode confidently when:

- trims are present but their meaning or sign is unclear
- AFR-like channels exist but commanded versus measured values are not distinguishable
- the log is mostly transitions rather than stable cells
- the ECU strategy is unknown and the evidence is contradictory

In those cases, say which additional evidence would resolve the uncertainty.

## Output Shape

Prefer reporting mode selection explicitly:

```json
{
  "fueling_mode": "closed_loop",
  "confidence": "moderate",
  "evidence": [
    "short-term trims active",
    "commanded lambda near stoichiometric",
    "stable moderate-load region"
  ],
  "not_valid_for": [
    "open-loop wideband correction in this region"
  ]
}
```

## Decision Workflow

Use this workflow:

```text
1. Map source channels into canonical concepts.
2. Check for an explicit closed-loop or open-loop status channel.
3. If absent, infer mode from trims, commanded fueling, and operating conditions.
4. Split mixed logs into stable regions where possible.
5. Choose closed-loop, open-loop, hybrid, or insufficient-data.
6. State confidence and the evidence used.
7. Only then choose the downstream analysis method.
```
