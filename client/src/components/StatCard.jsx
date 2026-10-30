// A KPI tile on the existing stat-card styles (the markup HeadlineCards used).
// `tone` swaps the leading rule and value onto ok/danger — profit tiles go
// danger when negative, debt tiles whenever a debt exists.
function StatCard({ label, value, tone }) {
  return (
    <div className={tone ? `stat-card ${tone}` : 'stat-card'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default StatCard;
