@echo off
rem ---------------------------------------------------------------------------
rem  standings.bat - forum-ready standings post for a date range.
rem
rem  Successor to 7.bat (node show7pts -b <from> -e <to>) from the 2018-2024
rem  toolset in D:\proj\lhftips. The v2 standings post already contains the
rem  "Fullpoangare" (7-point) list 7.bat produced separately, plus the table.
rem
rem  Writes standings.txt and prints it, ready to paste into the thread.
rem
rem  Usage:
rem    standings.bat                        whole 2026-27 grundserie
rem    standings.bat 2026-09-19 2027-03-01  explicit range
rem
rem  Dates are YYYY-MM-DD. Both ends are inclusive.
rem ---------------------------------------------------------------------------
setlocal

set "SEASON_FROM=2026-09-19"
set "SEASON_TO=2027-03-16"

set "FROM=%~1"
set "TO=%~2"
if "%FROM%"=="" set "FROM=%SEASON_FROM%"
if "%TO%"=="" set "TO=%SEASON_TO%"

node "%~dp0src\index.js" standings --from %FROM% --to %TO%

endlocal
