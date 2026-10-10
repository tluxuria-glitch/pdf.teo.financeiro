"use strict";
/* Painel financeiro – Ponto dos Fogões Teófilo Otoni
   Roda 100% no navegador. Os dados ficam só nas planilhas do Google: o código não guarda
   nada no repositório e o token de acesso vive apenas na memória desta aba.
   Gravação: só células de entrada que já existem, sempre com confirmação e conferência. */
const CFG = window.CONFIG;
const MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const MESES_LONGO = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DIAS = ["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
const STATUS = ["Á pagar","AGENDADO SICOOB","AGENDADO PESSOAL","PAGO SICOOB","Pago via pix","pago boleto","DINHEIRO","Débito automático","cartão de Credito","PAGO EM ATRASO","ATRASADO","imprimir boleto","FIXA/MÊS"];
const BANCOS = ["SICOOB PJ","BANCO BRASIL","STONE","C6 BANK THASSIA","LOTÉRICA","SICOOB THASSIA","NUBANK PJ","NUBANK THASSIA"];
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
const S = { token: null, view: "hoje", vendas: {}, contas: {}, tabs: {vendas: {}, contas: {}}, pend: null, cart: null, filtro: "atrasadas", loaded: false };
let tokenClient = null, idleTimer = null;
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => typeof v === "number" ? v : 0;
const brl = v => "R$ " + (Math.round(v * 100) / 100).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const brl0 = v => "R$ " + Math.round(v).toLocaleString("pt-BR");
const colL = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);
const fromSerial = n => { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const fmtData = d => d ? String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") : "sem data";
const hoje = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const toNum = s => { if (typeof s === "number") return s; const t = String(s ?? "").trim().replace(/\s/g, "").replace(/^R\$/, ""); if (!t) return NaN; return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); };

/* ---------- Google: entrada e API ---------- */
function configurado() { return CFG.CLIENT_ID && !CFG.CLIENT_ID.startsWith("COLE_AQUI"); }
function toast(msg, ms = 4200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function resetIdle() { clearTimeout(idleTimer); if (S.token) idleTimer = setTimeout(() => sair("Você ficou parado e foi desconectado por segurança."), CFG.INATIVIDADE_MIN * 60000); }
["click", "keydown", "touchstart"].forEach(e => addEventListener(e, resetIdle, {passive: true}));
function sair(msg) {
  try { if (S.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(S.token, () => {}); } catch (e) {}
  S.token = null; S.loaded = false; S.vendas = {}; S.contas = {}; S.pend = null; S.cart = null;
  $("#nav").hidden = true; $("#dlg").open && $("#dlg").close(); telaLogin(msg);
}
function entrar() {
  if (!window.google?.accounts?.oauth2) { toast("O login do Google ainda está carregando. Tente de novo em instantes."); return; }
  tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({
    client_id: CFG.CLIENT_ID, scope: "https://www.googleapis.com/auth/spreadsheets",
    callback: r => { if (r.error) { toast("Entrada cancelada ou negada."); return; } S.token = r.access_token; resetIdle(); carregar(); }
  });
  tokenClient.requestAccessToken({prompt: ""});
}
async function api(path, opt = {}) {
  const r = await fetch(SHEETS + path, {...opt, headers: {Authorization: "Bearer " + S.token, "Content-Type": "application/json"}});
  if (r.status === 401) { sair("Sua sessão expirou. Entre de novo."); throw new Error("sessao"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ("Erro " + r.status));
  return j;
}
const q = (tab, rng) => "'" + tab.replace(/'/g, "''") + "'!" + rng;
async function lerFaixas(id, faixas) {
  const p = faixas.map(f => "ranges=" + encodeURIComponent(f)).join("&");
  const j = await api(id + "/values:batchGet?" + p + "&valueRenderOption=UNFORMATTED_VALUE");
  return j.valueRanges.map(v => v.values || []);
}
async function gravar(id, itens) { // itens: [{range, valor}] – só valores, nunca fórmulas
  return api(id + "/values:batchUpdate", {method: "POST", body: JSON.stringify({
    valueInputOption: "RAW", data: itens.map(i => ({range: i.range, values: [[i.valor]]}))})});
}

/* ---------- Carga e leitura das planilhas ---------- */
const norm = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function mesAno(nome) { // "AGOSTO/2026", "OUTUBRO.26", "JAN/27" -> {m:7,y:2026}
  const n = norm(nome), m = n.match(/^([A-Z]{3})[A-Z]*?(\d{2}|\d{4})$/); if (!m) return null;
  const i = MESES.indexOf(m[1]); if (i < 0) return null;
  return {m: i, y: m[2].length === 2 ? 2000 + +m[2] : +m[2]};
}
async function carregar() {
  $("#app").innerHTML = '<div class="login card"><h2>Carregando suas planilhas…</h2><p class="mut">Só leitura nesta etapa.</p></div>';
  try {
    const [mv, mc] = await Promise.all([
      api(CFG.VENDAS_ID + "?fields=sheets.properties(sheetId,title)"), api(CFG.CONTAS_ID + "?fields=sheets.properties(sheetId,title)")]);
    S.tabs.vendas = {}; mv.sheets.forEach(s => S.tabs.vendas[s.properties.title] = s.properties.sheetId);
    S.tabs.contas = {}; mc.sheets.forEach(s => S.tabs.contas[s.properties.title] = s.properties.sheetId);
    const vt = Object.keys(S.tabs.vendas).filter(t => MESES.includes(norm(t)));
    const ct = Object.keys(S.tabs.contas).map(t => ({t, ma: mesAno(t)})).filter(x => x.ma && new Date(x.ma.y, x.ma.m, 1) <= new Date(hoje().getFullYear(), hoje().getMonth() + 2, 1));
    const pendTab = Object.keys(S.tabs.contas).find(t => norm(t).startsWith("PENDENTES"));
    const cartTab = Object.keys(S.tabs.contas).find(t => norm(t).startsWith("VENCIMENTOSCART"));
    const [rv, rc, rp, rk] = await Promise.all([
      lerFaixas(CFG.VENDAS_ID, vt.map(t => q(t, "A1:T45"))),
      lerFaixas(CFG.CONTAS_ID, ct.map(x => q(x.t, "A1:H112"))),
      pendTab ? lerFaixas(CFG.CONTAS_ID, [q(pendTab, "A1:B20")]) : Promise.resolve([[]]),
      cartTab ? lerFaixas(CFG.CONTAS_ID, [q(cartTab, "A1:J25")]) : Promise.resolve([[]])]);
    S.vendas = {}; vt.forEach((t, i) => { const p = parseVendas(t, rv[i]); if (p) S.vendas[norm(t)] = p; });
    S.contas = {}; ct.forEach((x, i) => { const p = parseContas(x.t, x.ma, rc[i]); if (p) S.contas[x.ma.y * 100 + x.ma.m] = p; });
    S.pend = parsePend(rp[0], pendTab); S.cart = parseCart(rk[0]);
    S.loaded = true; $("#nav").hidden = false; render();
  } catch (e) { if (e.message !== "sessao") { $("#app").innerHTML = '<div class="login card verm"><h2>Não consegui abrir as planilhas</h2><p>' + esc(e.message) + '</p><p class="mut">Confira se você entrou com a conta que tem acesso às duas planilhas.</p><button class="btn" data-act="entrar">Tentar de novo</button></div>'; } }
}
function parseVendas(tab, g) {
  let hr = g.findIndex(r => r.some(c => typeof c === "string" && c.trim().toUpperCase() === "TOTAL-DIA")); if (hr < 0) return null;
  const c = {}; g[hr].forEach((v, i) => { const t = String(v ?? "").trim().toUpperCase();
    if (t === "DINHEIRO EM CAIXA") c.cx = i; else if (t === "DINHEIRO") c.din = i; else if (t === "CARTÃO" || t === "CARTAO") c.car = i;
    else if (t === "PIX") c.pix = i; else if (t === "OUTROS" || t.startsWith("TRANSFER")) c.out = i; else if (t === "TOTAL-DIA") c.tot = i;
    else if (t.startsWith("VALOR R")) c.sai = i; else if (t.startsWith("DESCRI")) c.desc = i; });
  const rows = [];
  for (let i = hr + 1; i < g.length; i++) {
    const r = g[i] || []; const sv = r[c.sai]; if (typeof sv === "string" && /total/i.test(sv)) break;
    const wd = r[3]; if (typeof wd !== "string") continue; const w = DIAS.find(d => d.slice(0, 3).toLowerCase() === wd.trim().slice(0, 3).toLowerCase()); if (!w) continue;
    const din = num(r[c.din]), car = num(r[c.car]), pix = num(r[c.pix]), out = num(r[c.out]);
    rows.push({r: i + 1, wd: w, dia: r[4], cx: r[c.cx], sai: num(r[c.sai]), desc: r[c.desc] || "", din, car, pix, out, tot: din + car + pix + out});
  }
  const mes = MESES.indexOf(norm(tab));
  return {tab, mes, c, rows, hr: hr + 1, dias: rows.filter(x => x.tot > 0).length, tot: sum(rows, "tot"), din: sum(rows, "din"), car: sum(rows, "car"), pix: sum(rows, "pix"), out: sum(rows, "out"), sai: sum(rows, "sai")};
}
const sum = (a, k) => a.reduce((s, x) => s + num(x[k]), 0);
function parseContas(tab, ma, g) {
  let fim = g.findIndex((r, i) => i > 8 && typeof r[1] === "string" && /^(A PAGAR|PAGAMENTOS EM DINHEIRO)/i.test(r[1].trim())); if (fim < 0) fim = Math.min(g.length, 90);
  const items = [], slots = [];
  for (let i = 9; i < fim; i++) {
    const r = g[i] || [], B = r[1], C = r[2];
    if (typeof B === "string" && B.trim() && typeof C === "number" && C > 0) {
      const F = typeof r[5] === "number" ? r[5] : 0, st = String(r[3] ?? "").trim();
      items.push({r: i + 1, tab, key: ma.y * 100 + ma.m, A: r[0], B: B.trim(), C, D: st, E: String(r[4] ?? ""), F, falta: Math.round((C - F) * 100) / 100, venc: vencimento(r[0], ma), dataFix: typeof r[0] === "number" && r[0] > 1000 && (fromSerial(r[0]).getMonth() !== ma.m || fromSerial(r[0]).getFullYear() !== ma.y), cat: catConta(B)});
    } else if ((B === undefined || B === "") && (C === undefined || C === "") && (r[5] === undefined || r[5] === "")) slots.push({r: i + 1, A: r[0]});
  }
  return {tab, ma, key: ma.y * 100 + ma.m, items, slots, a_pagar: sum(items, "C"), pago: sum(items, "F"), sheetId: S.tabs.contas[tab]};
}
function vencimento(a, ma) {
  if (typeof a === "number" && a > 1000) { const d = fromSerial(a); return (d.getMonth() === ma.m && d.getFullYear() === ma.y) ? d : new Date(ma.y, ma.m, Math.min(d.getDate(), new Date(ma.y, ma.m + 1, 0).getDate())); }
  if (typeof a === "number" && a >= 1 && a <= 31) return new Date(ma.y, ma.m, a);
  const m = String(a ?? "").match(/^(\d{1,2})/); return m ? new Date(ma.y, ma.m, +m[1]) : null;
}
function catConta(b) { b = String(b).toUpperCase();
  if (/SALARIO|SALÁRIO/.test(b)) return "Folha (salários e 13º)"; if (/\bDAS\b|DARF|FGTS|DAE|IMPOSTO/.test(b)) return "Impostos e encargos";
  if (/ALUGUEL/.test(b)) return "Aluguel"; if (/BDMG|EMPR[ÉE]STIMO|CART[ÃA]O/.test(b)) return "Dívidas e cartão";
  if (/UNIMED|MEDSENIOR|SA[ÚU]DE|VALE ALIM/.test(b)) return "Saúde e benefícios";
  if (/COPASA|CEMIG|VIVO|CLARO|PROTEJA|ESCRITA|LOCATTO|ATLAS|MODERNO|AVELAR/.test(b)) return "Contas fixas"; return "Fornecedores"; }
function parsePend(g, tab) {
  if (!g || !g.length) return null; let itens = 0, total = null;
  g.forEach(r => { const a = String(r[0] ?? "").trim().toUpperCase(), b = r[1]; if (a === "TOTAL") total = num(b); else if (a && typeof b === "number") itens += b; });
  return {itens, total, tab};
}
function parseCart(g) { if (!g || !g.length) return null; const p = [7, 8, 9].map(i => g.slice(4).reduce((s, r) => s + num(r[i]), 0)); return {p1: p[0], p2: p[1], p3: p[2]}; }

/* ---------- Situação das contas ---------- */
function situacao(it) {
  const h = hoje(); const pago = it.falta <= 0.005; if (pago) return {k: "verde", t: "Pago"};
  if (it.F > 0) return {k: "amar", t: "Falta " + brl(it.falta)};
  if (!it.venc) return {k: "azul", t: "Sem data"};
  const dias = Math.round((it.venc - h) / 864e5);
  if (dias < 0 && encerrada(it)) return {k: "roxo", t: "Conferir (mês encerrado)"};
  if (dias < 0) return {k: "verm", t: "Atrasada " + (-dias) + (dias === -1 ? " dia" : " dias")};
  if (dias === 0) return {k: "amar", t: "Vence hoje"}; if (dias <= 7) return {k: "amar", t: "Vence em " + dias + (dias === 1 ? " dia" : " dias")};
  return {k: "azul", t: "Dia " + fmtData(it.venc)};
}
const encerrada = it => new Date(it.key / 100 | 0, (it.key % 100) + 1, 0) < hoje();
const todasContas = () => Object.values(S.contas).flatMap(c => c.items);

/* ---------- Telas ---------- */
function telaLogin(msg) {
  $("#app").innerHTML = '<div class="login card azul"><h1>Painel financeiro</h1><p class="mut">Ponto dos Fogões · Teófilo Otoni</p>' +
    (msg ? '<p><b>' + esc(msg) + '</b></p>' : "") +
    (configurado() ? '<p>Entre com a sua conta Google. Os dados continuam só nas suas planilhas.</p><button class="btn" data-act="entrar">Entrar com Google</button>'
      : '<p><b>Falta uma configuração única.</b> Abra o arquivo <code>README.md</code> do repositório, siga a seção "Ligar ao Google" e cole o Client ID em <code>docs/config.js</code>.</p>') + '</div>';
}
const NAV = [["hoje", "Hoje"], ["vendas", "Vendas"], ["contas", "Contas"], ["analise", "Análise"], ["alertas", "Alertas"]];
function render() {
  if (!S.loaded) return;
  $("#nav").innerHTML = NAV.map(([k, t]) => '<button data-act="nav" data-v="' + k + '"' + (S.view === k ? ' aria-current="page"' : "") + '><i></i>' + t + (k === "alertas" && alertas().length ? " (" + alertas().length + ")" : "") + "</button>").join("");
  const v = {hoje: vHoje, vendas: vVendas, contas: vContas, analise: vAnalise, alertas: vAlertas}[S.view];
  $("#app").innerHTML = '<div class="top"><div><h1>' + NAV.find(n => n[0] === S.view)[1] + '</h1><small>' + hoje().toLocaleDateString("pt-BR", {weekday: "long", day: "numeric", month: "long"}) + '</small></div><div><button class="btn sec small" data-act="atualizar">Atualizar</button> <button class="btn sec small" data-act="sair">Sair</button></div></div>' + v();
  scrollTo(0, 0);
}
function linkAba(id, sheetId) { return "https://docs.google.com/spreadsheets/d/" + id + "/edit" + (sheetId !== undefined ? "#gid=" + sheetId : ""); }
function mesAtual() { const h = hoje(); return {y: h.getFullYear(), m: h.getMonth()}; }
function vHoje() {
  const its = todasContas(), h = hoje(), abertas = its.filter(i => i.falta > 0.005);
  const atras = abertas.filter(i => i.venc && i.venc < h && !encerrada(i)).sort((a, b) => b.venc - a.venc), conf = abertas.filter(encerrada);
  const sem = abertas.filter(i => i.venc && i.venc >= h && (i.venc - h) / 864e5 <= 7).sort((a, b) => a.venc - b.venc);
  const ma = mesAtual(), mv = S.vendas[MESES[ma.m]], hojeRow = mv?.rows.find(r => r.dia === h.getDate());
  const lancada = hojeRow && hojeRow.tot > 0, ck = S.contas[ma.y * 100 + ma.m];
  const mc = (c) => '<div class="row ' + situacao(c).k + '"><div class="t"><b>' + esc(c.B) + '</b><span class="mut">' + brl(c.falta) + " · " + fmtData(c.venc) + '</span></div><button class="btn verde small" data-act="baixa" data-k="' + c.key + '" data-r="' + c.r + '">Dar baixa</button></div>';
  let h1 = '<div class="grid">';
  h1 += '<div class="card ' + (atras.length ? "verm" : "verde") + '"><h3>Atrasadas</h3><div class="big">' + atras.length + '</div><div class="mut">' + brl(sum(atras, "falta")) + " em aberto</div>" + (atras.length ? '<p class="mut">Mais recentes primeiro. Veja todas na aba Contas.</p>' : "<p>Nada atrasado. Ótimo.</p>") + atras.slice(0, 4).map(mc).join("") + '<p><button class="btn sec small" data-act="verContas" data-f="atrasadas">Ver todas as atrasadas</button></p></div>';
  h1 += '<div class="card ' + (sem.length ? "amar" : "verde") + '"><h3>Vencem em 7 dias</h3><div class="big">' + sem.length + '</div><div class="mut">' + brl(sum(sem, "falta")) + " a pagar</div>" + sem.slice(0, 4).map(mc).join("") + '<p><button class="btn sec small" data-act="verContas" data-f="semana">Ver a semana</button></p></div>';
  h1 += '<div class="card ' + (lancada ? "verde" : "azul") + '"><h3>Venda de hoje</h3><div class="big">' + (lancada ? brl0(hojeRow.tot) : "Não lançada") + '</div><div class="mut">' + (lancada ? "Já está na planilha." : "Lance no fim do expediente.") + '</div><p><button class="btn" data-act="vendaHoje">' + (lancada ? "Conferir ou corrigir" : "Lançar venda de hoje") + "</button></p></div>";
  if (conf.length) h1 += '<div class="card roxo"><h3>A conferir: meses encerrados</h3><div class="big">' + conf.length + '</div><div class="mut">' + brl(sum(conf, "falta")) + ' ainda aparecem em aberto</div><p class="mut">Provavelmente já foram pagas e faltam baixas na planilha. Confirme uma a uma.</p><p><button class="btn sec small" data-act="verContas" data-f="conferir">Conferir agora</button></p></div>';
  if (ck) { const pct = ck.a_pagar ? Math.min(100, ck.pago / ck.a_pagar * 100) : 0, fat = mv ? mv.tot : 0;
    h1 += '<div class="card roxo"><h3>' + MESES_LONGO[ma.m] + ": contas</h3><div class=\"big\">" + brl0(ck.a_pagar - ck.pago) + '</div><div class="mut">falta pagar de ' + brl0(ck.a_pagar) + '</div><div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div><p class="mut">Vendido no mês até agora: ' + brl0(fat) + "</p></div>"; }
  return h1 + "</div>";
}
function vVendas() {
  const ma = mesAtual(); const sel = S.mesVenda ?? ma.m;
  const mv = S.vendas[MESES[sel]];
  let h = '<div class="chips">' + MESES.map((m, i) => S.vendas[m] ? '<button class="chip" aria-pressed="' + (i === sel) + '" data-act="mesVenda" data-m="' + i + '">' + m + "</button>" : "").join("") + "</div>";
  if (!mv) return h + "<p>Esse mês não existe na planilha.</p>";
  h += '<div class="grid"><div class="card azul"><div class="mut">Faturamento de ' + MESES_LONGO[sel] + '</div><div class="big">' + brl0(mv.tot) + '</div><div class="mut">' + mv.dias + " dias com venda · média " + brl0(mv.dias ? mv.tot / mv.dias : 0) + '</div></div>' +
    '<div class="card"><div class="mut">Cartão · PIX · Dinheiro</div><div class="big" style="font-size:22px">' + brl0(mv.car) + " · " + brl0(mv.pix) + " · " + brl0(mv.din) + '</div></div></div>';
  h += '<p><button class="btn" data-act="vendaDia" data-m="' + sel + '">Lançar ou corrigir um dia</button> <a class="btn sec" target="_blank" rel="noopener" href="' + linkAba(CFG.VENDAS_ID, S.tabs.vendas[mv.tab]) + '">Abrir a aba ' + esc(mv.tab) + " na planilha</a></p>";
  h += '<div class="scroll"><table><tr><th>Dia</th><th>Cartão</th><th>PIX</th><th>Dinheiro</th><th>Total</th></tr>' + mv.rows.filter(r => r.tot !== 0 || r.sai).map(r => '<tr><td>' + esc(r.wd.slice(0, 3)) + " " + esc(r.dia) + "</td><td>" + brl0(r.car) + "</td><td>" + brl0(r.pix) + "</td><td>" + brl0(r.din) + "</td><td><b>" + brl0(r.tot) + "</b></td></tr>").join("") + "</table></div>";
  return h;
}
function vContas() {
  const its = todasContas(), h = hoje(), f = S.filtro;
  const filtros = [["atrasadas", "Atrasadas"], ["conferir", "A conferir"], ["semana", "Próximos 7 dias"], ["mes", "Este mês"], ["abertas", "Em aberto"], ["pagas", "Pagas"], ["todas", "Todas"]];
  const ma = mesAtual(); const lista = its.filter(i => {
    const s = situacao(i).k; const aberta = i.falta > 0.005;
    return f === "atrasadas" ? aberta && s === "verm" && !encerrada(i) : f === "conferir" ? aberta && encerrada(i) : f === "semana" ? aberta && i.venc && i.venc >= h && (i.venc - h) / 864e5 <= 7 : f === "mes" ? i.key === ma.y * 100 + ma.m : f === "abertas" ? aberta : f === "pagas" ? !aberta : true;
  }).sort((a, b) => (a.venc || 0) - (b.venc || 0));
  let o = '<div class="chips">' + filtros.map(([k, t]) => '<button class="chip" aria-pressed="' + (f === k) + '" data-act="filtro" data-f="' + k + '">' + t + "</button>").join("") + '</div><p><button class="btn" data-act="novaConta">Nova conta</button> ';
  o += Object.values(S.contas).sort((a, b) => a.key - b.key).slice(0, 5).map(c => '<a class="btn sec small" target="_blank" rel="noopener" href="' + linkAba(CFG.CONTAS_ID, c.sheetId) + '">' + MESES[c.ma.m] + "/" + String(c.ma.y).slice(2) + "</a>").join(" ") + "</p>";
  o += '<p class="mut">' + lista.length + " contas · " + brl(sum(lista, "falta")) + " em aberto neste filtro</p>";
  o += lista.slice(0, 60).map(c => { const s = situacao(c); return '<div class="row ' + s.k + '"><div class="t"><b>' + esc(c.B) + '</b><span class="mut">' + brl(c.C) + " · vence " + fmtData(c.venc) + " · " + MESES[c.key % 100] + '</span><br><span class="pill ' + s.k + '">' + esc(s.t) + "</span> " + (c.D ? '<span class="mut">' + esc(c.D) + "</span>" : "") + '</div><div>' + (c.falta > 0.005 ? '<button class="btn verde small" data-act="baixa" data-k="' + c.key + '" data-r="' + c.r + '">Dar baixa</button> ' : "") + '<button class="btn sec small" data-act="editar" data-k="' + c.key + '" data-r="' + c.r + '">Editar</button></div></div>'; }).join("");
  if (lista.length > 60) o += '<p class="mut">Mostrando as 60 primeiras. Use os filtros para afunilar.</p>';
  return o || "<p>Nada por aqui.</p>";
}
/* gráfico de barras em SVG, sem bibliotecas */
function bars(o) {
  const W = 640, H = 280, hor = !!o.horizontal, L = hor ? 150 : 46, R = 12, T = 12, B = hor ? 22 : 28, n = o.labels.length, S_ = o.series, st = !!o.stacked;
  const tots = o.labels.map((_, i) => st ? S_.reduce((a, s) => a + (s.data[i] || 0), 0) : Math.max(...S_.map(s => s.data[i] || 0)));
  const mx = Math.max(...tots, o.ref || 0, 1) * 1.08, pw = W - L - R, ph = H - T - B, sc = v => hor ? v / mx * pw : v / mx * ph;
  const fm = v => v >= 1000 ? (v / 1000).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + " mil" : Math.round(v);
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = mx * k / 4; if (hor) { const x = L + v / mx * pw; g += `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + ph}" stroke="var(--bd)"/><text x="${x}" y="${H - 6}" font-size="11" fill="var(--mut)" text-anchor="middle">${fm(v)}</text>`; } else { const y = T + ph - v / mx * ph; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--bd)"/><text x="${L - 6}" y="${y + 4}" font-size="11" fill="var(--mut)" text-anchor="end">${fm(v)}</text>`; } }
  const bw = (hor ? ph : pw) / n, gw = bw * .74, ns = st ? 1 : S_.length;
  o.labels.forEach((lb, i) => { let acc = 0; S_.forEach((s, j) => { const v = s.data[i] || 0, len = sc(v), col = s.colors?.[i] || s.color, off = bw * .13 + (st ? 0 : j * gw / ns), th = gw / ns;
      g += hor ? `<rect x="${L + (st ? sc(acc) : 0)}" y="${T + i * bw + off}" width="${len}" height="${th}" rx="3" fill="${col}"><title>${esc(lb)} · ${esc(s.name)}: ${brl0(v)}</title></rect>` : `<rect x="${L + i * bw + off}" y="${T + ph - (st ? sc(acc) : 0) - len}" width="${th}" height="${len}" rx="3" fill="${col}"><title>${esc(lb)} · ${esc(s.name)}: ${brl0(v)}</title></rect>`; acc += v; });
    g += hor ? `<text x="${L - 8}" y="${T + i * bw + bw / 2 + 4}" font-size="12" fill="var(--mut)" text-anchor="end">${esc(lb.length > 22 ? lb.slice(0, 21) + "…" : lb)}</text>` : `<text x="${L + i * bw + bw / 2}" y="${H - 8}" font-size="12" fill="var(--mut)" text-anchor="middle">${esc(lb)}</text>`; });
  if (o.ref && !hor) { const y = T + ph - o.ref / mx * ph; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--tx)" stroke-dasharray="6 5"/><text x="${W - R}" y="${y - 5}" font-size="11" fill="var(--tx)" text-anchor="end">${esc(o.refLabel || "")}</text>`; }
  const lg = S_.length > 1 ? '<div class="lg">' + S_.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>").join("") + "</div>" : "";
  return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.alt || "gráfico") + '">' + g + "</svg>" + lg;
}
function vAnalise() {
  const ms = MESES.filter(m => S.vendas[m] && S.vendas[m].tot > 0), V = m => S.vendas[m];
  const cheios = ms.filter(m => V(m).dias >= 15), media = cheios.length ? cheios.reduce((a, m) => a + V(m).tot, 0) / cheios.length : 0;
  const ult = cheios[cheios.length - 1], pen = cheios[cheios.length - 2];
  let h = '<div class="grid"><div class="card azul"><div class="mut">Faturamento no ano (meses lançados)</div><div class="big">' + brl0(ms.reduce((a, m) => a + V(m).tot, 0)) + '</div></div>';
  if (ult && pen) h += '<div class="card ' + (V(ult).tot < V(pen).tot ? "verm" : "verde") + '"><div class="mut">' + ult + " contra " + pen + '</div><div class="big">' + ((V(ult).tot / V(pen).tot - 1) * 100).toFixed(1).replace(".", ",") + '%</div><div class="mut">' + brl0(V(ult).tot) + " contra " + brl0(V(pen).tot) + "</div></div>";
  h += "</div>";
  h += '<div class="card" style="margin-top:14px"><h3>Faturamento por mês</h3>' + bars({labels: ms, alt: "Faturamento por mês", series: [{name: "Faturamento", color: "#94a3b8", colors: ms.map(m => m === ult ? "#2563eb" : "#94a3b8"), data: ms.map(m => V(m).tot)}], ref: media, refLabel: "média dos meses cheios"}) + '<p class="mut">Destaque em azul: último mês completo. Meses com menos de 15 dias lançados não entram na média.</p></div>';
  h += '<div class="card" style="margin-top:14px"><h3>Por forma de pagamento</h3>' + bars({labels: ms, stacked: true, alt: "Forma de pagamento", series: [["din", "Dinheiro", "#94a3b8"], ["car", "Cartão", "#2563eb"], ["pix", "PIX", "#16a34a"], ["out", "Outros", "#7c3aed"]].map(([k, n, c]) => ({name: n, color: c, data: ms.map(m => V(m)[k])}))}) + "</div>";
  const ck = Object.values(S.contas).sort((a, b) => a.key - b.key), cats = [...new Set(ck.flatMap(c => c.items.map(i => i.cat)))];
  const pal = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2"];
  if (ck.length) h += '<div class="card" style="margin-top:14px"><h3>Contas a pagar por mês</h3>' + bars({labels: ck.map(c => MESES[c.ma.m] + "/" + String(c.ma.y).slice(2)), stacked: true, alt: "Contas por mês", series: cats.map((c, i) => ({name: c, color: pal[i % pal.length], data: ck.map(x => sum(x.items.filter(it => it.cat === c), "C"))}))}) + '<div class="scroll"><table><tr><th>Mês</th><th>A pagar</th><th>Pago</th><th>Falta</th></tr>' + ck.map(c => "<tr><td>" + MESES[c.ma.m] + "/" + String(c.ma.y).slice(2) + "</td><td>" + brl0(c.a_pagar) + "</td><td>" + brl0(c.pago) + "</td><td>" + brl0(c.a_pagar - c.pago) + "</td></tr>").join("") + "</table></div></div>";
  return h;
}
function alertas() {
  const a = [], h = hoje();
  Object.values(S.contas).forEach(c => { const fim = new Date(c.ma.y, c.ma.m + 1, 0); const aberto = c.a_pagar - c.pago; if (fim < h && aberto > 1) a.push({k: "verm", t: MESES_LONGO[c.ma.m] + " já acabou e ainda mostra " + brl0(aberto) + " em aberto. Dê baixa no que foi pago ou confirme o que está atrasado."}); });
  todasContas().forEach(i => { if (/^pago/i.test(i.D) && i.F === 0) a.push({k: "amar", t: '"' + i.B + '" (' + MESES[i.key % 100] + ') está como "' + i.D + '" mas sem valor pago.'}); });
  const df = todasContas().filter(i => i.dataFix).length; if (df) a.push({k: "azul", t: df + " contas têm data de outro mês (cópia de aba). Usei o mês da aba, mas vale corrigir a data na planilha."});
  if (S.pend && S.pend.total !== null && Math.abs(S.pend.itens - S.pend.total) > 0.01) a.push({k: "amar", t: "Pendentes: os itens somam " + brl(S.pend.itens) + " mas o total da planilha mostra " + brl(S.pend.total) + "."});
  const y = h.getFullYear(); for (let m = 0; m <= h.getMonth(); m++) if (m > 0 && !S.contas[y * 100 + m] && m >= 7) a.push({k: "azul", t: "A planilha de contas a pagar não tem a aba de " + MESES_LONGO[m] + "."});
  Object.values(S.vendas).forEach(v => { if (v.rows.some(r => r.din < 0)) a.push({k: "amar", t: "Em " + MESES[v.mes] + " há venda em dinheiro negativa. Pode ser estorno ou erro de digitação."}); });
  return a;
}
function vAlertas() {
  const a = alertas(); let h = a.length ? "" : '<div class="card verde"><h3>Tudo certo</h3><p>Nenhum alerta agora.</p></div>';
  h += a.map(x => '<div class="row ' + x.k + '"><div class="t">' + esc(x.t) + "</div></div>").join("");
  if (S.pend) h += '<div class="card roxo" style="margin-top:14px"><h3>Pendentes de pagamento</h3><div class="big">' + brl0(S.pend.itens) + "</div></div>";
  if (S.cart) h += '<div class="card roxo" style="margin-top:14px"><h3>Cartões: previsão por parcela</h3><p>1ª: ' + brl0(S.cart.p1) + " · 2ª: " + brl0(S.cart.p2) + " · 3ª: " + brl0(S.cart.p3) + "</p></div>";
  h += '<p><a class="btn sec" target="_blank" rel="noopener" href="' + linkAba(CFG.VENDAS_ID) + '">Planilha de vendas</a> <a class="btn sec" target="_blank" rel="noopener" href="' + linkAba(CFG.CONTAS_ID) + '">Contas a pagar</a></p>';
  return h;
}

/* ---------- Gravação segura ---------- */
const dlg = () => $("#dlg");
function abrirDlg(html) { dlg().innerHTML = html; if (!dlg().open) dlg().showModal(); }
function fechar() { dlg().open && dlg().close(); }
const campo = (id, rot, val = "", tipo = "text", extra = "") => '<label for="' + id + '">' + rot + '</label><input id="' + id + '" type="' + tipo + '" value="' + esc(val) + '" ' + extra + ">";
const lista = (id, rot, ops, val) => '<label for="' + id + '">' + rot + '</label><select id="' + id + '"><option value="">(deixar como está)</option>' + ops.map(o => '<option' + (o.toLowerCase() === String(val).trim().toLowerCase() ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
const lerCampo = id => $("#" + id)?.value.trim() ?? "";

function formVenda(mesIdx, dia) {
  const mv = S.vendas[MESES[mesIdx]]; if (!mv) return;
  const hoje_ = hoje(); dia = dia ?? (mesIdx === hoje_.getMonth() ? hoje_.getDate() : 1);
  const lin = mv.rows.find(r => r.dia === dia);
  if (!lin) { abrirDlg('<h2>Dia não encontrado</h2><p>Não achei o dia ' + dia + " na aba " + esc(mv.tab) + '.</p><button class="btn" data-act="fechar">Fechar</button>'); return; }
  const ant = mv.rows[mv.rows.indexOf(lin) - 1], cxAnt = ant && typeof ant.cx === "number" ? ant.cx : null;
  S.edit = {tipo: "venda", mesIdx, lin, mv};
  abrirDlg('<h2>Venda de ' + esc(lin.wd) + ", " + dia + " de " + MESES_LONGO[mesIdx] + '</h2><p class="mut">Deixe em branco o que não mudou. Só gravo o que você preencher.</p>' +
    '<div class="f2">' + campo("v_dia", "Dia do mês", dia, "number", 'min="1" max="31" data-act2="trocaDia"') +
    campo("v_cx", "Dinheiro em caixa no fechamento (R$)", typeof lin.cx === "number" ? String(lin.cx).replace(".", ",") : "", "text", 'inputmode="decimal"') +
    campo("v_car", "Cartão (R$)", lin.car || "", "text", 'inputmode="decimal"') + campo("v_pix", "PIX (R$)", lin.pix || "", "text", 'inputmode="decimal"') +
    campo("v_out", "Outros (R$)", lin.out || "", "text", 'inputmode="decimal"') + campo("v_sai", "Saída de dinheiro do caixa (R$)", lin.sai || "", "text", 'inputmode="decimal"') + "</div>" +
    campo("v_desc", "Descrição das saídas (compras, boletos, depósito)", lin.desc || "") +
    '<p class="mut" id="v_prev"></p><p><button class="btn" data-act="revisarVenda">Revisar antes de gravar</button> <button class="btn sec" data-act="fechar">Cancelar</button></p>');
  S.edit.cxAnt = cxAnt; prevVenda();
}
function prevVenda() {
  const e = S.edit; if (!e || e.tipo !== "venda" || !$("#v_prev")) return;
  const cx = toNum(lerCampo("v_cx")), sai = toNum(lerCampo("v_sai") || "0"), car = toNum(lerCampo("v_car") || "0"), pix = toNum(lerCampo("v_pix") || "0"), out = toNum(lerCampo("v_out") || "0");
  const din = isNaN(cx) || e.cxAnt === null ? null : cx + (isNaN(sai) ? 0 : sai) - e.cxAnt;
  $("#v_prev").innerHTML = din === null ? "O dinheiro vendido é calculado pela própria planilha." : "Dinheiro vendido (calculado): <b>" + brl(din) + "</b> · Total do dia: <b>" + brl(din + (car || 0) + (pix || 0) + (out || 0)) + "</b>";
}
async function revisarVenda() {
  const e = S.edit, c = e.mv.c, tab = e.mv.tab, r = e.lin.r;
  const mapa = [["v_cx", c.cx, "Dinheiro em caixa", e.lin.cx], ["v_sai", c.sai, "Saída de dinheiro", e.lin.sai || ""], ["v_desc", c.desc, "Descrição", e.lin.desc], ["v_car", c.car, "Cartão", e.lin.car || ""], ["v_pix", c.pix, "PIX", e.lin.pix || ""], ["v_out", c.out, "Outros", e.lin.out || ""]];
  const itens = [];
  for (const [id, col, nome, antes] of mapa) {
    const t = lerCampo(id); if (t === "") continue; if (col === undefined) { toast("Não achei a coluna de " + nome + " nesta aba."); return; }
    const texto = id === "v_desc"; const val = texto ? t : toNum(t);
    if (!texto && isNaN(val)) { toast('Valor inválido em "' + nome + '".'); return; }
    if (!texto && Math.abs(val) > 500000) { toast('Valor muito alto em "' + nome + '". Confira.'); return; }
    if (val === antes || (!texto && Number(antes) === val)) continue;
    itens.push({range: q(tab, colL(col) + r), valor: val, nome, antes: antes === undefined ? "" : antes});
  }
  if (!itens.length) { toast("Nada mudou."); return; }
  confirmar(CFG.VENDAS_ID, itens, "Venda de " + e.lin.wd + " " + e.lin.dia + "/" + (e.mesIdx + 1));
}
function formConta(key, r, modo) { // modo: "baixa" | "editar" | "nova"
  const c = S.contas[key]; if (!c) return;
  let it = modo === "nova" ? null : c.items.find(x => x.r === r);
  if (modo === "nova") { const s = c.slots[0]; if (!s) { abrirDlg('<h2>Sem linha livre</h2><p>A aba de ' + MESES_LONGO[c.ma.m] + ' não tem mais linhas vazias. Abra a planilha e crie a linha lá; não altero a estrutura.</p><button class="btn" data-act="fechar">Fechar</button>'); return; } it = {r: s.r, A: s.A, B: "", C: "", D: "Á pagar", E: "SICOOB PJ", F: 0, venc: null, tab: c.tab, key}; }
  S.edit = {tipo: "conta", modo, key, it, c};
  const venc = it.venc ? it.venc.getFullYear() + "-" + String(it.venc.getMonth() + 1).padStart(2, "0") + "-" + String(it.venc.getDate()).padStart(2, "0") : "";
  const baixa = modo === "baixa";
  abrirDlg("<h2>" + (modo === "nova" ? "Nova conta em " + MESES_LONGO[c.ma.m] : baixa ? "Dar baixa: " + esc(it.B) : "Editar: " + esc(it.B)) + '</h2><p class="mut">' + (modo === "nova" ? "Vai para a próxima linha vazia (linha " + it.r + "). Não crio linhas novas." : "Linha " + it.r + ". Só mudo o que você alterar.") + "</p>" +
    '<div class="f2">' + (modo === "nova" ? campo("c_b", "Fornecedor ou conta", "") : "") + campo("c_c", "Valor a pagar (R$)", modo === "nova" ? "" : String(it.C).replace(".", ","), "text", 'inputmode="decimal"') +
    campo("c_a", "Vencimento", venc, "date") + campo("c_f", "Valor pago (R$)", baixa ? String(it.falta > 0 ? it.C : it.F).replace(".", ",") : (it.F ? String(it.F).replace(".", ",") : ""), "text", 'inputmode="decimal"') +
    lista("c_d", "Situação", STATUS, baixa && !/pago|débito/i.test(it.D) ? "PAGO SICOOB" : it.D) + lista("c_e", "Pago por", BANCOS, it.E) + "</div>" +
    '<p><button class="btn" data-act="revisarConta">Revisar antes de gravar</button> <button class="btn sec" data-act="fechar">Cancelar</button></p>');
}
function revisarConta() {
  const e = S.edit, it = e.it, tab = e.c.tab, itens = [], R = it.r;
  const add = (col, nome, valor, antes) => { if (valor !== antes && !(typeof valor === "number" && Number(antes) === valor)) itens.push({range: q(tab, col + R), valor, nome, antes: antes ?? ""}); };
  if (e.modo === "nova") { const b = lerCampo("c_b"); if (!b) { toast("Informe o fornecedor."); return; } add("B", "Fornecedor", b, ""); }
  const c = lerCampo("c_c"), f = lerCampo("c_f"), a = lerCampo("c_a"), d = lerCampo("c_d"), ee = lerCampo("c_e");
  if (c !== "") { const v = toNum(c); if (isNaN(v) || v < 0 || v > 500000) { toast("Valor a pagar inválido."); return; } add("C", "Valor a pagar", v, e.modo === "nova" ? "" : it.C); }
  else if (e.modo === "nova") { toast("Informe o valor a pagar."); return; }
  if (f !== "") { const v = toNum(f); if (isNaN(v) || v < 0 || v > 500000) { toast("Valor pago inválido."); return; } add("F", "Valor pago", v, it.F || ""); }
  if (a) { const [y, m, dd] = a.split("-").map(Number), nv = serial(new Date(y, m - 1, dd)); const antes = e.modo === "nova" ? (it.A ?? "") : (typeof it.A === "number" && it.A > 1000 ? it.A : it.venc ? serial(it.venc) : ""); add("A", "Vencimento (data)", nv, antes); }
  if (d) add("D", "Situação", d, e.modo === "nova" ? "" : it.D); if (ee) add("E", "Pago por", ee, e.modo === "nova" ? "" : it.E);
  if (!itens.length) { toast("Nada mudou."); return; }
  confirmar(CFG.CONTAS_ID, itens, (e.modo === "nova" ? "Nova conta" : e.modo === "baixa" ? "Baixa" : "Edição") + ": " + (it.B || lerCampo("c_b")));
}
async function confirmar(id, itens, titulo) {
  S.pendente = {id, itens, titulo};
  const fmt = (r, v) => typeof v === "number" ? (r.includes("!A") && v > 20000 ? fmtData(fromSerial(v)) : brl(v)) : esc(v);
  abrirDlg("<h2>Confira antes de gravar</h2><p><b>" + esc(titulo) + '</b></p><div class="scroll"><table class="diff"><tr><th>Célula</th><th>Antes</th><th>Depois</th></tr>' +
    itens.map(i => "<tr><td>" + esc(i.range.replace(/'/g, "")) + "<br><span class=\"mut\">" + esc(i.nome) + "</span></td><td>" + (i.antes === "" ? "vazio" : fmt(i.range, i.antes)) + "</td><td>" + fmt(i.range, i.valor) + "</td></tr>").join("") +
    '</table></div><p class="mut">Só valores nestas células. Fórmulas, abas e colunas não são tocadas.</p><p><button class="btn verde" data-act="gravar">Gravar na planilha</button> <button class="btn sec" data-act="fechar">Voltar</button></p>');
}
async function gravarAgora() {
  const p = S.pendente; if (!p) return; const btn = dlg().querySelector('[data-act="gravar"]'); btn.disabled = true; btn.textContent = "Gravando…";
  try {
    // 1) conferir que ninguém mexeu nas células desde que você abriu o formulário
    const atual = await lerFaixas(p.id, p.itens.map(i => i.range));
    for (let k = 0; k < p.itens.length; k++) { const v = atual[k][0]?.[0]; const antes = p.itens[k].antes; if ((v ?? "") !== antes && !(typeof v === "number" && Number(antes) === v)) { throw new Error("A célula " + p.itens[k].range.replace(/'/g, "") + " mudou na planilha enquanto você preenchia. Atualize e refaça."); } }
    await gravar(p.id, p.itens);
    // 2) ler de volta e comparar
    const dep = await lerFaixas(p.id, p.itens.map(i => i.range)); const falhas = p.itens.filter((i, k) => { const v = dep[k][0]?.[0]; return typeof i.valor === "number" ? Number(v) !== i.valor : v !== i.valor; });
    if (falhas.length) throw new Error("Gravei, mas a conferência não bateu em " + falhas.map(f => f.range.replace(/'/g, "")).join(", ") + ". Abra a planilha para checar.");
    fechar(); toast("Gravado e conferido na planilha."); S.pendente = null; await carregar();
  } catch (e) { if (e.message === "sessao") return; abrirDlg('<h2>Não gravei</h2><p>' + esc(e.message) + '</p><button class="btn" data-act="fechar">Entendi</button>'); }
}

/* ---------- Eventos ---------- */
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-act]"); if (!b) return; const d = b.dataset;
  const ac = {
    entrar, fechar, sair: () => sair(), atualizar: () => carregar(), gravar: gravarAgora, revisarVenda, revisarConta,
    nav: () => { S.view = d.v; render(); },
    filtro: () => { S.filtro = d.f; render(); },
    verContas: () => { S.view = "contas"; S.filtro = d.f; render(); },
    mesVenda: () => { S.mesVenda = +d.m; render(); },
    vendaHoje: () => formVenda(hoje().getMonth()),
    vendaDia: () => formVenda(+d.m),
    baixa: () => formConta(+d.k, +d.r, "baixa"), editar: () => formConta(+d.k, +d.r, "editar"),
    novaConta: () => { const ma = mesAtual(); const k = S.contas[ma.y * 100 + ma.m] ? ma.y * 100 + ma.m : Math.max(...Object.keys(S.contas).map(Number)); formConta(k, 0, "nova"); }
  }[d.act]; ac && ac();
});
document.addEventListener("input", ev => { if (ev.target.id?.startsWith("v_")) prevVenda(); });
document.addEventListener("change", ev => { if (ev.target.id === "v_dia" && S.edit?.tipo === "venda") formVenda(S.edit.mesIdx, +ev.target.value); });
telaLogin();
