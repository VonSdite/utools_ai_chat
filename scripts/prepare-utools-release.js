#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT_DIR, "dist", "utools");
const SKIP_INSTALL = process.argv.includes("--skip-install");
const KEEP_PACKAGE_JSON = process.argv.includes("--keep-package-json");

const RUNTIME_FILES = [
  "plugin.json",
  "index.html",
  "index.css",
  "index.js",
  "preload.js",
  "logo.svg",
  "logo.png"
];

const RUNTIME_DIRS = ["vendor"];
const RUNTIME_DEPENDENCIES = ["chardet", "iconv-lite", "officeparser", "word-extractor"];

main();

function main() {
  cleanOutputDir();
  copyRuntimeFiles();
  copyRuntimeDirs();
  writeReleasePackageJson();

  if (SKIP_INSTALL) {
    console.log("Skipped dependency install. Run npm install inside dist/utools before publishing.");
  } else {
    installRuntimeDependencies();
    removeTemporaryPackageFiles();
  }

  console.log("");
  console.log("uTools release directory ready:");
  console.log(path.relative(ROOT_DIR, OUT_DIR));
}

function cleanOutputDir() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function copyRuntimeFiles() {
  RUNTIME_FILES.forEach((fileName) => {
    copyPath(path.join(ROOT_DIR, fileName), path.join(OUT_DIR, fileName));
  });
}

function copyRuntimeDirs() {
  RUNTIME_DIRS.forEach((dirName) => {
    copyPath(path.join(ROOT_DIR, dirName), path.join(OUT_DIR, dirName));
  });
}

function copyPath(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error("Missing release source: " + path.relative(ROOT_DIR, source));
  }
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    dereference: false
  });
}

function writeReleasePackageJson() {
  const rootPackage = readJson(path.join(ROOT_DIR, "package.json"));
  const dependencies = {};

  RUNTIME_DEPENDENCIES.forEach((name) => {
    const version = rootPackage.dependencies && rootPackage.dependencies[name];
    if (!version) {
      throw new Error("Missing runtime dependency in package.json: " + name);
    }
    dependencies[name] = version;
  });

  const releasePackage = {
    name: rootPackage.name + "-utools-release",
    version: rootPackage.version,
    private: true,
    dependencies
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "package.json"),
    JSON.stringify(releasePackage, null, 2) + "\n",
    "utf8"
  );
}

function installRuntimeDependencies() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false"
    ],
    {
      cwd: OUT_DIR,
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error("Failed to install release dependencies.");
  }
}

function removeTemporaryPackageFiles() {
  if (KEEP_PACKAGE_JSON) {
    return;
  }
  fs.rmSync(path.join(OUT_DIR, "package.json"), { force: true });
  fs.rmSync(path.join(OUT_DIR, "package-lock.json"), { force: true });
  fs.rmSync(path.join(OUT_DIR, "node_modules", ".package-lock.json"), { force: true });
  fs.rmSync(path.join(OUT_DIR, "node_modules", ".bin"), { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
