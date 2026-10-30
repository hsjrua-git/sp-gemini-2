"""Read-only checks of the retained browser downloads (no server/DB required)."""
import csv
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[1] / 'workflows-2026-10-30'
for item in json.loads((root / 'captured-files.json').read_text()):
    content = (root / item['file']).read_bytes()
    assert len(content) == item['bytes']
    assert hashlib.sha256(content).hexdigest() == item['sha256'], item['file']
print('PASS all 26 copied captures/logs match their recorded hashes')

rows = list(csv.reader(io.StringIO((root / 'student-history.csv').read_text())))
assert len(rows) == 9
assert [r[0] for r in rows[1:]] == [
    '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25',
    '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23',
]
assert {r[1] for r in rows[1:]} == {'Sample — Group A weekly'}
assert all(len(r) == len(rows[0]) for r in rows)
assert all(rows[0][i].endswith('(quality)') and rows[0][i+1].endswith('(quantity)')
           for i in range(2, len(rows[0]), 2))
print('PASS history CSV: eight exact sessions, one assignment, both dimensions')

with zipfile.ZipFile(root / 'export-json.zip') as data_zip, \
     zipfile.ZipFile(root / 'export-json-png.zip') as image_zip:
    assert set(data_zip.namelist()) == {'scores-quality.json', 'scores-quantity.json'}
    for dimension in ('quality', 'quantity'):
        name = f'scores-{dimension}.json'
        assert data_zip.read(name) == image_zip.read(name)
        data = json.loads(data_zip.read(name))
        assert len(data['periods']) == 2 and len(data['students']) == 15
        assert len(data['parameters']) == 6
        assert all(len(s['periods']) == 2 for s in data['students'])
        values = [cell for s in data['students'] for p in s['periods']
                  for cell in p['values'].values()]
        if dimension == 'quality':
            assert all(c['value'] is None or 0 <= c['value'] <= 100 for c in values)
        assert any(c['previous'] is not None for c in values)
        speed = 'cd24746c-b362-4c50-9905-ee6d6511d36b'
        matching = sum(any(p['values'].get(speed, {}).get('value') == 64
                           for p in s['periods']) for s in data['students'])
        assert matching == (12 if dimension == 'quality' else 0)
        png = image_zip.read(f'chart-1-heatmap-{dimension}.png')
        assert png[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', png[16:24]) == (1120, 840)
    print('PASS JSON/PNG: matching data, quality range, previous values, 1120x840 images')
    print('PASS numeric equality fixture: quality 12 students, quantity 0 students')

with zipfile.ZipFile(root / 'export-csv-svg.zip') as z:
    for dimension in ('quality', 'quantity'):
        assert len(list(csv.reader(io.StringIO(z.read(f'scores-{dimension}.csv').decode('utf-8-sig'))))) > 1
        assert ET.fromstring(z.read(f'chart-1-trend-{dimension}.svg')).tag.endswith('svg')
with zipfile.ZipFile(root / 'export-xlsx-svg.zip') as z:
    with zipfile.ZipFile(io.BytesIO(z.read('export.xlsx'))) as workbook:
        sheets = ET.fromstring(workbook.read('xl/workbook.xml')).findall('.//{*}sheet')
        assert len(sheets) == 2
        assert all(any(d in s.attrib['name'].lower() for s in sheets)
                   for d in ('quality', 'quantity'))
    for dimension in ('quality', 'quantity'):
        assert ET.fromstring(z.read(f'chart-1-trend-{dimension}.svg')).tag.endswith('svg')
print('PASS CSV/SVG and XLSX/SVG bundles contain both dimensions and valid XML')

for run in ('a', 'b'):
    metrics = json.loads((root / f'cold-{run}-metrics.json').read_text())
    assert metrics['viewport'] == [1233, 887]
    assert metrics['observations2d'] == 0
    assert metrics['observerStart'] < metrics['firstCanvas']
    assert not any('chartTheme' in r['name'] for r in metrics['resources'])
print('PASS cold captures: matching viewport, no observed 2D flash, deferred chart bundle')
