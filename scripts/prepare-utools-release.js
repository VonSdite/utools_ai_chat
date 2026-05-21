#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");

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
const UNUSED_OFFICEPARSER_OCR_PACKAGES = [
  "@borewit",
  "@tokenizer",
  "bmp-js",
  "file-type",
  "idb-keyval",
  "ieee754",
  "is-url",
  "node-fetch",
  "opencollective-postinstall",
  "regenerator-runtime",
  "tesseract.js",
  "tesseract.js-core",
  "token-types",
  "tr46",
  "strtok3",
  "uint8array-extras",
  "wasm-feature-detect",
  "webidl-conversions",
  "whatwg-url",
  "zlibjs"
];
const UNUSED_FFLATE_PATHS = [
  "esm",
  "umd",
  path.join("lib", "browser.cjs"),
  path.join("lib", "worker.cjs")
];
const UNUSED_PDFJS_PATHS = [
  "CODE_OF_CONDUCT.md",
  "README.md",
  "build",
  "cmaps",
  "iccs",
  "image_decoders",
  "standard_fonts",
  "types",
  "wasm",
  "web",
  "webpack.mjs",
  path.join("legacy", "image_decoders"),
  path.join("legacy", "web"),
  path.join("legacy", "webpack.mjs"),
  path.join("legacy", "build", "pdf.d.mts"),
  path.join("legacy", "build", "pdf.min.mjs"),
  path.join("legacy", "build", "pdf.sandbox.min.mjs"),
  path.join("legacy", "build", "pdf.sandbox.mjs"),
  path.join("legacy", "build", "pdf.worker.min.mjs")
];
const UNUSED_OFFICEPARSER_PATHS = [
  path.join("dist", "cli.js"),
  path.join("dist", "index.mjs"),
  path.join("dist", "officeparser.browser.iife.js"),
  path.join("dist", "officeparser.browser.mjs"),
  path.join("dist", "sbom.cdx.json")
];
const UNUSED_RELEASE_SUFFIXES = [".d.ts", ".d.mts", ".d.cts", ".map", ".js.gz"];
const UNUSED_RELEASE_DOC_NAMES = [
  "changelog",
  "code_of_conduct",
  "history",
  "porting-buffer",
  "readme",
  "security"
];
const UNUSED_RELEASE_TEST_DIRS = ["__tests__", "test", "tests"];
const MINIFY_SCRIPT_EXTENSIONS = [".cjs", ".js", ".mjs"];

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
    removeUnusedRuntimeDependencies();
    pruneFflateRuntimeFiles();
    pruneOfficeParserRuntimeFiles();
    prunePdfJsRuntimeFiles();
    pruneUnusedReleaseFiles();
    pruneUnusedReleaseDocs();
    pruneUnusedReleaseTests();
    minifyRuntimeScripts();
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
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false"
    ],
    {
      cwd: OUT_DIR,
      stdio: "inherit",
      shell: process.platform === "win32"
    }
  );

  if (result.status !== 0) {
    throw new Error("Failed to install release dependencies.");
  }
}

function removeUnusedRuntimeDependencies() {
  const nodeModulesDir = path.join(OUT_DIR, "node_modules");
  UNUSED_OFFICEPARSER_OCR_PACKAGES.forEach((packageName) => {
    fs.rmSync(path.join(nodeModulesDir, packageName), { recursive: true, force: true });
  });
}

function pruneFflateRuntimeFiles() {
  const fflateDir = path.join(OUT_DIR, "node_modules", "fflate");
  UNUSED_FFLATE_PATHS.forEach((relativePath) => {
    fs.rmSync(path.join(fflateDir, relativePath), { recursive: true, force: true });
  });
}

function prunePdfJsRuntimeFiles() {
  const pdfJsDir = path.join(OUT_DIR, "node_modules", "pdfjs-dist");
  useMinifiedPdfJsRuntimeFiles(pdfJsDir);
  UNUSED_PDFJS_PATHS.forEach((relativePath) => {
    fs.rmSync(path.join(pdfJsDir, relativePath), { recursive: true, force: true });
  });
}

function useMinifiedPdfJsRuntimeFiles(pdfJsDir) {
  copyMinifiedRuntimeFile(
    path.join(pdfJsDir, "legacy", "build", "pdf.min.mjs"),
    path.join(pdfJsDir, "legacy", "build", "pdf.mjs")
  );
  copyMinifiedRuntimeFile(
    path.join(pdfJsDir, "legacy", "build", "pdf.worker.min.mjs"),
    path.join(pdfJsDir, "legacy", "build", "pdf.worker.mjs")
  );
}

function copyMinifiedRuntimeFile(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }
  const content = fs.readFileSync(source, "utf8").replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
  fs.writeFileSync(target, content, "utf8");
}

function pruneOfficeParserRuntimeFiles() {
  const officeParserDir = path.join(OUT_DIR, "node_modules", "officeparser");
  UNUSED_OFFICEPARSER_PATHS.forEach((relativePath) => {
    fs.rmSync(path.join(officeParserDir, relativePath), { recursive: true, force: true });
  });
}

function pruneUnusedReleaseFiles() {
  removeFilesBySuffixes(OUT_DIR, UNUSED_RELEASE_SUFFIXES);
}

function pruneUnusedReleaseDocs() {
  removeFilesByNamePrefixes(OUT_DIR, UNUSED_RELEASE_DOC_NAMES);
}

function pruneUnusedReleaseTests() {
  removeDirectoriesByNames(path.join(OUT_DIR, "node_modules"), UNUSED_RELEASE_TEST_DIRS);
  removeTestScriptFiles(path.join(OUT_DIR, "node_modules"));
}

function minifyRuntimeScripts() {
  walkFiles(path.join(OUT_DIR, "node_modules"), (filePath) => {
    if (!MINIFY_SCRIPT_EXTENSIONS.includes(path.extname(filePath))) {
      return;
    }

    const source = fs.readFileSync(filePath, "utf8");
    const result = esbuild.transformSync(source, {
      loader: "js",
      legalComments: "none",
      minify: true,
      sourcemap: false,
      target: "esnext"
    });
    fs.writeFileSync(filePath, result.code, "utf8");
  });
}

function removeFilesBySuffixes(dir, suffixes) {
  if (!fs.existsSync(dir)) {
    return;
  }

  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeFilesBySuffixes(entryPath, suffixes);
      return;
    }
    if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      fs.rmSync(entryPath, { force: true });
    }
  });
}

function removeFilesByNamePrefixes(dir, prefixes) {
  if (!fs.existsSync(dir)) {
    return;
  }

  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeFilesByNamePrefixes(entryPath, prefixes);
      return;
    }
    const lowerName = entry.name.toLowerCase();
    if (entry.isFile() && prefixes.some((prefix) => lowerName === prefix || lowerName.startsWith(prefix + "."))) {
      fs.rmSync(entryPath, { force: true });
    }
  });
}

function removeDirectoriesByNames(dir, names) {
  if (!fs.existsSync(dir)) {
    return;
  }

  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (!entry.isDirectory()) {
      return;
    }
    if (names.includes(entry.name.toLowerCase())) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      return;
    }
    removeDirectoriesByNames(entryPath, names);
  });
}

function removeTestScriptFiles(dir) {
  walkFiles(dir, (filePath) => {
    const lowerName = path.basename(filePath).toLowerCase();
    if (
      lowerName === "test.js" ||
      lowerName === "tests.js" ||
      lowerName.endsWith(".test.js") ||
      lowerName.endsWith(".spec.js")
    ) {
      fs.rmSync(filePath, { force: true });
    }
  });
}

function walkFiles(dir, visit) {
  if (!fs.existsSync(dir)) {
    return;
  }

  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit);
      return;
    }
    if (entry.isFile()) {
      visit(entryPath);
    }
  });
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
