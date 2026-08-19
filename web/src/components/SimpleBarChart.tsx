interface BarChartItem {
  label: string;
  income: number;
  expense: number;
}

interface SimpleBarChartProps {
  items: BarChartItem[];
}

export function SimpleBarChart({ items }: SimpleBarChartProps) {
  if (items.length === 0) {
    return <p className="muted empty-inline">Нет данных для графика</p>;
  }

  const maxValue = Math.max(...items.flatMap((item) => [item.income, item.expense]), 1);

  return (
    <div className="bar-chart" role="img" aria-label="Доходы и расходы по месяцам">
      {items.map((item) => (
        <div key={item.label} className="bar-chart-group">
          <div className="bar-chart-bars">
            <div
              className="bar-chart-bar income"
              style={{ height: `${(item.income / maxValue) * 100}%` }}
              title={`Доход: ${item.income}`}
            />
            <div
              className="bar-chart-bar expense"
              style={{ height: `${(item.expense / maxValue) * 100}%` }}
              title={`Расход: ${item.expense}`}
            />
          </div>
          <span className="bar-chart-label">{item.label}</span>
        </div>
      ))}
      <div className="bar-chart-legend">
        <span className="legend-item income">Доход</span>
        <span className="legend-item expense">Расход</span>
      </div>
    </div>
  );
}
