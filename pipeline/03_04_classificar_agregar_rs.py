# -*- coding: utf-8 -*-
"""Classifica (CID-10) e agrega os microdados do RS nas tabelas do painel.

Reutiliza, por importação direta, as funções do 03_classificar.py ORIGINAL (faixa_de, idade_anos,
classifica e os vocabulários GRUPOS/EXTERNAS/MEIOS/SUBS): nenhuma regra de classificação é
reescrita aqui. A agregação segue o 04_agregar.py original, trocando a chave de localidade:
  original: BR + 27 UFs por CODMUNRES[:2]      aqui: RS + 497 municípios por CODMUNRES[:6]
RS = todos os registros de residentes no RS (inclui CODMUNRES 430000 = município ignorado e códigos
fora da lista oficial do IBGE), assim como BR no original é a soma de todos os registros.
Sexo: Ambos inclui sexo ignorado. Contagem inclui idade ignorada; tabelas _f só idade conhecida.
"""
import importlib.util, json, pathlib, sys, time
import numpy as np, pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sp = importlib.util.spec_from_file_location("rc", RAIZ.parent / "causa-mortis-main/pipeline/03_classificar.py")
rc = importlib.util.module_from_spec(sp); sp.loader.exec_module(rc)

MUN = json.load(open(RAIZ / "data/raw/POP_GEO/municipios_rs.json", encoding="utf-8"))
LOCS = ["RS"] + sorted(str(m["id"])[:6] for m in MUN)
NOMES = {"RS": "Rio Grande do Sul", **{str(m["id"])[:6]: m["nome"] for m in MUN}}
SEXOS = ["Ambos", "Homens", "Mulheres"]
ANOS = list(range(2000, 2026))
iL = {u: i for i, u in enumerate(LOCS)}
OUT = RAIZ / "data/interim/AGG_RS"; OUT.mkdir(parents=True, exist_ok=True)
CLASS = RAIZ / "data/interim/CLASS_RS"; CLASS.mkdir(parents=True, exist_ok=True)

def _acumula(T, F, chaves_tot, chaves_fx):
    for chave, n in chaves_tot.items():
        loc, sx = chave[0], chave[1]; resto = tuple(chave[2:])
        for si in ({"Homens": [0, 1], "Mulheres": [0, 2]}.get(sx, [0])):
            T[(0, si) + resto] += n
            if loc in iL: T[(iL[loc], si) + resto] += n
    for chave, n in chaves_fx.items():
        loc, sx = chave[0], chave[1]; resto = tuple(chave[2:])
        for si in ({"Homens": [0, 1], "Mulheres": [0, 2]}.get(sx, [0])):
            F[(0, si) + resto] += n
            if loc in iL: F[(iL[loc], si) + resto] += n

def contagens(d, chave, cats):
    idx = {c: i for i, c in enumerate(cats)}
    k = d[chave].map(idx); ok = k.notna()
    sub = pd.DataFrame({"m": d.mun[ok], "sx": d.sx[ok], "k": k[ok].astype(int), "fx": d.fx[ok]})
    T = np.zeros((len(LOCS), 3, len(cats)), dtype=np.int64)
    F = np.zeros((len(LOCS), 3, len(cats), 18), dtype=np.int64)
    _acumula(T, F, sub.groupby(["m", "sx", "k"], observed=True).size(),
             sub[sub.fx >= 0].groupby(["m", "sx", "k", "fx"], observed=True).size())
    return T, F

def totais(d):
    T = np.zeros((len(LOCS), 3), dtype=np.int64); F = np.zeros((len(LOCS), 3, 18), dtype=np.int64)
    _acumula(T, F, d.groupby(["mun", "sx"], observed=True).size(),
             d[d.fx >= 0].groupby(["mun", "sx", "fx"], observed=True).size())
    return T, F

def main(anos):
    resumo = json.load(open(OUT / "resumo.json")) if (OUT / "resumo.json").exists() else {}
    for ano in anos:
        t0 = time.time()
        d = pd.read_parquet(RAIZ / f"data/interim/SIM_RS/ano={ano}/parte.parquet",
                            columns=["TIPOBITO", "IDADE", "SEXO", "CODMUNRES", "CAUSABAS"])
        d = d[d.TIPOBITO != "1"].copy()
        d["mun"] = d.CODMUNRES.str.strip().str[:6]
        d["sx"] = np.where(d.SEXO == "1", "Homens", np.where(d.SEXO == "2", "Mulheres", "Ignorado"))
        d["fx"] = rc.faixa_de(pd.Series(rc.idade_anos(d.IDADE.fillna(""))))
        g, ex, mi, sb = rc.classifica(d, ano)
        d["g"] = g; d["ex"] = ex; d["mi"] = mi; d["sb"] = sb
        d.to_parquet(CLASS / f"ano={ano}.parquet", index=False)
        r = {}
        r["tot"], r["tot_f"] = totais(d)
        r["g"], r["g_f"] = contagens(d, "g", rc.GRUPOS)
        r["ex"], r["ex_f"] = contagens(d, "ex", rc.EXTERNAS)
        r["mi"], r["mi_f"] = contagens(d, "mi", rc.MEIOS)
        r["sb"], r["sb_f"] = contagens(d, "sb", list(range(18)))
        np.savez_compressed(OUT / f"ano={ano}.npz", **r)
        fora = d[~d.mun.isin(iL)]
        resumo[str(ano)] = {"obitos": int(len(d)), "idade_ignorada": int((d.fx < 0).sum()),
                            "sexo_ignorado": int((d.sx == "Ignorado").sum()),
                            "fora_da_lista": {k: int(v) for k, v in fora.mun.value_counts().items()},
                            "causabas_nula": int(d.CAUSABAS.isna().sum())}
        json.dump(dict(sorted(resumo.items())), open(OUT / "resumo.json", "w"), ensure_ascii=False, indent=1)
        print(f"  {ano}  {len(d):>7,} óbitos  idade ign {int((d.fx<0).sum()):>4,}  sexo ign {int((d.sx=='Ignorado').sum()):>3,}"
              f"  fora da lista {len(fora):>3,}  {time.time()-t0:.0f}s".replace(",", "."), flush=True)
    json.dump({"locations": LOCS, "location_names": NOMES}, open(OUT / "localidades.json", "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main([int(a) for a in sys.argv[1:]] or ANOS)
