# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  SolveWatch AI — Windows Startup Script (PowerShell)
#
#  Usage:
#    .\start.ps1              — start all services
#    .\start.ps1 --setup      — first-time setup then start
#    .\start.ps1 --setup-only — install deps only, don't start
#    .\start.ps1 --newlogs    — clear logs then start
#    .\start.ps1 --debug      — enable DEBUG log level for transcriber
#
#  Requirements: PowerShell 5.1+ (built into Windows 10/11)
#  Run once if needed: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

param(
    [switch]$Setup,
    [switch]$SetupOnly,
    [switch]$NewLogs,
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# ── Colours ───────────────────────────────────────────────────────────────────
function Log  ($m) { Write-Host "[start] $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "[  ok ] $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "[ warn] $m" -ForegroundColor Yellow }
function Info ($m) { Write-Host "[ info] $m" -ForegroundColor Blue }
function Die  ($m) { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }
function Section ($m) { Write-Host "`n  $m" -ForegroundColor White }

# ── Read port from config ─────────────────────────────────────────────────────
$NodePort = 4000
try {
    $cfg = Get-Content "$ScriptDir\config\api-keys.json" -Raw | ConvertFrom-Json
    if ($cfg.port) { $NodePort = $cfg.port }
} catch {}

# ── Tracked processes for cleanup ─────────────────────────────────────────────
$script:Pids = @()
$script:OllamaStarted = $false

function Cleanup {
    Log "Shutting down all services..."
    foreach ($pid in $script:Pids) {
        try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
    }
    if ($script:OllamaStarted) {
        Log "Stopping Ollama..."
        try { Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force } catch {}
    }
    Ok "All services stopped."
}

# Register Ctrl+C handler
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup }

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  SETUP SECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if ($Setup -or $SetupOnly) {

    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
    Write-Host "  SolveWatch AI — First-Time Setup (Windows)" -ForegroundColor White
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White

    # ── Node.js ──────────────────────────────────────────────────────────────
    Section "1/5  Node.js"
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Ok "Node.js $(node --version) already installed."
    } else {
        Log "Node.js not found. Attempting install via winget..."
        try {
            winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
            Ok "Node.js installed."
        } catch {
            Die "Node.js not found. Install from: https://nodejs.org/en/download  (LTS, add to PATH)"
        }
    }

    # ── Python 3 ─────────────────────────────────────────────────────────────
    Section "2/5  Python 3"
    $py = $null
    foreach ($cmd in @("python", "python3", "py")) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) { $py = $cmd; break }
    }
    if ($py) {
        Ok "Python found: $py $(& $py --version)"
    } else {
        Log "Python not found. Attempting install via winget..."
        try {
            winget install Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
            $py = "python"
            Ok "Python installed."
        } catch {
            Die "Python not found. Install from: https://www.python.org/downloads  (check 'Add to PATH')"
        }
    }

    # ── Ollama ───────────────────────────────────────────────────────────────
    Section "3/5  Ollama (local LLM)"
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Ok "Ollama already installed."
    } else {
        Log "Installing Ollama..."
        try {
            winget install Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
            Ok "Ollama installed."
        } catch {
            Warn "Could not auto-install Ollama. Download from: https://ollama.com/download"
        }
    }

    # Pull model
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        $ollamaModel = "llama3.2:1b"
        try { $ollamaModel = (Get-Content "$ScriptDir\config\api-keys.json" -Raw | ConvertFrom-Json).ollama_model } catch {}
        if (-not $ollamaModel) { $ollamaModel = "llama3.2:1b" }
        Log "Starting Ollama server for model pull..."
        $srv = Start-Process ollama -ArgumentList "serve" -PassThru -WindowStyle Hidden
        Start-Sleep 3
        Log "Pulling Ollama model: $ollamaModel (first run may take a few minutes)..."
        & ollama pull $ollamaModel
        Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    }

    # ── npm install ───────────────────────────────────────────────────────────
    Section "4/5  Node.js dependencies"
    Log "Running npm install..."
    & npm install --silent
    Ok "Node.js packages installed."

    # ── Python venv + requirements ────────────────────────────────────────────
    Section "5/5  Python transcriber dependencies"
    $TranscriberDir = "$ScriptDir\transcriber"
    if (-not (Test-Path "$TranscriberDir\venv")) {
        Log "Creating Python virtual environment..."
        & $py -m venv "$TranscriberDir\venv"
    }
    Log "Installing Python dependencies (Windows: openai-whisper instead of MLX)..."
    & "$TranscriberDir\venv\Scripts\pip.exe" install -q --upgrade pip
    & "$TranscriberDir\venv\Scripts\pip.exe" install -q -r "$TranscriberDir\requirements-windows.txt"
    Ok "Python venv ready."

    # ── Summary ───────────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
    Write-Host "  Setup complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host "  1. Add API keys at: http://localhost:$NodePort/settings  (after starting)"
    Write-Host "  2. Keys you may need (need at least one):"
    Write-Host "     OpenAI  -> https://platform.openai.com/api-keys" -ForegroundColor Yellow
    Write-Host "     Grok    -> https://console.groq.com/keys" -ForegroundColor Yellow
    Write-Host "     Gemini  -> https://aistudio.google.com/app/apikey" -ForegroundColor Yellow
    Write-Host "  3. Whisper model: go to Settings > STT and click Download"
    Write-Host "     (tiny=75MB fastest, small=465MB recommended, large=2.9GB best)"
    Write-Host "  4. Start the app:  .\start.ps1"
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
    Write-Host ""

    if ($SetupOnly) { exit 0 }
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  RUNTIME SECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Find Python ───────────────────────────────────────────────────────────────
$py = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $py = $cmd; break }
}
if (-not $py) { Die "python not found. Run: .\start.ps1 --setup" }

# ── Check node_modules ────────────────────────────────────────────────────────
if (-not (Test-Path "$ScriptDir\node_modules\.bin\electron.cmd")) {
    Warn "node_modules missing or incomplete. Running npm install..."
    & npm install --silent
}

# ── Read config ───────────────────────────────────────────────────────────────
$WhisperModel = "small"
$AudioInputDevice = ""
try {
    $cfg = Get-Content "$ScriptDir\config\api-keys.json" -Raw | ConvertFrom-Json
    if ($cfg.stt_model)         { $WhisperModel = $cfg.stt_model }
    if ($cfg.audio_input_device){ $AudioInputDevice = $cfg.audio_input_device }
} catch {}

# ── Log setup ─────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "$ScriptDir\logs" | Out-Null
$PythonLog = "$ScriptDir\logs\transcriber.log"

if ($NewLogs) {
    Log "Clearing all logs..."
    Remove-Item "$ScriptDir\logs\*" -Force -ErrorAction SilentlyContinue
    Ok "Logs cleared."
}

# ── Ollama ────────────────────────────────────────────────────────────────────
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    $running = Get-Process ollama -ErrorAction SilentlyContinue
    if (-not $running) {
        Log "Starting Ollama server..."
        $ollamaProc = Start-Process ollama -ArgumentList "serve" -PassThru -WindowStyle Hidden
        $script:Pids += $ollamaProc.Id
        $script:OllamaStarted = $true
        Start-Sleep 2
        Ok "Ollama started (PID $($ollamaProc.Id))."
    } else {
        Ok "Ollama already running."
    }
} else {
    Warn "Ollama not installed — local LLM classifier unavailable. Run: .\start.ps1 --setup"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host "  SolveWatch AI — starting services" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host ""

# ── Wait-for-port helper ──────────────────────────────────────────────────────
function Wait-ForPort($port, $label, $maxWait = 30) {
    Log "Waiting for $label on port $port..."
    $elapsed = 0
    while ($elapsed -lt $maxWait) {
        try {
            $conn = New-Object System.Net.Sockets.TcpClient
            $conn.Connect("127.0.0.1", $port)
            $conn.Close()
            Ok "$label is up."
            return
        } catch {
            Start-Sleep 1
            $elapsed++
        }
    }
    Die "$label did not start within ${maxWait}s. Check logs."
}

# ── 1. Node.js backend ────────────────────────────────────────────────────────
Log "Starting Node.js backend (port $NodePort)..."
$nodeProc = Start-Process node -ArgumentList "src/server.js" -PassThru -WindowStyle Hidden -RedirectStandardOutput NUL
$script:Pids += $nodeProc.Id
Wait-ForPort $NodePort "Node.js backend"

# ── 2. Python transcriber ─────────────────────────────────────────────────────
$TranscriberDir = "$ScriptDir\transcriber"
if (-not (Test-Path "$TranscriberDir\venv")) {
    Log "Creating Python virtual environment (first time)..."
    & $py -m venv "$TranscriberDir\venv"
    & "$TranscriberDir\venv\Scripts\pip.exe" install -q --upgrade pip
    & "$TranscriberDir\venv\Scripts\pip.exe" install -q -r "$TranscriberDir\requirements-windows.txt"
    Ok "Python venv ready."
} else {
    & "$TranscriberDir\venv\Scripts\pip.exe" install -q -r "$TranscriberDir\requirements-windows.txt"
}

$LogLevel = if ($Debug) { "DEBUG" } else { "INFO" }
$env:WHISPER_MODEL       = $WhisperModel
$env:AUDIO_INPUT_DEVICE  = $AudioInputDevice
$env:LOG_LEVEL           = $LogLevel
$env:WHISPER_BACKEND     = "local"   # Always use openai-whisper on Windows

Log "Starting Python transcriber (model: $WhisperModel)..."
$pyProc = Start-Process "$TranscriberDir\venv\Scripts\python.exe" `
    -ArgumentList "$TranscriberDir\main.py" `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $PythonLog `
    -RedirectStandardError  $PythonLog
$script:Pids += $pyProc.Id
Ok "Python transcriber started (PID $($pyProc.Id))."

# ── 3. Electron HUD ───────────────────────────────────────────────────────────
Log "Starting Electron HUD..."
$electronExe = "$ScriptDir\node_modules\.bin\electron.cmd"
$electronProc = Start-Process $electronExe -ArgumentList "electron/main.js" -PassThru -WindowStyle Hidden
$script:Pids += $electronProc.Id
Ok "Electron HUD started (PID $($electronProc.Id))."

# ── Status summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host "  All services running" -ForegroundColor Green
Write-Host ""
Write-Host "  Node.js      → PID $($nodeProc.Id)"
Write-Host "  Transcriber  → PID $($pyProc.Id)"
Write-Host "  Electron HUD → PID $($electronProc.Id)"
Write-Host ""
Write-Host "  Settings page → http://localhost:$NodePort/settings" -ForegroundColor Cyan
Write-Host "  Toggle HUD    → Ctrl+Shift+H"
Write-Host "  Stop all      → Ctrl+C"
Write-Host ""
Write-Host "  STT model: $WhisperModel  (backend: openai-whisper CPU)"
Write-Host "  Log level: $LogLevel"
Write-Host "  Log file:  logs\transcriber.log"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Yellow

# ── Tail logs live ────────────────────────────────────────────────────────────
Write-Host ""
Log "Tailing transcriber.log (Ctrl+C to stop)..."
Get-Content $PythonLog -Wait -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[transcriber] $_" -ForegroundColor Yellow
}
