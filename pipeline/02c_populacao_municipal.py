# -*- coding: utf-8 -*-
"""População municipal por sexo e idade simples, 2000-2025 (MS/SVSA, FTP DATASUS IBGE/POPSVS/POPSBRaa.zip).

Cada zip traz um DBF com COD_MUN (7 dígitos), ANO, SEXO (1/2), IDADE ('000'..'079', '080' = 80+), POP.
Só o RS é retido. Saída no mesmo formato que o 03/05 originais esperam da projeção do IBGE:
SIGLA (aqui o código de 6 dígitos do município), SEXO (Homens/Mulheres), ANO, IDADE (int), POP.
"""
import pathlib, tempfile, zipfile
import pandas as pd
from dbfread import DBF

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SRC = RAIZ / "data/raw/POP_GEO"
OUT = RAIZ / "data/interim/pop_svs_rs_2000_2025.parquet"

def le(ano):
    z = zipfile.ZipFile(SRC / f"POPSBR{ano % 100:02d}.zip"); nm = z.namelist()[0]
    with tempfile.TemporaryDirectory() as t:
        p = pathlib.Path(t) / nm; p.write_bytes(z.read(nm))
        rows = [{k.upper(): v for k, v in r.items()} for r in DBF(str(p), encoding="latin-1")]
    d = pd.DataFrame(rows)
    d = d[d.COD_MUN.astype(str).str[:2] == "43"]
    assert (d.ANO.astype(int) == ano).all(), f"{ano}: coluna ANO divergente"
    assert set(d.SEXO.astype(str)) == {"1", "2"} and d.IDADE.astype(str).str.len().eq(3).all()
    return pd.DataFrame({"SIGLA": d.COD_MUN.astype(str).str[:6], "SEXO": d.SEXO.astype(str).map({"1": "Homens", "2": "Mulheres"}),
                         "ANO": ano, "IDADE": d.IDADE.astype(int), "POP": d.POP.astype("int64")})

POR_ANO = RAIZ / "data/interim/POP_SVS_RS"

def main(anos):
    POR_ANO.mkdir(parents=True, exist_ok=True)
    for ano in anos:
        alvo = POR_ANO / f"ano={ano}.parquet"
        if alvo.exists(): continue
        d = le(ano); d.to_parquet(alvo, index=False)
        print(f"  {ano}  municípios {d.SIGLA.nunique()}  pop RS {d.POP.sum():,}".replace(",", "."), flush=True)
    if len(list(POR_ANO.glob("ano=*.parquet"))) == 26:
        pop = pd.concat([pd.read_parquet(p) for p in sorted(POR_ANO.glob("ano=*.parquet"))], ignore_index=True)
        assert pop.groupby(["SIGLA", "SEXO", "ANO", "IDADE"]).size().max() == 1
        pop.to_parquet(OUT, index=False); print("gravado", OUT, len(pop))

if __name__ == "__main__":
    import sys
    main([int(a) for a in sys.argv[1:]] or range(2000, 2026))
