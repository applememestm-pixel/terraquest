# Терра

Географическая игра с глобусом, плоскими картами и каталогом 197 стран.

Автор — [applememestm-pixel](https://github.com/applememestm-pixel). Код распространяется по [MIT](LICENSE) с сохранением указания автора и текста лицензии. Карты и изображения сохраняют свои исходные лицензии.

## Сайт в Docker

```sh
docker compose up --build -d
```

Откройте `http://localhost:3000`. Compose ограничивает память контейнера до 50 000 000 байт без дополнительного swap. Результаты хранятся в томе `terra-data` с лимитом 280 000 000 байт, включая резервируемые блоки файлов. Для каждого аккаунта хранится одна актуальная запись. Новый результат атомарно перезаписывает предыдущий, а повторная отправка не начисляет очки снова.

Если диск ограничен и во время сборки, соберите образ на другом компьютере командой `docker build -t terraquest:local .` и перенесите его через `docker save` и `docker load`. На сервере запустите `docker compose up -d --no-build`. Для готового образа нужен только Go-бинарник с уже встроенными файлами сайта.

Без настройки OAuth сайт работает в гостевом режиме с сохранением в браузере.

### Вход через Google и Apple

Скопируйте `.env.example` в `.env`. Укажите внешний адрес в `PUBLIC_URL` и задайте длинный случайный `AUTH_SECRET`: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Для внешнего домена обслуживайте сайт по HTTPS через обратный прокси.

- В Google Cloud Console создайте OAuth-клиент типа **Web application**. Callback для локальной проверки — `http://localhost:3000/auth/callback/google`. На сервере укажите callback на своём домене. Заполните `AUTH_GOOGLE_ID` и `AUTH_GOOGLE_SECRET`.
- В Apple Developer настройте **Sign in with Apple** для Services ID, зарегистрируйте домен и HTTPS Return URL `https://ваш-домен/auth/callback/apple`. Укажите Services ID как `AUTH_APPLE_ID`, а подписанный client-secret JWT как `AUTH_APPLE_SECRET`. Apple ограничивает срок его действия.

Гостевой прогресс переносится при первом входе в пустой аккаунт. Вход одного провайдера синхронизирует прогресс между браузерами. Входы Google и Apple образуют отдельные аккаунты. Секреты хранятся в `.env` на сервере.

## Автономное приложение

Мобильная сборка включает карты, флаги, гербы и фотографии в сам пакет. Аккаунт не требуется. Автономное приложение продолжит с последнего локального результата. Веб-прогресс хранится отдельно. Android-пакет доступен в разделе Releases. Сборка из исходников требует Node.js 22.13+, JDK и Android SDK Platform 35 с Android Build Tools 35+:

```sh
npm run build:android
```

Результат находится в `build/android/Terra.apk`. Используется локальный ключ отладочной подписи из `build/android`.

Для iPhone на macOS с Xcode и [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
npm run build:mobile
cd native/ios
xcodegen generate
open Terra.xcodeproj
```

Выберите iOS Simulator или задайте команду подписи в Xcode для установки на iPhone.

Игра включает поиск страны, полный раунд, флаги, гербы, столицы по странам и страны по столицам. В «Хардкоре» первая ошибка сбрасывает счёт и прохождение во всех его режимах и атласах. Счёт и прогресс хранятся в браузере.

На сложности «Норм» выбор на карте приносит 100, 50 или 25 баллов в зависимости от попытки. После третьей ошибки правильный ответ подсвечивается, и его выбор засчитывается за 0 баллов. В полном раунде баллы начисляются после всех этапов. Пропуск даёт 0 и убирает страну из текущего раунда без зачёта.

Карточки 197 стран открываются после зачёта и в каталоге «Страны». В каталоге можно искать страны и столицы, фильтровать по региону и смотреть до трёх фотографий на страну. В карточках указаны годы статистических показателей, форма правления, устройство, режим по Regimes of the World, членство в региональных организациях и исторические факты.

## Данные

- [Natural Earth](https://www.naturalearthdata.com/) — границы и названия городов.
- [mledoze/countries](https://github.com/mledoze/countries) — список стран и названия столиц.
- [FlagCDN](https://flagcdn.com/) — изображения флагов.
- [Armorial of sovereign states](https://en.wikipedia.org/wiki/Armorial_of_sovereign_states) и [MainFacts](https://mainfacts.com/) — источники изображений гербов.
- [D3 Geo](https://github.com/d3/d3-geo) и [D3 Array](https://github.com/d3/d3-array) — проекции и картографические вычисления.
- [geoBoundaries gbOpen](https://www.geoboundaries.org/) — префектуры Японии, штаты США, субъекты России и украинские административные территории. Лицензия CC BY 4.0.
- [Historical Basemaps](https://github.com/aourednik/historical-basemaps) — исторические слои 1938 и 1945 годов. Данные этих слоёв распространены по [GPL-3.0](https://github.com/aourednik/historical-basemaps/blob/master/LICENSE).
- [CShapes 2.0](https://icr.ethz.ch/data/cshapes/) — слой на 1 января 1942 года. Границы упрощены для карты. [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- [World Development Indicators](https://data.worldbank.org/), [World Factbook](https://thefactbook.org/fields/government-type) и [V-Dem](https://www.v-dem.net/data/the-v-dem-dataset/) — основные источники карточек. Производные оценки режимов распространяются по [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- [Wikimedia Commons](https://commons.wikimedia.org/) — фотографии. Под каждым снимком указаны авторство, лицензия и ссылка на страницу файла.

Чтобы обновить справочники, запустите `build_data.py` с файлами Natural Earth admin-0 countries, mledoze countries.json и Natural Earth populated places. Затем запустите `attach_armorial.py` с вики-разметкой Armorial of sovereign states и тем же countries.json. `fetch_flags.py` докачивает флаги для новых стран.

`build_atlases.py` собирает упрощённые границы из gbOpen ADM1, Historical Basemaps и среза CShapes. `build_country_info.py` собирает статистику, русский справочник исторических фактов и оценки режимов из таблицы 1 отчёта V-Dem 2026.

`build_country_photos.py` подбирает и проверяет иллюстрации по координатам мест, запрашивает метаданные Wikimedia Commons и обновляет каталог фотографий.

`python scripts/fetch-offline-assets.py` обновляет локальные медиа для мобильной сборки. Сборщик проверяет наличие герба и хотя бы одного фото для каждой страны.
