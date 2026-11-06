# Proof Checklist

- [x] Status bar hiding hook and manager in `app/src/lib/platform.ts`
- [x] Manga reader (`app/src/manga/Reader.tsx`) hides status bar on iPad/native during reading and restores on exit
- [x] Book reader (`app/src/manga/BookReader.tsx`) hides status bar on iPad/native during reading and restores on exit
- [x] Ranobe online reader (`app/src/ranobe/NovelReader.tsx`) hides status bar on iPad/native during reading and restores on exit
- [x] Fullscreen toggle button (`toggleFull`) in all 3 readers toggles status bar on iPad/native
- [x] Video fullscreen in `Player.tsx` / `KodikPlayer.tsx` continues to work cleanly
- [x] Type check and build pass without errors (`tsc -b`, `npm run build`)
- [x] Desktop / Electron and browser behavior unaffected
