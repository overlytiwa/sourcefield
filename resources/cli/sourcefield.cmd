@echo off
setlocal
if /i "%~1"=="--help" goto help
if /i "%~1"=="-h" goto help
if /i "%~1"=="--version" (
  type "%~dp0sourcefield-version.txt"
  exit /b 0
)
if not exist "%~dp0Sourcefield.exe" (
  echo Sourcefield could not be found. Reinstall the application and try again. 1>&2
  exit /b 1
)
if /i "%~1"=="mcp" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%~dp0Sourcefield.exe" "%~dp0resources\mcp\sourcefield-mcp.cjs"
  exit /b
)
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0Sourcefield.exe" %*
exit /b

:help
echo Sourcefield
echo.
echo Usage: sourcefield [directory ^| map.sourcefield]
echo.
echo   sourcefield .        Open the current directory
echo   sourcefield          Open the application
echo   sourcefield mcp      Start the local MCP server
echo   sourcefield --version
exit /b 0
