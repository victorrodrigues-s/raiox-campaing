import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api.hubapi.com";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

// Cache em memória do processo (reseta em cold start — aceitável para uso interno).
let cache = { data: null, builtAt: 0 };

function getToken() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    throw new Error(
      "HUBSPOT_TOKEN não configurado. Adicione a variável de ambiente no projeto da Vercel (Settings > Environment Variables) com um Private App Access Token do HubSpot com escopo de leitura de crm.objects.deals e crm.objects.contacts."
    );
  }
  return token;
}

async function hsFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// 1) Todos os negócios com True Data MQL preenchido
async function fetchAllDeals() {
  const deals = [];
  let after;
  do {
    const body = {
      filterGroups: [
        { filters: [{ propertyName: "true_data_mql", operator: "HAS_PROPERTY" }] },
      ],
      properties: ["dealname", "dealstage", "pipeline", "true_data_mql", "createdate", "closedate"],
      limit: 200,
      ...(after ? { after } : {}),
    };
    const data = await hsFetch("/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    deals.push(...data.results);
    after = data.paging && data.paging.next ? data.paging.next.after : undefined;
  } while (after);
  return deals;
}

// 2) Contato principal de cada negócio (associação padrão deal -> contact)
async function fetchPrimaryContactIds(dealIds) {
  const map = {};
  const batches = [];
  for (let i = 0; i < dealIds.length; i += 1000) batches.push(dealIds.slice(i, i + 1000));

  await mapWithConcurrency(batches, 3, async (batch) => {
    const data = await hsFetch("/crm/v4/associations/deals/contacts/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs: batch.map((id) => ({ id: String(id) })) }),
    });
    for (const r of data.results || []) {
      const fromId = r.from && r.from.id;
      const to = r.to && r.to[0];
      if (fromId && to) map[fromId] = String(to.toObjectId);
    }
  });
  return map;
}

// 3) Campanha de primeiro clique de cada contato
async function fetchContactCampaigns(contactIds) {
  const map = {};
  const unique = [...new Set(contactIds)];
  const batches = [];
  for (let i = 0; i < unique.length; i += 100) batches.push(unique.slice(i, i + 100));

  await mapWithConcurrency(batches, 8, async (batch) => {
    const data = await hsFetch("/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: ["first_click_utm_campaing"],
        inputs: batch.map((id) => ({ id: String(id) })),
      }),
    });
    for (const r of data.results || []) {
      const v = r.properties && r.properties.first_click_utm_campaing;
      map[r.id] = v && v.trim() ? v.trim() : "(sem campanha)";
    }
  });
  return map;
}

// 4) Definição de pipelines/etapas (rótulos e ordem)
async function fetchPipelines() {
  const data = await hsFetch("/crm/v3/pipelines/deals");
  const map = {};
  for (const p of data.results || []) {
    const stages = {};
    for (const s of p.stages || []) {
      stages[s.id] = {
        label: s.label,
        order: s.displayOrder,
        isClosed: s.metadata && s.metadata.isClosed === "true",
      };
    }
    map[p.id] = { label: p.label, stages };
  }
  return map;
}

async function buildDashboard() {
  const deals = await fetchAllDeals();
  const dealIds = deals.map((d) => d.id);

  const [contactIdByDeal, pipelines] = await Promise.all([
    fetchPrimaryContactIds(dealIds),
    fetchPipelines(),
  ]);

  const contactIds = Object.values(contactIdByDeal);
  const campaignByContact = await fetchContactCampaigns(contactIds);

  // Linhas agregadas: campanha x mês x pipeline x etapa -> contagem
  const rowsMap = new Map();

  for (const d of deals) {
    const p = d.properties || {};
    const contactId = contactIdByDeal[d.id];
    const campaign = contactId ? campaignByContact[contactId] || "(sem campanha)" : "(sem contato associado)";
    const trueDataMql = p.true_data_mql; // "YYYY-MM-DD"
    const month = trueDataMql ? trueDataMql.slice(0, 7) : "(sem data)";
    const pipelineId = p.pipeline;
    const pipelineInfo = pipelines[pipelineId] || { label: pipelineId || "(sem pipeline)", stages: {} };
    const stageInfo = pipelineInfo.stages[p.dealstage] || { label: p.dealstage || "(sem etapa)", order: 999, isClosed: false };

    const key = [campaign, month, pipelineInfo.label, stageInfo.label].join("|||");
    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        campaign,
        month,
        pipeline: pipelineInfo.label,
        stage: stageInfo.label,
        stageOrder: stageInfo.order,
        isClosed: !!stageInfo.isClosed,
        count: 0,
      });
    }
    rowsMap.get(key).count += 1;
  }

  const rows = [...rowsMap.values()];
  const totalDeals = deals.length;

  return {
    generatedAt: new Date().toISOString(),
    totalDeals,
    rows,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    if (!forceRefresh && cache.data && Date.now() - cache.builtAt < CACHE_TTL_MS) {
      return NextResponse.json({ ...cache.data, cached: true });
    }

    const data = await buildDashboard();
    cache = { data, builtAt: Date.now() };
    return NextResponse.json({ ...data, cached: false });
  } catch (err) {
    return NextResponse.json({ error: String(err && err.message ? err.message : err) }, { status: 500 });
  }
}
