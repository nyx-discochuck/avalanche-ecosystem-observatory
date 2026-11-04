import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpDown,
  BarChart3,
  Blocks,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CircleAlert,
  CircleDollarSign,
  Download,
  ExternalLink,
  Fuel,
  Gauge,
  Info,
  Landmark,
  Menu,
  MoreHorizontal,
  Network,
  Radio,
  Search,
  ShieldCheck,
  GraduationCap,
  Microscope,
  Unlock,
  Vote,
  SlidersHorizontal,
  TrendingUp,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import { rankDexLiquiditySourceKeys } from './dex-breakdown.mjs';
import { finite, formatValue } from './formatters.mjs';

const BASE = import.meta.env.BASE_URL;
const COLORS = ['#ef3b42', '#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316', '#60a5fa', '#c4b5fd'];
const PAGES = [
  { id: 'overview', label: 'Overview', icon: Network },
  { id: 'beginners', label: 'Beginners', icon: GraduationCap },
  { id: 'experts', label: 'Advanced', icon: Microscope },
  { id: 'governance', label: 'Governance', icon: Vote },
  { id: 'unlocks', label: 'Unlocks', icon: Unlock },
  { id: 'staking', label: 'Staking', icon: ShieldCheck },
  { id: 'blockspace', label: 'Blockspace', icon: Blocks },
  { id: 'economics', label: 'Economics', icon: CircleDollarSign },
  { id: 'spot-trading', label: 'Spot Trading', icon: BarChart3 },
  { id: 'tokenized-assets', label: 'Tokenized Assets', icon: WalletCards },
  { id: 'lending', label: 'Lending', icon: Landmark },
  { id: 'verification', label: 'Verification', icon: ShieldCheck },
];

const GOVERNANCE_ITEMS = [
  {
    id: 'acp-285', title: 'ACP-285 · Reduce Minimum Consumption Rate', status: 'Proposed',
    window: 'Open discussion · no binding ballot window published', date: 'Discussion opened June 8, 2026',
    impact: 'Would reduce the short-duration staking reward floor from 10% to 7.5% while leaving the long-duration ceiling unchanged; realized emissions would still depend on supply and staking-duration behavior.',
    url: 'https://build.avax.network/docs/acps/285-reduce-minimum-consumption-rate',
  },
  {
    id: 'acp-273', title: 'ACP-273 · Reduce Minimum Validator Staking Period', status: 'Proposed',
    window: 'Open discussion · no binding ballot window published', date: 'Discussion opened February 17, 2026',
    impact: 'Would lower the validator commitment floor and may improve capital flexibility; it also changes how users should interpret duration-based reward estimates.',
    url: 'https://github.com/avalanche-foundation/ACPs/tree/main/ACPs/273-24-hour-minimum-staking-period',
  },
  {
    id: 'acp-236', title: 'ACP-236 · Auto-Renewed Staking', status: 'Implementable',
    window: 'Client adoption / activation coordination · no token ballot', date: 'Status reviewed August 29, 2026',
    impact: 'Introduces renewable staking cycles and optional compounding. This changes validator operations, but activation depends on compatible network clients rather than an AVAX token-holder vote.',
    url: 'https://build.avax.network/docs/acps/236-auto-renewed-staking',
  },
];

const AVAX_UNLOCKS = [
  {
    id: 'avax-foundation-2026-10-24',
    date: '2026-10-24T20:20:00Z',
    token: 'AVAX',
    project: 'Avalanche',
    amount: 1_670_000,
    maxSupplyPct: 0.23,
    floatPct: 0.39,
    recipient: 'Foundation',
    eventType: 'Cliff unlock',
    confidence: 'DefiLlama tracked',
    source: 'https://defillama.com/unlocks/avalanche',
    context: 'A scheduled Foundation allocation release. The market impact depends on whether unlocked AVAX is held, delegated, granted, or transferred; an unlock is not evidence of an immediate sale.',
  },
];

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

function dateLabel(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function dateTimeLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Awaiting official update';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function utcDateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latest(rows = []) {
  return rows.at(-1) || {};
}

function previousChange(rows, key) {
  const current = rows.at(-1)?.[key];
  const prior = rows.at(-2)?.[key];
  if (!finite(current) || !finite(prior) || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function rangeRows(rows = [], range, custom) {
  if (!rows.length) return [];
  if (range === 'ALL') return rows;
  if (range === 'CUSTOM') {
    return rows.filter((row) => row.date >= custom.start && row.date <= custom.end);
  }
  const days = Number(range.replace('D', ''));
  return rows.slice(-days);
}

function normalizePercent(rows, keys) {
  return rows.map((row) => {
    const sum = keys.reduce((total, key) => total + Math.max(0, Number(row[key]) || 0), 0);
    return {
      ...row,
      ...Object.fromEntries(keys.map((key) => [key, sum ? ((Number(row[key]) || 0) / sum) * 100 : 0])),
    };
  });
}

function downloadCsv(filename, rows, keys) {
  const columns = ['date', ...keys];
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => JSON.stringify(row[column] ?? '')).join(',')),
  ].join('\n');
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function downloadChartPng(panel, title) {
  const source = panel?.querySelector('.recharts-wrapper svg');
  if (!source) return;
  const clone = source.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bounds = source.getBoundingClientRect();
  clone.setAttribute('width', String(bounds.width));
  clone.setAttribute('height', String(bounds.height));
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
  const image = new Image();
  const objectUrl = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = objectUrl;
  });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.fillStyle = '#111419';
  context.fillRect(0, 0, bounds.width, bounds.height);
  context.drawImage(image, 0, 0, bounds.width, bounds.height);
  URL.revokeObjectURL(objectUrl);
  const output = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!output) return;
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(output);
  anchor.download = `${title.toLowerCase().replaceAll(' ', '-')}.png`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function Logo() {
  return (
    <span className="brand" aria-label="Avalanche Ecosystem Observatory">
      <span className="brand-mark" aria-hidden="true">
        <svg className="avalanche-logo" viewBox="0 0 32 32" focusable="false">
          <path d="M19.0194 25.9801H27.0466C27.7549 25.9801 28.1981 25.2197 27.8435 24.6119L23.8299 17.7207C23.4753 17.1129 22.5907 17.1129 22.2361 17.7207L18.2225 24.6119C17.8679 25.2197 18.3111 25.9801 19.0194 25.9801Z" />
          <path d="M20.0223 11.1854L16.7235 5.52006C16.3904 4.94741 15.5561 4.94741 15.223 5.52006L4.12838 24.5699C3.76351 25.1972 4.21983 25.9798 4.94958 25.9798H11.5555C12.2601 25.9798 12.9105 25.607 13.2623 25.0029L20.0223 13.3955C20.4207 12.7119 20.4207 11.8691 20.0223 11.1854Z" />
        </svg>
      </span>
      <span className="brand-name">AVAX<span>OBSERVATORY</span></span>
    </span>
  );
}

function StatusStrip({ data, live }) {
  const status = data?.status;
  const network = live?.network;
  const market = live?.market;
  const connected = Boolean(network);
  return (
    <div className="status-strip" role="status">
      <span className={`pulse ${connected ? 'live' : status?.healthy ? 'healthy' : 'degraded'}`} />
      <span className="status-primary">{connected ? 'LIVE C-CHAIN' : status?.healthy ? 'C-CHAIN SNAPSHOT' : 'SOURCE DEGRADED'}</span>
      <span>BLOCK <strong>{integer.format(network?.blockNumber || status?.blockNumber || 0)}</strong></span>
      <span>AVAX <strong>{formatValue(market?.avaxPriceUsd ?? status?.avaxPriceUsd)}</strong></span>
      <span>BASE <strong>{formatValue(network?.baseFeeGwei ?? status?.baseFeeGwei, 'Gwei')}</strong></span>
      <span>TPS <strong>{finite(network?.tps) ? decimal.format(network.tps) : '—'}</strong></span>
      <span>SCOPED CHECKS <strong>{data?.quality?.verification?.summary?.pass || 0} PASSED</strong></span>
      <span className="status-right">{connected ? 'HEAD AGE' : 'INDEXED THROUGH'} <strong>{connected ? `${decimal.format(network.blockAgeSeconds)}s` : data?.metadata?.latestCompleteDate || 'Unavailable'}</strong></span>
    </div>
  );
}

function Header({ page, setPage, data, live, onSearch }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      <StatusStrip data={data} live={live} />
      <header className="header">
        <Logo />
        <nav className="primary-nav" aria-label="Primary">
          <a href="/avalanche/">Avalanche</a>
        </nav>
        <div className="header-actions">
          <button className="search-button" onClick={onSearch} aria-label="Search observatory"><Search size={16} /> <span>Search observatory</span><kbd>/</kbd></button>
          <a className="icon-button" href="https://snowtrace.io/" target="_blank" rel="noreferrer" title="Open Snowtrace"><ExternalLink size={17} /></a>
          <button className="icon-button mobile-menu-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Toggle menu" aria-expanded={mobileOpen} aria-controls="mobile-primary-menu"><Menu size={19} /></button>
        </div>
      </header>
      {mobileOpen && (
        <nav id="mobile-primary-menu" className="mobile-menu" aria-label="Mobile primary">
          <a href="/avalanche/">Avalanche</a>
          <button onClick={() => { onSearch(); setMobileOpen(false); }}><Search size={16} /> Search</button>
        </nav>
      )}
      <nav className="section-nav" aria-label="Dashboard sections">
        {PAGES.map((item) => (
          <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}>
            <item.icon size={15} /> {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}

function LivePulse({ live, snapshot }) {
  const network = live?.network;
  const market = live?.market;
  const degradedSources = live?.sources?.filter((source) => !source.ok) || [];
  if (!network) {
    return (
      <section className="live-pulse unavailable" aria-label="Live network pulse">
        <div className="live-pulse-heading">
          <div><span className="live-label"><Radio size={13} /> LIVE PULSE WARMING</span><strong>Connecting to Avalanche C-Chain</strong></div>
          <span>Audited snapshot remains available</span>
        </div>
      </section>
    );
  }
  const metrics = [
    { label: 'Rolling throughput', value: formatValue(network.tps, 'TPS'), icon: Activity },
    { label: 'Average block time', value: finite(network.blockTimeSeconds) ? `${decimal.format(network.blockTimeSeconds)}s` : 'Unavailable', icon: Clock3 },
    { label: `Transactions · ${network.sampleBlocks} blocks`, value: integer.format(network.transactions || 0), icon: Blocks },
    { label: 'Gas utilization', value: formatValue(network.gasUtilizationPct, 'percent'), icon: Gauge },
    { label: 'Latest base fee', value: formatValue(network.baseFeeGwei, 'Gwei'), icon: Fuel },
    { label: 'AVAX spot', value: formatValue(market?.avaxPriceUsd ?? snapshot.status.avaxPriceUsd), icon: Zap },
  ];
  return (
    <section className={`live-pulse ${live.status === 'live' ? '' : 'degraded'}`} aria-label="Live network pulse">
      <div className="live-pulse-heading">
        <div>
          <span className="live-label"><span className="pulse live" /><Radio size={13} /> LIVE NETWORK PULSE</span>
          <strong>Block {integer.format(network.blockNumber)} · {decimal.format(network.blockAgeSeconds)}s behind head</strong>
        </div>
        <span>{network.sampleBlocks}-block rolling window · {live.cadenceSeconds}s source cache · auto-refreshing</span>
      </div>
      <div className="live-metric-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span><metric.icon size={13} /> {metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
      <div className="block-tape" aria-label="Recent Avalanche blocks">
        {network.blocks.slice(0, 8).map((block) => (
          <a key={block.number} href={`https://snowscan.xyz/block/${block.number}`} target="_blank" rel="noreferrer">
            <span>#{integer.format(block.number)}</span>
            <strong>{integer.format(block.txCount)} tx</strong>
            <small>{finite(block.gasUtilizationPct) ? `${decimal.format(block.gasUtilizationPct)}% gas` : 'gas n/a'}</small>
          </a>
        ))}
      </div>
      <div className="live-market-rail">
        <span>CHAIN TVL <strong>{formatValue(market?.chainTvlUsd ?? snapshot.overview.kpis.protocolTvlUsd)}</strong></span>
        <span>CURRENT UTC-DAY DEX <strong>{formatValue(market?.currentDexDayVolumeUsd)}</strong></span>
        <span>MARKET PULSE <strong>{market?.currentDexDayDate || 'Unavailable'}</strong></span>
        <span className={degradedSources.length ? 'degraded-copy' : ''}>
          {degradedSources.length ? `${degradedSources.length} live source${degradedSources.length === 1 ? '' : 's'} degraded` : 'RPC · CoinPaprika · DeFiLlama'}
        </span>
      </div>
      <p className="live-disclosure">Live pulse values are short-window operational observations. Audited daily charts and KPIs below remain complete-day snapshots with their original definitions.</p>
    </section>
  );
}

function RadarInfrastructure({ radar }) {
  if (!radar) {
    return (
      <section className="radar-infrastructure warming" aria-label="AVAX Radar infrastructure">
        <div><Radio size={15} /><span>AVAX RADAR</span><strong>Connecting to the unified data plane</strong></div>
      </section>
    );
  }
  const activity = [...(radar.alerts || [])]
    .sort((left, right) => String(right.insertedAt || '').localeCompare(String(left.insertedAt || '')))
    .slice(0, 4);
  return (
    <section className={`radar-infrastructure ${radar.fresh ? 'online' : 'degraded'}`} aria-label="AVAX Radar infrastructure">
      <div className="radar-heading">
        <div>
          <span className="radar-kicker"><span className={`pulse ${radar.fresh ? 'live' : 'degraded'}`} /> AVAX RADAR · UNIFIED DATA PLANE</span>
          <strong>{radar.fresh ? 'Indexer synchronized' : radar.available ? 'Indexer degraded' : 'Indexer unavailable'}</strong>
        </div>
        <a href="/avalanche/avax-radar/" target="_blank" rel="noreferrer">Open Radar console <ExternalLink size={12} /></a>
      </div>
      <div className="radar-stat-grid">
        <div><span>INDEXED BLOCK</span><strong>{radar.lastSyncedBlock == null ? '—' : integer.format(radar.lastSyncedBlock)}</strong></div>
        <div><span>HEAD LAG</span><strong>{radar.lagBlocks == null ? '—' : `${integer.format(radar.lagBlocks)} blocks`}</strong></div>
        <div><span>SYNC AGE</span><strong>{radar.ageSeconds == null ? '—' : `${integer.format(radar.ageSeconds)}s`}</strong></div>
        <div><span>RPC POOL</span><strong>{radar.availableRpcCount == null ? '—' : `${radar.availableRpcCount}/${radar.totalRpcCount || radar.availableRpcCount}`}</strong></div>
        <div><span>ERC-20 TRANSFERS · 5M</span><strong>{radar.recentTransferCount == null ? '—' : integer.format(radar.recentTransferCount)}</strong></div>
        <div><span>NATIVE TRANSFERS · 5M</span><strong>{radar.recentNativeTransferCount == null ? '—' : integer.format(radar.recentNativeTransferCount)}</strong></div>
      </div>
      <div className="radar-activity">
        <div className="radar-activity-label"><Activity size={13} /><span>RECENT SIGNALS</span></div>
        {activity.length ? activity.map((item) => (
          <a key={item.eventId} href={`https://snowscan.xyz/address/${item.subjectId}`} target="_blank" rel="noreferrer">
            <span className={`radar-tier ${item.tier || 'tier3'}`}>{String(item.tier || 'signal').toUpperCase()}</span>
            <strong>{item.title || 'Radar signal'}</strong>
            <small>{item.subjectId?.slice(0, 8)}…{item.subjectId?.slice(-6)}</small>
          </a>
        )) : <span className="radar-empty">No recent scored signals; ingestion health remains visible above.</span>}
      </div>
      <p>Operational telemetry from AVAX Radar is live and fail-open. It supplements the Observatory’s audited daily metrics; it never rewrites historical values.</p>
    </section>
  );
}

function Kpi({ label, value, unit = 'USD', change, note, metric, icon: Icon = TrendingUp, onInfo }) {
  return (
    <article className={`kpi ${!finite(value) ? 'unavailable' : ''}`}>
      <div className="kpi-label"><Icon size={15} /><span>{label}</span>{metric && <button onClick={() => onInfo(metric)} aria-label={`Methodology for ${label}`}><Info size={14} /></button>}</div>
      <div className="kpi-value">{formatValue(value, unit)}</div>
      <div className="kpi-detail">
        {finite(change) ? <span className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{decimal.format(change)}% vs prior day</span> : <span>{note || 'Latest verified observation'}</span>}
      </div>
    </article>
  );
}

const VERIFICATION_LABELS = {
  pass: 'Matched',
  review: 'Review',
  context: 'Different scope',
  unavailable: 'Unavailable',
};

function VerificationBadge({ status }) {
  return <span className={`verification-badge ${status}`}>{VERIFICATION_LABELS[status] || status}</span>;
}

function VerificationPreview({ data, setPage }) {
  const verification = data.quality.verification;
  const summary = verification.summary;
  return (
    <section className="verification-preview" aria-label="Metric verification summary">
      <div className="verification-seal"><ShieldCheck size={20} /><span>{summary.pass}</span></div>
      <div className="verification-preview-copy">
        <span className="eyebrow">SCOPE-LIMITED VERIFICATION</span>
        <strong>{summary.pass} scoped verification checks passed</strong>
        <p>{verification.policy.scopeDisclosure}</p>
      </div>
      <div className="verification-preview-counts">
        <span><b>{summary.context}</b> scope notes</span>
        <span><b>{summary.unavailable}</b> unavailable</span>
        <span><b>{summary.review}</b> review</span>
      </div>
      <button onClick={() => setPage('verification')}>Open verification desk <ExternalLink size={13} /></button>
    </section>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <CircleAlert size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{dateLabel(label)}</strong>
      {payload.filter((item) => item.value != null).map((item) => (
        <span key={item.dataKey}><i style={{ background: item.color }} />{item.name}: <b>{formatValue(Number(item.value), unit)}</b></span>
      ))}
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  data = [],
  series = [],
  range,
  custom,
  type = 'area',
  unit = 'USD',
  stack = false,
  allowPercent = false,
  metric,
  onInfo,
  empty,
}) {
  const panelRef = useRef(null);
  const [percent, setPercent] = useState(false);
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(new Set());
  const [lockedData, setLockedData] = useState(null);
  const visibleSeries = (expanded ? series : series.slice(0, 6)).filter((item) => !hidden.has(item.key));
  const globalRows = rangeRows(data, range, custom);
  const ranged = lockedData || globalRows;
  const chartData = percent ? normalizePercent(ranged, visibleSeries.map((item) => item.key)) : ranged;
  const chartUnit = percent ? 'percent' : unit;
  const Chart = type === 'bar' ? BarChart : type === 'line' ? LineChart : AreaChart;

  const toggle = (key) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="panel chart-panel" ref={panelRef}>
      <div className="panel-heading">
        <div>
          <h2>{title}{metric && <button className="info-button" onClick={() => onInfo(metric)} aria-label={`Methodology for ${title}`}><Info size={14} /></button>}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="chart-actions">
          {allowPercent && (
            <div className="segmented compact-control" aria-label="Chart value mode">
              <button className={!percent ? 'active' : ''} aria-pressed={!percent} onClick={() => setPercent(false)}>ABS</button>
              <button className={percent ? 'active' : ''} aria-pressed={percent} onClick={() => setPercent(true)}>%</button>
            </div>
          )}
          <button className="icon-button" onClick={() => setMenu((value) => !value)} aria-label="Chart options"><MoreHorizontal size={17} /></button>
          {menu && (
            <div className="chart-menu">
              <button onClick={() => { panelRef.current?.requestFullscreen?.(); setMenu(false); }}><Gauge size={15} /> Fullscreen</button>
              <button onClick={() => { downloadChartPng(panelRef.current, title); setMenu(false); }}><Download size={15} /> Download PNG</button>
              <button onClick={() => { downloadCsv(`${title.toLowerCase().replaceAll(' ', '-')}.csv`, chartData, visibleSeries.map((item) => item.key)); setMenu(false); }}><Download size={15} /> Download CSV</button>
              <button onClick={() => { setLockedData(lockedData ? null : globalRows); setMenu(false); }}>{lockedData ? <Check size={15} /> : <CalendarDays size={15} />}{lockedData ? 'Use global timeframe' : 'Lock timeframe'}</button>
            </div>
          )}
        </div>
      </div>
      {empty || !chartData.length || !visibleSeries.length ? (
        <EmptyState title={empty?.title || 'No observations in this range'} detail={empty?.detail || 'Choose a wider timeframe or review source coverage.'} />
      ) : (
        <>
          <div className="chart-wrap" role="img" aria-label={`${title}. ${subtitle || ''}`}>
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={chartData} margin={{ top: 8, right: 8, left: 2, bottom: 0 }}>
                <CartesianGrid stroke="#252a31" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => dateLabel(value).replace(/, \d{2}$/, '')} minTickGap={36} tick={{ fill: '#8d96a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => formatValue(value, chartUnit)} width={68} tick={{ fill: '#8d96a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={percent ? [0, 100] : ['auto', 'auto']} />
                <Tooltip content={<ChartTooltip unit={chartUnit} />} />
                {visibleSeries.map((item, index) => {
                  const color = item.color || COLORS[index % COLORS.length];
                  if (type === 'bar') return <Bar key={item.key} dataKey={item.key} name={item.name} fill={color} stackId={stack ? 'stack' : undefined} radius={stack ? 0 : [2, 2, 0, 0]} maxBarSize={48} />;
                  if (type === 'line') return <Line key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={color} strokeWidth={2} dot={false} connectNulls />;
                  return <Area key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={color} fill={color} fillOpacity={stack ? 0.62 : 0.16} stackId={stack ? 'stack' : undefined} connectNulls />;
                })}
              </Chart>
            </ResponsiveContainer>
          </div>
          <div className="legend" aria-label={`${title} series`}>
            {(expanded ? series : series.slice(0, 6)).map((item, index) => (
              <button key={item.key} className={hidden.has(item.key) ? 'muted' : ''} aria-pressed={!hidden.has(item.key)} onClick={() => toggle(item.key)}>
                <i style={{ background: item.color || COLORS[index % COLORS.length] }} />{item.name}
              </button>
            ))}
            {series.length > 6 && <button className="show-more" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show Less' : `Show More (${series.length - 6})`}<ChevronDown size={13} /></button>}
          </div>
        </>
      )}
    </section>
  );
}

function CompositionPanel({ title, subtitle, data = [], unit = 'USD', onInfo, metric }) {
  const cleaned = data.filter((row) => finite(row.value) && row.value > 0).sort((a, b) => b.value - a.value);
  const total = cleaned.reduce((sum, row) => sum + row.value, 0);
  return (
    <section className="panel composition-panel">
      <div className="panel-heading"><div><h2>{title}{metric && <button className="info-button" onClick={() => onInfo(metric)} aria-label={`Methodology for ${title}`}><Info size={14} /></button>}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {!cleaned.length ? <EmptyState title="No classified values" detail="The source cannot support this composition yet." /> : (
        <div className="composition-body">
          <div className="donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cleaned} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={1}>
                  {cleaned.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatValue(Number(value), unit)} />
              </PieChart>
            </ResponsiveContainer>
            <div><strong>{formatValue(total, unit)}</strong><span>Total</span></div>
          </div>
          <div className="composition-list">
            {cleaned.slice(0, 8).map((row, index) => (
              <div key={row.name}><i style={{ background: COLORS[index % COLORS.length] }} /><span>{row.name}</span><strong>{formatValue(row.value, unit)}</strong><small>{total ? decimal.format((row.value / total) * 100) : 0}%</small></div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ComparisonPanel({ title, subtitle, data = [], referenceLabel, referenceValue, unit = 'USD', onInfo, metric }) {
  const cleaned = data.filter((row) => finite(row.value) && row.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  const maximum = Math.max(finite(referenceValue) ? referenceValue : 0, ...cleaned.map((row) => row.value), 0);
  return (
    <section className="panel comparison-panel">
      <div className="panel-heading"><div><h2>{title}{metric && <button className="info-button" onClick={() => onInfo(metric)} aria-label={`Methodology for ${title}`}><Info size={14} /></button>}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {!cleaned.length ? <EmptyState title="No comparable values" detail="The source cannot support this comparison yet." /> : (
        <div className="comparison-body">
          {finite(referenceValue) && (
            <div className="comparison-reference">
              <span>{referenceLabel}</span>
              <strong>{formatValue(referenceValue, unit)}</strong>
            </div>
          )}
          {cleaned.map((row, index) => (
            <div className="comparison-row" key={row.name}>
              <div><i style={{ background: COLORS[index % COLORS.length] }} /><span>{row.name}</span><strong>{formatValue(row.value, unit)}</strong></div>
              <span className="comparison-track"><i style={{ background: COLORS[index % COLORS.length], width: `${maximum ? (row.value / maximum) * 100 : 0}%` }} /></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DataTable({ title, subtitle, rows = [], columns, searchPlaceholder, defaultSort, empty, onInfo, metric }) {
  const headingId = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(defaultSort || { key: columns[0].key, direction: 'desc' });
  const [limit, setLimit] = useState(10);
  const filtered = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    const a = left[sort.key];
    const b = right[sort.key];
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''));
    return sort.direction === 'asc' ? order : -order;
  }), [filtered, sort]);
  const updateSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));

  return (
    <section className="panel table-panel">
      <div className="panel-heading table-heading">
        <div><h2 id={headingId}>{title}{metric && <button className="info-button" onClick={() => onInfo(metric)} aria-label={`Methodology for ${title}`}><Info size={14} /></button>}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {rows.length > 5 && <label className="table-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder || 'Filter rows'} aria-label={`${title} filter`} /></label>}
      </div>
      {!rows.length ? <EmptyState title={empty?.title || 'No verified rows'} detail={empty?.detail || 'No records satisfy the current inclusion rules.'} /> : (
        <>
          <div className="table-scroll">
            <table aria-labelledby={headingId}>
              <thead><tr>{columns.map((column) => <th key={column.key} aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button onClick={() => updateSort(column.key)}>{column.label}<ArrowUpDown size={12} /></button></th>)}</tr></thead>
              <tbody>
                {sorted.slice(0, limit).map((row, index) => (
                  <tr key={row.id || row.slug || row.address || `${index}`}>
                    {columns.map((column) => <td key={column.key} data-label={column.label}>{column.render ? column.render(row[column.key], row) : row[column.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>Showing {Math.min(limit, sorted.length)} of {sorted.length}</span>{limit < sorted.length && <button onClick={() => setLimit((value) => value + 10)}>Show more</button>}</div>
        </>
      )}
    </section>
  );
}

function ProtocolCell({ value, row }) {
  return <span className="protocol-cell">{row.logo ? <img src={row.logo} alt="" /> : <span className="protocol-fallback">{value?.[0] || '?'}</span>}<strong>{value}</strong></span>;
}

function IntelligenceHeader({ eyebrow, title, description, updated = 'August 29, 2026' }) {
  return <header className="intelligence-hero"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p><small><Clock3 size={12} /> Source review: {updated} · UTC</small></header>;
}

function LaunchCard({ kicker, title, copy, page, setPage, href }) {
  const body = <><span>{kicker}</span><h2>{title}</h2><p>{copy}</p><strong>Open analysis <ExternalLink size={12} /></strong></>;
  return href ? <a className="launch-card" href={href}>{body}</a> : <button className="launch-card" onClick={() => setPage(page)}>{body}</button>;
}

function BeginnersPage({ setPage }) {
  return <>
    <IntelligenceHeader eyebrow="START HERE · AVALANCHE 101" title="A practical guide to the Avalanche ecosystem" description="Learn the network in plain language, then move directly from each concept into the live Observatory metric that measures it." />
    <section className="reading-surface prose-surface">
      <h2>What is Avalanche?</h2><p>Avalanche is a network for moving assets and running applications. AVAX is its native asset: it is used for transaction fees, staking the Primary Network, and denominating some network-level costs. The dashboard focuses heavily on C-Chain, Avalanche’s EVM-compatible chain, while clearly labeling metrics that cover the wider Primary Network.</p>
      <div className="definition-grid">
        <article><span>CORE CHAIN</span><h3>C-Chain</h3><p>The EVM-compatible chain where most Avalanche DeFi smart contracts and familiar wallet transactions live.</p><button onClick={() => setPage('blockspace')}>View live C-Chain activity →</button></article>
        <article><span>APP NETWORKS</span><h3>Avalanche L1s</h3><p>Purpose-built networks with their own validator and execution choices. “Avalanche activity” should not be assumed to mean C-Chain alone.</p><a href="https://build.avax.network/docs/avalanche-l1s" target="_blank" rel="noreferrer">Read official L1 docs →</a></article>
        <article><span>NATIVE ASSET</span><h3>AVAX utility</h3><p>AVAX pays fees, secures the Primary Network through staking, and has a capped maximum supply. Transaction fees are burned.</p><button onClick={() => setPage('economics')}>View supply and fee burn →</button></article>
      </div>
      <h2>A field guide to Avalanche DeFi</h2><p><dfn>Stablecoin liquidity</dfn> is dollar-linked capital available onchain. It often supports trading and lending, but market cap is not the same thing as immediately tradable depth. <button className="text-link" onClick={() => setPage('overview')}>View live Avalanche stablecoin metrics →</button></p>
      <p><dfn>DEXs</dfn> let users trade from self-custody. Volume measures traded value; TVL is only a rough liquidity proxy and can overlap across protocol adapters. <button className="text-link" onClick={() => setPage('spot-trading')}>View Avalanche DEX volume →</button></p>
      <p><dfn>Lending</dfn> lets suppliers earn interest and borrowers access capital against collateral. Supplied, borrowed, available liquidity, and protocol TVL are different measurements. <button className="text-link" onClick={() => setPage('lending')}>View live lending markets →</button></p>
      <p><dfn>Bridges</dfn> move representations or messages between networks. Bridge TVL is not a guarantee of safety or redemption quality. <button className="text-link" onClick={() => setPage('overview')}>View tracked bridge balances →</button></p>
      <p><dfn>RWAs</dfn>, or real-world assets, are onchain claims linked to offchain instruments such as funds or securities. The Observatory separates verified native issuance from ordinary stablecoins. <button className="text-link" onClick={() => setPage('tokenized-assets')}>View Avalanche tokenized assets →</button></p>
      <h2>How to read the main dashboard</h2><ol><li>Check the timestamp and coverage note before the number.</li><li>Use methodology buttons to see the exact definition and exclusions.</li><li>Treat “live pulse” values as short-window observations and daily charts as complete-day history.</li><li>Never add non-additive protocol adapter TVLs together.</li><li>Read “estimated,” “derived,” and “unavailable” as distinct data states—not footnotes.</li></ol>
    </section>
  </>;
}

function ExpertsPage({ data, live, setPage }) {
  const k = data.overview.kpis;
  return <>
    <IntelligenceHeader eyebrow="ANALYST LAUNCHPAD" title="Avalanche ecosystem analytics for advanced users" description="A high-density route into liquidity, capital flows, protocol growth, validation economics, emissions, governance, and C-Chain history." />
    <div className="expert-tape"><div><span>PROTOCOL TVL</span><strong>{formatValue(k.protocolTvlUsd)}</strong></div><div><span>STABLECOINS</span><strong>{formatValue(k.stablecoinMarketCapUsd)}</strong></div><div><span>DEX · COMPLETE DAY</span><strong>{formatValue(data.spot.volume24hUsd)}</strong></div><div><span>STAKED AVAX</span><strong>{formatValue(live?.economics?.totalStakedAvax, 'AVAX')}</strong></div></div>
    <div className="launch-grid">
      <LaunchCard kicker="LIQUIDITY + FLOW" title="DEX activity" copy="Protocol volume, architecture mix, pair coverage, and historical trends." page="spot-trading" setPage={setPage} />
      <LaunchCard kicker="CREDIT" title="Lending markets" copy="Protocol-native rates, utilization, supplied, borrowed, liquidity, and impairment disclosures." page="lending" setPage={setPage} />
      <LaunchCard kicker="MONETARY" title="Fees and supply" copy="C-Chain burn history and official Primary Network supply accounting." page="economics" setPage={setPage} />
      <LaunchCard kicker="SECURITY BUDGET" title="Validator economics" copy="Current parameters and a transparent duration-sensitive reward model." page="staking" setPage={setPage} />
      <LaunchCard kicker="FORWARD EVENTS" title="Governance watch" copy="ACP state, discussion posture, dates, and potential network impact." page="governance" setPage={setPage} />
      <LaunchCard kicker="EMISSIONS" title="Unlock monitor" copy="Confirmed schedules separated from estimates and protocol issuance." page="unlocks" setPage={setPage} />
      <LaunchCard kicker="CAPITAL FORMATION" title="Stablecoins + RWAs" copy="Stablecoin composition, tokenized issuance, and verified asset activity." page="tokenized-assets" setPage={setPage} />
      <LaunchCard kicker="EXECUTION" title="Blockspace" copy="Transactions, senders, fees, utilization, failures, and contract demand." page="blockspace" setPage={setPage} />
    </div>
  </>;
}

function GovernancePage() {
  return <><IntelligenceHeader eyebrow="FORWARD INTELLIGENCE" title="Avalanche governance and network-change watch" description="Avalanche Community Proposals are technical coordination documents. A discussion thread or ACP status is not automatically a binding AVAX token-holder vote." />
    <div className="event-list">{GOVERNANCE_ITEMS.map((item) => <article key={item.id} className="event-card"><div className="event-status"><span className={`confidence ${item.status === 'Implementable' ? 'high' : 'medium'}`}>{item.status}</span><small>{item.window}</small></div><h2>{item.title}</h2><time>{item.date}</time><p>{item.impact}</p><a href={item.url} target="_blank" rel="noreferrer">Official proposal source <ExternalLink size={12} /></a></article>)}</div>
    <CoverageNote title="Governance methodology" detail="Tracked from the official Avalanche Foundation ACP repository and Avalanche Builder Hub. Dates describe publication/discussion or reviewed status unless an official activation window is explicitly published. The Observatory does not convert GitHub reactions into vote counts." />
  </>;
}

function UnlocksPage({ live }) {
  return <><IntelligenceHeader eyebrow="SUPPLY EVENTS" title="Avalanche token unlocks and emissions" description="DefiLlama-tracked AVAX vesting events, separated from observed protocol staking emissions and labeled with source confidence." />
    <div className="event-list">{AVAX_UNLOCKS.map((item) => <article key={item.id} className="event-card unlock-event"><div className="event-status"><span className="confidence medium">{item.confidence}</span><small>{item.eventType}</small></div><div className="unlock-event-grid"><div><span>UNLOCK DATE</span><strong>{dateTimeLabel(item.date)}</strong></div><div><span>AMOUNT</span><strong>{compact.format(item.amount)} {item.token}</strong></div><div><span>MAX SUPPLY</span><strong>{decimal.format(item.maxSupplyPct)}%</strong></div><div><span>OF FLOAT</span><strong>{decimal.format(item.floatPct)}%</strong></div><div><span>RECIPIENT</span><strong>{item.recipient}</strong></div></div><p>{item.context}</p><a href={item.source} target="_blank" rel="noreferrer">View DefiLlama schedule <ExternalLink size={12} /></a></article>)}</div>
    <div className="two-column intelligence-columns"><article className="reading-surface"><span className="surface-kicker">OBSERVED PROTOCOL EMISSIONS</span><h2>AVAX staking rewards minted</h2><strong className="headline-number">{formatValue(live?.economics?.stakingRewardsMintedAvax, 'AVAX')}</strong><p>Cumulative official network observation. This is protocol issuance, not a team or investor token unlock.</p><small>Updated {dateTimeLabel(live?.economics?.updatedAt)}</small></article><article className="reading-surface"><span className="surface-kicker">ADMISSION RULE</span><h2>What counts as confirmed?</h2><p>A dated project-authored vesting, emissions, governance, or foundation source that identifies the token and event. Amount, supply percentage, and recipient are shown only when the source states them.</p><p>Third-party estimates can be added later, but must carry an “estimated” badge and their own methodology.</p></article></div>
    <CoverageNote title="DefiLlama unlock methodology" detail="AVAX unlock dates, allocation categories, amounts, and supply percentages are trusted from DefiLlama and reviewed August 29, 2026. This is third-party schedule data, not an Avalanche API observation. DefiLlama notes that exact Seed and Private sale dates were unavailable and assigns the latest dates described; staking rewards are sourced separately from on-chain P-Chain supply data. USD value is intentionally calculated nowhere in this static event because it changes with AVAX price." />
  </>;
}

function StakingPage({ live }) {
  const [amount, setAmount] = useState(2000); const [days, setDays] = useState(365);
  const supply = live?.economics?.totalSupplyAvax; const cap = 720_000_000;
  const arr = finite(supply) ? ((cap - supply) / supply) * (0.10 + (0.12 - 0.10) * (days / 365)) : null;
  const reward = finite(arr) ? amount * arr * (days / 365) : null;
  return <><IntelligenceHeader eyebrow="VALIDATION ECONOMICS" title="AVAX staking and validator economics" description="Current official requirements with a transparent, adjustable estimate. Rewards are not guaranteed and validator operating costs are excluded." />
    <div className="staking-layout"><section className="calculator-card"><span>ESTIMATED PROTOCOL REWARD</span><strong>{formatValue(reward, 'AVAX')}</strong><small>{finite(arr) ? `${decimal.format(arr * 100)}% modeled annualized rate` : 'Waiting for official live supply'}</small><label>Stake amount <input type="number" min="25" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} /><em>AVAX</em></label><label>Validation duration <input type="range" min="14" max="365" value={days} onChange={(e) => setDays(Number(e.target.value))} /><em>{days} days</em></label><p>Estimate = stake × modeled ARR × duration / 365. ARR uses live current supply, the 720M cap, and the documented 10%–12% duration curve. It excludes delegation fees, downtime, hardware, hosting, and tax.</p></section>
      <section className="parameter-grid"><article><span>VALIDATOR MINIMUM</span><strong>2,000 AVAX</strong><small>Current Mainnet documentation</small></article><article><span>DELEGATOR MINIMUM</span><strong>25 AVAX</strong><small>Current Mainnet documentation</small></article><article><span>DURATION</span><strong>14–365 days</strong><small>Locked for the selected term</small></article><article><span>MIN. DELEGATION FEE</span><strong>2%</strong><small>Validator-set rate floor</small></article><article><span>REWARD UPTIME</span><strong>&gt;80%</strong><small>Aim for 100%; stake-weighted measurement</small></article><article><span>MAXIMUM WEIGHT</span><strong>min(3M, 5× stake)</strong><small>Own stake plus delegations</small></article></section></div>
    <div className="source-rail"><a href="https://build.avax.network/docs/primary-network/validate/how-to-stake" target="_blank" rel="noreferrer">Official staking parameters <ExternalLink size={12} /></a><a href="https://build.avax.network/docs/acps/285-reduce-minimum-consumption-rate" target="_blank" rel="noreferrer">Reward formula and proposed change <ExternalLink size={12} /></a><span>Live supply updated {dateTimeLabel(live?.economics?.updatedAt)}</span></div>
    <CoverageNote title="Estimate disclosure" detail="Observed: current supply and cumulative rewards from Avalanche Data API. Documented parameters: Builder Hub, reviewed August 29, 2026. Calculated: displayed ARR and reward. The ACP-285 proposed 7.5% floor is not used until activated and reflected in official current parameters." />
  </>;
}

function OverviewPage({ data, live, radar, range, custom, onInfo, setPage }) {
  const overview = data.overview;
  const kpis = overview.kpis;
  const protocolSeries = Object.keys(latest(overview.protocolTvl.protocolHistory)).filter((key) => key !== 'date').map((key) => ({ key, name: key.replaceAll('-', ' ') }));
  const dexSeries = rankDexLiquiditySourceKeys(rangeRows(overview.dex.breakdownHistory, range, custom))
    .map((key) => ({ key, name: key.replaceAll('-', ' ') }));
  const stableComposition = overview.stablecoins.composition || {};
  const stableData = [
    ...overview.stablecoins.assets.slice(0, 10).map((row) => ({ name: row.symbol, value: row.current })),
    ...(finite(stableComposition.otherUsd) && stableComposition.otherUsd > 0 ? [{ name: 'Other', value: stableComposition.otherUsd }] : []),
  ];
  return (
    <>
      <PageTitle title="Ecosystem Overview" description="Capital, liquidity, trading, tokenization, and deployment activity across Avalanche C-Chain." data={data} />
      <LivePulse live={live} snapshot={data} />
      <RadarInfrastructure radar={radar} />
      <div className="kpi-grid four">
        <Kpi label="AVAX Market Cap" value={kpis.avaxMarketCapUsd} note={`${decimal.format(data.status.avaxChange24hPct)}% over 24h`} metric="avax_market_cap" onInfo={onInfo} />
        <Kpi label="Stablecoin Market Cap" value={kpis.stablecoinMarketCapUsd} metric="stablecoin_market_cap" onInfo={onInfo} />
        <Kpi label="Verified Tokenized Value" value={kpis.tokenizedAssetValueUsd} metric="tokenized_asset_value" onInfo={onInfo} />
        <Kpi label="Protocol TVL" value={kpis.protocolTvlUsd} metric="protocol_tvl" onInfo={onInfo} />
      </div>
      <VerificationPreview data={data} setPage={setPage} />
      <ChartPanel title="Protocol TVL Over Time" subtitle="DeFiLlama chain TVL, excluding CEX balances." data={overview.protocolTvl.totalHistory} series={[{ key: 'total', name: 'Avalanche TVL' }]} range={range} custom={custom} metric="protocol_tvl" onInfo={onInfo} />
      <div className="two-column">
        <ChartPanel title="Protocol-Adapter TVL Over Time" subtitle="Non-additive adapter series; wrappers, allocators, and underlying protocols can overlap." data={overview.protocolTvl.protocolHistory} series={protocolSeries} range={range} custom={custom} type="line" metric="protocol_adapter_exposure" onInfo={onInfo} />
        <ComparisonPanel
          title="Gross Protocol-Adapter TVL by Type"
          subtitle="Non-additive comparison. Category values are not chain-TVL shares and must not be summed."
          data={overview.protocolTvl.byType}
          referenceLabel="Authoritative Avalanche chain TVL"
          referenceValue={overview.protocolTvl.byTypeAccounting.chainTvlUsd}
          metric="protocol_adapter_exposure"
          onInfo={onInfo}
        />
      </div>
      <div className="two-column">
        <ComparisonPanel title="Asset Landscape" subtitle="Independent, non-additive accounting categories." data={overview.assetLandscape} metric="ecosystem_asset_landscape" onInfo={onInfo} />
        <CompositionPanel title="Stablecoins by Asset" subtitle={`Top 10 cover ${formatValue(stableComposition.topTenCoveragePct, 'percent')} of the headline total; Other reconciles the tail. BUIDL is excluded from ordinary stablecoins.`} data={stableData} metric="stablecoin_market_cap" onInfo={onInfo} />
      </div>
      <DataTable title="Avalanche Bridge TVL" rows={overview.bridges.protocols} metric="bridge_tvl" onInfo={onInfo} columns={[
        { key: 'name', label: 'Bridge', render: (value, row) => <ProtocolCell value={value} row={row} /> },
        { key: 'tvl', label: 'Tracked TVL', render: (value) => formatValue(value) },
        { key: 'operationalStatus', label: 'Operational Status', render: (value) => <span className="verification-badge unavailable">{value === 'unknown' ? 'Unknown' : value}</span> },
        { key: 'url', label: 'Source', render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">Protocol <ExternalLink size={13} /></a> : 'Unavailable' },
      ]} empty={{ title: 'Bridge flows withheld', detail: overview.bridges.coverage }} />
      <CoverageNote title="Bridge flow coverage" detail={overview.bridges.coverage} />
      <div className="two-column">
        <DataTable title="Spot DEX adapter TVL proxy · Top 30" subtitle={`${overview.ammLiquidity.positiveAdapterCount} positive adapters · ${overview.ammLiquidity.omittedAdapterCount} omitted · ${formatValue(overview.ammLiquidity.omittedTvlUsd)} omitted TVL`} rows={overview.ammLiquidity.protocols} metric="amm_liquidity" onInfo={onInfo} columns={[
          { key: 'name', label: 'Protocol', render: (value, row) => <ProtocolCell value={value} row={row} /> },
          { key: 'category', label: 'Type' },
          { key: 'tvl', label: 'Liquidity Proxy', render: (value) => formatValue(value) },
        ]} />
        <CompositionPanel
          title={`DEX Architecture · ${overview.dex.architectureCoverage.date || 'Current UTC day'}`}
          subtitle={`Dashboard-maintained classification, reviewed ${dateTimeLabel(overview.dex.architectureCoverage.lastReviewedAt)}; ${overview.dex.architectureCoverage.window === 'current-utc-day-partial' ? 'current partial' : 'latest available'} UTC-day rows reconcile to ${formatValue(overview.dex.architectureCoverage.totalVolumeUsd)}. Not independently verified.`}
          data={overview.dex.architectureComposition}
          unit="USD"
          metric="dex_volume"
          onInfo={onInfo}
        />
      </div>
      <ChartPanel title="DEX Volume by Liquidity Source" subtitle="Direct protocol adapter volume; Pharaoh adapters are combined and aggregator adapters are excluded." data={overview.dex.breakdownHistory} series={dexSeries} range={range} custom={custom} type="bar" stack allowPercent metric="dex_volume" onInfo={onInfo} />
      <CoverageNote title="Spot pair categories" detail={overview.dex.pairCoverage} />
      <ChartPanel title="Top-level contract-creation transactions" subtitle="Excludes internal CREATE, CREATE2, and CREATE3 trace activity; not directly comparable with trace-based totals." data={overview.deployments.history} series={[{ key: 'allContractCreations', name: 'Top-level creations' }]} range={range} custom={custom} type="bar" unit="contracts" metric="contract_creations" onInfo={onInfo} />
    </>
  );
}

function BlockspacePage({ data, live, range, custom, onInfo }) {
  const rows = data.blockspace.daily;
  const day = latest(rows);
  return (
    <>
      <PageTitle title="Blockspace" description="Verified block and transaction statistics derived from local C-Chain parquet archives." data={data} />
      <LivePulse live={live} snapshot={data} />
      <div className="kpi-grid four">
        <Kpi label="Average Transaction Cost" value={day.average_fee_avax} unit="AVAX" change={previousChange(rows, 'average_fee_avax')} icon={Fuel} metric="average_transaction_cost" onInfo={onInfo} />
        <Kpi label="Average Gas Price" value={day.average_gas_price_gwei} unit="Gwei" change={previousChange(rows, 'average_gas_price_gwei')} metric="average_gas_price" onInfo={onInfo} />
        <Kpi label="Daily Transactions" value={day.transactions} unit="transactions" change={previousChange(rows, 'transactions')} metric="daily_transactions" onInfo={onInfo} />
        <Kpi label="Distinct transaction senders (transaction.from)" value={day.active_addresses} unit="address" change={previousChange(rows, 'active_addresses')} metric="active_addresses" onInfo={onInfo} />
        <Kpi label="Top-level contract-creation transactions" value={day.contract_creations} unit="contracts" change={previousChange(rows, 'contract_creations')} metric="contract_creations" onInfo={onInfo} />
        <Kpi label="Average Throughput" value={day.throughput_tps} unit="TPS" change={previousChange(rows, 'throughput_tps')} metric="throughput" onInfo={onInfo} />
        <Kpi label="Transaction Failure Rate" value={day.failure_rate_pct} unit="percent" change={previousChange(rows, 'failure_rate_pct')} metric="transaction_failure_rate" onInfo={onInfo} />
        <Kpi label="Block Utilization" value={day.average_block_utilization_pct} unit="percent" change={previousChange(rows, 'average_block_utilization_pct')} metric="block_utilization" onInfo={onInfo} />
      </div>
      <div className="two-column">
        <ChartPanel title="Daily Transactions" data={rows} series={[{ key: 'transactions', name: 'Transactions' }]} range={range} custom={custom} type="bar" unit="transactions" metric="daily_transactions" onInfo={onInfo} />
        <ChartPanel title="Distinct transaction senders (transaction.from)" subtitle="Avalanche activeSenders may also infer senders from token-transfer logs, so the values are not expected to match." data={rows} series={[{ key: 'active_addresses', name: 'Distinct transaction.from senders' }]} range={range} custom={custom} type="line" unit="address" metric="active_addresses" onInfo={onInfo} />
      </div>
      <div className="two-column">
        <ChartPanel title="Average and Median Fees" data={rows} series={[{ key: 'average_fee_avax', name: 'Average fee' }, { key: 'median_fee_avax', name: 'Median fee' }]} range={range} custom={custom} type="line" unit="AVAX" metric="average_transaction_cost" onInfo={onInfo} />
        <ChartPanel title="Throughput and Failure Rate" data={rows} series={[{ key: 'throughput_tps', name: 'TPS' }, { key: 'failure_rate_pct', name: 'Failure rate %' }]} range={range} custom={custom} type="line" unit="" metric="blockspace_performance" onInfo={onInfo} />
      </div>
      <DataTable title="Top Contracts by Blockspace" rows={data.blockspace.topContracts} columns={[
        { key: 'label', label: 'Contract', render: (value, row) => <span className="address-cell"><strong>{value || 'Unlabeled contract'}</strong><code>{row.address.slice(0, 8)}…{row.address.slice(-6)}</code></span> },
        { key: 'gas_used', label: 'Gas Consumed', render: (value) => compact.format(value) },
        { key: 'transactions', label: 'Transactions', render: (value) => compact.format(value) },
        { key: 'unique_senders', label: 'Unique Users', render: (value) => compact.format(value) },
        { key: 'fees_burned_avax', label: 'Fees Burned', render: (value) => formatValue(value, 'AVAX') },
        { key: 'address', label: 'Explorer', render: (value) => <a href={`https://snowtrace.io/address/${value}`} target="_blank" rel="noreferrer">Snowtrace <ExternalLink size={13} /></a> },
      ]} searchPlaceholder="Search contract or label" />
    </>
  );
}

function SupplyLedger({ supply, onInfo }) {
  const available = finite(supply?.totalSupplyAvax)
    && finite(supply?.genesisUnlockAvax)
    && finite(supply?.stakingRewardsMintedAvax)
    && finite(supply?.networkBurnedAvax);
  return (
    <section className="panel supply-ledger">
      <div className="panel-heading">
        <div>
          <h2>Primary Network Supply Ledger<button className="info-button" onClick={() => onInfo('avax_supply_ledger')} aria-label="Methodology for Primary Network Supply Ledger"><Info size={14} /></button></h2>
          <p>Official live accounting. Genesis unlock plus staking rewards, less cumulative P/C/X transaction-fee burns.</p>
        </div>
        <a className="source-link" href="https://build.avax.network/docs/api-reference/data-api/avax-supply/getAvaxSupply" target="_blank" rel="noreferrer">Avalanche Data API <ExternalLink size={12} /></a>
      </div>
      {!available ? (
        <EmptyState title="Official supply observation unavailable" detail="C-Chain burn charts remain available from the audited local index." />
      ) : (
        <div className="supply-ledger-body">
          <div className="supply-net">
            <span>NET SUPPLY SINCE GENESIS</span>
            <strong>{formatValue(supply.netSupplySinceGenesisAvax, 'AVAX')}</strong>
            <small>Updated {dateTimeLabel(supply.updatedAt)}</small>
          </div>
          <div className="supply-equation" aria-label="AVAX supply accounting equation">
            <div><span>Genesis unlock</span><strong>+ {formatValue(supply.genesisUnlockAvax, 'AVAX')}</strong></div>
            <div><span>Staking rewards minted</span><strong className="positive">+ {formatValue(supply.stakingRewardsMintedAvax, 'AVAX')}</strong></div>
            <div><span>Network fees burned</span><strong className="negative">− {formatValue(supply.networkBurnedAvax, 'AVAX')}</strong></div>
            <div className="supply-total"><span>Current total supply</span><strong>{formatValue(supply.totalSupplyAvax, 'AVAX')}</strong></div>
          </div>
          <div className="supply-security">
            <span>SECURING THE NETWORK</span>
            <strong>{formatValue(supply.totalStakedAvax, 'AVAX')}</strong>
            <small>{finite(supply.stakedSharePct) ? `${decimal.format(supply.stakedSharePct)}% of current supply staked` : 'Stake share unavailable'}</small>
            <div className="stake-track" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, supply.stakedSharePct || 0))}%` }} /></div>
            <span className="locked-copy">{formatValue(supply.totalLockedAvax, 'AVAX')} additionally reported locked</span>
          </div>
          <div className="burn-split">
            <span>ALL-TIME FEE BURN BY PRIMARY CHAIN</span>
            <div><b>C</b><i><em style={{ width: `${supply.networkBurnedAvax ? (supply.cChainBurnedAvax / supply.networkBurnedAvax) * 100 : 0}%` }} /></i><strong>{formatValue(supply.cChainBurnedAvax, 'AVAX')}</strong></div>
            <div><b>X</b><i><em style={{ width: `${supply.networkBurnedAvax ? (supply.xChainBurnedAvax / supply.networkBurnedAvax) * 100 : 0}%` }} /></i><strong>{formatValue(supply.xChainBurnedAvax, 'AVAX')}</strong></div>
            <div><b>P</b><i><em style={{ width: `${supply.networkBurnedAvax ? (supply.pChainBurnedAvax / supply.networkBurnedAvax) * 100 : 0}%` }} /></i><strong>{formatValue(supply.pChainBurnedAvax, 'AVAX')}</strong></div>
          </div>
        </div>
      )}
    </section>
  );
}

function EconomicsPage({ data, live, range, custom, onInfo }) {
  const economics = data.economics;
  const day = latest(economics.feeHistory);
  const supply = live?.economics;
  return (
    <>
      <PageTitle title="Economics" description="Primary Network tokenomics and C-Chain fee burn, using Avalanche-native accounting." data={data} />
      <div className="kpi-grid four">
        <Kpi label="30-day covered C-Chain burn" value={economics.kpis.coveredFeesBurnedAvax} unit="AVAX" note="Coverage window; not all-time burn" metric="transaction_fees_burned" onInfo={onInfo} />
        <Kpi label="Current-Price Fee Value" value={economics.kpis.coveredFeesBurnedUsdCurrentPrice} note="Uses current AVAX price" metric="transaction_fees_burned" onInfo={onInfo} />
        <Kpi label="Latest Daily Burn" value={day.feesAvax} unit="AVAX" metric="transaction_fees_burned" onInfo={onInfo} />
        <Kpi label="30-day annualized run rate" value={latest(economics.annualizedHistory).avax30d} unit="AVAX" note="30-day daily average × 365" metric="annualized_fee_burn" onInfo={onInfo} />
        <Kpi label="Current AVAX Supply" value={supply?.totalSupplyAvax} unit="AVAX" note={`Official update · ${dateTimeLabel(supply?.updatedAt)}`} metric="avax_supply_ledger" onInfo={onInfo} />
        <Kpi label="Net Supply Since Genesis" value={supply?.netSupplySinceGenesisAvax} unit="AVAX" note="Rewards minted less P/C/X burns" metric="avax_supply_ledger" onInfo={onInfo} />
        <Kpi label="Staking Rewards Minted" value={supply?.stakingRewardsMintedAvax} unit="AVAX" note="Cumulative protocol rewards" metric="avax_staking_rewards" onInfo={onInfo} />
        <Kpi label="Network Fees Burned" value={supply?.networkBurnedAvax} unit="AVAX" note="Cumulative P + C + X fees" metric="avax_network_fee_burn" onInfo={onInfo} />
      </div>
      <CoverageNote title="Avalanche-native accounting" detail="Primary Network validators earn newly minted staking rewards; C-, P-, and X-Chain transaction fees are burned instead of paid to block producers. Supply values are live official observations, while the daily C-Chain series below remains independently indexed and audited." />
      <SupplyLedger supply={supply} onInfo={onInfo} />
      <ChartPanel title="Daily Fee Burn" subtitle="AVAX burned by covered C-Chain transactions." data={economics.feeHistory} series={[{ key: 'feesAvax', name: 'Fees burned' }]} range={range} custom={custom} type="bar" unit="AVAX" metric="transaction_fees_burned" onInfo={onInfo} />
      <div className="two-column">
        <ChartPanel title="Average and Median Transaction Fee" data={economics.feeHistory} series={[{ key: 'averageFeeAvax', name: 'Average' }, { key: 'medianFeeAvax', name: 'Median' }]} range={range} custom={custom} type="line" unit="AVAX" metric="average_transaction_cost" onInfo={onInfo} />
        <ChartPanel title="30-day annualized run rate" subtitle="Derived: displayed 30-day daily average × 365; not a forecast or all-time burn." data={economics.annualizedHistory} series={[{ key: 'avax30d', name: '30-day annualized run rate' }]} range={range} custom={custom} type="line" unit="AVAX" metric="annualized_fee_burn" onInfo={onInfo} />
      </div>
    </>
  );
}

function SpotPage({ data, range, custom, onInfo }) {
  const spot = data.spot;
  const series = rankDexLiquiditySourceKeys(rangeRows(spot.breakdownHistory, range, custom))
    .map((key) => ({ key, name: key.replaceAll('-', ' ') }));
  return (
    <>
      <PageTitle title="Spot Trading" description="Liquidity, protocol volume, and verified architecture coverage for Avalanche spot markets." data={data} />
      <div className="kpi-grid four">
        <Kpi label="Spot DEX adapter TVL proxy" value={spot.ammLiquidityUsd} metric="amm_liquidity" onInfo={onInfo} />
        <Kpi label="DEX Volume · Latest Complete Day" value={spot.volume24hUsd} note="DeFiLlama completed UTC bucket" metric="dex_volume" onInfo={onInfo} />
        <Kpi label="DEX Volume (7d)" value={spot.volume7dUsd} metric="dex_volume" onInfo={onInfo} />
        <Kpi label="DEX Volume (30d)" value={spot.volume30dUsd} metric="dex_volume" onInfo={onInfo} />
      </div>
      <ChartPanel title="DEX Volume Over Time" data={spot.totalHistory} series={[{ key: 'total', name: 'Spot volume' }]} range={range} custom={custom} type="bar" metric="dex_volume" onInfo={onInfo} />
      <ChartPanel title="DEX Volume by Liquidity Source" subtitle="Direct protocol adapter volume; Pharaoh adapters are combined and aggregator adapters are excluded." data={spot.breakdownHistory} series={series} range={range} custom={custom} stack allowPercent metric="dex_volume" onInfo={onInfo} />
      <div className="two-column">
        <CompositionPanel
          title={`Volume by Pool Architecture · ${spot.architectureCoverage.date || 'Current UTC day'}`}
          subtitle={`Dashboard-maintained classification; ${spot.architectureCoverage.window === 'current-utc-day-partial' ? 'current partial' : 'latest available'} UTC-day rows reconcile to ${formatValue(spot.architectureCoverage.totalVolumeUsd)}. Not independently verified.`}
          data={spot.architectureComposition}
          metric="dex_volume"
          onInfo={onInfo}
        />
        <DataTable title="Active Liquidity Sources" rows={spot.protocols} metric="dex_volume" onInfo={onInfo} columns={[
          { key: 'name', label: 'Protocol' },
          { key: 'volume24h', label: '24h Volume', render: (value) => formatValue(value) },
          { key: 'volume7d', label: '7d Volume', render: (value) => formatValue(value) },
          { key: 'volume30d', label: '30d Volume', render: (value) => formatValue(value) },
          { key: 'change1d', label: '24h Change', render: (value) => formatValue(value, 'percent') },
        ]} />
      </div>
      <ChartPanel title="Spot Volume by Pair Category" data={spot.pairCategories} series={[]} range={range} custom={custom} metric="dex_volume" onInfo={onInfo} empty={{ title: 'Pair-level volume withheld', detail: data.overview.dex.pairCoverage }} />
    </>
  );
}

function tokenizedObservation(row, field) {
  const status = row.fieldStatus?.[field];
  // Field observations are authoritative, including a missing retained timestamp.
  // Never substitute the latest Gateway block for an older retained supply read.
  const observedAt = status ? status.observedAt : (field === 'totalSupply'
    ? row.supplyObservedAt
    : row.priceObservedAt || row.valuationObservedAt || row.valuationFeed?.updatedAt);
  const retained = status?.retainedLastGood === true;
  const sourceAvailability = status?.availability || 'unavailable';
  const availability = retained && sourceAvailability === 'available' ? 'stale' : sourceAvailability;
  const label = retained
    ? (availability === 'unavailable' ? 'Unavailable · retained observation' : 'Retained · stale')
    : ({ available: 'Current', partial: 'Partial', stale: 'Stale', unavailable: 'Unavailable' }[availability] || 'Status unavailable');
  return { observedAt, retained, availability, label };
}

function TokenizedFieldStatus({ row, field }) {
  const status = tokenizedObservation(row, field);
  return <small className={`tokenized-field-status ${status.availability}`}>{status.label}</small>;
}

function tokenizedValuationSource(row) {
  const address = row.feedContract || row.valuationContract || row.valuationFeed?.address;
  const url = /^https:\/\//i.test(row.valuationSource?.url || '') ? row.valuationSource.url
    : /^0x[\da-f]{40}$/i.test(address || '') ? `https://snowscan.xyz/address/${address}` : null;
  return { url, label: row.valuationSource?.label || row.valuationFeed?.label || 'Valuation feed' };
}

function TokenizedValuationEvidence({ row }) {
  const source = tokenizedValuationSource(row);
  const price = tokenizedObservation(row, 'valuationUsd');
  const supply = tokenizedObservation(row, 'totalSupply');
  const basis = { 'fundamental-nav': 'Fundamental NAV · USD/share', 'end-of-day-equity-price': 'End-of-day equity price · USD/share' }[row.valuationBasis] || row.valuationBasis;
  return <span className="tokenized-evidence address-cell">
    <strong>{basis || 'Valuation basis unavailable'}</strong>
    {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink size={13} /></a> : <span>Valuation source unavailable</span>}
    <span>Price observed: {price.observedAt ? <time dateTime={price.observedAt}>{dateTimeLabel(price.observedAt)}</time> : 'Unavailable'} · {price.label}</span>
    <span>Supply observed: {supply.observedAt ? <time dateTime={supply.observedAt}>{dateTimeLabel(supply.observedAt)}</time> : 'Unavailable'} · {supply.label}</span>
  </span>;
}

function TokenizedPage({ data, range, custom, onInfo }) {
  const tokenized = data.tokenizedAssets;
  const venueLandscape = tokenized.venueLandscape;
  const [assetId, setAssetId] = useState(tokenized.assets[0]?.id || '');
  const asset = tokenized.assets.find((row) => row.id === assetId) || tokenized.assets[0];
  const currentValuedAssets = tokenized.assets.filter((row) => finite(row.valueUsd) && tokenizedObservation(row, 'valueUsd').availability === 'available').length;
  const retainedValueAssets = tokenized.assets.filter((row) => finite(row.valueUsd) && row.fieldStatus?.valueUsd?.retainedLastGood).length;
  const rwaSeries = Object.keys(latest(tokenized.rwaAdapterValueHistory)).filter((key) => key !== 'date' && key !== 'total').map((key) => ({ key, name: key.replaceAll('-', ' ') }));
  return (
    <>
      <PageTitle title="Tokenized Assets" description="Verified native Avalanche RWA issuances, separated from ordinary stablecoins and bridged representations." data={data} />
      <div className="kpi-grid four">
        <Kpi label="Verified Assets" value={tokenized.kpis.verifiedTokenContracts} unit="contracts" metric="tokenized_asset_count" onInfo={onInfo} />
        <Kpi label="Verified Contract Value" value={tokenized.kpis.verifiedContractValueUsd} note={`${tokenized.kpis.valueCoverage || `${tokenized.kpis.valuedAssets}/${tokenized.kpis.trackedAssets}`} valued · ${tokenized.kpis.valueAvailability || 'partial'}`} metric="tokenized_asset_value" onInfo={onInfo} />
        <Kpi label="Broader RWA Adapter TVL" value={tokenized.kpis.rwaAdapterTvlUsd} note="Separate adapter scope; not additive" metric="rwa_adapter_tvl" onInfo={onInfo} />
        <Kpi label="Summed Contract Addresses" value={tokenized.kpis.verifiedHolders} unit="address" note={`${tokenized.kpis.holderCoverage || 'legacy snapshot'} · not unique investors`} metric="tokenized_asset_holders" onInfo={onInfo} />
      </div>
      <CoverageNote title="Coverage and scope" detail={`${tokenized.scope?.completeness || 'Curated verified-contract coverage.'} ${tokenized.kpis.valuedAssets} of ${tokenized.kpis.trackedAssets} assets valued from exact-contract supply × validated RedStone valuation. Stablecoins, bridged wrappers, DeFiLlama adapter TVL, and RWA.xyz comparator estimates remain separate and are not additive.`} />
      <CoverageNote title="Valuation freshness" detail={`${currentValuedAssets} current asset valuations; ${retainedValueAssets} retained last-good observations. ${tokenized.kpis.valueAvailability === 'available' ? 'The eligible exact-contract aggregate is available.' : `Aggregate coverage is ${tokenized.kpis.valueAvailability || 'unavailable'}.`} Source status and independent price/supply observation times are shown per asset; publishing a snapshot does not refresh those observations.`} />
      <CoverageNote title="Canonical source and activity coverage" detail={tokenized.activityStatus ? `Gateway block ${tokenized.canonicalSnapshot?.block?.number?.toLocaleString?.() || 'unavailable'} observed ${dateTimeLabel(tokenized.canonicalSnapshot?.block?.timestamp)}. Activity ${tokenized.activityStatus.availability}: fully covered archive days ${tokenized.activityStatus.coverage?.start || 'unknown'}–${tokenized.activityStatus.coverage?.end || 'unknown'}; explicit zeros only inside that interval. ${tokenized.activityStatus.limitation}` : 'Canonical activity coverage unavailable.'} />
      <div className="asset-toolbar">
        <label><span>Asset</span><select value={asset?.id || ''} onChange={(event) => setAssetId(event.target.value)}>{tokenized.assets.map((row) => <option key={row.id} value={row.id}>{row.symbol} · {row.name}</option>)}</select></label>
        {asset && <div><span>Supply</span><strong>{finite(asset.totalSupply) ? `${compact.format(asset.totalSupply)} ${asset.symbol}` : 'Unavailable'}</strong><TokenizedFieldStatus row={asset} field="totalSupply" /></div>}
        {asset && <div><span>Tokenized value</span><strong>{formatValue(asset.valueUsd)}</strong><TokenizedFieldStatus row={asset} field="valueUsd" /></div>}
        {asset && <div><span>Valuation</span><strong>{finite(asset.valuationUsd) ? `${formatValue(asset.valuationUsd)} / share` : 'Unavailable'}</strong><TokenizedFieldStatus row={asset} field="valuationUsd" /></div>}
        {asset && <a href={asset.explorer} target="_blank" rel="noreferrer">Contract <ExternalLink size={14} /></a>}
        {asset?.issuerUrl && <a href={asset.issuerUrl} target="_blank" rel="noreferrer">Issuer <ExternalLink size={14} /></a>}
      </div>
      {asset && <section className="tokenized-selected-evidence" aria-label={`${asset.symbol} valuation and supply evidence`}><TokenizedValuationEvidence row={asset} />{asset.productUrl && <a href={asset.productUrl} target="_blank" rel="noreferrer">Product evidence <ExternalLink size={13} /></a>}</section>}
      <DataTable title="Verified Tokenized Assets" rows={tokenized.assets} metric="tokenized_asset_value" onInfo={onInfo} columns={[
        { key: 'name', label: 'Asset', render: (value, row) => <span className="address-cell"><strong>{value}</strong><span>{row.category}</span></span> },
        { key: 'symbol', label: 'Symbol' },
        { key: 'totalSupply', label: 'Supply', render: (value, row) => <span className="tokenized-evidence address-cell"><strong>{finite(value) ? compact.format(value) : 'Unavailable'}</strong><TokenizedFieldStatus row={row} field="totalSupply" /></span> },
        { key: 'valueUsd', label: 'Tokenized Value', render: (value, row) => <span className="tokenized-evidence address-cell"><strong>{formatValue(value)}</strong><TokenizedFieldStatus row={row} field="valueUsd" /></span> },
        { key: 'holders', label: 'Contract addresses', render: (value, row) => <span className="tokenized-evidence address-cell"><strong>{finite(value) ? integer.format(value) : 'Unavailable'}</strong><TokenizedFieldStatus row={row} field="holders" /></span> },
        { key: 'issuer', label: 'Issuer', render: (value, row) => row.issuerUrl ? <a href={row.issuerUrl} target="_blank" rel="noreferrer">{value || 'Issuer source'} <ExternalLink size={13} /></a> : 'Unavailable' },
        { key: 'valuationBasis', label: 'Valuation basis', render: (_value, row) => <TokenizedValuationEvidence row={row} /> },
        { key: 'confidence', label: 'Confidence', render: (value) => <span className={`confidence ${value}`}>{value}</span> },
        { key: 'address', label: 'Contract', render: (value) => <a href={`https://snowscan.xyz/address/${value}`} target="_blank" rel="noreferrer">{value.slice(0, 8)}… <ExternalLink size={13} /></a> },
      ]} />
      {tokenized.valueHistory?.length >= 2
        ? <ChartPanel title="Verified Contract Value Over Time" data={tokenized.valueHistory} series={[{ key: 'total', name: 'Verified contract value' }]} range={range} custom={custom} metric="tokenized_asset_value" onInfo={onInfo} />
        : <CoverageNote title="Valuation history" detail={`${tokenized.valueHistory?.length ? `Source-backed observations start ${tokenized.valueHistory[0].date}.` : 'Source-backed observations are not yet recorded.'} No historical values are inferred. A trend chart will appear after a second dated observation.`} />}
      <div className="two-column">
        <ChartPanel title={`${asset?.symbol || 'Asset'} Daily Mint and Burn`} subtitle={tokenized.activityStatus?.coverage ? `Indexed token units · covered ${tokenized.activityStatus.coverage.start}–${tokenized.activityStatus.coverage.end} · ${tokenized.activityStatus.availability}` : 'Indexed token units · coverage unavailable'} data={asset?.history || []} series={[{ key: 'minted', name: 'Minted', color: '#34d399' }, { key: 'burned', name: 'Burned', color: '#ef3b42' }]} range={range} custom={custom} type="bar" unit="" metric="tokenized_mint_burn" onInfo={onInfo} empty={!asset?.history?.length ? { title: 'Mint and burn observations unavailable', detail: 'No covered daily rows were published for this asset. Missing rows do not establish zero activity.' } : null} />
        <ChartPanel title={`${asset?.symbol || 'Asset'} Holder History`} subtitle="Contract holder-record count; not deduplicated people or investors." data={asset?.holderHistory || []} series={[{ key: 'holders', name: 'Contract holder records' }]} range={range} custom={custom} type="line" unit="address" metric="tokenized_asset_holders" onInfo={onInfo} empty={!asset?.holderHistory?.length ? { title: 'Holder history unavailable', detail: 'No dated contract holder-record series is available for this asset.' } : null} />
      </div>
      <CoverageNote title="Asset-level DEX volume" detail={tokenized.dexCoverage} />
      {venueLandscape && <section className="panel venue-landscape" aria-labelledby="tokenized-venue-landscape-title">
        <div className="panel-heading">
          <div>
            <h2 id="tokenized-venue-landscape-title">Tokenized-stock venue landscape</h2>
            <p>{venueLandscape.scope}</p>
          </div>
          <span className={`venue-state ${venueLandscape.ranking.availability}`}>{venueLandscape.ranking.availability}</span>
        </div>
        <div className="venue-ranking-note">
          <div><span>Live market lens</span><strong>{venueLandscape.ranking.provider} · {venueLandscape.ranking.metric}</strong><small>Rolling seven days · snapshot values {venueLandscape.ranking.availability}</small></div>
          <a href={venueLandscape.ranking.sourceUrl} target="_blank" rel="noreferrer">Open live ranking <ExternalLink size={13} /></a>
        </div>
        <p className="venue-limitation">{venueLandscape.ranking.limitation}</p>
        <div className="venue-cards">
          {venueLandscape.venues.map((venue) => <article className="venue-card" key={venue.id}>
            <div className="venue-card-title"><div><span>{venue.chain} · {venue.venueType}</span><h3>{venue.name}</h3></div><span className={`venue-state ${venue.availability}`}>Announced · not live</span></div>
            <p>{venue.plan}</p>
            <dl>
              <div><dt>7d net deposits</dt><dd>Unavailable</dd></div>
              <div><dt>Volume</dt><dd>Unavailable</dd></div>
              <div><dt>Launch date</dt><dd>Unavailable</dd></div>
              <div><dt>Contracts</dt><dd>Unavailable</dd></div>
            </dl>
            <p className="venue-limitation">{venue.limitation}</p>
            <a href={venue.sourceUrl} target="_blank" rel="noreferrer">{venue.sourceLabel} · <time dateTime={venue.evidenceObservedAt}>{dateTimeLabel(venue.evidenceObservedAt)}</time> <ExternalLink size={13} /></a>
          </article>)}
        </div>
      </section>}
      <CoverageNote title="Broader protocol adapter TVL · secondary scope" detail="DeFiLlama protocol adapter TVL can include structures beyond the verified issuance ledger. It is not additive to exact-contract value." />
      <ChartPanel title="Broader RWA Adapter TVL Over Time" subtitle="Secondary, non-additive adapter scope; top contributors are shown first." data={tokenized.rwaAdapterValueHistory} series={rwaSeries} range={range} custom={custom} type="line" metric="rwa_adapter_tvl" onInfo={onInfo} />
      <DataTable title="Broader RWA Protocol Adapters" rows={tokenized.protocols} defaultSort={{ key: 'tvl', direction: 'desc' }} metric="rwa_adapter_tvl" onInfo={onInfo} columns={[
        { key: 'name', label: 'Protocol', render: (value, row) => <ProtocolCell value={value} row={row} /> },
        { key: 'tvl', label: 'Adapter TVL', render: (value) => formatValue(value) },
        { key: 'sourceUrl', label: 'Source', render: (value, row) => value ? <span className="address-cell"><a href={value} target="_blank" rel="noreferrer">{row.sourceLabel || 'Adapter evidence'} <ExternalLink size={13} /></a><span>{dateTimeLabel(row.observedAt || data.generatedAt)}</span></span> : 'Unavailable' },
        { key: 'protocolUrl', label: 'Protocol', render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">Homepage <ExternalLink size={13} /></a> : 'Unavailable' },
      ]} />
    </>
  );
}

function LendingPage({ data, range, custom, onInfo }) {
  const lending = data.lending;
  const vaultAvailability = lending.vaultAvailability || 'unavailable';
  const hasVaultInventory = vaultAvailability !== 'unavailable';
  const liquidationAvailability = lending.liquidationAvailability || 'unavailable';
  const vaultSummary = lending.vaultSummary || {};
  const liquidationCoverage = lending.liquidationCoverage || {};
  const liquidationProtocols = lending.liquidationProtocols || [];
  const liquidationHistory = lending.liquidationHistory || [];
  const marketAvailability = lending.marketAvailability || 'unavailable';
  const vaultRows = (lending.vaults || []).filter((row) => row.active || row.protocol === 'silo-v2');
  const vaultCoverageText = vaultSummary.accounting?.explanation
    || 'Factory vault state is unavailable for this snapshot.';
  const liquidationCoverageText = liquidationCoverage.days
    ? `Dated unverified observations · ${liquidationCoverage.start}–${liquidationCoverage.end} · ${liquidationCoverage.eventCountsExact === true ? 'verified event counts' : 'partial observed counts'} · ${liquidationCoverage.limitation || liquidationCoverage.valueMethod || 'Valuation coverage limited to observed events'}`
    : 'Liquidation event coverage is unavailable for this snapshot.';
  const [protocol, setProtocol] = useState('all');
  const [asset, setAsset] = useState('');
  const [historyIndex, setHistoryIndex] = useState(() => String(Math.max(0, (lending.sourceHistories || []).findIndex((row) => row.protocol === 'aave-v4'))));
  const sourceHistories = lending.sourceHistories || [];
  const selectedHistory = sourceHistories[Number(historyIndex)];
  const historicalRates = selectedHistory?.rateBasis != null;
  const sourceHistoryPoints = (selectedHistory?.points || []).map((point) => ({ ...point, date: point.timestamp?.slice(0, 10) }));
  const markets = (lending.markets || []).filter((row) => (protocol === 'all' || row.protocol === protocol) && (!asset || `${row.symbol || ''} ${row.marketName || row.name || ''}`.toLowerCase().includes(asset.toLowerCase())));
  const impairedMarkets = lending.impairedMarkets || [];
  const [freshnessNow, setFreshnessNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setFreshnessNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const liveAgeSeconds = (row) => Number.isFinite(Date.parse(row.observedAt)) ? Math.max(0, Math.floor((freshnessNow - Date.parse(row.observedAt)) / 1000)) : null;
  return (
    <>
      <PageTitle title="Lending" description="Source-backed lending balances, rates, coverage, and dated liquidation observations on Avalanche." data={data} />
      <div className="kpi-grid four">
        <Kpi label="Tracked Gross Supply" value={lending.kpis.totalSuppliedUsd} note="Eligible priced claims; coverage below, not chain-wide TVL" metric="lending_market_size" onInfo={onInfo} />
        <Kpi label="Tracked Borrowed" value={lending.kpis.totalBorrowedUsd} metric="lending_borrowed" onInfo={onInfo} />
        <Kpi label="Protocol Net TVL" value={lending.kpis.netTvlUsd} note={`DeFiLlama ${lending.referenceLlama?.protocols?.length || 0}-family reference · fetched ${dateTimeLabel(lending.referenceLlama?.observedAt)}`} metric="lending_market_size" onInfo={onInfo} />
        <Kpi label="Tracked Liquid Cash" value={lending.kpis.availableLiquidityUsd} note="Source liquidity; not guaranteed borrow or withdrawal capacity" metric="lending_available_liquidity" onInfo={onInfo} />
        {hasVaultInventory && <Kpi label="Factory Vault Assets" value={lending.kpis.factoryVaultAssetsUsd} note={`${vaultAvailability}: gross, non-additive`} metric="lending_vault_tvl" onInfo={onInfo} />}
      </div>
      <div className="kpi-grid four">
        {hasVaultInventory && <Kpi label="Active Factory Vaults" value={vaultSummary.activeVaults} unit="contracts" note={finite(vaultSummary.totalVaults) ? `${vaultSummary.totalVaults} factory children discovered` : 'Canonical vault inventory unavailable'} icon={Landmark} metric="lending_vault_tvl" onInfo={onInfo} />}
        {hasVaultInventory && <Kpi label="Priced Active Vaults" value={vaultSummary.pricedActiveVaults} unit="contracts" note={finite(vaultSummary.unpricedActiveVaults) ? `${vaultSummary.unpricedActiveVaults} remain unvalued` : 'Canonical pricing coverage unavailable'} icon={ShieldCheck} metric="lending_vault_tvl" onInfo={onInfo} />}
        <Kpi label="Observed Liquidations · Retained Window" value={lending.kpis.liquidations30d} unit="events" note={`${liquidationAvailability}: contract events`} icon={Activity} metric="lending_liquidations" onInfo={onInfo} />
        <Kpi label="Observed Debt · Retained Window" value={lending.kpis.liquidationDebtRepaidUsd30d} note="Partial coverage · end-of-day token price estimates" icon={CircleDollarSign} metric="lending_liquidations" onInfo={onInfo} />
      </div>
      <ChartPanel title="Reference lending aggregates over time" subtitle={`DeFiLlama retained ${lending.historyCoverage?.families?.length || 0}-family history, not native totals. Net TVL and debt are independent source fields.`} data={lending.history} series={[{ key: 'netTvl', name: 'Net TVL' }, { key: 'borrowed', name: 'Borrowed' }]} range={range} custom={custom} type="line" metric="lending_market_size" onInfo={onInfo} />
      {sourceHistories.length > 0 && <>
        <div className="filter-bar"><label>Source history<select aria-label="Lending source history" value={historyIndex} onChange={(event) => setHistoryIndex(event.target.value)}>{sourceHistories.map((item, index) => <option key={index} value={String(index)}>{item.protocol} · {item.siloId || item.accountingLevel || item.kind} · {item.rateBasis || 'USD balances'} · series {index + 1}</option>)}</select></label>{selectedHistory?.sourceUrl && <a href={selectedHistory.sourceUrl} target="_blank" rel="noreferrer">Historical source <ExternalLink size={13} /></a>}</div>
        <ChartPanel title="Protocol Source History" subtitle={`${selectedHistory?.protocol || ''} · ${selectedHistory?.rateBasis || 'source-reported hub balances'} · actual source timestamps; no synthetic backfill or cross-market sum`} data={sourceHistoryPoints} series={historicalRates ? [{ key: 'supplyRatePct', name: 'Supply rate' }, { key: 'borrowRatePct', name: 'Borrow rate' }] : [{ key: 'suppliedUsd', name: 'Supplied' }, { key: 'borrowedUsd', name: 'Borrowed' }, { key: 'availableLiquidityUsd', name: 'Liquid cash' }]} range={range} custom={custom} type="line" unit={historicalRates ? 'percent' : 'usd'} metric="lending_rates" onInfo={onInfo} />
      </>}
      <DataTable title="Tracked protocol subtotals" subtitle="Field-specific coverage applies. Silo utilization excludes protected collateral; incomplete debt coverage has no inferred utilization." rows={lending.protocols} metric="lending_market_size" onInfo={onInfo} columns={[
        { key: 'name', label: 'Protocol' },
        { key: 'supplied', label: 'Supplied', render: (value) => formatValue(value) },
        { key: 'borrowed', label: 'Borrowed', render: (value) => formatValue(value) },
        { key: 'netTvl', label: 'Net TVL', render: (value) => formatValue(value) },
        { key: 'availableLiquidity', label: 'Available Liquidity', render: (value) => formatValue(value) },
        { key: 'utilizationPct', label: 'Utilization', render: (value) => formatValue(value, 'percent') },
        { key: 'fieldCoverage', label: 'Supply / Debt / Cash Coverage', render: (value = {}) => ['suppliedUsd', 'borrowedUsd', 'availableLiquidityUsd'].map((key) => `${value[key]?.available ?? 0}/${value[key]?.eligible ?? 0}`).join(' · ') },
        { key: 'availability', label: 'State' },
        { key: 'source', label: 'Source', render: (value, row) => value ? <a href={value} target="_blank" rel="noreferrer">{row.sourceLabel || 'Source'} <ExternalLink size={13} /></a> : 'Unavailable' },
      ]} />
      <div className="filter-bar">
        <SlidersHorizontal size={16} />
        <label>Protocol<select value={protocol} onChange={(event) => setProtocol(event.target.value)} aria-label="Lending protocol filter"><option value="all">All protocols</option>{lending.protocols.map((row) => <option key={row.slug} value={row.slug}>{row.name}</option>)}</select></label>
        <label>Asset<input value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="e.g. USDC or AVAX" aria-label="Lending asset filter" /></label>
        <span>{markets.length} markets</span>
      </div>
      <DataTable title="Source and Eligibility Coverage" subtitle="Queried deployments are not necessarily eligible or priced. Tracked subtotals are not a complete Avalanche lending census." rows={lending.marketCoverage || []} metric="lending_market_size" onInfo={onInfo} columns={[
        { key: 'protocol', label: 'Deployment' },
        { key: 'discovered', label: 'Discovered' },
        { key: 'queried', label: 'Attempted' },
        { key: 'decodedMarketSides', label: 'Decoded', render: (value, row) => value ?? row.queried },
        { key: 'eligible', label: 'Eligible' },
        { key: 'priced', label: 'Priced' },
        { key: 'excluded', label: 'Excluded' },
        { key: 'availability', label: 'Coverage' },
        { key: 'rateCoverage', label: 'Supply / Borrow Rates', render: (value = {}) => ['supplyRatePct', 'borrowRatePct'].map((key) => value[key] ? `${value[key].available}/${value[key].eligible}` : 'Unavailable').join(' · ') },
        { key: 'limitation', label: 'Limitations', render: (value, row) => `${value || row.reason || row.sourceScope || row.scope || 'See source scope'}${row.failedConfigs?.length ? ` · ${row.failedConfigs.length} config requests failed` : ''}` },
        { key: 'sourceUrl', label: 'Source', render: (value, row) => value ? <a href={value} target="_blank" rel="noreferrer">{row.sourceLabel || 'Official source'} <ExternalLink size={13} /></a> : 'Unavailable' },
      ]} />
      <DataTable title="Current Lending Markets" subtitle={`${marketAvailability} · ordinary markets only; excluded claims are not included in tracked headlines`} rows={markets} metric="lending_rates" onInfo={onInfo} columns={[
        { key: 'protocol', label: 'Protocol', render: (value) => value.replaceAll('-', ' ') },
        { key: 'marketName', label: 'Market', render: (value, row) => value || row.name || row.symbol },
        { key: 'symbol', label: 'Asset' },
        { key: 'suppliedUsd', label: 'Supplied', render: (value) => formatValue(value) },
        { key: 'borrowedUsd', label: 'Borrowed', render: (value) => formatValue(value) },
        { key: 'netTvlUsd', label: 'Net TVL', render: (value) => formatValue(value) },
        { key: 'availableLiquidityUsd', label: 'Liquid Cash', render: (value) => formatValue(value) },
        { key: 'suppliedAssets', label: 'Native Supply', render: (value, row) => finite(value) ? `${compact.format(value)} ${row.symbol || ''}` : 'Unavailable' },
        { key: 'protectedAssets', label: 'Protected Collateral', render: (value, row) => finite(value) ? `${compact.format(value)} ${row.symbol || ''}` : '—' },
        { key: 'borrowableAssets', label: 'Borrowable Collateral', render: (value, row) => finite(value) ? `${compact.format(value)} ${row.symbol || ''}` : '—' },
        { key: 'includedInHeadline', label: 'Headline', render: (value, row) => value === false || row.eligible === false || row.visibility === 'hidden' ? 'Excluded / non-additive' : 'Tracked eligible' },
        { key: 'utilizationPct', label: 'Utilization', render: (value) => formatValue(value, 'percent') },
        { key: 'supplyRatePct', label: 'Supply Rate', render: (value) => formatValue(value, 'percent') },
        { key: 'incentiveApy', label: 'Incentive Rate', render: (value, row) => finite(value) ? `${formatValue(value, 'percent')} ${row.incentiveRateBasis || 'basis unreported'}` : 'Unavailable' },
        { key: 'borrowRatePct', label: 'Borrow Rate', render: (value) => formatValue(value, 'percent') },
        { key: 'rateBasis', label: 'Basis', render: (value) => value || 'APY' },
        { key: 'riskState', label: 'Risk', render: (value) => value || 'not classified' },
        { key: 'state', label: 'State', render: (value) => value || 'unknown' },
        { key: 'freshness', label: 'Freshness', render: (value, row) => value ? `${liveAgeSeconds(row) > (row.maxAgeSeconds || 900) ? 'stale' : value}${liveAgeSeconds(row) == null ? '' : ` · ${integer.format(liveAgeSeconds(row))}s`}` : 'adapter observation' },
        { key: 'sourceUrl', label: 'Source', render: (value, row) => value ? <a href={value} target="_blank" rel="noreferrer">{row.sourceLabel || row.rateSource || 'Official source'} <ExternalLink size={13} /></a> : row.rateSource || 'Unavailable' },
      ]} />
      <details className="panel impaired-markets">
        <summary><strong>Legacy / impaired markets</strong><span>{impairedMarkets.length} isolated markets · collapsed by default</span></summary>
        <CoverageNote title="Impaired accounting claims" detail="Large supplied and borrowed figures are on-chain accounting claims. They must not be treated as usable liquidity, ordinary TVL, headline totals, or cross-protocol opportunity rankings. Unknown cash, shortfall, bad debt, or redeemability remains Unavailable." />
        <DataTable title="Legacy / impaired market ledger" rows={impairedMarkets} metric="lending_rates" onInfo={onInfo} columns={[
          { key: 'status', label: 'Status', render: () => <span className="verification-badge review">Impaired / Legacy</span> },
          { key: 'marketName', label: 'Market' },
          { key: 'symbol', label: 'Asset' },
          { key: 'suppliedUsd', label: 'Supplied Claim', render: (value) => formatValue(value) },
          { key: 'borrowedUsd', label: 'Borrowed Claim', render: (value) => formatValue(value) },
          { key: 'underlyingCashUsd', label: 'Underlying Cash', render: (value) => formatValue(value) },
          { key: 'badDebtUsd', label: 'Bad Debt / Shortfall', render: (value, row) => formatValue(value ?? row.shortfallUsd) },
          { key: 'redeemability', label: 'Redeemability', render: (value) => value || 'Unavailable' },
          { key: 'observedAt', label: 'Last Observation', render: (value) => dateTimeLabel(value) },
          { key: 'explorerUrl', label: 'Evidence', render: (value, row) => <span>{value && <a href={value} target="_blank" rel="noreferrer">Explorer <ExternalLink size={13} /></a>}{row.registryUrl && <> · <a href={row.registryUrl} target="_blank" rel="noreferrer">Registry</a></>}</span> },
        ]} />
      </details>
      <div className="two-column">
        <ChartPanel title="Observed Daily Liquidation Events" subtitle={liquidationCoverageText} data={liquidationHistory} series={[{ key: 'events', name: 'Observed events' }]} range={range} custom={custom} type="bar" unit="events" metric="lending_liquidations" onInfo={onInfo} empty={liquidationHistory.length ? null : { title: `${liquidationAvailability}: no verified observations`, detail: liquidationCoverageText }} />
        <ChartPanel title="Observed Liquidated Debt" subtitle="Partial historical end-of-day USD estimates; not necessarily cash repaid. Missing prices remain unavailable." data={liquidationHistory} series={[{ key: 'debtRepaidUsd', name: 'Liquidated debt estimate' }]} range={range} custom={custom} type="bar" metric="lending_liquidations" onInfo={onInfo} empty={liquidationHistory.length ? null : { title: `${liquidationAvailability}: no valued observations`, detail: liquidationCoverageText }} />
      </div>
      {hasVaultInventory && <>
      <CoverageNote title="Factory vault accounting" detail={`${vaultAvailability} · ${lending.fixedBlock?.number ? `Observed block ${integer.format(lending.fixedBlock.number)}.` : 'No source block supplied.'} ${vaultCoverageText} Allocator vaults are non-additive to underlying lending markets.`} />
      <DataTable title="Active Factory Vault Ledger (Gross, Non-additive)" rows={vaultRows} metric="lending_vault_tvl" onInfo={onInfo} columns={[
        { key: 'protocol', label: 'Protocol', render: (value) => value.replaceAll('-', ' ') },
        { key: 'name', label: 'Vault', render: (value, row) => <span className="address-cell"><strong>{value}</strong><span>{row.assetSymbol}</span></span> },
        { key: 'totalAssets', label: 'Underlying Assets', render: (value, row) => finite(value) ? `${compact.format(value)} ${row.assetSymbol}` : 'Unavailable' },
        { key: 'grossAssetsUsd', label: 'Gross Assets', render: (value) => formatValue(value) },
        { key: 'borrowedUsd', label: 'Borrowed', render: (value) => formatValue(value) },
        { key: 'utilizationPct', label: 'Utilization', render: (value) => formatValue(value, 'percent') },
        { key: 'includedInHeadline', label: 'Headline Scope', render: (value) => value ? 'Included' : 'Excluded / test' },
        { key: 'address', label: 'Contract', render: (value) => <a href={`https://snowtrace.io/address/${value}`} target="_blank" rel="noreferrer">{value.slice(0, 8)}… <ExternalLink size={13} /></a> },
      ]} />
      </>}
      <CoverageNote title="Liquidation evidence" detail={liquidationCoverageText} />
      <DataTable title="Observed Liquidation Protocol Ledger · Partial Coverage" rows={liquidationProtocols} metric="lending_liquidations" onInfo={onInfo} columns={[
        { key: 'protocol', label: 'Deployment Family', render: (value) => value.replaceAll('-', ' ') },
        { key: 'events', label: 'Events', render: (value) => value == null ? 'Unavailable' : integer.format(value) },
        { key: 'pricedEvents', label: 'Valued Events', render: (value, row) => value == null || row.events == null ? 'Unavailable' : `${integer.format(value)}/${integer.format(row.events)}` },
        { key: 'debtRepaidUsd', label: 'Liquidated Debt Estimate', render: (value) => formatValue(value) },
        { key: 'state', label: 'Event Coverage', render: (value) => <span className={`confidence ${value === 'available' ? 'high' : 'low'}`}>{value}</span> },
      ]} />
    </>
  );
}

function verificationValue(value, unit) {
  if (!finite(value)) return 'Unavailable';
  if (unit === 'tokens') return compact.format(value);
  if (unit === 'addresses') return formatValue(value, 'address');
  return formatValue(value, unit);
}

function VerificationPage({ data, onInfo }) {
  const verification = data.quality.verification;
  const [category, setCategory] = useState('all');
  const categories = [...new Set(verification.checks.map((check) => check.category))];
  const checks = verification.checks.filter((check) => category === 'all' || check.category === category);
  const sourceCatalog = new Map(data.quality.sourceCatalog.sources.map((source) => [source.id, source]));
  return (
    <>
      <PageTitle
        title="Verification Desk"
        description="Scope-aware parity checks against RWA.xyz, Avalanche’s official Metrics API, DefiLlama companion endpoints, and independent market data."
        data={data}
      />
      <div className="kpi-grid four">
        <Kpi label="Scored Checks" value={verification.summary.scored} unit="contracts" icon={ShieldCheck} metric="cross_source_verification" onInfo={onInfo} />
        <Kpi label="Matched" value={verification.summary.pass} unit="contracts" note={`${decimal.format(verification.summary.passRatePct || 0)}% pass rate`} icon={Check} metric="cross_source_verification" onInfo={onInfo} />
        <Kpi label="Different Scope" value={verification.summary.context} unit="contracts" note="Shown, never graded" icon={Info} metric="cross_source_verification" onInfo={onInfo} />
        <Kpi label="Needs Review" value={verification.summary.review} unit="contracts" note={`${verification.summary.unavailable} unavailable`} icon={CircleAlert} metric="cross_source_verification" onInfo={onInfo} />
      </div>
      <CoverageNote title="Verification policy" detail={verification.policy.rule} />
      <CoverageNote title="Not covered by the scoped badge" detail={`${verification.policy.scopeDisclosure} Major excluded areas: ${verification.policy.excludedAreas.join(', ')}.`} />
      <div className="verification-filter" role="group" aria-label="Verification category">
        {['all', ...categories].map((item) => (
          <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
            {item === 'all' ? 'All checks' : item}
          </button>
        ))}
      </div>
      <section className="panel verification-ledger">
        <div className="panel-heading">
          <div>
            <h2>Metric evidence ledger <button className="info-button" onClick={() => onInfo('cross_source_verification')} aria-label="Methodology for Metric evidence ledger"><Info size={14} /></button></h2>
            <p>Comparator values never overwrite canonical dashboard metrics. Variance is graded only when scopes match.</p>
          </div>
          <span className="verification-ledger-count">{checks.length} records</span>
        </div>
        <div className="verification-rows">
          {checks.map((check) => (
            <article className={`verification-row ${check.status}`} key={check.id}>
              <div className="verification-row-title">
                <VerificationBadge status={check.status} />
                <div><strong>{check.label}</strong><span>{check.scope}</span></div>
              </div>
              <div className="verification-number">
                <span>{check.observed.label}</span>
                <strong>{verificationValue(check.observed.value, check.unit)}</strong>
              </div>
              <div className="verification-number">
                <span>{check.comparator.label}</span>
                <strong>{verificationValue(check.comparator.value, check.unit)}</strong>
              </div>
              <div className="verification-delta">
                <span>Variance</span>
                <strong>{finite(check.percentVariance) ? `${check.percentVariance >= 0 ? '+' : ''}${decimal.format(check.percentVariance)}%` : 'Not graded'}</strong>
                {finite(check.tolerancePct) && <small>limit ±{decimal.format(check.tolerancePct)}%</small>}
              </div>
              <div className="verification-source">
                <span>Evidence</span>
                <a href={check.comparator.url} target="_blank" rel="noreferrer">{check.comparator.sourceName} <ExternalLink size={12} /></a>
                <small>as of {check.comparator.sourceAsOf || 'unavailable'}</small>
              </div>
              <p>{check.note}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="two-column verification-support">
        <section className="panel">
          <div className="panel-heading"><div><h2>Verification source health</h2><p>Optional comparators do not degrade canonical dashboard freshness.</p></div></div>
          <div className="source-health-list">
            {data.quality.verificationSourceHealth.map((source) => {
              const catalog = sourceCatalog.get(source.id);
              return (
                <div key={source.id}>
                  <span className={`pulse ${source.ok ? 'healthy' : 'degraded'}`} />
                  <div><strong>{catalog?.name || source.id}</strong><small>{source.coverage}</small></div>
                  <span>{source.ok ? 'Available' : 'Degraded'}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel scope-card">
          <div className="panel-heading"><div><h2>Deliberate non-comparisons</h2><p>Different definitions are documented rather than treated as failed parity.</p></div></div>
          <ul>
            <li><strong>RWA universe:</strong> RWA.xyz’s all-Avalanche totals include a far broader asset set than the exact C-Chain contract basket.</li>
            <li><strong>Active addresses:</strong> Avalanche includes transfer-log participants; the Observatory counts transaction senders.</li>
            <li><strong>Deployments:</strong> Avalanche includes internal CREATE traces; the Observatory’s archive metric is top-level only.</li>
            <li><strong>DEX “24h”:</strong> DeFiLlama’s headline is the latest completed UTC bucket; current architecture rows are shown separately as partial-day data.</li>
          </ul>
        </section>
      </div>
    </>
  );
}

function CoverageNote({ title, detail }) {
  return <aside className="coverage-note"><CircleAlert size={17} /><div><strong>{title}</strong><p>{detail}</p></div></aside>;
}

function PageTitle({ title, description, data }) {
  return (
    <div className="page-title">
      <div><span className="eyebrow">AVALANCHE C-CHAIN</span><h1>{title}</h1><p>{description}</p></div>
      <div className="freshness"><span className={`pulse ${data.metadata.freshness === 'healthy' ? 'healthy' : 'degraded'}`} /><div><strong>{data.metadata.freshness === 'healthy' ? 'Audited snapshot current' : 'Snapshot coverage degraded'}</strong><span>Snapshot {new Date(data.generatedAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC</span></div></div>
    </div>
  );
}

function Timeframe({ range, setRange, custom, setCustom }) {
  const [calendar, setCalendar] = useState(false);
  const [draft, setDraft] = useState(custom);
  return (
    <>
      <div className="timeframe" role="group" aria-label="Global timeframe">
        {['7D', '14D', '30D', 'ALL'].map((item) => <button key={item} className={range === item ? 'active' : ''} onClick={() => setRange(item)}>{item}</button>)}
        <button className={range === 'CUSTOM' ? 'active' : ''} onClick={() => { setDraft(custom); setCalendar(true); }} aria-label="Custom date range"><CalendarDays size={15} /><span>{range === 'CUSTOM' ? `${custom.start} – ${custom.end}` : 'Custom'}</span></button>
      </div>
      {calendar && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCalendar(false)}>
          <div className="calendar-dialog" role="dialog" aria-modal="true" aria-label="Custom date range">
            <div className="dialog-title"><div><span>GLOBAL TIMEFRAME</span><h2>Custom date range</h2></div><button className="icon-button" onClick={() => setCalendar(false)} aria-label="Close custom date range"><X size={18} /></button></div>
            <label>Start date<input type="date" value={draft.start} max={draft.end} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
            <label>End date<input type="date" value={draft.end} min={draft.start} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
            <div className="dialog-actions"><button onClick={() => setDraft(custom)}>Reset</button><button onClick={() => { const today = new Date().toISOString().slice(0, 10); setDraft({ start: today, end: today }); }}>Today</button><button className="primary" onClick={() => { setCustom(draft); setRange('CUSTOM'); setCalendar(false); }}>Apply</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function MethodologyDialog({ id, metrics, onClose }) {
  const metric = metrics.find((item) => item.id === id);
  if (!metric) return null;
  const entries = [
    ['Exact definition', metric.definition],
    ['Formula', metric.formula],
    ['Unit', metric.unit],
    ['Included sources', metric.sources.join(', ')],
    ['Exclusions and limitations', metric.limitations],
    ['Update cadence', metric.cadence],
    ['Coverage start', metric.coverageStart],
    ['Confidence', metric.confidence],
  ];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="method-dialog" role="dialog" aria-modal="true" aria-labelledby="method-title">
        <div className="dialog-title"><div><span>METHODOLOGY</span><h2 id="method-title">{metric.label}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close methodology"><X size={18} /></button></div>
        <dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not available'}</dd></div>)}</dl>
      </div>
    </div>
  );
}

function SearchDialog({ data, onClose, setPage }) {
  const [query, setQuery] = useState('');
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => [
    ...PAGES.map((page) => ({ type: 'Page', title: page.label, detail: 'Dashboard section', page: page.id })),
    ...data.quality.protocolRegistry.protocols.map((protocol) => ({ type: 'Protocol', title: protocol.name, detail: `${protocol.category} · ${protocol.architecture}`, page: protocol.category === 'Lending' ? 'lending' : protocol.category === 'DEX' ? 'spot-trading' : 'overview' })),
    ...data.tokenizedAssets.assets.map((asset) => ({ type: 'Asset', title: `${asset.symbol} · ${asset.name}`, detail: asset.address, page: 'tokenized-assets', href: asset.explorer })),
    ...data.blockspace.topContracts.map((contract) => ({ type: 'Contract', title: contract.label || 'Unlabeled contract', detail: contract.address, page: 'blockspace', href: `https://snowtrace.io/address/${contract.address}` })),
  ], [data]);
  const results = query.length > 1 ? items.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20) : items.slice(0, 6);
  return (
    <div className="search-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search observatory">
        <div className="search-input"><Search size={20} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search protocols, assets, contracts, and pages" aria-label="Search observatory" /><button onClick={onClose} aria-label="Close search"><X size={18} /></button></div>
        <div className="search-results">
          {results.map((item, index) => (
            <button key={`${item.type}-${item.title}-${index}`} onClick={() => { setPage(item.page); onClose(); }}>
              <span>{item.type}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div>{item.href && <a href={item.href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink size={14} /></a>}
            </button>
          ))}
          {!results.length && <EmptyState title="No matching records" detail="Try a protocol, symbol, contract address, or dashboard section." />}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="loading-page"><div className="loading-header" /><div className="loading-kpis">{[1, 2, 3, 4].map((item) => <div key={item} />)}</div><div className="loading-chart" /></div>;
}

function App() {
  const initialPage = location.pathname.split('/').filter(Boolean).at(-1);
  const [page, setPageState] = useState(PAGES.some((item) => item.id === initialPage) ? initialPage : 'overview');
  const [range, setRange] = useState('30D');
  const [custom, setCustom] = useState({ start: utcDateOffset(-30), end: utcDateOffset(0) });
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [radar, setRadar] = useState(null);
  const [error, setError] = useState('');
  const [liveError, setLiveError] = useState('');
  const [method, setMethod] = useState(null);
  const [search, setSearch] = useState(false);

  const setPage = (next) => {
    setPageState(next);
    history.pushState({}, '', `${BASE}${next === 'overview' ? '' : next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const onPopState = () => {
      const next = location.pathname.split('/').filter(Boolean).at(-1);
      setPageState(PAGES.some((item) => item.id === next) ? next : 'overview');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const item = PAGES.find((candidate) => candidate.id === page);
    document.title = page === 'overview' ? 'Avalanche Ecosystem Analytics & DeFi Dashboard' : `${item?.label || 'Avalanche'} | Avalanche Ecosystem Observatory`;
  }, [page]);

  useEffect(() => {
    let active = true;
    const load = async (initial = false) => {
      try {
        let response = await fetch(`${BASE}api/dashboard`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (active) {
          setData(payload);
          setError('');
        }
      } catch (reason) {
        try {
          const response = await fetch(`${BASE}data/dashboard.json`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (active) setData(payload);
        } catch (fallbackError) {
          if (active && initial) setError(fallbackError.message || reason.message);
        }
      }
    };
    load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${BASE}api/radar`, { cache: 'no-store' });
        const payload = await response.json();
        if (active) setRadar(payload);
      } catch {
        if (active) setRadar((current) => current || { available: false, fresh: false, posture: 'unavailable', alerts: [], heartbeats: [] });
      }
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${BASE}api/live`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok && !payload.network) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
        if (active) {
          setLive(payload);
          setLiveError('');
        }
      } catch (reason) {
        if (active) setLiveError(reason.message);
      }
    };
    const onFocus = () => load();
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 12_000);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        setSearch(true);
      }
      if (event.key === 'Escape') {
        setSearch(false);
        setMethod(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (error) return <main className="fatal-error"><CircleAlert size={30} /><h1>Dashboard snapshot unavailable</h1><p>{error}</p><button onClick={() => location.reload()}>Retry</button></main>;
  if (!data) return <Loading />;

  const common = { data, live, radar, range, custom, onInfo: setMethod, setPage };
  const pages = {
    overview: <OverviewPage {...common} />,
    beginners: <BeginnersPage {...common} />,
    experts: <ExpertsPage {...common} />,
    governance: <GovernancePage {...common} />,
    unlocks: <UnlocksPage {...common} />,
    staking: <StakingPage {...common} />,
    blockspace: <BlockspacePage {...common} />,
    economics: <EconomicsPage {...common} />,
    'spot-trading': <SpotPage {...common} />,
    'tokenized-assets': <TokenizedPage {...common} />,
    lending: <LendingPage {...common} />,
    verification: <VerificationPage {...common} />,
  };

  return (
    <div className="app">
      <Header page={page} setPage={setPage} data={data} live={live} onSearch={() => setSearch(true)} />
      <main className="dashboard-main">
        {data.metadata.warnings?.length > 0 && <details className="quality-banner"><summary><CircleAlert size={16} /> {data.metadata.warnings.length} disclosed coverage limitations <ChevronDown size={14} /></summary><ul>{data.metadata.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
        {liveError && !live && <div className="live-error" role="status"><CircleAlert size={14} /> Live pulse unavailable; audited snapshot remains active.</div>}
        {pages[page]}
      </main>
      <footer><Logo /><span>Auditable Avalanche C-Chain analytics</span><a href={`${BASE}api/catalog`}>Metric catalog <ExternalLink size={12} /></a><span>Schema {data.schema}</span></footer>
      <Timeframe range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
      {method && <MethodologyDialog id={method} metrics={data.quality.metricCatalog.metrics} onClose={() => setMethod(null)} />}
      {search && <SearchDialog data={data} setPage={setPage} onClose={() => setSearch(false)} />}
    </div>
  );
}

export default App;
