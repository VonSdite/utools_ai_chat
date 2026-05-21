const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const net = require("node:net");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { URL, fileURLToPath } = require("node:url");
const chardet = require("chardet");
const iconv = require("iconv-lite");
const officeParser = require("officeparser");
const WordExtractor = require("word-extractor");

const DATA_DIR_KEY = "ai-chat/data-dir/v1";
const DEFAULT_DATA_DIR = getDefaultDataDir();
const CONFIG_FILE = "config.json";
const CHAT_STORE_FILE = "chat-store.json";
const TASK_STORE_FILE = "task-store.json";
const CACHE_DIR = "cache";
const ATTACHMENT_CACHE_DIR = "attachments";
const TEMP_CACHE_DIR = "tmp";
const REQUEST_TIMEOUT_MS = 120000;
const MAX_ERROR_BODY = 2000;
const MAX_DOCUMENT_CHARS = 60000;
const ENCODING_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_RECENT_CLIPBOARD_MS = 2000;
const DEFAULT_CLIPBOARD_POLL_MS = 500;
const DEFAULT_PROXY_MODE = "system";
const MODEL_MODES = ["translate", "summary", "explain", "ocr", "chat"];
const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml",
  "xml", "html", "htm", "log", "ini", "conf", "js", "jsx", "ts", "tsx",
  "css", "scss", "less", "py", "java", "go", "rs", "c", "cpp", "h", "hpp",
  "cs", "php", "rb", "sh", "bat", "ps1", "sql", "toml", "env", "properties",
  "dockerfile", "vue", "svelte", "astro", "mjs", "cjs"
];
const DOCUMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "pptx", "xlsx", "odt", "odp", "ods"
];
const IMAGE_MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp"
};
const DOCUMENT_MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet"
};

let electronClipboard = null;

try {
  const electron = require("electron");
  electronClipboard = electron.clipboard || null;
} catch (error) {
  electronClipboard = null;
}

let activeRequest = null;
let activeSocket = null;
const activeChatRequests = new Map();
let lastEnterAction = null;
let clipboardSnapshotText = "";
let clipboardChangedAt = 0;
let clipboardSnapshotImage = null;
let clipboardImageFingerprint = "";
let clipboardImageChangedAt = 0;
let clipboardWatcherTimer = null;
let clipboardWatcherIntervalMs = 0;
const enterListeners = new Set();
const outListeners = new Set();

if (typeof utools !== "undefined" && utools.onPluginEnter) {
  utools.onPluginEnter((action) => {
    const normalized = normalizeEnterAction(action);
    dispatchEnterAction(normalized);
  });
}

if (typeof utools !== "undefined" && utools.onPluginOut) {
  utools.onPluginOut((action) => {
    const normalized = normalizeOutAction(action);
    dispatchOutAction(normalized);
    if (normalized.isKill) {
      abortAllActiveRequests();
    }
  });
}

if (typeof utools !== "undefined" && utools.setExpendHeight) {
  utools.setExpendHeight(680);
}

window.markMind = {
  getConfig,
  saveConfig,
  getChatStore,
  saveChatStore,
  getTaskStore,
  saveTaskStore,
  runTask,
  sendChat,
  fetchModels,
  translate(payload, onEvent) {
    return runTask(Object.assign({}, payload, { mode: "translate" }), onEvent);
  },
  ocr(payload, onEvent) {
    return runTask(Object.assign({}, payload, { mode: "ocr" }), onEvent);
  },
  abortActive,
  abortChat,
  copyText,
  getClipboardText,
  getRecentClipboardText,
  getRecentClipboardImage,
  getRecentClipboardImages,
  readImageAttachment,
  readImageAttachments,
  chooseDataDirectory,
  chooseAttachmentFiles,
  getUser,
  onEnter(listener) {
    enterListeners.add(listener);
    return () => enterListeners.delete(listener);
  },
  onOut(listener) {
    outListeners.add(listener);
    return () => outListeners.delete(listener);
  },
  getLastEnterAction() {
    return lastEnterAction;
  }
};
window.quickEnglish = window.markMind;

startClipboardWatcher(getConfig().clipboardPollingMs);

function normalizeEnterAction(action) {
  const source = action && typeof action === "object" ? action : {};
  return {
    code: typeof source.code === "string" ? source.code : "",
    type: typeof source.type === "string" ? source.type : "",
    keyword: typeof source.keyword === "string" ? source.keyword : "",
    cmd: typeof source.cmd === "string" ? source.cmd : "",
    name: typeof source.name === "string" ? source.name : "",
    label: typeof source.label === "string" ? source.label : "",
    option: source.option,
    payload: source.payload
  };
}

function dispatchEnterAction(action) {
  lastEnterAction = action;
  enterListeners.forEach((listener) => {
    try {
      listener(lastEnterAction);
    } catch (error) {
      console.error(error);
    }
  });
}

function normalizeOutAction(action) {
  if (typeof action === "boolean") {
    return { isKill: action };
  }

  if (action && typeof action === "object") {
    return {
      isKill: Boolean(action.isKill || action.kill || action.destroyed || action.isDestroyed)
    };
  }

  return { isKill: false };
}

function dispatchOutAction(action) {
  outListeners.forEach((listener) => {
    try {
      listener(action);
    } catch (error) {
      console.error(error);
    }
  });
}

function getConfig() {
  const storage = getStorage();
  const dataDir = getStoredDataDir(storage);
  const stored = readConfigFile(dataDir);
  const normalized = normalizeConfig(Object.assign({}, stored || {}, { dataDir }));
  writeConfigFile(normalized);
  if (storage) {
    saveStoredDataDir(storage, normalized.dataDir);
  }
  return normalized;
}

function saveConfig(config) {
  const previous = getConfig();
  const normalized = normalizeConfig(config);
  const storage = getStorage();
  if (!storage) {
    throw new Error("当前环境不可用，无法保存设置");
  }
  migrateDataDirectory(previous.dataDir, normalized.dataDir);
  writeConfigFile(normalized);
  saveStoredDataDir(storage, normalized.dataDir);
  startClipboardWatcher(normalized.clipboardPollingMs);
  return normalized;
}

function getChatStore() {
  const config = getConfig();
  const stored = readChatStoreFile(config);
  if (stored) {
    return normalizeChatStore(stored);
  }

  const normalized = normalizeChatStore(null);
  writeChatStoreFile(config, normalized);
  return normalized;
}

function saveChatStore(store) {
  const normalized = normalizeChatStore(store);
  writeChatStoreFile(getConfig(), normalized);
  return normalized;
}

function getTaskStore() {
  const config = getConfig();
  const stored = readTaskStoreFile(config);
  if (stored) {
    return normalizeTaskStore(stored);
  }

  const normalized = normalizeTaskStore(null);
  writeTaskStoreFile(config, normalized);
  return normalized;
}

function saveTaskStore(store) {
  const normalized = normalizeTaskStore(store);
  writeTaskStoreFile(getConfig(), normalized);
  return normalized;
}

async function runTask(payload, onEvent) {
  abortActive();
  const mode = normalizeMode(payload && payload.mode);
  const text = String((payload && payload.text) || "").trim();
  const attachments = normalizeAttachments(payload && payload.attachments);
  if (!text && !attachments.length) {
    throw new Error("输入为空");
  }
  if (mode === "ocr" && !hasImageAttachments(attachments)) {
    throw new Error("OCR 需要先添加图片");
  }

  const config = getConfig();
  const provider = resolveProvider(config, payload && payload.providerId, payload && payload.modelId, mode);
  if (!provider && mode === "ocr") {
    throw new Error("OCR 需要先配置一个多模态模型");
  }
  validateProvider(provider);
  const messages = buildTaskMessages(mode, text, attachments, provider);
  return completeWithMessages(provider, messages, onEvent);
}

async function sendChat(payload, onEvent) {
  const config = getConfig();
  const provider = resolveProvider(config, payload && payload.providerId, payload && payload.modelId, "chat");
  validateProvider(provider);
  const messages = buildChatMessages(payload && payload.messages, provider, payload && payload.assistant);
  if (!messages.length) {
    throw new Error("消息为空");
  }
  const requestId =
    payload && typeof payload.requestId === "string" && payload.requestId
      ? payload.requestId
      : "";
  return completeWithMessages(provider, messages, onEvent, { requestId });
}

async function fetchModels(payload) {
  const config = getConfig();
  const provider = applyConfigProxy(normalizeProvider(payload), config);
  validateModelFetchProvider(provider);
  const candidates = modelEndpointCandidates(provider.endpoint);
  const errors = [];

  try {
    for (const url of candidates) {
      try {
        const models = await fetchModelsFromEndpoint(new URL(url), provider);
        if (models.length) {
          return { models, sourceUrl: url };
        }
        errors.push(`${url}: 未返回模型列表`);
      } catch (error) {
        errors.push(`${url}: ${error.message || String(error)}`);
      }
    }
  } finally {
    activeRequest = null;
    activeSocket = null;
  }

  throw new Error(`拉取模型失败，已尝试 /v1/models 和 /models。${errors.join("；")}`);
}

async function completeWithMessages(provider, messages, onEvent, requestOptions) {
  const options = requestOptions || {};
  const endpoint = new URL(provider.endpoint);
  let body = createCompletionRequestBody(provider, messages, true);
  let headers = createCompletionHeaders(body);

  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  try {
    const proxy = await resolveProxy(provider, endpoint.href);
    emit(onEvent, {
      type: "status",
      message: "生成中"
    });

    let result;
    try {
      result = proxy
        ? await requestViaProxy(endpoint, provider, body, headers, proxy, onEvent, options)
        : await requestDirect(endpoint, provider, body, headers, onEvent, options);
    } catch (error) {
      if (!shouldRetryWithoutStreamUsage(error)) {
        throw error;
      }
      body = createCompletionRequestBody(provider, messages, false);
      headers = createCompletionHeaders(body);
      if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`;
      }
      result = proxy
        ? await requestViaProxy(endpoint, provider, body, headers, proxy, onEvent, options)
        : await requestDirect(endpoint, provider, body, headers, onEvent, options);
    }

    const content = typeof result === "string" ? result : result.content || "";
    emit(onEvent, { type: "done", text: content, usage: result.usage || null });
    return {
      content,
      providerName: provider.name,
      model: provider.model
    };
  } catch (error) {
    emit(onEvent, { type: "error", message: error.message || String(error) });
    throw error;
  } finally {
    if (options.requestId) {
      activeChatRequests.delete(options.requestId);
    } else {
      activeRequest = null;
      activeSocket = null;
    }
  }
}

function createCompletionRequestBody(provider, messages, includeUsage) {
  const payload = {
    model: provider.model,
    stream: true,
    temperature: 0.2,
    messages
  };
  if (includeUsage) {
    payload.stream_options = { include_usage: true };
  }
  return JSON.stringify(payload);
}

function createCompletionHeaders(body) {
  return {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "User-Agent": "AI-Chat-uTools/0.1.0"
  };
}

function shouldRetryWithoutStreamUsage(error) {
  const message = String((error && error.message) || error || "");
  return (
    /HTTP\s+(400|404|422)/i.test(message) &&
    /(stream_options|include_usage|unknown parameter|unrecognized|unsupported|extra field)/i.test(message)
  );
}

function abortActive() {
  const request = activeRequest;
  const socket = activeSocket;
  activeRequest = null;
  activeSocket = null;

  if (request && !request.destroyed) {
    request.destroy(new Error("请求已取消"));
  }
  if (socket && !socket.destroyed) {
    socket.destroy(new Error("请求已取消"));
  }
}

function abortChat(requestId) {
  const entry = activeChatRequests.get(String(requestId || ""));
  if (!entry) {
    return;
  }
  activeChatRequests.delete(String(requestId || ""));
  if (entry.request && !entry.request.destroyed) {
    entry.request.destroy(new Error("请求已取消"));
  }
  if (entry.socket && !entry.socket.destroyed) {
    entry.socket.destroy(new Error("请求已取消"));
  }
}

function abortAllActiveRequests() {
  abortActive();
  Array.from(activeChatRequests.keys()).forEach((requestId) => {
    abortChat(requestId);
  });
}

function copyText(text) {
  const value = String(text || "");
  if (electronClipboard) {
    electronClipboard.writeText(value);
    rememberClipboardText(value);
    rememberClipboardImage(null, "");
    return true;
  }
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(value);
  }
  throw new Error("剪贴板不可用");
}

function getClipboardText() {
  if (electronClipboard) {
    return String(electronClipboard.readText() || "");
  }
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
    return navigator.clipboard.readText();
  }
  return "";
}

function getUser() {
  if (typeof utools !== "undefined" && typeof utools.getUser === "function") {
    return utools.getUser();
  }
  return null;
}

function getRecentClipboardText(maxAgeMs) {
  updateClipboardSnapshot();
  const ageLimit = Number(maxAgeMs) || 0;
  if (!clipboardChangedAt || !ageLimit || Date.now() - clipboardChangedAt > ageLimit) {
    return "";
  }
  return clipboardSnapshotText;
}

function getRecentClipboardImage(maxAgeMs) {
  updateClipboardSnapshot();
  const ageLimit = Number(maxAgeMs) || 0;
  if (!clipboardImageChangedAt || !ageLimit || Date.now() - clipboardImageChangedAt > ageLimit) {
    return null;
  }
  return clipboardSnapshotImage ? Object.assign({}, clipboardSnapshotImage) : null;
}

function getRecentClipboardImages(maxAgeMs) {
  const image = getRecentClipboardImage(maxAgeMs);
  return image ? [image] : [];
}

async function readImageAttachment(payload) {
  const attachments = await readImageAttachments(payload);
  return attachments[0] || null;
}

async function readImageAttachments(payload) {
  const attachments = extractImageDataUrlPayloads(payload);
  const filePaths = uniqueValues(extractImagePayloadPaths(payload).map(normalizeLocalPayloadPath));

  for (const filePath of filePaths) {
    try {
      const attachment = await readLocalAttachmentFile(filePath);
      if (attachment && attachment.kind === "image") {
        attachments.push(attachment);
      }
    } catch (error) {
      // Keep processing other payload entries.
    }
  }

  if (attachments.length) {
    return attachments;
  }

  const image = safeReadClipboardImage();
  return image ? [image] : [];
}

function extractImageDataUrlPayload(payload) {
  return extractImageDataUrlPayloads(payload)[0] || null;
}

function extractImageDataUrlPayloads(payload) {
  const attachments = [];

  function visit(value) {
    if (typeof value === "string" && /^data:image\//i.test(value)) {
      attachments.push({
        id: createStorageId("file"),
        kind: "image",
        name: "image.png",
        mime: getDataUrlMime(value) || "image/png",
        size: estimateDataUrlBytes(value),
        dataUrl: value
      });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      visit(value.dataUrl);
      visit(value.dataURL);
      visit(value.url);
      visit(value.images);
      visit(value.items);
      visit(value.files);
      visit(value.payload);
    }
  }

  visit(payload);
  return attachments;
}

function extractImagePayloadPath(payload) {
  return extractImagePayloadPaths(payload)[0] || "";
}

function extractImagePayloadPaths(payload) {
  const filePaths = [];

  function visit(value) {
    if (typeof value === "string") {
      if (!/^data:image\//i.test(value)) {
        filePaths.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      [value.path, value.filePath, value.file, value.url].forEach(visit);
      [value.paths, value.filePaths, value.files, value.images, value.items, value.list, value.payload].forEach(visit);
    }
  }

  visit(payload);
  return filePaths;
}

function normalizeLocalPayloadPath(value) {
  const filePath = String(value || "").trim();
  if (!filePath) {
    return "";
  }
  if (/^file:\/\//i.test(filePath)) {
    try {
      return fileURLToPath(filePath);
    } catch (error) {
      return "";
    }
  }
  return filePath;
}

function startClipboardWatcher(intervalMs) {
  if (!electronClipboard) {
    return;
  }
  const nextIntervalMs = normalizeClipboardPollingMs(intervalMs);
  if (clipboardWatcherTimer && clipboardWatcherIntervalMs === nextIntervalMs) {
    return;
  }
  if (clipboardWatcherTimer) {
    clearInterval(clipboardWatcherTimer);
    clipboardWatcherTimer = null;
  }
  clipboardWatcherIntervalMs = nextIntervalMs;
  clipboardSnapshotText = safeReadClipboardText();
  clipboardSnapshotImage = safeReadClipboardImage();
  clipboardImageFingerprint = createClipboardImageFingerprint(clipboardSnapshotImage);
  clipboardImageChangedAt = 0;
  clipboardWatcherTimer = setInterval(updateClipboardSnapshot, nextIntervalMs);
}

function updateClipboardSnapshot() {
  if (!electronClipboard) {
    return;
  }
  const value = safeReadClipboardText();
  if (value !== clipboardSnapshotText) {
    rememberClipboardText(value);
  }
  const image = safeReadClipboardImage();
  const imageFingerprint = createClipboardImageFingerprint(image);
  if (imageFingerprint !== clipboardImageFingerprint) {
    rememberClipboardImage(image, imageFingerprint);
  }
}

function rememberClipboardText(value) {
  clipboardSnapshotText = String(value || "");
  clipboardChangedAt = Date.now();
}

function rememberClipboardImage(image, fingerprint) {
  clipboardSnapshotImage = image || null;
  clipboardImageFingerprint = fingerprint || "";
  clipboardImageChangedAt = image ? Date.now() : 0;
}

function safeReadClipboardText() {
  try {
    return String(electronClipboard ? electronClipboard.readText() || "" : "");
  } catch (error) {
    return "";
  }
}

function safeReadClipboardImage() {
  try {
    if (!electronClipboard || typeof electronClipboard.readImage !== "function") {
      return null;
    }
    const image = electronClipboard.readImage();
    if (!image || (typeof image.isEmpty === "function" && image.isEmpty())) {
      return null;
    }
    const dataUrl = image.toDataURL();
    if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
      return null;
    }
    const size = typeof image.getSize === "function" ? image.getSize() : { width: 0, height: 0 };
    return {
      id: createStorageId("file"),
      kind: "image",
      name: "clipboard-image.png",
      mime: getDataUrlMime(dataUrl) || "image/png",
      size: estimateDataUrlBytes(dataUrl),
      width: Number(size.width) || 0,
      height: Number(size.height) || 0,
      dataUrl
    };
  } catch (error) {
    return null;
  }
}

function createClipboardImageFingerprint(image) {
  if (!image || !image.dataUrl) {
    return "";
  }
  const value = image.dataUrl;
  return `${value.length}:${value.slice(0, 96)}:${value.slice(-96)}`;
}

function getDataUrlMime(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)[;,]/);
  return match ? match[1] : "";
}

function estimateDataUrlBytes(dataUrl) {
  const payload = String(dataUrl || "").split(",")[1] || "";
  return Math.floor((payload.length * 3) / 4);
}

async function chooseDataDirectory(currentDir) {
  if (typeof utools === "undefined" || typeof utools.showOpenDialog !== "function") {
    return "";
  }

  const selected = await utools.showOpenDialog({
    title: "选择数据目录",
    defaultPath: getDialogDefaultPath(currentDir),
    properties: ["openDirectory", "createDirectory", "promptToCreate"]
  });

  return Array.isArray(selected) && selected[0] ? normalizeDataDir(selected[0]) : "";
}

async function chooseAttachmentFiles(options) {
  if (typeof utools === "undefined" || typeof utools.showOpenDialog !== "function") {
    return { attachments: [], errors: [] };
  }
  const imagesOnly = options && options.imagesOnly === true;

  const selected = await utools.showOpenDialog({
    title: imagesOnly ? "选择图片" : "选择附件",
    properties: ["openFile", "multiSelections"],
    filters: [
      imagesOnly
        ? { name: "图片", extensions: Object.keys(IMAGE_MIME_BY_EXTENSION) }
        : {
            name: "支持的附件",
            extensions: TEXT_EXTENSIONS.concat(DOCUMENT_EXTENSIONS, Object.keys(IMAGE_MIME_BY_EXTENSION))
          },
      imagesOnly ? { name: "所有图片", extensions: Object.keys(IMAGE_MIME_BY_EXTENSION) } : { name: "所有文件", extensions: ["*"] }
    ]
  });

  return readLocalAttachmentFiles(Array.isArray(selected) ? selected : [], { imagesOnly });
}

function getStorage() {
  if (typeof utools !== "undefined") {
    if (utools.dbCryptoStorage) {
      return utools.dbCryptoStorage;
    }
    if (utools.dbStorage) {
      return utools.dbStorage;
    }
  }
  return null;
}

function getStoredDataDir(storage) {
  if (!storage) {
    return DEFAULT_DATA_DIR;
  }
  const stored = storage.getItem(DATA_DIR_KEY);
  if (typeof stored === "string") {
    return normalizeDataDir(stored);
  }
  if (stored && typeof stored === "object") {
    return normalizeDataDir(stored.dataDir);
  }
  return DEFAULT_DATA_DIR;
}

function saveStoredDataDir(storage, dataDir) {
  storage.setItem(DATA_DIR_KEY, { dataDir: normalizeDataDir(dataDir) });
}

function getDefaultDataDir() {
  if (process.platform === "win32") {
    return "D:\\utools_ai_chat";
  }
  return path.join(os.homedir() || process.cwd(), "utools_ai_chat");
}

function getDialogDefaultPath(currentDir) {
  const dataDir = normalizeDataDir(currentDir);
  if (isDirectory(dataDir)) {
    return dataDir;
  }

  const parent = path.dirname(dataDir);
  if (parent && parent !== dataDir && isDirectory(parent)) {
    return parent;
  }

  const homeDir = os.homedir();
  if (homeDir && isDirectory(homeDir)) {
    return homeDir;
  }

  return process.cwd();
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (error) {
    return false;
  }
}

async function readLocalAttachmentFiles(filePaths, options) {
  const attachments = [];
  const errors = [];
  const imagesOnly = options && options.imagesOnly === true;

  for (const filePath of filePaths) {
    try {
      const attachment = await readLocalAttachmentFile(filePath);
      if (imagesOnly && attachment && attachment.kind !== "image") {
        throw new Error("OCR 只能选择图片");
      }
      if (attachment) {
        attachments.push(attachment);
      }
    } catch (error) {
      errors.push(`${path.basename(filePath)}：${error.message || String(error)}`);
    }
  }

  return { attachments, errors };
}

async function readLocalAttachmentFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return null;
  }

  const name = path.basename(filePath);
  const extension = path.extname(name).replace(/^\./, "").toLowerCase();
  const imageMime = IMAGE_MIME_BY_EXTENSION[extension];
  if (imageMime) {
    return {
      id: createStorageId("file"),
      kind: "image",
      name,
      mime: imageMime,
      size: stat.size,
      dataUrl: `data:${imageMime};base64,${fs.readFileSync(filePath).toString("base64")}`
    };
  }

  if (!isTextLikePath(extension) && !isDocumentLikePath(extension)) {
    throw new Error("暂时只能读取文本、PDF 和 Office 文档");
  }

  const config = getConfig();
  const extractedText = isDocumentLikePath(extension)
    ? await extractDocumentText(filePath, extension, config)
    : readTextFileWithAutoEncoding(filePath);
  if (!extractedText.trim()) {
    throw new Error("未提取到可用文本");
  }
  const cached = cacheAttachmentDocument(filePath, extractedText, config, extension);

  return Object.assign({
    id: createStorageId("file"),
    kind: "document",
    name,
    mime: getAttachmentMime(extension),
    size: stat.size,
    extension,
    text: sliceDocumentText(extractedText),
    textTruncated: extractedText.length > MAX_DOCUMENT_CHARS
  }, cached);
}

function isTextLikePath(extension) {
  return TEXT_EXTENSIONS.includes(extension);
}

function isDocumentLikePath(extension) {
  return DOCUMENT_EXTENSIONS.includes(extension);
}

async function extractDocumentText(filePath, extension, config) {
  try {
    if (extension === "doc") {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      return normalizeExtractedText(extracted.getBody());
    }

    const tempDir = getTempCacheDir(config);
    fs.mkdirSync(tempDir, { recursive: true });
    const parseOffice = officeParser.parseOfficeAsync || officeParser.parseOffice;
    const text = await parseOffice(filePath, {
      tempFilesLocation: tempDir
    });
    return normalizeExtractedText(text);
  } catch (error) {
    throw new Error("文档解析失败：" + (error.message || String(error)));
  }
}

function readTextFileWithAutoEncoding(filePath) {
  const data = fs.readFileSync(filePath);
  const detected = detectFileEncoding(filePath);
  const encodings = uniqueValues([
    detected,
    "UTF-8",
    "GB18030",
    "GBK",
    "Big5"
  ]);

  for (const encoding of encodings) {
    try {
      const content = iconv.decode(data, encoding);
      if (!content.includes("\uFFFD")) {
        return normalizeExtractedText(content);
      }
    } catch (error) {
      // Try the next likely encoding.
    }
  }

  return normalizeExtractedText(iconv.decode(data, "UTF-8"));
}

function detectFileEncoding(filePath) {
  try {
    return chardet.detectFileSync(filePath, { sampleSize: ENCODING_SAMPLE_BYTES }) || "";
  } catch (error) {
    return "";
  }
}

function uniqueValues(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeExtractedText(value) {
  let text = value;
  if (value && typeof value === "object") {
    if (typeof value.toText === "function") {
      text = value.toText();
    } else if (Array.isArray(value.content)) {
      text = value.content.map(extractParsedContentText).filter(Boolean).join("\n");
    }
  }
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function extractParsedContentText(node) {
  if (!node || typeof node !== "object") {
    return "";
  }
  if (typeof node.text === "string") {
    return node.text;
  }
  if (Array.isArray(node.children)) {
    return node.children.map(extractParsedContentText).filter(Boolean).join(" ");
  }
  return "";
}

function sliceDocumentText(text) {
  const value = String(text || "");
  return value.length > MAX_DOCUMENT_CHARS ? value.slice(0, MAX_DOCUMENT_CHARS) : value;
}

function cacheAttachmentDocument(filePath, extractedText, config, extension) {
  const hash = hashFile(filePath);
  const cacheDir = getAttachmentCacheDir(config);
  fs.mkdirSync(cacheDir, { recursive: true });

  const safeExt = extension ? `.${extension}` : path.extname(filePath).toLowerCase();
  const originalPath = path.join(cacheDir, `${hash}${safeExt}`);
  const textPath = path.join(cacheDir, `${hash}.txt`);

  if (!fs.existsSync(originalPath)) {
    fs.copyFileSync(filePath, originalPath);
  }
  fs.writeFileSync(textPath, String(extractedText || ""), "utf8");

  return {
    cacheKey: hash,
    cacheFile: toDataDirRelativePath(config, originalPath),
    textFile: toDataDirRelativePath(config, textPath)
  };
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function getAttachmentMime(extension) {
  if (DOCUMENT_MIME_BY_EXTENSION[extension]) {
    return DOCUMENT_MIME_BY_EXTENSION[extension];
  }
  if (extension === "csv") {
    return "text/csv";
  }
  return "text/plain";
}

function readConfigFile(dataDir) {
  return readJsonFile(getConfigPath(dataDir));
}

function readChatStoreFile(config) {
  const filePath = getChatStorePath(config);
  return readJsonFile(filePath);
}

function readTaskStoreFile(config) {
  const filePath = getTaskStorePath(config);
  return readJsonFile(filePath);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    return null;
  }
  return JSON.parse(content);
}

function writeConfigFile(config) {
  const normalized = normalizeConfig(config);
  const dataDir = normalizeDataDir(normalized.dataDir);
  ensureDataDirectory(dataDir);
  fs.writeFileSync(
    getConfigPath(dataDir),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );
}

function writeChatStoreFile(config, store) {
  const dataDir = normalizeDataDir(config && config.dataDir);
  ensureDataDirectory(dataDir);
  fs.writeFileSync(
    path.join(dataDir, CHAT_STORE_FILE),
    JSON.stringify(store, null, 2),
    "utf8"
  );
}

function writeTaskStoreFile(config, store) {
  const dataDir = normalizeDataDir(config && config.dataDir);
  ensureDataDirectory(dataDir);
  fs.writeFileSync(
    path.join(dataDir, TASK_STORE_FILE),
    JSON.stringify(store, null, 2),
    "utf8"
  );
}

function migrateDataDirectory(previousDir, nextDir) {
  const fromDir = normalizeDataDir(previousDir);
  const toDir = normalizeDataDir(nextDir);
  if (fromDir === toDir || !fs.existsSync(fromDir)) {
    ensureDataDirectory(toDir);
    return;
  }

  ensureDataDirectory(toDir);
  [CONFIG_FILE, CHAT_STORE_FILE, TASK_STORE_FILE, CACHE_DIR].forEach((name) => {
    assertDataPathMergeable(path.join(fromDir, name), path.join(toDir, name));
  });
  [CONFIG_FILE, CHAT_STORE_FILE, TASK_STORE_FILE, CACHE_DIR].forEach((name) => {
    mergeDataPath(path.join(fromDir, name), path.join(toDir, name));
  });
}

function assertDataPathMergeable(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }

  const stat = fs.statSync(source);
  if (!fs.existsSync(target)) {
    return;
  }

  const targetStat = fs.statSync(target);
  if (stat.isDirectory() !== targetStat.isDirectory()) {
    throwDataDirConflict(target);
  }

  if (stat.isDirectory()) {
    fs.readdirSync(source).forEach((name) => {
      assertDataPathMergeable(path.join(source, name), path.join(target, name));
    });
    return;
  }

  if (stat.isFile() && !filesHaveSameContent(source, target)) {
    throwDataDirConflict(target);
  }
}

function mergeDataPath(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((name) => {
      mergeDataPath(path.join(source, name), path.join(target, name));
    });
    return;
  }

  if (stat.isFile() && !fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function filesHaveSameContent(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) {
    return false;
  }
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function throwDataDirConflict(target) {
  throw new Error("数据目录存在冲突文件，无法自动合并：" + target);
}

function getConfigPath(dataDir) {
  return path.join(normalizeDataDir(dataDir), CONFIG_FILE);
}

function getChatStorePath(config) {
  return path.join(normalizeDataDir(config && config.dataDir), CHAT_STORE_FILE);
}

function getTaskStorePath(config) {
  return path.join(normalizeDataDir(config && config.dataDir), TASK_STORE_FILE);
}

function ensureDataDirectory(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, CACHE_DIR), { recursive: true });
  fs.mkdirSync(path.join(dataDir, CACHE_DIR, ATTACHMENT_CACHE_DIR), { recursive: true });
  fs.mkdirSync(path.join(dataDir, CACHE_DIR, TEMP_CACHE_DIR), { recursive: true });
}

function getAttachmentCacheDir(config) {
  const dataDir = normalizeDataDir(config && config.dataDir);
  ensureDataDirectory(dataDir);
  return path.join(dataDir, CACHE_DIR, ATTACHMENT_CACHE_DIR);
}

function getTempCacheDir(config) {
  const dataDir = normalizeDataDir(config && config.dataDir);
  ensureDataDirectory(dataDir);
  return path.join(dataDir, CACHE_DIR, TEMP_CACHE_DIR);
}

function toDataDirRelativePath(config, filePath) {
  const dataDir = normalizeDataDir(config && config.dataDir);
  const relative = path.relative(dataDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath;
}

function resolveDataDirPath(config, relativePath) {
  const value = String(relativePath || "").trim();
  if (!value) {
    return "";
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  const dataDir = normalizeDataDir(config && config.dataDir);
  const resolved = path.resolve(dataDir, value);
  const relative = path.relative(dataDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return resolved;
}

function normalizeMode(mode) {
  if (mode === "summary" || mode === "explain" || mode === "ocr") {
    return mode;
  }
  return "translate";
}

function buildTaskMessages(mode, text, attachments, provider) {
  const fallbackText = mode === "ocr" ? "请识别图片中的文字。" : "请处理下面的内容。";
  return [
    {
      role: "system",
      content: taskSystemPrompt(mode)
    },
    {
      role: "user",
      content: buildUserContent(text, attachments, provider, fallbackText)
    }
  ];
}

function buildChatMessages(messages, provider, assistant) {
  const source = Array.isArray(messages) ? messages : [];
  const normalized = filterAfterContextClearMessages(source)
    .map((message) => normalizeConversationMessage(message, provider))
    .filter(Boolean);

  if (!normalized.length) {
    return [];
  }

  const assistantPrompt =
    assistant && typeof assistant.prompt === "string" ? assistant.prompt.trim() : "";
  const assistantName =
    assistant && typeof assistant.name === "string" ? assistant.name.trim() : "";
  const basePrompt =
    "你是 AI Chat，一个清晰、可靠、简洁的 AI 助手。根据用户提供的文本、图片和文档上下文回答。遇到不确定内容时说明不确定，不要编造。";

  return [
    {
      role: "system",
      content:
        basePrompt +
        (assistantName ? `\n当前助手名称：${assistantName}` : "") +
        (assistantPrompt ? `\n助手设定：\n${assistantPrompt}` : "")
    }
  ].concat(normalized);
}

function normalizeConversationMessage(message, provider) {
  if (!message || typeof message !== "object") {
    return null;
  }
  if (message.type === "clear") {
    return null;
  }
  const role = message.role === "assistant" ? "assistant" : "user";
  const text = typeof message.content === "string" ? message.content : "";
  const attachments = normalizeAttachments(message.attachments);

  if (role === "assistant") {
    return text ? { role, content: text } : null;
  }

  if (!text && !attachments.length) {
    return null;
  }

  return {
    role,
    content: buildUserContent(text, attachments, provider, "请根据这条消息回复。")
  };
}

function filterAfterContextClearMessages(messages) {
  let lastClearIndex = -1;
  messages.forEach((message, index) => {
    if (message && message.type === "clear") {
      lastClearIndex = index;
    }
  });
  return messages.slice(lastClearIndex + 1);
}

function taskSystemPrompt(mode) {
  if (mode === "summary") {
    return (
      "你是一个专业的信息总结助手。请用中文输出简洁、结构化的总结。" +
      "\n要求：" +
      "\n1. 保留关键事实、结论、数字、主体和行动项。" +
      "\n2. 不要扩写原文没有的信息。" +
      "\n3. 长内容先给一句话总览，再给要点。"
    );
  }

  if (mode === "explain") {
    return (
      "你是一个擅长解释概念和上下文的助手。请用中文解释输入内容。" +
      "\n要求：" +
      "\n1. 说明它是什么、为什么重要、相关背景和容易误解的地方。" +
      "\n2. 遇到英文术语时给出自然中文解释。" +
      "\n3. 可以给短例子，但不要离题。"
    );
  }

  if (mode === "ocr") {
    return (
      "你是一个细致的 OCR 文字识别助手。请识别用户提供图片中的文字，并用中文 Markdown 输出。" +
      "\n要求：" +
      "\n1. 尽量保留原有阅读顺序、段落、换行、列表和表格结构。" +
      "\n2. 只输出识别到的内容；看不清的地方用 [无法识别] 标注，不要猜测。" +
      "\n3. 如果图片里没有可识别文字，请简短说明未识别到文字。"
    );
  }

  return (
    "你是一个专业、简洁的中英翻译助手。请根据输入自动判断类型并用中文 Markdown 输出结果。" +
    "\n规则：" +
    "\n1. 如果输入是英文单词或常见英文短语，给出中文含义、词性、音标，并为每个主要含义给出英文例句和中文译文。" +
    "\n2. 如果输入是英文句子或段落，只翻译成自然中文，不额外解释。" +
    "\n3. 如果输入是中文，翻译成自然英文；如果英文译文是单个英文单词，再补充该英文单词的词性、含义、音标和对应例句。" +
    "\n4. 不要输出 JSON，不要包裹代码块，不要虚构不确定的音标。"
  );
}

function buildUserContent(text, attachments, provider, fallbackText) {
  const documents = attachments.filter((attachment) => attachment.kind === "document" && getDocumentTextForPrompt(attachment));
  const images = attachments.filter((attachment) => attachment.kind === "image" && attachment.dataUrl);
  let contentText = text || "";

  if (documents.length) {
    contentText +=
      (contentText ? "\n\n" : "") +
      documents
        .map((document) => {
          const textContent = getDocumentTextForPrompt(document);
          return `【文档：${document.name}】\n${textContent}`;
        })
        .join("\n\n");
  }

  if (images.length && provider.multimodal !== true) {
    throw new Error("当前模型未标识为多模态，无法发送图片");
  }

  if (!images.length || provider.multimodal !== true) {
    return contentText || fallbackText;
  }

  const content = [
    {
      type: "text",
      text: contentText || fallbackText
    }
  ];

  images.forEach((image) => {
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl
      }
    });
  });

  return content;
}

function getDocumentTextForPrompt(attachment) {
  const text = readAttachmentText(attachment);
  return sliceDocumentText(text);
}

function readAttachmentText(attachment) {
  if (!attachment || attachment.kind !== "document") {
    return "";
  }
  if (attachment.text) {
    return String(attachment.text);
  }
  if (!attachment.textFile) {
    return "";
  }

  const filePath = resolveDataDirPath(getConfig(), attachment.textFile);
  if (!filePath) {
    return "";
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }
      const kind = attachment.kind === "image" ? "image" : "document";
      return {
        id: typeof attachment.id === "string" ? attachment.id : "",
        kind,
        name: typeof attachment.name === "string" ? attachment.name : "附件",
        mime: typeof attachment.mime === "string" ? attachment.mime : "",
        size: Number(attachment.size) || 0,
        extension: typeof attachment.extension === "string" ? attachment.extension : "",
        cacheKey: typeof attachment.cacheKey === "string" ? attachment.cacheKey : "",
        cacheFile: typeof attachment.cacheFile === "string" ? attachment.cacheFile : "",
        textFile: typeof attachment.textFile === "string" ? attachment.textFile : "",
        textTruncated: attachment.textTruncated === true,
        text: typeof attachment.text === "string" ? attachment.text : "",
        dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : ""
      };
    })
    .filter(Boolean);
}

function hasImageAttachments(attachments) {
  return (attachments || []).some((attachment) => attachment.kind === "image" && attachment.dataUrl);
}

function resolveProvider(config, providerId, modelId, mode) {
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const requested = resolveProviderModel(providers, providerId, modelId, mode);
  if (requested) {
    return applyConfigProxy(requested, config);
  }
  const modeSelection = config.modeModels && config.modeModels[mode] ? config.modeModels[mode] : null;
  const modeProvider = modeSelection
    ? resolveProviderModel(providers, modeSelection.providerId, modeSelection.modelId, mode)
    : null;
  if (modeProvider) {
    return applyConfigProxy(modeProvider, config);
  }
  const fallback = resolveProviderModel(providers, config.defaultProviderId, config.defaultModelId, mode);
  if (fallback) {
    return applyConfigProxy(fallback, config);
  }
  const first = getFirstProviderModel(providers, mode);
  return first ? applyConfigProxy(first, config) : null;
}

function applyConfigProxy(provider, config) {
  if (!provider) {
    return null;
  }
  return Object.assign({}, provider, {
    proxyMode: normalizeProxyMode(config && config.proxyMode),
    proxyUrl: typeof (config && config.proxyUrl) === "string" ? config.proxyUrl : ""
  });
}

function resolveProviderModel(providers, providerId, modelId, mode) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    return null;
  }
  const model = modelId
    ? (provider.models || []).find((item) => item.id === modelId)
    : (provider.models || []).find((item) => modelAllowedForMode(item, mode));
  if (!model) {
    return null;
  }
  if (!modelAllowedForMode(model, mode)) {
    return null;
  }
  return Object.assign({}, provider, {
    modelId: model.id,
    model: model.model,
    multimodal: model.multimodal === true
  });
}

function getFirstProviderModel(providers, mode) {
  for (const provider of providers) {
    for (const model of provider.models || []) {
      if (modelAllowedForMode(model, mode)) {
        return Object.assign({}, provider, {
          modelId: model.id,
          model: model.model,
          multimodal: model.multimodal === true
        });
      }
    }
  }
  return null;
}

function modeRequiresMultimodal(mode) {
  return mode === "ocr";
}

function modelAllowedForMode(model, mode) {
  return !modeRequiresMultimodal(mode) || (model && model.multimodal === true);
}

function validateProvider(provider) {
  if (!provider) {
    throw new Error("请先配置 provider");
  }
  if (!provider.model) {
    throw new Error("请设置模型 ID");
  }
  if (!provider.endpoint) {
    throw new Error("请设置 API 地址");
  }

  let endpoint = null;
  try {
    endpoint = new URL(provider.endpoint);
  } catch (error) {
    throw new Error("API 地址不是有效 URL");
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("API 地址只支持 http 或 https");
  }

  if (!/\/v1\/chat\/completions\/?$/.test(endpoint.pathname)) {
    throw new Error("API 地址必须是完整的 /v1/chat/completions");
  }

  if (provider.proxyMode === "custom") {
    parseProxyUrl(provider.proxyUrl);
  }
}

function validateModelFetchProvider(provider) {
  if (!provider.endpoint) {
    throw new Error("请设置 API 地址");
  }

  let endpoint = null;
  try {
    endpoint = new URL(provider.endpoint);
  } catch (error) {
    throw new Error("API 地址不是有效 URL");
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("API 地址只支持 http 或 https");
  }

  if (!/\/v1\/chat\/completions\/?$/.test(endpoint.pathname)) {
    throw new Error("API 地址必须是完整的 /v1/chat/completions");
  }

  if (provider.proxyMode === "custom") {
    parseProxyUrl(provider.proxyUrl);
  }
}

function modelEndpointCandidates(endpoint) {
  const parsed = new URL(endpoint);
  parsed.search = "";
  parsed.hash = "";
  const basePath = parsed.pathname
    .replace(/\/+$/g, "")
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/+$/g, "");
  const baseUrl = parsed.origin + basePath;
  return [joinUrl(baseUrl, "/v1/models"), joinUrl(baseUrl, "/models")];
}

function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/g, "")}/${suffix.replace(/^\/+/g, "")}`;
}

async function fetchModelsFromEndpoint(endpoint, provider) {
  const response = await requestModelText(endpoint, provider);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `HTTP ${response.statusCode}` +
        (response.body ? ` ${response.body.slice(0, 160)}` : "")
    );
  }

  let json = null;
  try {
    json = response.body ? JSON.parse(response.body) : {};
  } catch (error) {
    throw new Error("响应不是有效 JSON");
  }
  return extractModelNames(json);
}

async function requestModelText(endpoint, provider) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "AI-Chat-uTools/0.1.0"
  };

  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const proxy = await resolveProxy(provider, endpoint.href);
  return proxy
    ? requestModelViaProxy(endpoint, provider, headers, proxy)
    : requestModelDirect(endpoint, provider, headers);
}

async function resolveProxy(provider, targetUrl) {
  const mode = normalizeProxyMode(provider && provider.proxyMode);

  if (mode === "direct") {
    return null;
  }

  if (mode === "custom") {
    return parseProxyUrl(provider.proxyUrl);
  }

  if (mode !== "system") {
    return null;
  }

  return resolveSystemProxyFromOs(targetUrl);
}

function parseProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("自定义代理 URL 为空");
  }

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed = null;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw new Error("代理 URL 不是有效 URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("代理只支持 http 或 https");
  }

  if (!parsed.hostname) {
    throw new Error("代理 URL 缺少主机名");
  }

  return parsed;
}

function resolveSystemProxyFromOs(targetUrl) {
  const endpoint = new URL(targetUrl);
  const envProxy = resolveProxyFromEnv(endpoint);
  if (envProxy) {
    return envProxy;
  }

  if (process.platform === "win32") {
    return resolveWindowsProxy(endpoint);
  }

  if (process.platform === "darwin") {
    return resolveMacProxy(endpoint);
  }

  return null;
}

function resolveProxyFromEnv(endpoint) {
  const host = endpoint.hostname;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
  if (matchesNoProxy(host, noProxy)) {
    return null;
  }

  const value =
    endpoint.protocol === "https:"
      ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;

  if (!value) {
    return null;
  }

  return parseProxyUrl(value);
}

function matchesNoProxy(host, noProxy) {
  const normalizedHost = String(host || "").toLowerCase();
  return String(noProxy || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      const cleanEntry = entry.split(":")[0];
      if (cleanEntry.charAt(0) === ".") {
        return normalizedHost.endsWith(cleanEntry);
      }
      return normalizedHost === cleanEntry || normalizedHost.endsWith(`.${cleanEntry}`);
    });
}

function resolveWindowsProxy(endpoint) {
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
  try {
    const enableOutput = execFileSync("reg", ["query", key, "/v", "ProxyEnable"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(enableOutput);
    if (!enabled) {
      return null;
    }

    const serverOutput = execFileSync("reg", ["query", key, "/v", "ProxyServer"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    const proxyServer = readRegistryValue(serverOutput, "ProxyServer");
    return proxyFromWindowsProxyServer(proxyServer, endpoint.protocol);
  } catch (error) {
    return null;
  }
}

function readRegistryValue(output, name) {
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)$`, "i"));
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function proxyFromWindowsProxyServer(proxyServer, endpointProtocol) {
  const value = String(proxyServer || "").trim();
  if (!value) {
    return null;
  }

  if (value.indexOf("=") < 0) {
    return parseProxyUrl(value);
  }

  const entries = {};
  value.split(";").forEach((part) => {
    const pieces = part.split("=");
    if (pieces.length >= 2) {
      entries[pieces[0].trim().toLowerCase()] = pieces.slice(1).join("=").trim();
    }
  });

  const key = endpointProtocol === "https:" ? "https" : "http";
  const selected = entries[key] || entries.http;
  return selected ? parseProxyUrl(selected) : null;
}

function resolveMacProxy(endpoint) {
  try {
    const output = execFileSync("scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 2000
    });
    const map = {};
    String(output || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const match = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+)\s*$/);
        if (match) {
          map[match[1]] = match[2];
        }
      });

    if (endpoint.protocol === "https:" && map.HTTPSEnable === "1" && map.HTTPSProxy) {
      return parseProxyUrl(`${map.HTTPSProxy}:${map.HTTPSPort || 443}`);
    }

    if (map.HTTPEnable === "1" && map.HTTPProxy) {
      return parseProxyUrl(`${map.HTTPProxy}:${map.HTTPPort || 80}`);
    }

    if (map.SOCKSEnable === "1") {
      throw new Error("当前内置请求器暂不支持 SOCKS 代理，请使用 HTTP 代理");
    }
  } catch (error) {
    if (/SOCKS/.test(error.message || "")) {
      throw error;
    }
  }

  return null;
}

function requestDirect(endpoint, provider, body, headers, onEvent, requestOptions) {
  const transport = endpoint.protocol === "https:" ? https : http;
  const options = {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port || defaultPort(endpoint),
    method: "POST",
    path: endpoint.pathname + endpoint.search,
    headers,
    agent: false,
    rejectUnauthorized: provider.sslVerify === true,
    timeout: REQUEST_TIMEOUT_MS
  };
  return requestWithOptions(transport, options, body, onEvent, requestOptions);
}

async function requestViaProxy(endpoint, provider, body, headers, proxy, onEvent, requestOptions) {
  if (endpoint.protocol === "https:") {
    const tunnel = await createProxyTunnel(endpoint, provider, proxy, requestOptions);
    const options = {
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || defaultPort(endpoint),
      method: "POST",
      path: endpoint.pathname + endpoint.search,
      headers,
      agent: false,
      createConnection: () => tunnel,
      rejectUnauthorized: provider.sslVerify === true,
      timeout: REQUEST_TIMEOUT_MS
    };
    return requestWithOptions(https, options, body, onEvent, requestOptions);
  }

  const transport = proxy.protocol === "https:" ? https : http;
  const proxyHeaders = Object.assign({}, headers, {
    Host: endpoint.host
  });
  const auth = proxyAuthHeader(proxy);
  if (auth) {
    proxyHeaders["Proxy-Authorization"] = auth;
  }

  const options = {
    protocol: proxy.protocol,
    hostname: proxy.hostname,
    port: proxy.port || defaultPort(proxy),
    method: "POST",
    path: endpoint.href,
    headers: proxyHeaders,
    agent: false,
    rejectUnauthorized: provider.sslVerify === true,
    timeout: REQUEST_TIMEOUT_MS
  };

  return requestWithOptions(transport, options, body, onEvent, requestOptions);
}

function requestModelDirect(endpoint, provider, headers) {
  const transport = endpoint.protocol === "https:" ? https : http;
  const options = {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port || defaultPort(endpoint),
    method: "GET",
    path: endpoint.pathname + endpoint.search,
    headers,
    agent: false,
    rejectUnauthorized: provider.sslVerify === true,
    timeout: REQUEST_TIMEOUT_MS
  };
  return requestTextWithOptions(transport, options);
}

async function requestModelViaProxy(endpoint, provider, headers, proxy) {
  if (endpoint.protocol === "https:") {
    const tunnel = await createProxyTunnel(endpoint, provider, proxy);
    const options = {
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || defaultPort(endpoint),
      method: "GET",
      path: endpoint.pathname + endpoint.search,
      headers,
      agent: false,
      createConnection: () => tunnel,
      rejectUnauthorized: provider.sslVerify === true,
      timeout: REQUEST_TIMEOUT_MS
    };
    return requestTextWithOptions(https, options);
  }

  const transport = proxy.protocol === "https:" ? https : http;
  const proxyHeaders = Object.assign({}, headers, {
    Host: endpoint.host
  });
  const auth = proxyAuthHeader(proxy);
  if (auth) {
    proxyHeaders["Proxy-Authorization"] = auth;
  }

  const options = {
    protocol: proxy.protocol,
    hostname: proxy.hostname,
    port: proxy.port || defaultPort(proxy),
    method: "GET",
    path: endpoint.href,
    headers: proxyHeaders,
    agent: false,
    rejectUnauthorized: provider.sslVerify === true,
    timeout: REQUEST_TIMEOUT_MS
  };

  return requestTextWithOptions(transport, options);
}

function createProxyTunnel(endpoint, provider, proxy, requestOptions) {
  return new Promise((resolve, reject) => {
    const transport = proxy.protocol === "https:" ? https : http;
    const endpointPort = endpoint.port || defaultPort(endpoint);
    const headers = {
      Host: `${endpoint.hostname}:${endpointPort}`
    };
    const auth = proxyAuthHeader(proxy);
    if (auth) {
      headers["Proxy-Authorization"] = auth;
    }

    const request = transport.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || defaultPort(proxy),
      method: "CONNECT",
      path: `${endpoint.hostname}:${endpointPort}`,
      headers,
      agent: false,
      rejectUnauthorized: provider.sslVerify === true,
      timeout: REQUEST_TIMEOUT_MS
    });

    trackActiveRequest(requestOptions, request, null);

    request.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败：HTTP ${response.statusCode}`));
        return;
      }

      const secureSocket = tls.connect({
        socket,
        servername: net.isIP(endpoint.hostname) ? undefined : endpoint.hostname,
        rejectUnauthorized: provider.sslVerify === true
      });

      trackActiveRequest(requestOptions, request, secureSocket);

      secureSocket.once("secureConnect", () => {
        resolve(secureSocket);
      });
      secureSocket.once("error", reject);
    });

    request.once("timeout", () => {
      request.destroy(new Error("请求超时"));
    });
    request.once("error", reject);
    request.end();
  });
}

function requestWithOptions(transport, options, body, onEvent, requestOptions) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let content = "";
    let reasoning = "";
    let usage = null;
    let rawBody = "";
    let errorBody = "";
    const parser = createSseParser((data) => {
      if (data === "[DONE]") {
        return;
      }

      const parsed = JSON.parse(data);
      if (parsed.error) {
        throw new Error(parsed.error.message || JSON.stringify(parsed.error));
      }

      const parsedUsage = normalizeCompletionUsage(parsed.usage);
      if (parsedUsage) {
        usage = parsedUsage;
        emit(onEvent, { type: "usage", usage });
      }

      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      choices.forEach((choice) => {
        const reasoningDelta =
          extractReasoningText(choice.delta) ||
          extractReasoningText(choice.message) ||
          "";
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          emit(onEvent, { type: "reasoning_delta", text: reasoningDelta });
        }

        const delta = extractContentText(choice.delta) || extractContentText(choice.message) || "";
        if (delta) {
          content += delta;
          emit(onEvent, { type: "delta", text: delta });
        }
      });
    });

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    const request = transport.request(options, (response) => {
      response.setEncoding("utf8");

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.on("data", (chunk) => {
          errorBody += chunk;
          if (errorBody.length > MAX_ERROR_BODY) {
            errorBody = errorBody.slice(0, MAX_ERROR_BODY);
          }
        });
        response.on("end", () => {
          finish(
            new Error(
              `模型接口返回 HTTP ${response.statusCode}` +
                (errorBody ? `：${errorBody}` : "")
            )
          );
        });
        return;
      }

      response.on("data", (chunk) => {
        rawBody += chunk;
        try {
          parser.push(chunk);
        } catch (error) {
          response.destroy(error);
        }
      });

      response.on("end", () => {
        try {
          parser.flush();
          if (!content && rawBody.trim().startsWith("{")) {
            const result = extractNonStreamResult(rawBody);
            content = result.content;
            reasoning = result.reasoning;
            usage = result.usage || usage;
            if (usage) {
              emit(onEvent, { type: "usage", usage });
            }
            if (reasoning) {
              emit(onEvent, { type: "reasoning_delta", text: reasoning });
            }
            if (content) {
              emit(onEvent, { type: "delta", text: content });
            }
          }
          finish(null, { content, usage });
        } catch (error) {
          finish(error);
        }
      });

      response.on("error", finish);
    });

    trackActiveRequest(requestOptions, request, null);

    request.on("socket", (socket) => {
      trackActiveRequest(requestOptions, request, socket);
    });
    request.once("timeout", () => {
      request.destroy(new Error("请求超时"));
    });
    request.once("error", finish);
    request.write(body);
    request.end();
  });
}

function trackActiveRequest(requestOptions, request, socket) {
  const requestId = requestOptions && requestOptions.requestId;
  if (!requestId) {
    activeRequest = request || null;
    activeSocket = socket || activeSocket || null;
    return;
  }
  const previous = activeChatRequests.get(requestId) || {};
  activeChatRequests.set(requestId, {
    request: request || previous.request || null,
    socket: socket || previous.socket || null
  });
}

function requestTextWithOptions(transport, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let body = "";

    function finish(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    const request = transport.request(options, (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        finish(null, {
          statusCode: response.statusCode || 0,
          body
        });
      });
      response.on("error", finish);
    });

    activeRequest = request;
    request.on("socket", (socket) => {
      activeSocket = socket;
    });
    request.once("timeout", () => {
      request.destroy(new Error("请求超时"));
    });
    request.once("error", finish);
    request.end();
  });
}

function createSseParser(onData) {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const eventText = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        parseSseEvent(eventText, onData);
        boundary = buffer.indexOf("\n\n");
      }
    },
    flush() {
      if (buffer.trim()) {
        parseSseEvent(buffer, onData);
      }
      buffer = "";
    }
  };
}

function parseSseEvent(eventText, onData) {
  const dataLines = eventText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) {
    return;
  }

  onData(dataLines.join("\n"));
}

function extractNonStreamResult(rawBody) {
  const parsed = JSON.parse(rawBody);
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const result = choices.reduce(
    (result, choice) => {
      result.content += extractContentText(choice.message) || extractContentText(choice.delta) || "";
      result.reasoning += extractReasoningText(choice.message) || extractReasoningText(choice.delta) || "";
      return result;
    },
    { content: "", reasoning: "", usage: normalizeCompletionUsage(parsed.usage) }
  );
  return result;
}

function normalizeCompletionUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  let promptTokens = normalizeTokenCount(
    usage.prompt_tokens,
    usage.promptTokens,
    usage.input_tokens,
    usage.inputTokens
  );
  let completionTokens = normalizeTokenCount(
    usage.completion_tokens,
    usage.completionTokens,
    usage.output_tokens,
    usage.outputTokens
  );
  let totalTokens = normalizeTokenCount(usage.total_tokens, usage.totalTokens);

  if (totalTokens === null && (promptTokens !== null || completionTokens !== null)) {
    totalTokens = (promptTokens || 0) + (completionTokens || 0);
  }
  if (promptTokens === null && totalTokens !== null && completionTokens !== null) {
    promptTokens = Math.max(0, totalTokens - completionTokens);
  }
  if (completionTokens === null && totalTokens !== null && promptTokens !== null) {
    completionTokens = Math.max(0, totalTokens - promptTokens);
  }

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return null;
  }

  return {
    prompt_tokens: promptTokens || 0,
    completion_tokens: completionTokens || 0,
    total_tokens: totalTokens || 0
  };
}

function normalizeTokenCount() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return Math.round(number);
    }
  }
  return null;
}

function extractContentText(source) {
  if (!source || typeof source !== "object") {
    return "";
  }
  return typeof source.content === "string" ? source.content : "";
}

function extractReasoningText(source) {
  if (!source || typeof source !== "object") {
    return "";
  }

  const candidates = [
    source.reasoning_content,
    source.reasoningContent,
    source.reasoning_text,
    source.reasoningText,
    source.thinking,
    source.thought,
    source.thoughts,
    source.reasoning,
    source.reasoning_details,
    source.reasoningDetails
  ];

  for (const candidate of candidates) {
    const text = stringifyReasoningValue(candidate);
    if (text) {
      return text;
    }
  }
  return "";
}

function stringifyReasoningValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stringifyReasoningValue).filter(Boolean).join("");
  }
  if (value && typeof value === "object") {
    return (
      stringifyReasoningValue(value.text) ||
      stringifyReasoningValue(value.content) ||
      stringifyReasoningValue(value.delta) ||
      ""
    );
  }
  return "";
}

function extractModelNames(value) {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.models)
        ? root.models
        : [];
  const seen = new Set();
  const names = [];

  candidates.forEach((item) => {
    let name = "";
    if (typeof item === "string") {
      name = item.trim();
    } else if (item && typeof item === "object") {
      name = String(item.id || item.name || item.model || "").trim();
    }
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  });

  return names.sort((left, right) => left.localeCompare(right));
}

function normalizeConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const providers = Array.isArray(source.providers)
    ? source.providers.map(normalizeProvider)
    : [];
  let defaultProviderId =
    typeof source.defaultProviderId === "string" ? source.defaultProviderId : "";
  let defaultModelId =
    typeof source.defaultModelId === "string" ? source.defaultModelId : "";

  if (
    providers.length &&
    !providers.some((provider) => provider.id === defaultProviderId &&
      provider.models.some((model) => model.id === defaultModelId))
  ) {
    const first = getFirstProviderModel(providers);
    defaultProviderId = first ? first.id : "";
    defaultModelId = first ? first.modelId : "";
  }
  const modeModels = normalizeModeModels(
    source.modeModels,
    providers,
    { providerId: defaultProviderId, modelId: defaultModelId }
  );

  return {
    dataDir: normalizeDataDir(source.dataDir),
    recentClipboardMs: normalizeRecentClipboardMs(source.recentClipboardMs),
    clipboardPollingMs: normalizeClipboardPollingMs(source.clipboardPollingMs),
    proxyMode: normalizeProxyMode(source.proxyMode),
    proxyUrl: typeof source.proxyUrl === "string" ? source.proxyUrl.trim() : "",
    providers,
    defaultProviderId: providers.length ? defaultProviderId : "",
    defaultModelId: providers.length ? defaultModelId : "",
    modeModels
  };
}

function normalizeDataDir(value) {
  const dataDir = String(value || "").trim();
  if (!dataDir) {
    return DEFAULT_DATA_DIR;
  }
  if (dataDir === "~") {
    return os.homedir() || DEFAULT_DATA_DIR;
  }
  if (dataDir.startsWith("~/") || dataDir.startsWith("~\\")) {
    return path.join(os.homedir() || DEFAULT_DATA_DIR, dataDir.slice(2));
  }
  if (process.platform !== "win32" && /^[a-z]:[\\/]/i.test(dataDir)) {
    return DEFAULT_DATA_DIR;
  }
  return path.resolve(dataDir);
}

function normalizeRecentClipboardMs(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) {
    return DEFAULT_RECENT_CLIPBOARD_MS;
  }
  return Math.max(0, Math.min(60000, Math.round(milliseconds)));
}

function normalizeClipboardPollingMs(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) {
    return DEFAULT_CLIPBOARD_POLL_MS;
  }
  return Math.max(100, Math.min(60000, Math.round(milliseconds)));
}

function normalizeProxyMode(value) {
  return ["direct", "system", "custom"].includes(value)
    ? value
    : DEFAULT_PROXY_MODE;
}

function normalizeModeModels(source, providers, fallbackSelection) {
  const result = {};
  for (const mode of MODEL_MODES) {
    const item = source && typeof source === "object" ? source[mode] : null;
    let selection = {
      providerId: item && typeof item.providerId === "string" ? item.providerId : "",
      modelId: item && typeof item.modelId === "string" ? item.modelId : ""
    };
    if (!resolveProviderModel(providers, selection.providerId, selection.modelId, mode)) {
      selection = fallbackSelection || { providerId: "", modelId: "" };
    }
    if (!resolveProviderModel(providers, selection.providerId, selection.modelId, mode)) {
      const first = getFirstProviderModel(providers, mode);
      selection = first
        ? { providerId: first.id, modelId: first.modelId }
        : { providerId: "", modelId: "" };
    }
    result[mode] = selection;
  }
  return result;
}

function normalizeProvider(provider) {
  const source = provider && typeof provider === "object" ? provider : {};
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `provider-${Math.random().toString(36).slice(2, 10)}`,
    name: typeof source.name === "string" ? source.name : "",
    endpoint: typeof source.endpoint === "string" ? source.endpoint : "",
    apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
    sslVerify: source.sslVerify === true,
    models: normalizeModels(source)
  };
}

function normalizeModels(source) {
  if (Array.isArray(source.models)) {
    return source.models.map(normalizeModel);
  }
  return [
    {
      id: typeof source.modelId === "string" && source.modelId
        ? source.modelId
        : `model-${Math.random().toString(36).slice(2, 10)}`,
      model: typeof source.model === "string" ? source.model : "",
      multimodal: source.multimodal === true
    }
  ];
}

function normalizeModel(model) {
  const source = model && typeof model === "object" ? model : {};
  return {
    id:
      typeof source.id === "string" && source.id
        ? source.id
        : `model-${Math.random().toString(36).slice(2, 10)}`,
    model: typeof source.model === "string" ? source.model : "",
    multimodal: source.multimodal === true
  };
}

function normalizeChatStore(store) {
  const source = store && typeof store === "object" ? store : {};
  let assistants = Array.isArray(source.assistants)
    ? source.assistants.map(normalizeAssistant).filter(Boolean)
    : [];

  if (!assistants.length && Array.isArray(source.sessions)) {
    const sessions = source.sessions.map(normalizeSession).filter(Boolean);
    if (sessions.length) {
      const activeSessionId =
        typeof source.activeSessionId === "string" ? source.activeSessionId : sessions[0].id;
      assistants = [
        {
          id: createStorageId("assistant"),
          name: "默认助手",
          prompt: "",
          providerId: "",
          modelId: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          activeSessionId: sessions.some((session) => session.id === activeSessionId)
            ? activeSessionId
            : sessions[0].id,
          sessions
        }
      ];
    }
  }

  let activeAssistantId =
    typeof source.activeAssistantId === "string" ? source.activeAssistantId : "";
  if (assistants.length && !assistants.some((assistant) => assistant.id === activeAssistantId)) {
    activeAssistantId = assistants[0].id;
  }

  return {
    assistants,
    activeAssistantId: assistants.length ? activeAssistantId : ""
  };
}

function normalizeTaskStore(store) {
  const source = store && typeof store === "object" ? store : {};
  const sourceModes = source.modes && typeof source.modes === "object" ? source.modes : source;
  const modes = {};
  ["translate", "summary", "explain", "ocr"].forEach((mode) => {
    modes[mode] = normalizeTaskStoreEntry(sourceModes && sourceModes[mode]);
  });
  return { modes };
}

function normalizeTaskStoreEntry(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  return {
    inputText: typeof source.inputText === "string" ? source.inputText : "",
    result: typeof source.result === "string" ? source.result : "",
    cancelled: source.cancelled === true,
    attachments: Array.isArray(source.attachments)
      ? source.attachments.map(normalizeStoredAttachment).filter(Boolean)
      : [],
    updatedAt: Number(source.updatedAt) || 0
  };
}

function normalizeAssistant(assistant) {
  if (!assistant || typeof assistant !== "object") {
    return null;
  }

  const sessions = Array.isArray(assistant.sessions)
    ? assistant.sessions.map(normalizeSession).filter(Boolean)
    : [];
  let activeSessionId =
    typeof assistant.activeSessionId === "string" ? assistant.activeSessionId : "";
  if (sessions.length && !sessions.some((session) => session.id === activeSessionId)) {
    activeSessionId = sessions[0].id;
  }

  return {
    id: typeof assistant.id === "string" && assistant.id
      ? assistant.id
      : createStorageId("assistant"),
    name: typeof assistant.name === "string" && assistant.name ? assistant.name : "默认助手",
    prompt: typeof assistant.prompt === "string" ? assistant.prompt : "",
    providerId: typeof assistant.providerId === "string" ? assistant.providerId : "",
    modelId: typeof assistant.modelId === "string" ? assistant.modelId : "",
    createdAt: Number(assistant.createdAt) || Date.now(),
    updatedAt: Number(assistant.updatedAt) || Date.now(),
    activeSessionId: sessions.length ? activeSessionId : "",
    sessions
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    id: typeof session.id === "string" && session.id ? session.id : createStorageId("session"),
    title: typeof session.title === "string" && session.title ? session.title : "新会话",
    providerId: typeof session.providerId === "string" ? session.providerId : "",
    modelId: typeof session.modelId === "string" ? session.modelId : "",
    unreadCompleted: session.unreadCompleted === true,
    createdAt: Number(session.createdAt) || Date.now(),
    updatedAt: Number(session.updatedAt) || Date.now(),
    messages: Array.isArray(session.messages)
      ? session.messages.map(normalizeStoredMessage).filter(Boolean)
      : []
  };
}

function normalizeStoredMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  return {
    id: typeof message.id === "string" && message.id ? message.id : createStorageId("message"),
    role: message.role === "assistant" ? "assistant" : "user",
    type: message.type === "clear" ? "clear" : "",
    content: typeof message.content === "string" ? message.content : "",
    reasoning: typeof message.reasoning === "string" ? message.reasoning : "",
    cancelled: message.cancelled === true,
    providerId: typeof message.providerId === "string" ? message.providerId : "",
    modelId: typeof message.modelId === "string" ? message.modelId : "",
    providerName: typeof message.providerName === "string" ? message.providerName : "",
    modelName: typeof message.modelName === "string" ? message.modelName : "",
    usage: normalizeCompletionUsage(message.usage),
    metrics: normalizeStoredMetrics(message.metrics),
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map(normalizeStoredAttachment).filter(Boolean)
      : [],
    createdAt: Number(message.createdAt) || Date.now()
  };
}

function normalizeStoredMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }

  const normalized = {
    completion_tokens: normalizeTokenCount(metrics.completion_tokens, metrics.completionTokens) || 0,
    time_completion_millsec: normalizeMilliseconds(
      metrics.time_completion_millsec,
      metrics.timeCompletionMillsec
    ),
    time_first_token_millsec: normalizeMilliseconds(
      metrics.time_first_token_millsec,
      metrics.timeFirstTokenMillsec
    ),
    time_thinking_millsec: normalizeMilliseconds(
      metrics.time_thinking_millsec,
      metrics.timeThinkingMillsec,
      metrics.thinking_millsec,
      metrics.thinkingMillsec
    )
  };

  if (
    !normalized.completion_tokens &&
    !normalized.time_completion_millsec &&
    !normalized.time_first_token_millsec &&
    !normalized.time_thinking_millsec
  ) {
    return null;
  }

  return normalized;
}

function normalizeMilliseconds() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return Math.round(number);
    }
  }
  return 0;
}

function normalizeStoredAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }
  const kind = attachment.kind === "image" ? "image" : "document";

  return {
    id: typeof attachment.id === "string" && attachment.id ? attachment.id : createStorageId("file"),
    kind,
    name: typeof attachment.name === "string" ? attachment.name : "附件",
    mime: typeof attachment.mime === "string" ? attachment.mime : "",
    size: Number(attachment.size) || 0,
    extension: typeof attachment.extension === "string" ? attachment.extension : "",
    cacheKey: typeof attachment.cacheKey === "string" ? attachment.cacheKey : "",
    cacheFile: typeof attachment.cacheFile === "string" ? attachment.cacheFile : "",
    textFile: typeof attachment.textFile === "string" ? attachment.textFile : "",
    textTruncated: attachment.textTruncated === true,
    text: kind === "document" && typeof attachment.text === "string" ? attachment.text : "",
    dataUrl: kind === "image" && typeof attachment.dataUrl === "string" ? attachment.dataUrl : ""
  };
}

function createStorageId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function proxyAuthHeader(proxy) {
  if (!proxy.username && !proxy.password) {
    return "";
  }
  const username = decodeURIComponent(proxy.username || "");
  const password = decodeURIComponent(proxy.password || "");
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function defaultPort(url) {
  if (url.port) {
    return url.port;
  }
  return url.protocol === "https:" ? 443 : 80;
}

function emit(onEvent, event) {
  if (typeof onEvent === "function") {
    onEvent(event);
  }
}
