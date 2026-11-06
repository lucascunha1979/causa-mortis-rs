# -*- coding: utf-8 -*-
"""Fluxos residência -> ocorrência dos óbitos do RS, 2000-2025. v1 (05/11/2026).

Universo: óbitos não fetais de residentes no RS OU ocorridos no RS (data/interim/SIM_RS_v2), já classificados pelo
03_04 v4 (CLASS_RS_v3/res + os não residentes de CLASS_RS_v3/ocor). Cada linha da saída é um par
(origem = município de residência, destino = município de ocorrência) num recorte de sexo e causa, com a contagem.

Pontas ("endpoints"):
  0..496   os 497 municípios do RS, na mesma ordem de dimensions.locations[1:] (chave = 6 primeiros dígitos do código IBGE);
  497      "RS, município ignorado ou fora da lista do IBGE" (ex.: 430000);
  498..    outras UFs ("UF:35" = São Paulo etc.), pelos 2 primeiros dígitos do código do município.
Pinto Bandeira: 431453 -> 431454 nas duas pontas (como no 03_04).

Colunas de cada linha: [origem, destino, sexo, grupo, subgrupo, externa, meio, óbitos]
  sexo: 0 Homens, 1 Mulheres, 2 ignorado; grupo: índice em cause_groups; subgrupo/externa/meio: índice em
  detailed_subgroups / external_cause_types / assault_means, ou -1 quando não se aplica.
  Correção 2 (rev 15): C61 em mulheres e C53 em homens vão para "Demais localizações", como nas tabelas.

Identidades verificadas aqui (o script falha se alguma não fechar), para cada ano e sexo:
  soma por origem (municípios do RS)  == overall do arquivo de residência;
  soma por destino (municípios do RS) == overall do arquivo de ocorrência;
  idem por grupo de causa (deaths_by_cause_group, contagem).
Saída: data/fluxos_rs_v1.json.gz
"""
import gzip, json, pathlib
import numpy as np, pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
INT = RAIZ / "data/interim"
R = json.load(open(RAIZ / "data/mortality-indexed_v3_res.json", encoding="utf-8"))
O = json.load(open(RAIZ / "data/mortality-indexed_v3_ocor.json", encoding="utf-8"))
dm = R["dimensions"]
MUNS = dm["locations"][1:]
UFS = ["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28", "29",
       "31", "32", "33", "35", "41", "42", "50", "51", "52", "53"]
ENDPOINTS = MUNS + ["RS?"] + [f"UF:{u}" for u in UFS]
iE = {m: i for i, m in enumerate(MUNS)}
I_RS_IGN = len(MUNS)
iUF = {u: I_RS_IGN + 1 + i for i, u in enumerate(UFS)}
UF_NOMES = {"11": "Rondônia", "12": "Acre", "13": "Amazonas", "14": "Roraima", "15": "Pará", "16": "Amapá", "17": "Tocantins",
            "21": "Maranhão", "22": "Piauí", "23": "Ceará", "24": "Rio Grande do Norte", "25": "Paraíba", "26": "Pernambuco",
            "27": "Alagoas", "28": "Sergipe", "29": "Bahia", "31": "Minas Gerais", "32": "Espírito Santo", "33": "Rio de Janeiro",
            "35": "São Paulo", "41": "Paraná", "42": "Santa Catarina", "50": "Mato Grosso do Sul", "51": "Mato Grosso",
            "52": "Goiás", "53": "Distrito Federal"}
I_DEMAIS, I_PROSTATA, I_COLO = 5, 3, 4


def ponta(cod):
    cod = cod.fillna("").str.strip().str[:6]
    out = cod.map(iE)
    uf = cod.str[:2]
    out = out.where(out.notna(), np.where(uf == "43", I_RS_IGN, uf.map(iUF)))
    if out.isna().any():
        raise RuntimeError(f"pontas sem UF reconhecida: {sorted(set(cod[out.isna()]))[:10]}")
    return out.astype(int)


def main():
    anos = [int(a) for a in dm["years"]]
    iG = {g: i for i, g in enumerate(dm["cause_groups"])}
    iX = {x: i for i, x in enumerate(dm["external_cause_types"])}
    iM = {m: i for i, m in enumerate(dm["assault_means"])}
    por_ano, resumo = {}, {}
    for y, ano in enumerate(anos):
        r = pd.read_parquet(INT / f"CLASS_RS_v3/res/ano={ano}.parquet")
        o = pd.read_parquet(INT / f"CLASS_RS_v3/ocor/ano={ano}.parquet")
        u = pd.concat([r, o[o.CODMUNRES.fillna("").str.strip().str[:2] != "43"]], ignore_index=True)
        cb = u.CAUSABAS.astype(str).str.upper().str.strip()
        sb = u.sb.astype(int).copy()
        sb[(cb.str[:3] == "C61") & (u.SEXO == "2")] = I_DEMAIS
        sb[(cb.str[:3] == "C53") & (u.SEXO == "1")] = I_DEMAIS
        t = pd.DataFrame({
            "o": ponta(u.mun_res), "d": ponta(u.mun_ocor),
            "s": np.select([u.sx == "Homens", u.sx == "Mulheres"], [0, 1], 2),
            "g": u.g.map(iG).astype(int), "sb": sb,
            "ex": u.ex.map(iX).fillna(-1).astype(int), "mi": u.mi.map(iM).fillna(-1).astype(int)})
        if t.g.isna().any():
            raise RuntimeError(f"{ano}: grupo de causa ausente")
        g = t.groupby(list(t.columns), observed=True).size().reset_index(name="n")
        por_ano[str(ano)] = g.values.astype(int).tolist()

        # identidades contra as tabelas por residência e por ocorrência
        for nome, col, D in (("residência", "o", R), ("ocorrência", "d", O)):
            for si, sexo in enumerate(dm["sexes"]):
                sel = t if sexo == "Ambos" else t[t.s == {"Homens": 0, "Mulheres": 1}[sexo]]
                cont = sel[sel[col] < len(MUNS)].groupby(col).size()
                cg = sel[sel[col] < len(MUNS)].groupby([col, "g"]).size()
                for li, m in enumerate(MUNS, start=1):
                    cel = D["overall"][li][si][y]
                    esperado = 0 if cel is None else cel[0]
                    if int(cont.get(iE[m], 0)) != esperado:
                        raise RuntimeError(f"{ano}/{sexo}/{m}: fluxos por {nome} {int(cont.get(iE[m], 0))} != tabela {esperado}")
                    gcel = D["deaths_by_cause_group"][li][si][y]
                    if gcel is not None:
                        for k, c in enumerate(gcel):
                            if c is not None and int(cg.get((iE[m], k), 0)) != c[0]:
                                raise RuntimeError(f"{ano}/{sexo}/{m}/grupo {k}: fluxos {int(cg.get((iE[m], k), 0))} != {c[0]}")
                rs = int(len(sel[sel.o < len(MUNS) + 1])) if nome == "residência" else int(len(sel[sel.d < len(MUNS) + 1]))
                if rs != D["overall"][0][si][y][0]:
                    raise RuntimeError(f"{ano}/{sexo}: total RS por {nome} {rs} != {D['overall'][0][si][y][0]}")
        fora = t.o != t.d
        resumo[str(ano)] = {"obitos_universo": int(len(t)), "linhas": len(g),
                            "fora_do_municipio_de_residencia": int(fora.sum()),
                            "residentes_rs_ocorridos_fora_do_rs": int(((t.o <= I_RS_IGN) & (t.d > I_RS_IGN)).sum()),
                            "nao_residentes_ocorridos_no_rs": int(((t.o > I_RS_IGN) & (t.d <= I_RS_IGN)).sum())}
        print(f"  {ano}  {len(t):>7,} óbitos  {len(g):>6,} linhas  fora do município de residência {int(fora.sum()):>6,}"
              .replace(",", "."), flush=True)

    out = {"meta": {"description": "Fluxos residência -> ocorrência dos óbitos de residentes no RS ou ocorridos no RS (SIM/DATASUS), por ano",
                    "columns": ["origem", "destino", "sexo", "grupo", "subgrupo", "externa", "meio", "obitos"],
                    "sexes": ["Homens", "Mulheres", "Ignorado"],
                    "endpoints_note": "0..496 = municípios do RS (ordem de locations[1:]); 497 = RS, município ignorado; 498.. = outras UFs",
                    "script": "pipeline/07_fluxos_rs.py v1", "summary": resumo},
           "endpoints": ENDPOINTS,
           "endpoint_names": [dm["location_names"][m] for m in MUNS] + ["RS, município ignorado"] + [UF_NOMES[u] for u in UFS],
           "years": anos, "rows": por_ano}
    alvo = RAIZ / "data/fluxos_rs_v1.json.gz"
    with gzip.open(alvo, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("gravado", alvo, alvo.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
