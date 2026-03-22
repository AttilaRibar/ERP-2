"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import {
  Users,
  FolderKanban,
  FileText,
  Calculator,
  TrendingUp,
  RefreshCw,
  BarChart2,
} from "lucide-react";
import {
  getSummaryKpis,
  getProjectStatusStats,
  getQuoteStatusStats,
  getPartnerTypeStats,
  getMonthlyQuoteVolume,
  getTopPartnersByProjects,
  getTopPartnersByQuoteValue,
  getBudgetCostBreakdown,
} from "@/server/actions/reports";

// ─── Types ─────────────────────────────────────────────────────────────────
type Kpis = Awaited<ReturnType<typeof getSummaryKpis>>;
type PieDatum = { name: string; value: number; color: string };
type QuoteStatusDatum = { name: string; value: number; totalValue: number; color: string };
type MonthlyDatum = { month: string; count: number; total: number };
type BarDatum = { name: string; value: number };
type CostDatum = { name: string; material: number; fee: number };

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmtHUF(n: number) {
  return new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtShortHUF(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M Ft`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} e Ft`;
  return `${n} Ft`;
}

// ─── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-[var(--slate-200)] p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}18` }}
      >
        <Icon size={22} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--slate-500)] font-medium uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-2xl font-bold text-[var(--slate-900)] leading-tight">{value}</p>
        {subtitle && (
          <p className="text-xs text-[var(--slate-400)] mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────
function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-[var(--slate-200)] p-5 shadow-sm ${className}`}
    >
      <h3 className="text-sm font-semibold text-[var(--slate-700)] mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Custom tooltip ────────────────────────────────────────────────────────
function HufTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      {label && <p className="font-semibold mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>
          {p.name}: {fmtShortHUF(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export function ReportsDashboard() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [projectStatus, setProjectStatus] = useState<PieDatum[]>([]);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatusDatum[]>([]);
  const [partnerTypes, setPartnerTypes] = useState<PieDatum[]>([]);
  const [monthlyVolume, setMonthlyVolume] = useState<MonthlyDatum[]>([]);
  const [topPartners, setTopPartners] = useState<BarDatum[]>([]);
  const [topQuotePartners, setTopQuotePartners] = useState<BarDatum[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostDatum[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = async () => {
    setLoading(true);
    const [k, ps, qs, pt, mv, tp, tqp, cb] = await Promise.all([
      getSummaryKpis(),
      getProjectStatusStats(),
      getQuoteStatusStats(),
      getPartnerTypeStats(),
      getMonthlyQuoteVolume(),
      getTopPartnersByProjects(),
      getTopPartnersByQuoteValue(),
      getBudgetCostBreakdown(),
    ]);
    setKpis(k);
    setProjectStatus(ps);
    setQuoteStatus(qs);
    setPartnerTypes(pt);
    setMonthlyVolume(mv);
    setTopPartners(tp);
    setTopQuotePartners(tqp);
    setCostBreakdown(cb);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--slate-50)]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={28} className="text-[var(--indigo-500)] animate-spin" />
          <p className="text-sm text-[var(--slate-500)]">Adatok betöltése…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--slate-50)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--indigo-50)] flex items-center justify-center">
            <BarChart2 size={18} className="text-[var(--indigo-500)]" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--slate-900)]">Kimutatások</h2>
            <p className="text-xs text-[var(--slate-400)]">
              Frissítve: {lastRefresh.toLocaleTimeString("hu-HU")}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-[var(--slate-500)] hover:text-[var(--indigo-500)] transition-colors px-3 py-1.5 rounded-lg hover:bg-[var(--indigo-50)] border border-[var(--slate-200)]"
        >
          <RefreshCw size={13} />
          Frissítés
        </button>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          <KpiCard
            label="Partnerek"
            value={kpis.totalPartners.toString()}
            icon={Users}
            color="#8b5cf6"
          />
          <KpiCard
            label="Projektek"
            value={kpis.totalProjects.toString()}
            subtitle={`${kpis.activeProjects} aktív`}
            icon={FolderKanban}
            color="#06b6d4"
          />
          <KpiCard
            label="Ajánlatok"
            value={kpis.totalQuotes.toString()}
            icon={FileText}
            color="#22c55e"
          />
          <KpiCard
            label="Költségvetések"
            value={kpis.totalBudgets.toString()}
            icon={Calculator}
            color="#f59e0b"
          />
          <KpiCard
            label="Elf. ajánlat érték"
            value={fmtShortHUF(kpis.acceptedQuoteValue)}
            icon={TrendingUp}
            color="#6366f1"
          />
          <KpiCard
            label="Aktív projektek"
            value={kpis.activeProjects.toString()}
            subtitle={`${kpis.totalProjects > 0 ? Math.round((kpis.activeProjects / kpis.totalProjects) * 100) : 0}% az összes`}
            icon={FolderKanban}
            color="#10b981"
          />
        </div>
      )}

      {/* Row 1: Three pie charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <ChartCard title="Projektek státusz szerint">
          {projectStatus.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={projectStatus}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {projectStatus.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as PieDatum;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{d.name}</p>
                        <p>{d.value} projekt</p>
                      </div>
                    );
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span className="text-xs text-[var(--slate-600)]">{v}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Ajánlatok státusz szerint">
          {quoteStatus.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={quoteStatus}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {quoteStatus.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as QuoteStatusDatum;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{d.name}</p>
                        <p>{d.value} db</p>
                        <p>{fmtShortHUF(d.totalValue)}</p>
                      </div>
                    );
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span className="text-xs text-[var(--slate-600)]">{v}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Partnerek típus szerint">
          {partnerTypes.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={partnerTypes}
                  cx="50%"
                  cy="45%"
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  label={(props) =>
                    `${props.name ?? ""} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {partnerTypes.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as PieDatum;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{d.name}</p>
                        <p>{d.value} partner</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Monthly area chart spanning full width */}
      <div className="grid grid-cols-1 gap-4 mb-4">
        <ChartCard title="Havi ajánlati volumen (elmúlt 12 hónap)">
          {monthlyVolume.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={monthlyVolume} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="value"
                  orientation="left"
                  tickFormatter={fmtShortHUF}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<HufTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span className="text-xs text-[var(--slate-600)]">{v}</span>
                  )}
                />
                <Area
                  yAxisId="value"
                  type="monotone"
                  dataKey="total"
                  name="Értékösszeg (Ft)"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#gradTotal)"
                  dot={{ r: 3, fill: "#6366f1" }}
                />
                <Area
                  yAxisId="count"
                  type="monotone"
                  dataKey="count"
                  name="Darabszám"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#gradCount)"
                  dot={{ r: 3, fill: "#22c55e" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3: Top partners side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title="Top 10 partner – projektek száma">
          {topPartners.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={topPartners}
                layout="vertical"
                margin={{ top: 0, right: 20, bottom: 0, left: 90 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  width={88}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{payload[0].payload.name}</p>
                        <p>{payload[0].value} projekt</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" name="Projektek" radius={[0, 4, 4, 0]}>
                  {topPartners.map((_, i) => (
                    <Cell
                      key={i}
                      fill={`hsl(${240 - i * 18}, 70%, ${55 + i * 2}%)`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top partner – elfogadott ajánlat értéke">
          {topQuotePartners.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={topQuotePartners}
                layout="vertical"
                margin={{ top: 0, right: 20, bottom: 0, left: 90 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={fmtShortHUF}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  width={88}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{payload[0].payload.name}</p>
                        <p>{fmtHUF(Number(payload[0].value))}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" name="Elfogadott érték" radius={[0, 4, 4, 0]}>
                  {topQuotePartners.map((_, i) => (
                    <Cell
                      key={i}
                      fill={`hsl(${150 - i * 12}, 65%, ${50 + i * 2}%)`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 4: Cost breakdown stacked bar */}
      <div className="grid grid-cols-1 gap-4 mb-4">
        <ChartCard title="Projektek anyag- és díjköltség bontása (top 8)">
          {costBreakdown.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={costBreakdown}
                margin={{ top: 5, right: 20, bottom: 60, left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b", angle: -30, textAnchor: "end" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={fmtShortHUF}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<HufTooltip />} />
                <Legend
                  iconType="square"
                  iconSize={10}
                  formatter={(v) => (
                    <span className="text-xs text-[var(--slate-600)]">{v}</span>
                  )}
                />
                <Bar dataKey="material" name="Anyagköltség" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="fee" name="Díjköltség" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 5: Radar – quote status by count vs value */}
      {quoteStatus.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <ChartCard title="Ajánlatok – darabszám vs értékarány (radar)">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={quoteStatus} cx="50%" cy="50%" outerRadius={100}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <PolarRadiusAxis
                  angle={30}
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                />
                <Radar
                  name="Darabszám"
                  dataKey="value"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.3}
                />
                <Radar
                  name="Érték (M Ft)"
                  dataKey="totalValue"
                  stroke="#22c55e"
                  fill="#22c55e"
                  fillOpacity={0.2}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span className="text-xs text-[var(--slate-600)]">{v}</span>
                  )}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as QuoteStatusDatum;
                    return (
                      <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                        <p className="font-semibold">{d.name}</p>
                        <p>Darabszám: {d.value}</p>
                        <p>Érték: {fmtShortHUF(d.totalValue)}</p>
                      </div>
                    );
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Havi ajánlatok darabszáma (vonal)">
            {monthlyVolume.length === 0 ? (
              <EmptyState />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={monthlyVolume}
                  margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-[var(--slate-900)] text-white text-xs rounded-lg px-3 py-2 shadow-xl">
                          <p className="font-semibold">{label}</p>
                          <p>Ajánlatok: {payload[0].value} db</p>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    name="Ajánlatok"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "#f59e0b", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#f59e0b" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-40 text-[var(--slate-400)] text-sm">
      Nincs megjeleníthető adat
    </div>
  );
}
