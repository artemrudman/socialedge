# SSI formula research

SocialEdge exports SSI snapshots together with the activities you logged each
day. The analyzer turns that export into transparent lagged comparisons.

```bash
python3 analysis/analyze_ssi.py socialedge_YYYY-MM-DD.json \
  --lags 0 1 2 3 \
  --output ssi-analysis.json
```

The first version reports, for every observed activity and pillar:

- score transitions with and without that activity;
- the exported activity label and stable index;
- the mean pillar-score change in both groups;
- their difference for each requested lag.

The analyzer compares only consecutive daily SSI snapshots. It skips gaps: you
cannot attribute a multi-day score change to one logged activity day.

These are associations, not causal weights. Prefer days where you change only
one activity, keep logging zero-activity control days, and collect at least
30–60 daily transitions before interpreting a result.

Run the tests with:

```bash
python3 -m unittest discover -s analysis -p 'test_*.py'
```
