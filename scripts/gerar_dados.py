#!/usr/bin/env python3
"""Gera docs/dados.json (somente totais e categorias, sem nomes) a partir das
planilhas exportadas do Google Drive em .xlsx.

Uso:
  python3 scripts/gerar_dados.py --vendas "Planilha de vendas PDF - 2026.xlsx" \
      --contas "CONTAS A PAGAR - PDFPL TEÓ.xlsx" --saida docs/dados.json
"""
import argparse, json, re, datetime, collections
import openpyxl

MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"]
DIAS = ["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"]
num = lambda x: float(x) if isinstance(x,(int,float)) and not isinstance(x,bool) else 0.0
r2 = lambda x: round(x, 2)

def cabecalho(ws):
    """Acha a linha de cabeçalho e as colunas, tolerando nomes diferentes (ex.: CARTAO)."""
    for row in ws.iter_rows(min_row=1, max_row=8):
        for c in row:
            if isinstance(c.value, str) and c.value.strip().upper().startswith("VALOR R"):
                cols = {"saida": c.column}
                for h in ws[c.row]:
                    v = str(h.value or "").strip().upper()
                    if v == "DINHEIRO": cols["din"] = h.column
                    elif v in ("CARTÃO", "CARTAO"): cols["car"] = h.column
                    elif v == "PIX": cols["pix"] = h.column
                    elif v in ("OUTROS", "TRANSFERÊNCIA ELETRÔNICA", "TRANSFERENCIA ELETRONICA"): cols["out"] = h.column
                    elif v.startswith("DESCRI"): cols["desc"] = h.column
                    elif v.startswith("TOTAL-DIA") or v == "TOTAL DIA": cols["tot"] = h.column
                return c.row, cols
    return None, None

def cat_saida(t):
    t = t.lower()
    if re.search(r"dep[óo]sito|sicoob", t): return "Depósitos no banco"
    if re.search(r"alug|margô|margo\b|margarete", t): return "Aluguel"
    if re.search(r"m[áa]rcia(?!.*atlas)|marcia al", t) and "atlas" not in t: return "Sem detalhe (a confirmar)"
    if re.search(r"th[áa]ssia|thassia|vale|vitor|votor|sal[áa]rio|demiss|marcilio|marc[ií]lio|adrian|luciene|priscila|\bpri\b|\blú\b|acerto|retroativo|f[ée]rias|dos anjos|funcion[áa]rio|anivers", t): return "Pessoal"
    if re.search(r"cemig|\bluz\b|[áa]gua\b|iptu|proteja", t): return "Energia, água, IPTU, segurança"
    if re.search(r"garantia", t): return "Garantia e assistência"
    if re.search(r"estacionamento|gasolina|pneu|[óo]leo|atlas|frete|v\.? vale do mucuri|v vale", t): return "Transporte e estacionamento"
    if re.search(r"almo[çc]o|carne|padaria|banana|p[ãa]o|caf[ée]|lanche|queijo", t): return "Alimentação"
    if re.search(r"sacola|lastro|grafite|indiana|churrasqueira|gr[áa]fica|vassoura|ferragens|xerox|c[âa]mera|desinfet|teclado|material", t): return "Compras e insumos"
    return "Outros / não identificado"

def parse_valor(p):
    nums = re.findall(r"\d[\d\.]*,\d+|\d+", p)
    if not nums: return None
    s = nums[-1]
    return float(s.replace(".", "").replace(",", ".")) if "," in s else float(s)

def vendas(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    meses, dias, saidas = {}, [], collections.defaultdict(lambda: collections.defaultdict(float))
    for m in MESES:
        if m not in wb.sheetnames: continue
        ws = wb[m]
        hr, cols = cabecalho(ws)
        if not hr: continue
        d = dict(dinheiro=0, cartao=0, pix=0, outros=0, saidas=0, dias=0)
        for r in range(hr + 1, ws.max_row + 1):
            wd = ws.cell(r, 4).value
            if not (isinstance(wd, str) and any(wd.strip().lower().startswith(x[:3].lower()) for x in DIAS)):
                continue
            g = lambda k: num(ws.cell(r, cols[k]).value) if k in cols else 0.0
            din, car, pix, out = g("din"), g("car"), g("pix"), g("out")
            tot = din + car + pix + out
            sai = g("saida")
            if tot == 0 and sai == 0: continue
            d["dinheiro"] += din; d["cartao"] += car; d["pix"] += pix; d["outros"] += out
            d["saidas"] += sai
            if tot > 0: d["dias"] += 1
            dias.append(dict(m=m, dia=next(x for x in DIAS if x[:3].lower() == wd.strip().lower()[:3]), total=tot))
            desc = ws.cell(r, cols["desc"]).value if "desc" in cols else None
            if sai and desc and str(desc).strip().lower() != "nada":
                partes = [p.strip() for p in str(desc).split("/") if p.strip()]
                vals = [(p, parse_valor(p)) for p in partes]
                soma = sum(v for _, v in vals if v)
                for p, v in vals:
                    if v: saidas[m][cat_saida(p)] += v
                resto = sai - soma
                if abs(resto) > 0.01:
                    sem = [p for p, v in vals if v is None]
                    saidas[m][cat_saida(sem[0]) if sem else "Outros / não identificado"] += resto
            elif sai:
                saidas[m]["Outros / não identificado"] += sai
        d["total"] = d["dinheiro"] + d["cartao"] + d["pix"] + d["outros"]
        meses[m] = {k: r2(v) if k != "dias" else v for k, v in d.items()}
    # dia da semana: média jan-ago x set
    pd = {}
    for dia in DIAS:
        a = [x["total"] for x in dias if x["dia"] == dia and x["m"] not in ("SET", "OUT") and x["total"] > 0]
        s = [x["total"] for x in dias if x["dia"] == dia and x["m"] == "SET" and x["total"] > 0]
        pd[dia] = dict(media_jan_ago=r2(sum(a)/len(a)) if a else 0, media_set=r2(sum(s)/len(s)) if s else 0, dias_set=len(s))
    cats = sorted({c for m in saidas for c in saidas[m]})
    return meses, pd, {c: {m: r2(saidas[m][c]) for m in meses} for c in cats}

def categoria_conta(b):
    b = b.upper()
    if re.search(r"SALARIO|SALÁRIO", b): return "Folha (salários e 13º)"
    if re.search(r"\bDAS\b|DARF|FGTS|DAE|IMPOSTO", b): return "Impostos e encargos"
    if re.search(r"ALUGUEL", b): return "Aluguel"
    if re.search(r"BDMG|EMPR[ÉE]STIMO|CART[ÃA]O", b): return "Dívidas, financiamentos e cartão"
    if re.search(r"UNIMED|MEDSENIOR|SA[ÚU]DE|VALE ALIM", b): return "Saúde e benefícios"
    if re.search(r"COPASA|CEMIG|VIVO|CLARO|PROTEJA|ESCRITA|LOCATTO|ATLAS|MODERNO|AVELAR", b): return "Contas fixas e serviços"
    return "Fornecedores (mercadoria)"

ABAS = {"AGOSTO2026": "2026-08", "OUTUBRO.26": "2026-10", "NOVEMBRO.26": "2026-11", "DEZEMBRO.26": "2026-12"}

def contas(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    res = {}
    for aba, chave in ABAS.items():
        if aba not in wb.sheetnames: continue
        ws = wb[aba]
        tot = pago = 0.0
        cats = collections.defaultdict(float)
        for r in range(10, 76):
            b, c = ws.cell(r, 2).value, ws.cell(r, 3).value
            if b and isinstance(c, (int, float)) and c > 0:
                tot += c; pago += num(ws.cell(r, 6).value); cats[categoria_conta(str(b))] += c
        falta = sum(num(ws.cell(r, 7).value) for r in range(10, 76))
        res[chave] = dict(a_pagar=r2(tot), marcado_pago=r2(pago), falta_segundo_planilha=r2(falta),
                          categorias={k: r2(v) for k, v in sorted(cats.items(), key=lambda x: -x[1])})
    pend = 0.0; pend_total = None
    if "PENDENTES PAGAMENTOS" in wb.sheetnames:
        ws = wb["PENDENTES PAGAMENTOS"]
        for r in range(1, ws.max_row + 1):
            a, b = ws.cell(r, 1).value, ws.cell(r, 2).value
            if isinstance(a, str) and a.strip().upper() == "TOTAL": pend_total = num(b)
            elif a and isinstance(b, (int, float)): pend += b
    cart = {}
    if "VENCIMENTOS CARTÕES " in wb.sheetnames:
        ws = wb["VENCIMENTOS CARTÕES "]
        for col, nome in ((8, "parcela_1"), (9, "parcela_2"), (10, "parcela_3")):
            cart[nome] = r2(sum(num(ws.cell(r, col).value) for r in range(5, ws.max_row + 1)))
    return res, dict(soma_itens=r2(pend), total_na_planilha=pend_total), cart

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendas", required=True); ap.add_argument("--contas", required=True)
    ap.add_argument("--saida", default="docs/dados.json")
    a = ap.parse_args()
    meses, semana, saidas = vendas(a.vendas)
    cp, pend, cart = contas(a.contas)
    alertas = []
    if pend["total_na_planilha"] is not None and abs(pend["soma_itens"] - pend["total_na_planilha"]) > 0.01:
        alertas.append(f"PENDENTES PAGAMENTOS: itens somam R$ {pend['soma_itens']:,.2f} e a planilha mostra R$ {pend['total_na_planilha']:,.2f}.")
    if "2026-09" not in cp: alertas.append("Planilha de contas a pagar não tem aba de setembro/2026.")
    ago = cp.get("2026-08")
    if ago and ago["falta_segundo_planilha"] > 0: alertas.append(f"Agosto encerrado, mas a planilha ainda mostra R$ {ago['falta_segundo_planilha']:,.2f} em aberto.")
    out = dict(gerado_em=datetime.datetime.now().isoformat(timespec="minutes"), vendas_mensal=meses,
               dia_da_semana=semana, saidas_caixa_por_categoria=saidas, contas_a_pagar=cp,
               pendentes=pend, cartoes_previsao=cart, alertas=alertas)
    json.dump(out, open(a.saida, "w"), ensure_ascii=False, indent=1)
    # cópia em .js para o dashboard abrir também direto do arquivo, sem servidor
    open(a.saida.rsplit(".", 1)[0] + ".js", "w").write("window.DADOS = " + json.dumps(out, ensure_ascii=False) + ";\n")
    print("ok ->", a.saida)

if __name__ == "__main__":
    main()
