const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// ===== CONFIGURATION =====
const CONFIG = {
  host: "tuxunai.zuoqirun.top",
  user: "zuoqirun",
  // 宝塔面板默认站点目录
  remotePath: "/www/wwwroot/tuxunai",
  localPath: path.resolve(__dirname, ".."),
  // 同步时排除的文件/目录（服务器上已有的其他文件不会被删除）
  exclude: [
    ".git",
    "node_modules",
    ".env",
    ".claude",
    "pem",
    "dist",
    "*.log",
    "test.png",
    ".gitignore",
  ],
  // 同步后重启远程服务（宝塔 PM2 管理器）
  restartRemote: true,
  // 宝塔面板默认使用 pm2 管理 Node 项目，进程名通常是项目目录名
  restartCmd: "pm2 restart tuxunai 2>/dev/null || pm2 restart server 2>/dev/null || (cd /www/wwwroot/tuxunai && pm2 start server.js --name tuxunai)",
};

const ARGV = process.argv.slice(2);
const WATCH_MODE = ARGV.includes("--watch") || ARGV.includes("-w");
const DEBOUNCE_MS = 3000;

// ===== SSH CONNECTION TEST =====
function testConnection() {
  return new Promise((resolve) => {
    const ssh = spawn("ssh", [
      "-o",
      "ConnectTimeout=5",
      "-o",
      "BatchMode=yes",
      `${CONFIG.user}@${CONFIG.host}`,
      "echo ok",
    ]);
    let output = "";
    ssh.stdout.on("data", (d) => (output += d.toString()));
    ssh.on("close", (code) => resolve(code === 0 && output.includes("ok")));
    ssh.on("error", () => resolve(false));
  });
}

function testSudo() {
  return new Promise((resolve) => {
    const ssh = spawn("ssh", [
      "-o",
      "ConnectTimeout=5",
      "-o",
      "BatchMode=yes",
      `${CONFIG.user}@${CONFIG.host}`,
      "sudo -n whoami 2>/dev/null",
    ]);
    let output = "";
    ssh.stdout.on("data", (d) => (output += d.toString()));
    ssh.on("close", (code) => resolve(code === 0 && output.includes("root")));
    ssh.on("error", () => resolve(false));
  });
}

// ===== DEPLOY VIA TAR + SSH =====
// tar xzf 只覆盖同名文件，不删除服务器上已有的其他文件
// 宝塔面板文件归 www 所有，需 sudo
function deploy() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tarArgs = ["czf", "-"];
    for (const pattern of CONFIG.exclude) {
      tarArgs.push(`--exclude=${pattern}`);
    }
    tarArgs.push(".");

    // Try sudo first (宝塔权限), fallback to direct extract
    const remoteCmd = `sudo -n tar xzf - -C ${CONFIG.remotePath} 2>/dev/null || tar xzf - -C ${CONFIG.remotePath}`;

    const tar = spawn("tar", tarArgs, { cwd: CONFIG.localPath });
    const ssh = spawn("ssh", [
      "-o",
      "ConnectTimeout=10",
      `${CONFIG.user}@${CONFIG.host}`,
      remoteCmd,
    ]);

    let sshStderr = "";

    tar.stderr.on("data", (d) => (sshStderr += d.toString()));
    ssh.stderr.on("data", (d) => (sshStderr += d.toString()));

    tar.stdout.pipe(ssh.stdin);

    ssh.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code !== 0) {
        console.error(`\n[deploy] Failed (exit ${code}) after ${elapsed}s`);
        const stderr = sshStderr.trim();
        if (stderr) {
          // Filter out repetitive tar "Cannot open" messages
          const lines = stderr.split("\n").filter((l) => l.trim());
          const unique = [...new Set(lines)];
          console.error(unique.slice(0, 3).join("\n"));
          if (unique.length > 3) console.error(`... and ${unique.length - 3} more errors`);
        }
        if (stderr.includes("Cannot open") || stderr.includes("Operation not permitted")) {
          console.error("[deploy] 权限不足，请在服务器上运行一次：");
          console.error(`[deploy]   sudo setfacl -R -m u:${CONFIG.user}:rwx ${CONFIG.remotePath}`);
        }
        return reject(new Error(`ssh exited with code ${code}`));
      }
      console.log(`[deploy] Synced to ${CONFIG.remotePath} in ${elapsed}s (other files untouched)`);
      resolve();
    });

    tar.on("error", reject);
    ssh.on("error", reject);
  });
}

// ===== REMOTE RESTART =====
function restartRemote() {
  return new Promise((resolve) => {
    console.log("[deploy] Restarting remote server...");
    const ssh = spawn("ssh", [
      "-o",
      "ConnectTimeout=5",
      `${CONFIG.user}@${CONFIG.host}`,
      CONFIG.restartCmd,
    ]);
    ssh.on("close", (code) => {
      if (code === 0) {
        console.log("[deploy] Remote server restarted");
      } else {
        console.log("[deploy] Remote restart returned code", code);
      }
      resolve();
    });
    ssh.on("error", () => resolve());
  });
}

// ===== MAIN SYNC =====
async function sync() {
  try {
    await deploy();
    if (CONFIG.restartRemote) {
      await restartRemote();
    }
    console.log("[deploy] Done\n");
  } catch (err) {
    console.error("[deploy] Sync failed:", err.message);
  }
}

// ===== FILE WATCHER =====
function startWatcher() {
  const excludes = new Set(
    CONFIG.exclude.map((e) => e.replace(/^\*\./, "."))
  );
  const skipDirs = new Set([
    ".git",
    "node_modules",
    ".claude",
    "pem",
    "dist",
  ]);

  function shouldSkip(filePath) {
    const rel = path.relative(CONFIG.localPath, filePath);
    if (!rel) return true;
    const parts = rel.split(path.sep);
    if (parts[0] && skipDirs.has(parts[0])) return true;
    const basename = path.basename(filePath);
    if (basename.endsWith(".log")) return true;
    if (basename === ".env") return true;
    return false;
  }

  let timer = null;
  let pending = 0;

  function onFileChange(filePath) {
    if (shouldSkip(filePath)) return;
    pending++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const count = pending;
      pending = 0;
      process.stdout.write(
        `\n[watch] ${count} file(s) changed, syncing...`
      );
      sync();
    }, DEBOUNCE_MS);
  }

  try {
    fs.watch(CONFIG.localPath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        onFileChange(path.join(CONFIG.localPath, filename));
      }
    });
    console.log("[watch] Watching for changes in", CONFIG.localPath);
    console.log("[watch] Will auto-sync to", `${CONFIG.user}@${CONFIG.host}:${CONFIG.remotePath}`);
    console.log("[watch] Press Ctrl+C to stop\n");
  } catch (err) {
    console.error("[watch] fs.watch failed:", err.message);
    console.log("[watch] Falling back to polling mode (10s interval)");
    // Fallback: poll every 10 seconds
    let lastMtimes = new Map();
    setInterval(() => {
      try {
        const files = walkDir(CONFIG.localPath, skipDirs);
        let changed = false;
        for (const f of files) {
          const mtime = fs.statSync(f).mtimeMs;
          if (lastMtimes.get(f) !== mtime) {
            lastMtimes.set(f, mtime);
            changed = true;
          }
        }
        if (changed) {
          process.stdout.write("\n[poll] Changes detected, syncing...");
          sync();
        }
      } catch {}
    }, 10000);
    console.log("[poll] Polling for changes every 10s\n");
  }
}

function walkDir(dir, skipDirs) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results.push(...walkDir(full, skipDirs));
        } else {
          results.push(full);
        }
      } catch {}
    }
  } catch {}
  return results;
}

// ===== ENTRY =====
async function main() {
  console.log(`[deploy] Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.remotePath}\n`);

  const connected = await testConnection();
  if (!connected) {
    console.error("[deploy] Cannot connect to server.");
    console.error("[deploy] Make sure SSH key is set up:");
    console.error(`[deploy]   ssh-copy-id ${CONFIG.user}@${CONFIG.host}`);
    console.error("[deploy] Or test manually:");
    console.error(`[deploy]   ssh ${CONFIG.user}@${CONFIG.host}\n`);
    process.exit(1);
  }
  console.log("[deploy] SSH connection OK");

  const hasSudo = await testSudo();
  if (hasSudo) {
    console.log("[deploy] sudo access OK");
  } else {
    console.log("[deploy] sudo unavailable (will try direct write)");
    console.log("[deploy] If permission errors occur, run on server:");
    console.log(`[deploy]   sudo setfacl -R -m u:${CONFIG.user}:rwx ${CONFIG.remotePath}`);
  }
  console.log("");

  if (WATCH_MODE) {
    // Initial sync
    await sync();
    startWatcher();
  } else {
    await sync();
    process.exit(0);
  }
}

main();
