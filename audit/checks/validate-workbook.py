"""Independent OOXML checks; stdlib only, reads the supplied local workbook."""
import hashlib
import json
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

path, mode = sys.argv[1:3]
assert mode in ('typed', 'ui')
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
rel_id = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

with zipfile.ZipFile(path) as archive:
    assert archive.testzip() is None, 'all ZIP entry CRCs'
    names = archive.namelist()
    assert len(names) == len(set(names)), 'no ambiguous duplicate entries'
    xml = {name: ET.fromstring(archive.read(name)) for name in names
           if name.endswith(('.xml', '.rels'))}
    for name, root in xml.items():
        if not name.endswith('.rels'):
            continue
        base = posixpath.dirname(posixpath.dirname(name))
        for rel in root:
            if rel.get('TargetMode') == 'External':
                continue
            target = rel.get('Target')
            resolved = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(base, target))
            assert resolved in names, (name, resolved)
    workbook = xml['xl/workbook.xml']
    relationships = {r.get('Id'): r.get('Target') for r in xml['xl/_rels/workbook.xml.rels']}
    shared = [''.join(si.itertext()) for si in xml.get('xl/sharedStrings.xml', [])]
    style_count = len(xml['xl/styles.xml'].find('s:cellXfs', ns))
    result = {}
    row_counts = {}
    for sheet in workbook.find('s:sheets', ns):
        target = relationships[sheet.get(rel_id)]
        target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
        root = xml[target]
        cells = {}
        assert not root.findall('.//s:f', ns), 'no executable formula elements'
        for cell in root.findall('.//s:c', ns):
            assert int(cell.get('s', '0')) < style_count
            kind = cell.get('t', 'n')
            value = cell.find('s:v', ns)
            text = value.text if value is not None else None
            if kind == 's':
                value = shared[int(text)]
            elif kind == 'b':
                assert text in ('0', '1')
                value = text == '1'
            elif kind == 'inlineStr':
                value = ''.join(cell.find('s:is', ns).itertext())
            elif text is None:
                value = None
            else:
                assert kind == 'n', kind
                value = float(text) if any(c in text for c in '.eE') else int(text)
            cells[cell.get('r')] = value
        result[sheet.get('name')] = cells
        row_counts[sheet.get('name')] = len(root.findall('.//s:row', ns))
    if mode == 'typed':
        assert list(result) == ['Typed cells', 'Second sheet']
        c = result['Typed cells']
        expected = {
            'A2': 'دانش‌آموز & <score> "quoted"\nnext', 'B2': 0, 'C2': 1.005,
            'D2': True, 'F2': "'=1+1", 'G2': -15,
            'A3': 'comma,semicolon;', 'B3': 9007199254740991, 'C3': 0.145,
            'D3': False, 'F3': "'+SUM(A1:A2)", 'G3': -0.5,
            'A4': "'@name", 'B4': -1, 'F4': "'-command",
        }
        for ref, value in expected.items():
            assert c[ref] == value and type(c[ref]) is type(value), (ref, c.get(ref), value)
        for ref in ('E2', 'E3', 'C4', 'D4', 'E4', 'G4'):
            assert c.get(ref) is None, (ref, c.get(ref))
        assert result['Second sheet']['A2'] == 'دو'
        assert result['Second sheet']['B2'] == 8
    else:
        assert list(result) == ['Scores', 'Changes']
        assert row_counts['Scores'] == 168
        assert row_counts['Changes'] > 1
        assert result['Scores']['E2'] == 'Sample Student 01'
        assert result['Scores']['F2'] == 64
        assert result['Scores']['G2'] == 58
        assert result['Scores']['H2'] == 49
        assert result['Scores']['D2'] == 'Y3YTYHXY'

with open(path, 'rb') as file:
    digest = hashlib.sha256(file.read()).hexdigest()
print(json.dumps({'mode': mode, 'zipCrcs': 'pass', 'xmlAndRelationships': 'pass',
                  'sheetRows': row_counts, 'typedValues': 'pass', 'formulas': 0,
                  'sha256': digest}, ensure_ascii=False))
