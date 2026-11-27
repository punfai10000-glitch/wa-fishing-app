"""After the hourly live-data run: how old is each source's DATA (not just the file)?
Writes OUTPUT_DIR/status.json, which the app reads to show 'out of date' warnings per source, and exits 1 when a
CRITICAL source (coast forecast, BOM warnings) is stale, so the GitHub run is marked failed and GitHub emails the
owner. Every fetcher keeps last hour's file when its source fails, so without this check an old file could be
republished as if it were new.
Usage: python pipeline/check_freshness.py OUTPUT_DIR
"""
import json, os, sys
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc)

def ts(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except ValueError:
        return None

def newest(items, key):
    t = [ts(x.get(key)) for x in items or []]
    t = [x for x in t if x]
    return max(t) if t else None

# name: (file, how to find the data time, max age in hours, critical)
SOURCES = {
    'coast_forecast': ('coast_forecast.json', lambda d: ts(d.get('generated_at')), 3, True),
    'bom_warnings': ('bom_warnings.json', lambda d: ts(d.get('fetched_at')), 3, True),
    'bom_obs': ('bom_obs.json', lambda d: newest(d.get('stations'), 'time'), 3, False),
    'buoys': ('buoys.json', lambda d: newest(d.get('buoys'), 'time'), 6, False),
    'tides': ('tides.json', lambda d: max((ts(s['hourly'][-1][0]) for s in d.get('stations', []) if s.get('hourly')), default=None), 6, False),
    'clarity': ('clarity.json', lambda d: ts(d.get('newest')), 24 * 10, False),
}

def main(outdir):
    status, bad_critical = {}, []
    for name, (fn, when, max_h, critical) in SOURCES.items():
        path = os.path.join(outdir, fn)
        entry = {'file': fn, 'max_age_h': max_h, 'critical': critical}
        try:
            d = json.load(open(path))
            t = when(d)
        except Exception as ex:
            t, entry['error'] = None, f'{type(ex).__name__}: {ex}'[:200]
        if t is None:
            entry.update(state='failed', age_h=None)
        else:
            age = (NOW - t).total_seconds() / 3600
            entry.update(data_time=t.isoformat(timespec='seconds'), age_h=round(age, 1), state='ok' if age <= max_h else 'stale')
        status[name] = entry
        print(f"{name:15s} {entry['state']:7s} age {entry.get('age_h')} h (max {max_h}){'  CRITICAL' if critical else ''}")
        if critical and entry['state'] != 'ok':
            bad_critical.append(name)
    json.dump({'generated_at': NOW.isoformat(timespec='seconds'), 'sources': status}, open(os.path.join(outdir, 'status.json'), 'w'), indent=1)
    if bad_critical:
        print('::error::Stale or failed critical live data: ' + ', '.join(bad_critical))
        sys.exit(1)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'out')
