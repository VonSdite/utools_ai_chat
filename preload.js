const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { URL } = require("node:url");

const CONFIG_KEY = "markmind/config/v1";
const LEGACY_CONFIG_KEY = "huayi/config/v1";
const CHAT_STORE_KEY = "markmind/chats/v1";
const REQUEST_TIMEOUT_MS = 120000;
const MAX_ERROR_BODY = 2000;
const MAX_DOCUMENT_CHARS = 60000;
const MODEL_MODES = ["translate", "summary", "explain", "chat"];

let electronSession = null;
let electronClipboard = null;
let electronIpcRenderer = null;

try {
  const electron = require("electron");
  electronSession = electron.session || null;
  electronClipboard = electron.clipboard || null;
  electronIpcRenderer = electron.ipcRenderer || null;
} catch (error) {
  electronSession = null;
  electronClipboard = null;
  electronIpcRenderer = null;
}

let activeRequest = null;
let activeSocket = null;
let lastEnterAction = null;
let standaloneWindow = null;
const enterListeners = new Set();

if (typeof utools !== "undefined" && utools.onPluginEnter) {
  utools.onPluginEnter((action) => {
    const normalized = normalizeEnterAction(action);
    if (shouldUseStandaloneWindow()) {
      openStandaloneWindow(normalized);
      lastEnterAction = null;
      return;
    }
    dispatchEnterAction(normalized);
  });
}

if (typeof utools !== "undefined" && utools.setExpendHeight) {
  utools.setExpendHeight(720);
}

if (electronIpcRenderer) {
  electronIpcRenderer.on("markmind-enter-action", (event, action) => {
    dispatchEnterAction(normalizeEnterAction(action));
  });
}

window.markMind = {
  getConfig,
  saveConfig,
  getChatStore,
  saveChatStore,
  runTask,
  sendChat,
  fetchModels,
  translate(payload, onEvent) {
    return runTask(Object.assign({}, payload, { mode: "translate" }), onEvent);
  },
  abortActive,
  copyText,
  onEnter(listener) {
    enterListeners.add(listener);
    return () => enterListeners.delete(listener);
  },
  getLastEnterAction() {
    return lastEnterAction;
  }
};
window.quickEnglish = window.markMind;

function normalizeEnterAction(action) {
  const source = action && typeof action === "object" ? action : {};
  return {
    code: typeof source.code === "string" ? source.code : "",
    type: typeof source.type === "string" ? source.type : "",
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

function shouldUseStandaloneWindow() {
  return (
    typeof utools !== "undefined" &&
    typeof utools.createBrowserWindow === "function" &&
    typeof utools.getWindowType === "function" &&
    utools.getWindowType() === "main"
  );
}

function openStandaloneWindow(action) {
  const existing = getUsableStandaloneWindow();
  if (existing) {
    showStandaloneWindow(existing, action);
    return;
  }

  standaloneWindow = utools.createBrowserWindow(
    "index.html",
    {
      show: false,
      title: "MarkMind",
      width: 1120,
      height: 760,
      minWidth: 900,
      minHeight: 620,
      center: true,
      closeable: true,
      autoHideMenuBar: true,
      backgroundColor: "#f4f6f5",
      webPreferences: {
        preload: "preload.js"
      }
    },
    () => {
      setTimeout(() => {
        showStandaloneWindow(standaloneWindow, action);
      }, 0);
    }
  );
}

function getUsableStandaloneWindow() {
  if (!standaloneWindow) {
    return null;
  }
  try {
    if (typeof standaloneWindow.isDestroyed === "function" && standaloneWindow.isDestroyed()) {
      standaloneWindow = null;
      return null;
    }
    return standaloneWindow;
  } catch (error) {
    standaloneWindow = null;
    return null;
  }
}

function showStandaloneWindow(targetWindow, action) {
  try {
    if (targetWindow && typeof targetWindow.show === "function") {
      targetWindow.show();
    }
    if (targetWindow && typeof targetWindow.focus === "function") {
      targetWindow.focus();
    }
    if (targetWindow && targetWindow.webContents) {
      targetWindow.webContents.send("markmind-enter-action", action);
    }
    if (typeof utools !== "undefined" && typeof utools.hideMainWindow === "function") {
      utools.hideMainWindow(false);
    }
  } catch (error) {
    standaloneWindow = null;
    throw error;
  }
}

function getConfig() {
  const storage = getStorage();
  const stored = storage ? storage.getItem(CONFIG_KEY) || storage.getItem(LEGACY_CONFIG_KEY) : null;
  return normalizeConfig(stored);
}

function saveConfig(config) {
  const normalized = normalizeConfig(config);
  const storage = getStorage();
  if (!storage) {
    throw new Error("当前环境不可用，无法保存设置");
  }
  storage.setItem(CONFIG_KEY, normalized);
  return normalized;
}

function getChatStore() {
  const storage = getStorage();
  const stored = storage ? storage.getItem(CHAT_STORE_KEY) : null;
  return normalizeChatStore(stored);
}

function saveChatStore(store) {
  const normalized = normalizeChatStore(store);
  const storage = getStorage();
  if (!storage) {
    throw new Error("当前环境不可用，无法保存会话");
  }
  storage.setItem(CHAT_STORE_KEY, normalized);
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

  const config = getConfig();
  const provider = resolveProvider(config, payload && payload.providerId, payload && payload.modelId, mode);
  validateProvider(provider);
  const messages = buildTaskMessages(mode, text, attachments, provider);
  return completeWithMessages(provider, messages, onEvent);
}

async function sendChat(payload, onEvent) {
  abortActive();
  const config = getConfig();
  const provider = resolveProvider(config, payload && payload.providerId, payload && payload.modelId, "chat");
  validateProvider(provider);
  const messages = buildChatMessages(payload && payload.messages, provider, payload && payload.assistant);
  if (!messages.length) {
    throw new Error("消息为空");
  }
  return completeWithMessages(provider, messages, onEvent);
}

async function fetchModels(payload) {
  const provider = normalizeProvider(payload);
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

async function completeWithMessages(provider, messages, onEvent) {
  const endpoint = new URL(provider.endpoint);
  const body = JSON.stringify({
    model: provider.model,
    stream: true,
    temperature: 0.2,
    messages
  });

  const headers = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "User-Agent": "MarkMind-uTools/0.1.0"
  };

  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  try {
    emit(onEvent, { type: "status", message: "准备中" });
    const proxy = await resolveProxy(provider, endpoint.href);
    emit(onEvent, {
      type: "status",
      message: "生成中"
    });

    const content = proxy
      ? await requestViaProxy(endpoint, provider, body, headers, proxy, onEvent)
      : await requestDirect(endpoint, provider, body, headers, onEvent);

    emit(onEvent, { type: "done", text: content });
    return {
      content,
      providerName: provider.name,
      model: provider.model
    };
  } catch (error) {
    emit(onEvent, { type: "error", message: error.message || String(error) });
    throw error;
  } finally {
    activeRequest = null;
    activeSocket = null;
  }
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

function copyText(text) {
  const value = String(text || "");
  if (electronClipboard) {
    electronClipboard.writeText(value);
    return true;
  }
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(value);
  }
  throw new Error("剪贴板不可用");
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

function normalizeMode(mode) {
  if (mode === "summary" || mode === "explain") {
    return mode;
  }
  return "translate";
}

function buildTaskMessages(mode, text, attachments, provider) {
  return [
    {
      role: "system",
      content: taskSystemPrompt(mode)
    },
    {
      role: "user",
      content: buildUserContent(text, attachments, provider, "请处理下面的内容。")
    }
  ];
}

function buildChatMessages(messages, provider, assistant) {
  const source = Array.isArray(messages) ? messages : [];
  const normalized = source
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
    "你是 MarkMind，一个清晰、可靠、简洁的 AI 助手。根据用户提供的文本、图片和文档上下文回答。遇到不确定内容时说明不确定，不要编造。";

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
  const documents = attachments.filter((attachment) => attachment.kind === "document" && attachment.text);
  const images = attachments.filter((attachment) => attachment.kind === "image" && attachment.dataUrl);
  let contentText = text || "";

  if (documents.length) {
    contentText +=
      (contentText ? "\n\n" : "") +
      documents
        .map((document) => {
          const textContent = String(document.text || "").slice(0, MAX_DOCUMENT_CHARS);
          return `【文档：${document.name}】\n${textContent}`;
        })
        .join("\n\n");
  }

  if (images.length && provider.multimodal !== true) {
    if (!contentText) {
      throw new Error("当前模型未标识为多模态，无法发送图片");
    }
    return contentText;
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
        text: typeof attachment.text === "string" ? attachment.text : "",
        dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : ""
      };
    })
    .filter(Boolean);
}

function resolveProvider(config, providerId, modelId, mode) {
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const requested = resolveProviderModel(providers, providerId, modelId);
  if (requested) {
    return requested;
  }
  const modeSelection = config.modeModels && config.modeModels[mode] ? config.modeModels[mode] : null;
  const modeProvider = modeSelection
    ? resolveProviderModel(providers, modeSelection.providerId, modeSelection.modelId)
    : null;
  if (modeProvider) {
    return modeProvider;
  }
  const fallback = resolveProviderModel(providers, config.defaultProviderId, config.defaultModelId);
  if (fallback) {
    return fallback;
  }
  const first = getFirstProviderModel(providers);
  return first ? first : null;
}

function resolveProviderModel(providers, providerId, modelId) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    return null;
  }
  const model = modelId
    ? (provider.models || []).find((item) => item.id === modelId)
    : (provider.models || [])[0];
  if (!model) {
    return null;
  }
  return Object.assign({}, provider, {
    modelId: model.id,
    model: model.model,
    multimodal: model.multimodal === true
  });
}

function getFirstProviderModel(providers) {
  for (const provider of providers) {
    if (provider.models && provider.models.length) {
      const model = provider.models[0];
      return Object.assign({}, provider, {
        modelId: model.id,
        model: model.model,
        multimodal: model.multimodal === true
      });
    }
  }
  return null;
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
    "User-Agent": "MarkMind-uTools/0.1.0"
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
  if (provider.proxyMode === "direct") {
    return null;
  }

  if (provider.proxyMode === "custom") {
    return parseProxyUrl(provider.proxyUrl);
  }

  if (provider.proxyMode !== "system") {
    return null;
  }

  if (electronSession && electronSession.defaultSession) {
    const rules = await resolveElectronProxy(targetUrl);
    return parseSystemProxyRules(rules);
  }

  return resolveSystemProxyFromOs(targetUrl);
}

function resolveElectronProxy(targetUrl) {
  const session = electronSession.defaultSession;
  return new Promise((resolve, reject) => {
    try {
      const result = session.resolveProxy(targetUrl);
      if (result && typeof result.then === "function") {
        result.then(resolve, reject);
        return;
      }
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      session.resolveProxy(targetUrl, resolve);
    } catch (error) {
      try {
        session.resolveProxy(targetUrl, resolve);
      } catch (secondError) {
        reject(secondError);
      }
    }
  });
}

function parseSystemProxyRules(rules) {
  const parts = String(rules || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/^DIRECT$/i.test(part)) {
      continue;
    }

    const match = part.match(/^([A-Z0-9]+)\s+(.+)$/i);
    if (!match) {
      continue;
    }

    const type = match[1].toUpperCase();
    const hostPort = match[2].trim();

    if (type === "PROXY" || type === "HTTP") {
      return parseProxyUrl(`http://${hostPort}`);
    }
    if (type === "HTTPS") {
      return parseProxyUrl(`https://${hostPort}`);
    }
    if (type.indexOf("SOCKS") === 0) {
      throw new Error("当前内置请求器暂不支持 SOCKS 代理，请使用 HTTP 代理");
    }
  }

  return null;
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

function requestDirect(endpoint, provider, body, headers, onEvent) {
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
  return requestWithOptions(transport, options, body, onEvent);
}

async function requestViaProxy(endpoint, provider, body, headers, proxy, onEvent) {
  if (endpoint.protocol === "https:") {
    const tunnel = await createProxyTunnel(endpoint, provider, proxy);
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
    return requestWithOptions(https, options, body, onEvent);
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

  return requestWithOptions(transport, options, body, onEvent);
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

function createProxyTunnel(endpoint, provider, proxy) {
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

    activeRequest = request;

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

      activeSocket = secureSocket;

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

function requestWithOptions(transport, options, body, onEvent) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let content = "";
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

      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      choices.forEach((choice) => {
        const delta =
          (choice.delta && choice.delta.content) ||
          (choice.message && choice.message.content) ||
          "";
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
            content = extractNonStreamContent(rawBody);
            if (content) {
              emit(onEvent, { type: "delta", text: content });
            }
          }
          finish(null, content);
        } catch (error) {
          finish(error);
        }
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
    request.write(body);
    request.end();
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

function extractNonStreamContent(rawBody) {
  const parsed = JSON.parse(rawBody);
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  return choices
    .map((choice) => {
      if (choice.message && choice.message.content) {
        return choice.message.content;
      }
      if (choice.delta && choice.delta.content) {
        return choice.delta.content;
      }
      return "";
    })
    .join("");
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
    providers,
    defaultProviderId: providers.length ? defaultProviderId : "",
    defaultModelId: providers.length ? defaultModelId : "",
    modeModels
  };
}

function normalizeModeModels(source, providers, fallbackSelection) {
  const result = {};
  for (const mode of MODEL_MODES) {
    const item = source && typeof source === "object" ? source[mode] : null;
    let selection = {
      providerId: item && typeof item.providerId === "string" ? item.providerId : "",
      modelId: item && typeof item.modelId === "string" ? item.modelId : ""
    };
    if (!resolveProviderModel(providers, selection.providerId, selection.modelId)) {
      selection = fallbackSelection || { providerId: "", modelId: "" };
    }
    if (!resolveProviderModel(providers, selection.providerId, selection.modelId)) {
      const first = getFirstProviderModel(providers);
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
    proxyMode: ["direct", "system", "custom"].includes(source.proxyMode)
      ? source.proxyMode
      : "system",
    proxyUrl: typeof source.proxyUrl === "string" ? source.proxyUrl : "",
    models: normalizeModels(source)
  };
}

function normalizeModels(source) {
  if (Array.isArray(source.models) && source.models.length) {
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
    content: typeof message.content === "string" ? message.content : "",
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map(normalizeStoredAttachment).filter(Boolean)
      : [],
    createdAt: Number(message.createdAt) || Date.now()
  };
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
