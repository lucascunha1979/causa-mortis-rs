# -*- coding: utf-8 -*-
"""Ingere 2022 e 2023 do CSV republicado pelo DATASUS em 14 e 16/09/2026 (sem cabeçalho).

POR QUE ESTE SCRIPT EXISTE
O original usou Mortalidade_Geral_2022/2023_json.zip. A fonte republicou esses arquivos: o JSON novo
saiu com as chaves trocadas pelos valores da 1ª linha (colunas colapsadas, inutilizável). Na mesma
data surgiu a variante CSV no mesmo bucket, também SEM cabeçalho, mas completa: 1.544.266 e 1.465.610
linhas — exatamente os registros que o original registra para 2022 e 2023.

COMO AS COLUNAS FORAM IDENTIFICADAS (nada presumido)
2022: 87 campos, mesma ordem do DORS2022.dbc (FTP DATASUS, microdado oficial do RS com cabeçalho).
2023: 86 campos, com um contador na 1ª posição; posições achadas por casamento com o DORS2023.dbc.
PROVA: o multiconjunto das 14 colunas dos residentes no RS no CSV tem de ser IDÊNTICO ao do .dbc
(104.096 e 93.516 registros). O script recusa gravar se não for.

NORMALIZAÇÕES (só de forma): DTOBITO "dd-mm-aaaa" -> "ddmmaaaa"; IDADE perdeu zeros à esquerda no CSV
("55" = 055 = 55 minutos) -> zfill(3). Sem isso "55" seria lido como unidade 5 = 105 anos.

Requer: pip install datasus-dbc dbfread
"""
import collections, json, pathlib, tempfile, zipfile
import pandas as pd
import datasus_dbc
from dbfread import DBF

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SRC = RAIZ / "data/raw/SIM_2022_2023"
OUT = RAIZ / "data/interim/SIM_RS"
LOG = RAIZ / "data/interim/ingestao_rs.json"
COLS = ["TIPOBITO","DTOBITO","IDADE","SEXO","RACACOR","CODMUNRES","CODMUNOCOR",
        "CAUSABAS","CAUSABAS_O","LOCOCOR","ESC","ESTCIV","OBITOGRAV","OBITOPUERP"]
POS = {
 2022: dict(TIPOBITO=1, DTOBITO=2, IDADE=7, SEXO=8, RACACOR=9, ESTCIV=10, ESC=11, CODMUNRES=15,
            LOCOCOR=16, CODMUNOCOR=19, OBITOGRAV=34, OBITOPUERP=35, CAUSABAS=45, CAUSABAS_O=55),
 2023: dict(TIPOBITO=2, DTOBITO=3, IDADE=8, SEXO=9, RACACOR=10, ESTCIV=11, ESC=12, CODMUNRES=16,
            LOCOCOR=17, CODMUNOCOR=19, OBITOGRAV=34, OBITOPUERP=35, CAUSABAS=45, CAUSABAS_O=82)}
CAMPOS = {2022: 87, 2023: 86}
ESPERADOS = {2022: 1544266, 2023: 1465610}

def le_dbc(ano):
    with tempfile.TemporaryDirectory() as t:
        dbf = str(pathlib.Path(t) / "x.dbf")
        datasus_dbc.decompress(str(SRC / f"DORS{ano}.dbc"), dbf)
        tab = DBF(dbf, encoding="latin-1")
        if ano == 2022:
            assert {c: tab.field_names.index(c) for c in COLS} == POS[2022], "ordem do dbc mudou"
        return pd.DataFrame([{c: (r[c] or "").strip() for c in COLS} for r in tab])

def main():
    log = json.load(open(LOG)) if LOG.exists() else {}
    for ano in (2022, 2023):
        z = zipfile.ZipFile(SRC / f"Mortalidade_Geral_{ano}_csv.zip")
        n, partes = 0, []
        with z.open(z.namelist()[0]) as h:
            for b in pd.read_csv(h, sep=";", header=None, dtype=str, encoding="latin-1",
                                 chunksize=200000, keep_default_na=False):
                assert b.shape[1] == CAMPOS[ano], f"{ano}: {b.shape[1]} campos"
                n += len(b)
                s = b[[POS[ano][c] for c in COLS]]; s.columns = COLS
                partes.append(s[s.CODMUNRES.str.strip().str[:2] == "43"])
        assert n == ESPERADOS[ano], f"{ano}: {n} linhas, esperadas {ESPERADOS[ano]}"
        df = pd.concat(partes, ignore_index=True)
        df["DTOBITO"] = df.DTOBITO.str.replace("-", "")
        df["IDADE"] = df.IDADE.where(df.IDADE == "", df.IDADE.str.zfill(3))
        ref = le_dbc(ano)
        a = collections.Counter(map(tuple, df[COLS].values))
        b = collections.Counter(map(tuple, ref[COLS].values))
        assert a == b, f"{ano}: CSV e DORS{ano}.dbc divergem em {sum((a - b).values())} registros"
        df = df.where(df != "", None)          # vazio -> nulo, como nos demais anos
        alvo = OUT / f"ano={ano}" / "parte.parquet"; alvo.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(alvo, index=False)
        log[str(ano)] = {"arquivo": f"Mortalidade_Geral_{ano}_csv.zip (republicado, sem cabeçalho)",
                         "formato": "csv", "registros_arquivo": n, "registros_rs": len(df),
                         "colunas": COLS, "ausentes": [],
                         "validacao": f"multiconjunto identico ao DORS{ano}.dbc ({len(ref)} registros)"}
        print(f"  {ano}  arquivo {n:,}  RS {len(df):,}  == DORS{ano}.dbc".replace(",", "."), flush=True)
    json.dump(dict(sorted(log.items())), open(LOG, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
