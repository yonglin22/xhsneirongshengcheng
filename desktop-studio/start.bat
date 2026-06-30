@echo off
chcp 65001 >nul
title 朱砂 · 真机执行端
cd /d "%~dp0"
echo ================  朱砂 · 真机执行端  ================
echo.

where adb >nul 2>nul || (echo [X] 没装 adb。请装 platform-tools 并加入 PATH。& pause & exit /b)
where node >nul 2>nul || (echo [X] 没装 node。请到 nodejs.org 装 Node。& pause & exit /b)

set "CFG=%USERPROFILE%\.zhusha-studio-token"
set "TOKEN="
if exist "%CFG%" set /p TOKEN=<"%CFG%"
if "%TOKEN%"=="" (
  echo 首次使用：到网页「设备看板→接入真机/脚本」生成 token（zd_ 开头），粘到这里：
  set /p TOKEN=
  echo %TOKEN%>"%CFG%"
  echo [OK] token 已保存，下次不用再填。
)
echo.

echo 检测真机…
adb devices | findstr /r "device$" >nul || (echo [X] 没检测到真机：USB连接+开USB调试+手机点允许。& pause)

where scrcpy >nul 2>nul && (echo 启动投屏… & start "" scrcpy)

echo 启动执行端，去网页下发任务即可。Ctrl+C 退出。
echo ====================================================
echo.
node run-agent.js %TOKEN%
pause
