param([int]$Port=7868,[string]$BindAddress='0.0.0.0',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$studioRoot=$PSScriptRoot
$studioPython=Join-Path $studioRoot '.venv\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $studioPython)){ $studioPython=(Get-Command python).Source }
$studioLogs=Join-Path $studioRoot 'data\logs'
New-Item -ItemType Directory -Path $studioLogs -Force | Out-Null
$studioUrl="http://127.0.0.1:$Port"
try {
    $studioHealth=Invoke-RestMethod "$studioUrl/api/health" -TimeoutSec 2
    if($studioHealth.app -eq '安影'){
        if(-not $NoBrowser){Start-Process $studioUrl}
        Write-Host "Studio is already running: $studioUrl"
        exit 0
    }
}catch{}
if(-not (Test-Path -LiteralPath (Join-Path $studioRoot 'dist\index.html'))){throw 'Run Install-Studio.ps1 first to build the web interface.'}
$env:PYTHONUTF8='1'
$studioProcess=Start-Process -FilePath $studioPython -ArgumentList '-m','uvicorn','backend.app:app','--host',$BindAddress,'--port',"$Port" -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $studioLogs 'server.stdout.log') -RedirectStandardError (Join-Path $studioLogs 'server.stderr.log') -PassThru
$studioProcess.Id | Set-Content -LiteralPath (Join-Path $studioRoot 'data\server.pid')
for($studioAttempt=0;$studioAttempt -lt 30;$studioAttempt++){
    Start-Sleep -Seconds 1
    if($studioProcess.HasExited){throw 'Studio exited. Check data/logs/server.stderr.log.'}
    try{
        $studioHealth=Invoke-RestMethod "$studioUrl/api/health" -TimeoutSec 2
        if($studioHealth.status -eq 'ok'){
            if(-not $NoBrowser){Start-Process $studioUrl}
            Write-Host "Studio: $studioUrl"
            Write-Host 'Other computers: http://this-PC-LAN-IP:7868. Use the same studio password.'
            exit 0
        }
    }catch{}
}
throw 'Studio did not become ready. Check data/logs.'
