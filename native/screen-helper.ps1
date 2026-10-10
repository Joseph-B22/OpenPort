# Long-running helper for screen memory (home edition). Reads one command per line on stdin, answers with one line of
# JSON on stdout (ASCII only). Uses only Windows' built-in OCR; no images are written to disk.
#   FG            -> which window is in front: {ok, hwnd, title, process, pid, minimized}
#   OCR <base64>  -> read the text in a PNG/JPEG held in memory: {ok, ms, text}
#   QUIT          -> exit
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(-1); $t.Result }

function Send($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) ('\u{0:x4}' -f [int][char]$m.Value) })   # ASCII-only output
  [Console]::Out.WriteLine($json); [Console]::Out.Flush()
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
Send @{ ready = [bool]$engine; languages = $langs; error = $(if ($engine) { $null } else { 'No Windows OCR language is installed for your profile.' }) }
if (-not $engine) { exit 2 }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Split(' ', 2); $cmd = $parts[0]
  try {
    if ($cmd -eq 'QUIT') { break }
    elseif ($cmd -eq 'FG') {
      $h = [Fg]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 512
      $null = [Fg]::GetWindowText($h, $sb, 512)
      $procId = [uint32]0; $null = [Fg]::GetWindowThreadProcessId($h, [ref]$procId)
      $name = ''; try { $name = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch { }
      Send @{ ok = $true; hwnd = [int64]$h; title = $sb.ToString(); process = $name; pid = [int]$procId; minimized = [bool][Fg]::IsIconic($h) }
    }
    elseif ($cmd -eq 'OCR') {
      $t0 = [Diagnostics.Stopwatch]::StartNew()
      $bytes = [Convert]::FromBase64String($parts[1])
      $ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      $dw = New-Object Windows.Storage.Streams.DataWriter($ms)
      $dw.WriteBytes($bytes)
      $null = Await ($dw.StoreAsync()) ([uint32])
      $null = $dw.DetachStream(); $ms.Seek(0)
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ms)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $sw = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      if ($sw.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $sw.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { throw "image too large for OCR ($($sw.PixelWidth)x$($sw.PixelHeight))" }
      $res = Await ($engine.RecognizeAsync($sw)) ([Windows.Media.Ocr.OcrResult])
      $lines = @($res.Lines | ForEach-Object { $_.Text })
      $sw.Dispose(); $ms.Dispose()
      Send @{ ok = $true; ms = [int]$t0.Elapsed.TotalMilliseconds; text = ($lines -join "`n"); width = 0 }
    }
    else { Send @{ ok = $false; error = "unknown command: $cmd" } }
  } catch { Send @{ ok = $false; error = $_.Exception.Message } }
}
