# 换芯 · PC 端推包脚本
#
# 默认走自动通道：推包进收件箱 → 触发搬运 → 等回执 → 冷启动一次，全自动。
# 换芯自己也能这么升级自己（已实测）。想自己挑包时才用 -Manual。
#
# 用法：
#   pwsh -File graft-push.ps1                                  # 自动找包，全自动装好
#   pwsh -File graft-push.ps1 -Package .\xxx.toolpkg           # 指定包，全自动
#   pwsh -File graft-push.ps1 -Manual                          # 只推到 Download，你自己点
#   pwsh -File graft-push.ps1 -NoLaunch                        # 只推不触发搬运
#
# 两条通道：
#   自动 —— 包进收件箱，lifecycle hook 触发搬运，回执确认后冷启动。
#   手动 —— 包放 Download 根，换芯界面里逐个点装，能挑版本、能回退。

param(
    # 要推的 .toolpkg。不给就从当前目录找最新的一个。
    [string]$Package,

    # 手动模式：只把包推到 Download 根，不触发搬运，由你在换芯界面里点。
    [switch]$Manual,

    # 只推不触发搬运（自动模式下包停在收件箱）。
    [switch]$NoLaunch,

    # adb 设备序列号。多设备时必须给，单设备自动选。
    [string]$Device
)

$ErrorActionPreference = "Stop"

$O2_PKG = "app.operit"
$O2_ACTIVITY = "app.operit/.MainActivity"
$DOWNLOAD_DIR = "/sdcard/Download"
$INBOX_DIR = "/sdcard/Download/graft_inbox"
$RESULT_FILE = "$INBOX_DIR/.graft.result"
$GRAB_TIMEOUT_SEC = 30

function Write-Step($msg) { Write-Host "› $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "! $msg" -ForegroundColor Yellow }

# ── 1. 找 adb ────────────────────────────────────────────────
$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    throw "找不到 adb。确认已安装 Android Platform Tools 并在 PATH 里。"
}

# ── 2. 选设备 ────────────────────────────────────────────────
$deviceArgs = @()
if ($Device) {
    $deviceArgs = @("-s", $Device)
} else {
    $lines = & adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\s+device$" }
    if (-not $lines) {
        throw "没有连接的设备。开一下手机的无线调试，或者插上 USB。"
    }
    if ($lines.Count -gt 1) {
        Write-Warn2 "检测到多个设备，用第一个。要指定请加 -Device <序列号>："
        $lines | ForEach-Object { Write-Host "    $($_ -replace '\s+device$','')" }
    }
    $serial = ($lines[0] -replace "\s+device$", "").Trim()
    $deviceArgs = @("-s", $serial)
    Write-Ok "设备 $serial"
}

# ── 3. 找包 ──────────────────────────────────────────────────
if (-not $Package) {
    $candidates = @(Get-ChildItem -Path $PWD -Filter "*.toolpkg" -File |
        Sort-Object LastWriteTime -Descending)
    if (-not $candidates) {
        throw "当前目录没有 .toolpkg。用 -Package 指定路径。"
    }
    if ($candidates.Count -eq 1) {
        $Package = $candidates[0].FullName
        Write-Ok "选中 $($candidates[0].Name)"
    } else {
        Write-Host ""
        Write-Host "当前目录有 $($candidates.Count) 个包，选一个：" -ForegroundColor White
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            $c = $candidates[$i]
            $ago = [math]::Round(((Get-Date) - $c.LastWriteTime).TotalHours, 1)
            Write-Host ("  [{0}] {1}  ({2} KB, {3}h 前)" -f ($i + 1), $c.Name, [math]::Round($c.Length / 1KB, 1), $ago) -ForegroundColor Gray
        }
        Write-Host ""
        $answer = Read-Host "序号（直接回车 = 最新的那个）"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            $Package = $candidates[0].FullName
        } else {
            $idx = 0
            if (-not [int]::TryParse($answer.Trim(), [ref]$idx)) { throw "要输入数字" }
            if ($idx -lt 1 -or $idx -gt $candidates.Count) { throw "序号超出范围" }
            $Package = $candidates[$idx - 1].FullName
        }
        Write-Ok "选中 $((Get-Item $Package).Name)"
    }
}

if (-not (Test-Path $Package)) { throw "找不到文件：$Package" }
$pkgItem = Get-Item $Package
if ($pkgItem.Extension -ne ".toolpkg") {
    throw "不是 .toolpkg 文件：$($pkgItem.Name)"
}

# ── 4. 读包内 manifest，确认身份 ─────────────────────────────
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($pkgItem.FullName)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "manifest.json" }
    if (-not $entry) { throw "包内没有 manifest.json，不是有效 ToolPkg" }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $manifest = $reader.ReadToEnd() | ConvertFrom-Json
    $reader.Close()
} finally {
    $zip.Dispose()
}

$pkgId = $manifest.toolpkg_id
$pkgVer = $manifest.version
if (-not $pkgId) { throw "manifest 缺少 toolpkg_id" }
Write-Ok "$pkgId · v$pkgVer · $([math]::Round($pkgItem.Length / 1KB, 1)) KB"

$displayName = $pkgId
if ($manifest.display_name) {
    if ($manifest.display_name.zh) { $displayName = $manifest.display_name.zh }
    elseif ($manifest.display_name.en) { $displayName = $manifest.display_name.en }
}

# ── 5. 推送 ──────────────────────────────────────────────────
$remoteName = $pkgItem.Name

if (-not $Manual) {
    Write-Step "准备收件箱"
    & adb @deviceArgs shell "mkdir -p $INBOX_DIR" | Out-Null
    # 只清除上次回执，源安装包由用户在换芯中自行选择删除。
    # 不清回执会误判成这次搬运已完成；已处理的旧包由插件台账跳过。
    & adb @deviceArgs shell "rm -f $RESULT_FILE" | Out-Null
    $left = (& adb @deviceArgs shell "ls $RESULT_FILE 2>/dev/null" 2>&1 | Out-String).Trim()
    if ($left -and $left -notmatch "No such file") {
        throw "旧的结果文件删不掉（$left），先手动清一下 $RESULT_FILE"
    }

    Write-Step "推送到 $INBOX_DIR/$remoteName"
    & adb @deviceArgs push $pkgItem.FullName "$INBOX_DIR/" 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "推送失败" }
} else {
    Write-Step "推送到 $DOWNLOAD_DIR/$remoteName"
    & adb @deviceArgs push $pkgItem.FullName "$DOWNLOAD_DIR/" 2>&1 | Out-String | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "推送失败" }
}

$target = if (-not $Manual) { "$INBOX_DIR/$remoteName" } else { "$DOWNLOAD_DIR/$remoteName" }
$exists = & adb @deviceArgs shell "ls $target" 2>&1
if ($LASTEXITCODE -ne 0) { throw "推送后手机上看不到文件" }

# adb push 保留源文件的 mtime，重推同一个包时 size/mtime 完全不变，
# 换芯的台账会当成"搬过了"跳过。touch 一下让 mtime 真正变成这次推送的时间。
if (-not $Manual) {
    & adb @deviceArgs shell "touch $target" | Out-Null
}
Write-Ok "文件已到位"

# ── 6. 拉起 O2 / 触发搬运 ────────────────────────────────────
function Start-O2 {
    & adb @deviceArgs shell "am start -n $O2_ACTIVITY" 2>&1 | Out-Null
}

function Get-O2Pid {
    $t = (& adb @deviceArgs shell "pidof $O2_PKG" 2>&1 | Out-String).Trim()
    if ($t -match "^\d+") { return $t } else { return "" }
}

function Restart-O2 {
    & adb @deviceArgs shell "am force-stop $O2_PKG" | Out-Null
    # 等进程真的消失，这比猜时长可靠
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-O2Pid)) { break }
        Start-Sleep -Milliseconds 250
    }
    Start-O2
}

if ($Manual) {
    if (-not $NoLaunch) {
        Write-Step "打开 O2"
        Start-O2
        Write-Ok "已拉起，去换芯里点安装"
    }
} elseif ($NoLaunch) {
    # -NoLaunch：只推包，不触发搬运
    Write-Warn2 "用了 -NoLaunch，包停在收件箱里，没触发搬运"
} else {
    # 步骤 1：先判断 O2 在不在跑
    $pidText = Get-O2Pid
    if ($pidText) {
        Write-Ok "O2 在运行（pid $($pidText.Split()[0])），走 foreground 通道"
        & adb @deviceArgs shell "input keyevent KEYCODE_HOME" | Out-Null
        Start-Sleep -Milliseconds 1200
        Start-O2
    } else {
        Write-Warn2 "O2 没在跑，走 on_create 通道"
        Start-O2
        Write-Warn2 "create 事件的搬运在扫描之后，搬进去的包这次启动看不到 —— 后面会再冷启动一次"
    }

    # 步骤 2：等结果文件，不等时间
    Write-Step "等换芯搬包（最多 $GRAB_TIMEOUT_SEC 秒）"
    $deadline = (Get-Date).AddSeconds($GRAB_TIMEOUT_SEC)
    $result = ""
    while ((Get-Date) -lt $deadline) {
        $raw = (& adb @deviceArgs shell "cat $RESULT_FILE 2>/dev/null" 2>&1 | Out-String).Trim()
        if ($raw -and $raw -notmatch "No such file") {
            $result = $raw
            break
        }
        Start-Sleep -Milliseconds 600
    }

    if (-not $result) {
        throw "等了 $GRAB_TIMEOUT_SEC 秒没等到搬包结果。包还留在收件箱，O2 没被动过 —— 检查换芯是否启用、收件箱路径对不对。"
    }
    Write-Ok "换芯回报：$result"

    # 出错就停：失败和异常都不重启，免得把问题状态盖过去
    if ($result -match "failed" -or $result -match "ERROR") {
        throw "换芯搬包出错，不重启：$result"
    }
    # 刚推完包却报 nothing to do，说明没搬 —— 同样停下不发重启
    if ($result -match "nothing to do") {
        throw "推完包换芯却说没东西可搬，不重启：$result`n（常见原因：目标文件和台账记录的 size/mtime 一致，被当成装过了）"
    }

    # 步骤 3：确认搬完了，再冷启动一次
    Write-Step "冷启动一次，让新包生效"
    Restart-O2
    Write-Ok "完成"
}

# ── 7. 收尾提示 ──────────────────────────────────────────────
Write-Host ""
Write-Host "────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " $displayName  v$pkgVer" -ForegroundColor White
if (-not $Manual) {
    if ($NoLaunch) {
        Write-Host " 已放进收件箱，没触发搬运" -ForegroundColor Yellow
    } else {
        Write-Host " 已搬入并重启过" -ForegroundColor Green
    }
} else {
    Write-Host " 已推到 Download" -ForegroundColor Green
    Write-Host " 打开换芯 → 找到 $displayName → 点 [安装/更新/重装]" -ForegroundColor Gray
}
Write-Host "────────────────────────────────────────────" -ForegroundColor DarkGray
