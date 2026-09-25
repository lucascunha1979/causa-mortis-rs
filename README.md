# Causa Mortis RS

**Site:** https://lucascunha1979.github.io/causa-mortis-rs/

Réplica geográfica do painel [Causa Mortis](https://causamortis.net) (Zanchetta Jr., Weise e Veloso, licença MIT) para o Rio Grande do Sul e seus 497 municípios, construída com [Astro](https://astro.build) e [ECharts](https://echarts.apache.org/). Mesma lógica, mesmas regras de classificação e os mesmos gráficos do original; muda só a dimensão geográfica, e os dados foram extraídos de novo, diretamente das fontes oficiais.

## Como citar

Este painel é uma réplica geográfica do **Causa Mortis** (ZANCHETTA JR., Celso; WEISE, Franklin; VELOSO, Pedro. _Causa Mortis: mortalidade no Brasil, causa por causa_. Versão 1.0. 2026. https://causamortis.net · https://github.com/causa-mortis-brasil/causa-mortis · MIT). Ao citar este repositório, cite também o projeto original. Os metadados de citação, com a referência ao original, estão em [`CITATION.cff`](CITATION.cff).

## Fontes dos dados

- **Óbitos:** SIM (Sistema de Informações sobre Mortalidade), microdados do Portal de Dados Abertos do SUS (2000–2025; 2022 e 2023 do CSV republicado em setembro de 2026, validado contra `DORS2022/2023.dbc` do FTP do DATASUS).
- **População:** estimativas MS/SVSA por município, sexo e idade simples (FTP DATASUS `IBGE/POPSVS`, 2000–2025). Somadas, reproduzem a projeção IBGE rev. 2024 do estado.
- **Malha:** API de malhas do IBGE (municípios do RS).
- **Cobertura do SIM:** indicador DEM.4.02 da RIPSA, só por UF (municípios ficam sem valor).
- **Padronização:** NT nº 51/2025-CGIAE — direta, 18 faixas, população-padrão Brasil 2022.
- **Causas:** fichas MRT.3.01, MRT.4.01–04, MRT.5.02 e MRT.5.04.

## O que difere do original

- Territórios: `RS` + 497 municípios (chave = 6 primeiros dígitos do código IBGE).
- Mapa: cinco classes por quebras naturais de Jenks (`src/lib/mortality/jenks.ts`), sem rótulos por polígono.
- Evolução: média móvel de 3 anos, média do período e tendência linear opcionais.
- Nova aba "Faixa etária": filtro com as 18 faixas e grupos amplos (1–14, 15–29, 30–59, 60–79); ranking de causas (e subgrupos/tipos/meios) por sexo em óbitos, taxa por 100 mil da faixa ou % da faixa, tabela exportável e evolução 2000–2025 dentro da faixa.
- Cobertura do SIM: série do estado em linha (`/notas`), em vez de mapa por UF.
- Seletor de território com busca.
- Fonte Sora servida localmente (`@fontsource/sora`) em vez do provedor remoto.

## Pipeline

Os scripts que geram `data/mortality-indexed.json` estão em `pipeline/` (Python 3.11+, pandas, pyarrow, ijson, datasus-dbc, dbfread), com o inventário passo a passo em `docs/` e os scripts de download para Windows em `scripts-download/`. Eles esperam a pasta `causa-mortis-main` (o repositório original) ao lado deste diretório: de lá vêm o `03_classificar.py`, o `sim_files.csv` e o `mortality-indexed.json` usados como molde e como referência de validação. O `data/mortality-indexed.json` (123 MB) excede o limite do GitHub e está no repositório como `mortality-indexed.json.gz` (10 MB), que o script de geração lê diretamente; `public/data/` contém tudo o que o site precisa já gerado. Depois de regenerar o arquivo:

```
npm run data:generate
npm run build
```

Este painel tem finalidade didática e de divulgação. Para análise técnica e formulação de política pública, recomenda-se a extração dos dados diretamente no DataSUS.

## Publicação

O site é publicado no GitHub Pages pelo workflow `.github/workflows/deploy-pages.yml` a cada push na `main`. O build recebe `SITE_URL` e `BASE_PATH` do próprio Pages (o site fica em `/causa-mortis-rs/`); todos os caminhos internos passam por `withBase()` (`src/lib/base-path.ts`). Sem essas variáveis, o build continua servindo na raiz, como no original.
