# Sonda variantes de 2022/2023 no bucket oficial e baixa os arquivos do RS no FTP do DATASUS (DORS*.dbc)
$ProgressPreference = "SilentlyContinue"
$base = "https://s3.sa-east-1.amazonaws.com/ckan.saude.gov.br/SIM"
$dst = Join-Path $PSScriptRoot "data\raw\SIM_2022_2023"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$log = Join-Path $dst "sondagem.txt"
"sondagem $(Get-Date -Format s)" | Out-File $log -Encoding utf8
$chaves = @(
 "csv/Mortalidade_Geral_2022_csv.zip","csv/Mortalidade_Geral_2023_csv.zip",
 "csv/DO22OPEN_csv.zip","csv/DO23OPEN_csv.zip","csv/DO22OPEN.csv","csv/DO23OPEN.csv",
 "xml/Mortalidade_Geral_2022_xml.zip","xml/Mortalidade_Geral_2023_xml.zip",
 "json/DO22OPEN_json.zip","json/DO23OPEN_json.zip")
foreach ($k in $chaves) {
  try {
    $r = Invoke-WebRequest -Uri "$base/$k" -Method Head -UseBasicParsing
    $linha = "EXISTE  $k  bytes=$($r.Headers['Content-Length'])  modificado=$($r.Headers['Last-Modified'])"
  } catch { $linha = "nao     $k  ($($_.Exception.Message))" }
  Write-Host $linha; $linha | Out-File $log -Append -Encoding utf8
}
foreach ($k in @("csv/Mortalidade_Geral_2022_csv.zip","csv/Mortalidade_Geral_2023_csv.zip","csv/DO22OPEN_csv.zip","csv/DO23OPEN_csv.zip")) {
  $alvo = Join-Path $dst ($k.Split("/")[-1])
  if (-not (Test-Path $alvo)) { try { Invoke-WebRequest -Uri "$base/$k" -OutFile $alvo -UseBasicParsing; Write-Host "baixado $k" } catch { if (Test-Path $alvo) { Remove-Item $alvo } } }
}
foreach ($a in 2021,2022,2023) {
  $nome = "DORS$a.dbc"; $alvo = Join-Path $dst $nome
  if (-not (Test-Path $alvo)) {
    Write-Host "FTP DATASUS: $nome ..."
    & curl.exe -sS --fail -o $alvo "ftp://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DORES/$nome"
    if ($LASTEXITCODE -ne 0) { "FTP falhou $nome (codigo $LASTEXITCODE)" | Tee-Object -FilePath $log -Append; if (Test-Path $alvo) { Remove-Item $alvo } }
  }
}
Get-ChildItem $dst | ForEach-Object { "{0,-40} {1,12} {2}" -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } | Tee-Object -FilePath $log -Append
Read-Host "Enter para fechar"
