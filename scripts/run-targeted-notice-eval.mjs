import { spawn } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const npm = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmPrefixArgs = npmExecPath ? [npmExecPath] : [];
const forwardedArgs = process.argv.slice(2);

await runNpm(["run", "build", "-w", "packages/shared"]);
await runNpm(["run", "build", "-w", "packages/prompt-kit"]);
await runNpm(["run", "eval:notice", "-w", "apps/worker", "--", ...forwardedArgs]);

function runNpm(args) {
  return run(npm, [...npmPrefixArgs, ...args]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: !npmExecPath && process.platform === "win32"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}
