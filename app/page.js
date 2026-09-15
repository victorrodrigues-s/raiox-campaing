"use client";

import { useEffect, useMemo, useState } from "react";

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

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

export default function Page() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
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

  const rows = data && data.rows ? data.rows : [];

  const campaignTotals = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      map.set(r.campaign, (map.get(r.campaign) || 0) + r.count);
    }
    return [...map.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set(rows.map((r) => r.month));
    return [...set].sort();
  }, [rows]);

  const totalDealsAll = data ? data.totalDeals : 0;

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

  const pipelineFunnels = useMemo(() => {
    const byPipeline = new Map();
    for (const r of filteredRows) {
      if (!byPipeline.has(r.pipeline)) byPipeline.set(r.pipeline, new Map());
      const stageMap = byPipeline.get(r.pipeline);
      const key = r.stage;
      const prev = stageMap.get(key) || { count: 0, order: r.stageOrder, isClosed: r.isClosed };
      prev.count += r.count;
      stageMap.set(key, prev);
    }
    const out = [];
    for (const [pipeline, stageMap] of byPipeline.entries()) {
      const stages = [...stageMap.entries()]
        .map(([stage, v]) => ({ stage, ...v }))
        .sort((a, b) => a.order - b.order);
      const total = stages.reduce((s, st) => s + st.count, 0);
      out.push({ pipeline, stages, total });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [filteredRows]);

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Raio-X de Campanhas</h1>
          <p>
            Negócios com <strong>True Data MQL</strong> preenchido, atribuídos por{" "}
            <strong>first_click_utm_campaing</strong> do contato.
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
          <div className="kpis">
            <div className="kpi">
              <div className="value">{totalDealsAll.toLocaleString("pt-BR")}</div>
              <div className="label">Total de negócios (True Data MQL)</div>
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
              <label>Mês (True Data MQL)</label>
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
                        {totalDealsAll ? ((c.total / totalDealsAll) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                  ))}
                  {campaignTotals.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty-state">
                        Nenhum negócio encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>
                Evolução mensal
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

          <div className="card" style={{ marginTop: 16 }}>
            <h2>
              Funil de etapas do negócio
              <span className="sub">
                {campaign === "__all__" ? "Todas as campanhas" : campaign} ·{" "}
                {month === "__all__" ? "Todos os meses" : formatMonth(month)} · foto da etapa
                atual de cada negócio
              </span>
            </h2>
            {pipelineFunnels.map((pf) => {
              const first = pf.stages[0];
              const base = first ? Math.max(1, first.count) : 1;
              return (
                <div className="pipeline-block" key={pf.pipeline}>
                  <div className="pipeline-title">
                    {pf.pipeline} <span className="badge">{pf.total} negócios</span>
                  </div>
                  {pf.stages.map((s) => (
                    <div className="bar-row" key={s.stage}>
                      <div className="bar-label">{s.stage}</div>
                      <div className="bar-track">
                        <div
                          className={`bar-fill ${s.isClosed ? "closed" : ""}`}
                          style={{ width: `${(s.count / base) * 100}%` }}
                        />
                      </div>
                      <div className="bar-value">
                        {s.count} ({((s.count / (pf.total || 1)) * 100).toFixed(0)}%)
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            {pipelineFunnels.length === 0 && (
              <div className="empty-state">Nenhum negócio para este filtro.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
