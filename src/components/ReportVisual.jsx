import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import { chartFields } from '../lib/reportData.js';
import { titleCase } from '../lib/format.js';
import { useElementWidth } from '../lib/useElementWidth.js';
import { chartLayout } from '../lib/chartLayout.js';
import { universityChartColors as colors, universityColors } from '../lib/universityTheme.js';

const formatNumber = (value) => Number(value).toLocaleString('en-HK', { maximumFractionDigits: 2 });

export default function ReportVisual({ report }) {
  const { labelKey, numericKeys } = chartFields(report.rows);
  const [selectedMetric, setSelectedMetric] = useState(numericKeys[0]);
  const [hidden, setHidden] = useState([]);
  const reducedMotion = useReducedMotion();
  const [frameRef, width] = useElementWidth(Boolean(numericKeys.length));
  const layout = chartLayout(width, report.visual, report.rows.length);
  const metric = numericKeys.includes(selectedMetric) ? selectedMetric : numericKeys[0];
  if (!metric) return null;
  const isDonut = report.visual === 'donut';
  const visibleRows = isDonut ? report.rows.filter((row) => !hidden.includes(row[labelKey])) : report.rows;
  const total = visibleRows.reduce((sum, row) => sum + Number(row[metric] || 0), 0);
  const positiveData = visibleRows.some((row) => Number(row[metric]) > 0);
  const axisProps = { tickLine: false, axisLine: false, tick: { fill: universityColors.muted, fontSize: 11 } };
  const seriesProps = { dataKey: metric, name: titleCase(metric), isAnimationActive: !reducedMotion, animationDuration: 350 };
  const tooltipProps = { content: <ChartTooltip />, allowEscapeViewBox: { x: false, y: false }, wrapperStyle: { maxWidth: '100%', pointerEvents: 'none', zIndex: 2 } };
  const numberTick = (value) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

  function toggleCategory(label) {
    setHidden((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  }

  return (
    <section className="report-visual analytical-chart" aria-label={`${report.title} chart`}>
      <div className="chart-toolbar">
        <div><span className="eyebrow">Visual analysis</span><h3>{titleCase(metric)}</h3></div>
        {numericKeys.length > 1 && !isDonut ? <label className="chart-metric-picker">Measure<select value={metric} onChange={(event) => setSelectedMetric(event.target.value)}>{numericKeys.map((key) => <option key={key} value={key}>{titleCase(key)}</option>)}</select></label> : null}
        {isDonut && hidden.length ? <button type="button" className="text-button" onClick={() => setHidden([])}>Show all categories</button> : null}
      </div>
      <div className={isDonut ? 'donut-layout' : 'cartesian-layout'}>
        <div className="analysis-chart-scroll" role="region" aria-label="Chart plot" tabIndex={layout.height > 380 ? 0 : undefined}>
        <div ref={frameRef} className="analysis-chart-frame" style={{ height: layout.height }} role="group" aria-label={`${titleCase(metric)}; exact values in result set below`}>
          {!layout.canRender ? <div className="chart-zero">{width > 0 ? 'Widen this panel to view the chart. Exact results are below.' : 'Preparing chart…'}</div> : isDonut && !positiveData ? <div className="chart-zero">No positive values to plot</div> : <>
            {isDonut ? (
              <PieChart width={layout.width} height={layout.height} accessibilityLayer><Pie {...seriesProps} data={visibleRows} nameKey={labelKey} innerRadius={Math.round(layout.outerRadius * 0.7)} outerRadius={layout.outerRadius} paddingAngle={2} stroke="none">{visibleRows.map((row) => <Cell key={row[labelKey]} fill={colors[report.rows.indexOf(row) % colors.length]} />)}</Pie><Tooltip {...tooltipProps} /></PieChart>
            ) : report.visual === 'line' ? (
              <LineChart width={layout.width} height={layout.height} accessibilityLayer data={visibleRows} margin={{ top: 18, right: 18, left: 0, bottom: 12 }}><CartesianGrid vertical={false} stroke={universityColors.line} strokeDasharray="3 4" /><XAxis {...axisProps} dataKey={labelKey} minTickGap={24} tickFormatter={(label) => String(label).slice(0, layout.labelLength)} /><YAxis {...axisProps} width={42} tickCount={layout.tickCount} tickFormatter={numberTick} /><Tooltip {...tooltipProps} /><Line {...seriesProps} type="monotone" stroke={colors[0]} strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} /></LineChart>
            ) : (
              <BarChart width={layout.width} height={layout.height} accessibilityLayer data={visibleRows} layout="vertical" margin={{ top: 8, right: 18, left: 0, bottom: 8 }}><CartesianGrid horizontal={false} stroke={universityColors.line} strokeDasharray="3 4" /><XAxis {...axisProps} type="number" tickCount={layout.tickCount} tickFormatter={numberTick} /><YAxis {...axisProps} type="category" dataKey={labelKey} interval={0} width={layout.axisWidth} tickFormatter={(label) => String(label).length > layout.labelLength ? `${String(label).slice(0, layout.labelLength - 1)}…` : label} /><Tooltip {...tooltipProps} cursor={{ fill: universityColors.hover }} /><Bar {...seriesProps} fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={24} /></BarChart>
            )}
          </>}
          {isDonut && positiveData && layout.canRender ? <div className="donut-center" style={{ maxWidth: layout.outerRadius * 1.1 }}><strong>{formatNumber(total)}</strong><span>{hidden.length ? 'selected' : titleCase(metric)}</span></div> : null}
        </div>
        </div>
        {isDonut ? <div className="interactive-legend" aria-label="Chart categories">{report.rows.map((row, index) => <button type="button" key={row[labelKey]} aria-label={`${row[labelKey]}: ${formatNumber(row[metric])} ${titleCase(metric)}`} aria-pressed={!hidden.includes(row[labelKey])} onClick={() => toggleCategory(row[labelKey])}><i style={{ backgroundColor: colors[index % colors.length] }} /><span>{row[labelKey]}</span><strong>{formatNumber(row[metric])}</strong></button>)}</div> : null}
      </div>
      <p className="chart-guidance">{isDonut ? 'Select a category to hide or show it. All categories are included.' : 'Hover or focus the chart and use arrow keys to explore values.'} Exact values are available in the result set.</p>
    </section>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label ?? payload[0].name}</strong>{payload.map((item) => <span key={item.dataKey}><i style={{ backgroundColor: item.color || universityColors.navy }} />{titleCase(item.dataKey)} <b>{formatNumber(item.value)}</b></span>)}</div>;
}
