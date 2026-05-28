; Welcome/Finish inner panel — match sidebar dark background
BrandingText "Siphon · v${VERSION}"
!define MUI_HEADER_TRANSPARENT_TEXT
!define MUI_BGCOLOR "0F0F0F"
!define MUI_TEXTCOLOR "DEDEDE"

; Welcome page copy
!define MUI_WELCOMEPAGE_TITLE "Welcome to Siphon"
!define MUI_WELCOMEPAGE_TEXT "This setup wizard will install $(^Name) on your computer.$\r$\n$\r$\nSelect Next to continue."

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
  !define MUI_FINISHPAGE_RUN_TEXT "Create desktop shortcut"
  !define MUI_FINISHPAGE_RUN_FUNCTION siphonCreateDesktopShortcut
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open Siphon"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION siphonLaunchApp
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW siphonFinishPageShow
  !insertmacro MUI_PAGE_FINISH

  Function siphonFinishPageShow
    System::Call 'uxtheme::SetWindowTheme(i $mui.FinishPage.Run, w " ", w " ")'
    System::Call 'uxtheme::SetWindowTheme(i $mui.FinishPage.ShowReadme, w " ", w " ")'
    SetCtlColors $mui.FinishPage.Run "DEDEDE" "0F0F0F"
    SetCtlColors $mui.FinishPage.ShowReadme "DEDEDE" "0F0F0F"
  FunctionEnd

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
