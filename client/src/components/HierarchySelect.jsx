import { hierarchy } from '../lib/hierarchy.js';

export default function HierarchySelect({ items, value, onChange, emptyLabel = '—', ...props }) {
  return <select {...props} value={value ?? ''} onChange={event => onChange(event.target.value)}>
    <option value="">{emptyLabel}</option>
    {hierarchy(items).map(item => <option key={item.id} value={item.id} disabled={item.selectable === false}>
      {item.path}
    </option>)}
  </select>;
}
