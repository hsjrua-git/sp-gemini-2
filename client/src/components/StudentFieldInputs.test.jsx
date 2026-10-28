import { beforeAll, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StudentFieldInputs from './StudentFieldInputs.jsx';
import i18n from '../i18n/index.js';

// The component translates its chrome (restricted badge, Yes/No options) via
// i18next, whose default language is Persian. Pin the instance to English so
// the assertions below keep matching the rendered strings.
beforeAll(() => {
  i18n.changeLanguage('en');
});

const definitions = [
  { id: 'nickname', label: 'Nickname', fieldType: 'short_text' },
  { id: 'scholarship', label: 'Scholarship', fieldType: 'yes_no' },
  {
    id: 'house',
    label: 'House',
    fieldType: 'choice',
    choices: ['Red', 'Blue'],
    isRestricted: true,
  },
];

function noop() {}

describe('StudentFieldInputs', () => {
  it('renders nothing when there are no definitions', () => {
    const { container } = render(
      <StudentFieldInputs definitions={[]} values={{}} onChange={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one labelled control per definition', () => {
    render(
      <StudentFieldInputs
        definitions={definitions}
        values={{}}
        onChange={noop}
      />,
    );
    expect(screen.getByLabelText(/Nickname/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Scholarship/)).toBeInTheDocument();
    expect(screen.getByLabelText(/House/)).toBeInTheDocument();
  });

  it('marks restricted fields with a badge', () => {
    render(
      <StudentFieldInputs
        definitions={definitions}
        values={{}}
        onChange={noop}
      />,
    );
    expect(screen.getByText('restricted')).toBeInTheDocument();
  });

  it('reports text edits as (id, value)', () => {
    const onChange = vi.fn();
    render(
      <StudentFieldInputs
        definitions={definitions}
        values={{}}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Nickname/), {
      target: { value: 'Sam' },
    });
    expect(onChange).toHaveBeenCalledWith('nickname', 'Sam');
  });

  it('translates the yes/no select into a real boolean', () => {
    const onChange = vi.fn();
    render(
      <StudentFieldInputs
        definitions={definitions}
        values={{}}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Scholarship/), {
      target: { value: 'yes' },
    });
    expect(onChange).toHaveBeenCalledWith('scholarship', true);
  });

  it('disables controls when asked', () => {
    render(
      <StudentFieldInputs
        definitions={definitions}
        values={{}}
        onChange={noop}
        disabled
      />,
    );
    expect(screen.getByLabelText(/Nickname/)).toBeDisabled();
  });
});
