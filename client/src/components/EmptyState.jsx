// A calm, centered panel for "nothing here yet" (and "something went wrong")
// pages. Keeps sparse views from reading as a blank void — which, in dark mode,
// looks like a broken dark rectangle. Pass a title, an optional description or
// children (e.g. a link/button), and an optional `tone` ('danger' | 'warn')
// that tints the mark and, when no explicit `icon` is given, swaps the glyph for
// a warning triangle. A neutral document glyph is the default.
function EmptyState({ title, description, icon, tone, children }) {
  return (
    <div className="empty-state">
      <span
        className={tone ? `empty-state-mark ${tone}` : 'empty-state-mark'}
        aria-hidden="true"
      >
        {icon ?? (tone ? <WarnIcon /> : <DefaultIcon />)}
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 3h8l4 4v14H6z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 4 3 20h18L12 4Z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default EmptyState;
