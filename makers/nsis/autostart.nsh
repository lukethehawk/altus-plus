; Uninstalling Altus + removes its autostart entry (Settings -> "Launch at
; system startup") when it still starts this installation: Windows would
; otherwise keep it in Task Manager -> Startup apps, pointing to a program
; that is gone. An entry of another installation is left alone.
;
; The app writes the entry through auto-launch (src/main.ts, updateAutostart):
; in HKCU\...\Run, named after the exe without ".exe", with the command
; "<exe>" --hidden (src/utils/startup.ts).
;
; Updates and reinstalls run the old uninstaller with --updated: the entry
; stays, since the app keeps the same path.

!define AUTOSTART_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

!macro AUTOSTART_UNINSTALL
  ${IfNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    Push $3
    ; auto-launch names the value after the exe file, without ".exe".
    StrCpy $3 "${APP_EXECUTABLE_FILENAME}" -4
    ReadRegStr $0 HKCU "${AUTOSTART_RUN_KEY}" $3
    StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    StrLen $2 $1
    StrCpy $0 $0 $2
    ; LogicLib's == ignores case, as Windows paths do.
    ${If} $0 == $1
      DeleteRegValue HKCU "${AUTOSTART_RUN_KEY}" $3
      DetailPrint "Removed the autostart entry"
    ${EndIf}
    ; A missing entry leaves the error flag set.
    ClearErrors
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
