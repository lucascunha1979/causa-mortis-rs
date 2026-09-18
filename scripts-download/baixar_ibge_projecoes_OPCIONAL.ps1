# Baixa a planilha de projecoes do IBGE (rev. 2024, idade simples) usada pelo projeto original e confere o SHA-256
$ProgressPreference = "SilentlyContinue"
$dst = Join-Path $PSScriptRoot "data\raw\IBGE"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$alvo = Join-Path $dst "projecoes_2024_tab1_idade_simples.xlsx"
$esperado = "6e5c3d21a2e8ff50badd7be2785e1664b41a43277543be541641b0cd802c3205"
$urls = @(
 "https://ftp.ibge.gov.br/Projecao_da_Populacao/Projecao_da_Populacao_2024/projecoes_2024_tab1_idade_simples.xlsx",
 "https://ftp.ibge.gov.br/Projecao_da_Populacao/Projecao_da_Populacao_2024/projecoes_2024_tab1_idade_simples.xlsx"
)
if (-not (Test-Path $alvo)) {
  foreach ($u in $urls) { try { Invoke-WebRequest -Uri $u -OutFile $alvo -UseBasicParsing; Write-Host "baixado de $u"; break } catch { Write-Host "falhou $u : $($_.Exception.Message)" } }
}
if (Test-Path $alvo) {
  $h = (Get-FileHash $alvo -Algorithm SHA256).Hash.ToLower()
  $estado = if ($h -eq $esperado) { "igual ao manifesto do original" } else { "DIFERENTE do manifesto ($h)" }
  Write-Host ("{0}  {1} bytes  {2}" -f (Split-Path $alvo -Leaf), (Get-Item $alvo).Length, $estado)
  "$(Get-Date -Format s) $h $estado" | Out-File (Join-Path $dst "hash.txt") -Encoding utf8
}
Read-Host "Enter para fechar"
