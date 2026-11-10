; Custom NSIS script for the Altus + installer (makers/MakerNSIS.ts,
; nsis.include). electron-builder takes a single include, so this pulls in
; each feature.

; Notice shown while an in-app update installs silently.
!include "${__FILEDIR__}\updateBanner.nsh"
; First install next to, or in place of, the original Altus.
!include "${__FILEDIR__}\replaceAltus.nsh"
; Uninstalling removes the app's whatsapp:// registration.
!include "${__FILEDIR__}\whatsappLinks.nsh"

; electron-builder allows one customInit; it runs in .onInit, after the
; install mode (current user / all users) is set and before anything is
; installed.
!macro customInit
  !insertmacro UPDATE_BANNER_INIT
  !ifndef BUILD_UNINSTALLER
    !insertmacro ALTUS_SILENT_INIT
  !endif
!macroend
