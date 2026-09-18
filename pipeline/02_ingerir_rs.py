# -*- coding: utf-8 -*-
"""Ingere a série do SIM 2000-2025 para Parquet, só residentes no RS (CODMUNRES 43xxxx).

Mesmas regras do 02_ingerir.py original (latin-1, separador detectado no cabeçalho,
colunas em maiúsculas, guarda das colunas essenciais, CSV e JSON na mesma série).
DIFERENÇAS, ambas sem efeito sobre o resultado:
  1. leitura em blocos (CSV) e em fluxo (JSON, ijson): a máquina tem 2 GB de RAM;
  2. filtro CODMUNRES começando por "43" já na ingestão. O total nacional do arquivo
     continua sendo contado e gravado no log, para conferir com os registros esperados
     do projeto original (2022: 1.544.266; 2023: 1.465.610; 2024: 1.532.015; 2025: 1.507.424).

    python3 02_ingerir_rs.py <ano> [<ano> ...]
"""
import csv, json, pathlib, sys, time, zipfile
import pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
RAW = RAIZ / "data/raw/SIM"
OUT = RAIZ / "data/interim/SIM_RS"
LOG = RAIZ / "data/interim/ingestao_rs.json"
UF = "43"
COLS = ["TIPOBITO","DTOBITO","IDADE","SEXO","RACACOR","CODMUNRES","CODMUNOCOR",
        "CAUSABAS","CAUSABAS_O","LOCOCOR","ESC","ESTCIV","OBITOGRAV","OBITOPUERP"]
ESSENCIAIS = {"CAUSABAS", "IDADE", "SEXO", "CODMUNRES"}
ESPERADOS = {2022: 1544266, 2023: 1465610, 2024: 1532015, 2025: 1507424}

def catalogo():
    src = RAIZ.parent / "causa-mortis-main/pipeline/sim_files.csv"
    return {int(r["ano"]): r for r in csv.DictReader(open(src, encoding="utf-8")) if r["ano"] != "0"}

def _sep(linha):
    return max([";", ",", "|"], key=lambda s: linha.count(s))

def le_csv(z):
    n, partes = 0, []
    with zipfile.ZipFile(z) as f:
        interno = [x for x in f.namelist() if x.lower().endswith(".csv")][0]
        with f.open(interno) as h:
            sep = _sep(h.readline().decode("latin-1"))
        with f.open(interno) as h:
            for b in pd.read_csv(h, sep=sep, dtype=str, encoding="latin-1", chunksize=150000):
                b.columns = [c.strip().upper() for c in b.columns]
                if not ESSENCIAIS <= set(b.columns):
                    raise RuntimeError(f"colunas essenciais ausentes ({len(b.columns)} lidas)")
                n += len(b)
                partes.append(b.loc[b.CODMUNRES.str.strip().str[:2] == UF, [c for c in COLS if c in b.columns]])
    return n, pd.concat(partes, ignore_index=True)

def le_json(z):
    import ijson
    n, linhas = 0, []
    with zipfile.ZipFile(z) as f:
        for nm in sorted(x for x in f.namelist() if x.endswith(".json")):
            with f.open(nm) as h:
                for reg in ijson.items(h, "item"):
                    n += 1
                    r = {k.strip().upper(): v for k, v in reg.items()}
                    if str(r.get("CODMUNRES") or "").strip()[:2] == UF:
                        linhas.append({c: r.get(c) for c in COLS if c in r})
    df = pd.DataFrame(linhas)
    if not ESSENCIAIS <= set(df.columns):
        raise RuntimeError("colunas essenciais ausentes no JSON")
    return n, df.astype("string").astype(object).where(df.notna(), None)

def main(anos):
    cat = catalogo()
    log = json.load(open(LOG)) if LOG.exists() else {}
    for ano in anos:
        t0 = time.time(); c = cat[ano]
        n, df = le_json(RAW / c["arquivo"]) if c["variante"] == "json" else le_csv(RAW / c["arquivo"])
        if ano in ESPERADOS and n != ESPERADOS[ano]:
            raise RuntimeError(f"{ano}: {n} registros no arquivo, esperados {ESPERADOS[ano]}")
        alvo = OUT / f"ano={ano}" / "parte.parquet"
        alvo.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(alvo, index=False)
        log[str(ano)] = {"arquivo": c["arquivo"], "formato": c["variante"], "registros_arquivo": n,
                         "registros_rs": len(df), "colunas": list(df.columns),
                         "ausentes": [x for x in COLS if x not in df.columns]}
        json.dump(log, open(LOG, "w"), ensure_ascii=False, indent=1)
        print(f"  {ano}  arquivo {n:>9,}  RS {len(df):>7,}  {len(df.columns)}/{len(COLS)} colunas  {time.time()-t0:.0f}s".replace(",", "."), flush=True)

if __name__ == "__main__":
    main([int(a) for a in sys.argv[1:]])
