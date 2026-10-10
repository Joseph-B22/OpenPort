# Builds the app and assembles a portable folder you can copy to a flash drive or external SSD.
#
#   .\scripts\make-portable.ps1 -Target E:\OpenPort                    # app + engines + models
#   .\scripts\make-portable.ps1 -Target E:\OpenPort -WorkEdition       # CPU engine only, work-friendly defaults
#   .\scripts\make-portable.ps1 -Target E:\OpenPort -SkipBuild         # reuse the last build in dist\win-unpacked
#   .\scripts\make-portable.ps1 -Target E:\OpenPort -NoModels          # app + engines only (add models later)
#
# The target drive must be NTFS or exFAT (FAT32 cannot hold files over 4 GB). Use a USB 3 SSD: a 14 GB model
# loads in seconds from an SSD and minutes from a cheap flash stick.
param(
  [Parameter(Mandatory)][string]$Target,
  [switch]$WorkEdition,      # CPU engine only; writes data\config.json with CPU backend and an approved-publisher list
  [switch]$NoModels,         # do not copy the models folder
  [switch]$SkipBuild         # skip "npm run pack"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# ---- sanity checks before touching anything ----
$drive = (Get-Item $Target -ErrorAction SilentlyContinue)
$letter = ($Target -replace '^([A-Za-z]):.*', '$1')
$vol = Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
if (-not $vol) { throw "Drive $letter`: not found." }
if ($vol.FileSystem -notin 'NTFS', 'exFAT') { throw "$letter`: is $($vol.FileSystem). Models are over 4 GB, so the drive must be NTFS or exFAT. (Reformatting erases the drive: do it yourself.)" }
foreach ($need in 'engine\cpu\llama-server.exe') { if (-not (Test-Path (Join-Path $root $need))) { throw "Missing $need. Run scripts\fetch-engine.ps1 first." } }

$sizeGB = 0.5
if (-not $WorkEdition) { $sizeGB += (Get-ChildItem engine\vulkan -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB }
if (-not $NoModels)    { $sizeGB += (Get-ChildItem models -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB }
$freeGB = $vol.SizeRemaining / 1GB
Write-Host ("Needs about {0:N1} GB, {1} has {2:N1} GB free." -f $sizeGB, "$letter`:", $freeGB)
if ($sizeGB -gt $freeGB) { throw "Not enough free space on $letter`:." }

# ---- build ----
if (-not $SkipBuild) {
  Write-Host "Building the app (this takes a minute or two) ..."
  npm run pack
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}
$app = Join-Path $root "dist\win-unpacked"
if (-not (Test-Path (Join-Path $app "OpenPort.exe"))) { throw "dist\win-unpacked\OpenPort.exe not found. Run without -SkipBuild." }

# ---- assemble ----
New-Item -ItemType Directory -Force $Target | Out-Null
Write-Host "Copying the app ..."
robocopy $app $Target /E /NFL /NDL /NJH /NP /R:2 /W:2 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the app failed (robocopy $LASTEXITCODE)." }

Write-Host "Copying the engine ..."
New-Item -ItemType Directory -Force (Join-Path $Target "engine") | Out-Null
robocopy (Join-Path $root "engine\cpu") (Join-Path $Target "engine\cpu") /E /NFL /NDL /NJH /NP | Out-Null
if (-not $WorkEdition -and (Test-Path "engine\vulkan")) { robocopy (Join-Path $root "engine\vulkan") (Join-Path $Target "engine\vulkan") /E /NFL /NDL /NJH /NP | Out-Null }

if (-not $NoModels -and (Test-Path "models")) {
  Write-Host "Copying models (this is the slow part) ..."
  robocopy (Join-Path $root "models") (Join-Path $Target "models") /E /NFL /NDL /NJH /NP /R:2 /W:2 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying models failed (robocopy $LASTEXITCODE)." }
}

# ---- settings for this copy (never copies your chats or logs) ----
$dataDir = Join-Path $Target "data"
New-Item -ItemType Directory -Force $dataDir | Out-Null
$cfg = @{}
if ($WorkEdition) {
  # Screen memory (reads the text of your windows) is a HOME feature. In the work edition it is switched off in the settings
  # AND its helper script is removed from the copy, so it cannot run even if someone edits the config.
  $cfg = @{
    backend = "cpu"; contextSize = 8192; allowedPublishers = @("google", "Qwen", "unsloth"); allowDownloads = $true
    allowScreenMemory = $false
  }
  Remove-Item (Join-Path $Target "resources\app\native\screen-helper.ps1") -Force -ErrorAction SilentlyContinue
}
# Written WITHOUT a byte-order mark: Windows PowerShell's "Set-Content -Encoding UTF8" adds one, which older readers choke on.
if ($cfg.Count -and -not (Test-Path (Join-Path $dataDir "config.json"))) {
  [System.IO.File]::WriteAllText((Join-Path $dataDir "config.json"), ($cfg | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
}

@"
OpenPort (portable)

Start:   double-click OpenPort.exe
Folders: engine\ (the model runner), models\ (model files), data\ (your chats, settings, activity log)

- Everything stays in this folder. Nothing is installed on the computer.
- Chats and settings live in data\. Keep this drive encrypted (BitLocker To Go) if it holds anything sensitive.
- Windows may show a SmartScreen warning the first time: the app is not code-signed.
- To add or swap models: open the app, then Models.
"@ | Set-Content (Join-Path $Target "README.txt") -Encoding UTF8

Write-Host ""
Write-Host "Done: $Target"
Write-Host "Run it by double-clicking $Target\OpenPort.exe"
