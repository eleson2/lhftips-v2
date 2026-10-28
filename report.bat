@echo off
rem ---------------------------------------------------------------------------
rem  report.bat - leaderboard for a date range.
rem
rem  Successor to 5.bat (node showScorePPG -b <from> -e <to>) from the
rem  2018-2024 toolset in D:\proj\lhftips. Same idea, same ISO date format,
rem  same inclusive-both-ends range; the result table is richer.
rem
rem  Usage:
rem    report.bat                        whole 2026-27 grundserie
rem    report.bat 2026-09-19 2027-03-01  explicit range
rem    report.bat 2026-11-01             from a date through end of season
rem
rem  Dates are YYYY-MM-DD. Both ends are inclusive.
rem ---------------------------------------------------------------------------
setlocal

rem First and last grundserie fixture of the 2026-27 season.
set "SEASON_FROM=2026-09-19"
set "SEASON_TO=2027-03-16"

set "FROM=%~1"
set "TO=%~2"
if "%FROM%"=="" set "FROM=%SEASON_FROM%"
if "%TO%"=="" set "TO=%SEASON_TO%"

echo Leaderboard %FROM% .. %TO%
echo.
node "%~dp0src\index.js" report --from %FROM% --to %TO%

endlocal
