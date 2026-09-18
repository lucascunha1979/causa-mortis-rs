# Causa Mortis RS — Inventário · Etapa 0 (diagnóstico) · 17/09/2026

## Objetivo

Replicar o projeto `causa-mortis-main` (https://www.causamortis.net/) com a mesma lógica, regras e
visualizações, trocando a dimensão geográfica: RS (estado) + municípios do RS, em vez de BR + 27 UFs.
Dados extraídos da fonte original (SIM/DATASUS), não do repositório.

## O que foi lido (somente leitura, nada alterado no original)

- pipeline/01..06 (.py), 07a/07b/08 (.R), README, PROCEDENCIA_ARQUIVOS.md, sim_files.csv, MANIFEST.sha256
- scripts/generate-mortality-data.ts, src/lib/mortality/types.ts, AGENTS.md, data/README.md
- data/mortality-indexed.json (dimensions, meta, coverage)

## Regras do original que serão mantidas

1. Fonte: bucket `ckan.saude.gov.br` (S3 sa-east-1), prefixos SIM/csv e SIM/json. 26 arquivos:
   2000–2021 `Mortalidade_Geral_AAAA_csv.zip`; 2022–2023 `Mortalidade_Geral_AAAA_json.zip`;
   2024 `DO24OPEN_csv.zip`; 2025 `DO25OPEN_csv.zip` (preliminar). SHA-256 em pipeline/sim_files.csv.
2. Exclui óbito fetal (TIPOBITO == "1"). Local = residência (CODMUNRES).
3. IDADE: 1º dígito unidade (0–3 → <1 ano; 4 → anos; 5 → 100+); demais = ignorada. 18 faixas (<1, 1-4, 5-9 … 80+).
4. "Ambos" inclui sexo ignorado (Ambos != Homens + Mulheres). Total da célula inclui idade ignorada;
   tabelas _age e taxa padronizada usam só idade conhecida.
5. Classificação CID-10: 11 grupos, 5 tipos de causa externa, 6 meios de agressão, 18 subgrupos
   (regras em 03_classificar.py). COVID = B34.2 ou letra U, só a partir de 2020 (null antes).
6. Taxas por 100 mil; padronização direta, 18 faixas, população-padrão Brasil 2022 (soma 210.862.983).
   Arredondamento: 2 casas (geral, externas, meios), 3 (subgrupos), 1 (específica por idade).
7. Rev 15: lesão autoprovocada com denominador 5+; C61 em mulheres / C53 em homens realocados para
   "Demais localizações", célula específica continua null.
8. Exportação canônica (07b) + asserções de identidade (08). Site: Astro + ECharts + Tailwind 4;
   `npm run data:generate` gera JSON/CSV/fatias por território com hash de versão.

## Bloqueios e decisões pendentes encontrados

- REDE: o ambiente de trabalho (nuvem e VM local) bloqueia s3.sa-east-1.amazonaws.com,
  tabnet.datasus.gov.br, ftp.ibge.gov.br (403 do proxy, política de allowlist). Sem liberar o domínio
  ou sem os arquivos baixados pela usuária, não há extração.
- POPULAÇÃO: o original usa projeções IBGE 2024, que só existem por UF. Para municípios é preciso
  outra fonte (decisão da usuária).
- COBERTURA DO SIM (RIPSA DEM.4.02): só existe por UF; não há por município.
- MALHA: trocar br-states.geojson por malha municipal do RS (IBGE).

## Decisões da usuária (17/09/2026)

- População municipal: estimativas MS/SVSA (DATASUS/TabNet); total RS: IBGE projeções 2024 (como no original).
- Territórios: RS + 497 municípios. Cobertura do SIM: só no RS; municípios = null.
- Download: tentar as duas vias (liberar domínios; baixar localmente).

## Etapa 0b — reteste de rede e script de download

- Reteste: s3.sa-east-1.amazonaws.com, tabnet.datasus.gov.br, ftp.ibge.gov.br seguem 403 (allowlist) nos dois ambientes.
- Criado `causa-mortis-rs/baixar_sim.ps1`: gerado a partir de `pipeline/sim_files.csv` (26 arquivos; prefixo SIM/csv ou
  SIM/json conforme a variante), grava em `data/raw/SIM`, renomeia só ao fim (.parcial), confere SHA-256 contra o
  manifesto do original e grava `data/raw/baixados.csv`. Roda no Windows da usuária, fora do ambiente bloqueado.

## Etapa 1 — download e ingestão (17–18/09/2026)

- Download pela usuária com `baixar_sim.ps1`; 2000–2019 com SHA-256 "igual" ao manifesto do original.
  Em 2020 a conexão caiu ("Impossível conectar-se ao servidor remoto"); criado `baixar_sim_v2.ps1`
  (mesmo script + 6 tentativas com espera de 20 s). Arquivos já baixados são pulados e re-hasheados.
- `pipeline/02_ingerir_rs.py <anos>`: mesmas regras do 02 original; leitura em blocos/fluxo (VM com 2 GB)
  e filtro CODMUNRES "43" na ingestão; grava `data/interim/SIM_RS/ano=AAAA/parte.parquet` e
  `data/interim/ingestao_rs.json` (registros do arquivo nacional e do RS).
- Observação: CODMUNRES tem 7 dígitos nos anos iniciais e 6 nos recentes → chave municipal = 6 primeiros dígitos.

## Etapa 1b — resultado do download (18/09/2026)

- 24 de 26 arquivos byte-idênticos ao manifesto do original (2000–2021, 2024, 2025). Ingeridos 24 anos.
  Conferência: 2024 = 1.532.015 e 2025 = 1.507.424 registros no arquivo, iguais aos do original.
- 2022 e 2023 (JSON) foram REPUBLICADOS pela fonte em 14/09 e 16/09/2026: hash e tamanho diferentes
  (77,8 MB e 65,9 MB contra 144,5 MB e 149,0 MB), agora um único `Mortalidade_Geral_AAAA.json`.
  DEFEITO NA FONTE: o JSON saiu sem cabeçalho — as chaves de cada objeto são os VALORES da primeira linha
  ("1","2","21-04-2022",...), e valores repetidos colapsam colunas. Sem nomes de coluna e com colunas perdidas,
  o arquivo é inutilizável; não foi ingerido. Os zips estão íntegros (testzip OK): o problema é o conteúdo.
- Próximo passo: `sondar_2022_2023.ps1` — (a) sonda por HEAD variantes csv/xml/DO22OPEN/DO23OPEN no mesmo bucket;
  (b) baixa do FTP oficial do DATASUS `DORS2021/2022/2023.dbc` (microdados do SIM do RS). 2021 serve de
  controle: o .dbc de 2021 tem de reproduzir exatamente os registros do RS do CSV de 2021 (117.722).

## Etapa 1c — 2022 e 2023 resolvidos (18/09/2026)

- `sondar_2022_2023.ps1` achou no MESMO bucket `csv/Mortalidade_Geral_2022_csv.zip` e `..._2023_csv.zip`
  (republicados 14/09 e 16/09/2026), e baixou `DORS2022.dbc`/`DORS2023.dbc` do FTP do DATASUS. SHA-256 em
  `data/raw/SIM_2022_2023/sondagem.txt`. (DORS2021 falhou por reset de conexão; deixou de ser necessário.)
- Os CSV vêm SEM cabeçalho, mas completos: 1.544.266 e 1.465.610 linhas = registros do original.
- `pipeline/02b_ingerir_2022_2023_rs.py`: posições das 14 colunas verificadas contra o .dbc (2022: mesma ordem,
  87 campos; 2023: 86 campos, contador na 1ª posição, CAUSABAS_O na posição 82). Normaliza DTOBITO (tira "-") e
  IDADE (zfill 3: o CSV perdeu zeros à esquerda em 89 + 110 registros do RS; sem isso "55" viraria 105 anos).
  PORTÃO: multiconjunto das 14 colunas do RS idêntico ao DORS (104.096 e 93.516) — passou nos dois anos.
- Verificado: DORS*.dbc é por UF de RESIDÊNCIA (100% CODMUNRES 43). IDADE tem 3 caracteres em todos os outros anos.
- Série completa ingerida: 26 anos, 2.160.081 registros de residentes no RS (soma de registros_rs em ingestao_rs.json).
  Nenhum registro com TIPOBITO = 1 (fetal) nos arquivos. 499 códigos distintos de CODMUNRES[:6], incl. 430000 (ignorado).
- Próximo: `baixar_populacao_malha.ps1` (API IBGE: lista e malha municipal; FTP DATASUS: POPSVS).

## Etapa 2 — população, malha, classificação e agregação (18/09/2026)

- `baixar_populacao_malha.ps1` (rodado pela usuária): API IBGE → `municipios_rs.json` (497 municípios),
  `malha_rs_municipios(.minima).geojson` (497 feições, `codarea` de 7 dígitos); FTP DATASUS IBGE/POPSVS →
  POPSBR00..25.zip (26 anos, DBF COD_MUN/ANO/SEXO/IDADE/POP, idade simples 0..79 e 80+). Hashes no pop_geo_log.txt.
- `pipeline/02c_populacao_municipal.py`: retém RS, grava `data/interim/pop_svs_rs_2000_2025.parquet`
  (2.093.364 linhas; 497 municípios em todos os anos; mesmos códigos da lista do IBGE).
- `pipeline/03_04_classificar_agregar_rs.py`: importa faixa_de/idade_anos/classifica e vocabulários do
  03_classificar.py ORIGINAL (nada reescrito); agrega RS + 497 municípios (CODMUNRES[:6]) × 3 sexos × 26 anos.
  Saída: `data/interim/AGG_RS/ano=AAAA.npz`, `resumo.json`, `localidades.json`; classificados em CLASS_RS/.
  Registros fora da lista oficial (ficam só no total RS): 430000 = 65 (município ignorado) e 431453 = 37
  (código não pertence a município do IBGE) na série toda. CAUSABAS nulo: 0.
- Pendente: `baixar_ibge_projecoes.ps1` → planilha IBGE rev. 2024 (mesmo arquivo/hash do original) para a
  população do RS estadual, como decidido. Municípios: MS/SVSA.

## Etapa 3 — montagem do mortality-indexed.json do RS e verificação (18/09/2026)

- População: RS (soma dos 497 municípios da base MS/SVSA) é IDÊNTICA à projeção IBGE rev. 2024 usada pelo
  original nas 1.404 células (3 sexos × 26 anos × 18 faixas). Uma só fonte, e os municípios fecham com o estado.
  `baixar_ibge_projecoes.ps1` ficou OPCIONAL (não é mais necessário).
- `pipeline/05_06_montar_indexed_rs.py` (v1): estourou a memória da VM (2,9 GB) — mantido como registro.
- `pipeline/05_06_montar_indexed_rs_v2.py`: mesmas regras (05 + correções 1 e 2 da rev 15), agregados em numpy,
  JSON escrito tabela a tabela. Saída `data/mortality-indexed.json` (123 MB; 498 localidades × 3 × 26).
  Correção 2 no RS: 1 registro (C53 em homem, 2025). Cobertura: RS = série RIPSA DEM.4.02 da UF (valores do
  arquivo do original, únicos disponíveis offline); municípios null.
- `pipeline/08_assercoes_rs.py`: 10 identidades com 0 violações em 38.844 recortes; 'soma municípios + fora
  da lista == RS' 0/78; alerta de salto > 40% em 6 de 8 subgrupos respiratórios do RS (grupos pequenos, só alerta).
- PROVA FINAL: a fatia RS do novo arquivo é idêntica à fatia RS do site original nas 12 tabelas × 78 recortes
  (inclusive 2022/2023 vindos do CSV republicado, e a cobertura). Log em `data/interim/assercoes_rs.json`.
- Próxima etapa: site (Astro) — copiar o original, trocar dados, malha municipal e rótulos.

## Etapa 3b — Pinto Bandeira (18/09/2026)

- Correção do registro anterior: 4314530 NÃO é "código sem município". É o código histórico de Pinto Bandeira
  (instalado em 2001, extinto em 2002, recriado em 2013 com o código 4314548) — confirmado pela usuária.
- `03_04_classificar_agregar_rs_v2.py`: mapeia CODMUNRES 431453 -> 431454; reagregados 2001 e 2002
  (17 + 20 óbitos passam a contar em Pinto Bandeira). "Fora da lista" fica só 430000 (65 registros).
- `05_06_montar_indexed_rs_v3.py`: célula de Pinto Bandeira = null em 2000 e 2003–2012 (não existia; população
  e óbitos estão em Bento Gonçalves). 33 células nulas (11 anos × 3 sexos). Total do RS inalterado.
- `08_assercoes_rs_v2.py`: pula células nulas (como o verificar() original) e checa que só há 33 nulas.
  Resultado: todas as identidades com 0 violações; fatia RS continua idêntica ao original.

## Etapa 4 — site (18/09/2026)

Feito no ambiente de nuvem (Node 22, 7 GB), porque a VM local tem 2,9 GB e a pasta é sincronizada pelo OneDrive.
Fonte copiada de `causa-mortis-main` (sem node_modules/dist/.git/dados) e adaptada:

- `data/mortality-indexed.json` (RS, 123 MB) e `data/rs-municipalities-simplified.geojson` (IBGE, qualidade mínima,
  4 casas, `name` = 6 dígitos); `public/data/geo/rs-municipalities.geojson` (qualidade intermediária, download).
- `scripts/generate-mortality-data.ts`: nomes da malha e do zip (`causa-mortis-rs-dados-completos.zip`).
- `src/lib/mortality/data.ts` (fetchMunicipalitiesGeoJson), `share.ts` (padrão "RS"), `chart-titles.ts` (rótulos).
- `charts/map.ts` REESCRITO: 497 polígonos sem rótulo, visualMap piecewise com 5 classes por quebras naturais de
  Jenks (`src/lib/mortality/jenks.ts`, algoritmo de Fisher-Jenks), tooltip com nome, código, taxa e óbitos, célula
  null (Pinto Bandeira) fica sem dado; escala estável = quebras sobre todos os anos.
- `charts/evolution.ts`: média móvel centrada de 3 anos, média do período (markLine) e tendência linear (mínimos
  quadrados), opcionais (checkboxes no ChartCard), calculadas sobre a série exibida (território + causa + intervalo);
  colunas incluídas no export CSV/XLSX.
- `charts/quality.ts` REESCRITO: cobertura do SIM do RS em linha (2000–2023), em vez de mapa por UF.
- `custom-select.ts` + `CustomSelect.astro`: opção `searchable` (busca sem acento) usada no seletor de território.
- `summary-stats.ts`: aviso quando o município não existia no ano (célula null).
- Páginas: index (h1), notas (fontes, limitações, Pinto Bandeira, Jenks/tendências, citação), release (reescrita:
  escopo da réplica + créditos aos autores originais; removidos fotos/bios/ícones sociais do time original),
  dados/DataDownloads (malha e zip), Layout/Header/Footer (marca "causamortis RS", sem parceria Desvendados),
  nav "Projeto original" → GitHub do original. CITATION.cff removido (era dos autores originais).
- Config: `.prettierignore` (+ `data/mortality-indexed.json`, senão o prettier estoura a memória), `astro.config.mjs`
  (fonte Sora local via `@fontsource/sora`, pois o provedor remoto é bloqueado; `site` = placeholder
  `https://causa-mortis-rs.vercel.app`, trocar no deploy). Ícone do mapa: Lucide `Map` (BrazilIcon removido).
- Verificação: `npm run build` (prettier --check, eslint, astro check, astro build) passa sem erros/avisos;
  screenshots via Playwright (mapa, evolução com as três linhas, busca no seletor, resumo de Pinto Bandeira 2010,
  notas/cobertura, causas). Único 404: script do Vercel Speed Insights (só existe no Vercel; igual ao original).
- Transferência: `site_rs.tgz` (115 MB, sha256 84b82d30…) em 6 partes de 19 MB (`_transfer/`), reconstituído e
  extraído sem `dist/`; 5.588 arquivos conferidos por tamanho contra a listagem do tar.
- Para rodar localmente: `cd site && npm ci && npm run build && npm run preview` (Node >= 22.12).
- Tamanhos: public/data = 471 MB (zip de CSV 158 MB, sem compressão, como no original; fatias 82 MB; tabelas 82 MB).
