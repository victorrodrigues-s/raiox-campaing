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

// 3) Campanha e fonte de primeiro clique de cada contato
async function fetchContactAttrs(contactIds) {
  const map = {};
  const unique = [...new Set(contactIds)];
  const batches = [];
  for (let i = 0; i < unique.length; i += 100) batches.push(unique.slice(i, i + 100));

  await mapWithConcurrency(batches, 8, async (batch) => {
    const data = await hsFetch("/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      body: JSON.stringify({
        properties: ["first_click_utm_campaing", "first_click_utm_source"],
        inputs: batch.map((id) => ({ id: String(id) })),
      }),
    });
    for (const r of data.results || []) {
      const props = r.properties || {};
      const campaign = props.first_click_utm_campaing;
      const source = props.first_click_utm_source;
      map[r.id] = {
        campaign: campaign && campaign.trim() ? campaign.trim() : "(sem campanha)",
        source: source && source.trim() ? source.trim().toLowerCase() : "(sem source)",
      };
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

// Canais suportados: os demais valores de first_click_utm_source caem em "outro"
// e não aparecem como opção selecionável no dashboard.
function mapChannel(rawSource) {
  const s = (rawSource || "").toLowerCase();
  if (s.includes("google") || s.includes("adwords")) return "google";
  if (s.includes("facebook") || s.includes("fb") || s.includes("meta")) return "facebook";
  if (s.includes("linkedin")) return "linkedin";
  return "outro";
}

// Categoria do pipeline para fins de funil (pré-vendas / vendas / outro).
function pipelineCategory(pipelineLabel) {
  const l = (pipelineLabel || "").toLowerCase();
  if (l.includes("sdr inbound") || l.includes("bdr outbound")) return "presales-sdrbdr";
  if (l.includes("onfly gratuito") || l.includes("onfly grátis") || l.includes("onfly gratis")) return "presales-gratis";
  if (l.includes("closer")) return "sales-closer";
  return "other";
}

// Funil de pré-vendas simplificado: MQLs -> SQLs -> Onfly Grátis, com Lost à parte.
function presalesBucket(stageLabel) {
  const l = (stageLabel || "").trim().toLowerCase();
  if (["novos", "mqls", "conexão", "conexao"].includes(l)) return { bucket: "MQLs", order: 1, isClosed: false };
  if (["sql", "agendamentos"].includes(l)) return { bucket: "SQLs", order: 2, isClosed: false };
  if (l === "lost") return { bucket: "Lost", order: 4, isClosed: true };
  return { bucket: `Outro (${stageLabel})`, order: 90, isClosed: false };
}

// Funil de vendas simplificado: unifica todos os pipes "Closer".
function salesBucket(stageLabel) {
  const l = (stageLabel || "").trim().toLowerCase();
  if (["opportunity", "connection", "prospecting"].includes(l)) return { bucket: "Opportunity", order: 1, isClosed: false };
  if (l === "demo") return { bucket: "Demo", order: 2, isClosed: false };
  if (["proposal", "negotiation"].includes(l)) return { bucket: "Proposal", order: 3, isClosed: false };
  if (["closing", "signature"].includes(l)) return { bucket: "Closing", order: 4, isClosed: false };
  if (l === "implementation") return { bucket: "Implementation", order: 5, isClosed: false };
  if (l === "win") return { bucket: "Win", order: 6, isClosed: false };
  if (l === "lost") return { bucket: "Lost", order: 7, isClosed: true };
  return { bucket: `Outro (${stageLabel})`, order: 90, isClosed: false };
}

// Classifica um negócio num dos dois funis simplificados (ou "other" se não pertence a nenhum).
function classifyFunnel(pipelineLabel, stageLabel) {
  const cat = pipelineCategory(pipelineLabel);
  if (cat === "presales-sdrbdr") {
    return { funnel: "presales", ...presalesBucket(stageLabel) };
  }
  if (cat === "presales-gratis") {
    return { funnel: "presales", bucket: "Onfly Grátis", order: 3, isClosed: false };
  }
  if (cat === "sales-closer") {
    return { funnel: "sales", ...salesBucket(stageLabel) };
  }
  return { funnel: "other", bucket: stageLabel, order: 99, isClosed: false };
}

async function buildDashboard() {
  const deals = await fetchAllDeals();
  const dealIds = deals.map((d) => d.id);

  const [contactIdByDeal, pipelines] = await Promise.all([
    fetchPrimaryContactIds(dealIds),
    fetchPipelines(),
  ]);

  const contactIds = Object.values(contactIdByDeal);
  const attrsByContact = await fetchContactAttrs(contactIds);

  // Linhas agregadas: campanha x canal x mês x funil x bucket -> contagem
  const rowsMap = new Map();

  for (const d of deals) {
    const p = d.properties || {};
    const contactId = contactIdByDeal[d.id];
    const attrs = contactId ? attrsByContact[contactId] : null;
    const campaign = attrs ? attrs.campaign : "(sem contato associado)";
    const rawSource = attrs ? attrs.source : "(sem contato associado)";
    const channel = mapChannel(rawSource);
    const trueDataMql = p.true_data_mql; // "YYYY-MM-DD"
    const month = trueDataMql ? trueDataMql.slice(0, 7) : "(sem data)";
    const pipelineId = p.pipeline;
    const pipelineInfo = pipelines[pipelineId] || { label: pipelineId || "(sem pipeline)", stages: {} };
    const stageInfo = pipelineInfo.stages[p.dealstage] || { label: p.dealstage || "(sem etapa)", order: 999, isClosed: false };
    const cls = classifyFunnel(pipelineInfo.label, stageInfo.label);

    const key = [campaign, channel, month, cls.funnel, cls.bucket].join("|||");
    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        campaign,
        channel,
        rawSource,
        month,
        funnel: cls.funnel,
        bucket: cls.bucket,
        bucketOrder: cls.order,
        isClosed: !!cls.isClosed,
        pipeline: pipelineInfo.label,
        stage: stageInfo.label,
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
