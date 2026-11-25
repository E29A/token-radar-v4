# Token Radar v4

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/E29A/token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/E29A/token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar, version 4. The program reads a sealed DefiLlama
snapshot of every protocol at or above $5M TVL, finds the ones that still
record no token, and ranks them by **expected value**:

```
implied value = P(launch | the record of its peers) x value if it launches
```

- **Launch odds** — a logistic model fitted at runtime on all 758
  protocols in the snapshot (outcome: the protocol already records a
  token).
- **Value if it launches** — a ridge on `log(mcap / TVL)` fitted on the
  snapshot's own 121 tokenised comparables.
- **The rule both models live by** — a term is kept only when it improves
  *both* independent holdouts (a slug split and a time split). The
  selection runs in the program, on every run, and the dashboard prints
  the kept terms, the dropped terms, and the holdout scores. On this
  snapshot: odds keep years tracked, the age-missing flag, category
  offsets, log TVL and 7d momentum (holdout log-loss 0.553 / 0.628 vs a
  0.680 / 0.889 no-model baseline); value keeps log TVL and log chains
  (holdout median error 82% / 85%, within-2x 33% / 31% — printed on the
  page, because a radar that hides its error is a horoscope).

The board holds 198 genuine pre-token protocols — the 40-protocol
watchlist is the floor, never the ceiling — each with a detail view
showing the odds x value decomposition and a farm plan with an estimated
all-in cost and duration.

## Run it

```
node main.ts --input <snapshot.json>        # writes /output (or $MAKEFUN_OUTPUT_DIR)
```

Node 22+, standard library only. Outputs: `board.json`, `data.js`,
`dashboard/`, `screenshots/`, `dossier.json`.

## Why v4 is not v2 with a new coat

v2 priced only the conditional value and let five terms ride on one
validation. v3's autopsy (a full model search) showed the conditional
model is data-capped on this snapshot. v4 changes the estimand instead:
expected value, with the launch-odds factor modelled from the peers'
record and every term of both factors gated by two holdouts. The
dashboard is a new design (paper-and-ink broadsheet) with the models'
out-of-sample record in an integrity strip above the board.
