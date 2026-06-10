# Roadmap

Status of the Windows port and what's left to do. Compared against the
macOS app at [appariciojunior/siphonClaudeUsage](https://github.com/appariciojunior/siphonClaudeUsage).

## Parity vs. macOS app

Feature-by-feature comparison against the macOS Swift original.

| Feature                                           | macOS | Windows | Notes |
| ------------------------------------------------- | :---: | :-----: | ----- |
| Tray / menu-bar icon                              |   ✓   |    ✓    | Final assets in `assets/tray*.png` wired through `trayIcon.js`. |
| Click tray to open popover                        |   ✓   |    ✓    | Windows wires **double-click** instead (more conventional on Windows). |
| Right-click tray menu                             |   ✓   |    ✓    | Shows live session/weekly/reset/update summary plus app/widget/settings/quit actions. |
| Session % + reset countdown                       |   ✓   |    ✓    |  |
| Weekly all + weekly Sonnet                        |   ✓   |    ✓    | Surfaces `extra_usage` credits when weekly Sonnet data is absent. |
| Today's USD cost                                  |   ✓   |    ✓    |  |
| This month's USD cost                             |   ✓   |    ✓    |  |
| Recent days breakdown                             |   ✓   |    ✗    | Removed; backing data dropped. May return as a dedicated view later. |
| Local cost data refresh (~30 s)                   |   ✓   |    ✓    | Default 30 s; configurable to 1, 5, or 15 min. |
| OAuth quota refresh                               |   ✓   |    ✓    | Uses the chosen refresh interval with a 120 s minimum on Windows. |
| OAuth PKCE sign-in (paste-redirect flow)          |   ✓   |    ✓    | Same client ID and endpoints as Claude Code. |
| Token auto-refresh                                |   ✓   |    ✓    | 30-second skew before expiry. |
| Credentials persisted at `0600`                   |   ✓   |    ✓    | `%APPDATA%\Siphon\credentials.json`. |
| Bundled display font                              | Inter |  Geist  | Geist + Geist Mono + Geist Pixel Line, loaded via `@font-face`. |
| Polished UI (post visual-polish pass)             |   ✓   |    ✓    | Carbon icons, `#000` background, borderless cards, pixel numerals. |
| Tray icon color-coded by usage level              |   ✓   |    ✓    | `updateTray()` swaps `tray.png` / `tray-warn.png` / `tray-danger.png` via `levelForPercent`. |
| Packaged installer                                |  DMG  |   NSIS  | `electron-builder.yml` configured (`npm run build:win`). |
| **Reset notification when session hits 100%**     |   —   |    ✓    | Windows-only addition (the reason this fork exists). |
| **Missed-reset notification on next launch**      |   —   |    ✓    | Fires once if the stored reset has already passed. |
| Autostart on login                                |   ✓   |    ✓    | Settings toggles for start with Windows + show window after login. |

## Done

Shipped. Captured here so it's not re-litigated:

**Visual polish pass**

- Background `#000000`, card `#0A0A0A`, no borders, `border-radius` ↦ `--radius-sm`.
- All icons migrated to Carbon (`Renew`, `ExecutionHistory`, `Settings`,
  `Lightning`, `Notification`, `NotificationOff`, `Close`, `ArrowLeft`, `Locked`).
- Quota panel renamed to *Sessão Atual*. Headline in `GeistPixel-Line` 56px.
- Stat grid is 2×2 (Weekly all · Weekly Sonnet · Hoje · Este mês). Pixel numerals at 24px.
- *Updated just now* line under the grid, centered, dot pulsing
  (`formatRelativeUpdated` in `src/shared/format.js`, refreshed every 30 s).
- Brand mark replaced by `assets/Logo.png` lockup (logo + wordmark in one
  image), 22px tall in the topbar.

**Session-reset notification toggle**

- `PreferencesService` over `JsonStore` at `%APPDATA%\Siphon\preferences.json`.
- `UsageController` consults `notifications.sessionReset` before arming
  the scheduler; clearing the toggle calls `resetScheduler.clear()`.
- IPC: `prefs:get`, `prefs:set`. Preferences ride along in `getState()`.
- Settings UI: real switch wired to the preference. Pill in main view
  reflects the live value (*On* with `Notification` icon, *Off* with
  `NotificationOff` icon).

**Floating widget (PiP-style)**

- Compact 220 × 88, frameless, transparent, always-on-top, `skipTaskbar`.
- Expandable to 260 × 168 for weekly quota plus today/month cost.
- Opt-in via Settings switch + tray menu *Widget flutuante* checkbox.
- Position persisted to `preferences.json` (debounced on `move`).
- Consumes the existing `state-changed` channel; no duplicate controller.
- Drag region on the background; click on percent area opens the main window.

**UX polish (v0.2)**

- Reset toast click → `showMainWindow()`. `notif.on('click', ...)` in `main.js` notify callback.
- Offline banner: `QuotaError('network')` in `quotaService.js` on `TypeError` from fetch; `state.isOffline` flag in controller; dismissable `#offlineBanner` in renderer with `error.offline.title/body` i18n.
- Friendlier local data empty-state: `summarizeFromJSONL` throws `{ code: 'ENODATA' }` on ENOENT projectsDir; controller maps to `error.local.missing` / `error.local.corrupted` i18n keys; renderer translates via `t()`.
- Window show animation: CSS `@keyframes windowEnter` (opacity + translateY) on `body[data-entering]`; toggled by `visibilitychange` listener in renderer.

**Localization**

- UI strings externalized through `src/shared/i18n.js` with English and
  Brazilian Portuguese, live-switched from Settings via `preferences.json`.

**Real tray icon + color-coded levels**

- `trayIcon.js` loads `tray.png` / `tray-warn.png` / `tray-danger.png`
  (plus `@2x` variants) via `nativeImage.createFromPath`.
- `updateTray()` in `main.js` swaps the image based on `levelForPercent`
  of the session percent (ok < 80%, warn ≥ 80%, danger ≥ 95%).

**Packaging — `.exe` installer**

- `electron-builder` wired as devDependency, `npm run build:win` outputs
  to `dist/` via `electron-builder.yml`.
- NSIS, per-user, `oneClick: false`, `allowToChangeInstallationDirectory: true`.
- Installer icon, sidebar BMP, header BMP all wired from `assets/installer/`.
- Files included: `src/`, `assets/`, `package.json`. Excluded: `test/`,
  `scripts/`, `docs/`, `mockup.html`, `ROADMAP.md`, `ARCHITECTURE.md`.
- Start Menu shortcut placed inside a `Siphon` folder; optional desktop shortcut is opt-in during install.
- Installer copy is English, and the uninstaller reuses the Siphon sidebar/icon treatment.
- Directory/install/uninstall pages apply the dark Siphon header/body color treatment instead of the default gray Windows panels.

**Menu tray — floating widget toggle**

- Right-click tray menu now uses a *Widget flutuante* checkbox item.
- The checkbox reflects `preferences.floating.enabled`.
- Clicking the item toggles the floating widget on/off directly from the tray menu.

**Autostart on login**

- `startup.openAtLogin` and `startup.showWindowOnLogin` persisted in
  `preferences.json`.
- `startupService.js` wraps `app.setLoginItemSettings()` with the app path,
  registry name `Siphon`, and a managed `--hidden` launch argument.
- Settings UI has two switches: *Start with Windows* and
  *Show window after login*. The second stays visible but disabled until
  autostart is enabled.
- Manual launches still show the main window; app-managed login launches
  stay hidden only when started with `--hidden`.

**Incremental usage history and refresh cadence**

- `LocalDataService` caches modern JSONL parsing in
  `%APPDATA%\Siphon\local-usage-cache.json` by path, `mtimeMs`, size,
  parsed byte offset, trailing remainder, last model, last token totals, and
  per-file day/hour aggregates.
- Local summaries still expose `todayStats` and `monthStats`, and now also
  expose `localHistory.hourly` and `localHistory.daily` for cost/token trends.
- `UsageController` keeps an in-memory `quotaHistory.session` trend for
  successful OAuth quota refreshes.
- Settings now has a refresh interval preference: 30 s, 1 min, 5 min, or
  15 min. Local polling uses the selected value; OAuth quota polling keeps a
  120 s floor and timers are rescheduled live.

**Usage pace, rich tray surface, and refresh glow**

- `src/shared/pace.js` classifies session/weekly quota pace as no data,
  on track, high pace, or likely to run out using reset windows plus local
  history context.
- The main Session and Weekly cards show a compact localized pace pill.
- `src/shared/trayStatus.js` builds the tray tooltip and disabled context-menu
  summary rows for session %, weekly %, session reset time, and last update.
- Manual refresh from the topbar adds a subtle renderer-only card glow while
  the refresh promise is pending.

**Safe diagnostics**

- `src/shared/diagnostics.js` centralizes redaction for OAuth codes, token
  fields, bearer headers, callback URLs, and sensitive diagnostic payloads.
- Main/renderer log paths use the shared helper so frontend-visible auth/quota
  errors and bootstrap logs avoid raw secrets.

**Expanded floating widget**

- Floating widget keeps the compact 220 × 88 mode and adds a persisted
  `floating.expanded` mode at 260 × 168.
- A bottom expand/collapse button toggles the widget from the preload IPC
  surface, and the expanded view shows weekly quota plus today/month cost.

**Card semanal — pace badge removido**

- Badge de pace removido do card Semanal; card sessão mantém o badge.

**Bug fix — % da sessão desatualizado vs. barra**

- Root cause: state-changed disparado durante animação de entrada era descartado pelo
  guard `animatingElements.has(element)`. Barra atualizava (sem guard), texto ficava
  com valor antigo até próximo evento.
- Fix: no branch não-entering do render, `cancelCountUp` nos elementos antes de
  escrever o novo texto — atualização ao vivo sempre vence a animação.

**Alerta sonoro — testar e ajustar volume**

- Botão "Tocar" (`back-btn` + PlayOutline) abaixo do toggle de som em Configurações.
- Slider de volume (0–1, step 0.05) persistido em `preferences.notifications.soundVolume`.
- `playResetSound()` lê o volume do estado atual antes de tocar.
- `DEFAULT_PREFERENCES` inclui `soundVolume: 1.0`.

**Versão portable do App**

- `electron-builder.yml` alterado para produzir `nsis` + `portable` em `npm run build:win`.
- Artefato nomeado `Siphon-Portable-${version}.exe`.

**Bug fix — ALLOWED set e allowedIntervals incompletos**

- `notifications.soundVolume`, `notifications.limitSound` adicionados ao ALLOWED set em `registerIpc()`.
- `60` adicionado a `allowedIntervals` na validação de `refresh.intervalSeconds`.
- Sem esse fix, as preferências de volume e som de limite eram silenciosamente ignoradas.

**Sistema de sons de notificação — 3 canais independentes**

- 3 arquivos de áudio separados: `notificationReset.mp3` (reset), `notificationFull.mp3` (100%), `notificationAlert.mp3` (70%/90%).
- Settings/Notification reorganizado em 3 seções: *Play sound on reset*, *Play sound when session expires*, *Play sound when session hits 70/90%*.
- Cada seção tem toggle independente, botão de teste e slider de volume próprio.
- Novas preferências: `notifications.expireSound`, `notifications.expireSoundVolume`.
- Slider de volume desabilita visualmente (cor `--muted-foreground`) quando o toggle está off.
- Cruzamentos: reset = `onResetSound` IPC; 100% = `playFullSound`; 70%/90% = `playLimitSound`.

**Alerta de Uso Elevado + Alerta Crítico**

- `#highUsageBanner` (warning) aparece quando sessão ≥ 70% e < 90%.
- `#criticalBanner` (critical) aparece quando sessão ≥ 90%.
- Banners são dismissíveis por sessão; estado de dismiss reseta quando % cai abaixo do threshold.
- Strings i18n em en + pt-BR para os dois banners.

**Refresh interval — opção de 1 minuto**

- Opção `60 s` adicionada ao seletor de intervalo (antes de 5 min).
- `ALLOWED_REFRESH_INTERVALS` em `usageController.js` inclui `60`.
- Strings i18n `settings.refresh1m` em en + pt-BR.

**DPAPI-protected credentials**

- `PlaintextCrypto` and `SafeStorageCrypto` adapters injected into `TokenStore`.
- `SafeStorageCrypto` uses Electron `safeStorage` (DPAPI on Windows); falls back
  to plaintext with a warning when `isEncryptionAvailable()` is false.
- Files use a 1-byte format marker: `0x01` = DPAPI blob, `0x02` = plaintext,
  `0x7B` = legacy JSON (triggers one-time migration on load).
- `PlaintextCrypto` used in tests — no Electron context required.
- `main.js` unchanged: `new TokenStore()` gets DPAPI automatically.

- **Floating Widget Style**

  - Implementar nas configurações a opção para escolher o estilo do floating widget entre Classic e Mini.
  - Widget mini: Tamanho 71x32px, ícone Draggable à esquerda para indicar arraste, tray-icon com cor semântica somente, padding zero e borda geral sutil.
  - Criar o novo floating widget conforme design no Figma do link compartilhado.
  - https://www.figma.com/design/ZA62Ne6n8JQczrsKyErVag/siphon?node-id=165-1313&t=aPeKFBVdZy479xRi-4

- **Update Settings UI**

  - Nova tela de Settings dividida em 3 partes utilizado tabs.
  - Implementar atualizações de UI conforme design no Figma do link compartilhado.
  - https://www.figma.com/design/ZA62Ne6n8JQczrsKyErVag/siphon?node-id=136-4312&t=aPeKFBVdZy479xRi-4

**Camada de animação (motion layer)**

- Banners (`#highUsageBanner`, `#criticalBanner`, `#offlineBanner`, `#updateBanner`) animam entrada e saída via `showBanner(el)` / `hideBanner(el)` com `@keyframes bannerEnter` / `bannerLeave`.
- Meter atualiza segmentos in-place para preservar transições CSS de `background-color` entre níveis de quota sem snaps.
- `flashUpdate(el)` pulsa opacidade nos dados numéricos a cada atualização.
- Ícones de notificação cruzam via opacidade CSS em `.notif-icon-wrap` controlada pelo atributo `[data-notif-off]`.
- Todas as animações respeitam `prefers-reduced-motion`.

**CSS — consolidação de estilos**

- `.footer-link` e `.footer-quit-btn` fundidos em seletor múltiplo (eliminadas ~20 linhas duplicadas).
- Três seções de banner (USAGE ALERT, OFFLINE, UPDATE) consolidadas em seção BANNERS única com estrutura compartilhada e regras de variante separadas.
- Tokens de easing `--ease-out-quart` e `--ease-out-expo` adicionados ao `:root`.

**Delight pass — micro-interações**

- Ícone de refresh gira 360° durante fetch (`iconSpin`, 650ms ease-out-quart).
- Flash de reset de sessão: `#sessionPercent[data-just-reset]` acende em `sessionResetReveal` quando % cai de ≥ 95 para ≤ 5.
- `.notif-badge.notif-pop`: spring-scale de confirmação ao toggle de notificação.
- Pulso crítico: `criticalPulse` (staggered, infinite) em segmentos ativos quando `data-level="critical"`.
- Estados de press em todos botões interativos (`translateY(1px)` / `scale(0.87)`).
- `flashUpdate(el)` atualizado para brightness+opacity (lê como instrumento ao vivo).
- Console easter egg na inicialização do renderer.

**OKLCH color drift via `@property` (overdrive)**

- Três `@property` tipadas (`--seg-l`, `--seg-c`, `--seg-h`) em `.meter[data-level]` — segmentos ativos interpolam em espaço OKLCH sem midpoints dessaturados do sRGB.
- `setQuotaColorDrift(el, pct)` aplica três `@property` vars diretamente no `.quota-percent` — número de quota deriva continuamente de verde neutro (0%) até vermelho crítico (100%).
- Waypoints: 0–65% neutro, 70% amber, 90% laranja, 100% vermelho.

**Bug fix — especificidade de segmentos ativos no meter**

- Root cause: refactor do @property removeu as regras `.meter[data-level="warn"] .meter-segment.active` (especificidade 0,3,1). A regra de soft background (0,2,1) passou a vencer, tornando ativos e inativos indistinguíveis.
- Fix: regras explícitas restauradas para warn/high/critical com background `oklch(var(--seg-l) var(--seg-c) var(--seg-h))` na especificidade correta.

**Notificações — toast em 70%, 90% e 100%**

- Toast ao atingir 70% e 90% (`notifications.limitAlert`), e ao expirar sessão em 100% (`notifications.expireAlert`).
- Toggles independentes na aba Notificação em Configurações.
- Click no toast abre janela principal.

**Refresh interval — opção de 30 minutos removida**

- Opção `1800` removida de `ALLOWED_REFRESH_INTERVALS` (`usageController.js`) e `allowedIntervals` (`main.js` `registerIpc()`).
- `<option value="1800">` removida do select em `index.html`; chaves `settings.refresh30m` removidas do i18n (en + pt-BR) e do teste correspondente.
- Docs atualizados: README, AGENTS, CLAUDE.md, ARCHITECTURE.md, docs/api-and-data.md, ROADMAP — todos agora citam só 30 s / 1 / 5 / 15 min.

**Auto-update — verificação no GitHub Releases**

- `checkForUpdate()` (`updateService.js`) roda uma vez no startup do app empacotado: consulta `api.github.com/repos/kayodante/Win-siphonClaudeUsage/releases/latest`, ignora draft/prerelease, compara semver via `isNewer()`.
- Versão mais nova → envia `update-available` pro renderer (aguarda `did-finish-load` se preciso) → `#updateBanner` mostra "vX.Y.Z disponível para download".
- Botão "Baixar" dispara IPC `update:download`; `downloadFile()` baixa o `.exe` (não-Portable) pra pasta temp, validando protocolo/host de redirects contra allowlist (`github.com`, `objects.githubusercontent.com`, `github-releases.githubusercontent.com`).
- Progresso ao vivo via `update:progress`; ao concluir, botão vira "Instalar" → IPC `update:install` abre o instalador via `shell.openPath`.
- Banner é dismissível por sessão (`updateDismissed`).

## Now

*(sem itens pendentes)*

## Next

*(sem itens pendentes)*

## Later

- **Toggle Verificar atualizações automaticamente nas configurações**

  - Adicionar opção para verificar atualizações automaticamente nas configurações.
  - Verificar possibilidade de baixar atualização em segundo plano.
  - Se baixar em segundo plano for possível, adicionar toggle para habilitar essa opção também.
  - Se baixar em segundo plano for possível, Verificar atualização automaticamente -> Baixar atualização em segundo plano -> Exibir mensagem dizendo para reiniciar para aplicar atualização com botão "Reiniciar".

## Known issues / paper cuts

- No active paper cuts are tracked here right now.
