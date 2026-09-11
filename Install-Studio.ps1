$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if(-not(Test-Path -LiteralPath '.venv\Scripts\python.exe')){python -m venv .venv}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if($LASTEXITCODE -ne 0){throw 'Python dependency installation failed'}
npm.cmd ci
if($LASTEXITCODE -ne 0){throw 'Web dependency installation failed'}
npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'Web build failed'}
Write-Host 'Installation complete. Run Start-Studio.cmd.'
