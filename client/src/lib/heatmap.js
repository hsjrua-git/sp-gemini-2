// Grid model for the heatmap chart. The heatmap is a student × axis matrix of
// scores, each cell shaded by where its value sits in the parameter's range
// (0–100%, via `percentOfRange`). Two orientations:
//   axis 'period'    — columns are periods, for one fixed parameter.
//   axis 'parameter' — columns are parameters, for one fixed period.
// This is pure so the SVG renderer (`HeatmapMatrix`) and tests share it; the
// component turns `percent` into a colour with CSS `color-mix`.
import { percentOfRange } from './views.js';

function parameterById(cube, id) {
  return cube.parameters.find((parameter) => parameter.id === id) ?? null;
}

export function buildHeatmap(cube, { axis = 'period', parameterId = null, periodKey = null } = {}) {
  const rows = cube.students.map((student) => ({
    id: student.id,
    label: student.fullName,
    studentCode: student.studentCode,
  }));

  if (axis === 'parameter') {
    // One period down the side is fixed; each column is a parameter with its
    // own min/max, so the shading is comparable within a column, not across.
    const period =
      cube.periods.find((item) => item.key === periodKey) ??
      cube.periods[cube.periods.length - 1] ??
      null;
    const columns = cube.parameters.map((parameter) => ({
      key: parameter.id,
      label: parameter.name,
      parameter,
    }));
    const cells = rows.map((row) =>
      columns.map((column) => {
        const value = period
          ? cube.valueAt(row.id, column.parameter.id, period.key)
          : null;
        return {
          value,
          percent: percentOfRange(
            value,
            column.parameter.minValue,
            column.parameter.maxValue
          ),
        };
      })
    );
    return { axis, periodKey: period?.key ?? null, rows, columns, cells };
  }

  // axis === 'period': one parameter is fixed; columns are the periods.
  const parameter = parameterById(cube, parameterId) ?? cube.parameters[0] ?? null;
  const columns = cube.periods.map((period) => ({
    key: period.key,
    label: `P${period.key}`,
    period,
  }));
  const cells = rows.map((row) =>
    columns.map((column) => {
      const value = parameter
        ? cube.valueAt(row.id, parameter.id, column.period.key)
        : null;
      return {
        value,
        percent: parameter
          ? percentOfRange(value, parameter.minValue, parameter.maxValue)
          : null,
      };
    })
  );
  return {
    axis,
    parameterId: parameter?.id ?? null,
    parameterName: parameter?.name ?? null,
    rows,
    columns,
    cells,
  };
}
