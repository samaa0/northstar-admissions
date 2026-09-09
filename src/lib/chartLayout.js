export function chartLayout(width, visual, rowCount) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const safeRows = Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
  const height = visual === 'bar'
    ? Math.max(260, safeRows * 34 + 56)
    : Math.max(220, Math.min(340, Math.round(safeWidth * 0.72)));
  return {
    width: safeWidth,
    height,
    canRender: safeWidth >= 180,
    axisWidth: Math.min(128, Math.max(64, Math.round(safeWidth * 0.28))),
    labelLength: safeWidth < 320 ? 10 : safeWidth < 480 ? 14 : 20,
    tickCount: safeWidth < 360 ? 3 : 5,
    outerRadius: Math.floor(Math.min(safeWidth, height) * 0.4),
  };
}
