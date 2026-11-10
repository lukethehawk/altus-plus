; Uninstalling Altus + removes the whatsapp:// registration that the app
; writes while Settings -> "Open whatsapp:// links" is on, when it still points
; to this installation: Windows would otherwise keep sending the links to a
; program that is gone. Another app's registration is left alone.
;
; The app registers through Electron (setAsDefaultProtocolClient), which
; writes HKCU\Software\Classes\whatsapp with the command "<exe>" -- "%1"
; (src/main.ts, src/utils/whatsappLinks.ts).
;
; Updates and reinstalls run the old uninstaller with --updated: the
; registration stays, since the app keeps the same path.

!define WHATSAPP_PROTOCOL_KEY "Software\Classes\whatsapp"

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 HKCU "${WHATSAPP_PROTOCOL_KEY}\shell\open\command" ""
    StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    StrLen $2 $1
    StrCpy $0 $0 $2
    ; LogicLib's == ignores case, as Windows paths do.
    ${If} $0 == $1
      DeleteRegKey HKCU "${WHATSAPP_PROTOCOL_KEY}"
      DetailPrint "Removed the whatsapp:// link registration"
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
