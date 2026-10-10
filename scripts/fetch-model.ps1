# Downloads a model + its vision projector into models\<name>\ (resumable).
# Usage:  .\scripts\fetch-model.ps1 -Preset main     (13.3 GB + 1.1 GB, best quality)
#         .\scripts\fetch-model.ps1 -Preset fast     (6.3 GB + 0.2 GB, quick on laptop CPU)
#         .\scripts\fetch-model.ps1 -Preset embed    (0.3 GB, powers chat memory search)
param([ValidateSet("main", "fast", "embed")][string]$Preset = "main")

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$presets = @{
  main = @{
    dir  = "gemma-4-26b-a4b"
    repo = "unsloth/gemma-4-26B-A4B-it-qat-GGUF"
    files = @("gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf", "mmproj-F16.gguf")
  }
  embed = @{
    dir  = "embeddings\embeddinggemma-2"
    repo = "unsloth/embeddinggemma-2-GGUF"
    files = @("embeddinggemma-2-Q8_0.gguf")
  }
  fast = @{
    dir  = "gemma-4-12b"
    repo = "unsloth/gemma-4-12b-it-qat-GGUF"
    files = @("gemma-4-12B-it-qat-UD-Q4_K_XL.gguf", "mmproj-F16.gguf")
  }
}

$p = $presets[$Preset]
$dest = Join-Path $root "models\$($p.dir)"
New-Item -ItemType Directory -Force $dest | Out-Null

foreach ($f in $p.files) {
  Write-Host "Downloading $f ..."
  curl.exe -L --fail -C - -o (Join-Path $dest $f) "https://huggingface.co/$($p.repo)/resolve/main/$f"
}
Write-Host "Done -> $dest"
