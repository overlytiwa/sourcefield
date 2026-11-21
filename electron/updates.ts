import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
export function startUpdates() {
  if (!app.isPackaged || process.env.SOURCEFIELD_DISABLE_UPDATES === "1")
    return () => {};
  // NSIS and AppImage support unattended installation on quit. Squirrel.Mac
  // stages signed updates for relaunch. Portable Windows builds are excluded.
  if (process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_FILE)
    return () => {};
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("error", (error) =>
    console.error("Update check:", error.message),
  );
  autoUpdater.on("update-downloaded", (info) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("sourcefield:update-ready", {
        version: info.version,
      });
  });
  const check = () => {
    void autoUpdater
      .checkForUpdates()
      .catch((error) => console.error("Update check:", error.message));
  };
  const initial = setTimeout(check, 15000);
  const timer = setInterval(check, 4 * 60 * 60 * 1000);
  initial.unref();
  timer.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}
