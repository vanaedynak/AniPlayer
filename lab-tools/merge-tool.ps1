# Окно для обмена работой между основным проектом и лабораторией (копией для Gemini).
# Обе стороны: что нового, слияние в отдельной ветке, проверка сборки, и только после «Да» — в main и на GitHub.
# Свои у каждой копии файлы (имя приложения, правила для Gemini, эти скрипты, скриншоты .proof) не переезжают.
param(
  [string]$Main = (Split-Path $PSScriptRoot -Parent),
  [string]$Lab = 'D:\Projects\Anyflow-Lab'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$Keep = @('app/flavor.json', '.github/workflows/pages.yml', 'AGENTS.md', 'GEMINI.md', 'LAB.md', '.agent', 'lab-tools', '.proof')

# --- the window -------------------------------------------------------------------------------------------

$form = New-Object Windows.Forms.Form
$form.Text = 'Anyflow: основной проект и лаборатория'
$form.Size = New-Object Drawing.Size(860, 640)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::FromArgb(18, 20, 28)
$form.ForeColor = [Drawing.Color]::White
$form.Font = New-Object Drawing.Font('Segoe UI', 10)

function New-Box($x, $title) {
  $g = New-Object Windows.Forms.GroupBox
  $g.Text = $title
  $g.ForeColor = [Drawing.Color]::White
  $g.Location = New-Object Drawing.Point($x, 10)
  $g.Size = New-Object Drawing.Size(410, 230)
  $list = New-Object Windows.Forms.ListBox
  $list.Location = New-Object Drawing.Point(10, 25)
  $list.Size = New-Object Drawing.Size(390, 150)
  $list.BackColor = [Drawing.Color]::FromArgb(28, 31, 42)
  $list.ForeColor = [Drawing.Color]::Gainsboro
  $list.BorderStyle = 'None'
  $btn = New-Object Windows.Forms.Button
  $btn.Location = New-Object Drawing.Point(10, 182)
  $btn.Size = New-Object Drawing.Size(390, 38)
  $btn.FlatStyle = 'Flat'
  $btn.BackColor = [Drawing.Color]::FromArgb(20, 160, 140)
  $btn.ForeColor = [Drawing.Color]::White
  $btn.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
  $g.Controls.AddRange(@($list, $btn))
  $form.Controls.Add($g)
  return @{ Box = $g; List = $list; Button = $btn }
}

$fromLab = New-Box 10 'Новое в лаборатории (Gemini)'
$fromLab.Button.Text = 'Забрать в основной проект'
$toLab = New-Box 430 'Новое в основном проекте'
$toLab.Button.Text = 'Отправить в лабораторию'

$log = New-Object Windows.Forms.RichTextBox
$log.Location = New-Object Drawing.Point(10, 250)
$log.Size = New-Object Drawing.Size(830, 290)
$log.BackColor = [Drawing.Color]::FromArgb(10, 11, 16)
$log.ForeColor = [Drawing.Color]::Gainsboro
$log.Font = New-Object Drawing.Font('Consolas', 9)
$log.ReadOnly = $true
$log.BorderStyle = 'None'
$form.Controls.Add($log)

$refresh = New-Object Windows.Forms.Button
$refresh.Text = 'Обновить списки'
$refresh.Location = New-Object Drawing.Point(10, 550)
$refresh.Size = New-Object Drawing.Size(180, 36)
$refresh.FlatStyle = 'Flat'
$form.Controls.Add($refresh)

$hint = New-Object Windows.Forms.Label
$hint.Text = "Основной: $Main    Лаборатория: $Lab"
$hint.Location = New-Object Drawing.Point(200, 558)
$hint.Size = New-Object Drawing.Size(640, 24)
$hint.ForeColor = [Drawing.Color]::Gray
$form.Controls.Add($hint)

function Say($text, $color = 'Gainsboro') {
  $log.SelectionStart = $log.TextLength
  $log.SelectionColor = [Drawing.Color]::FromName($color)
  $log.AppendText("$text`r`n")
  $log.ScrollToCaret()
  [Windows.Forms.Application]::DoEvents()
}

function Busy($on) {
  foreach ($b in @($fromLab.Button, $toLab.Button, $refresh)) { $b.Enabled = -not $on }
  $form.Cursor = if ($on) { 'WaitCursor' } else { 'Default' }
}

# --- running commands without freezing the window ---------------------------------------------------------

function Run([string]$exe, [string]$arguments, [string]$cwd, [switch]$Show) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = $arguments
  $psi.WorkingDirectory = $cwd
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $p = [Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  while (-not $p.HasExited) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 40 }
  $p.WaitForExit()
  $r = [pscustomobject]@{ Code = $p.ExitCode; Out = $out.Result.Trim(); Err = $err.Result.Trim() }
  if ($Show) {
    $tail = (($r.Out + "`n" + $r.Err).Trim() -split "`n" | Select-Object -Last 12) -join "`n"
    if ($tail) { Say $tail 'DimGray' }
  }
  return $r
}
function Git($repo, $arguments) { Run 'git' $arguments $repo }
function Npm($repo, $arguments) { Run 'cmd.exe' "/c npm $arguments" (Join-Path $repo 'app') -Show }

function Ensure-Remote($repo, $name, $url) {
  if ((Git $repo "remote get-url $name").Code -ne 0) { Git $repo "remote add $name `"$url`"" | Out-Null }
  else { Git $repo "remote set-url $name `"$url`"" | Out-Null }
  Git $repo "remote set-url --push $name DISABLED" | Out-Null
}

function Pending($repo, $remote) {
  if ((Git $repo "fetch -q $remote main").Code -ne 0) { return $null }
  $r = Git $repo "log --oneline --no-merges HEAD..$remote/main"
  # the comma keeps an empty list a list (PowerShell would hand back $null, read as "couldn't fetch")
  if (-not $r.Out) { return , @() }
  return , @($r.Out -split "`n" | ForEach-Object { $_.Trim() })
}

function Load-Lists {
  Busy $true
  foreach ($side in @(@{ S = $fromLab; Repo = $Main; Remote = 'lab'; Url = $Lab }, @{ S = $toLab; Repo = $Lab; Remote = 'main-local'; Url = $Main })) {
    $side.S.List.Items.Clear()
    if (-not (Test-Path (Join-Path $side.Repo '.git'))) { $side.S.List.Items.Add("Не нашёл проект: $($side.Repo)") | Out-Null; continue }
    Ensure-Remote $side.Repo $side.Remote $side.Url
    $items = Pending $side.Repo $side.Remote
    if ($null -eq $items) { $side.S.List.Items.Add('Не получилось прочитать другую копию') | Out-Null }
    elseif (-not $items.Count) { $side.S.List.Items.Add('Ничего нового') | Out-Null }
    else { $items | ForEach-Object { $side.S.List.Items.Add($_) | Out-Null } }
  }
  Busy $false
}

# --- one merge, the same both ways ------------------------------------------------------------------------

function Merge-Into($repo, $remote, $prefix, $message, $pushTarget) {
  Say ''
  Say "=== $message → $repo" 'Cyan'
  if ((Git $repo 'status --porcelain --untracked-files=no').Out) { Say 'Есть незакоммиченные изменения. Сначала закоммить их.' 'Tomato'; return }
  if ((Git $repo 'branch --show-current').Out -ne 'main') { Say 'Нужно быть на ветке main.' 'Tomato'; return }
  $items = Pending $repo $remote
  if (-not $items) { Say 'Нечего забирать.' 'LightGreen'; return }

  # a .proof folder that git doesn't track here would block the merge; it waits outside and comes back
  $proof = Join-Path $repo '.proof'
  $aside = $null
  if ((Test-Path $proof) -and -not (Git $repo 'ls-files .proof').Out) {
    $aside = Join-Path $env:TEMP ('anyflow-proof-' + [guid]::NewGuid())
    Move-Item $proof $aside
  }
  $restore = { if ($aside -and (Test-Path $aside)) { if (Test-Path $proof) { Remove-Item $proof -Recurse -Force }; Move-Item $aside $proof } }

  $branch = $prefix + (Get-Date -Format 'yyyy-MM-dd-HHmm')
  Git $repo "switch -q -c $branch" | Out-Null
  $m = Git $repo "merge --no-ff --no-commit $remote/main"
  if ($m.Err -match 'untracked working tree files') {
    Say $m.Err 'Tomato'
    Git $repo 'merge --abort' | Out-Null; Git $repo 'switch -q main' | Out-Null; Git $repo "branch -q -D $branch" | Out-Null
    & $restore
    Say 'Мешают файлы, которых нет в git (список выше). Убери их и попробуй снова.' 'Tomato'
    return
  }
  foreach ($p in $Keep) {
    Git $repo "rm -r -q -f --ignore-unmatch -- $p" | Out-Null
    if ((Git $repo "cat-file -e HEAD:$p").Code -eq 0) { Git $repo "checkout HEAD -- $p" | Out-Null }
  }
  $conflicts = (Git $repo 'diff --name-only --diff-filter=U').Out
  if ($conflicts) {
    Git $repo 'merge --abort' | Out-Null; Git $repo 'switch -q main' | Out-Null; Git $repo "branch -q -D $branch" | Out-Null
    & $restore
    Say 'Изменения спорят друг с другом в этих файлах:' 'Gold'
    $conflicts -split "`n" | ForEach-Object { Say "  $_" 'Gold' }
    Say 'Ничего не тронуто. Такое сводится руками: попроси Claude «смержи лабораторию в основной проект».' 'Gold'
    return
  }
  $lock = (Git $repo 'diff --cached --name-only HEAD -- app/package-lock.json').Out
  Git $repo "commit -q -m `"$message`"" | Out-Null
  & $restore

  if ($lock) { Say 'Ставлю новые пакеты…' 'Cyan'; Npm $repo 'install --no-audit --no-fund' | Out-Null }
  Say 'Проверяю, что проект собирается…' 'Cyan'
  $build = Npm $repo 'run build'
  if ($build.Code -ne 0) {
    Git $repo 'switch -q main' | Out-Null
    if ($lock) { Npm $repo 'install --no-audit --no-fund' | Out-Null }
    Say "Сборка не прошла. main не тронут, слияние лежит в ветке ${branch}: там его можно починить." 'Tomato'
    return
  }
  Say "Собралось. Слияние в ветке $branch." 'LightGreen'

  $ask = [Windows.Forms.MessageBox]::Show("Собралось. Перенести в main$pushTarget?", 'Anyflow', 'YesNo', 'Question')
  Git $repo 'switch -q main' | Out-Null
  if ($ask -ne 'Yes') { Say "Оставил в ветке $branch. Позже: git merge --ff-only $branch" 'Gold'; return }
  Git $repo "merge -q --ff-only $branch" | Out-Null
  Git $repo "branch -q -d $branch" | Out-Null
  $push = Git $repo 'push origin main'
  if ($push.Code -eq 0) { Say 'Готово: в main и на GitHub.' 'LightGreen' } else { Say "В main перенесено, но отправить не вышло: $($push.Err)" 'Gold' }
}

$fromLab.Button.Add_Click({
  Busy $true
  try { Merge-Into $Main 'lab' 'from-lab-' 'Take changes from the lab' ' и отправить на GitHub (приложения на всех устройствах обновятся)' } finally { Busy $false; Load-Lists }
})
$toLab.Button.Add_Click({
  Busy $true
  try { Merge-Into $Lab 'main-local' 'from-main-' 'Bring in the main project' ' лаборатории и отправить её на GitHub' } finally { Busy $false; Load-Lists }
})
$refresh.Add_Click({ Load-Lists })
$form.Add_Shown({ Say 'Читаю обе копии…' 'Cyan'; Load-Lists; Say 'Готово. Выбери, куда переносить.' 'LightGreen' })

# a check without the window: $env:ANYFLOW_MERGE_TEST=1; . .\merge-tool.ps1; Load-Lists
if ($env:ANYFLOW_MERGE_TEST) { return }
[void]$form.ShowDialog()
