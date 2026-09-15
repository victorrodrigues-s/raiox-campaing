# Raio-X de Campanhas — Onfly

## Deploy manual (Vercel)

1. Extraia o zip.
2. Rode `npm install` na pasta (opcional — a Vercel também instala sozinha).
3. Duas formas de subir:
   - **Vercel CLI**: `npx vercel --prod` dentro da pasta (faça login quando pedir).
   - **Import via Git**: suba a pasta para um repositório no GitHub e importe em vercel.com/new.
4. Depois do primeiro deploy, configure a variável de ambiente (ver seção abaixo) e faça um redeploy.


Dashboard que lê negócios do HubSpot (objeto DEAL) filtrados pela propriedade
`true_data_mql`, atribui cada negócio à campanha de primeiro clique do contato
associado (`first_click_utm_campaing`) e mostra: contagem de negócios por
campanha, funil das etapas do negócio e evolução mensal por campanha.

## Configuração necessária na Vercel

1. No projeto na Vercel, vá em **Settings → Environment Variables**.
2. Adicione `HUBSPOT_TOKEN` com um **Private App Access Token** do HubSpot
   (Settings → Integrations → Private Apps no HubSpot) com pelo menos os
   escopos de leitura:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
   - `crm.schemas.deals.read` (para ler nomes de pipeline/etapa)
3. Marque a variável para os ambientes **Production** e **Preview**.
4. Faça um redeploy (Deployments → ⋯ → Redeploy) para a variável entrar em vigor.

## Como funciona

- `GET /api/dashboard` busca todos os negócios com `true_data_mql` preenchido,
  resolve o contato principal de cada um, busca `first_click_utm_campaing`
  desse contato e agrega tudo por campanha × mês × pipeline × etapa.
- O resultado fica em cache em memória por 30 minutos; use o botão
  "Atualizar agora" na tela (ou `?refresh=1` na URL da API) para forçar uma
  releitura do HubSpot.
- O funil mostra a **foto da etapa atual** de cada negócio (não é uma
  cascata de "quem já passou por aqui") — mesma lógica simples de leitura
  usada nos outros relatórios do projeto.
