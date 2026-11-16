param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$manager = Get-Command pnpm.cmd,pnpm.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$prefixArgs = @()
if (-not $manager) {
    $manager = Get-Command corepack.cmd -ErrorAction SilentlyContinue
    $prefixArgs = @('pnpm')
}
if (-not $manager) {
    throw 'Install Node.js >= 22.22.2 and pnpm (npm.cmd install --global pnpm@11.25.0), then run this script again.'
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'apps/web/node_modules/.bin/vite.cmd'))) {
    & $manager.Source @prefixArgs install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $manager.Source @prefixArgs --filter '@md/web' run dev --host 127.0.0.1 --port $Port --strictPort
exit $LASTEXITCODE
