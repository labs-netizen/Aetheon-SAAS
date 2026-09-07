'use client';

import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

export interface Block96Point {
  block_index: number;
  start_time: string;
  demand_kw?: number;
  price_mwh?: number;
  actual_kw?: number;
  solar_kw?: number;
  bess_power_kw?: number;
  is_high_cost?: boolean;
}

export interface Block96ChartProps {
  data: Block96Point[];
  showPrice?: boolean;
  showSolar?: boolean;
  height?: number;
}

export function Block96Chart({
  data,
  showPrice = true,
  showSolar = false,
  height = 360,
}: Block96ChartProps) {
  return (
    <div className="w-full bg-slate-950/60 p-4 rounded-lg border border-slate-800">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">Day-Ahead 96-Block Profile (15-Minute Resolution)</span>
        <span>Blocks 1 (00:00) to 96 (24:00) IST</span>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="block_index"
              stroke="#64748b"
              fontSize={11}
              tickFormatter={(b) => (b % 12 === 1 ? `B${b}` : '')}
            />
            {/* Left Y Axis for Power (kW) */}
            <YAxis
              yAxisId="left"
              stroke="#38bdf8"
              fontSize={11}
              tickFormatter={(v) => `${v} kW`}
            />
            {/* Right Y Axis for Clearing Price (₹/MWh) */}
            {showPrice && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#f59e0b"
                fontSize={11}
                tickFormatter={(v) => `₹${v}`}
              />
            )}
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0]?.payload as Block96Point;
                return (
                  <div className="p-3 bg-slate-900 border border-slate-700 rounded-md shadow-xl text-xs space-y-1.5">
                    <p className="font-semibold text-slate-200 border-b border-slate-800 pb-1">
                      Block {label} ({pt.start_time})
                    </p>
                    {pt.demand_kw !== undefined && (
                      <p className="text-sky-400">
                        Forecast Demand: <strong>{pt.demand_kw.toFixed(1)} kW</strong>
                      </p>
                    )}
                    {pt.actual_kw !== undefined && (
                      <p className="text-emerald-400">
                        Actual Drawal: <strong>{pt.actual_kw.toFixed(1)} kW</strong>
                      </p>
                    )}
                    {pt.price_mwh !== undefined && (
                      <p className="text-amber-400">
                        Clearing Price: <strong>₹{pt.price_mwh.toFixed(0)}/MWh</strong>
                        {pt.is_high_cost && <span className="ml-1 text-red-400 font-bold">(High Cost)</span>}
                      </p>
                    )}
                    {pt.solar_kw !== undefined && pt.solar_kw > 0 && (
                      <p className="text-yellow-400">
                        Solar Generation: <strong>{pt.solar_kw.toFixed(1)} kW</strong>
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="demand_kw"
              name="Forecast Demand (kW)"
              fill="#0284c7"
              fillOpacity={0.15}
              stroke="#0284c7"
              strokeWidth={2}
            />
            {showSolar && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="solar_kw"
                name="Solar PV (kW)"
                fill="#eab308"
                fillOpacity={0.2}
                stroke="#eab308"
                strokeWidth={1.5}
              />
            )}
            {showPrice && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="price_mwh"
                name="Clearing Price (₹/MWh)"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
