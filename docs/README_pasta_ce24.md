# Causa Mortis RS

Réplica do painel Causa Mortis (https://www.causamortis.net/, licença MIT) para o Rio Grande do Sul e seus
497 municípios, com dados extraídos de novo, direto do DATASUS/IBGE.

| Pasta / arquivo                                                         | O que é                                                                                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/00_inventario_etapa0_diagnostico.md`                              | Inventário passo a passo de tudo que foi feito (replicável por outro modelo)                                            |
| `baixar_sim*.ps1`, `sondar_2022_2023.ps1`, `baixar_populacao_malha.ps1` | Downloads no Windows (o ambiente de IA não alcança os hosts)                                                            |
| `data/raw/`                                                             | SIM 2000–2025 (26 zips + CSV republicados 2022/2023 + DORS*.dbc), POPSVS, malha IBGE, logs e hashes                     |
| `data/interim/`                                                         | Parquets por ano (SIM_RS, CLASS_RS), população, agregados (AGG_RS), logs de ingestão e asserções                        |
| `data/mortality-indexed.json`                                           | Base final (RS + 497 municípios × 3 sexos × 26 anos)                                                                    |
| `pipeline/`                                                             | 02 ingestão, 02b (2022/2023), 02c população, 03_04 classificação+agregação (v2), 05_06 montagem (v3), 08 asserções (v2) |
| `site/`                                                                 | Site Astro adaptado (build: `npm ci && npm run build`)                                                                  |
| `_transfer/`                                                            | Partes do tar usadas na transferência (podem ser apagadas) e cópia parcial antiga                                       |

Ordem de execução do pipeline (Python 3.11+, pandas, pyarrow, ijson, datasus-dbc, dbfread):
`02_ingerir_rs.py 2000 … 2025` (exceto 2022/2023) → `02b_ingerir_2022_2023_rs.py` → `02c_populacao_municipal.py`
→ `03_04_classificar_agregar_rs_v2.py` → `05_06_montar_indexed_rs_v3.py` → `08_assercoes_rs_v2.py`
→ `cd site && npm run data:generate && npm run build`.
