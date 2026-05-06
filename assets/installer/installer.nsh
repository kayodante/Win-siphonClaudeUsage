ShowInstDetails show
InstallColors 40F589 000000

!macro customFinishPage
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Criar atalho na area de trabalho"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION siphonCreateDesktopShortcut
  !insertmacro MUI_PAGE_FINISH

  Function siphonCreateDesktopShortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
