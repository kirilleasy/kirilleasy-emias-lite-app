# EMIAS Lite (готовый шаблон)

**Что внутри:** рабочее Electron‑приложение с логином/PIN и ролями (NMS, NMP, PRIYOMKA, ADMIN), реестром пациентов,
учётом визитов за день и двусторонней синхронизацией с Excel.

## Запуск (Windows)
1. Установите Node.js **22 LTS** (или 20 LTS).
2. В PowerShell (если ругается на скрипты — используйте `npm.cmd` вместо `npm`):
   ```powershell
   cd emias-lite-app
   npm install
   npx electron-builder install-app-deps
   npm start
   ```
   Альтернатива при запрете скриптов:
   ```powershell
   npm.cmd install
   npx.cmd electron-builder install-app-deps
   npm.cmd start
   ```

### Логины/PIN
- nms → **1111**
- nmp → **2222**
- priyomka → **3333**
- admin → **0000**

Если выпадающий список логинов пуст — введите логин вручную в поле «Логин (если список пуст)».

### Примечания
- БД SQLite создаётся в `data/app.db` рядом с приложением (в dev‑режиме).
- При ошибках сборки `better-sqlite3` установите **Visual Studio Build Tools 2022** (C++ workload) и **Windows 10/11 SDK**.
- Версия Electron — ^30. `npx electron-builder install-app-deps` пересоберёт native‑модули под вашу Electron.
