import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hierarchy } from '../lib/hierarchy.js';

// Checkboxes retain their native keyboard semantics; indentation and branch
// disclosure express the hierarchy without claiming incomplete ARIA tree keys.
export default function TreePicker({ items, value = [], onChange, label, disabled = false, includeBranch = false, emptyHint }) {
  const { t } = useTranslation('workflows');
  const detailsRef = useRef(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const ordered = useMemo(() => hierarchy(items), [items]);
  const selected = new Set(value);
  const selectedItems = ordered.filter(item => selected.has(item.id));
  const term = search.trim().toLocaleLowerCase();
  const visible = ordered.filter(item => {
    if (onlySelected && !selected.has(item.id)) return false;
    if (term) return item.path.toLocaleLowerCase().includes(term);
    return onlySelected || !item.ancestorIds.some(id => collapsed.includes(id));
  });
  const matchingIds = ordered.filter(item => item.selectable !== false && (!term || item.path.toLocaleLowerCase().includes(term))).map(item => item.id);
  function toggle(ids, checked) {
    const next = new Set(value);
    for (const id of ids) {
      if (checked) next.add(id); else next.delete(id);
    }
    onChange([...next]);
  }
  return <fieldset className="tree-picker" disabled={disabled}>
    <legend>{label}</legend>
    <details ref={detailsRef} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        detailsRef.current.open = false;
        detailsRef.current.querySelector('summary').focus();
      }
    }}>
      <summary className="tree-summary">
        <span className="tree-summary-text">
          <span>{value.length ? t('tree.selected', { count: value.length }) : emptyHint || t('tree.choose')}</span>
          {selectedItems.length > 0 && <small>{selectedItems.slice(0, 3).map(item => item.label).join(' · ')}{selectedItems.length > 3 ? ' …' : ''}</small>}
        </span>
        <span className="tree-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="tree-body">
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label={t('tree.search', { label })} placeholder={t('tree.search', { label })} />
        <div className="tree-toolbar">
          <button type="button" className="quiet" onClick={() => toggle(matchingIds, true)}>{t(term ? 'tree.selectMatches' : 'tree.all')}</button>
          <button type="button" className="quiet" onClick={() => onChange([])} disabled={!value.length}>{t('tree.clear')}</button>
          <button type="button" className="quiet" aria-pressed={onlySelected} onClick={() => setOnlySelected(!onlySelected)}>{t('tree.selected', { count: value.length })}</button>
        </div>
        <ul className="plain-list tree-options">
          {visible.map(item => {
            const branch = includeBranch && item.hasChildren ? ordered.filter(node => node.selectable !== false && (node.id === item.id || node.ancestorIds.includes(item.id))).map(node => node.id) : [];
            const branchSelected = branch.filter(id => selected.has(id)).length;
            const allBranch = branch.length > 0 && branchSelected === branch.length;
            return <li key={item.id} className={`tree-option${selected.has(item.id) ? ' is-selected' : ''}${item.selectable === false ? ' is-heading' : ''}`} style={{ '--tree-depth': term || onlySelected ? 0 : Math.min(item.depth, 3) }}>
              {item.hasChildren && !term && !onlySelected ? <button type="button" className="quiet tree-disclosure" aria-label={t('tree.expand', { name: item.label })} aria-expanded={!collapsed.includes(item.id)} onClick={() => setCollapsed(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}><span aria-hidden="true">⌄</span></button> : <span className="tree-node-mark" aria-hidden="true" />}
              {item.selectable === false ? <span className="tree-option-label"><strong>{item.label}</strong>{(term || onlySelected) && item.depth > 0 && <small>{item.path}</small>}</span> : <label className="tree-option-label" title={item.path}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={event => toggle([item.id], event.target.checked)} />
                <span>{item.label}{(term || onlySelected || item.depth > 3) && item.depth > 0 && <small>{item.path}</small>}</span>
              </label>}
              {branch.length > 0 && <button type="button" className="quiet tree-branch" aria-label={`${t(allBranch ? 'tree.clearBranch' : 'tree.branch')} · ${item.label}`} title={t(allBranch ? 'tree.clearBranch' : 'tree.branch')} aria-pressed={allBranch} onClick={() => toggle(branch, !allBranch)}>{branchSelected}/{branch.length}</button>}
            </li>;
          })}
        </ul>
        {visible.length === 0 && <p className="hint tree-empty">{t('tree.noMatches')}</p>}
        {includeBranch && <p className="hint tree-help">{t('tree.branchHelp')}</p>}
        <div className="tree-footer"><button type="button" className="quiet" onClick={() => { detailsRef.current.open = false; detailsRef.current.querySelector('summary').focus(); }}>{t('tree.done')}</button></div>
      </div>
    </details>
  </fieldset>;
}
