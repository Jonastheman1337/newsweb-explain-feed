import { spawn } from "node:child_process";

// next dev forks a server. On Windows terminate only this launcher's own tree.
export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Process ${child.pid} did not stop`)), 5000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.once("error", reject);
      killer.once("exit", (code) =>
        code === 0 || child.exitCode !== null
          ? resolve()
          : reject(new Error(`Could not stop process ${child.pid}`))
      );
    });
  } else {
    child.kill("SIGTERM");
  }
  await closed;
}
