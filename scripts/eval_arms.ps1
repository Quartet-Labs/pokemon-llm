# eval_arms.ps1 -- drive the SFT adapter-vs-base eval end to end on the desktop GPU.
#
# Why a script and not a sequence of SSH commands: each arm is a shim process plus N
# multi-minute episodes, and an SSH-session-launched child dies on disconnect. This is
# launched ONCE via WMI Win32_Process.Create (session-detached) and does the whole
# sequence itself -- shim up, episodes, shim down, next arm, then eval_compare -- so the
# run survives the Pi hanging up and leaves a single readable report.
#
# Arms run SEQUENTIALLY: one 1.5B NF4 shim resident at a time (~2 GiB), so the eval
# cannot evict the transcription worker or a concurrent verify run on the box.
#
# ASCII ONLY. Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so a UTF-8 em-dash
# decodes into a CP1252 smart quote -- which PowerShell honours as a string delimiter
# and the whole file fails to parse. Keep every character in this file 7-bit.
#
# Output: runs/<OutDir>/{run.log, shim-<arm>.log, ep-<arm>-<n>.log, report.txt, DONE}
# OutDir was hardcoded to eval-v1 until 7/29; a re-run silently overwrote the prior
# run's evidence, which is the last thing you want when you are re-running BECAUSE
# the prior run failed. Pass a fresh name per attempt.
param(
    [int]$Episodes = 3,
    [int]$MaxTurns = 300,
    [int]$EpisodeTimeoutMin = 40,
    [string]$OutDir = 'eval-v1'
)

$ErrorActionPreference = 'Continue'
$Repo = 'C:\Users\colca\pokemon-llm'
$Py   = Join-Path $Repo '.venv-train\Scripts\python.exe'
$Out  = Join-Path $Repo (Join-Path 'runs' $OutDir)
$Traj = Join-Path $Repo 'data\trajectories'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$RunLog = Join-Path $Out 'run.log'

function Log($msg) {
    $line = '[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $msg
    Add-Content -Path $RunLog -Value $line
}

function Wait-Health([int]$port, [int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri ("http://localhost:{0}/health" -f $port)
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 5
    }
    return $false
}

function Snapshot-Traj {
    if (Test-Path $Traj) { return @(Get-ChildItem -Path $Traj -Filter *.jsonl | ForEach-Object { $_.Name }) }
    return @()
}

# Benchmark sessions count against the emulator's MAX_SESSIONS cap (4). A
# hard-killed episode (timeout) cannot clean up its own session, and 4 leaked
# sessions make every later POST /benchmark 409 -- the 7/29 run lost sft
# episodes 2 and 3 to exactly this. Sweep OUR OWN arm labels before each
# episode; never touch sessions this eval did not create.
$EmuBase = 'https://pokemon-llm-production.up.railway.app'
function Clear-ArmSessions {
    try {
        $sessions = Invoke-RestMethod -UseBasicParsing -TimeoutSec 15 -Uri ($EmuBase + '/sessions')
    } catch {
        Log ("session sweep: list failed: {0}" -f $_.Exception.Message)
        return
    }
    foreach ($s in @($sessions)) {
        if ($s.label -eq 'ollama:hf-base' -or $s.label -eq 'ollama:hf-sft') {
            try {
                Invoke-RestMethod -UseBasicParsing -Method Delete -TimeoutSec 15 -Uri ($EmuBase + '/session?session=' + $s.sessionId) | Out-Null
                Log ("session sweep: deleted stale {0} ({1})" -f $s.sessionId, $s.label)
            } catch {
                Log ("session sweep: delete {0} failed: {1}" -f $s.sessionId, $_.Exception.Message)
            }
        }
    }
}

# Run one arm: bring its shim up, run $Episodes episodes against it, tear it down.
# Returns the trajectory files that appeared while it ran.
function Invoke-Arm([string]$name, [int]$port, [string]$adapter) {
    $shimLog = Join-Path $Out ("shim-{0}.log" -f $name)
    $shimErr = Join-Path $Out ("shim-{0}.err.log" -f $name)
    $shimArgs = @('scripts\serve_hf.py', '--port', "$port")
    $what = 'base'
    if ($adapter) { $shimArgs += @('--adapter', $adapter); $what = "adapter=$adapter" }
    Log ("arm {0}: starting shim on :{1} {2}" -f $name, $port, $what)
    $shim = Start-Process -FilePath $Py -ArgumentList $shimArgs -WorkingDirectory $Repo -RedirectStandardOutput $shimLog -RedirectStandardError $shimErr -PassThru -WindowStyle Hidden

    if (-not (Wait-Health $port 900)) {
        Log ("arm {0}: shim FAILED to become healthy in 900s, see {1}" -f $name, $shimLog)
        if ($shim -and -not $shim.HasExited) { Stop-Process -Id $shim.Id -Force }
        return @()
    }
    Log ("arm {0}: shim healthy (pid {1})" -f $name, $shim.Id)

    $before = Snapshot-Traj
    for ($i = 1; $i -le $Episodes; $i++) {
        $epLog = Join-Path $Out ("ep-{0}-{1}.log" -f $name, $i)
        $epErr = Join-Path $Out ("ep-{0}-{1}.err.log" -f $name, $i)
        $epArgs = @('-m', 'emulator.runner',
                    '--ollama', ("http://localhost:{0}" -f $port),
                    '--model', ("hf-{0}" -f $name),
                    '--no-think-prefix', '--use-benchmark',
                    '--max-turns', "$MaxTurns")
        Clear-ArmSessions
        Log ("arm {0}: episode {1}/{2} start" -f $name, $i, $Episodes)
        $ep = Start-Process -FilePath $Py -ArgumentList $epArgs -WorkingDirectory $Repo -RedirectStandardOutput $epLog -RedirectStandardError $epErr -PassThru -WindowStyle Hidden
        # A wedged episode must not eat the night: cap it, kill it, keep going. The
        # trajectory file it already wrote is still usable, since eval_compare
        # reconstructs from turn rows when the summary row is missing.
        if (-not $ep.WaitForExit($EpisodeTimeoutMin * 60 * 1000)) {
            Log ("arm {0}: episode {1} exceeded {2}min, killing" -f $name, $i, $EpisodeTimeoutMin)
            try { Stop-Process -Id $ep.Id -Force } catch { }
        } else {
            Log ("arm {0}: episode {1} exit {2}" -f $name, $i, $ep.ExitCode)
        }
    }
    $after = Snapshot-Traj
    $new = @($after | Where-Object { $before -notcontains $_ })
    Log ("arm {0}: {1} new trajectory file(s): {2}" -f $name, $new.Count, ($new -join ', '))

    if ($shim -and -not $shim.HasExited) {
        Log ("arm {0}: stopping shim pid {1}" -f $name, $shim.Id)
        Stop-Process -Id $shim.Id -Force
        Start-Sleep -Seconds 5
    }
    return $new
}

Log '=== eval_arms start ==='
Log ("episodes={0} max_turns={1} timeout={2}min" -f $Episodes, $MaxTurns, $EpisodeTimeoutMin)

$baseFiles = Invoke-Arm 'base' 11435 $null
$sftFiles  = Invoke-Arm 'sft'  11436 'runs/sft-v1'

$cmpArgs = @('scripts\eval_compare.py')
foreach ($f in $baseFiles) { $cmpArgs += ("base=data/trajectories/{0}" -f $f) }
foreach ($f in $sftFiles)  { $cmpArgs += ("sft=data/trajectories/{0}"  -f $f) }

$report = Join-Path $Out 'report.txt'
if ($baseFiles.Count -eq 0 -and $sftFiles.Count -eq 0) {
    Log 'no trajectories from either arm, nothing to compare'
    Set-Content -Path $report -Value 'NO TRAJECTORIES: both arms produced nothing. See run.log / shim logs.'
} else {
    Log ("eval_compare: {0}" -f ($cmpArgs -join ' '))
    $cmp = Start-Process -FilePath $Py -ArgumentList $cmpArgs -WorkingDirectory $Repo -RedirectStandardOutput $report -RedirectStandardError (Join-Path $Out 'report.err.log') -PassThru -WindowStyle Hidden
    $cmp.WaitForExit()
    Log ("eval_compare exit {0}" -f $cmp.ExitCode)
}

Log '=== eval_arms done ==='
Set-Content -Path (Join-Path $Out 'DONE') -Value ((Get-Date).ToString('o'))
