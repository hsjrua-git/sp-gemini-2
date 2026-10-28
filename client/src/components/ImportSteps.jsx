import { Fragment } from 'react';

// A compact "1 — 2 — 3" progress rail shared by the two import wizards, so the
// user can see where they are (Choose a file → Review → Done). Purely
// presentational: the page passes the current step index and colour/fill
// conveys upcoming / active / done. Kept glyph-free (numbers, not check marks)
// so it stays crisp in both themes without an icon font. The active step is
// marked with aria-current for assistive tech.
function ImportSteps({ steps, current }) {
  return (
    <div className="stepper">
      {steps.map((label, index) => (
        <Fragment key={label}>
          {index > 0 && <span className="step-sep" aria-hidden="true" />}
          <span
            className={
              index < current
                ? 'step done'
                : index === current
                  ? 'step active'
                  : 'step'
            }
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="step-num">{index + 1}</span>
            {label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export default ImportSteps;
