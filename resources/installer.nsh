!include "WinMessages.nsh"

!macro SourcefieldTerminalPath ACTION
  Push $R0
  Push $R1
  StrCpy $R1 "User"
  ${if} $installMode == "all"
    StrCpy $R1 "Machine"
  ${endif}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\sourcefield-path.ps1" -Action ${ACTION} -Directory "$INSTDIR" -Scope $R1'
  Pop $R0
  ${if} $R0 != 0
    DetailPrint "The Sourcefield terminal command could not be registered."
  ${endif}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  !insertmacro SourcefieldTerminalPath Add
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro SourcefieldTerminalPath Remove
  ${endif}
!macroend
