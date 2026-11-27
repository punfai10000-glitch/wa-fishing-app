"""Hourly: current BOM marine wind warnings for WA (Strong Wind / Gale / Storm Force / Hurricane Force),
from the Bureau's anonymous FTP product IDW20100 (Marine Wind Warning Summary for Western Australia).
Only the facts are kept (warning type, day, coastal zone names); the app links to BOM for the full text.
© Commonwealth of Australia, Bureau of Meteorology.
Usage: python pipeline/fetch_bom_warnings.py OUTPUT_DIR   (never fails the workflow)
"""
import ftplib, io, json, os, re, sys
from datetime import datetime, timezone

MONTHS = {m: i for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                      'September', 'October', 'November', 'December'], 1)}


def split_areas(txt):
    txt = re.sub(r'\s+', ' ', txt).strip().rstrip('.')
    parts = re.split(r',\s*|\s+and\s+', txt)
    return [p.strip() for p in parts if p.strip()]


def parse(text):
    issued = re.search(r'Issued at (.+?)\n', text)
    year = datetime.now(timezone.utc).year
    days = []
    # Each "Wind Warnings for <Weekday> <d> <Month>" block holds one or more "<Type> Warning for the following areas:" lists
    blocks = re.split(r'\n(?=Wind Warnings for )', text)
    for b in blocks:
        h = re.match(r'Wind Warnings for \w+ (\d{1,2}) (\w+)', b)
        if not h:
            continue
        day, mon = int(h.group(1)), MONTHS.get(h.group(2))
        if not mon:
            continue
        y = year + 1 if (mon == 1 and datetime.now(timezone.utc).month == 12) else year
        warns = []
        for m in re.finditer(r'([A-Z][A-Za-z ]+?) Warning for the following areas:\s*\n(.+?)(?:\n\s*\n|\n(?=[A-Z][A-Za-z ]+ Warning for)|\Z)', b, re.S):
            warns.append({'type': m.group(1).strip(), 'areas': split_areas(m.group(2))})
        days.append({'date': f'{y:04d}-{mon:02d}-{day:02d}', 'warnings': warns})
    return {'issued': issued.group(1).strip() if issued else None, 'days': days}


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    buf = io.BytesIO()
    try:
        with ftplib.FTP('ftp.bom.gov.au', timeout=60) as ftp:
            ftp.login()
            ftp.retrbinary('RETR /anon/gen/fwo/IDW20100.txt', buf.write)
    except Exception as ex:
        print('BOM FTP failed:', ex); return
    text = buf.getvalue().decode('latin-1').replace('\r', '')
    if 'Marine Wind Warning Summary' not in text:
        print('Unexpected IDW20100 content; keeping previous file'); return
    out = parse(text)
    out.update(fetched_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), product='IDW20100',
               source='Bureau of Meteorology, Marine Wind Warning Summary for Western Australia',
               link='https://www.bom.gov.au/wa/warnings/')
    with open(os.path.join(outdir, 'bom_warnings.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('warnings:', json.dumps(out['days'])[:600])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'out')
