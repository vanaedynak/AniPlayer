# Забирает то, что сделано в лаборатории (копия проекта для Gemini), в основной проект.
# Всё попадает в отдельную ветку from-lab-..., проверяется сборкой, и только после твоего «y» уходит в main.
# Свои у каждой копии файлы (имя приложения, правила для Gemini, эти скрипты) остаются как были.
param(
  [string]$Lab = 'D:\Projects\Anyflow-Lab',
  [string]$LabBranch = 'main'
)

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$keep = @('app/flavor.json', '.github/workflows/pages.yml', 'AGENTS.md', 'GEMINI.md', 'LAB.md', '.agent', 'lab-tools', '.proof')

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Stop-With($text) { Say $text 'Red'; Read-Host 'Нажми Enter, чтобы закрыть'; exit 1 }
function Keep-Ours {
  foreach ($p in $keep) {
    git rm -r -q -f --ignore-unmatch -- $p 2>$null | Out-Null
    git cat-file -e "HEAD:$p" 2>$null
    if ($LASTEXITCODE -eq 0) { git checkout HEAD -- $p }
  }
}

if (git status --porcelain --untracked-files=no) { Stop-With 'В основном проекте есть незакоммиченные изменения. Сначала закоммить или отмени их.' }
if ((git branch --show-current) -ne 'main') { Stop-With 'Переключись на ветку main: git switch main' }
if (-not (Test-Path (Join-Path $Lab '.git'))) { Stop-With "Не нашёл лабораторию в $Lab" }

git remote get-url lab 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { git remote add lab $Lab }
git fetch -q lab $LabBranch
if ($LASTEXITCODE -ne 0) { Stop-With 'Не получилось прочитать лабораторию.' }

$commits = git log --oneline --no-merges "HEAD..lab/$LabBranch"
if (-not $commits) { Say 'В лаборатории нет ничего нового.' 'Green'; Read-Host 'Enter'; exit 0 }
Say "Новое в лаборатории:" 'Cyan'
$commits | ForEach-Object { Say "  $_" }

$branch = 'from-lab-' + (Get-Date -Format 'yyyy-MM-dd-HHmm')
git switch -q -c $branch
git merge -q --no-ff --no-commit "lab/$LabBranch" 2>$null
Keep-Ours
$conflicts = git diff --name-only --diff-filter=U
if ($conflicts) {
  git merge --abort; git switch -q main; git branch -q -D $branch
  Say 'Изменения лаборатории спорят с основным проектом в этих файлах:' 'Yellow'
  $conflicts | ForEach-Object { Say "  $_" }
  Stop-With 'Ничего не тронуто. Такое надо сводить руками (это может сделать Claude или Gemini).'
}

$lockChanged = git diff --cached --name-only HEAD -- app/package-lock.json
git commit -q -m "Take changes from the lab"

Push-Location app
if ($lockChanged) { Say 'Ставлю новые пакеты…' 'Cyan'; npm install --no-audit --no-fund }
Say 'Проверяю, что проект собирается…' 'Cyan'
npm run build
$ok = $LASTEXITCODE -eq 0
Pop-Location

if (-not $ok) {
  git switch -q main
  if ($lockChanged) { Push-Location app; npm install --no-audit --no-fund | Out-Null; Pop-Location }
  Stop-With "Сборка не прошла. main не тронут, изменения лежат в ветке $branch — их можно починить там."
}

Say "Собралось. Изменения в ветке $branch." 'Green'
$answer = Read-Host 'Перенести в main и отправить на GitHub (приложения на всех устройствах обновятся)? y/n'
if ($answer -eq 'y') {
  git switch -q main
  git merge -q --ff-only $branch
  git push origin main
  if ($LASTEXITCODE -eq 0) { git branch -q -d $branch; Say 'Готово: отправлено, сборки пошли.' 'Green' }
} else {
  git switch -q main
  Say "Оставил в ветке $branch. Перенести позже: git merge --ff-only $branch, затем git push" 'Yellow'
}
Read-Host 'Нажми Enter, чтобы закрыть'
