"use client";

import { useEffect, useMemo, useState } from "react";

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

const CHANNELS = [
  { key: "google", label: "Google" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
];

function formatMonth(key) {
  if (!key || key === "(sem data)") return key;
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return MONTH_FMT.format(d);
}

function formatDateTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function aggregateFunnel(rows) {
  const map = new Map();
  for (const r of rows) {
    const prev = map.get(r.bucket) || { count: 0, order: r.bucketOrder, isClosed: r.isClosed };
    prev.count += r.count;
    map.set(r.bucket, prev);
  }
  return [...map.entries()]
    .map(([bucket, v]) => ({ bucket, ...v }))
    .sort((a, b) => a.order - b.order);
}

// Classifica a cor de cada barra do funil: fluxo principal, perdido, ganho ou saída lateral.
function barKind(funnelType, bucket) {
  if (bucket === "Lost") return "lost";
  if (funnelType === "sales" && bucket === "Win") return "win";
  if (funnelType === "presales" && bucket === "Onfly Grátis") return "gratis";
  return "main";
}

function MiniFunnel({ title, funnelType, stages }) {
  const mainStage = stages.find((s) => barKind(funnelType, s.bucket) === "main") || stages[0];
  const base = mainStage ? Math.max(1, mainStage.count) : 1;
  return (
    <div className="mini-funnel">
      <div className="mini-funnel-title">{title}</div>
      {stages.map((s) => {
        const kind = barKind(funnelType, s.bucket);
        const pct = Math.max(s.count > 0 ? 8 : 4, Math.min(100, (s.count / base) * 100));
        return (
          <div className="pill-row" key={s.bucket}>
            <div className="pill-label">{s.bucket}</div>
            <div className="pill-track">
              <div className={`pill pill-${kind}`} style={{ width: `${pct}%` }}>
                {s.count > 0 ? s.count : ""}
              </div>
            </div>
          </div>
        );
      })}
      {stages.length === 0 && <div className="empty-state">Sem negócios.</div>}
    </div>
  );
}

function CampaignBox({ name, columns }) {
  return (
    <div className="campaign-box">
      <div className="campaign-box-title">{name}</div>
      <div className={`campaign-box-columns ${columns.length > 1 ? "compare" : ""}`}>
        {columns.map((col) => (
          <div className="campaign-box-column" key={col.key}>
            {col.label && <div className="campaign-box-column-label">{col.label}</div>}
            <MiniFunnel title="Pré-Vendas" funnelType="presales" stages={col.presales} />
            <MiniFunnel title="Vendas" funnelType="sales" stages={col.sales} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [channel, setChannel] = useState("google");
  const [compareMode, setCompareMode] = useState(false);
  const [month, setMonth] = useState("__all__");
  const [monthA, setMonthA] = useState("__all__");
  const [monthB, setMonthB] = useState("__all__");

  async function load(refresh) {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const res = await fetch(`/api/dashboard${refresh ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha ao carregar dados");
      setData(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  const allRows = data && data.rows ? data.rows : [];

  const channelTotals = useMemo(() => {
    const map = new Map();
    for (const r of allRows) map.set(r.channel, (map.get(r.channel) || 0) + r.count);
    return map;
  }, [allRows]);

  const rows = useMemo(() => allRows.filter((r) => r.channel === channel), [allRows, channel]);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.month));
    return [...set].sort();
  }, [rows]);

  // Ao trocar de mês inicializa os seletores de comparação com os dois meses mais recentes.
  useEffect(() => {
    if (months.length === 0) return;
    setMonthA((prev) => (months.includes(prev) ? prev : months[months.length - 2] || months[months.length - 1]));
    setMonthB((prev) => (months.includes(prev) ? prev : months[months.length - 1]));
    setMonth((prev) => (prev === "__all__" || months.includes(prev) ? prev : "__all__"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, months.length]);

  function rowsForCampaignMonth(campaignName, m) {
    return rows.filter((r) => r.campaign === campaignName && (m === "__all__" || r.month === m));
  }

  const campaignNames = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.campaign, (map.get(r.campaign) || 0) + r.count);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [rows]);

  const totalDealsChannel = rows.reduce((s, r) => s + r.count, 0);

  const scopedRows = useMemo(() => {
    if (compareMode) {
      return rows.filter((r) => r.month === monthA || r.month === monthB);
    }
    return rows.filter((r) => month === "__all__" || r.month === month);
  }, [rows, compareMode, month, monthA, monthB]);

  const otherTotal = scopedRows.filter((r) => r.funnel === "other").reduce((s, r) => s + r.count, 0);

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Raio-X de Campanhas</h1>
          <p>
            Negócios com <strong>True Data MQL</strong> preenchido, atribuídos por{" "}
            <strong>first_click_utm_campaing</strong> · canal por{" "}
            <strong>first_click_utm_source</strong>.
          </p>
        </div>
        <div className="meta">
          {data && (
            <>
              Atualizado em {formatDateTime(data.generatedAt)}
              {data.cached ? " (cache)" : ""}
              <button className="refresh-btn" onClick={() => load(true)} disabled={refreshing}>
                {refreshing ? "Atualizando…" : "Atualizar agora"}
              </button>
            </>
          )}
        </div>
      </div>

      {loading && <div className="loading">Carregando negócios do HubSpot…</div>}

      {error && (
        <div className="error-box">
          Não consegui carregar os dados.
          {"\n\n"}
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="channel-tabs">
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                className={`channel-tab ${channel === c.key ? "active" : ""}`}
                onClick={() => setChannel(c.key)}
              >
                {c.label}
                <span className="channel-tab-count">{(channelTotals.get(c.key) || 0).toLocaleString("pt-BR")}</span>
              </button>
            ))}
          </div>

          <div className="kpis">
            <div className="kpi">
              <div className="value">{totalDealsChannel.toLocaleString("pt-BR")}</div>
              <div className="label">Negócios em {CHANNELS.find((c) => c.key === channel)?.label}</div>
            </div>
            <div className="kpi">
              <div className="value">{campaignNames.length}</div>
              <div className="label">Campanhas distintas</div>
            </div>
          </div>

          <div className="filters">
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(e) => setCompareMode(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Comparar mês x mês
              </label>
            </div>

            {!compareMode && (
              <div className="field">
                <label>Mês de entrada (True Data MQL)</label>
                <select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="__all__">Todos os meses</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {formatMonth(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {compareMode && (
              <>
                <div className="field">
                  <label>Mês A</label>
                  <select value={monthA} onChange={(e) => setMonthA(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Mês B</label>
                  <select value={monthB} onChange={(e) => setMonthB(e.target.value)}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonth(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          <h2 className="section-title">Campanhas</h2>

          {campaignNames.map((name) => {
            const columns = compareMode
              ? [
                  {
                    key: "A",
                    label: formatMonth(monthA),
                    presales: aggregateFunnel(rowsForCampaignMonth(name, monthA).filter((r) => r.funnel === "presales")),
                    sales: aggregateFunnel(rowsForCampaignMonth(name, monthA).filter((r) => r.funnel === "sales")),
                  },
                  {
                    key: "B",
                    label: formatMonth(monthB),
                    presales: aggregateFunnel(rowsForCampaignMonth(name, monthB).filter((r) => r.funnel === "presales")),
                    sales: aggregateFunnel(rowsForCampaignMonth(name, monthB).filter((r) => r.funnel === "sales")),
                  },
                ]
              : [
                  {
                    key: "single",
                    label: null,
                    presales: aggregateFunnel(rowsForCampaignMonth(name, month).filter((r) => r.funnel === "presales")),
                    sales: aggregateFunnel(rowsForCampaignMonth(name, month).filter((r) => r.funnel === "sales")),
                  },
                ];
            return <CampaignBox key={name} name={name} columns={columns} />;
          })}

          {campaignNames.length === 0 && (
            <div className="empty-state">Nenhum negócio encontrado para este canal/mês.</div>
          )}

          {otherTotal > 0 && (
            <p className="note">
              {otherTotal.toLocaleString("pt-BR")} negócio(s) deste filtro estão em outros pipelines
              (Sucesso do Cliente, Integração, Afiliados etc.) e não entram nos funis acima.
            </p>
          )}
        </>
      )}
    </div>
  );
}
