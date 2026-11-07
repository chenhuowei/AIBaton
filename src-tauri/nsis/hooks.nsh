; Aibaton NSIS hooks
;
; Tauri's uninstall CONFIRM page has a "delete app data" checkbox that is
; intentionally NOT checked by default. `customLanguageFiles/English.nsh`
; makes its label loud and explicit. These hooks add a second, hard-to-miss
; confirmation when the user DOES check it, and a clear notice when they don't.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Runs at the start of the uninstall section, before files are removed.
  ; $DeleteAppDataCheckboxState is populated by un.ConfirmLeave.
  ${If} $DeleteAppDataCheckboxState = 1
    MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 \
      "WARNING: You chose to DELETE ALL APPLICATION DATA.$\n$\n\
       This removes chat history, settings, logs and the downloaded Node.js runtime (~104 MB).$\n\
       Location: $APPDATA\${BUNDLEID}$\n$\n\
       This cannot be undone. Continue with deletion?" \
      IDYES keep_delete IDNO cancel_delete
    cancel_delete:
      StrCpy $DeleteAppDataCheckboxState 0
    keep_delete:
  ${Else}
    ; Checkbox unchecked — data is preserved. Tell the user where it lives so
    ; the ~104 MB Node runtime is not a mystery leftover.
    MessageBox MB_ICONINFORMATION|MB_OK \
      "Application data will be KEPT (chat history, settings, Node.js runtime).$\n\
       Location: $APPDATA\${BUNDLEID}$\n$\n\
       Delete that folder manually if you want a complete cleanup."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
