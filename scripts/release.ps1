# 一键发布：检查 → 测试 → 提交 → 推送 GitHub → 输出固定版本安装地址
# 用法：powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Message "feat: 说明"
param([string]$Message = "")

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[1/5] 语法检查" -ForegroundColor Cyan
node --check bili-subtitle.user.js
if ($LASTEXITCODE -ne 0) { throw "语法检查失败，已中止" }

Write-Host "[2/5] 单测 / 文档一致性 / 宣传断言" -ForegroundColor Cyan
node tests/run-tests.js
if ($LASTEXITCODE -ne 0) { throw "单测失败，已中止" }
node tests/check-docs.js
if ($LASTEXITCODE -ne 0) { throw "文档不一致（版本号/用例数），已中止" }
node tests/test-claims.js
if ($LASTEXITCODE -ne 0) { throw "宣传断言不一致，已中止" }

Write-Host "[3/5] 提交" -ForegroundColor Cyan
$dirty = git status --porcelain
if ($dirty) {
  if ($Message -eq "") { $Message = "chore: release " + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
  git add -A
  git commit -m $Message
} else {
  Write-Host "  工作区没有改动，跳过提交" -ForegroundColor Yellow
}

Write-Host "[4/5] 推送 GitHub" -ForegroundColor Cyan
git push ghssh HEAD:main
if ($LASTEXITCODE -ne 0) { throw "推送失败，检查 SSH 或网络" }

Write-Host "[5/5] 校验远端与固定版本地址" -ForegroundColor Cyan
$sha = (git rev-parse --short HEAD).Trim()
$raw = "https://raw.githubusercontent.com/huanweide/bili-subtitle-universal/$sha/bili-subtitle.user.js"
$cdn = "https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@$sha/bili-subtitle.user.js"
$ver = (Select-String -Path bili-subtitle.user.js -Pattern "@version\s+(\S+)" | Select-Object -First 1).Matches.Groups[1].Value

try {
  $head = (Invoke-WebRequest -Uri $raw -Method Head -UseBasicParsing -TimeoutSec 30).StatusCode
  Write-Host "  raw 可访问：$head" -ForegroundColor Green
} catch {
  Write-Host "  raw 校验失败（网络或刚推送未生效）：$($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "已同步 GitHub：$sha  ·  版本 $ver" -ForegroundColor Green
Write-Host "固定版本安装地址（立即生效，不受 CDN 缓存影响）："
Write-Host "  $cdn"
