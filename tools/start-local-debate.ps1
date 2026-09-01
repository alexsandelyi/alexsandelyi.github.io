param(
  [ValidateSet('codex', 'gemini', 'mock')]
  [string]$ModeratorProvider = 'codex',
  [ValidateSet('codex', 'gemini', 'mock')]
  [string]$Participant1Provider = 'gemini',
  [ValidateSet('codex', 'gemini', 'mock')]
  [string]$Participant2Provider = 'codex',
  [ValidateSet('codex', 'gemini', 'mock')]
  [string]$Participant3Provider = 'codex'
)

$projectRoot = Split-Path -Parent $PSScriptRoot

function Open-Terminal([string]$title, [string]$command) {
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $projectRoot -ArgumentList @(
    '-NoExit',
    '-Command',
    "`$Host.UI.RawUI.WindowTitle = '$title'; $command"
  )
}

Open-Terminal '일빵 토론 중계 서버' 'node .\tools\local-debate-relay.mjs'
Open-Terminal '일빵 토론장 웹페이지' 'python -m http.server 8899'
Start-Sleep -Milliseconds 500
Open-Terminal "일빵 사회자 [$ModeratorProvider]" "node .\tools\local-debate-agent.mjs --room latest --role 사회자 --provider $ModeratorProvider"
Open-Terminal "일빵 토론자1 [$Participant1Provider]" "node .\tools\local-debate-agent.mjs --room latest --role 토론자1 --provider $Participant1Provider"
Open-Terminal "일빵 토론자2 [$Participant2Provider]" "node .\tools\local-debate-agent.mjs --room latest --role 토론자2 --provider $Participant2Provider"
Open-Terminal "일빵 토론자3 [$Participant3Provider]" "node .\tools\local-debate-agent.mjs --room latest --role 토론자3 --provider $Participant3Provider"

Write-Host '로컬 토론 실험용 터미널을 열었습니다.'
Write-Host '브라우저에서 http://127.0.0.1:8899/ai-discussion/ 을 열고 방을 시작하세요.'
Write-Host '종료할 때는 열린 각 터미널에서 Ctrl+C를 누르세요.'
