!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!macro customFinishPage
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW siphonFinishShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE siphonFinishLeave
  !insertmacro MUI_PAGE_FINISH

  Function siphonFinishShow
    ${NSD_CreateCheckbox} 120u 110u 180u 10u "Criar atalho na area de trabalho"
    Pop $R8
    ${NSD_Check} $R8
  FunctionEnd

  Function siphonFinishLeave
    ${NSD_GetState} $R8 $R9
    ${If} $R9 == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
