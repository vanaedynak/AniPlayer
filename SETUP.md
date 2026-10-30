# AniPlayer: настройка

Клиент AniLibria для Windows и iPad, похожий на Animix. Видео и озвучка — AniLibria (публичный API `anilibria.top`).

## 1. Синхронизация между ПК и iPad (Firebase, бесплатно)

Нужен один раз, ~5 минут. Через неё синхронизируются история, позиция внутри серии,
просмотренные серии, коллекция, статистика, настройки плеера и токен AniList.

1. Откройте <https://console.firebase.google.com> и войдите Google-аккаунтом.
2. **Create a project** → имя `aniplayer` → Google Analytics можно выключить → Create.
3. Слева **Build → Authentication → Get started** → вкладка *Sign-in method* → **Email/Password** → Enable → Save.
4. Слева **Build → Firestore Database → Create database** → регион `eur3 (europe-west)` → **Start in production mode** → Create.
5. Там же вкладка **Rules** → замените всё на текст ниже → **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

6. Шестерёнка слева сверху → **Project settings** → внизу *Your apps* → значок **</>** (Web) →
   имя `aniplayer`, Firebase Hosting не нужен → Register app.
7. Скопируйте блок `const firebaseConfig = { ... }` и пришлите его Claude — он вшьёт его в приложение,
   и вводить ничего на iPad не придётся. (Или вставьте сами: «Настройки → Синхронизация».)
8. В приложении: **Настройки → Синхронизация → Создать аккаунт** (любая почта + пароль от 6 символов).
   На втором устройстве — **Войти** с теми же данными.

Бесплатного лимита (50 000 чтений и 20 000 записей в день) одному человеку хватит с огромным запасом:
позиция пишется раз в 10 секунд во время просмотра.

### Как работает сохранение позиции
- Позиция пишется локально каждые 2 секунды, в облако — раз в 10 секунд, плюс сразу при паузе,
  перемотке, смене серии, сворачивании приложения и закрытии окна.
- На Windows окно при закрытии ждёт подтверждения записи (до 3 секунд).
- Нет интернета — изменения копятся и отправятся при следующем подключении.
- При открытии серии плеер сначала получает свежие данные из облака (до 3,5 сек) и только потом
  выбирает, с какого места продолжить, поэтому старая позиция не перезапишет новую.

## 2. AniList (по желанию)

Отмечает просмотренные серии в вашем списке AniList (сопоставление по MyAnimeList ID).

1. <https://anilist.co/settings/developer> → **Create New Client**.
   Name: `AniPlayer`, Redirect URL: `https://anilist.co/api/v2/oauth/pin` → Save.
2. В приложении на ПК: **Настройки → AniList** → вставьте Client ID → «Получить токен» →
   Authorize → скопируйте токен → вставьте → «Подключить».
3. Токен синхронизируется на iPad сам.

## 3. Аниме, которых нет у AniLibria

В «Каталог → Все аниме» и в поиске есть всё с Shikimori. Тайтлы с пометкой **AniLibria** открываются
в нашем плеере, остальные — со всеми озвучками из открытого API YummyAnime (Studio Band, AniDUB,
AnimeVost и т.д.) во встроенном плеере Kodik. Ничего настраивать не нужно, ключ не требуется.
Позиция, история и автопропуск опенингов работают в плеере Kodik; в запасных плеерах (Aksor, Alloha)
видео просто играет.

## 4. Установка

### Windows
`app/release/AniPlayer-Setup-1.0.0.exe` — установщик (создаёт ярлык на рабочем столе).
Свежие сборки также лежат в GitHub Releases (`latest`).

### iPad
GitHub Actions собирает неподписанный `AniPlayer.ipa` при каждом пуше
(вкладка **Releases → latest** или **Actions → артефакт AniPlayer-ipa**).

Установить без Mac можно через **Sideloadly** (<https://sideloadly.io>) с ПК:
1. Поставьте iTunes и iCloud с сайта Apple (не из Microsoft Store), затем Sideloadly.
2. Подключите iPad кабелем, перетащите `AniPlayer.ipa` в Sideloadly, введите Apple ID → Start.
3. На iPad: **Настройки → Основные → VPN и управление устройством** → доверять своему Apple ID.
4. На iPadOS 16+ включите **Настройки → Конфиденциальность → Режим разработчика**.

С бесплатным Apple ID приложение нужно переподписывать раз в 7 дней (в Sideloadly есть
автоматическое обновление по Wi‑Fi; либо используйте AltStore). Данные при переустановке
не теряются — они в облаке.

## Разработка

```bash
cd app
npm install
npm run dev            # в браузере, http://localhost:5173
npm run electron:dev   # окно Windows с горячей перезагрузкой
npm run electron:build # установщик в app/release
```

Исходники официального десктоп-клиента AniLibria (Qt) для справки лежат в `reference/` (в git не входят).
