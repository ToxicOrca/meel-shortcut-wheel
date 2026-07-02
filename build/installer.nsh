!macro customInit
  ; Kill any running Meel process before installing/updating
  nsExec::ExecToLog 'taskkill /f /im "Meel.exe"'
  Sleep 1000
!macroend
