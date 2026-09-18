# -*- coding: utf-8 -*-
"""Asserções do §5 (08_assercoes.R original) aplicadas ao mortality-indexed.json do RS, em Python.
Identidades (têm de fechar exatamente) e alertas (só apontam onde olhar), como no original.
Adaptações geográficas: 'soma das UFs == Brasil' vira 'soma dos municípios + registros fora da lista == RS';
a asserção 'malignas BR/Ambos/2023 == 249.941' (valor nacional) é substituída pela igualdade da fatia RS com o original.
"""
import json, pathlib, numpy as np
RAIZ = pathlib.Path(__file__).resolve().parent.parent
D = json.load(open(RAIZ / "data/mortality-indexed.json", encoding="utf-8"))
dm = D["dimensions"]; L, S, Y = len(dm["locations"]), len(dm["sexes"]), len(dm["years"])
w = np.array(dm["standard_population_weights"], float); tol = 0.01
res = []
def reg(nome, viol, total, ex="", tipo="identidade"): res.append((nome, tipo, viol, total, ex))
reg("soma dos pesos == 210862983", int(w.sum() != 210862983), 1)
pega = lambda e, i=0: 0 if e is None else e[i]
cont = dict(bruta=0, padr=0, pop=0, cap=0, ext=0, meios=0, cardio=0, malig=0); ex = {k: "" for k in cont}
nm = lambda l, s, y: f"{dm['locations'][l]}/{dm['sexes'][s]}/{dm['years'][y]}"
for l in range(L):
    for s in range(S):
        for y in range(Y):
            o = D["overall"][l][s][y]
            if o is None: continue
            dd = np.array(D["deaths_by_age"][l][s][y], float); pp = np.array(D["population_by_age"][l][s][y], float)
            if o[3] and abs(o[0] / o[3] * 1e5 - o[1]) >= tol: cont["bruta"] += 1; ex["bruta"] = ex["bruta"] or nm(l, s, y)
            esp = (w * np.divide(dd, pp, out=np.zeros(18), where=pp > 0)).sum() / w.sum() * 1e5
            if abs(esp - o[2]) >= tol: cont["padr"] += 1; ex["padr"] = ex["padr"] or f"{nm(l,s,y)}: {esp:.2f} vs {o[2]}"
            if pp.sum() != o[3]: cont["pop"] += 1; ex["pop"] = ex["pop"] or nm(l, s, y)
            cg = D["deaths_by_cause_group"][l][s][y]; scg = sum(pega(c) for c in cg)
            if scg != o[0]: cont["cap"] += 1; ex["cap"] = ex["cap"] or f"{nm(l,s,y)}: {scg} vs {o[0]}"
            ec = D["deaths_by_external_cause"][l][s][y]; sec = sum(pega(c) for c in ec)
            if sec != pega(cg[3]): cont["ext"] += 1; ex["ext"] = ex["ext"] or nm(l, s, y)
            am = D["deaths_by_assault_means"][l][s][y]; sam = sum(pega(c) for c in am)
            if sam != pega(ec[1]): cont["meios"] += 1; ex["meios"] = ex["meios"] or nm(l, s, y)
            ds = D["deaths_by_detailed_subgroup"][l][s][y]; sub = lambda idx: sum(pega(ds[i]) for i in idx)
            if sub([6, 7, 8]) != pega(cg[0]): cont["cardio"] += 1; ex["cardio"] = ex["cardio"] or nm(l, s, y)
            if sub([0, 1, 2, 3, 4, 5, 17]) > pega(cg[1]): cont["malig"] += 1; ex["malig"] = ex["malig"] or nm(l, s, y)
N = L * S * Y
for k, nome in [("bruta", "taxa bruta reproduzível"), ("padr", "taxa padronizada reproduzível"), ("pop", "sum(population_by_age) == overall[4]"),
                ("cap", "sum(capitulos) == overall[1]"), ("ext", "sum(tipos externos) == cap. externas"), ("meios", "sum(meios) == agressao"),
                ("cardio", "sum(subgrupos cardio) == cap. IX"), ("malig", "sum(malignas) <= cap. II")]:
    reg(nome, cont[k], N, ex[k])
resumo = json.load(open(RAIZ / "data/interim/AGG_RS/resumo.json"))
v = 0; e1 = ""
for s in range(S):
    for y in range(Y):
        soma = sum(D["overall"][l][s][y][0] for l in range(1, L) if D["overall"][l][s][y] is not None); rs = D["overall"][0][s][y][0]
        fora = sum(resumo[str(dm["years"][y])]["fora_da_lista"].values()) if s == 0 else None
        if s == 0 and soma + fora != rs: v += 1; e1 = e1 or f"Ambos/{dm['years'][y]}: {soma}+{fora} vs {rs}"
        if s > 0 and soma > rs: v += 1; e1 = e1 or f"{dm['sexes'][s]}/{dm['years'][y]}"
reg("soma municípios (+ fora da lista) == RS", v, S * Y, e1)
resp = range(9, 17); v = 0; e2 = ""
for k in resp:
    serie = np.array([pega(D["deaths_by_detailed_subgroup"][0][0][y][k]) for y in range(Y)], float)
    base = serie[:-1]; salto = np.abs(np.diff(serie) / np.where(base == 0, np.nan, base)); mx = np.nanmax(salto)
    if mx >= 0.4: v += 1; e2 = e2 or f"{dm['detailed_subgroups'][k]}: salto de {100*mx:.0f}% em {dm['years'][int(np.nanargmax(salto))+1]}"
reg("subgrupos respiratórios (RS) sem salto > 40%", v, len(resp), e2, "alerta")
M = json.load(open(RAIZ.parent / "causa-mortis-main/data/mortality-indexed.json", encoding="utf-8")); iRS = M["dimensions"]["locations"].index("RS")
tabs = [t for t in D if t not in ("meta", "dimensions", "coverage")]
dif = sum(D[t][0][s][y] != M[t][iRS][s][y] for t in tabs for s in range(S) for y in range(Y))
nulos = sum(D["overall"][l][s][y] is None for l in range(L) for s in range(S) for y in range(Y))
reg("células null só onde o município não existia (Pinto Bandeira: 11 anos × 3 sexos)", int(nulos != 33), 1, f"{nulos} nulas")
reg("fatia RS idêntica ao original (12 tabelas × 78 recortes)", dif, len(tabs) * S * Y)
print(f"{'asserção':62s} {'tipo':10s} {'viol':>6s} {'de':>7s}  exemplo")
for nome, tipo, viol, total, e in res: print(f"{nome:62s} {tipo:10s} {viol:>6d} {total:>7d}  {e}")
falhas = [r for r in res if r[1] == "identidade" and r[2] > 0]
json.dump([dict(zip(["assercao", "tipo", "violacoes", "de", "exemplo"], r)) for r in res], open(RAIZ / "data/interim/assercoes_rs.json", "w"), ensure_ascii=False, indent=1)
raise SystemExit(1 if falhas else 0)
