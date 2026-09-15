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

function FunnelCard({ title, stages, total }) {
  const first = stages.find((s) => !s.isClosed) || stages[0];
  const base = first ? Math.max(1, first.count) : 1;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>
        {title}
        <span className="sub">{total.toLocaleString("pt-BR")} negócios</span>
      </h2>
      {stages.map((s) => (
        <div className="bar-row" key={s.bucket}>
          <div className="bar-label">{s.bucket}</div>
          <div className="bar-track">
            <div
              className={`bar-fill ${s.isClosed ? "closed" : ""}`}
              style={{ width: `${Math.min(100, (s.count / base) * 100)}%` }}
            />
          </div>
          <div className="bar-value">
            {s.count} ({total ? ((s.count / total) * 100).toFixed(0) : "0"}%)
          </div>
        </div>
      ))}
      {stages.length === 0 && <div className="empty-state">Nenhum negócio para este filtro.</div>}
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [channel, setChannel] = useState("google");
  const [campaign, setCampaign] = useState("__all__");
  const [month, setMonth] = useState("__all__");

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

  const campaignTotals = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.campaign, (map.get(r.campaign) || 0) + r.count);
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.month));
    return [...set].sort();
  }, [rows]);

  const totalDealsChannel = rows.reduce((s, r) => s + r.count, 0);

  // Reseta campanha/mês quando o canal muda, se o valor selecionado deixou de existir.
  useEffect(() => {
    if (campaign !== "__all__" && !campaignTotals.some((c) => c.name === campaign)) {
      setCampaign("__all__");
    }
    if (month !== "__all__" && !months.includes(month)) {
      setMonth("__all__");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const filteredRows = useMemo(() => {
    return rows.filter(
      (r) =>
        (campaign === "__all__" || r.campaign === campaign) &&
        (month === "__all__" || r.month === month)
    );
  }, [rows, campaign, month]);

  const filteredTotal = filteredRows.reduce((s, r) => s + r.count, 0);

  const monthlySeriesForCampaign = useMemo(() => {
    const base = campaign === "__all__" ? rows : rows.filter((r) => r.campaign === campaign);
    const map = new Map();
    for (const r of base) map.set(r.month, (map.get(r.month) || 0) + r.count);
    return months.map((m) => ({ month: m, count: map.get(m) || 0 }));
  }, [rows, months, campaign]);

  const maxMonthly = Math.max(1, ...monthlySeriesForCampaign.map((m) => m.count));

  const presalesRows = filteredRows.filter((r) => r.funnel === "presales");
  const salesRows = filteredRows.filter((r) => r.funnel === "sales");
  const otherRows = filteredRows.filter((r) => r.funnel === "other");

  const presalesStages = aggregateFunnel(presalesRows);
  const salesStages = aggregateFunnel(salesRows);
  const otherTotal = otherRows.reduce((s, r) => s + r.count, 0);

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
              <div className="value">{campaignTotals.length}</div>
              <div className="label">Campanhas distintas</div>
            </div>
            <div className="kpi">
              <div className="value">{filteredTotal.toLocaleString("pt-BR")}</div>
              <div className="label">
                Negócios no filtro atual
                {campaign !== "__all__" || month !== "__all__" ? (
                  <span className="badge">filtrado</span>
                ) : null}
              </div>
            </div>
            <div className="kpi">
              <div className="value">{campaignTotals[0] ? campaignTotals[0].name : "—"}</div>
              <div className="label">Campanha líder</div>
            </div>
          </div>

          <div className="filters">
            <div className="field">
              <label>Campanha</label>
              <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                <option value="__all__">Todas as campanhas</option>
                {campaignTotals.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.total})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Mês (True Data MQL) · cohort</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="__all__">Todos os meses</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid">
            <div className="card">
              <h2>
                Negócios por campanha
                <span className="sub">Clique em uma linha para filtrar</span>
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th style={{ textAlign: "right" }}>Negócios</th>
                    <th style={{ textAlign: "right" }}>% do total</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignTotals.map((c) => (
                    <tr
                      key={c.name}
                      className={`clickable ${campaign === c.name ? "selected" : ""}`}
                      onClick={() => setCampaign(campaign === c.name ? "__all__" : c.name)}
                    >
                      <td>{c.name}</td>
                      <td style={{ textAlign: "right" }}>{c.total}</td>
                      <td style={{ textAlign: "right" }}>
                        {totalDealsChannel ? ((c.total / totalDealsChannel) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                  ))}
                  {campaignTotals.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-state">
                        Nenhum negócio encontrado para este canal.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>
                Cohorts mensais
                <span className="sub">
                  {campaign === "__all__" ? "Todas as campanhas" : campaign}
                </span>
              </h2>
              {monthlySeriesForCampaign.map((m) => (
                <div className="bar-row" key={m.month}>
                  <div className="bar-label">{formatMonth(m.month)}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(m.count / maxMonthly) * 100}%` }}
                    />
                  </div>
                  <div className="bar-value">{m.count}</div>
                </div>
              ))}
              {monthlySeriesForCampaign.length === 0 && (
                <div className="empty-state">Sem dados mensais.</div>
              )}
            </div>
          </div>

          <div className="grid">
            <FunnelCard title="Funil Pré-vendas" stages={presalesStages} total={presalesRows.reduce((s, r) => s + r.count, 0)} />
            <FunnelCard title="Funil Vendas (Closer)" stages={salesStages} total={salesRows.reduce((s, r) => s + r.count, 0)} />
          </div>

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
