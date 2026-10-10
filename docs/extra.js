"use strict";
/* Funções extras: preparar mês, fluxo de caixa, vales, cartões, pendências, metas e lembretes.
   Usa as mesmas regras de segurança do app.js (confirmação, conferência e só células de entrada). */
window.ACOES = window.ACOES || {};
const MAIS = [["alertas", "Alertas"], ["vales", "Vales"], ["cartoes", "Cartões"], ["pendentes", "Pendências"], ["metas", "Metas"], ["lembretes", "Lembretes"]];
const FIXAS = ["Folha (salários e 13º)", "Aluguel", "Contas fixas", "Dívidas e cartão", "Saúde e benefícios", "Impostos e encargos"];
S.mais = "alertas"; S.cenario = "media3";
const getTab = (ini, base) => Object.keys(S.tabs[base]).find(t => norm(t).startsWith(ini));
const nomeCurto = s => String(s || "").trim().split(/\s+/)[0].toLowerCase().replace(/^./, c => c.toUpperCase());
const mesLabel = k => MESES[k % 100] + "/" + String((k / 100) | 0).slice(2);
const metas = { ler() { try { return JSON.parse(localStorage.getItem("pdf_metas") || "{}"); } catch (e) { return {}; } }, gravar(o) { try { localStorage.setItem("pdf_metas", JSON.stringify(o)); } catch (e) { toast("Este navegador não deixou salvar a meta."); } } };

/* ---------- Carga das abas extras ---------- */
async function carregarExtra() {
  const vt = getTab("VALECOLABORADORES", "contas"), pt = getTab("PENDENTES", "contas"), kt = getTab("VENCIMENTOSCART", "contas");
  const [rv, rp, rk] = await Promise.all([
    vt ? lerFaixas(CFG.CONTAS_ID, [q(vt, "A1:L80")]) : [[]], pt ? lerFaixas(CFG.CONTAS_ID, [q(pt, "A1:B20")]) : [[]], kt ? lerFaixas(CFG.CONTAS_ID, [q(kt, "A1:J25")]) : [[]]]);
  S.tabNomes = {vales: vt, pend: pt, cart: kt};
  const g = rv[0], vales = []; let ultimo = 2;
  for (let i = 2; i < g.length; i++) { const r = g[i] || []; if (![0, 1, 2, 3, 4].some(k => r[k] !== undefined && r[k] !== "")) continue; ultimo = i + 1;
    const v = r[3], vn = typeof v === "number" ? v : String(v ?? "").split("+").reduce((a, p) => a + (toNum(p) || 0), 0);
    vales.push({r: i + 1, A: r[0], nome: r[2], v, vn, desc: r[4], forma: r[5], G: r[6], H: r[7], I: r[8], J: r[9], K: r[10], L: r[11], aberto: vn > 0 && String(r[11] ?? "").trim().toLowerCase() !== "ok"}); }
  S.vales = {rows: vales, nova: Math.max(ultimo + 1, 5)};
  const gp = rp[0], pend = [], livres = [];
  for (let i = 4; i < 17; i++) { const r = gp[i] || []; if (String(r[0] ?? "").trim().toUpperCase() === "TOTAL") break; if (r[0] || r[1]) pend.push({r: i + 1, nome: String(r[0] ?? "").trim(), v: r[1]}); else livres.push(i + 1); }
  S.pendRows = {rows: pend, livres};
  const gk = rk[0], cart = [];
  for (let i = 4; i < gk.length; i++) { const r = gk[i] || []; if (!r[1]) continue; cart.push({r: i + 1, venc: r[0], banco: String(r[1]).trim(), D: r[3], E: r[4], G: r[6], p: [7, 8, 9].map(k => typeof r[k] === "number" ? r[k] : null)}); }
  S.cartRows = cart;
}

/* ---------- Editor genérico de uma linha ---------- */
function abrirEditor(cfg) {
  S.edit = {tipo: "gen", cfg};
  const dat = v => typeof v === "number" && v > 20000 ? (d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"))(fromSerial(v)) : "";
  const campos = cfg.campos.map((c, i) => {
    const id = "g_" + i;
    if (c.tipo === "data") return campo(id, c.label, dat(c.atual), "date");
    if (c.tipo === "lista") return lista(id, c.label, c.ops, c.atual ?? "");
    return campo(id, c.label, c.atual === undefined || c.atual === "" ? "" : String(c.atual).replace(".", c.tipo === "num" ? "," : "."), "text", c.tipo === "num" ? 'inputmode="decimal"' : "");
  }).join("");
  abrirDlg("<h2>" + esc(cfg.titulo) + '</h2><p class="mut">' + esc(cfg.aviso || "Deixe em branco o que não mudou. Só gravo o que você alterar.") + '</p><div class="f2">' + campos + '</div><p><button class="btn" data-act="revisarGen">Revisar antes de gravar</button> <button class="btn sec" data-act="fechar">Cancelar</button></p>');
}
ACOES.revisarGen = () => {
  const cfg = S.edit.cfg, itens = [];
  for (let i = 0; i < cfg.campos.length; i++) {
    const c = cfg.campos[i], t = lerCampo("g_" + i); if (t === "") continue; let val, antes = c.atual ?? "";
    if (c.tipo === "num") { val = toNum(t); if (isNaN(val) || Math.abs(val) > 5e6) { toast('Valor inválido em "' + c.label + '".'); return; } if (Number(antes) === val) continue; }
    else if (c.tipo === "data") { const [y, m, d] = t.split("-").map(Number); val = serial(new Date(y, m - 1, d)); if (Number(antes) === val) continue; }
    else { val = t; if (String(antes) === val) continue; }
    itens.push({range: q(cfg.tab, c.col + cfg.row), valor: val, nome: c.label, antes, data: c.tipo === "data"});
  }
  if (!itens.length) { toast("Nada mudou."); return; }
  confirmar(cfg.id, itens, cfg.titulo);
};

/* ---------- Preparar o mês seguinte ---------- */
const baseNome = n => norm(String(n).replace(/\d+\s*\/\s*\d+/g, "").replace(/\d+/g, ""));
function proximoNome(n) { const m = String(n).match(/(\d+)\s*\/\s*(\d+)/); if (!m) return n; const a = +m[1], b = +m[2]; if (a >= b) return null; return String(n).replace(m[0], (a + 1) + "/" + b); }
function candidatosMes(srcKey, dstKey) {
  const src = S.contas[srcKey], dst = S.contas[dstKey]; if (!src || !dst) return [];
  const jaTem = new Set(dst.items.map(i => baseNome(i.B))), cont = {}; src.items.forEach(i => cont[baseNome(i.B)] = (cont[baseNome(i.B)] || 0) + 1);
  return src.items.filter(i => FIXAS.includes(i.cat) && !/13º|PARCELA 13/i.test(i.B) && cont[baseNome(i.B)] === 1 && !jaTem.has(baseNome(i.B))).map(i => {
    const nome = proximoNome(i.B); if (nome === null) return null;
    const dia = i.venc ? i.venc.getDate() : 1, d = new Date(dst.ma.y, dst.ma.m, Math.min(dia, new Date(dst.ma.y, dst.ma.m + 1, 0).getDate()));
    const st = /fixa|autom|pago via pix/i.test(i.D) ? i.D : "FIXA/MÊS";
    return {nome, valor: i.C, data: d, status: st, banco: i.E, cat: i.cat, variavel: i.cat === "Impostos e encargos"};
  }).filter(Boolean);
}
ACOES.preparar = () => {
  const ks = Object.keys(S.contas).map(Number).sort((a, b) => a - b); if (ks.length < 2) { toast("Preciso de pelo menos dois meses na planilha."); return; }
  const ma = mesAtual(), cur = ma.y * 100 + ma.m, dst = ks.find(k => k > cur) ?? ks[ks.length - 1], src = ks[ks.indexOf(dst) - 1] ?? ks[0];
  S.prep = {src, dst};
  const opt = v => ks.map(k => "<option value=\"" + k + "\"" + (k === v ? " selected" : "") + ">" + mesLabel(k) + "</option>").join("");
  abrirDlg('<h2>Preparar um mês</h2><p class="mut">Copia as contas fixas de um mês para as linhas vazias de outro. Só valores; não crio linhas.</p><div class="f2"><div><label for="p_src">Copiar de</label><select id="p_src">' + opt(src) + '</select></div><div><label for="p_dst">Para</label><select id="p_dst">' + opt(dst) + '</select></div></div><div id="p_lista"></div><p><button class="btn" data-act="revisarPrep">Revisar antes de gravar</button> <button class="btn sec" data-act="fechar">Cancelar</button></p>');
  listaPrep();
};
function listaPrep() {
  const src = +lerCampo("p_src") || S.prep.src, dst = +lerCampo("p_dst") || S.prep.dst; S.prep = {src, dst, c: candidatosMes(src, dst)};
  const livres = S.contas[dst]?.slots.length || 0, c = S.prep.c;
  $("#p_lista").innerHTML = src === dst ? "<p>Escolha meses diferentes.</p>" : (c.length ? '<p class="mut">' + c.length + " contas fixas faltando em " + mesLabel(dst) + " · " + livres + " linhas livres</p>" + c.map((x, i) => '<label style="display:flex;gap:10px;align-items:center;font-weight:400"><input type="checkbox" style="width:28px;min-height:28px" data-ck="' + i + '" checked> <span>' + esc(x.nome) + " · " + brl(x.valor) + " · " + fmtData(x.data) + (x.variavel ? ' <b class="pill amar">confira o valor</b>' : "") + "</span></label>").join("") : '<p><b>Nada faltando.</b> Todas as contas fixas de ' + mesLabel(src) + " já estão em " + mesLabel(dst) + ".</p>");
}
document.addEventListener("change", e => { if (e.target.id === "p_src" || e.target.id === "p_dst") listaPrep(); });
ACOES.revisarPrep = () => {
  const p = S.prep, c = p.c.filter((x, i) => dlg().querySelector('[data-ck="' + i + '"]')?.checked), slots = S.contas[p.dst].slots, tab = S.contas[p.dst].tab, itens = [];
  if (!c.length) { toast("Nada selecionado."); return; }
  if (c.length > slots.length) { toast("Só há " + slots.length + " linhas livres. Desmarque algumas ou crie linhas na planilha."); return; }
  c.forEach((x, i) => { const s = slots[i], r = s.r;
    itens.push({range: q(tab, "A" + r), valor: serial(x.data), nome: x.nome + " (data)", antes: s.A ?? "", data: true}, {range: q(tab, "B" + r), valor: x.nome, nome: "Fornecedor", antes: ""}, {range: q(tab, "C" + r), valor: x.valor, nome: "Valor", antes: ""}, {range: q(tab, "D" + r), valor: x.status, nome: "Situação", antes: s.D ?? ""}, {range: q(tab, "E" + r), valor: x.banco, nome: "Pago por", antes: s.E ?? ""}); });
  confirmar(CFG.CONTAS_ID, itens.filter(i => i.antes !== i.valor), "Preparar " + mesLabel(p.dst) + " (" + c.length + " contas)");
};

/* ---------- Fluxo de caixa ---------- */
function mediasDia() {
  const meses = MESES.map(m => S.vendas[m]).filter(v => v && v.dias >= 15), h = hoje(), cur = S.vendas[MESES[h.getMonth()]];
  const base = S.cenario === "recente" ? [...meses.slice(-1), ...(cur && cur.dias ? [cur] : [])] : meses.slice(-3);
  const por = DIAS.map(d => { const v = base.flatMap(m => m.rows.filter(r => r.wd === d && r.tot > 0).map(r => r.tot)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  return {por, base: base.map(b => MESES[b.mes]).join(", ")};
}
function vFluxo() {
  const h = hoje(), md = mediasDia(), abertas = todasContas().filter(i => i.falta > 0.005), semSaida = abertas.filter(encerrada);
  const sem = [0, 1, 2, 3].map(w => ({w, ini: new Date(h.getFullYear(), h.getMonth(), h.getDate() + w * 7), ent: 0, sai: 0}));
  for (let d = 0; d < 28; d++) { const dia = new Date(h.getFullYear(), h.getMonth(), h.getDate() + d), idx = (dia.getDay() + 6) % 7; sem[(d / 7) | 0].ent += md.por[idx]; }
  abertas.filter(i => !encerrada(i)).forEach(i => { let d = i.venc ? Math.round((i.venc - h) / 864e5) : 0; if (d < 0) d = 0; if (d < 28) sem[(d / 7) | 0].sai += i.falta; });
  let ac = 0; sem.forEach(s => { s.saldo = s.ent - s.sai; ac += s.saldo; s.ac = ac; });
  const neg = sem.find(s => s.ac < 0);
  let o = '<p class="mut">Estimativa das próximas 4 semanas: vendas esperadas contra contas em aberto. Não inclui saldo em conta nem o prazo de recebimento do cartão.</p><div class="chips"><button class="chip" aria-pressed="' + (S.cenario === "media3") + '" data-act="cenario" data-c="media3">Média dos 3 últimos meses cheios</button><button class="chip" aria-pressed="' + (S.cenario === "recente") + '" data-act="cenario" data-c="recente">Ritmo recente</button></div>';
  o += '<div class="card ' + (neg ? "verm" : "verde") + '"><h3>' + (neg ? "Atenção: o caixa aperta na semana de " + fmtData(neg.ini) : "Folga prevista nas 4 semanas") + '</h3><div class="big">' + brl0(sem[3].ac) + '</div><div class="mut">saldo acumulado em 28 dias · base: ' + esc(md.base || "sem meses cheios") + "</div></div>";
  o += '<div class="card" style="margin-top:14px"><h3>Entradas e saídas por semana</h3>' + bars({labels: sem.map(s => "a partir de " + fmtData(s.ini)), alt: "Fluxo semanal", series: [{name: "Vendas esperadas", color: "#16a34a", data: sem.map(s => s.ent)}, {name: "Contas a pagar", color: "#dc2626", data: sem.map(s => s.sai)}]}) + '<div class="scroll"><table><tr><th>Semana</th><th>Entra</th><th>Sai</th><th>Saldo</th><th>Acumulado</th></tr>' + sem.map(s => "<tr><td>" + fmtData(s.ini) + "</td><td>" + brl0(s.ent) + "</td><td>" + brl0(s.sai) + '</td><td style="color:var(--' + (s.saldo < 0 ? "verm" : "verde") + ')"><b>' + brl0(s.saldo) + '</b></td><td style="color:var(--' + (s.ac < 0 ? "verm" : "verde") + ')"><b>' + brl0(s.ac) + "</b></td></tr>").join("") + "</table></div></div>";
  if (semSaida.length) o += '<p class="mut">Fora da conta: ' + brl0(sum(semSaida, "falta")) + " de meses encerrados que ainda aparecem em aberto (aba Contas > A conferir).</p>";
  return o;
}
ACOES.cenario = b => { S.cenario = b.dataset.c; render(); };

/* ---------- Mais: alertas, vales, cartões, pendências, metas, lembretes ---------- */
function vMais() {
  let o = '<div class="chips">' + MAIS.map(([k, t]) => '<button class="chip" aria-pressed="' + (S.mais === k) + '" data-act="mais" data-m="' + k + '">' + t + (k === "alertas" && alertas().length ? " (" + alertas().length + ")" : "") + "</button>").join("") + "</div>";
  return o + ({alertas: vAlertas, vales: vVales, cartoes: vCartoes, pendentes: vPend, metas: vMetas, lembretes: vLembretes}[S.mais])();
}
ACOES.mais = b => { S.mais = b.dataset.m; render(); };
function vVales() {
  const v = S.vales; if (!v || !S.tabNomes.vales) return "<p>Não achei a aba de vales.</p>";
  const ab = v.rows.filter(x => x.aberto), por = {}; ab.forEach(x => por[nomeCurto(x.nome)] = (por[nomeCurto(x.nome)] || 0) + x.vn);
  let o = '<div class="card roxo"><h3>Vales para descontar</h3><div class="big">' + brl0(sum(ab, "vn")) + '</div><div class="mut">' + Object.entries(por).map(([n, t]) => esc(n) + " " + brl0(t)).join(" · ") + '</div></div><p><button class="btn" data-act="novoVale">Novo vale</button></p>';
  return o + v.rows.slice().reverse().map(x => '<div class="row ' + (x.aberto ? "amar" : "verde") + '"><div class="t"><b>' + esc(nomeCurto(x.nome) || "Sem nome") + " · " + brl(x.vn) + '</b><span class="mut">' + esc(x.desc || "") + " · " + (typeof x.A === "number" ? fmtData(fromSerial(x.A)) : "sem data") + (x.forma ? " · " + esc(x.forma) : "") + '</span><br><span class="pill ' + (x.aberto ? "amar" : "verde") + '">' + (x.aberto ? "A descontar" : "Conferido") + '</span></div><button class="btn sec small" data-act="editarVale" data-r="' + x.r + '">Editar</button></div>').join("");
}
const camposVale = x => [{col: "C", label: "Nome do colaborador", tipo: "texto", atual: x.nome}, {col: "D", label: "Valor do vale (R$)", tipo: "num", atual: typeof x.v === "number" ? x.v : x.v}, {col: "E", label: "Descrição", tipo: "texto", atual: x.desc}, {col: "F", label: "Forma (ex.: 2 X)", tipo: "texto", atual: x.forma}, {col: "H", label: "1ª parcela (R$)", tipo: "num", atual: x.H}, {col: "I", label: "Competência do abatimento", tipo: "data", atual: x.I}, {col: "J", label: "2ª parcela (R$)", tipo: "num", atual: x.J}, {col: "K", label: "Mês do abatimento", tipo: "data", atual: x.K}, {col: "L", label: 'Conferido (digite "ok" quando descontar)', tipo: "texto", atual: x.L}];
ACOES.editarVale = b => { const x = S.vales.rows.find(r => r.r === +b.dataset.r); abrirEditor({id: CFG.CONTAS_ID, tab: S.tabNomes.vales, row: x.r, titulo: "Vale de " + nomeCurto(x.nome), campos: camposVale(x)}); };
ACOES.novoVale = () => { const r = S.vales.nova, h = hoje(); abrirEditor({id: CFG.CONTAS_ID, tab: S.tabNomes.vales, row: r, titulo: "Novo vale (linha " + r + ")", aviso: "Vai para a próxima linha vazia. Preencha nome, valor e descrição.", campos: [{col: "A", label: "Data", tipo: "data", atual: ""}, ...camposVale({}).slice(0, 4)].map((c, i) => i === 0 ? {...c, atual: ""} : c)}); };
function proxVenc(a) { const m = String(a ?? "").match(/(\d{1,2})/); if (!m) return null; const h = hoje(); let d = new Date(h.getFullYear(), h.getMonth(), Math.min(+m[1], 28)); if (+m[1] > 28) d = new Date(h.getFullYear(), h.getMonth() + 1, 0); if (d < h) d = new Date(h.getFullYear(), h.getMonth() + 1, Math.min(+m[1], 28)); return d; }
function vCartoes() {
  const c = S.cartRows; if (!c || !c.length) return "<p>Não achei a aba de cartões.</p>"; const h = hoje();
  return '<p class="mut">Previsão por parcela dos cartões. Toque em Editar para atualizar a fatura.</p>' + c.map(x => { const d = proxVenc(x.venc), dias = d ? Math.round((d - h) / 864e5) : 99, k = dias <= 3 ? "verm" : dias <= 7 ? "amar" : "azul";
    return '<div class="row ' + k + '"><div class="t"><b>' + esc(x.banco) + '</b><span class="mut">vence dia ' + (d ? d.getDate() : "?") + (d ? " · em " + dias + " dias" : "") + '</span><br>' + x.p.map((p, i) => p === null ? "" : '<span class="pill azul">' + (i + 1) + "ª " + brl0(p) + "</span> ").join("") + '</div><button class="btn sec small" data-act="editarCartao" data-r="' + x.r + '">Editar</button></div>'; }).join("");
}
ACOES.editarCartao = b => { const x = S.cartRows.find(r => r.r === +b.dataset.r); abrirEditor({id: CFG.CONTAS_ID, tab: S.tabNomes.cart, row: x.r, titulo: "Cartão " + x.banco, campos: [{col: "D", label: "Valor total da fatura (R$)", tipo: "num", atual: x.D}, {col: "E", label: "Valor pago (R$)", tipo: "num", atual: x.E}, {col: "G", label: "Status", tipo: "texto", atual: x.G}, {col: "H", label: "Previsão 1ª (R$)", tipo: "num", atual: x.p[0] ?? ""}, {col: "I", label: "Previsão 2ª (R$)", tipo: "num", atual: x.p[1] ?? ""}, {col: "J", label: "Previsão 3ª (R$)", tipo: "num", atual: x.p[2] ?? ""}]}); };
function vPend() {
  const p = S.pendRows; if (!p || !S.tabNomes.pend) return "<p>Não achei a aba de pendências.</p>";
  return '<div class="card roxo"><h3>Pendências</h3><div class="big">' + brl0(p.rows.reduce((a, x) => a + num(x.v), 0)) + '</div></div><p><button class="btn" data-act="novaPend">Nova pendência</button></p>' + p.rows.map(x => '<div class="row amar"><div class="t"><b>' + esc(x.nome) + "</b><span class=\"mut\">" + brl(num(x.v)) + '</span></div><button class="btn sec small" data-act="editarPend" data-r="' + x.r + '">Editar</button></div>').join("");
}
ACOES.editarPend = b => { const x = S.pendRows.rows.find(r => r.r === +b.dataset.r); abrirEditor({id: CFG.CONTAS_ID, tab: S.tabNomes.pend, row: x.r, titulo: "Pendência: " + x.nome, campos: [{col: "A", label: "Nome", tipo: "texto", atual: x.nome}, {col: "B", label: "Valor (R$)", tipo: "num", atual: x.v}]}); };
ACOES.novaPend = () => { const r = S.pendRows.livres[0]; if (!r) { toast("Não há linha livre na aba de pendências."); return; } abrirEditor({id: CFG.CONTAS_ID, tab: S.tabNomes.pend, row: r, titulo: "Nova pendência (linha " + r + ")", campos: [{col: "A", label: "Nome", tipo: "texto", atual: ""}, {col: "B", label: "Valor (R$)", tipo: "num", atual: ""}]}); };
function vMetas() {
  const m = metas.ler(), h = hoje(), mv = S.vendas[MESES[h.getMonth()]], fat = mv ? mv.tot : 0, ck = S.contas[h.getFullYear() * 100 + h.getMonth()];
  return '<p class="mut">As metas ficam salvas só neste navegador, não na planilha.</p><div class="f2">' + campo("m_fat", "Meta de faturamento do mês (R$)", m.fat ?? "", "text", 'inputmode="decimal"') + campo("m_desp", "Teto de contas do mês (R$)", m.desp ?? "", "text", 'inputmode="decimal"') + '</div><p><button class="btn" data-act="salvarMetas">Salvar metas</button></p>' + metaCards(m, fat, ck, mv);
}
function metaCards(m, fat, ck, mv) {
  let o = ""; const h = hoje(), restam = (() => { let n = 0; for (let d = h.getDate(); d <= new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate(); d++) if (new Date(h.getFullYear(), h.getMonth(), d).getDay() !== 0) n++; return n; })();
  if (m.fat) { const pct = Math.min(100, fat / m.fat * 100), falta = Math.max(0, m.fat - fat); o += '<div class="card ' + (pct >= 100 ? "verde" : "azul") + '" style="margin-top:14px"><h3>Faturamento do mês</h3><div class="big">' + pct.toFixed(0) + '%</div><div class="mut">' + brl0(fat) + " de " + brl0(m.fat) + '</div><div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div>' + (falta > 0 ? '<p class="mut">Faltam ' + brl0(falta) + " em " + restam + " dias de venda: cerca de " + brl0(falta / Math.max(restam, 1)) + " por dia.</p>" : "<p>Meta batida.</p>") + "</div>"; }
  if (m.desp && ck) { const pct = Math.min(100, ck.a_pagar / m.desp * 100); o += '<div class="card ' + (ck.a_pagar > m.desp ? "verm" : "verde") + '" style="margin-top:14px"><h3>Contas do mês</h3><div class="big">' + brl0(ck.a_pagar) + '</div><div class="mut">teto de ' + brl0(m.desp) + '</div><div class="bar"><i style="width:' + pct.toFixed(0) + '%;background:var(--' + (ck.a_pagar > m.desp ? "verm" : "verde") + ')"></i></div></div>'; }
  return o;
}
ACOES.salvarMetas = () => { const f = toNum(lerCampo("m_fat")), d = toNum(lerCampo("m_desp")); metas.gravar({fat: isNaN(f) ? undefined : f, desp: isNaN(d) ? undefined : d}); toast("Metas salvas."); render(); };
/* Lembretes: arquivo de calendário (.ics) e aviso do navegador */
function vLembretes() {
  const n = todasContas().filter(i => i.falta > 0.005 && i.venc && i.venc >= hoje() && (i.venc - hoje()) / 864e5 <= 30).length;
  return '<div class="card azul"><h3>Lembretes no seu celular</h3><p>Gera um arquivo com as ' + n + ' contas em aberto dos próximos 30 dias. Importe no Google Agenda e o celular avisa um dia antes.</p><p class="mut">O arquivo é criado aqui no navegador e fica só no seu aparelho. Depois de pagar, apague os eventos antigos ou gere de novo.</p><button class="btn" data-act="baixarIcs"' + (n ? "" : " disabled") + '>Baixar lembretes (.ics)</button></div><div class="card" style="margin-top:14px"><h3>Aviso enquanto o painel está aberto</h3><p class="mut">Mostra um aviso do navegador quando houver conta vencendo hoje ou atrasada.</p><button class="btn sec" data-act="avisos">Ativar avisos</button></div>';
}
ACOES.baixarIcs = () => {
  const h = hoje(), p = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"), esc_ = t => String(t).replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, " ");
  const ev = todasContas().filter(i => i.falta > 0.005 && i.venc && i.venc >= h && (i.venc - h) / 864e5 <= 30).map((i, k) => ["BEGIN:VEVENT", "UID:conta-" + i.key + "-" + i.r + "@pdf-teo", "DTSTAMP:" + p(h) + "T120000Z", "DTSTART;VALUE=DATE:" + p(i.venc), "DTEND;VALUE=DATE:" + p(new Date(i.venc.getFullYear(), i.venc.getMonth(), i.venc.getDate() + 1)), "SUMMARY:" + esc_("Pagar " + i.B + " - " + brl(i.falta)), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Conta vence amanhã", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT"].join("\r\n"));
  const blob = new Blob(["BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Ponto dos Fogoes//Contas//PT\r\n" + ev.join("\r\n") + "\r\nEND:VCALENDAR\r\n"], {type: "text/calendar"}), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "contas-a-pagar.ics"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Arquivo gerado. Abra-o para importar na agenda.");
};
ACOES.avisos = async () => {
  if (!("Notification" in window)) { toast("Este navegador não suporta avisos."); return; }
  const r = await Notification.requestPermission(); if (r !== "granted") { toast("Avisos não liberados."); return; }
  const h = hoje(), v = todasContas().filter(i => i.falta > 0.005 && i.venc && i.venc <= h && !encerrada(i));
  new Notification("Painel financeiro", {body: v.length ? v.length + " contas vencem hoje ou estão atrasadas (" + brl0(sum(v, "falta")) + ")." : "Nenhuma conta vencendo hoje."});
};

/* ---------- Peças que aparecem em outras telas ---------- */
function hojeExtra() {
  const m = metas.ler(), h = hoje(), mv = S.vendas[MESES[h.getMonth()]], fat = mv ? mv.tot : 0; let o = "";
  if (m.fat) { const pct = Math.min(100, fat / m.fat * 100); o += '<div class="card azul"><h3>Meta do mês</h3><div class="big">' + pct.toFixed(0) + '%</div><div class="mut">' + brl0(fat) + " de " + brl0(m.fat) + '</div><div class="bar"><i style="width:' + pct.toFixed(0) + '%"></i></div></div>'; }
  else o += '<div class="card azul"><h3>Meta do mês</h3><p class="mut">Defina uma meta de faturamento para acompanhar por dia.</p><button class="btn sec small" data-act="irMetas">Definir meta</button></div>';
  const ks = Object.keys(S.contas).map(Number).sort((a, b) => a - b), cur = h.getFullYear() * 100 + h.getMonth(), nxt = ks.find(k => k > cur);
  if (nxt) { const falt = candidatosMes(cur, nxt).length; if (falt) o += '<div class="card amar"><h3>Preparar ' + mesLabel(nxt) + '</h3><div class="big">' + falt + '</div><div class="mut">contas fixas ainda não lançadas</div><p><button class="btn small" data-act="preparar">Preparar mês</button></p></div>'; }
  return o;
}
ACOES.irMetas = () => { S.view = "mais"; S.mais = "metas"; render(); };
function mesesSemAba() {
  const h = hoje(), falta = []; for (let m = 0; m <= h.getMonth(); m++) if (!S.contas[h.getFullYear() * 100 + m]) falta.push(MESES[m]);
  if (!falta.length) return "";
  return '<div class="card roxo" style="margin-bottom:12px"><h3>Meses sem aba na planilha de contas</h3><p>' + falta.join(", ") + '</p><p class="mut">Quando você criar a aba de um mês (copiando a PLANILHA BASE), o painel passa a ler e a gravar nela automaticamente. Até lá, o espaço fica reservado para preenchimento manual.</p><a class="btn sec small" target="_blank" rel="noopener" href="' + linkAba(CFG.CONTAS_ID) + '">Abrir a planilha</a></div>';
}
