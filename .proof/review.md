# QA Playtest Review: iPad Status Bar in Manga and Ranobe Readers

**Verdict:** PASS  
**Score:** 10/10  
**Tested on:** Chromium simulating iPadOS Retina (1024x1366 portrait, Capacitor native iOS environment)  

---

## Findings Summary

| # | Priority | Description | Status |
|---|----------|-------------|--------|
| 1 | BLOCKER | Status bar did not hide when opening manga or ranobe readers on iPad | FIXED & VERIFIED |
| 2 | MAJOR | Fullscreen button in readers did nothing on iPad | FIXED & VERIFIED |
| 3 | MINOR | Status bar could flicker when advancing between manga chapters | FIXED & VERIFIED (Microtask batching) |
| 4 | MINOR | Backgrounding/restoring app on iPad could lose status bar state | FIXED & VERIFIED (Visibility hook) |

---

## Detailed Test Results

### 1. Initial State on App Launch
- **Action:** Open application on simulated iPad at `#/ranobe`.
- **Observed:** `StatusBar.setStyle({ style: 'DARK' })` was invoked during app bootstrap. `StatusBar.hide()` was NOT called. Top status bar remains visible in catalog and non-reader views.
- **Verdict:** PASS

### 2. Automatic Hiding in BookReader (EPUB/FB2/TXT)
- **Action:** Open `#/ranobe/qa-book-1`.
- **Observed:** `BookReader.tsx` mounted with `isNative === true` -> `useReaderStatusBar(true)` registered reader hide reason -> `StatusBar.hide()` was dispatched immediately.
- **Verdict:** PASS

### 3. Fullscreen Button Toggle & Titles
- **Action:** Inspect and click the fullscreen toggle button in `BookReader`.
- **Observed:**
  - Initial title on iPad: `"Обычный экран"` with minimize icon (`full = true`).
  - First click: sets `full = false`, triggers `StatusBar.show()`, button updates to `"Во весь экран"` with maximize icon.
  - Second click: sets `full = true`, triggers `StatusBar.hide()`, button updates back to `"Обычный экран"`.
- **Verdict:** PASS

### 4. Keyboard Controls (Escape & KeyF)
- **Action:** Press `Escape` while in full reading mode on iPad.
- **Observed:** First `Escape` exits fullscreen mode (`StatusBar.show()`), second `Escape` navigates back to file shelf (`#/ranobe/files`). Status bar remains visible after exit.
- **Verdict:** PASS

### 5. Ranobe Online Reader (`NovelReader.tsx`)
- **Action:** Open `#/ranobe/n/ranobehub/test-novel/chapter-1`, then navigate back to `#/ranobe`.
- **Observed:** `StatusBar.hide()` called upon entering the novel chapter. `StatusBar.show()` called immediately upon navigating back to catalog.
- **Verdict:** PASS

### 6. Manga Reader (`Reader.tsx`) & Seamless Chapter Transition
- **Action:** Open `#/manga/read/test-title/ch-01`, advance to `ch-02`, then exit to `#/manga`.
- **Observed:**
  - Entering manga chapter hides status bar.
  - Advancing from chapter 1 to chapter 2: unmount of previous `ReaderView` and mount of next `ReaderView` coalesced via microtask queue without any intermediate `show()` call (zero flicker).
  - Exiting to `#/manga` restored status bar via `StatusBar.show()`.
- **Verdict:** PASS

### 7. Coexistence with Video Player
- **Action:** Dispatch `webkitbeginfullscreen` and `webkitendfullscreen` events.
- **Observed:** `hideReasons` set tracks `'video'` and `'reader_*'` independently. Video fullscreen correctly hides status bar and restores status bar only when no other component requests hiding.
- **Verdict:** PASS

### 8. Build & Typecheck
- **Commands:**
  - `cd app; npx tsc -p tsconfig.app.json --noEmit` -> 0 errors.
  - `cd app; npm run build` -> Clean Vite build in 1.37s.
- **Verdict:** PASS
