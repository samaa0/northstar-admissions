export function chartFields(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    labelKey: keys.find((key) => rows.some((row) => typeof row[key] === 'string')) || keys[0],
    numericKeys: keys.filter((key) => rows.some((row) => typeof row[key] === 'number' && Number.isFinite(row[key]))),
  };
}

export function filterAndSortRows(rows, query, sort) {
  const term = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLocaleLowerCase().includes(term)));
  if (!sort?.key) return filtered;
  return [...filtered].sort((left, right) => {
    const first = left[sort.key];
    const second = right[sort.key];
    if (first == null) return second == null ? 0 : 1;
    if (second == null) return -1;
    const comparison = typeof first === 'number' && typeof second === 'number'
      ? first - second
      : String(first).localeCompare(String(second), 'en', { numeric: true });
    return sort.direction === 'desc' ? -comparison : comparison;
  });
}
