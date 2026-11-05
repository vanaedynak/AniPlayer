# Подтягивает в лабораторию свежую версию основного проекта (vanaedynak/AniPlayer на GitHub).
# Свои у лаборатории файлы (имя приложения, правила для Gemini, эти скрипты) остаются как были.
# Если изменения спорят друг с другом, ничего не трогает и говорит, в каких файлах спор.

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$keep = @('app/flavor.json', '.github/workflows/pages.yml', 'AGENTS.md', 'GEMINI.md', 'LAB.md', '.agent', 'lab-tools')

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Stop-With($text) { Say $text 'Red'; Read-Host 'Нажми Enter, чтобы закрыть'; exit 1 }
function Keep-Ours {
  foreach ($p in $keep) {
    git rm -r -q -f --ignore-unmatch -- $p 2>$null | Out-Null
    git cat-file -e "HEAD:$p" 2>$null
    if ($LASTEXITCODE -eq 0) { git checkout HEAD -- $p }
  }
}

if (git status --porcelain --untracked-files=no) { Stop-With 'В лаборатории есть незакоммиченные изменения. Сначала закоммить их (или попроси Gemini).' }

git remote get-url upstream 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  git remote add upstream https://github.com/vanaedynak/AniPlayer.git
  git remote set-url --push upstream DISABLED
}
git fetch -q upstream main
if ($LASTEXITCODE -ne 0) { Stop-With 'Не получилось скачать основной проект с GitHub.' }

$commits = git log --oneline --no-merges "HEAD..upstream/main"
if (-not $commits) { Say 'В основном проекте нет ничего нового.' 'Green'; Read-Host 'Enter'; exit 0 }
Say 'Новое в основном проекте:' 'Cyan'
$commits | ForEach-Object { Say "  $_" }

$before = git rev-parse HEAD
git merge -q --no-ff --no-commit upstream/main 2>$null
Keep-Ours
$conflicts = git diff --name-only --diff-filter=U
if ($conflicts) {
  git merge --abort
  Say 'Изменения основного проекта спорят с лабораторией в этих файлах:' 'Yellow'
  $conflicts | ForEach-Object { Say "  $_" }
  Stop-With 'Ничего не тронуто. Попроси Gemini: «смержи upstream/main, flavor.json и lab-tools оставь наши».'
}

$lockChanged = git diff --cached --name-only HEAD -- app/package-lock.json
git commit -q -m "Bring in the main project"

Push-Location app
if ($lockChanged) { Say 'Ставлю новые пакеты…' 'Cyan'; npm install --no-audit --no-fund }
Say 'Проверяю, что проект собирается…' 'Cyan'
npm run build
$ok = $LASTEXITCODE -eq 0
Pop-Location

if ($ok) {
  Say 'Готово: лаборатория обновлена и собирается. Отправить на GitHub: git push' 'Green'
} else {
  Say "Сборка не прошла. Отменить обновление: git reset --hard $before" 'Yellow'
  Say 'Или попроси Gemini починить сборку.' 'Yellow'
}
Read-Host 'Нажми Enter, чтобы закрыть'
