import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const watchMode = process.argv.includes("--watch");

const staticFiles = [
  "manifest.json",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "popup/popup.html",
  "popup/popup.css",
  "options/options.html",
  "options/options.css",
];

const buildTargets = [
  {
    entryPoints: [path.join(srcDir, "background", "index.js")],
    outfile: path.join(distDir, "background.js"),
    format: "esm",
  },
  {
    entryPoints: [path.join(srcDir, "content", "index.js")],
    outfile: path.join(distDir, "content.js"),
    format: "iife",
  },
  {
    entryPoints: [path.join(srcDir, "popup", "index.js")],
    outfile: path.join(distDir, "popup.js"),
    format: "esm",
  },
  {
    entryPoints: [path.join(srcDir, "options", "index.js")],
    outfile: path.join(distDir, "options.js"),
    format: "esm",
  },
];

async function ensureDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyStaticFiles() {
  for (const relativePath of staticFiles) {
    const sourcePath = path.join(srcDir, relativePath);
    const destinationPath = path.join(distDir, relativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

function createBuildConfig(target) {
  return {
    ...target,
    bundle: true,
    minify: false,
    sourcemap: false,
    target: "chrome120",
    logLevel: "info",
  };
}

async function run() {
  await ensureDist();
  await copyStaticFiles();

  if (watchMode) {
    const contexts = [];
    for (const target of buildTargets) {
      const context = await esbuild.context(createBuildConfig(target));
      await context.watch();
      contexts.push(context);
    }
    console.log("Watching source files. Output directory: dist/");
    return;
  }

  await Promise.all(buildTargets.map((target) => esbuild.build(createBuildConfig(target))));
  console.log("Build complete. Load the dist/ directory as an unpacked extension.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
