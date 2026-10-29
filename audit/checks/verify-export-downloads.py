"""Independent checks of the actual Stage 2 Chromium download bytes."""
import csv
import hashlib
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

folder = Path(__file__).resolve().parents[1] / 'fix-a31-a35'
tables = {}
for filename, count, periods in [
    ('selected-period-1.csv', 15, {'Sample — Group A weekly · 1'}),
    ('all-periods.csv', 30, {'Sample — Group A weekly · 1', 'Sample — Group A weekly · 2'}),
]:
    with (folder / filename).open(encoding='utf-8-sig', newline='') as source:
        rows = list(csv.DictReader(source))
    assert len(rows) == count
    assert {row['Period'] for row in rows} == periods
    tables[filename] = rows
selected = tables['selected-period-1.csv']
assert selected == [row for row in tables['all-periods.csv'] if row['Period'].endswith(' · 1')]
assert next(row for row in selected if row['Full name'] == 'Sample Student 01')['سرعت (Speed)'] == '64'
assert next(row for row in tables['all-periods.csv']
            if row['Full name'] == 'Sample Student 01' and row['Period'].endswith(' · 2'))['سرعت (Speed)'] == '44'

svg = ET.parse(folder / 'chart-1-trend.svg').getroot()
assert svg.attrib['data-chart-root'] == 'true'
assert (float(svg.attrib['width']), float(svg.attrib['height'])) == (439, 280)
ns = {'svg': 'http://www.w3.org/2000/svg'}
paths = svg.findall('.//svg:path', ns)
assert any('recharts-line-curve' in node.attrib.get('class', '') and node.attrib.get('d') for node in paths)
assert len(svg.findall('.//svg:circle', ns)) >= 2
assert 'shared.periodKey' not in ''.join(svg.itertext())
assert 'Sample — Group A weekly · 2' in ''.join(svg.itertext())
png = (folder / 'chart-1-trend.png').read_bytes()
assert png[:8] == b'\x89PNG\r\n\x1a\n'
assert struct.unpack('>II', png[16:24]) == (878, 560)
print(json.dumps({
    'selectedRows': len(selected), 'allRows': len(tables['all-periods.csv']),
    'knownScores': [64, 44], 'svgSize': [439, 280], 'pngSize': [878, 560],
    'plottedLineAndPoints': True,
    'sha256': {name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
               for name in [*tables, 'chart-1-trend.svg', 'chart-1-trend.png']},
}))
