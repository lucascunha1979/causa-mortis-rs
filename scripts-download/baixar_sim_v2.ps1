# Baixa os 26 arquivos do SIM (fonte original: Portal de Dados Abertos do SUS) e confere SHA-256
# Uso: botao direito > Executar com PowerShell  (ou: powershell -ExecutionPolicy Bypass -File baixar_sim.ps1)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$base = "https://s3.sa-east-1.amazonaws.com/ckan.saude.gov.br/SIM"
$dst = Join-Path $PSScriptRoot "data\raw\SIM"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$arquivos = @(
  @{ano=2000; nome="Mortalidade_Geral_2000_csv.zip"; fmt="csv"; sha="ae08ac18472f4a4a75dbe2cc1ffa2e65e1e1087e13cacac180ce5a23a73ac6d3"}
  @{ano=2001; nome="Mortalidade_Geral_2001_csv.zip"; fmt="csv"; sha="4a9765d92ea19ed5145a44c3da11ad5b140521d89b9cb47d52e6d9d39c2f7e82"}
  @{ano=2002; nome="Mortalidade_Geral_2002_csv.zip"; fmt="csv"; sha="f16dccce4676e0a44905ccd57e971e9eadc63e604df90e1b3dedaa88dcc7567e"}
  @{ano=2003; nome="Mortalidade_Geral_2003_csv.zip"; fmt="csv"; sha="5206c1e8b301ce5cb386979c85c2d0b45248fe73a6b144b3a32a302f6d9a78ef"}
  @{ano=2004; nome="Mortalidade_Geral_2004_csv.zip"; fmt="csv"; sha="1d68a50d8849f5cadf795202b14c543415bb57653ea99ea1ea734d2e543aae7b"}
  @{ano=2005; nome="Mortalidade_Geral_2005_csv.zip"; fmt="csv"; sha="b019f28a7c6a2edc0069e133087e0c5da278c09e4c7732a673ffe3d3224951b2"}
  @{ano=2006; nome="Mortalidade_Geral_2006_csv.zip"; fmt="csv"; sha="7614020e647ea21f7d58a15ba7962ee8ba4d9d8e14a4bbce4211b7ac0127e253"}
  @{ano=2007; nome="Mortalidade_Geral_2007_csv.zip"; fmt="csv"; sha="b7b3f871e864217260a7bd8ff3bc4c564fca0279380801788b125eae782435e1"}
  @{ano=2008; nome="Mortalidade_Geral_2008_csv.zip"; fmt="csv"; sha="3656d614b13c33afbfd86cc76c3a5357e6289588bcf896482cdd7d440d38e504"}
  @{ano=2009; nome="Mortalidade_Geral_2009_csv.zip"; fmt="csv"; sha="13de831a870f96da503725757641b0fb90e4d73ae91a548275e6b8c30124b0b7"}
  @{ano=2010; nome="Mortalidade_Geral_2010_csv.zip"; fmt="csv"; sha="304e577de1e87f5f0eb8db9af3e8550722679a61758d7cb86b3744462d25fdc9"}
  @{ano=2011; nome="Mortalidade_Geral_2011_csv.zip"; fmt="csv"; sha="78b21b2868c802ff9b2e6ec651777d10778b8a63ee263ba349e0655d2e5b9aa2"}
  @{ano=2012; nome="Mortalidade_Geral_2012_csv.zip"; fmt="csv"; sha="31fe02bbd54e275e1fff6eafcc509af4804f6cf8ac5787782a9b4c8d7283f8ce"}
  @{ano=2013; nome="Mortalidade_Geral_2013_csv.zip"; fmt="csv"; sha="98491e61587590667ca88acf63af47e3ad3755aabd082380cfd831c70f7b6a29"}
  @{ano=2014; nome="Mortalidade_Geral_2014_csv.zip"; fmt="csv"; sha="a66f562380838d050e0460c10d18b01e534f2b206a86de322fe5cace512d0d1a"}
  @{ano=2015; nome="Mortalidade_Geral_2015_csv.zip"; fmt="csv"; sha="4a7c1cc3444c730cfecfbbe0f682072a5efb36e7dafa5ab0f88348766a6d29d4"}
  @{ano=2016; nome="Mortalidade_Geral_2016_csv.zip"; fmt="csv"; sha="55476c5591858484db259fdf469bf3787e6042aec96f323eccdb3e35528abb17"}
  @{ano=2017; nome="Mortalidade_Geral_2017_csv.zip"; fmt="csv"; sha="c2ab78d74faeefecb2d6546f1992b14522666684e9e0177a67e0d04df9232893"}
  @{ano=2018; nome="Mortalidade_Geral_2018_csv.zip"; fmt="csv"; sha="9d9807bde1a745562504473332add042031b43212792d8aba7d746e11b6dd1f4"}
  @{ano=2019; nome="Mortalidade_Geral_2019_csv.zip"; fmt="csv"; sha="66501b7348ad77d8e88bcb6306d86dc555496fe65258333440998f2472c66480"}
  @{ano=2020; nome="Mortalidade_Geral_2020_csv.zip"; fmt="csv"; sha="ac626dff18876eaa572f724966fb05cd5f42529fc6bdd5507ce5dfbd08146142"}
  @{ano=2021; nome="Mortalidade_Geral_2021_csv.zip"; fmt="csv"; sha="6a8fe8077cf11cbf2ae8d783d4b786968de4e7606ca52c2a04c97d864aa89e4f"}
  @{ano=2022; nome="Mortalidade_Geral_2022_json.zip"; fmt="json"; sha="526df16fcb76764353132c0b07e8f815f0168cedc092d56c0da013edee3ef31e"}
  @{ano=2023; nome="Mortalidade_Geral_2023_json.zip"; fmt="json"; sha="91ab051319c0632c4204fb3337a9b8dac59f922f0ea3e0c1035a066d122b5e18"}
  @{ano=2024; nome="DO24OPEN_csv.zip"; fmt="csv"; sha="13db250c90908e85d1ef9fb9cd7caa08583fb1912108b0f3260605aca0e9b787"}
  @{ano=2025; nome="DO25OPEN_csv.zip"; fmt="csv"; sha="583c974e3973c6b17ed1e4d20e6f110d953e7efa2a8f98c7772f5b80cec29f9c"}
)
$log = @()
foreach ($a in $arquivos) {
  $alvo = Join-Path $dst $a.nome
  if (-not (Test-Path $alvo)) {
    Write-Host "baixando $($a.nome) ..."
    $tmp = "$alvo.parcial"
    $ok = $false
    for ($t = 1; $t -le 6 -and -not $ok; $t++) {
      try { Invoke-WebRequest -Uri "$base/$($a.fmt)/$($a.nome)" -OutFile $tmp; $ok = $true }
      catch { Write-Host "  tentativa $t falhou ($($_.Exception.Message)); aguardando 20 s"; Start-Sleep -Seconds 20 }
    }
    if (-not $ok) { throw "nao foi possivel baixar $($a.nome) apos 6 tentativas" }
    Move-Item $tmp $alvo
  }
  $h = (Get-FileHash $alvo -Algorithm SHA256).Hash.ToLower()
  $estado = if ($h -eq $a.sha) { "igual" } else { "DIFERENTE (republicado pela fonte ou download corrompido)" }
  Write-Host ("{0}  {1,-40} {2}" -f $a.ano, $a.nome, $estado)
  $log += [pscustomobject]@{ano=$a.ano; arquivo=$a.nome; bytes=(Get-Item $alvo).Length; sha256=$h; vs_manifesto=$estado}
}
$log | Export-Csv (Join-Path $PSScriptRoot "data\raw\baixados.csv") -NoTypeInformation -Encoding UTF8
Write-Host "concluido. Log em data\raw\baixados.csv"
Read-Host "Enter para fechar"
