# -*- coding: utf-8 -*-
"""Monta o mortality-indexed.json do RS (rev 15 do original, adaptada à dimensão geográfica). v3.

v3: Pinto Bandeira (431454) só existiu como município em 2001-2002 (código histórico 4314530) e a partir
de 2013. Em 2000 e 2003-2012 seus habitantes e óbitos estão em Bento Gonçalves; a célula do município
nesses anos é NULL em todas as tabelas (não aplicável), em vez de população retroestimada com zero óbitos.
O total do RS não muda: a população estadual continua a soma de todos os municípios (= IBGE rev. 2024).

v1 (05_06_montar_indexed_rs.py) montava tudo como listas Python e estourava a memória da VM (2,9 GB):
498 localidades × 3 sexos × 26 anos × 18 subgrupos × 18 faixas. A v2 mantém os agregados em numpy e
escreve o JSON tabela a tabela, célula a célula, sem materializar a estrutura inteira. As REGRAS são
as mesmas da v1 e do original (05 + 06):
  célula[0] = total do recorte (com idade ignorada); _age e padronizada só idade conhecida; Ambos inclui
  sexo ignorado; arredondamento 2/3/1 casas com round() do Python (como no original); null semântico
  (COVID < 2020; Próstata em Mulheres; Colo de útero em Homens); padronização direta, pesos do modelo.
  Correção 1: lesão autoprovocada com denominador 5+ (faixas 2..17), numerador = total − óbitos < 5 anos.
  Correção 2: C61 em mulheres e C53 em homens somados a 'Demais localizações' (idade pelo microdado),
  ANTES do cálculo das taxas — resultado idêntico a recalcular a célula depois, como faz o 06 original.
População: MS/SVSA (POPSVS) por município; RS = soma (idêntica à projeção IBGE rev. 2024 do original).
Cobertura: RS = série da UF (RIPSA DEM.4.02, do original); municípios = null.
"""
import collections, json, pathlib
import numpy as np, pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ORIG = RAIZ.parent / "causa-mortis-main"
AGG = RAIZ / "data/interim/AGG_RS"
I_AUTO, I_DEMAIS, I_PROSTATA, I_COLO, I_COVID = 3, 5, 3, 4, 4
NAO_EXISTIA = {"431454": {2000, *range(2003, 2013)}}   # Pinto Bandeira

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
    P[0] = P[1:].sum(axis=0)
    return P

def carrega(anos):
    A = {k: [] for k in ["tot", "tot_f", "g", "g_f", "ex", "ex_f", "mi", "mi_f", "sb", "sb_f"]}
    for ano in anos:
        z = np.load(AGG / f"ano={ano}.npz")
        for k in A: A[k].append(z[k])
    return {k: np.stack(v, axis=2) for k, v in A.items()}     # (L, S, Y, ...)

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

def taxas(total, f, p, W, casas=2):
    pt = p.sum()
    bruta = round(float(total) / pt * 1e5, casas) if pt else 0.0
    padr = round(float((W * np.divide(f.astype(float), p, out=np.zeros(len(p)), where=p > 0)).sum() / W.sum() * 1e5), casas)
    return bruta, padr

def num(x):
    if isinstance(x, float) and x.is_integer(): return int(x)
    return x

def js(cel):
    if cel is None: return "null"
    return "[" + ", ".join("null" if v is None else str(num(v)) for v in cel) + "]"

class Escritor:
    def __init__(self, f): self.f = f
    def tabela(self, nome, celula, locs, sexos, anos, ultimo=False):
        f = self.f; f.write(f'  "{nome}": [\n')
        for li in range(len(locs)):
            f.write("    [\n")
            for si in range(len(sexos)):
                f.write("      [\n")
                for yi in range(len(anos)):
                    c = None if int(anos[yi]) in NAO_EXISTIA.get(locs[li], ()) else celula(li, si, yi)
                    txt = js(c) if (c is None or not isinstance(c[0], (list, type(None)))) else "[" + ", ".join(js(x) for x in c) + "]"
                    f.write("        " + txt + (",\n" if yi < len(anos) - 1 else "\n"))
                f.write("      ]" + (",\n" if si < len(sexos) - 1 else "\n"))
            f.write("    ]" + (",\n" if li < len(locs) - 1 else "\n"))
        f.write("  ]" + ("\n" if ultimo else ",\n"))

def main():
    M = json.loads((ORIG / "data/mortality-indexed.json").read_text(encoding="utf-8"))
    L = json.load(open(AGG / "localidades.json", encoding="utf-8"))
    dm = dict(M["dimensions"]); dm["locations"] = L["locations"]; dm["location_names"] = L["location_names"]
    locs, sexos, anos = dm["locations"], dm["sexes"], dm["years"]
    W = np.array(dm["standard_population_weights"], float); W5 = W[2:]
    grupos, externas, meios, subs = dm["cause_groups"], dm["external_cause_types"], dm["assault_means"], dm["detailed_subgroups"]
    assert subs[I_PROSTATA] == "Próstata" and subs[I_COLO] == "Colo de útero" and grupos[I_COVID] == "COVID-19" \
        and externas[I_AUTO] == "Lesão autoprovocada" and subs[I_DEMAIS] == "Demais localizações"
    iS = {v: i for i, v in enumerate(sexos)}; iL = {v: i for i, v in enumerate(locs)}; iY = {int(v): i for i, v in enumerate(anos)}
    POP = populacao(locs, sexos, anos); A = carrega(anos)

    # correção 2 antes das taxas
    mov = incompativeis(set(locs), anos); cods = collections.defaultdict(collections.Counter)
    for (a, loc, sx), v in mov.items():
        A["sb"][iL[loc], iS[sx], iY[a], I_DEMAIS] += v["n"]; A["sb_f"][iL[loc], iS[sx], iY[a], I_DEMAIS] += v["fx"]
        if loc == "RS": cods[a].update(v["cods"])
    total2 = sum(sum(c.values()) for c in cods.values())
    print(f"correção 2: {len(mov)} recortes, {total2} registros realocados ({ {a: dict(c) for a, c in sorted(cods.items())} })")

    def overall(li, si, yi):
        p = POP[li, si, yi]; b, pr = taxas(A["tot"][li, si, yi], A["tot_f"][li, si, yi], p, W)
        return [int(A["tot"][li, si, yi]), b, pr, int(round(p.sum()))]
    def deaths_by_age(li, si, yi): return [int(x) for x in A["tot_f"][li, si, yi]]
    def population_by_age(li, si, yi): return [int(round(x)) for x in POP[li, si, yi]]
    def age_specific_rate(li, si, yi):
        p = POP[li, si, yi]; return [round(float(A["tot_f"][li, si, yi, k] / p[k] * 1e5), 1) if p[k] else 0.0 for k in range(18)]
    def cause_group(li, si, yi):
        p = POP[li, si, yi]; out = []
        for k in range(len(grupos)):
            if k == I_COVID and int(anos[yi]) < 2020: out.append(None); continue
            _, pr = taxas(A["g"][li, si, yi, k], A["g_f"][li, si, yi, k], p, W); out.append([int(A["g"][li, si, yi, k]), pr])
        return out
    def cause_group_age(li, si, yi):
        return [[0] * 18 if (k == I_COVID and int(anos[yi]) < 2020) else [int(x) for x in A["g_f"][li, si, yi, k]] for k in range(len(grupos))]
    def externa(li, si, yi):
        p = POP[li, si, yi]; out = []
        for k in range(len(externas)):
            n, f = A["ex"][li, si, yi, k], A["ex_f"][li, si, yi, k]
            if k == I_AUTO:                      # correção 1
                p5 = p[2:].sum()
                if p5:
                    b = round((int(n) - int(f[0] + f[1])) / p5 * 1e5, 2)
                    pr = round(float((W5 * np.divide(f[2:].astype(float), p[2:], out=np.zeros(16), where=p[2:] > 0)).sum() / W5.sum() * 1e5), 2)
                else: b, pr = taxas(n, f, p, W)
            else: b, pr = taxas(n, f, p, W)
            out.append([int(n), b, pr])
        return out
    def externa_age(li, si, yi): return [[int(x) for x in A["ex_f"][li, si, yi, k]] for k in range(len(externas))]
    def meio(li, si, yi):
        p = POP[li, si, yi]; out = []
        for k in range(len(meios)):
            b, pr = taxas(A["mi"][li, si, yi, k], A["mi_f"][li, si, yi, k], p, W); out.append([int(A["mi"][li, si, yi, k]), b, pr])
        return out
    def meio_age(li, si, yi): return [[int(x) for x in A["mi_f"][li, si, yi, k]] for k in range(len(meios))]
    def na(k, si): return (k == I_PROSTATA and sexos[si] == "Mulheres") or (k == I_COLO and sexos[si] == "Homens")
    def sub(li, si, yi):
        p = POP[li, si, yi]; out = []
        for k in range(len(subs)):
            if na(k, si): out.append(None); continue
            b, pr = taxas(A["sb"][li, si, yi, k], A["sb_f"][li, si, yi, k], p, W, casas=3); out.append([int(A["sb"][li, si, yi, k]), b, pr])
        return out
    def sub_age(li, si, yi): return [[0] * 18 if na(k, si) else [int(x) for x in A["sb_f"][li, si, yi, k]] for k in range(len(subs))]

    abaixo5 = int(A["ex_f"][0, 0, :, I_AUTO, :2].sum())
    ing = json.load(open(RAIZ / "data/interim/ingestao_rs.json", encoding="utf-8"))
    meta = {
        "source": "SIM/DataSUS (microdados) e estimativas populacionais MS/SVSA por município (DATASUS, POPSVS); padronização NT nº 51/2025-CGIAE",
        "origin": "causa-mortis-rs rev 1 (réplica da rev 15 do atlas_mortalidade para RS e municípios)",
        "data_format_version": 1, "layout": "indexed",
        "sim_files": {str(a): {"arquivo": v["arquivo"], "formato": v["formato"], "registros_arquivo": v["registros_arquivo"],
                               "registros_rs": v["registros_rs"], **({"validacao": v["validacao"]} if "validacao" in v else {})}
                      for a, v in sorted(ing.items())},
        "sources_by_table": {**M["meta"]["sources_by_table"],
            "population_by_age": "MS/SVSA, estimativas por município, sexo e idade simples (FTP DATASUS IBGE/POPSVS/POPSBRaa), agregadas em 18 faixas; RS = soma dos municípios, idêntica à projeção IBGE rev. 2024 nas 1.404 células",
            "coverage": "RIPSA DEM.4.02 por UF: só o RS tem valor; municípios são null (indicador não existe por município); null em 2024–2025"},
        "geography": "Pinto Bandeira (431454): 2001-2002 via código histórico 4314530; null em 2000 e 2003-2012 (não existia). locations[0] = 'RS' (todos os residentes no RS, inclusive CODMUNRES 430000 e códigos fora da lista do IBGE); demais = 497 municípios do IBGE, chave = 6 primeiros dígitos de CODMUNRES",
        "notes_rev14": M["meta"]["notes_rev14"], "notes_rev15": M["meta"]["notes_rev15"],
        "notes_rs": (f"Réplica geográfica: mesmas regras da rev 15. Correção 2 realocou {total2} registros "
                     f"({ {a: dict(c) for a, c in sorted(cods.items())} }); óbitos < 5 anos em lesão autoprovocada (RS/Ambos, série): {abaixo5}. "
                     "2022 e 2023 vieram do CSV republicado pelo DATASUS em 14 e 16/09/2026 (sem cabeçalho; colunas identificadas e validadas "
                     "registro a registro contra DORS2022/2023.dbc do FTP DATASUS). Municípios pequenos: taxas instáveis; leia com o número de óbitos ao lado.")}
    cov_rs = M["coverage"][M["dimensions"]["locations"].index("RS")]
    out = RAIZ / "data/mortality-indexed.json"
    with open(out, "w", encoding="utf-8") as f:
        f.write("{\n")
        f.write('  "meta": ' + json.dumps(meta, ensure_ascii=False, indent=2).replace("\n", "\n  ") + ",\n")
        f.write('  "dimensions": ' + json.dumps(dm, ensure_ascii=False, indent=2).replace("\n", "\n  ") + ",\n")
        E = Escritor(f)
        for nome, fn in [("overall", overall), ("deaths_by_age", deaths_by_age), ("population_by_age", population_by_age),
                         ("age_specific_rate", age_specific_rate), ("deaths_by_cause_group", cause_group),
                         ("deaths_by_cause_group_age", cause_group_age), ("deaths_by_external_cause", externa),
                         ("deaths_by_external_cause_age", externa_age), ("deaths_by_assault_means", meio),
                         ("deaths_by_assault_means_age", meio_age), ("deaths_by_detailed_subgroup", sub),
                         ("deaths_by_detailed_subgroup_age", sub_age)]:
            E.tabela(nome, fn, locs, sexos, anos); print("  ", nome, flush=True)
        f.write('  "coverage": [\n')
        for li in range(len(locs)):
            row = cov_rs if li == 0 else [None] * len(anos)
            f.write("    " + js(row) + (",\n" if li < len(locs) - 1 else "\n"))
        f.write("  ]\n}\n")
    print("gravado", out, out.stat().st_size, "bytes")

if __name__ == "__main__":
    main()
