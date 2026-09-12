import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api.js';
import { chartFields, filterAndSortRows } from '../src/lib/reportData.js';
import { chartLayout } from '../src/lib/chartLayout.js';
import { readFileSync } from 'node:fs';
import { universityColors, universityChartColors } from '../src/lib/universityTheme.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('registry design tokens', () => {
  const theme = readFileSync(new URL('../src/styles/university-theme.css', import.meta.url), 'utf8');
  const luminance = (hex) => hex.slice(1).match(/../g).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

  it('keeps shell and chart colours consistent', () => {
    for (const [token, color] of [['university-navy', universityColors.navy], ['university-gold', universityColors.gold], ['university-bright-gold', universityColors.brightGold], ['blue', universityColors.blue], ['ink', universityColors.ink], ['ink-soft', universityColors.muted], ['line', universityColors.line]]) {
      expect(theme.toLowerCase()).toContain(`--${token}: ${color.toLowerCase()};`);
    }
    expect(new Set(universityChartColors).size).toBe(universityChartColors.length);
    for (const [token, radius] of [['control', 10], ['card', 18], ['dialog', 24]]) {
      expect(theme).toContain(`--radius-${token}: ${radius}px;`);
    }
    for (const declaration of [
      '.deadline-chip { min-width: 0; color: var(--university-navy); background: #fff; border: 1px solid var(--line);',
      '.report-list button.active { color: var(--university-navy); background: #edf4fa; border-color: #b9cde0;',
      '.table-index button.active { color: var(--university-navy); background: #edf4fa; border-color: #b9cde0;',
      '.case-topbar, .wizard-header { border-top: 0;',
      '.mobile-nav-active { border: 1px solid #bfd0e2;',
      '.case-tabs { gap: 4px; padding: 6px 22px; background: #edf2f7; border-bottom: 1px solid var(--line); border-radius: 0; }',
      '.case-tabs button { min-height: 40px; border: 1px solid transparent; border-radius: var(--radius-control); }',
      '.score-input:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px rgb(43 98 151 / 12%); }',
      '.score-input input::-webkit-inner-spin-button,',
    ]) expect(theme).toContain(declaration);
    expect(theme).not.toContain('box-shadow: inset 3px 0 var(--university-navy)');
    expect(theme).not.toContain('border-left-color: var(--university-gold)');
    expect(theme).not.toContain('border-top: 3px solid var(--university-navy)');
    expect(theme).not.toContain('.operations-tabs button, .case-tabs button { border-radius:');
    expect(theme).toContain('.compact-registry-mark');
  });

  it('preserves the official HKUST logo as a self-contained vector asset', () => {
    const webMark = readFileSync(new URL('../public/hkust-logo-color.svg', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('HKUST Student Admission System');
    expect(webMark).toContain('viewBox=');
    expect(webMark).not.toMatch(/<(?:script|foreignObject|image)\b|\bon\w+=|(?:href|xlink:href)\s*=/i);
  });

  it('maintains readable key text pairs and visible chart marks', () => {
    for (const [text, surface] of [['#FFFFFF', universityColors.navy], [universityColors.gold, '#F5F7FA'], [universityColors.muted, '#F5F7FA'], ['#D6E3F0', universityColors.navy], ['#E8C15B', universityColors.navy]]) {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const color of universityChartColors) expect(contrast(color, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
});

describe('chart geometry', () => {
  it('keeps axes and circle radii inside narrow and wide panels', () => {
    for (const width of [180, 220, 280, 320, 390, 560, 768, 1024, 1440]) {
      for (const visual of ['bar', 'line', 'donut']) {
        const layout = chartLayout(width, visual, 12);
        expect(layout.canRender).toBe(true);
        expect(layout.axisWidth + 18).toBeLessThan(width);
        expect(layout.outerRadius * 2).toBeLessThanOrEqual(Math.min(width, layout.height));
      }
    }
  });
  it('does not render at zero, invalid or unusably narrow widths', () => {
    for (const width of [0, -100, NaN, Infinity, 120, 179]) {
      const layout = chartLayout(width, 'donut', 5);
      expect(layout.canRender).toBe(false);
      expect(Number.isFinite(layout.width)).toBe(true);
      expect(layout.width).toBeGreaterThanOrEqual(0);
    }
  });
  it('allocates row height rather than overlapping category labels', () => {
    expect(chartLayout(280, 'bar', 30).height).toBe(1076);
    expect(chartLayout(280, 'bar', NaN).height).toBe(260);
  });
});

describe('client request resilience', () => {
  it('preserves JSON headers when callers supply custom headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    expect(await api('/health', { headers: { 'X-Request': 'test' } })).toEqual({ ok: true });
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Request': 'test' });
  });
  it('preserves field-level server validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid', fields: { email: 'Already exists' } }), { status: 409 })));
    await expect(api('/applicants')).rejects.toMatchObject({ status: 409, fields: { email: 'Already exists' } });
  });
  it('rejects malformed successful responses instead of rendering empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>offline</html>')));
    await expect(api('/dashboard')).rejects.toThrow('unreadable response');
  });
  it('describes network errors without leaking native fetch details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/dashboard')).rejects.toThrow('Unable to reach the server');
  });
  it('does not automatically retry writes after timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_path, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetch);
    const assertion = expect(api('/applicants', { method: 'POST', timeoutMs: 50 })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('propagates caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn((_path, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const controller = new AbortController();
    const pending = api('/reports', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('supports successful no-content responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await api('/example')).toBeNull();
  });
});

describe('analytical data handling', () => {
  const rows = [{ programme: 'B', count: 20 }, { programme: 'A', count: 3 }, { programme: 'C', count: null }];
  it('sorts numbers numerically and leaves missing values last', () => {
    expect(filterAndSortRows(rows, '', { key: 'count', direction: 'asc' }).map((row) => row.count)).toEqual([3, 20, null]);
    expect(filterAndSortRows(rows, '', { key: 'count', direction: 'desc' }).map((row) => row.count)).toEqual([20, 3, null]);
    expect(rows[0].count).toBe(20);
  });
  it('filters without changing source rows', () => {
    expect(filterAndSortRows(rows, ' b ', null)).toEqual([rows[0]]);
    expect(rows).toHaveLength(3);
  });
  it('discovers numeric measures even when the first row is null', () => {
    expect(chartFields([{ name: 'A', score: null }, { name: 'B', score: 82 }])).toEqual({ labelKey: 'name', numericKeys: ['score'] });
  });
  it('handles empty report output', () => {
    expect(chartFields([])).toEqual({ labelKey: undefined, numericKeys: [] });
    expect(filterAndSortRows([], 'x', null)).toEqual([]);
  });
});
