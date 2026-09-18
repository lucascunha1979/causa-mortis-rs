# Dados de mortalidade

`mortality-indexed.json` é a base bruta usada pelos gráficos do site (RS + 497 municípios,
aninhados por índice — ver `dimensions` para resolver cada índice ao rótulo correspondente).
É gerado por `../pipeline/05_06_montar_indexed_rs_v3.py` e verificado por
`../pipeline/08_assercoes_rs_v2.py`.

`rs-municipalities-simplified.geojson` é a malha municipal usada pelo mapa (API de malhas do
IBGE, qualidade mínima, coordenadas com 4 casas; `properties.name` = 6 primeiros dígitos do
código IBGE). A malha em qualidade intermediária fica em `public/data/geo/rs-municipalities.geojson`,
mantida intacta para a seção de download.

Nenhum desses arquivos-fonte é servido ao navegador. `scripts/generate-mortality-data.ts`
os lê e gera, em `public/data/mortality/`:

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

Rodar sempre que `mortality-indexed.json` for atualizado:

```
npm run data:generate
```
