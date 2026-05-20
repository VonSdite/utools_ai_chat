(function () {
  "use strict";

  var CONFIG_STORAGE_KEY = "markmind/local-config";
  var CHAT_STORAGE_KEY = "markmind/local-chats";
  var LEGACY_CONFIG_STORAGE_KEY = "huayi/local-config";
  var TASKS = {
    translate: { title: "翻译", action: "翻译" },
    summary: { title: "总结", action: "总结" },
    explain: { title: "解释", action: "解释" }
  };
  var MODEL_MODES = ["translate", "summary", "explain", "chat"];
  var TEXT_EXTENSIONS = [
    "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml",
    "xml", "html", "htm", "log", "ini", "conf", "js", "jsx", "ts", "tsx",
    "css", "scss", "less", "py", "java", "go", "rs", "c", "cpp", "h", "hpp",
    "cs", "php", "rb", "sh", "bat", "ps1", "sql"
  ];
  var MAX_TEXT_ATTACHMENT_CHARS = 60000;
  var MAX_IMAGE_ATTACHMENTS = 3;
  var api = window.markMind || window.quickEnglish || createBrowserFallbackApi();
  var state = {
    config: { providers: [], modeModels: createEmptyModeModels() },
    draftProviders: [],
    activeTab: "translate",
    activeTaskMode: "translate",
    taskAttachments: [],
    chatAttachments: [],
    chatStore: { assistants: [], activeAssistantId: "" },
    assistantsOpen: false,
    currentResult: "",
    running: false,
    fetchingModelsProviderId: "",
    expandedProviderIds: {},
    draggingProviderId: "",
    toastTimer: 0
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    await loadConfig();
    await loadChatStore();
    renderSettings();
    renderChat();
    renderTaskModelSelect();
    updateViewTitle();
    updateModelBadge();

    if (api.onEnter) {
      api.onEnter(handlePluginEnter);
    }

    if (api.getLastEnterAction) {
      var lastAction = api.getLastEnterAction();
      if (lastAction) {
        handlePluginEnter(lastAction);
      }
    }
  }

  function cacheElements() {
    els.modelBadge = document.getElementById("modelBadge");
    els.statusText = document.getElementById("statusText");
    els.viewTitle = document.getElementById("viewTitle");
    els.inputText = document.getElementById("inputText");
    els.resultText = document.getElementById("resultText");
    els.taskAttachments = document.getElementById("taskAttachments");
    els.taskFileInput = document.getElementById("taskFileInput");
    els.taskAttachBtn = document.getElementById("taskAttachBtn");
    els.taskModelSelect = document.getElementById("taskModelSelect");
    els.sendTaskBtn = document.getElementById("sendTaskBtn");
    els.stopTaskBtn = document.getElementById("stopTaskBtn");
    els.clearTaskBtn = document.getElementById("clearTaskBtn");
    els.copyTaskBtn = document.getElementById("copyTaskBtn");
    els.sideTabs = Array.from(document.querySelectorAll(".side-tab"));
    els.taskView = document.getElementById("taskView");
    els.chatView = document.getElementById("chatView");
    els.settingsView = document.getElementById("settingsView");
    els.newSessionBtn = document.getElementById("newSessionBtn");
    els.sessionsList = document.getElementById("sessionsList");
    els.newAssistantBtn = document.getElementById("newAssistantBtn");
    els.assistantSection = document.getElementById("assistantSection");
    els.assistantToggleBtn = document.getElementById("assistantToggleBtn");
    els.currentAssistantName = document.getElementById("currentAssistantName");
    els.assistantsList = document.getElementById("assistantsList");
    els.assistantNameInput = document.getElementById("assistantNameInput");
    els.assistantProviderSelect = document.getElementById("assistantProviderSelect");
    els.assistantPromptInput = document.getElementById("assistantPromptInput");
    els.messagesList = document.getElementById("messagesList");
    els.chatInput = document.getElementById("chatInput");
    els.chatAttachments = document.getElementById("chatAttachments");
    els.chatFileInput = document.getElementById("chatFileInput");
    els.chatAttachBtn = document.getElementById("chatAttachBtn");
    els.sendChatBtn = document.getElementById("sendChatBtn");
    els.stopChatBtn = document.getElementById("stopChatBtn");
    els.addProviderBtn = document.getElementById("addProviderBtn");
    els.saveSettingsBtn = document.getElementById("saveSettingsBtn");
    els.providersList = document.getElementById("providersList");
    els.toast = document.getElementById("toast");
  }

  function bindEvents() {
    els.sendTaskBtn.addEventListener("click", startTask);
    els.stopTaskBtn.addEventListener("click", stopActiveRequest);
    els.clearTaskBtn.addEventListener("click", clearTask);
    els.copyTaskBtn.addEventListener("click", copyTaskResult);
    els.taskAttachBtn.addEventListener("click", function () {
      els.taskFileInput.click();
    });
    els.taskFileInput.addEventListener("change", function (event) {
      addFiles("task", event.target.files);
      event.target.value = "";
    });
    els.taskAttachments.addEventListener("click", handleAttachmentClick);
    els.taskModelSelect.addEventListener("change", function (event) {
      updateModeModel(state.activeTaskMode, event.target.value);
    });
    els.inputText.addEventListener("keydown", function (event) {
      handleSubmitKeydown(event, startTask);
    });

    els.newSessionBtn.addEventListener("click", createNewSession);
    els.sessionsList.addEventListener("click", handleSessionClick);
    els.newAssistantBtn.addEventListener("click", createNewAssistant);
    els.assistantToggleBtn.addEventListener("click", toggleAssistantPanel);
    els.assistantsList.addEventListener("click", handleAssistantClick);
    els.assistantNameInput.addEventListener("input", updateActiveAssistantFromForm);
    els.assistantProviderSelect.addEventListener("change", function (event) {
      updateModeModel("chat", event.target.value);
    });
    els.assistantPromptInput.addEventListener("input", updateActiveAssistantFromForm);
    els.sendChatBtn.addEventListener("click", sendChatMessage);
    els.stopChatBtn.addEventListener("click", stopActiveRequest);
    els.chatAttachBtn.addEventListener("click", function () {
      els.chatFileInput.click();
    });
    els.chatFileInput.addEventListener("change", function (event) {
      addFiles("chat", event.target.files);
      event.target.value = "";
    });
    els.chatAttachments.addEventListener("click", handleAttachmentClick);
    els.chatInput.addEventListener("keydown", function (event) {
      handleSubmitKeydown(event, sendChatMessage);
    });
    els.chatInput.addEventListener("paste", handleChatPaste);

    els.addProviderBtn.addEventListener("click", addProvider);
    els.saveSettingsBtn.addEventListener("click", saveSettings);
    els.providersList.addEventListener("input", handleProviderInput);
    els.providersList.addEventListener("change", handleProviderInput);
    els.providersList.addEventListener("click", handleProviderClick);
    els.providersList.addEventListener("dragstart", handleProviderDragStart);
    els.providersList.addEventListener("dragover", handleProviderDragOver);
    els.providersList.addEventListener("drop", handleProviderDrop);
    els.providersList.addEventListener("dragend", handleProviderDragEnd);

    els.sideTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        setTab(tab.dataset.tab);
      });
    });
  }

  async function loadConfig() {
    try {
      state.config = normalizeConfig(await api.getConfig());
      state.draftProviders = cloneProviders(state.config.providers);
    } catch (error) {
      showToast("读取设置失败：" + getErrorMessage(error));
    }
  }

  async function loadChatStore() {
    try {
      state.chatStore = normalizeChatStore(api.getChatStore ? await api.getChatStore() : null);
    } catch (error) {
      state.chatStore = normalizeChatStore(null);
    }
  }

  function handlePluginEnter(action) {
    if (!action) {
      return;
    }

    var tab = tabFromActionCode(action.code);
    setTab(tab);

    var payload = extractPayloadText(action.payload);
    if (tab === "settings") {
      return;
    }

    if (tab === "chat") {
      if (payload) {
        els.chatInput.value = payload;
      }
      window.setTimeout(function () {
        els.chatInput.focus();
      }, 0);
      return;
    }

    if (payload) {
      els.inputText.value = payload;
      startTask();
      return;
    }

    window.setTimeout(function () {
      els.inputText.focus();
    }, 0);
  }

  function tabFromActionCode(code) {
    if (code === "markmind-summary") {
      return "summary";
    }
    if (code === "markmind-explain") {
      return "explain";
    }
    if (code === "markmind-chat") {
      return "chat";
    }
    if (code === "markmind-settings" || code === "huayi-settings") {
      return "settings";
    }
    return "translate";
  }

  function extractPayloadText(payload) {
    if (typeof payload === "string") {
      return payload.trim();
    }
    if (payload && typeof payload === "object") {
      if (typeof payload.text === "string") {
        return payload.text.trim();
      }
      if (typeof payload.value === "string") {
        return payload.value.trim();
      }
    }
    return "";
  }

  function setTab(tabName) {
    state.activeTab = tabName;
    if (TASKS[tabName]) {
      state.activeTaskMode = tabName;
    }

    els.sideTabs.forEach(function (tab) {
      tab.classList.toggle("is-active", tab.dataset.tab === tabName);
    });
    els.taskView.classList.toggle("is-active", !!TASKS[tabName]);
    els.chatView.classList.toggle("is-active", tabName === "chat");
    els.settingsView.classList.toggle("is-active", tabName === "settings");
    updateViewTitle();
    renderTaskModelSelect();
    renderChatModelSelect();
    updateModelBadge();
  }

  function updateViewTitle() {
    var title = TASKS[state.activeTaskMode].title;
    if (state.activeTab === "chat") {
      title = "对话";
    }
    if (state.activeTab === "settings") {
      title = "设置";
    }
    els.viewTitle.textContent = title;
  }

  function handleSubmitKeydown(event, submit) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    submit();
  }

  async function startTask() {
    var text = els.inputText.value.trim();
    var provider = getActiveProvider();
    var mode = state.activeTaskMode;

    if (!text && !state.taskAttachments.length) {
      showToast("先输入一点内容");
      return;
    }

    if (!provider) {
      showToast("先配置一个模型");
      setTab("settings");
      return;
    }

    state.running = true;
    state.currentResult = "";
    els.resultText.textContent = "准备中...";
    els.statusText.textContent = provider.name + " / " + provider.model;
    els.sendTaskBtn.disabled = true;
    els.stopTaskBtn.disabled = false;
    els.copyTaskBtn.disabled = true;
    updateModelBadge();

    var errorHandled = false;
    try {
      await api.runTask(
        {
          mode: mode,
          text: text,
          providerId: provider.id,
          modelId: provider.modelId,
          attachments: cloneAttachmentsForRequest(state.taskAttachments)
        },
        function (event) {
          if (event && event.type === "error") {
            errorHandled = true;
          }
          handleTaskEvent(event, provider);
        }
      );
    } catch (error) {
      if (!errorHandled && getErrorMessage(error) !== "请求已取消") {
        handleTaskError(error);
      }
    } finally {
      state.running = false;
      els.sendTaskBtn.disabled = false;
      els.stopTaskBtn.disabled = true;
      els.copyTaskBtn.disabled = !state.currentResult;
    }
  }

  function handleTaskEvent(event, provider) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "status") {
      els.statusText.textContent = event.message || provider.model;
      return;
    }

    if (event.type === "delta") {
      state.currentResult += event.text || "";
      els.resultText.textContent = state.currentResult;
      els.resultText.scrollTop = els.resultText.scrollHeight;
      return;
    }

    if (event.type === "done") {
      if (event.text && !state.currentResult) {
        state.currentResult = event.text;
        els.resultText.textContent = state.currentResult;
      }
      els.statusText.textContent = "已完成";
      els.copyTaskBtn.disabled = !state.currentResult;
      return;
    }

    if (event.type === "error") {
      handleTaskError(new Error(event.message || "请求失败"));
    }
  }

  function handleTaskError(error) {
    var message = getErrorMessage(error);
    els.statusText.textContent = "出错了";
    els.resultText.textContent = "这次没有成功：\n" + message;
    showToast(message);
  }

  function stopActiveRequest() {
    if (api.abortActive) {
      api.abortActive();
    }
    state.running = false;
    els.sendTaskBtn.disabled = false;
    els.stopTaskBtn.disabled = true;
    els.sendChatBtn.disabled = false;
    els.stopChatBtn.disabled = true;
    els.statusText.textContent = "已停止";
  }

  function clearTask() {
    if (state.running) {
      stopActiveRequest();
    }
    els.inputText.value = "";
    state.taskAttachments = [];
    state.currentResult = "";
    els.resultText.textContent = "等待输入";
    els.copyTaskBtn.disabled = true;
    renderAttachments("task");
    els.inputText.focus();
  }

  async function copyTaskResult() {
    if (!state.currentResult) {
      return;
    }

    try {
      if (api.copyText) {
        await api.copyText(state.currentResult);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(state.currentResult);
      }
      showToast("已复制");
    } catch (error) {
      showToast("复制没成功：" + getErrorMessage(error));
    }
  }

  async function addFiles(target, fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    var provider = target === "chat" ? getChatProvider(getActiveAssistant()) : getActiveProvider();
    var existingAttachments = target === "chat" ? state.chatAttachments : state.taskAttachments;
    var imageSlots = getRemainingImageSlots(existingAttachments);
    var nextAttachments = [];

    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      if (/^image\//i.test(file.type || "") && imageSlots <= 0) {
        showToast("最多附加 " + MAX_IMAGE_ATTACHMENTS + " 张图片");
        continue;
      }
      try {
        var attachment = await prepareAttachment(file, provider);
        if (attachment) {
          nextAttachments.push(attachment);
          if (attachment.kind === "image") {
            imageSlots -= 1;
          }
        }
      } catch (error) {
        showToast(file.name + "：" + getErrorMessage(error));
      }
    }

    if (!nextAttachments.length) {
      return;
    }

    if (target === "chat") {
      state.chatAttachments = state.chatAttachments.concat(nextAttachments);
      renderAttachments("chat");
      return;
    }

    state.taskAttachments = state.taskAttachments.concat(nextAttachments);
    renderAttachments("task");
  }

  function getRemainingImageSlots(attachments) {
    var imageCount = attachments.filter(function (attachment) {
      return attachment.kind === "image";
    }).length;
    return Math.max(0, MAX_IMAGE_ATTACHMENTS - imageCount);
  }

  function handleChatPaste(event) {
    var imageFiles = getClipboardImageFiles(event);
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    addFiles("chat", imageFiles);
  }

  function getClipboardImageFiles(event) {
    var clipboardData = event.clipboardData;
    if (!clipboardData) {
      return [];
    }

    var files = [];
    if (clipboardData.items && clipboardData.items.length) {
      Array.from(clipboardData.items).forEach(function (item, index) {
        if (item.kind !== "file" || !/^image\//i.test(item.type || "")) {
          return;
        }
        var file = item.getAsFile();
        if (file) {
          files.push(normalizeClipboardImageFile(file, index));
        }
      });
    }

    if (!files.length && clipboardData.files && clipboardData.files.length) {
      Array.from(clipboardData.files).forEach(function (file, index) {
        if (/^image\//i.test(file.type || "")) {
          files.push(normalizeClipboardImageFile(file, index));
        }
      });
    }

    return files;
  }

  function normalizeClipboardImageFile(file, index) {
    if (file.name) {
      return file;
    }

    var extension = imageExtensionFromMime(file.type);
    var name = "pasted-image-" + (index + 1) + "." + extension;
    if (typeof File === "undefined") {
      return file;
    }

    return new File([file], name, {
      type: file.type || "image/png",
      lastModified: Date.now()
    });
  }

  function imageExtensionFromMime(mime) {
    var value = String(mime || "").toLowerCase();
    if (value.indexOf("jpeg") >= 0 || value.indexOf("jpg") >= 0) {
      return "jpg";
    }
    if (value.indexOf("webp") >= 0) {
      return "webp";
    }
    if (value.indexOf("gif") >= 0) {
      return "gif";
    }
    return "png";
  }

  async function prepareAttachment(file, provider) {
    var isImage = /^image\//i.test(file.type || "");
    if (isImage) {
      if (!provider || provider.multimodal !== true) {
        showToast("这个模型未开启多模态，图片先不发送");
        return null;
      }
      return {
        id: createId("file"),
        kind: "image",
        name: file.name,
        mime: file.type || "image/png",
        size: file.size,
        dataUrl: await readFileAsDataUrl(file)
      };
    }

    if (!isTextLikeFile(file)) {
      throw new Error("暂时只能读取文本类文档");
    }

    var text = await readFileAsText(file);
    if (text.length > MAX_TEXT_ATTACHMENT_CHARS) {
      text = text.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
    }
    return {
      id: createId("file"),
      kind: "document",
      name: file.name,
      mime: file.type || "text/plain",
      size: file.size,
      text: text
    };
  }

  function isTextLikeFile(file) {
    if (/^text\//i.test(file.type || "")) {
      return true;
    }
    var extension = file.name.split(".").pop().toLowerCase();
    return TEXT_EXTENSIONS.indexOf(extension) >= 0;
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("读取失败"));
      };
      reader.readAsText(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("读取失败"));
      };
      reader.readAsDataURL(file);
    });
  }

  function handleAttachmentClick(event) {
    var button = event.target.closest("button[data-attachment-id]");
    if (!button) {
      return;
    }

    var target = button.dataset.target;
    var id = button.dataset.attachmentId;
    if (target === "chat") {
      state.chatAttachments = state.chatAttachments.filter(function (attachment) {
        return attachment.id !== id;
      });
      renderAttachments("chat");
      return;
    }

    state.taskAttachments = state.taskAttachments.filter(function (attachment) {
      return attachment.id !== id;
    });
    renderAttachments("task");
  }

  function renderAttachments(target) {
    var container = target === "chat" ? els.chatAttachments : els.taskAttachments;
    var attachments = target === "chat" ? state.chatAttachments : state.taskAttachments;
    container.innerHTML = attachments
      .map(function (attachment) {
        if (attachment.kind === "image") {
          return renderImageAttachment(target, attachment);
        }

        return (
          '<span class="attachment-chip">' +
          '<span>' +
          escapeHtml("文档：" + attachment.name) +
          "</span>" +
          '<button type="button" data-target="' +
          escapeAttr(target) +
          '" data-attachment-id="' +
          escapeAttr(attachment.id) +
          '">×</button>' +
          "</span>"
        );
      })
      .join("");
  }

  function renderImageAttachment(target, attachment) {
    return (
      '<span class="attachment-preview">' +
      '<img src="' +
      escapeAttr(attachment.dataUrl) +
      '" alt="' +
      escapeAttr(attachment.name) +
      '" />' +
      '<span>' +
      escapeHtml(attachment.name) +
      "</span>" +
      '<button type="button" aria-label="删除图片" data-target="' +
      escapeAttr(target) +
      '" data-attachment-id="' +
      escapeAttr(attachment.id) +
      '">×</button>' +
      "</span>"
    );
  }

  function renderChat() {
    ensureActiveAssistantAndSession();
    renderAssistantPanelState();
    renderAssistants();
    renderAssistantEditor();
    renderChatModelSelect();
    renderSessions();
    renderMessages();
    updateModelBadge();
  }

  function ensureActiveAssistantAndSession() {
    if (!state.chatStore.assistants.length) {
      var assistant = createAssistant();
      state.chatStore.assistants.push(assistant);
      state.chatStore.activeAssistantId = assistant.id;
    }

    var activeAssistant = getActiveAssistant();
    if (!activeAssistant) {
      state.chatStore.activeAssistantId = state.chatStore.assistants[0].id;
      activeAssistant = state.chatStore.assistants[0];
    }

    if (!activeAssistant.sessions.length) {
      var session = createSession();
      activeAssistant.sessions.push(session);
      activeAssistant.activeSessionId = session.id;
      return;
    }

    var active = getActiveSession();
    if (!active) {
      activeAssistant.activeSessionId = activeAssistant.sessions[0].id;
    }
  }

  function renderAssistants() {
    var activeAssistant = getActiveAssistant();
    if (els.currentAssistantName) {
      els.currentAssistantName.textContent = activeAssistant ? activeAssistant.name || "默认助手" : "默认助手";
    }

    els.assistantsList.innerHTML = state.chatStore.assistants
      .map(function (assistant) {
        var activeClass = assistant.id === state.chatStore.activeAssistantId ? " is-active" : "";
        return (
          '<div class="assistant-item' +
          activeClass +
          '" data-assistant-id="' +
          escapeAttr(assistant.id) +
          '">' +
          '<button class="assistant-title" type="button" data-action="select-assistant">' +
          escapeHtml(assistant.name || "默认助手") +
          "</button>" +
          '<button class="assistant-delete" type="button" title="删除助手" aria-label="删除助手" data-action="delete-assistant">×</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function renderAssistantPanelState() {
    if (els.assistantSection) {
      els.assistantSection.classList.toggle("is-open", state.assistantsOpen);
    }
    if (els.assistantToggleBtn) {
      els.assistantToggleBtn.setAttribute("aria-expanded", state.assistantsOpen ? "true" : "false");
    }
  }

  function toggleAssistantPanel() {
    state.assistantsOpen = !state.assistantsOpen;
    renderAssistantPanelState();
  }

  function renderAssistantEditor() {
    var assistant = getActiveAssistant();
    if (!assistant) {
      els.assistantNameInput.value = "";
      els.assistantPromptInput.value = "";
      return;
    }

    if (document.activeElement !== els.assistantNameInput) {
      els.assistantNameInput.value = assistant.name || "";
    }
    if (document.activeElement !== els.assistantPromptInput) {
      els.assistantPromptInput.value = assistant.prompt || "";
    }
  }

  function renderTaskModelSelect() {
    renderModeModelSelect(els.taskModelSelect, state.activeTaskMode);
  }

  function renderChatModelSelect() {
    renderModeModelSelect(els.assistantProviderSelect, "chat", getActiveSession());
  }

  function renderModeModelSelect(selectEl, mode, session) {
    if (!selectEl) {
      return;
    }

    var providers = state.config.providers || [];
    selectEl.innerHTML = "";

    if (!countModels(providers)) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "未配置模型";
      selectEl.appendChild(emptyOption);
      selectEl.disabled = true;
      return;
    }

    selectEl.disabled = false;
    providers.forEach(function (provider) {
      provider.models.forEach(function (model) {
        var option = document.createElement("option");
        option.value = formatModelValue(provider.id, model.id);
        option.textContent =
          (provider.name || "未命名 provider") + " / " + (model.model || "未设置模型");
        selectEl.appendChild(option);
      });
    });

    var selected = session && session.providerId && session.modelId
      ? { providerId: session.providerId, modelId: session.modelId }
      : null;
    if (!selected || !getProviderModel(selected.providerId, selected.modelId, providers)) {
      ensureModeModel(mode, providers);
      selected = state.config.modeModels[mode] || {};
      if (session && mode === "chat") {
        session.providerId = selected.providerId || "";
        session.modelId = selected.modelId || "";
        saveChatStoreQuietly();
      }
    }
    selectEl.value = formatModelValue(selected.providerId, selected.modelId);
  }

  function updateModeModel(mode, value) {
    var providers = state.config.providers || [];
    var selection = parseModelValue(value);
    if (!getProviderModel(selection.providerId, selection.modelId, providers)) {
      ensureModeModel(mode, providers);
    } else {
      state.config.modeModels[mode] = {
        providerId: selection.providerId,
        modelId: selection.modelId
      };
      if (mode === "chat") {
        var session = getActiveSession();
        if (session) {
          session.providerId = selection.providerId;
          session.modelId = selection.modelId;
          saveChatStoreQuietly();
        }
      }
    }
    renderTaskModelSelect();
    renderChatModelSelect();
    updateModelBadge();
    saveConfigQuietly();
  }

  function renderSessions() {
    var assistant = getActiveAssistant();
    var sessions = assistant ? assistant.sessions : [];
    els.sessionsList.innerHTML = sessions
      .map(function (session) {
        var activeClass = assistant && session.id === assistant.activeSessionId ? " is-active" : "";
        return (
          '<div class="session-item' +
          activeClass +
          '" data-session-id="' +
          escapeAttr(session.id) +
          '">' +
          '<button class="session-title" type="button" data-action="select-session">' +
          escapeHtml(session.title || "新会话") +
          "</button>" +
          '<button class="session-delete" type="button" title="删除话题" aria-label="删除话题" data-action="delete-session">×</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function renderMessages() {
    var session = getActiveSession();
    if (!session) {
      els.messagesList.innerHTML = "";
      return;
    }

    els.messagesList.innerHTML = session.messages
      .map(function (message) {
        return renderMessage(message);
      })
      .join("");
    els.messagesList.scrollTop = els.messagesList.scrollHeight;
  }

  function renderMessage(message) {
    var attachments = Array.isArray(message.attachments) ? message.attachments : [];
    var attachmentHtml = attachments.length
      ? '<div class="message-attachments">' +
        attachments
          .map(function (attachment) {
            if (attachment.kind === "image" && attachment.dataUrl) {
              return (
                '<img class="message-image" src="' +
                escapeAttr(attachment.dataUrl) +
                '" alt="' +
                escapeAttr(attachment.name) +
                '" />'
              );
            }
            return (
              '<span class="message-attachment">' +
              escapeHtml((attachment.kind === "image" ? "图片：" : "文档：") + attachment.name) +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : "";
    return (
      '<div class="message ' +
      escapeAttr(message.role) +
      '" data-message-id="' +
      escapeAttr(message.id) +
      '">' +
      escapeHtml(message.content || "") +
      attachmentHtml +
      "</div>"
    );
  }

  function handleAssistantClick(event) {
    var item = event.target.closest(".assistant-item");
    if (!item) {
      return;
    }

    if (event.target.dataset.action === "delete-assistant") {
      if (!window.confirm("删除这个助手？它下面的话题也会一起删除。")) {
        return;
      }
      deleteAssistant(item.dataset.assistantId);
      return;
    }

    state.chatStore.activeAssistantId = item.dataset.assistantId;
    state.assistantsOpen = false;
    ensureActiveAssistantAndSession();
    saveChatStoreQuietly();
    renderChat();
  }

  function createNewAssistant() {
    var assistant = createAssistant();
    state.chatStore.assistants.unshift(assistant);
    state.chatStore.activeAssistantId = assistant.id;
    state.assistantsOpen = true;
    state.chatAttachments = [];
    els.chatInput.value = "";
    saveChatStoreQuietly();
    renderChat();
    els.assistantNameInput.focus();
    els.assistantNameInput.select();
  }

  function deleteAssistant(assistantId) {
    state.chatStore.assistants = state.chatStore.assistants.filter(function (assistant) {
      return assistant.id !== assistantId;
    });
    ensureActiveAssistantAndSession();
    saveChatStoreQuietly();
    renderChat();
  }

  function updateActiveAssistantFromForm() {
    var assistant = getActiveAssistant();
    if (!assistant) {
      return;
    }

    assistant.name = els.assistantNameInput.value.trim() || "默认助手";
    assistant.prompt = els.assistantPromptInput.value;
    assistant.updatedAt = Date.now();
    saveChatStoreQuietly();
    renderAssistants();
    updateModelBadge();
  }

  function handleSessionClick(event) {
    var item = event.target.closest(".session-item");
    if (!item) {
      return;
    }

    if (event.target.dataset.action === "delete-session") {
      if (!window.confirm("删除这个话题？")) {
        return;
      }
      deleteSession(item.dataset.sessionId);
      return;
    }

    var assistant = getActiveAssistant();
    if (assistant) {
      assistant.activeSessionId = item.dataset.sessionId;
    }
    saveChatStoreQuietly();
    renderChat();
  }

  function createNewSession() {
    ensureActiveAssistantAndSession();
    var assistant = getActiveAssistant();
    var session = createSession();
    assistant.sessions.unshift(session);
    assistant.activeSessionId = session.id;
    state.chatAttachments = [];
    els.chatInput.value = "";
    saveChatStoreQuietly();
    renderChat();
    els.chatInput.focus();
  }

  function deleteSession(sessionId) {
    var assistant = getActiveAssistant();
    if (!assistant) {
      return;
    }

    assistant.sessions = assistant.sessions.filter(function (session) {
      return session.id !== sessionId;
    });
    ensureActiveAssistantAndSession();
    saveChatStoreQuietly();
    renderChat();
  }

  async function sendChatMessage() {
    ensureActiveAssistantAndSession();
    var assistant = getActiveAssistant();
    var provider = getChatProvider(assistant);
    var text = els.chatInput.value.trim();
    var attachments = cloneAttachmentsForRequest(state.chatAttachments);
    var session = getActiveSession();

    if (!text && !attachments.length) {
      showToast("先输入一点消息");
      return;
    }

    if (!provider) {
      showToast("先配置一个模型");
      setTab("settings");
      return;
    }

    if (!session) {
      createNewSession();
      session = getActiveSession();
    }

    var userMessageForApi = createMessage("user", text, attachments);
    var userMessageForStorage = createMessage("user", text, sanitizeAttachmentsForStorage(attachments));
    session.messages.push(userMessageForStorage);
    if (!session.title || session.title === "新会话") {
      session.title = createSessionTitle(text, attachments);
    }

    var apiMessages = session.messages.map(cloneMessage);
    apiMessages[apiMessages.length - 1] = userMessageForApi;
    var assistantMessage = createMessage("assistant", "", []);
    session.messages.push(assistantMessage);
    session.updatedAt = Date.now();
    state.chatAttachments = [];
    els.chatInput.value = "";
    renderAttachments("chat");
    renderChat();
    saveChatStoreQuietly();

    state.running = true;
    els.sendChatBtn.disabled = true;
    els.stopChatBtn.disabled = false;
    els.statusText.textContent = provider.name + " / " + provider.model;

    var errorHandled = false;
    try {
      await api.sendChat(
        {
          providerId: provider.id,
          modelId: provider.modelId,
          messages: apiMessages,
          assistant: {
            name: assistant ? assistant.name : "",
            prompt: assistant ? assistant.prompt : ""
          }
        },
        function (event) {
          if (event && event.type === "error") {
            errorHandled = true;
          }
          handleChatEvent(event, assistantMessage, provider);
        }
      );
    } catch (error) {
      if (!errorHandled && getErrorMessage(error) !== "请求已取消") {
        assistantMessage.content = "这次没有成功：\n" + getErrorMessage(error);
        showToast(getErrorMessage(error));
      }
    } finally {
      state.running = false;
      els.sendChatBtn.disabled = false;
      els.stopChatBtn.disabled = true;
      session.updatedAt = Date.now();
      saveChatStoreQuietly();
      renderChat();
    }
  }

  function handleChatEvent(event, assistantMessage, provider) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "status") {
      els.statusText.textContent = event.message || provider.model;
      return;
    }

    if (event.type === "delta") {
      assistantMessage.content += event.text || "";
      updateRenderedMessage(assistantMessage);
      return;
    }

    if (event.type === "done") {
      els.statusText.textContent = "已完成";
      return;
    }

    if (event.type === "error") {
      assistantMessage.content = "这次没有成功：\n" + (event.message || "请求失败");
      updateRenderedMessage(assistantMessage);
      showToast(event.message || "这次没有成功");
    }
  }

  function updateRenderedMessage(message) {
    var node = els.messagesList.querySelector('[data-message-id="' + cssEscape(message.id) + '"]');
    if (!node) {
      renderMessages();
      return;
    }
    node.textContent = message.content || "";
    els.messagesList.scrollTop = els.messagesList.scrollHeight;
  }

  function createSession() {
    var now = Date.now();
    var selection = state.config && state.config.modeModels
      ? state.config.modeModels.chat || { providerId: "", modelId: "" }
      : { providerId: "", modelId: "" };
    return {
      id: createId("session"),
      title: "新会话",
      providerId: selection.providerId || "",
      modelId: selection.modelId || "",
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function createAssistant() {
    var now = Date.now();
    var session = createSession();
    return {
      id: createId("assistant"),
      name: "默认助手",
      prompt: "",
      providerId: "",
      modelId: "",
      createdAt: now,
      updatedAt: now,
      activeSessionId: session.id,
      sessions: [session]
    };
  }

  function createMessage(role, content, attachments) {
    return {
      id: createId("message"),
      role: role,
      content: content || "",
      attachments: attachments || [],
      createdAt: Date.now()
    };
  }

  function createSessionTitle(text, attachments) {
    var value = text || (attachments[0] ? attachments[0].name : "新会话");
    value = value.replace(/\s+/g, " ").trim();
    return value.length > 18 ? value.slice(0, 18) + "..." : value || "新会话";
  }

  function getActiveSession() {
    var assistant = getActiveAssistant();
    if (!assistant) {
      return null;
    }

    return (
      assistant.sessions.find(function (session) {
        return session.id === assistant.activeSessionId;
      }) || null
    );
  }

  function getActiveAssistant() {
    return (
      state.chatStore.assistants.find(function (assistant) {
        return assistant.id === state.chatStore.activeAssistantId;
      }) || null
    );
  }

  function getChatProvider(assistant) {
    var providers = state.config.providers || [];
    var session = getActiveSession();
    if (session && session.providerId && session.modelId) {
      var sessionProvider = getProviderModel(session.providerId, session.modelId, providers);
      if (sessionProvider) {
        return sessionProvider;
      }
    }
    return getModeProvider("chat", providers);
  }

  async function saveChatStoreQuietly() {
    try {
      if (api.saveChatStore) {
        await api.saveChatStore(state.chatStore);
      }
    } catch (error) {
      // Storage errors should not interrupt the current answer stream.
    }
  }

  async function saveConfigQuietly() {
    try {
      if (api.saveConfig) {
        state.config = normalizeConfig(await api.saveConfig(state.config));
      }
    } catch (error) {
      // Choosing a model should remain responsive even if storage is temporarily unavailable.
    }
  }

  function renderSettings() {
    renderProviders();
    renderAssistantEditor();
  }

  function renderProviders() {
    var providers = state.draftProviders;

    if (!providers.length) {
      els.providersList.innerHTML =
        '<div class="empty-state">暂无 provider</div>';
      return;
    }

    els.providersList.innerHTML =
      '<div class="provider-table">' +
      '<div class="provider-table-head">' +
      "<span></span><span>名称</span><span>URL</span><span>模型</span><span></span>" +
      "</div>" +
      providers
        .map(function (provider) {
          return renderProviderCard(provider);
        })
        .join("") +
      "</div>";
  }

  function renderProviderCard(provider) {
    var customProxyHidden = provider.proxyMode === "custom" ? "" : " hidden";
    var models = provider.models || [];
    var expanded = state.expandedProviderIds[provider.id] === true;
    return (
      '<article class="provider-card' +
      (expanded ? " is-expanded" : "") +
      '" data-provider-id="' +
      escapeAttr(provider.id) +
      '">' +
      '<div class="provider-summary" data-action="toggle-provider">' +
      '<button class="drag-handle" type="button" draggable="true" title="拖动排序" aria-label="拖动排序" data-action="drag-provider">☰</button>' +
      '<span class="provider-name-cell" title="' +
      escapeAttr(provider.name || "未命名 provider") +
      '">' +
      escapeHtml(provider.name || "未命名 provider") +
      "</span>" +
      '<span class="provider-url-cell" title="' +
      escapeAttr(provider.endpoint || "未填写 API 地址") +
      '">' +
      escapeHtml(provider.endpoint || "未填写 API 地址") +
      "</span>" +
      '<span class="provider-model-count">' +
      escapeHtml(models.length + " 个") +
      "</span>" +
      '<button class="danger-btn icon-btn" type="button" title="删除 provider" aria-label="删除 provider" data-action="delete-provider">×</button>' +
      "</div>" +
      '<div class="provider-detail"' +
      (expanded ? "" : " hidden") +
      ">" +
      '<div class="provider-grid">' +
      '<label class="field"><span>Provider 名称</span><input data-field="name" value="' +
      escapeAttr(provider.name) +
      '" /></label>' +
      '<label class="field field-full"><span>API 地址</span><input data-field="endpoint" value="' +
      escapeAttr(provider.endpoint) +
      '" placeholder="https://example.com/v1/chat/completions" /></label>' +
      '<label class="field field-full"><span>API Key</span><input data-field="apiKey" type="password" value="' +
      escapeAttr(provider.apiKey) +
      '" placeholder="可为空" /></label>' +
      '<label class="field"><span>代理服务</span><select data-field="proxyMode">' +
      renderOption("direct", "直连", provider.proxyMode) +
      renderOption("system", "系统代理", provider.proxyMode) +
      renderOption("custom", "自定义代理", provider.proxyMode) +
      "</select></label>" +
      '<label class="checkbox-field ssl-field"><input data-field="sslVerify" type="checkbox" ' +
      (provider.sslVerify ? "checked" : "") +
      " />校验 SSL 证书</label>" +
      '<label class="field field-full custom-proxy-field"' +
      customProxyHidden +
      '><span>自定义代理 URL</span><input data-field="proxyUrl" value="' +
      escapeAttr(provider.proxyUrl) +
      '" placeholder="http://127.0.0.1:7890" /></label>' +
      '<div class="field-full models-block">' +
      '<div class="models-head"><span>模型</span><div class="models-actions">' +
      '<button class="icon-btn compact-btn" type="button" title="拉取模型" aria-label="拉取模型" data-action="fetch-models" ' +
      (state.fetchingModelsProviderId === provider.id ? "disabled" : "") +
      ">↻</button>" +
      '<button class="icon-btn compact-btn" type="button" title="添加模型" aria-label="添加模型" data-action="add-model">+</button>' +
      "</div></div>" +
      renderModelRows(provider) +
      "</div>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function renderModelRows(provider) {
    return (provider.models || [])
      .map(function (model) {
        return (
          '<div class="model-row" data-model-id="' +
          escapeAttr(model.id) +
          '">' +
          '<input data-model-field="model" value="' +
          escapeAttr(model.model) +
          '" placeholder="qwen-plus" />' +
          '<label class="checkbox-field"><input data-model-field="multimodal" type="checkbox" ' +
          (model.multimodal ? "checked" : "") +
          " />多模态</label>" +
          '<button class="icon-btn" type="button" title="删除模型" aria-label="删除模型" data-action="delete-model">×</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function renderOption(value, label, selectedValue) {
    return (
      '<option value="' +
      escapeAttr(value) +
      '"' +
      (selectedValue === value ? " selected" : "") +
      ">" +
      escapeHtml(label) +
      "</option>"
    );
  }

  function handleProviderInput(event) {
    var target = event.target;
    var field = target.dataset.field;
    var modelField = target.dataset.modelField;
    var card = target.closest(".provider-card");
    if ((!field && !modelField) || !card) {
      return;
    }

    var provider = state.draftProviders.find(function (item) {
      return item.id === card.dataset.providerId;
    });
    if (!provider) {
      return;
    }

    if (modelField) {
      var modelRow = target.closest(".model-row");
      var model = modelRow
        ? provider.models.find(function (item) {
            return item.id === modelRow.dataset.modelId;
          })
        : null;
      if (!model) {
        return;
      }
      model[modelField] = target.type === "checkbox" ? target.checked : target.value;
    } else {
      provider[field] = target.type === "checkbox" ? target.checked : target.value;
    }

    if (field === "proxyMode") {
      var customField = card.querySelector(".custom-proxy-field");
      if (customField) {
        var shouldHideProxy = provider.proxyMode !== "custom";
        customField.hidden = shouldHideProxy;
        customField.classList.toggle("hidden", shouldHideProxy);
      }
    }

    var nameCell = card.querySelector(".provider-name-cell");
    var urlCell = card.querySelector(".provider-url-cell");
    var modelCount = card.querySelector(".provider-model-count");
    if (nameCell) {
      nameCell.textContent = provider.name || "未命名 provider";
      nameCell.title = provider.name || "未命名 provider";
    }
    if (urlCell) {
      urlCell.textContent = provider.endpoint || "未填写 API 地址";
      urlCell.title = provider.endpoint || "未填写 API 地址";
    }
    if (modelCount) {
      modelCount.textContent = (provider.models || []).length + " 个";
    }
    renderAssistantEditor();
    updateModelBadge();
  }

  function handleProviderClick(event) {
    var button = event.target.closest("button[data-action]");
    var summary = event.target.closest(".provider-summary");
    var card = event.target.closest(".provider-card");
    if (!card) {
      return;
    }

    if (!button && summary) {
      toggleProviderDetail(card.dataset.providerId);
      return;
    }

    if (!button) {
      return;
    }

    if (button.dataset.action === "drag-provider") {
      return;
    }

    if (button.dataset.action === "delete-provider") {
      if (!window.confirm("删除这个 provider？")) {
        return;
      }
      deleteProvider(card.dataset.providerId);
      return;
    }

    if (button.dataset.action === "add-model") {
      addModel(card.dataset.providerId);
      return;
    }

    if (button.dataset.action === "fetch-models") {
      fetchModelsForProvider(card.dataset.providerId);
      return;
    }

    if (button.dataset.action === "delete-model") {
      var modelRow = button.closest(".model-row");
      if (!modelRow) {
        return;
      }
      deleteModel(card.dataset.providerId, modelRow.dataset.modelId);
    }
  }

  function toggleProviderDetail(providerId) {
    if (!providerId) {
      return;
    }
    state.expandedProviderIds[providerId] = state.expandedProviderIds[providerId] !== true;
    renderProviders();
  }

  function handleProviderDragStart(event) {
    var handle = event.target.closest(".drag-handle");
    var card = handle ? handle.closest(".provider-card") : null;
    if (!card) {
      return;
    }

    state.draggingProviderId = card.dataset.providerId;
    card.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.draggingProviderId);
    }
  }

  function handleProviderDragOver(event) {
    var card = event.target.closest(".provider-card");
    if (!state.draggingProviderId || !card || card.dataset.providerId === state.draggingProviderId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleProviderDrop(event) {
    var card = event.target.closest(".provider-card");
    var sourceId =
      state.draggingProviderId ||
      (event.dataTransfer ? event.dataTransfer.getData("text/plain") : "");
    if (!card || !sourceId || card.dataset.providerId === sourceId) {
      return;
    }

    event.preventDefault();
    var rect = card.getBoundingClientRect();
    var insertAfter = event.clientY > rect.top + rect.height / 2;
    reorderProvider(sourceId, card.dataset.providerId, insertAfter);
    state.draggingProviderId = "";
  }

  function handleProviderDragEnd() {
    state.draggingProviderId = "";
    Array.from(els.providersList.querySelectorAll(".provider-card.is-dragging")).forEach(function (card) {
      card.classList.remove("is-dragging");
    });
  }

  function reorderProvider(sourceId, targetId, insertAfter) {
    var fromIndex = state.draftProviders.findIndex(function (provider) {
      return provider.id === sourceId;
    });
    if (fromIndex < 0) {
      return;
    }

    var moving = state.draftProviders.splice(fromIndex, 1)[0];
    var targetIndex = state.draftProviders.findIndex(function (provider) {
      return provider.id === targetId;
    });
    if (targetIndex < 0) {
      state.draftProviders.splice(fromIndex, 0, moving);
      return;
    }

    state.draftProviders.splice(targetIndex + (insertAfter ? 1 : 0), 0, moving);
    renderSettings();
    updateModelBadge();
  }

  function addProvider() {
    var provider = createProvider();
    state.draftProviders.push(provider);
    state.expandedProviderIds[provider.id] = true;
    renderSettings();
    updateModelBadge();
  }

  function addModel(providerId) {
    var provider = state.draftProviders.find(function (item) {
      return item.id === providerId;
    });
    if (!provider) {
      return;
    }
    provider.models.push(createModel());
    renderSettings();
    updateModelBadge();
  }

  async function fetchModelsForProvider(providerId) {
    var provider = state.draftProviders.find(function (item) {
      return item.id === providerId;
    });
    if (!provider || !api.fetchModels) {
      return;
    }

    var payload = trimProvider(provider);
    if (!payload.endpoint) {
      showToast("先填写 API 地址");
      return;
    }

    var endpointError = validateEndpoint(payload.endpoint);
    if (endpointError) {
      showToast(endpointError);
      return;
    }

    if (payload.proxyMode === "custom") {
      if (!payload.proxyUrl) {
        showToast("先填写自定义代理 URL");
        return;
      }
      var proxyError = validateProxyUrl(payload.proxyUrl);
      if (proxyError) {
        showToast(proxyError);
        return;
      }
    }

    state.fetchingModelsProviderId = providerId;
    renderProviders();
    showToast("拉取模型中");

    try {
      var result = await api.fetchModels(payload);
      var fetchedModels = result && Array.isArray(result.models) ? result.models : [];
      var addedCount = mergeFetchedModels(provider, fetchedModels);
      renderSettings();
      updateModelBadge();
      showToast(addedCount ? "已新增 " + addedCount + " 个模型" : "模型已是最新");
    } catch (error) {
      showToast("拉取没成功：" + getErrorMessage(error));
    } finally {
      state.fetchingModelsProviderId = "";
      renderProviders();
    }
  }

  function deleteProvider(providerId) {
    state.draftProviders = state.draftProviders.filter(function (provider) {
      return provider.id !== providerId;
    });
    delete state.expandedProviderIds[providerId];

    ensureModeModels(state.config, state.draftProviders);
    clearSessionModelRefs(providerId, "");
    renderSettings();
    updateModelBadge();
  }

  function deleteModel(providerId, modelId) {
    var provider = state.draftProviders.find(function (item) {
      return item.id === providerId;
    });
    if (!provider || provider.models.length <= 1) {
      showToast("至少保留一个模型");
      return;
    }

    provider.models = provider.models.filter(function (model) {
      return model.id !== modelId;
    });

    ensureModeModels(state.config, state.draftProviders);
    clearSessionModelRefs(providerId, modelId);
    renderSettings();
    updateModelBadge();
  }

  function clearSessionModelRefs(providerId, modelId) {
    state.chatStore.assistants.forEach(function (assistant) {
      (assistant.sessions || []).forEach(function (session) {
        var sameProvider = session.providerId === providerId;
        var sameModel = !modelId || session.modelId === modelId;
        if (sameProvider && sameModel) {
          session.providerId = "";
          session.modelId = "";
        }
      });
    });
    saveChatStoreQuietly();
  }

  async function saveSettings() {
    var nextConfig = {
      providers: state.draftProviders.map(trimProvider),
      modeModels: cloneModeModels(state.config.modeModels)
    };
    var validationMessage = validateConfig(nextConfig);
    if (validationMessage) {
      showToast(validationMessage);
      return;
    }

    try {
      state.config = normalizeConfig(await api.saveConfig(nextConfig));
      state.draftProviders = cloneProviders(state.config.providers);
      renderSettings();
      renderTaskModelSelect();
      renderChatModelSelect();
      updateModelBadge();
      showToast("已保存");
    } catch (error) {
      showToast("保存没成功：" + getErrorMessage(error));
    }
  }

  function validateConfig(config) {
    if (!config.providers.length) {
      return "";
    }

    for (var index = 0; index < config.providers.length; index += 1) {
      var provider = config.providers[index];
      var prefix = provider.name || "第 " + (index + 1) + " 个 provider";

      if (!provider.name) {
        return prefix + " 还没填写名称";
      }
      if (!provider.endpoint) {
        return prefix + " 还没填写 API 地址";
      }

      if (!provider.models.length) {
        return prefix + " 至少需要一个模型";
      }

      for (var modelIndex = 0; modelIndex < provider.models.length; modelIndex += 1) {
        if (!provider.models[modelIndex].model) {
          return prefix + " 的第 " + (modelIndex + 1) + " 个模型还没填写 ID";
        }
      }

      var endpointError = validateEndpoint(provider.endpoint);
      if (endpointError) {
        return prefix + "：" + endpointError;
      }

      if (provider.proxyMode === "custom" && !provider.proxyUrl) {
        return prefix + " 还没填写自定义代理 URL";
      }

      if (provider.proxyMode === "custom") {
        var proxyError = validateProxyUrl(provider.proxyUrl);
        if (proxyError) {
          return prefix + "：" + proxyError;
        }
      }
    }

    return "";
  }

  function validateEndpoint(endpoint) {
    try {
      var parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "API 地址只支持 http 或 https";
      }
      if (!/\/v1\/chat\/completions\/?$/.test(parsed.pathname)) {
        return "API 地址必须是完整的 /v1/chat/completions";
      }
    } catch (error) {
      return "API 地址不是有效 URL";
    }
    return "";
  }

  function validateProxyUrl(proxyUrl) {
    try {
      var raw = String(proxyUrl || "").trim();
      var normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "http://" + raw;
      var parsed = new URL(normalized);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "代理只支持 http 或 https";
      }
      if (!parsed.hostname) {
        return "代理 URL 缺少主机名";
      }
    } catch (error) {
      return "代理 URL 不是有效 URL";
    }
    return "";
  }

  function getActiveProvider() {
    return getModeProvider(state.activeTaskMode, state.config.providers || []);
  }

  function getModeProvider(mode, providers) {
    ensureModeModel(mode, providers);
    var selection = state.config.modeModels[mode] || {};
    return getProviderModel(selection.providerId, selection.modelId, providers) ||
      getFirstResolvedProviderModel(providers);
  }

  function updateModelBadge() {
    var assistant = state.activeTab === "chat" ? getActiveAssistant() : null;
    var mode = state.activeTab === "chat" ? "chat" : state.activeTaskMode;
    var provider = getModeProvider(mode, state.config.providers || []);

    if (!provider) {
      els.modelBadge.textContent = "未配置模型";
      return;
    }

    var proxyLabel =
      provider.proxyMode === "direct"
        ? "直连"
        : provider.proxyMode === "system"
          ? "系统代理"
          : "自定义代理";
    els.modelBadge.textContent =
      (assistant ? (assistant.name || "默认助手") + " / " : "") +
      (provider.name || "未命名 provider") +
      " / " +
      (provider.model || "未设置模型") +
      (provider.multimodal ? " / 多模态" : "") +
      " / " +
      proxyLabel;
  }

  function createProvider() {
    return {
      id: createId("provider"),
      name: "新 provider",
      endpoint: "",
      apiKey: "",
      sslVerify: false,
      proxyMode: "system",
      proxyUrl: "",
      models: [createModel()]
    };
  }

  function createModel() {
    return {
      id: createId("model"),
      model: "",
      multimodal: false
    };
  }

  function normalizeConfig(config) {
    var source = config && typeof config === "object" ? config : {};
    var providers = Array.isArray(source.providers)
      ? source.providers.map(normalizeProvider)
      : [];
    var legacySelection = {
      providerId: typeof source.defaultProviderId === "string" ? source.defaultProviderId : "",
      modelId: typeof source.defaultModelId === "string" ? source.defaultModelId : ""
    };
    var modeModels = normalizeModeModels(source.modeModels, providers, legacySelection);

    return {
      providers: providers,
      modeModels: modeModels
    };
  }

  function normalizeProvider(provider) {
    var source = provider && typeof provider === "object" ? provider : {};
    return {
      id:
        typeof source.id === "string" && source.id
          ? source.id
          : createId("provider"),
      name: typeof source.name === "string" ? source.name : "",
      endpoint: typeof source.endpoint === "string" ? source.endpoint : "",
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      sslVerify: source.sslVerify === true,
      proxyMode: ["direct", "system", "custom"].indexOf(source.proxyMode) >= 0
        ? source.proxyMode
        : "system",
      proxyUrl: typeof source.proxyUrl === "string" ? source.proxyUrl : "",
      models: normalizeModels(source)
    };
  }

  function trimProvider(provider) {
    return {
      id: provider.id,
      name: String(provider.name || "").trim(),
      endpoint: String(provider.endpoint || "").trim(),
      apiKey: String(provider.apiKey || "").trim(),
      sslVerify: provider.sslVerify === true,
      proxyMode: ["direct", "system", "custom"].indexOf(provider.proxyMode) >= 0
        ? provider.proxyMode
        : "system",
      proxyUrl: String(provider.proxyUrl || "").trim(),
      models: (provider.models || []).map(trimModel)
    };
  }

  function normalizeModels(source) {
    if (Array.isArray(source.models) && source.models.length) {
      return source.models.map(normalizeModel);
    }

    return [
      {
        id: typeof source.modelId === "string" && source.modelId ? source.modelId : createId("model"),
        model: typeof source.model === "string" ? source.model : "",
        multimodal: source.multimodal === true
      }
    ];
  }

  function normalizeModel(model) {
    var source = model && typeof model === "object" ? model : {};
    return {
      id: typeof source.id === "string" && source.id ? source.id : createId("model"),
      model: typeof source.model === "string" ? source.model : "",
      multimodal: source.multimodal === true
    };
  }

  function trimModel(model) {
    return {
      id: model.id,
      model: String(model.model || "").trim(),
      multimodal: model.multimodal === true
    };
  }

  function normalizeChatStore(store) {
    var source = store && typeof store === "object" ? store : {};
    var assistants = Array.isArray(source.assistants)
      ? source.assistants.map(normalizeAssistant).filter(Boolean)
      : [];

    if (!assistants.length && Array.isArray(source.sessions)) {
      var migratedSessions = source.sessions.map(normalizeSession).filter(Boolean);
      if (migratedSessions.length) {
        var migratedAssistant = createAssistant();
        migratedAssistant.name = "默认助手";
        migratedAssistant.sessions = migratedSessions;
        migratedAssistant.activeSessionId =
          typeof source.activeSessionId === "string" ? source.activeSessionId : migratedSessions[0].id;
        if (!migratedSessions.some(function (session) { return session.id === migratedAssistant.activeSessionId; })) {
          migratedAssistant.activeSessionId = migratedSessions[0].id;
        }
        assistants = [migratedAssistant];
      }
    }

    var activeAssistantId =
      typeof source.activeAssistantId === "string" ? source.activeAssistantId : "";
    if (assistants.length && !assistants.some(function (assistant) { return assistant.id === activeAssistantId; })) {
      activeAssistantId = assistants[0].id;
    }

    return {
      assistants: assistants,
      activeAssistantId: assistants.length ? activeAssistantId : ""
    };
  }

  function normalizeAssistant(assistant) {
    if (!assistant || typeof assistant !== "object") {
      return null;
    }

    var sessions = Array.isArray(assistant.sessions)
      ? assistant.sessions.map(normalizeSession).filter(Boolean)
      : [];
    var activeSessionId =
      typeof assistant.activeSessionId === "string" ? assistant.activeSessionId : "";
    if (sessions.length && !sessions.some(function (session) { return session.id === activeSessionId; })) {
      activeSessionId = sessions[0].id;
    }

    return {
      id: typeof assistant.id === "string" && assistant.id ? assistant.id : createId("assistant"),
      name: typeof assistant.name === "string" && assistant.name ? assistant.name : "默认助手",
      prompt: typeof assistant.prompt === "string" ? assistant.prompt : "",
      providerId: typeof assistant.providerId === "string" ? assistant.providerId : "",
      modelId: typeof assistant.modelId === "string" ? assistant.modelId : "",
      createdAt: Number(assistant.createdAt) || Date.now(),
      updatedAt: Number(assistant.updatedAt) || Date.now(),
      activeSessionId: sessions.length ? activeSessionId : "",
      sessions: sessions
    };
  }

  function normalizeSession(session) {
    if (!session || typeof session !== "object") {
      return null;
    }
    return {
      id: typeof session.id === "string" && session.id ? session.id : createId("session"),
      title: typeof session.title === "string" && session.title ? session.title : "新会话",
      providerId: typeof session.providerId === "string" ? session.providerId : "",
      modelId: typeof session.modelId === "string" ? session.modelId : "",
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      messages: Array.isArray(session.messages)
        ? session.messages.map(normalizeMessage).filter(Boolean)
        : []
    };
  }

  function normalizeMessage(message) {
    if (!message || typeof message !== "object") {
      return null;
    }
    var role = message.role === "assistant" ? "assistant" : "user";
    return {
      id: typeof message.id === "string" && message.id ? message.id : createId("message"),
      role: role,
      content: typeof message.content === "string" ? message.content : "",
      attachments: Array.isArray(message.attachments)
        ? message.attachments.map(normalizeAttachment).filter(Boolean)
        : [],
      createdAt: Number(message.createdAt) || Date.now()
    };
  }

  function normalizeAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") {
      return null;
    }
    var kind = attachment.kind === "image" ? "image" : "document";
    return {
      id: typeof attachment.id === "string" && attachment.id ? attachment.id : createId("file"),
      kind: kind,
      name: typeof attachment.name === "string" ? attachment.name : "附件",
      mime: typeof attachment.mime === "string" ? attachment.mime : "",
      size: Number(attachment.size) || 0,
      text: typeof attachment.text === "string" ? attachment.text : "",
      dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : ""
    };
  }

  function cloneProviders(providers) {
    return providers.map(function (provider) {
      var cloned = Object.assign({}, provider);
      cloned.models = (provider.models || []).map(function (model) {
        return Object.assign({}, model);
      });
      return cloned;
    });
  }

  function createEmptyModeModels() {
    return MODEL_MODES.reduce(function (result, mode) {
      result[mode] = { providerId: "", modelId: "" };
      return result;
    }, {});
  }

  function normalizeModeModels(source, providers, fallbackSelection) {
    var result = createEmptyModeModels();
    MODEL_MODES.forEach(function (mode) {
      var item = source && typeof source === "object" ? source[mode] : null;
      var selection = {
        providerId: item && typeof item.providerId === "string" ? item.providerId : "",
        modelId: item && typeof item.modelId === "string" ? item.modelId : ""
      };
      if (!getProviderModel(selection.providerId, selection.modelId, providers)) {
        selection = fallbackSelection || { providerId: "", modelId: "" };
      }
      if (!getProviderModel(selection.providerId, selection.modelId, providers)) {
        var first = getFirstProviderModel(providers);
        selection = first
          ? { providerId: first.provider.id, modelId: first.model.id }
          : { providerId: "", modelId: "" };
      }
      result[mode] = selection;
    });
    return result;
  }

  function cloneModeModels(modeModels) {
    var result = createEmptyModeModels();
    MODEL_MODES.forEach(function (mode) {
      var item = modeModels && modeModels[mode] ? modeModels[mode] : {};
      result[mode] = {
        providerId: item.providerId || "",
        modelId: item.modelId || ""
      };
    });
    return result;
  }

  function ensureModeModels(config, providers) {
    config.modeModels = normalizeModeModels(config.modeModels, providers, null);
    return config.modeModels;
  }

  function ensureModeModel(mode, providers) {
    if (MODEL_MODES.indexOf(mode) < 0) {
      return;
    }
    if (!state.config.modeModels) {
      state.config.modeModels = createEmptyModeModels();
    }
    var selection = state.config.modeModels[mode] || { providerId: "", modelId: "" };
    if (getProviderModel(selection.providerId, selection.modelId, providers)) {
      return;
    }
    var first = getFirstProviderModel(providers);
    state.config.modeModels[mode] = first
      ? { providerId: first.provider.id, modelId: first.model.id }
      : { providerId: "", modelId: "" };
  }

  function formatModelValue(providerId, modelId) {
    if (!providerId || !modelId) {
      return "";
    }
    return providerId + "::" + modelId;
  }

  function parseModelValue(value) {
    var parts = String(value || "").split("::");
    return {
      providerId: parts[0] || "",
      modelId: parts[1] || ""
    };
  }

  function modelSelectionExists(providers, value) {
    var selection = parseModelValue(value);
    return !!getProviderModel(selection.providerId, selection.modelId, providers);
  }

  function getFirstProviderModel(providers) {
    for (var index = 0; index < providers.length; index += 1) {
      var provider = providers[index];
      if (provider.models && provider.models.length) {
        return { provider: provider, model: provider.models[0] };
      }
    }
    return null;
  }

  function getFirstResolvedProviderModel(providers) {
    var first = getFirstProviderModel(providers || []);
    return first
      ? getProviderModel(first.provider.id, first.model.id, providers)
      : null;
  }

  function countModels(providers) {
    return providers.reduce(function (total, provider) {
      return total + ((provider.models && provider.models.length) || 0);
    }, 0);
  }

  function getProviderModel(providerId, modelId, providers) {
    var provider = (providers || []).find(function (item) {
      return item.id === providerId;
    });
    if (!provider) {
      return null;
    }
    var model = modelId
      ? (provider.models || []).find(function (item) {
          return item.id === modelId;
        })
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

  function mergeFetchedModels(provider, names) {
    var fetchedNames = normalizeFetchedModelNames(names);
    if (!provider || !fetchedNames.length) {
      return 0;
    }

    var seen = {};
    var nextModels = [];
    var addedCount = 0;
    (provider.models || []).forEach(function (model) {
      var name = String(model.model || "").trim();
      if (!name || seen[name]) {
        return;
      }
      model.model = name;
      seen[name] = true;
      nextModels.push(model);
    });

    var pendingNames = fetchedNames.filter(function (name) {
      return !seen[name];
    });
    (provider.models || []).forEach(function (model) {
      if (String(model.model || "").trim() || !pendingNames.length) {
        return;
      }
      var name = pendingNames.shift();
      model.model = name;
      seen[name] = true;
      nextModels.push(model);
      addedCount += 1;
    });

    pendingNames.forEach(function (name) {
      var model = createModel();
      model.model = name;
      nextModels.push(model);
      addedCount += 1;
    });

    provider.models = nextModels.length ? nextModels : [createModel()];
    ensureModeModels(state.config, state.draftProviders);
    return addedCount;
  }

  function normalizeFetchedModelNames(names) {
    var seen = {};
    return (names || [])
      .map(function (name) {
        return String(name || "").trim();
      })
      .filter(function (name) {
        if (!name || seen[name]) {
          return false;
        }
        seen[name] = true;
        return true;
      });
  }

  function cloneAttachmentsForRequest(attachments) {
    return attachments.map(function (attachment) {
      return Object.assign({}, attachment);
    });
  }

  function sanitizeAttachmentsForStorage(attachments) {
    return attachments.map(function (attachment) {
      return {
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        text: attachment.kind === "document" ? attachment.text || "" : "",
        dataUrl: attachment.kind === "image" ? attachment.dataUrl || "" : ""
      };
    });
  }

  function cloneMessage(message) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      attachments: cloneAttachmentsForRequest(message.attachments || []),
      createdAt: message.createdAt
    };
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-showing");
    state.toastTimer = window.setTimeout(function () {
      els.toast.classList.remove("is-showing");
    }, 2600);
  }

  function getErrorMessage(error) {
    if (!error) {
      return "未知错误";
    }
    return error.message || String(error);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value || "").replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function createBrowserFallbackApi() {
    return {
      getConfig: function () {
        try {
          return JSON.parse(
            localStorage.getItem(CONFIG_STORAGE_KEY) ||
              localStorage.getItem(LEGACY_CONFIG_STORAGE_KEY) ||
              "{}"
          );
        } catch (error) {
          return {};
        }
      },
      saveConfig: function (config) {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
        return config;
      },
      getChatStore: function () {
        try {
          return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "{}");
        } catch (error) {
          return {};
        }
      },
      saveChatStore: function (store) {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
        return store;
      },
      runTask: function () {
        return Promise.reject(new Error("请在 uTools 中运行插件"));
      },
      sendChat: function () {
        return Promise.reject(new Error("请在 uTools 中运行插件"));
      },
      fetchModels: function () {
        return Promise.reject(new Error("请在 uTools 中运行插件"));
      },
      abortActive: function () {},
      copyText: function (text) {
        return navigator.clipboard.writeText(text);
      }
    };
  }
})();
