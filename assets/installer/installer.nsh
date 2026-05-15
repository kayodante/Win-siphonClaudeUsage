!macro customInit
  SetShellVarContext current
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"
  SetShellVarContext all
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"
  SetShellVarContext current
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_RUN ""
  !define MUI_FINISHPAGE_RUN_TEXT "Criar atalho na area de trabalho"
  !define MUI_FINISHPAGE_RUN_FUNCTION siphonCreateDesktopShortcut
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir Siphon"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION siphonLaunchApp
  !insertmacro MUI_PAGE_FINISH

  Function siphonCreateDesktopShortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\app.asar.unpacked\assets\installer\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$DESKTOP\${PRODUCT_NAME}.lnk" "${APP_ID}"
  FunctionEnd

  Function siphonLaunchApp
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  FunctionEnd
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  SetShellVarContext current
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"
!macroend
