# Downloads llama.cpp Windows builds into engine\vulkan and engine\cpu.
# Run once on a machine with internet, then carry the folder to the offline machine.
param([string]$Tag = "b11457")

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$base = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag"
$builds = @{
  vulkan = "llama-$Tag-bin-win-vulkan-x64.zip"
  cpu    = "llama-$Tag-bin-win-cpu-x64.zip"
}

foreach ($name in $builds.Keys) {
  $zip = Join-Path $env:TEMP $builds[$name]
  $dest = Join-Path $root "engine\$name"
  Write-Host "Downloading $($builds[$name]) ..."
  curl.exe -L --fail -o $zip "$base/$($builds[$name])"
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Expand-Archive $zip -DestinationPath $dest
  Remove-Item $zip
  Write-Host "  -> $dest"
}
Write-Host "Done. llama.cpp $Tag installed."
