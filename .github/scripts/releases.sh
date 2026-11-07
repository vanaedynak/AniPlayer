#!/usr/bin/env bash
# Releases of this (public, builds-only) repository. The source lives in a private repository ($SRC_REPO);
# the build workflow checks it out with SOURCE_TOKEN and publishes the files here.
#
# Every published version is its own release, tagged vX.Y.Z, and stays until someone deletes it.
# GitHub's "Latest" mark says which one the apps get:
#   - Windows reads releases/latest/download/latest.yml (electron-updater, generic provider);
#   - iPad/Android builds since 2026-11-07 ask the /releases/latest API.
# Builds from before that ask /releases/tags/latest, so a prerelease tagged "latest" keeps a copy of the
# current version for them. A prerelease can never get the "Latest" mark, so the copy doesn't get in the way.
#
# Each release body ends with <!-- source:SHA -->: the source commit it was built from, so it can be built again.
# One release can carry a star in its title: the settled (stable) version.
#
# Usage (GH_REPO, GH_TOKEN, NAME set; resolve also SRC_REPO, SRC_TOKEN):
#   releases.sh resolve <from>                      -> from=<tag> / ref=<source commit> for "", "stable" or "v1.0.57"
#   releases.sh publish <dir> <version> <source-commit> <rebuilt-from-tag> <notes> <changes>
#   releases.sh rollback                             delete the newest version; the one before gets "Latest"
#   releases.sh stable [version]                     star this version (default: the current one)
#   releases.sh summary                              table of versions (for the run's summary page)
set -euo pipefail
: "${GH_REPO:?GH_REPO is not set}"

MIRROR=latest
STAR='⭐'
NAME=${NAME:-Anyflow}

die() { echo "::error::$*" >&2; exit 1; }

# published vX.Y.Z releases, newest first: "tag<TAB>title"
versions() {
  gh api "repos/$GH_REPO/releases?per_page=100" --paginate \
    -q '.[] | select(.draft | not) | select(.prerelease | not)
         | select(.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")) | [.tag_name, .name] | @tsv' \
    | sort -t$'\t' -k1,1Vr
}

latest_tag() { gh api "repos/$GH_REPO/releases/latest" -q .tag_name 2>/dev/null || true; }
stable_tag() { versions | awk -F'\t' -v s="$STAR" 'index($2, s) { print $1; exit }'; }
# this repository's own commit for its releases (the source never comes here)
here() { gh api "repos/$GH_REPO/commits/main" -q .sha; }
# the source commit a release was built from
source_of() {
  local sha
  sha=$(gh release view "$1" --json body -q .body 2>/dev/null | sed -nE 's/.*<!-- source:([0-9a-f]{40}) -->.*/\1/p' | tail -1)
  # releases from before the split: the same tag exists in the source repository
  [[ -n $sha ]] || sha=$(GH_TOKEN=${SRC_TOKEN:?} gh api "repos/${SRC_REPO:?}/commits/$1" -q .sha 2>/dev/null) || true
  echo "$sha"
}

# copy <tag>'s files into the "latest" prerelease (from <dir> if they are already on disk)
mirror() {
  local tag=$1 dir=${2:-}
  if [[ -z $dir ]]; then dir=$(mktemp -d); gh release download "$tag" -D "$dir"; fi
  gh release delete "$MIRROR" --yes --cleanup-tag 2>/dev/null || true
  gh release create "$MIRROR" "$dir"/* --target "$(here)" --prerelease --latest=false \
    --title "Служебная копия $tag (не трогать)" \
    --notes "Копия текущей версии $tag для приложений на iPad и Android, собранных до 7 ноября 2026: они ищут обновления только здесь. Её обновляют кнопки выпуска и отката. Настоящие версии — релизы v…, та, что сейчас у всех, помечена Latest."
  echo "Служебная копия latest = $tag"
}

# Before 2026-11-07 there was a single release tagged "latest". The first time this script meets it, it keeps
# that build as its own version, so rolling back from the first new version has somewhere to go.
adopt() {
  local pre ver dir
  pre=$(gh release view "$MIRROR" --json isPrerelease -q .isPrerelease 2>/dev/null) || return 0
  [[ $pre == false ]] || return 0
  ver=$(gh release view "$MIRROR" --json assets -q '.assets[].name' | sed -nE 's/.*Setup-([0-9.]+)\.exe$/\1/p' | head -1)
  [[ -n $ver ]] || return 0
  gh release view "v$ver" >/dev/null 2>&1 && return 0
  dir=$(mktemp -d)
  gh release download "$MIRROR" -D "$dir"
  gh release create "v$ver" "$dir"/* --target "$(here)" --latest \
    --title "$NAME $ver" --notes "Сборка $ver — последняя из старой схемы, когда был один релиз «latest»."
  echo "Старая сборка сохранена как v$ver"
}

resolve() {
  local from=${1:-}
  if [[ -z $from ]]; then
    printf 'from=\nref=%s\n' "$(GH_TOKEN=${SRC_TOKEN:?} gh api "repos/${SRC_REPO:?}/commits/main" -q .sha)"
    return
  fi
  if [[ $from == stable ]]; then
    from=$(stable_tag)
    [[ -n $from ]] || die "Ни одна версия не отмечена стабильной"
  fi
  [[ $from == v* ]] || from="v$from"
  local sha; sha=$(source_of "$from")
  [[ -n $sha ]] || die "Нет версии $from"
  printf 'from=%s\nref=%s\n' "$from" "$sha"
}

publish() {
  local dir=$1 v=$2 sha=$3 from=$4 extra=$5 changes=${6:-}
  adopt
  local body="IPA для iPad (ставится через Sideloadly/AltStore), APK для Android и установщик для Windows. Собрано из ${sha::7}."
  [[ -n $from ]] && body+=$'\n\n'"Это версия $from, собранная заново под новым номером: так все приложения вернутся к ней."
  [[ -z $from && -n $changes ]] && body+=$'\n\n'"**Что изменилось**"$'\n'"$changes"
  [[ -n $extra ]] && body="$extra"$'\n\n'"$body"
  body+=$'\n\n'"<!-- source:$sha -->"
  gh release create "v$v" "$dir"/* --target "$(here)" --title "$NAME $v" --notes "$body" --latest
  echo "Выпущена v$v"
  mirror "v$v" "$dir"
}

rollback() {
  adopt
  local tags; mapfile -t tags < <(versions | cut -f1)
  (( ${#tags[@]} >= 2 )) || die "Откатывать некуда: осталась одна версия"
  local gone=${tags[0]} prev=${tags[1]}
  [[ $(stable_tag) == "$gone" ]] && echo "::warning::$gone была отмечена стабильной; отметка уйдёт вместе с ней"
  # the tag stays, so this version can still be built again later ("from: $gone")
  gh release delete "$gone" --yes
  gh release edit "$prev" --latest
  echo "Удалена $gone, теперь у всех $prev"
  mirror "$prev"
}

stable() {
  adopt
  local want=${1:-$(latest_tag)}
  [[ $want == v* ]] || want="v$want"
  gh release view "$want" >/dev/null 2>&1 || die "Нет версии $want"
  versions | while IFS=$'\t' read -r tag title; do
    if [[ $tag == "$want" ]]; then
      [[ $title == *"$STAR"* ]] || gh release edit "$tag" --title "$NAME ${tag#v} $STAR стабильная"
    elif [[ $title == *"$STAR"* ]]; then
      gh release edit "$tag" --title "$NAME ${tag#v}"
    fi
  done
  echo "Стабильная: $want"
}

summary() {
  local cur; cur=$(latest_tag)
  echo "| Версия | Название | |"
  echo "|---|---|---|"
  versions | while IFS=$'\t' read -r tag title; do
    echo "| $tag | $title | $([[ $tag == "$cur" ]] && echo 'сейчас у всех') |"
  done
}

cmd=${1:-}; shift || true
case $cmd in
  resolve|publish|rollback|stable|summary) "$cmd" "$@" ;;
  *) die "unknown command: $cmd" ;;
esac
