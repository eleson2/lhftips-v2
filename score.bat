@echo off
rem ---------------------------------------------------------------------------
rem  score.bat - score every guess that can be scored and produce standings.
rem
rem  Fetches all results and goalscorers from swehockey, scores the guesses
rem  already in the database, and writes the forum-ready standings to
rem  standings.txt. It does not touch the forum - run fetch-guesses.bat first
rem  to bring in new guesses. Catching up after several missed games is the
rem  same two runs: fetch-guesses.bat, then score.bat.
rem
rem  Usage:
rem    score.bat                        whole 2026-27 grundserie
rem    score.bat -r                     same, but open the review UI when a
rem                                        guessed scorer needs a human
rem                                        verdict (Ctrl+C closes it)
rem    score.bat 2026-09-19 2027-03-01  standings for an explicit range
rem    score.bat -r 2026-11-01          flag first, then the dates
rem
rem  Dates are YYYY-MM-DD, both ends inclusive. Scoring always covers the whole
rem  database; the dates only pick the range the standings table reports on.
rem
rem  Publishing to the thread stays manual:
rem    node src\index.js publish --target <thread url> --preview
rem ---------------------------------------------------------------------------
setlocal
pushd "%~dp0"

rem First and last grundserie fixture of the 2026-27 season.
set "SEASON_FROM=2026-09-19"
set "SEASON_TO=2027-03-16"

set "REVIEW=0"
if /i "%~1"=="-r" goto :flag
if /i "%~1"=="/r" goto :flag
if /i "%~1"=="--review" goto :flag
goto :args
:flag
set "REVIEW=1"
shift
:args
set "FROM=%~1"
set "TO=%~2"
if "%FROM%"=="" set "FROM=%SEASON_FROM%"
if "%TO%"=="" set "TO=%SEASON_TO%"

echo === 1/3  Fetching results and goalscorers ===
echo.
node "%~dp0src\index.js" scrape results
if errorlevel 1 goto :fail

echo.
echo === 2/3  Scoring guesses ===
echo.
rem calculate re-creates review-report.txt whenever something needs a look;
rem clear the old one first so its presence means "from this run".
if exist "review-report.txt" del "review-report.txt"
node "%~dp0src\index.js" calculate
if errorlevel 1 goto :fail

if not exist "review-report.txt" goto :standings
if "%REVIEW%"=="1" goto :do_review

echo.
echo Some guesses need a human verdict - see review-report.txt.
echo   To rule on them:  node src\index.js review
echo   ...then re-score: node src\index.js calculate --force
echo   Or re-run:        score.bat -r
echo.
echo Standings below are computed without those verdicts.
goto :standings

:do_review
echo.
echo Pre-computing AI suggestions for the scorer queue (needs Ollama running;
echo harmless if it is not - it just reports failures).
node "%~dp0src\index.js" suggest scorers
echo.
echo Opening the review UI. Rule on the cards, then press Ctrl+C.
echo.
node "%~dp0src\index.js" review
echo.
echo Re-scoring with the verdicts applied.
echo.
node "%~dp0src\index.js" calculate --force
if errorlevel 1 goto :fail

:standings
echo.
echo === 3/3  Standings %FROM% .. %TO% ===
echo.
node "%~dp0src\index.js" standings --from %FROM% --to %TO%
if errorlevel 1 goto :fail

echo.
echo Done. standings.txt is ready to paste into the thread.
popd
endlocal
exit /b 0

:fail
echo.
echo *** Step failed - stopping. Later steps were not run.
popd
endlocal
exit /b 1
