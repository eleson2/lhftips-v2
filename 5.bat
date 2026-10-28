@echo off
rem  5.bat - standings in the legacy showScorePPG layout, for pasting on the web.
rem  Port of 5.bat from D:\proj\lhftips. Output format is deliberately unchanged.
rem
rem    5.bat                        whole 2026-27 grundserie
rem    5.bat 2026-09-19 2027-03-01  explicit range
setlocal
set "FROM=%~1"
set "TO=%~2"
if "%FROM%"=="" set "FROM=2026-09-19"
if "%TO%"=="" set "TO=2027-03-16"
node "%~dp0showScorePPG.js" -b %FROM% -e %TO%
endlocal
