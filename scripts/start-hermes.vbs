Option Explicit

' Silent wrapper used by the Startup shortcut. Runs start-hermes.ps1 with no
' console window and returns immediately; the gateway and app detach.

Dim shell, fso, scriptDir, ps1, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(scriptDir, "start-hermes.ps1")

If Not fso.FileExists(ps1) Then
    WScript.Quit 1
End If

command = "powershell.exe -NoLogo -NoProfile -NonInteractive" _
    & " -ExecutionPolicy Bypass -WindowStyle Hidden" _
    & " -File " & Chr(34) & ps1 & Chr(34)

shell.Run command, 0, False
