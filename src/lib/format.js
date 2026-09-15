export function formatDate(value, options = {}) {
  if (!value) return 'Not recorded';
  const { year = true, ...dateOptions } = options;
  return new Intl.DateTimeFormat('en-HK', {
    day: 'numeric',
    month: 'short',
    year: year === false ? undefined : 'numeric',
    ...dateOptions,
  }).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-HK', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const dateTimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function toDateTimeLocalValue(value) {
  if (!value) return '';
  const text = String(value);
  if (dateTimeLocalPattern.test(text) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(text.slice(16))) {
    return text.slice(0, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIsoDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function readDateTimeLocalValue(event, currentValue = '') {
  const value = event.target.value;
  if (!value && event.target.validity?.badInput) return currentValue;
  if (value && !dateTimeLocalPattern.test(value)) return currentValue;
  return value;
}

export function titleCase(value = '') {
  const acronymWords = new Set(['API', 'CSV', 'CV', 'FK', 'ID', 'PK', 'SQL']);
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .split(' ')
    .map((word) => acronymWords.has(word.toUpperCase()) ? word.toUpperCase() : word)
    .join(' ');
}

export function initials(name = '') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function exportCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
