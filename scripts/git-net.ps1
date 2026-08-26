<#
.SYNOPSIS
    Git 网络操作超时安全包装脚本（Windows PowerShell）

.DESCRIPTION
    针对与 GitHub 云端交互的 Git 命令（push / pull / fetch / clone / ls-remote /
    remote / submodule / archive 等）施加超时控制：
      - 超过超时阈值自动终止对应 Git 进程，并返回明确的超时提示
      - 本地操作（commit / branch / checkout / log / status / merge / tag 等）
        直接透传执行，不施加超时，确保本地开发流程完全不受远程连接状态影响

.PARAMETER Command
    要执行的 Git 子命令（如 push / pull / fetch / clone / commit）

.PARAMETER CommandArgs
    Git 子命令的后续参数（原样透传给 git）

.EXAMPLE
    # 推送（默认 30 秒超时）
    .\scripts\git-net.ps1 push origin develop

    # 拉取并指定 60 秒超时
    $env:GIT_NET_TIMEOUT = 60
    .\scripts\git-net.ps1 pull origin develop

    # 克隆仓库（受超时保护）
    .\scripts\git-net.ps1 clone https://github.com/user/repo.git

    # 本地提交（无超时，直接执行）
    .\scripts\git-net.ps1 commit -m "wip"

.NOTES
    - 超时阈值：默认 30 秒，可用环境变量 GIT_NET_TIMEOUT 调整（正整数秒）
    - 超时退出码：124（与标准 timeout 工具约定一致，便于脚本判断）
    - 正常完成时透传 git 原退出码与输出
    - 本地操作无论是否联网均不受影响；超时后本地工作区与提交保持完整
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

# ---------- 配置 ----------

# 与云端交互的命令白名单（其余一律视为本地操作）
$cloudCommands = @(
    'push', 'pull', 'fetch', 'clone', 'ls-remote',
    'remote', 'submodule', 'archive'
)

# 超时阈值（秒）：默认 30，可用环境变量 GIT_NET_TIMEOUT 覆盖
$timeoutSec = 30
if ($env:GIT_NET_TIMEOUT) {
    $parsed = 0
    if ([int]::TryParse($env:GIT_NET_TIMEOUT, [ref]$parsed) -and $parsed -gt 0) {
        $timeoutSec = $parsed
    }
    else {
        Write-Warning "[git-net] GIT_NET_TIMEOUT 取值无效（$env:GIT_NET_TIMEOUT），使用默认 30 秒"
    }
}

# 临时输出文件目录（优先项目 .tmp，避免系统 TEMP 权限限制）
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmpDir = Join-Path (Resolve-Path (Join-Path $scriptRoot '..')).Path '.tmp'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# 生成唯一临时文件（进程退出后清理）
$stamp = [guid]::NewGuid().ToString('N')
$tmpOut = Join-Path $tmpDir "gitnet-out-$stamp.log"
$tmpErr = Join-Path $tmpDir "gitnet-err-$stamp.log"

$fullCommand = $Command + ' ' + ($CommandArgs -join ' ')

# ---------- 本地操作：直接透传，不设超时 ----------
if ($Command -notin $cloudCommands) {
    Write-Host "[git-net] 本地操作（不设超时）：git $fullCommand"
    # 显式构造参数数组后透传（规避 PS 5.1 字符串 splatting 兼容问题）
    $localArgs = @($Command) + @($CommandArgs)
    & git $localArgs
    exit $LASTEXITCODE
}

# ---------- 云端操作：带超时执行 ----------
Write-Host "[git-net] 云端操作（超时 ${timeoutSec}s）：git $fullCommand"

$process = $null
try {
    $process = Start-Process -FilePath 'git' `
        -ArgumentList (@($Command) + $CommandArgs) `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $tmpOut `
        -RedirectStandardError $tmpErr

    # 在超时时间内等待退出；返回是否在期限内完成
    if (-not $process.WaitForExit($timeoutSec * 1000)) {
        # -------- 超时处理：终止进程及其子进程 --------
        $children = Get-CimInstance Win32_Process |
            Where-Object { $_.ParentProcessId -eq $process.Id }
        foreach ($child in $children) {
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue

        Write-Host ''
        Write-Warning '========== Git 网络操作超时 =========='
        Write-Warning "命令：git $fullCommand"
        Write-Warning "超时阈值：${timeoutSec} 秒（可用 `$env:GIT_NET_TIMEOUT 调整）"
        Write-Warning '已自动终止该网络操作；本地代码与提交不受影响。'
        Write-Host ''
        Write-Host '== 截至超时的输出 =='
        if (Test-Path $tmpOut) { Get-Content $tmpOut -ErrorAction SilentlyContinue }
        if (Test-Path $tmpErr) { Get-Content $tmpErr -ErrorAction SilentlyContinue }
        Write-Host ''
        Write-Host '== 网络诊断与重试建议 =='
        Write-Host '  1. 连通性检测：ping github.com'
        Write-Host '        Test-NetConnection github.com -Port 443'
        Write-Host '  2. 代理检查：git config --global --get http.proxy'
        Write-Host '        若配置了代理，请确认代理服务可用（本地 Clash/V2Ray 等）'
        Write-Host '  3. 远程地址核对：git remote -v（确认 HTTPS/SSH 地址无误）'
        Write-Host '  4. 重试策略：直接重新执行本命令即可；'
        Write-Host '        若为慢网络，可临时提高阈值：$env:GIT_NET_TIMEOUT=60'
        Write-Host '  5. 本地安全说明：超时不影响本地提交与分支，网络恢复后重试即可'
        exit 124
    }

    # -------- 正常完成：透传输出与退出码 --------
    if (Test-Path $tmpOut) { Get-Content $tmpOut }
    if (Test-Path $tmpErr) { Get-Content $tmpErr -ErrorAction SilentlyContinue }
    exit $process.ExitCode
}
finally {
    # 清理临时输出文件
    Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
}
