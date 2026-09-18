# Baixa (1) lista e malha municipal do RS na API do IBGE e (2) populacao municipal por sexo e idade (MS/SVSA) no FTP do DATASUS
$ProgressPreference = "SilentlyContinue"
$dst = Join-Path $PSScriptRoot "data\raw\POP_GEO"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$log = Join-Path $PSScriptRoot "data\raw\pop_geo_log.txt"
"execucao $(Get-Date -Format s)" | Out-File $log -Encoding utf8
function Registra($t) { Write-Host $t; $t | Out-File $log -Append -Encoding utf8 }

$ibge = @{
 "municipios_rs.json" = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/43/municipios"
 "malha_rs_municipios.geojson" = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/43?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio"
 "malha_rs_municipios_minima.geojson" = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/43?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio"
}
foreach ($k in $ibge.Keys) {
  try { Invoke-WebRequest -Uri $ibge[$k] -OutFile (Join-Path $dst $k) -UseBasicParsing; Registra "ok IBGE $k" }
  catch { Registra "FALHA IBGE $k : $($_.Exception.Message)" }
}

$ftp = "ftp://ftp.datasus.gov.br/dissemin/publicos/IBGE/"
foreach ($d in @("", "POPSVS/", "POPSVS/DOCS/", "POP/", "POPTCU/", "projpop/")) {
  Registra "=== listagem $ftp$d"
  $l = & curl.exe -sS --retry 5 --retry-delay 10 --retry-all-errors "$ftp$d" 2>&1
  $l | Out-File $log -Append -Encoding utf8
  if ($d -eq "POPSVS/") { $arquivos = $l | ForEach-Object { ($_ -split "\s+")[-1] } | Where-Object { $_ -match "^POPS(BR|RS)\d\d\.(dbc|zip|DBC|ZIP)$" } }
}
foreach ($a in $arquivos) {
  $alvo = Join-Path $dst $a
  if (-not (Test-Path $alvo)) {
    & curl.exe -sS --fail --retry 5 --retry-delay 10 --retry-all-errors -o $alvo "$($ftp)POPSVS/$a"
    if ($LASTEXITCODE -ne 0) { Registra "FALHA FTP $a"; if (Test-Path $alvo) { Remove-Item $alvo } } else { Registra "ok FTP $a" }
  }
}
Get-ChildItem $dst | ForEach-Object { Registra ("{0,-42} {1,12} {2}" -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()) }
Read-Host "Enter para fechar"
