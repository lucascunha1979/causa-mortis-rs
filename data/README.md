# Dados de mortalidade

Há duas bases com a mesma estrutura, uma por local do óbito, e uma tabela de fluxos:

- `mortality-indexed.json.gz`: por **residência** (CODMUNRES). RS = residentes no RS.
- `mortality-indexed-ocorrencia.json.gz`: por **ocorrência** (CODMUNOCOR). RS = óbitos ocorridos no RS,
  inclusive de não residentes. O denominador é a população residente do município (a única estimada).
- `fluxos_rs.json.gz`: pares município de residência → município de ocorrência, por ano, sexo e causa,
  para os óbitos de residentes no RS ou ocorridos no RS.

As bases (RS + 497 municípios, aninhadas por índice; ver `dimensions` para resolver cada índice ao
rótulo) são geradas por `../pipeline/05_06_montar_indexed_rs_v5.py res|ocor` e verificadas por
`../pipeline/08_assercoes_rs_v4.py res|ocor`; os fluxos, por `../pipeline/07_fluxos_rs.py`, que confere
seus totais com as duas bases. Descompactada, cada base tem cerca de 155 MB, acima do limite de 100 MB do
GitHub, por isso o repositório guarda só os `.gz` (`gzip -9`). O script de geração lê o `.json`, se
existir, ou o `.gz`.

`rs-municipalities-simplified.geojson` é a malha municipal usada pelo mapa (API de malhas do
IBGE, qualidade mínima, coordenadas com 4 casas; `properties.name` = 6 primeiros dígitos do
código IBGE). A malha em qualidade intermediária fica em `public/data/geo/rs-municipalities.geojson`,
mantida intacta para a seção de download.

Nenhum desses arquivos-fonte é servido ao navegador. `scripts/generate-mortality-data.ts`
os lê e gera, em `public/data/mortality/` (residência), `public/data/mortality/ocorrencia/` (ocorrência)
e `public/data/mortality/fluxos/<versão>/` (um arquivo por ano):

- as tabelas completas (`*.json`/`*.csv`, todos os territórios juntos), usadas
  pela seção de download do site;
- fatias por território em `by-location/<versão>/<tabela>/<território>.json`,
  usadas pelos gráficos que só olham para o território ativo no filtro (todos
  menos o mapa, que precisa comparar todos os territórios ao mesmo tempo).

O `<versão>` é um hash do conteúdo de `mortality-indexed.json`, o que permite
cachear essas fatias de forma imutável no navegador. O mesmo vale para a cópia
versionada do geojson simplificado em `public/data/geo/versioned/<hash>/`.

`src/lib/mortality/data-manifest.json` guarda a versão atual e é lido pelo
código do site para montar essas URLs — não editar à mão.

Os arquivos gerados não ficam no repositório (`.gitignore`): o workflow de publicação roda o script
antes do build. Para trabalhar localmente, rode:

```
npm run data:generate
```
