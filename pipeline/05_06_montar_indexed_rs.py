# -*- coding: utf-8 -*-
"""Monta o mortality-indexed.json do RS (rev 15 do original, adaptada à dimensão geográfica).

Mesmas regras do 05_montar_indexed.py e do 06_correcoes_rev15.py originais, na mesma ordem:
  05: célula[0] = total do recorte (com idade ignorada); _age e padronizada só idade conhecida;
      Ambos inclui sexo ignorado; arredondamento 2/3/1 casas; null semântico (COVID < 2020,
      Próstata em Mulheres, Colo de útero em Homens); padronização direta com os pesos do modelo.
  06: (1) lesão autoprovocada com denominador 5+ (faixas 2..17), numerador = total - óbitos < 5 anos;
      (2) C61 em mulheres e C53 em homens realocados para 'Demais localizações' (idade por microdado).
Molde: `dimensions` (menos locations/location_names) e pesos vêm do mortality-indexed.json original.
População: MS/SVSA (POPSVS) por município; RS = soma dos municípios — verificado idêntico, nas 1.404
células sexo × ano × faixa, à projeção IBGE rev. 2024 usada pelo original.
Cobertura (RIPSA DEM.4.02): só existe por UF; RS recebe a série da UF, municípios recebem null.
"""
import collections, json, pathlib
import numpy as np, pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ORIG = RAIZ.parent / "causa-mortis-main"
AGG = RAIZ / "data/interim/AGG_RS"
NAO_APLICAVEL = {("Próstata", "Mulheres"), ("Colo de útero", "Homens")}
I_AUTO, I_DEMAIS = 3, 5

def populacao(locs, sexos, anos):
    pop = pd.read_parquet(RAIZ / "data/interim/pop_svs_rs_2000_2025.parquet")
    fx = np.where(pop.IDADE < 1, 0, np.where(pop.IDADE < 5, 1, np.minimum(2 + (pop.IDADE - 5) // 5, 17)))
    g = pop.assign(fx=fx).groupby(["SIGLA", "SEXO", "ANO", "fx"], observed=True).POP.sum()
    P = np.zeros((len(locs), len(sexos), len(anos), 18))
    iL = {v: i for i, v in enumerate(locs)}; iS = {v: i for i, v in enumerate(sexos)}; iA = {int(v): i for i, v in enumerate(anos)}
    for (sg, sx, an, k), v in g.items():
        if sg in iL and int(an) in iA:
            P[iL[sg], iS[sx], iA[int(an)], int(k)] += v
            P[iL[sg], iS["Ambos"], iA[int(an)], int(k)] += v
    P[0] = P[1:].sum(axis=0)          # RS = soma dos municípios
    return P

def taxas(total, por_faixa, p, W, casas=2):
    pt = p.sum()
    bruta = round(total / pt * 1e5, casas) if pt else 0.0
    padr = round(float((W * np.divide(np.asarray(por_faixa, float), p, out=np.zeros(len(p)), where=p > 0)).sum() / W.sum() * 1e5), casas)
    return bruta, padr

def tabela(locs, sexos, anos):
    return [[[None] * len(anos) for _ in sexos] for _ in locs]

def incompativeis(locs, anos):
    mov = {}
    for a in anos:
        d = pd.read_parquet(RAIZ / f"data/interim/CLASS_RS/ano={a}.parquet", columns=["CAUSABAS", "SEXO", "mun", "fx"])
        cb = d.CAUSABAS.astype(str).str.upper().str.strip(); num = pd.to_numeric(cb.str[1:3], errors="coerce")
        sel = (cb.str[0] == "C") & (((num == 61) & (d.SEXO == "2")) | ((num == 53) & (d.SEXO == "1")))
        g = d[sel].assign(sexo=np.where(d.SEXO[sel] == "1", "Homens", "Mulheres"), cod=np.where(num[sel] == 61, "C61", "C53"))
        for (mun, sx), sub in g.groupby(["mun", "sexo"]):
            for loc in ((mun, "RS") if mun in locs else ("RS",)):
                v = mov.setdefault((a, loc, sx), {"n": 0, "fx": np.zeros(18, int), "cods": collections.Counter()})
                v["n"] += len(sub); v["cods"].update(sub.cod)
                for k in sub.fx[sub.fx >= 0]: v["fx"][int(k)] += 1
    return mov

def main():
    M = json.loads((ORIG / "data/mortality-indexed.json").read_text(encoding="utf-8"))
    L = json.load(open(AGG / "localidades.json", encoding="utf-8"))
    dm = dict(M["dimensions"]); dm["locations"] = L["locations"]; dm["location_names"] = L["location_names"]
    locs, sexos, anos = dm["locations"], dm["sexes"], dm["years"]
    W = np.array(dm["standard_population_weights"], float)
    grupos, externas, meios, subs = dm["cause_groups"], dm["external_cause_types"], dm["assault_means"], dm["detailed_subgroups"]
    POP = populacao(locs, sexos, anos)
    D = {"meta": None, "dimensions": dm}
    for t in ["overall", "deaths_by_age", "population_by_age", "age_specific_rate", "deaths_by_cause_group",
              "deaths_by_cause_group_age", "deaths_by_external_cause", "deaths_by_external_cause_age",
              "deaths_by_assault_means", "deaths_by_assault_means_age", "deaths_by_detailed_subgroup",
              "deaths_by_detailed_subgroup_age"]:
        D[t] = tabela(locs, sexos, anos)

    for yi, ano in enumerate(anos):
        A = np.load(AGG / f"ano={ano}.npz")
        T, TF, G, GF, E, EF, Mi, MF, S, SF = (A[k] for k in ["tot", "tot_f", "g", "g_f", "ex", "ex_f", "mi", "mi_f", "sb", "sb_f"])
        for li in range(len(locs)):
            for si, sx in enumerate(sexos):
                p = POP[li, si, yi]
                b, pr = taxas(T[li, si], TF[li, si], p, W)
                D["overall"][li][si][yi] = [int(T[li, si]), b, pr, int(round(p.sum()))]
                D["deaths_by_age"][li][si][yi] = [int(x) for x in TF[li, si]]
                D["population_by_age"][li][si][yi] = [int(round(x)) for x in p]
                D["age_specific_rate"][li][si][yi] = [round(float(TF[li, si, k] / p[k] * 1e5), 1) if p[k] else 0.0 for k in range(18)]
                cg, cga = [], []
                for k, nome in enumerate(grupos):
                    if nome == "COVID-19" and int(ano) < 2020:
                        cg.append(None); cga.append([0] * 18); continue
                    _, pr2 = taxas(G[li, si, k], GF[li, si, k], p, W)
                    cg.append([int(G[li, si, k]), pr2]); cga.append([int(x) for x in GF[li, si, k]])
                D["deaths_by_cause_group"][li][si][yi] = cg; D["deaths_by_cause_group_age"][li][si][yi] = cga
                for tab, arr, arrf, cats in [("deaths_by_external_cause", E, EF, externas), ("deaths_by_assault_means", Mi, MF, meios)]:
                    cel, cea = [], []
                    for k in range(len(cats)):
                        b2, p2 = taxas(arr[li, si, k], arrf[li, si, k], p, W)
                        cel.append([int(arr[li, si, k]), b2, p2]); cea.append([int(x) for x in arrf[li, si, k]])
                    D[tab][li][si][yi] = cel; D[tab + "_age"][li][si][yi] = cea
                ds, da = [], []
                for k, nome in enumerate(subs):
                    if (nome, sx) in NAO_APLICAVEL:
                        ds.append(None); da.append([0] * 18); continue
                    b3, p3 = taxas(S[li, si, k], SF[li, si, k], p, W, casas=3)
                    ds.append([int(S[li, si, k]), b3, p3]); da.append([int(x) for x in SF[li, si, k]])
                D["deaths_by_detailed_subgroup"][li][si][yi] = ds; D["deaths_by_detailed_subgroup_age"][li][si][yi] = da
        print(f"  {ano} montado", flush=True)

    # correção 1 (rev 15): lesão autoprovocada, denominador 5+
    W5, SW5, n1, abaixo5 = W[2:], W[2:].sum(), 0, 0
    for li in range(len(locs)):
        for si in range(len(sexos)):
            for yi in range(len(anos)):
                cel = D["deaths_by_external_cause"][li][si][yi][I_AUTO]
                f = np.array(D["deaths_by_external_cause_age"][li][si][yi][I_AUTO], float)
                p = np.array(D["population_by_age"][li][si][yi], float); p5 = p[2:].sum()
                if not p5: continue
                num = cel[0] - int(f[0] + f[1]); abaixo5 += int(f[0] + f[1]) if li == 0 and si == 0 else 0
                b = round(num / p5 * 1e5, 2)
                pr = round(float((W5 * np.divide(f[2:], p[2:], out=np.zeros(16), where=p[2:] > 0)).sum() / SW5 * 1e5), 2)
                if [cel[1], cel[2]] != [b, pr]: n1 += 1
                cel[1], cel[2] = b, pr
    # correção 2 (rev 15): neoplasias com sexo incompatível
    mov = incompativeis(set(locs), anos)
    iL = {v: i for i, v in enumerate(locs)}; iS = {v: i for i, v in enumerate(sexos)}; iY = {int(v): i for i, v in enumerate(anos)}
    for (a, loc, sx), v in mov.items():
        li, si, yi = iL[loc], iS[sx], iY[a]
        ds, da = D["deaths_by_detailed_subgroup"][li][si][yi], D["deaths_by_detailed_subgroup_age"][li][si][yi]
        p = np.array(D["population_by_age"][li][si][yi], float)
        novo = np.array(da[I_DEMAIS], int) + v["fx"]; da[I_DEMAIS] = [int(x) for x in novo]
        n = ds[I_DEMAIS][0] + v["n"]
        ds[I_DEMAIS] = [n, round(n / p.sum() * 1e5, 3), round(float((W * np.divide(novo.astype(float), p, out=np.zeros(18), where=p > 0)).sum() / W.sum() * 1e5), 3)]
    cods = collections.defaultdict(collections.Counter)
    for (a, loc, _), v in mov.items():
        if loc == "RS": cods[a].update(v["cods"])
    total2 = sum(sum(c.values()) for c in cods.values())
    print(f"correção 1: {n1} recortes com taxa alterada; óbitos < 5 anos (RS/Ambos): {abaixo5}")
    print(f"correção 2: {len(mov)} recortes, {total2} registros realocados ({ {a: dict(c) for a, c in sorted(cods.items())} })")

    # cobertura: RS = série da UF no original (RIPSA DEM.4.02); municípios = null
    cov_rs = M["coverage"][M["dimensions"]["locations"].index("RS")]
    D["coverage"] = [list(cov_rs)] + [[None] * len(anos) for _ in locs[1:]]

    ing = json.load(open(RAIZ / "data/interim/ingestao_rs.json", encoding="utf-8"))
    D["meta"] = {
        "source": "SIM/DataSUS (microdados) e estimativas populacionais MS/SVSA por município (DATASUS, POPSVS); padronização NT nº 51/2025-CGIAE",
        "origin": "causa-mortis-rs rev 1 (réplica da rev 15 do atlas_mortalidade para RS e municípios)",
        "data_format_version": 1, "layout": "indexed",
        "sim_files": {str(a): {"arquivo": v["arquivo"], "formato": v["formato"], "registros_arquivo": v["registros_arquivo"],
                               "registros_rs": v["registros_rs"], **({"validacao": v["validacao"]} if "validacao" in v else {})}
                      for a, v in sorted(ing.items())},
        "sources_by_table": {**M["meta"]["sources_by_table"],
            "population_by_age": "MS/SVSA, estimativas por município, sexo e idade simples (FTP DATASUS IBGE/POPSVS), agregadas em 18 faixas; RS = soma dos municípios, idêntica à projeção IBGE rev. 2024",
            "coverage": "RIPSA DEM.4.02 por UF: só o RS tem valor; municípios são null (indicador não existe por município); null em 2024–2025"},
        "geography": "locations[0] = 'RS' (todos os residentes no RS, inclusive CODMUNRES 430000 e códigos fora da lista do IBGE); demais = 497 municípios do IBGE, chave = 6 primeiros dígitos de CODMUNRES",
        "notes_rev14": M["meta"]["notes_rev14"], "notes_rev15": M["meta"]["notes_rev15"],
        "notes_rs": (f"Réplica geográfica: mesmas regras da rev 15. Correção 1 aplicada em {n1} recortes; correção 2 realocou {total2} registros "
                     f"({ {a: dict(c) for a, c in sorted(cods.items())} }). 2022 e 2023 vieram do CSV republicado pelo DATASUS em 14 e 16/09/2026 "
                     "(sem cabeçalho; colunas identificadas e validadas registro a registro contra DORS2022/2023.dbc do FTP DATASUS). "
                     "Municípios pequenos: taxas instáveis; leia com o número de óbitos ao lado.")}
    return D

def serializa(o):
    if isinstance(o, float) and o.is_integer(): return int(o)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.floating,)): return serializa(float(o))
    if isinstance(o, list): return [serializa(x) for x in o]
    if isinstance(o, dict): return {k: serializa(v) for k, v in o.items()}
    return o

if __name__ == "__main__":
    D = serializa(main())
    out = RAIZ / "data/mortality-indexed.json"
    out.write_text(json.dumps(D, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("gravado", out, out.stat().st_size, "bytes")
