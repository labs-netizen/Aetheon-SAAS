'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from 'recharts';

export type CurvePoint = { block_index?: number; time?: string; operating_date?: string; load_kw?: number | null;
  average_kw?: number | null; peak_kw?: number | null; forecast_kw?: number | null; actual_kw?: number | null;
  mcp_rs_per_mwh?: number | null; weekday_kw?: number | null; weekend_kw?: number | null;
  price_window?: 'LOW' | 'HIGH' | null };

export function EvidenceCurve({ data, title, unit, series, height = 280, testId }: {
  data: CurvePoint[]; title: string; unit: string; series: Array<{ key: keyof CurvePoint; label: string; color: string }>;
  height?: number; testId?: string;
}) {
  return <section className="min-w-0 rounded border border-slate-700 bg-slate-950/60 p-3" data-testid={testId}>
    <h3 className="mb-2 text-sm font-semibold text-slate-100">{title} <span className="text-xs font-normal text-slate-400">({unit})</span></h3>
    {data.length === 0 ? <p className="py-8 text-xs text-slate-400">No verified values available for this curve.</p> :
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey={data[0].operating_date ? 'operating_date' : 'block_index'} stroke="#94a3b8" fontSize={11}
              tickFormatter={(value) => typeof value === 'number' ? (value % 12 === 1 ? String(value) : '') : String(value).slice(5)}
              minTickGap={24} />
            <YAxis stroke="#94a3b8" fontSize={11} width={65} tickFormatter={(value) => Number(value).toLocaleString('en-IN')} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as CurvePoint;
              return <div className="rounded border border-slate-600 bg-slate-900 p-2 text-xs text-slate-100">
                <div>{point.operating_date || `Block ${point.block_index} · ${point.time || ''} IST`}</div>
                {series.map((item) => point[item.key] !== null && point[item.key] !== undefined &&
                  <div key={item.key} style={{ color: item.color }}>{item.label}: {Number(point[item.key]).toLocaleString('en-IN', { maximumFractionDigits: 2 })} {unit}</div>)}
                {point.price_window && <div className="text-amber-200">Historical {point.price_window === 'LOW' ? 'lower' : 'higher'} MCP window</div>}
              </div>;
            }} />
            {series.map((item) => <Line key={item.key} type="linear" dataKey={item.key} name={item.label} stroke={item.color}
              strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
            {data.filter((point) => point.price_window && point.block_index && point.mcp_rs_per_mwh !== null && point.mcp_rs_per_mwh !== undefined)
              .map((point) => <ReferenceDot key={`window-${point.block_index}`} x={point.block_index} y={point.mcp_rs_per_mwh!}
                r={4} fill={point.price_window === 'LOW' ? '#2dd4bf' : '#fb7185'} stroke="#0f172a" isFront />)}
          </LineChart>
        </ResponsiveContainer>
      </div>}
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
      {series.map((item) => <span key={item.key}><span style={{ color: item.color }}>●</span> {item.label}</span>)}
      {data.some((point) => point.price_window) && <span>● Teal: historical lower MCP · Rose: historical higher MCP</span>}
    </div>
  </section>;
}
