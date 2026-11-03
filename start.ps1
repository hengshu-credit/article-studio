$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'Please install pnpm 11.25.0, then run this script again.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& pnpm dev
exit $LASTEXITCODE
