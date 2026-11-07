# Окно выпусков основного приложения: список версий, «Выпустить», «Откатить», «Стабильная».
# Само ничего не собирает: нажимает кнопку «Build apps» на GitHub (нужен вход в gh: gh auth login).
param([string]$Root = (Split-Path $PSScriptRoot -Parent))

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
[Windows.Forms.Application]::EnableVisualStyles()
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$flavor = Get-Content (Join-Path $Root 'app\flavor.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Repo = $flavor.repo
$Star = [string][char]0x2B50

$form = New-Object Windows.Forms.Form
$form.Text = "$($flavor.name): выпуски ($Repo)"
$form.Size = New-Object Drawing.Size(760, 600)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::FromArgb(18, 20, 28)
$form.ForeColor = [Drawing.Color]::White
$form.Font = New-Object Drawing.Font('Segoe UI', 10)

$list = New-Object Windows.Forms.ListBox
$list.Location = New-Object Drawing.Point(10, 10)
$list.Size = New-Object Drawing.Size(460, 330)
$list.BackColor = [Drawing.Color]::FromArgb(28, 31, 42)
$list.ForeColor = [Drawing.Color]::Gainsboro
$list.BorderStyle = 'None'
$form.Controls.Add($list)

$log = New-Object Windows.Forms.RichTextBox
$log.Location = New-Object Drawing.Point(10, 350)
$log.Size = New-Object Drawing.Size(725, 200)
$log.BackColor = [Drawing.Color]::FromArgb(10, 11, 16)
$log.ForeColor = [Drawing.Color]::Gainsboro
$log.Font = New-Object Drawing.Font('Consolas', 9)
$log.ReadOnly = $true
$form.Controls.Add($log)

function Say($text) { $log.AppendText("$text`r`n"); $log.ScrollToCaret() }

$script:versions = @()
function Refresh-List {
  $list.Items.Clear()
  $json = gh release list -R $Repo --limit 100 --exclude-drafts --json tagName,name,isLatest,isPrerelease,publishedAt 2>&1
  if ($LASTEXITCODE -ne 0) { Say "Не удалось получить список: $json"; return }
  $script:versions = @($json | Out-String | ConvertFrom-Json | Where-Object { $_.tagName -match '^v\d+\.\d+\.\d+$' -and -not $_.isPrerelease } |
    Sort-Object { [version]$_.tagName.Substring(1) } -Descending)
  foreach ($v in $script:versions) {
    $marks = @()
    if ($v.isLatest) { $marks += '<- сейчас у всех' }
    if ($v.name -like "*$Star*") { $marks += '(стабильная)' }
    $date = ([datetime]$v.publishedAt).ToLocalTime().ToString('dd.MM HH:mm')
    [void]$list.Items.Add(("{0,-10} {1}  {2}" -f $v.tagName, $date, ($marks -join ' ')))
  }
  if ($script:versions.Count -eq 0) { Say 'Версий v… пока нет. Первая появится после «Выпустить новую версию».' }
}

function Selected {
  if ($list.SelectedIndex -lt 0) { [Windows.Forms.MessageBox]::Show('Сначала выберите версию в списке.') | Out-Null; return $null }
  return $script:versions[$list.SelectedIndex].tagName
}

function Ask($text) { return [Windows.Forms.MessageBox]::Show($text, 'Подтвердите', 'YesNo', 'Question') -eq 'Yes' }

function Run([string[]]$fields) {
  $ghArgs = @('workflow', 'run', 'build.yml', '-R', $Repo, '--ref', 'main')
  foreach ($f in $fields) { $ghArgs += @('-f', $f) }
  $out = & gh @ghArgs 2>&1
  if ($LASTEXITCODE -eq 0) {
    Say 'Запущено на GitHub. Выпуск занимает около 15–20 минут, откат и отметка — минуту.'
    Say "Ход работы: https://github.com/$Repo/actions/workflows/build.yml  (потом «Обновить список»)"
  } else { Say "Не получилось: $out" }
}

function New-Button($y, $text, $color, $onClick) {
  $b = New-Object Windows.Forms.Button
  $b.Location = New-Object Drawing.Point(480, $y)
  $b.Size = New-Object Drawing.Size(255, 44)
  $b.FlatStyle = 'Flat'
  $b.BackColor = $color
  $b.ForeColor = [Drawing.Color]::White
  $b.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
  $b.Text = $text
  $b.Add_Click($onClick)
  $form.Controls.Add($b)
}

$teal = [Drawing.Color]::FromArgb(20, 160, 140)
$gray = [Drawing.Color]::FromArgb(55, 60, 78)
$red = [Drawing.Color]::FromArgb(170, 60, 70)

New-Button 10 'Выпустить новую версию' $teal {
  $notes = [Microsoft.VisualBasic.Interaction]::InputBox('Что нового? (можно оставить пустым)', 'Новая версия из main', '')
  if (Ask "Собрать текущий main и выпустить как новую версию?`nВсе приложения получат её как обновление.") { Run @('action=publish', "notes=$notes") }
}
New-Button 62 'Откатить последнюю' $red {
  if ($script:versions.Count -lt 2) { Say 'Откатывать некуда: версий меньше двух.'; return }
  $top = $script:versions[0].tagName; $prev = $script:versions[1].tagName
  if (Ask "Удалить $top? Новые установки и ещё не обновившиеся приложения получат $prev.`nКто уже поставил $top, останется на ней до следующей версии (чтобы вернуть всем — «Выпустить выбранную заново»).") { Run @('action=rollback') }
}
New-Button 114 'Отметить выбранную стабильной' $gray {
  $v = Selected; if (-not $v) { return }
  if (Ask "Отметить $v как стабильную? Отметка с прежней снимется.") { Run @('action=stable', "version=$v") }
}
New-Button 166 'Выпустить выбранную заново' $gray {
  $v = Selected; if (-not $v) { return }
  if (Ask "Собрать $v заново под новым номером и выпустить?`nТак все приложения, даже уже обновлённые, вернутся к коду $v.") { Run @('action=publish', "from=$v", "notes=Возврат к $v") }
}
New-Button 218 'Открыть на GitHub' $gray { Start-Process "https://github.com/$Repo/releases" }
New-Button 270 'Обновить список' $gray { Refresh-List; Say 'Список обновлён.' }

$form.Add_Shown({ Refresh-List })
[void]$form.ShowDialog()
