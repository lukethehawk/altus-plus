; First install only: when the original Altus (Aman Harwara) is on this PC,
; ask whether to install Altus + next to it or in its place.
;
; "Replace" copies the original's profile (%APPDATA%\Altus: WhatsApp sessions,
; tabs, settings, themes) into the Altus + profile, renames the original
; folder to "Altus (backup YYYY-MM-DD)" (never deleted), uninstalls the
; original program and removes its autostart entry. An install for all users
; leaves a copy installed for the user only (see ALTUS_SHOULD_OFFER) and says
; so. Nothing is touched unless the person picks "Replace", or a silent
; install passes --replace-altus.
; Updates (--updated), reinstalls and PCs that already have an Altus +
; profile never see the page.
;
; Saved as UTF-8 with BOM so NSIS reads the accented text correctly.

!ifndef BUILD_UNINSTALLER

!include nsDialogs.nsh

; Registry GUID of the original Altus: electron-builder's UUID v5 of its appId
; "harwara.aman.altus" (same for every version).
!define ORIGINAL_ALTUS_GUID "be25d1f4-3999-55bd-a6b3-0abfff8cb898"
!define ORIGINAL_ALTUS_EXE "Altus.exe"
!define ORIGINAL_ALTUS_PROFILE "Altus"
; Must match PROFILE_FOLDER_NAME in src/utils/isolation.ts.
!define ALTUS_PLUS_PROFILE "Altus Electron 44 Test"

Var altusChoice          ; "" (not offered), "side" or "replace"
Var altusUninstaller     ; original's uninstaller, if installed
Var altusUninstallScope  ; /currentuser or /allusers
Var altusInstallDir
Var altusUserOnlyDir     ; installed for this user only, left installed (see below)
Var altusRadioSide
Var altusRadioReplace

; Sets $R9 to 1 when the page should be offered, 0 otherwise.
!macro ALTUS_SHOULD_OFFER
  StrCpy $R9 0
  StrCpy $altusUninstaller ""
  ${IfNot} ${isUpdated}
    ; Altus + already installed: not a first install.
    ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R8 == ""
    ${AndIf} $R7 == ""
      SetShellVarContext current
      ; Never overwrite an existing Altus + profile (its own accounts).
      ${IfNot} ${FileExists} "$APPDATA\${ALTUS_PLUS_PROFILE}\*.*"
        ${If} ${FileExists} "$APPDATA\${ORIGINAL_ALTUS_PROFILE}\settings.json"
        ${OrIf} ${FileExists} "$APPDATA\${ORIGINAL_ALTUS_PROFILE}\Partitions\*.*"
          StrCpy $R9 1
        ${EndIf}
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ; The original program, if still installed (its data can outlive it):
      ; for this user (HKCU) or for all users (HKLM).
      ReadRegStr $R8 HKCU "Software\${ORIGINAL_ALTUS_GUID}" InstallLocation
      ReadRegStr $R7 HKLM "Software\${ORIGINAL_ALTUS_GUID}" InstallLocation
      StrCpy $altusUserOnlyDir ""
      ${If} $installMode == "all"
        ; An install for all users runs with administrator rights: only HKLM,
        ; which only an administrator can write, may name the uninstaller to
        ; run. Any program the user runs can write HKCU, and would get its
        ; own "Uninstall Altus.exe" run with those rights. A copy installed
        ; for this user only is left for them to uninstall.
        StrCpy $altusInstallDir $R7
        StrCpy $altusUninstallScope "/allusers"
        ${If} $R7 == ""
          StrCpy $altusUserOnlyDir $R8
        ${EndIf}
      ${ElseIf} $R8 != ""
        StrCpy $altusInstallDir $R8
        StrCpy $altusUninstallScope "/currentuser"
      ${Else}
        StrCpy $altusInstallDir $R7
        StrCpy $altusUninstallScope "/allusers"
      ${EndIf}
      ${If} $altusInstallDir != ""
      ${AndIf} ${FileExists} "$altusInstallDir\Uninstall Altus.exe"
        StrCpy $altusUninstaller "$altusInstallDir\Uninstall Altus.exe"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Closes the original Altus (current user's processes only). taskkill from
; System32 by its full path: run through cmd, it was looked up in the current
; folder first.
!macro ALTUS_CLOSE_ORIGINAL
  ReadEnvStr $R1 USERNAME
  nsExec::Exec `"$SYSDIR\taskkill.exe" /im "${ORIGINAL_ALTUS_EXE}" /fi "USERNAME eq $R1"`
  Pop $R0
  Sleep 1500
  nsExec::Exec `"$SYSDIR\taskkill.exe" /f /im "${ORIGINAL_ALTUS_EXE}" /fi "USERNAME eq $R1"`
  Pop $R0
  ; Let Chromium release its files before copying.
  Sleep 1500
!macroend

!macro customPageAfterChangeDir
  Page custom AltusChoicePageCreate AltusChoicePageLeave

  !insertmacro ALTUS_REPLACE_FUNCTION

  Function AltusChoicePageCreate
    StrCpy $altusChoice ""
    !insertmacro ALTUS_SHOULD_OFFER
    ${If} $R9 != 1
      Abort
    ${EndIf}
    StrCpy $altusChoice "side"

    ${If} $LANGUAGE == 1040
      !insertmacro MUI_HEADER_TEXT "Altus è già presente" "Scegli come installare Altus +"
      StrCpy $R1 "Su questo PC c'è già Altus, l'app originale. Altus + può affiancarlo oppure prenderne il posto."
      StrCpy $R2 "Installa accanto ad Altus$\r$\nLe due app restano separate, ciascuna con i propri account e impostazioni."
      StrCpy $R3 "Sostituisci Altus$\r$\nAccount WhatsApp, schede e impostazioni passano ad Altus +, poi Altus viene disinstallato. I suoi dati restano come backup nella cartella $\"Altus (backup <data>)$\"."
      StrCpy $R4 "Se Altus è aperto verrà chiuso."
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Altus is already installed" "Choose how to install Altus +"
      StrCpy $R1 "The original Altus app is on this PC. Altus + can run next to it or take its place."
      StrCpy $R2 "Install next to Altus$\r$\nBoth apps stay separate, each with its own accounts and settings."
      StrCpy $R3 "Replace Altus$\r$\nWhatsApp accounts, tabs and settings move to Altus +, then Altus is uninstalled. Its data is kept as a backup in the $\"Altus (backup <date>)$\" folder."
      StrCpy $R4 "If Altus is open, it will be closed."
    ${EndIf}

    nsDialogs::Create 1018
    Pop $R0
    ${If} $R0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 24u "$R1"
    Pop $R0
    ${NSD_CreateRadioButton} 0 30u 100% 28u "$R2"
    Pop $altusRadioSide
    ${NSD_AddStyle} $altusRadioSide 0x00002000 ; BS_MULTILINE
    ${NSD_CreateRadioButton} 0 64u 100% 40u "$R3"
    Pop $altusRadioReplace
    ${NSD_AddStyle} $altusRadioReplace 0x00002000 ; BS_MULTILINE
    ${NSD_CreateLabel} 0 112u 100% 12u "$R4"
    Pop $R0
    ${NSD_Check} $altusRadioSide
    nsDialogs::Show
  FunctionEnd

  Function AltusChoicePageLeave
    ${NSD_GetState} $altusRadioReplace $R0
    ${If} $R0 == ${BST_CHECKED}
      StrCpy $altusChoice "replace"
    ${Else}
      StrCpy $altusChoice "side"
    ${EndIf}
  FunctionEnd
!macroend

; Silent first installs can ask for the replacement explicitly. Inserted by
; customInit (installer.nsh): it must be decided before the install section,
; because electron-builder registers Altus + as installed before customInstall
; runs, and ALTUS_SHOULD_OFFER would then take it for a reinstall.
!macro ALTUS_SILENT_INIT
  ${If} ${Silent}
  ${AndIfNot} ${isUpdated}
    Push $R0
    Push $R1
    Push $R7
    Push $R8
    Push $R9
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--replace-altus" $R1
    ${IfNot} ${Errors}
      !insertmacro ALTUS_SHOULD_OFFER
      ${If} $R9 == 1
        StrCpy $altusChoice "replace"
      ${EndIf}
    ${EndIf}
    ClearErrors
    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend

!macro customInstall
  ; Chosen on the page, or by ALTUS_SILENT_INIT for silent installs.
  ${If} $altusChoice == "replace"
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7
    Push $R8
    Push $R9
    Call AltusReplaceOriginal
    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend

; Inserted with the page (after electron-builder's own includes), so the
; LogicLib, FileFunc and StrContains helpers it uses are defined.
!macro ALTUS_REPLACE_FUNCTION
Function AltusReplaceOriginal
  ${If} $LANGUAGE == 1040
    StrCpy $R5 "Non sono riuscito a copiare i dati di Altus. Altus + è installato accanto ad Altus, che non è stato modificato."
  ${Else}
    StrCpy $R5 "Could not copy the Altus data. Altus + is installed next to Altus, which was left unchanged."
  ${EndIf}

  DetailPrint "Closing Altus..."
  !insertmacro ALTUS_CLOSE_ORIGINAL

  SetShellVarContext current
  StrCpy $R2 "$APPDATA\${ORIGINAL_ALTUS_PROFILE}"
  StrCpy $R3 "$APPDATA\${ALTUS_PLUS_PROFILE}"

  ; robocopy handles paths longer than MAX_PATH (Service Worker caches).
  ; Disposable caches are skipped; exit codes below 8 mean success.
  DetailPrint "Copying Altus accounts, tabs and settings..."
  nsExec::ExecToLog `"$SYSDIR\robocopy.exe" "$R2" "$R3" /E /COPY:DAT /R:2 /W:1 /NP /NFL /NDL /XD Cache "Code Cache" GPUCache DawnGraphiteCache DawnWebGPUCache Crashpad /XF lockfile DevToolsActivePort`
  Pop $R0
  StrCpy $R1 0
  ${If} $R0 == "error"
  ${OrIf} $R0 == "timeout"
    StrCpy $R1 1
  ${ElseIf} $R0 >= 8
    StrCpy $R1 1
  ${ElseIf} ${FileExists} "$R2\settings.json"
  ${AndIfNot} ${FileExists} "$R3\settings.json"
    StrCpy $R1 1
  ${ElseIf} ${FileExists} "$R2\tabs.json"
  ${AndIfNot} ${FileExists} "$R3\tabs.json"
    StrCpy $R1 1
  ${EndIf}

  ${If} $R1 == 1
    DetailPrint "Copy failed (robocopy $R0); Altus left unchanged."
    ; The Altus + profile did not exist before (checked when offering).
    RMDir /r "$R3"
    MessageBox MB_OK|MB_ICONEXCLAMATION "$R5" /SD IDOK
    Goto altusRestoreContext
  ${EndIf}

  ; Keep the original data as a dated backup instead of deleting it.
  ${GetTime} "" "L" $R6 $R7 $R8 $R0 $R0 $R0 $R0
  StrCpy $R4 "$APPDATA\${ORIGINAL_ALTUS_PROFILE} (backup $R8-$R7-$R6)"
  ${If} ${FileExists} "$R4\*.*"
    ; Already one from today: add hour and minute.
    ${GetTime} "" "L" $R6 $R7 $R8 $R1 $R0 $R9 $R1
    StrCpy $R4 "$R4 $R0$R9"
  ${EndIf}
  ClearErrors
  Rename "$R2" "$R4"
  ${If} ${Errors}
    DetailPrint "Could not rename $R2; it stays where it is."
  ${Else}
    DetailPrint "Original data kept in $R4"
  ${EndIf}

  ; Its autostart entry would point at a removed program, or start one
  ; whose data has moved to Altus +.
  StrCpy $R9 $altusInstallDir
  ${If} $R9 == ""
    StrCpy $R9 $altusUserOnlyDir
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Altus"
  ${If} $R9 != ""
    ${StrContains} $R1 "$R9" "$R0"
    ${If} $R1 != ""
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Altus"
    ${EndIf}
  ${EndIf}

  ${If} $altusUserOnlyDir != ""
    DetailPrint "Altus is installed for this user only; left installed."
    ${If} $LANGUAGE == 1040
      StrCpy $R5 "Altus era installato solo per il tuo utente e non è stato disinstallato: puoi farlo da Impostazioni → App. Account, schede e impostazioni sono già passati ad Altus +."
    ${Else}
      StrCpy $R5 "Altus was installed for your user only and was not uninstalled: you can do it in Settings → Apps. Accounts, tabs and settings have already moved to Altus +."
    ${EndIf}
    MessageBox MB_OK|MB_ICONINFORMATION "$R5" /SD IDOK
  ${EndIf}

  ${If} $altusUninstaller != ""
    DetailPrint "Uninstalling Altus..."
    ; _?= runs the uninstaller in place so ExecWait waits for it.
    ExecWait `"$altusUninstaller" $altusUninstallScope /S _?=$altusInstallDir` $R0
    DetailPrint "Altus uninstaller finished ($R0)."
    Delete "$altusUninstaller"
    RMDir "$altusInstallDir"
  ${EndIf}

  altusRestoreContext:
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
FunctionEnd
!macroend

!endif
