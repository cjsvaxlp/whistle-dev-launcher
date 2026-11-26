!define CYBERCAFE_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  Push $OUTDIR
  SetOutPath "$PLUGINSDIR"
  File "/oname=release-runtime.ps1" "${CYBERCAFE_HOOK_DIR}\release-runtime.ps1"
  Pop $0
  SetOutPath "$0"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\release-runtime.ps1" "$INSTDIR\tools\runtime\node.exe"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "无法清理旧版内置运行时。请退出 Cybercafe 后重试。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ; Remove the legacy CMD shortcut before NSIS creates the native Cybercafe link.
  Delete "$SMPROGRAMS\Cybercafe.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Upgrade cleanup is limited to the former app-owned runtime directory.
  RMDir /r "$INSTDIR\tools\runtime"
!macroend
