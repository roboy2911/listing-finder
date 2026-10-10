# Listing Finder local server: http://localhost:8765
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8765]
#
# Serves the web page and forwards searches to the APIs (browsers can't call them directly):
#   POST /api/ebay   {image: <base64 jpeg>}  -> eBay Browse API "search by image" (EBAY_AU)
#   POST /api/lens   {image: <base64 jpeg>}  -> Google Lens via SerpApi (image hosted briefly on imgbb)
#   GET  /api/img?url=<https image>          -> image proxy so the page can compare thumbnails
#   GET  /api/status                         -> which API keys are configured
# Keys live in config.json (copy config.example.json). Only listens on localhost.
param([int]$Port = 8765)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.md' = 'text/markdown; charset=utf-8'
}

function Get-Config {
  $path = Join-Path $root 'config.json'
  if (Test-Path $path) { Get-Content $path -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
}

function Test-Key($value) { $value -and $value -notmatch '^YOUR_' }

$script:ebayToken = $null
$script:ebayTokenExpires = [datetime]::MinValue

function Get-EbayToken($cfg) {
  if ($script:ebayToken -and (Get-Date) -lt $script:ebayTokenExpires) { return $script:ebayToken }
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($cfg.ebayClientId):$($cfg.ebayClientSecret)"))
  $r = Invoke-RestMethod -Method Post -Uri 'https://api.ebay.com/identity/v1/oauth2/token' `
    -Headers @{ Authorization = "Basic $basic" } -ContentType 'application/x-www-form-urlencoded' `
    -Body 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  $script:ebayToken = $r.access_token
  $script:ebayTokenExpires = (Get-Date).AddSeconds([int]$r.expires_in - 120)
  $script:ebayToken
}

function Search-Ebay($cfg, $imageB64) {
  if (-not ((Test-Key $cfg.ebayClientId) -and (Test-Key $cfg.ebayClientSecret))) { throw 'eBay API keys not set in config.json' }
  $token = Get-EbayToken $cfg
  $body = @{ image = $imageB64 } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri 'https://api.ebay.com/buy/browse/v1/item_summary/search_by_image?limit=50' `
    -Headers @{ Authorization = "Bearer $token"; 'X-EBAY-C-MARKETPLACE-ID' = 'EBAY_AU'; 'X-EBAY-C-ENDUSERCTX' = 'contextualLocation=country=AU' } `
    -ContentType 'application/json' -Body $body
}

function Search-Lens($cfg, $imageB64) {
  if (-not (Test-Key $cfg.serpApiKey)) { throw 'SerpApi key not set in config.json' }
  if (-not (Test-Key $cfg.imgbbApiKey)) { throw 'imgbb key not set in config.json' }
  # Google Lens needs a public image URL, so host it on imgbb for 10 minutes.
  $up = Invoke-RestMethod -Method Post -Uri "https://api.imgbb.com/1/upload?expiration=600&key=$($cfg.imgbbApiKey)" `
    -ContentType 'application/x-www-form-urlencoded' -Body ('image=' + [Uri]::EscapeDataString($imageB64))
  $imgUrl = $up.data.url
  $base = "https://serpapi.com/search.json?engine=google_lens&country=au&hl=en&api_key=$($cfg.serpApiKey)&url=$([Uri]::EscapeDataString($imgUrl))"
  $all = Invoke-RestMethod -Uri $base
  $exact = $null
  try { $exact = Invoke-RestMethod -Uri "$base&type=exact_matches" } catch { Write-Host "Lens exact matches failed: $_" }
  @{ visual_matches = @($all.visual_matches); exact_matches = @($exact.exact_matches) }
}

function Send-Json($res, $obj, [int]$status = 200) {
  $res.StatusCode = $status
  $res.ContentType = 'application/json; charset=utf-8'
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 20 -Compress))
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Read-Body($req) {
  $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd(); $reader.Close()
  $text | ConvertFrom-Json
}

function Send-ProxiedImage($req, $res) {
  $url = $req.QueryString['url']
  if ($url -notmatch '^https://') { $res.StatusCode = 400; return }
  $wc = New-Object Net.WebClient
  $wc.Headers.Add('User-Agent', 'Mozilla/5.0 ListingFinder')
  $bytes = $wc.DownloadData($url)
  $ct = $wc.ResponseHeaders['Content-Type']
  if ($ct -notmatch '^image/') { $res.StatusCode = 415; return }
  $res.ContentType = $ct
  $res.Headers.Add('Cache-Control', 'max-age=3600')
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Listing Finder running at http://localhost:$Port  (Ctrl+C to stop)"
if (-not (Test-Path (Join-Path $root 'config.json'))) {
  Write-Host 'No config.json yet: copy config.example.json to config.json and add your API keys.'
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      $cfg = Get-Config
      switch -Regex ($path) {
        '^api/status$' {
          Send-Json $res @{
            ebay = [bool]((Test-Key $cfg.ebayClientId) -and (Test-Key $cfg.ebayClientSecret))
            lens = [bool]((Test-Key $cfg.serpApiKey) -and (Test-Key $cfg.imgbbApiKey))
          }
        }
        '^api/ebay$' {
          try { Send-Json $res (Search-Ebay $cfg (Read-Body $req).image) }
          catch { Write-Host "eBay error: $_"; Send-Json $res @{ error = "$_" } 502 }
        }
        '^api/lens$' {
          try { Send-Json $res (Search-Lens $cfg (Read-Body $req).image) }
          catch { Write-Host "Lens error: $_"; Send-Json $res @{ error = "$_" } 502 }
        }
        '^api/img$' {
          try { Send-ProxiedImage $req $res } catch { $res.StatusCode = 502 }
        }
        default {
          if ($path -eq '') { $path = 'index.html' }
          $file = [IO.Path]::GetFullPath((Join-Path $root $path))
          $ext = [IO.Path]::GetExtension($file).ToLower()
          # Never serve config.json (it holds the API keys)
          if ($file.StartsWith($root) -and $types[$ext] -and (Split-Path $file -Leaf) -ne 'config.json' -and (Test-Path $file -PathType Leaf)) {
            $bytes = [IO.File]::ReadAllBytes($file)
            $res.ContentType = $types[$ext]
            $res.Headers.Add('Cache-Control', 'no-cache')
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
          } else {
            $res.StatusCode = 404
          }
        }
      }
    } catch {
      Write-Host "Error: $_"
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
