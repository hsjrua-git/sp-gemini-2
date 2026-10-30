import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { setLanguage } from '../i18n/index.js';
import TreePicker from './TreePicker.jsx';

const items = [
  { id: 'a', name: 'North', selectable: false },
  { id: 'b', name: 'Class', parentId: 'a' },
  { id: 'c', name: 'Student', parentId: 'b' },
  { id: 'd', name: 'South', selectable: false },
  { id: 'e', name: 'Class', parentId: 'd' },
];
function Picker() {
  const [value, setValue] = useState(['e']);
  return <><TreePicker items={items} value={value} onChange={setValue} label="Targets" includeBranch /><output>{value.join(',')}</output></>;
}
beforeEach(() => setLanguage('en'));

test('branch selection preserves other branches, excludes headings and can be undone', () => {
  render(<Picker />);
  document.querySelector('details').open = true;
  fireEvent.click(screen.getByRole('button', { name: 'Select branch · North' }));
  expect(screen.getByRole('status').textContent).toBe('e,b,c');
  fireEvent.click(screen.getByRole('button', { name: 'Clear branch · North' }));
  expect(screen.getByRole('status').textContent).toBe('e');
  fireEvent.click(screen.getByRole('button', { name: 'Clear', exact: true }));
  expect(screen.getByRole('status').textContent).toBe('');
});

test('search reaches collapsed descendants with full paths and Escape restores focus', () => {
  render(<Picker />);
  document.querySelector('details').open = true;
  fireEvent.click(screen.getByRole('button', { name: 'Expand or collapse North' }));
  expect(screen.queryByRole('checkbox', { name: 'Student' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'North / Class' } });
  fireEvent.click(screen.getByRole('button', { name: 'Select matches' }));
  expect(screen.getByRole('status').textContent).toBe('e,b,c');
  expect(screen.getByText('North / Class / Student')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(document.querySelector('details').open).toBe(false);
  expect(document.activeElement.tagName).toBe('SUMMARY');
});
