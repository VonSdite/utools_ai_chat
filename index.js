(function () {
  "use strict";

  var CONFIG_STORAGE_KEY = "ai-agent/local-config";
  var CHAT_STORAGE_KEY = "ai-agent/local-chats";
  var DEFAULT_DATA_DIR = "D:\\utools_ai_agent";
  var EMPTY_RESULT_PLACEHOLDER = "等你投喂一点内容，我来认真变魔法。";
  var PROCESSING_PLACEHOLDER = "我正在把想法揉成答案...";
  var DEFAULT_RECENT_CLIPBOARD_MS = 2000;
  var DEFAULT_CLIPBOARD_POLL_MS = 500;
  var SEARCH_RESULT_LIMIT = 30;
  var SEARCH_DEBOUNCE_MS = 120;
  var MAX_CHAT_RUNS = 3;
  var TASKS = {
    translate: { title: "翻译", action: "翻译", placeholder: "把小纸条放这里，我来认真读" },
    summary: { title: "总结", action: "总结", placeholder: "把长长的内容放这里，我来帮你收成重点" },
    explain: { title: "解释", action: "解释", placeholder: "把想弄懂的东西放这里，我来慢慢讲清楚" },
    ocr: { title: "OCR", action: "OCR", placeholder: "把图片贴过来，我来帮你认字", requiresMultimodal: true }
  };
  var MODEL_MODES = ["translate", "summary", "explain", "ocr", "chat"];
  var TEXT_EXTENSIONS = [
    "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml",
    "xml", "html", "htm", "log", "ini", "conf", "js", "jsx", "ts", "tsx",
    "css", "scss", "less", "py", "java", "go", "rs", "c", "cpp", "h", "hpp",
    "cs", "php", "rb", "sh", "bat", "ps1", "sql"
  ];
  var MAX_TEXT_ATTACHMENT_CHARS = 60000;
  var MAX_ATTACHMENTS = 3;
  var api = window.markMind || window.quickEnglish || createBrowserFallbackApi();
  var markdownRenderer = createMarkdownRenderer();
  var state = {
    config: {
      providers: [],
      modeModels: createEmptyModeModels(),
      dataDir: DEFAULT_DATA_DIR,
      recentClipboardMs: DEFAULT_RECENT_CLIPBOARD_MS,
      clipboardPollingMs: DEFAULT_CLIPBOARD_POLL_MS
    },
    draftProviders: [],
    activeTab: "chat",
    activeTaskMode: "translate",
    taskAttachments: [],
    chatAttachments: [],
    chatStore: { assistants: [], activeAssistantId: "" },
    assistantsOpen: false,
    currentResult: "",
    running: false,
    chatRuns: {},
    chatSidebarCollapsed: true,
    fetchingModelsProviderId: "",
    expandedProviderIds: {},
    draggingProviderId: "",
    modelPicker: null,
    modelPickerPreviousFocus: null,
    providerDialogDraft: null,
    providerDialogPreviousFocus: null,
    chatSearchIndex: null,
    chatSearchPreviousFocus: null,
    chatSearchTimer: 0,
    chatSearchVisibleLimit: SEARCH_RESULT_LIMIT,
    searchHighlightTimer: 0,
    confirmResolver: null,
    confirmPreviousFocus: null,
    settingsSaveToken: 0,
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
    renderTaskModeButtons();
    renderTaskPlaceholder(EMPTY_RESULT_PLACEHOLDER);
    updateViewTitle();
    renderChatSidebarState();

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
    els.viewTitle = document.getElementById("viewTitle");
    els.chatSearchBtn = document.getElementById("chatSearchBtn");
    els.inputText = document.getElementById("inputText");
    els.resultText = document.getElementById("resultText");
    els.taskAttachments = document.getElementById("taskAttachments");
    els.taskFileInput = document.getElementById("taskFileInput");
    els.taskAttachBtn = document.getElementById("taskAttachBtn");
    els.taskModelSelect = document.getElementById("taskModelSelect");
    els.taskModeBtns = Array.from(document.querySelectorAll("[data-task-mode]"));
    els.sendTaskBtn = document.getElementById("sendTaskBtn");
    els.stopTaskBtn = document.getElementById("stopTaskBtn");
    els.clearTaskBtn = document.getElementById("clearTaskBtn");
    els.copyTaskBtn = document.getElementById("copyTaskBtn");
    els.continueChatBtn = document.getElementById("continueChatBtn");
    els.sideTabs = Array.from(document.querySelectorAll(".side-tab"));
    els.taskView = document.getElementById("taskView");
    els.chatView = document.getElementById("chatView");
    els.chatSidebarToggleBtn = document.getElementById("chatSidebarToggleBtn");
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
    els.clearContextBtn = document.getElementById("clearContextBtn");
    els.sendChatBtn = document.getElementById("sendChatBtn");
    els.stopChatBtn = document.getElementById("stopChatBtn");
    els.dataDirInput = document.getElementById("dataDirInput");
    els.clipboardWindowInput = document.getElementById("clipboardWindowInput");
    els.clipboardPollingInput = document.getElementById("clipboardPollingInput");
    els.chooseDataDirBtn = document.getElementById("chooseDataDirBtn");
    els.addProviderBtn = document.getElementById("addProviderBtn");
    els.providersList = document.getElementById("providersList");
    els.providerDialogOverlay = document.getElementById("providerDialogOverlay");
    els.providerDialogName = document.getElementById("providerDialogName");
    els.providerDialogEndpoint = document.getElementById("providerDialogEndpoint");
    els.providerDialogApiKey = document.getElementById("providerDialogApiKey");
    els.providerDialogModelsList = document.getElementById("providerDialogModelsList");
    els.providerDialogFetchModelsBtn = document.getElementById("providerDialogFetchModelsBtn");
    els.providerDialogAddModelBtn = document.getElementById("providerDialogAddModelBtn");
    els.providerDialogCloseBtn = document.getElementById("providerDialogCloseBtn");
    els.providerDialogCancelBtn = document.getElementById("providerDialogCancelBtn");
    els.providerDialogCreateBtn = document.getElementById("providerDialogCreateBtn");
    els.confirmOverlay = document.getElementById("confirmOverlay");
    els.confirmTitle = document.getElementById("confirmTitle");
    els.confirmMessage = document.getElementById("confirmMessage");
    els.confirmCancelBtn = document.getElementById("confirmCancelBtn");
    els.confirmOkBtn = document.getElementById("confirmOkBtn");
    els.modelPickerOverlay = document.getElementById("modelPickerOverlay");
    els.imagePreviewOverlay = document.getElementById("imagePreviewOverlay");
    els.imagePreviewImg = document.getElementById("imagePreviewImg");
    els.imagePreviewCloseBtn = document.getElementById("imagePreviewCloseBtn");
    els.chatSearchOverlay = document.getElementById("chatSearchOverlay");
    els.chatSearchCloseBtn = document.getElementById("chatSearchCloseBtn");
    els.chatSearchInput = document.getElementById("chatSearchInput");
    els.chatSearchMeta = document.getElementById("chatSearchMeta");
    els.chatSearchResults = document.getElementById("chatSearchResults");
    els.toast = document.getElementById("toast");
  }

  function bindEvents() {
    els.sendTaskBtn.addEventListener("click", startTask);
    els.stopTaskBtn.addEventListener("click", stopActiveRequest);
    els.clearTaskBtn.addEventListener("click", clearTask);
    els.copyTaskBtn.addEventListener("click", copyTaskResult);
    els.continueChatBtn.addEventListener("click", continueTaskInChat);
    els.taskAttachBtn.addEventListener("click", function () {
      chooseAttachmentFiles("task");
    });
    els.taskFileInput.addEventListener("change", function (event) {
      addFiles("task", event.target.files);
      event.target.value = "";
    });
    els.taskAttachments.addEventListener("click", handleAttachmentClick);
    els.taskModelSelect.addEventListener("change", function (event) {
      updateModeModel(state.activeTaskMode, event.target.value);
    });
    els.taskModeBtns.forEach(function (button) {
      button.addEventListener("click", function () {
        setTaskMode(button.dataset.taskMode);
      });
    });
    els.inputText.addEventListener("keydown", function (event) {
      handleSubmitKeydown(event, startTask);
    });
    els.inputText.addEventListener("input", updateContinueChatButton);
    els.inputText.addEventListener("paste", handleTaskPaste);

    els.newSessionBtn.addEventListener("click", createNewSession);
    els.chatSidebarToggleBtn.addEventListener("click", toggleChatSidebar);
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
    els.stopChatBtn.addEventListener("click", stopActiveChatRequest);
    els.clearContextBtn.addEventListener("click", clearChatContext);
    els.chatAttachBtn.addEventListener("click", function () {
      chooseAttachmentFiles("chat");
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
    els.messagesList.addEventListener("click", handleCodeCopyClick);
    els.resultText.addEventListener("click", handleCodeCopyClick);
    els.chatSearchBtn.addEventListener("click", openChatSearch);
    els.chatSearchCloseBtn.addEventListener("click", function () {
      closeChatSearch(true);
    });
    els.chatSearchInput.addEventListener("input", scheduleChatSearch);
    els.chatSearchInput.addEventListener("keydown", handleChatSearchKeydown);
    els.chatSearchOverlay.addEventListener("click", handleChatSearchClick);
    els.imagePreviewOverlay.addEventListener("click", function (event) {
      if (event.target === els.imagePreviewOverlay) {
        closeImagePreview();
      }
    });
    els.imagePreviewCloseBtn.addEventListener("click", closeImagePreview);

    els.dataDirInput.addEventListener("focusout", saveDataDirSetting);
    els.dataDirInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        els.dataDirInput.blur();
      }
    });
    els.clipboardWindowInput.addEventListener("focusout", saveClipboardWindowSetting);
    els.clipboardWindowInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        els.clipboardWindowInput.blur();
      }
    });
    els.clipboardPollingInput.addEventListener("focusout", saveClipboardPollingSetting);
    els.clipboardPollingInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        els.clipboardPollingInput.blur();
      }
    });
    els.chooseDataDirBtn.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    els.chooseDataDirBtn.addEventListener("click", chooseDataDir);
    els.addProviderBtn.addEventListener("click", addProvider);
    els.providersList.addEventListener("input", handleProviderInput);
    els.providersList.addEventListener("change", handleProviderCommit);
    els.providersList.addEventListener("focusout", handleProviderCommit);
    els.providersList.addEventListener("click", handleProviderClick);
    els.providersList.addEventListener("dragstart", handleProviderDragStart);
    els.providersList.addEventListener("dragover", handleProviderDragOver);
    els.providersList.addEventListener("drop", handleProviderDrop);
    els.providersList.addEventListener("dragend", handleProviderDragEnd);
    els.modelPickerOverlay.addEventListener("click", handleModelPickerClick);
    els.modelPickerOverlay.addEventListener("input", handleModelPickerInput);
    els.modelPickerOverlay.addEventListener("change", handleModelPickerChange);
    els.providerDialogCloseBtn.addEventListener("click", closeProviderDialog);
    els.providerDialogCancelBtn.addEventListener("click", closeProviderDialog);
    els.providerDialogCreateBtn.addEventListener("click", submitProviderDialog);
    els.providerDialogFetchModelsBtn.addEventListener("click", fetchProviderDialogModels);
    els.providerDialogAddModelBtn.addEventListener("click", addProviderDialogModel);
    els.providerDialogOverlay.addEventListener("input", handleProviderDialogModelInput);
    els.providerDialogOverlay.addEventListener("change", handleProviderDialogModelInput);
    els.providerDialogOverlay.addEventListener("click", function (event) {
      if (event.target === els.providerDialogOverlay) {
        closeProviderDialog();
        return;
      }
      if (event.target.closest("button[data-action='delete-model']")) {
        deleteProviderDialogModel(event.target.closest(".model-row"));
      }
    });
    els.providerDialogName.addEventListener("keydown", handleProviderDialogKeydown);
    els.providerDialogEndpoint.addEventListener("keydown", handleProviderDialogKeydown);
    els.providerDialogApiKey.addEventListener("keydown", handleProviderDialogKeydown);
    els.confirmCancelBtn.addEventListener("click", function () {
      closeConfirmDialog(false);
    });
    els.confirmOkBtn.addEventListener("click", function () {
      closeConfirmDialog(true);
    });
    els.confirmOverlay.addEventListener("click", function (event) {
      if (event.target === els.confirmOverlay) {
        closeConfirmDialog(false);
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") {
        return;
      }
      if (!els.imagePreviewOverlay.hidden) {
        closeImagePreview();
        return;
      }
      if (!els.chatSearchOverlay.hidden) {
        closeChatSearch(true);
        return;
      }
      if (state.modelPicker) {
        closeModelPicker();
        return;
      }
      if (!els.providerDialogOverlay.hidden) {
        closeProviderDialog();
        return;
      }
      if (state.confirmResolver) {
        closeConfirmDialog(false);
      }
    });

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
      showToast("读取会话失败：" + getErrorMessage(error));
    }
  }

  async function handlePluginEnter(action) {
    if (!action) {
      return;
    }

    var tab = tabFromEnterAction(action);
    setTab(tab);

    if (tab === "settings") {
      return;
    }

    var payload = await getEnterPayload(action, tab);
    if (tab === "chat") {
      if (payload.text) {
        els.chatInput.value = payload.text;
      }
      if (payload.image) {
        addPreparedAttachments("chat", [payload.image]);
      }
      window.setTimeout(function () {
        els.chatInput.focus();
      }, 0);
      return;
    }

    if (payload.text) {
      els.inputText.value = payload.text;
    }
    var addedImages = payload.image ? addPreparedAttachments("task", [payload.image]) : 0;
    if (payload.text || addedImages) {
      startTask();
      return;
    }

    window.setTimeout(function () {
      els.inputText.focus();
    }, 0);
  }

  function tabFromEnterAction(action) {
    var commandTab = action && action.type !== "over"
      ? tabFromCommandText(extractActionCommandText(action))
      : "";
    if (commandTab) {
      return commandTab;
    }
    return tabFromActionCode(action && action.code) || "translate";
  }

  function tabFromActionCode(code) {
    var value = String(code || "").trim().toLowerCase();
    if (value === "ai-agent-translate" || value === "markmind-translate" || value === "translate") {
      return "translate";
    }
    if (value === "ai-agent-summary" || value === "markmind-summary" || value === "summary") {
      return "summary";
    }
    if (value === "ai-agent-explain" || value === "markmind-explain" || value === "explain") {
      return "explain";
    }
    if (value === "ai-agent-ocr" || value === "ocr") {
      return "ocr";
    }
    if (
      value === "ai-agent-chat" ||
      value === "ai-agent-chat-explicit" ||
      value === "markmind-chat" ||
      value === "chat"
    ) {
      return "chat";
    }
    if (value === "ai-agent-settings" || value === "markmind-settings" || value === "settings") {
      return "settings";
    }
    return "";
  }

  function extractActionCommandText(action) {
    var values = [
      action && action.keyword,
      action && action.cmd,
      action && action.name,
      action && action.label,
      extractOptionText(action && action.option),
      extractPayloadText(action && action.payload)
    ];
    for (var index = 0; index < values.length; index += 1) {
      var value = String(values[index] || "").trim();
      if (value) {
        return value;
      }
    }
    return "";
  }

  function extractOptionText(option) {
    if (typeof option === "string") {
      return option.trim();
    }
    if (option && typeof option === "object") {
      return String(option.keyword || option.cmd || option.label || option.name || option.title || "").trim();
    }
    return "";
  }

  function tabFromCommandText(text) {
    var value = normalizeCommandText(text);
    if (!value) {
      return "";
    }
    if (value === "翻译" || value === "ai翻译" || value === "aiagent翻译") {
      return "translate";
    }
    if (value === "总结" || value === "ai总结" || value === "aiagent总结") {
      return "summary";
    }
    if (value === "解释" || value === "ai解释" || value === "aiagent解释") {
      return "explain";
    }
    if (value === "ocr" || value === "aiocr" || value === "aiagentocr") {
      return "ocr";
    }
    if (value === "aiagent" || value === "ai对话" || value === "aiagent对话" || value === "对话") {
      return "chat";
    }
    return "";
  }

  function normalizeCommandText(text) {
    return String(text || "").toLowerCase().replace(/[\s_-]+/g, "");
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

  async function getEnterPayload(action, tab) {
    var selectedText = action.type === "over" ? extractPayloadText(action.payload) : "";
    if (tab === "ocr") {
      return {
        text: "",
        image: selectedText ? null : await readRecentClipboardImage()
      };
    }
    var image = selectedText ? null : await readRecentClipboardImage();
    return {
      text: selectedText || (await readRecentClipboardText()),
      image: image
    };
  }

  async function readRecentClipboardText() {
    if (!api.getRecentClipboardText) {
      return "";
    }
    try {
      var maxAgeMs = normalizeRecentClipboardMs(state.config.recentClipboardMs);
      return String((await api.getRecentClipboardText(maxAgeMs)) || "").trim();
    } catch (error) {
      return "";
    }
  }

  async function readRecentClipboardImage() {
    if (!api.getRecentClipboardImage) {
      return null;
    }
    try {
      var maxAgeMs = normalizeRecentClipboardMs(state.config.recentClipboardMs);
      return normalizePreparedAttachment(await api.getRecentClipboardImage(maxAgeMs));
    } catch (error) {
      return null;
    }
  }

  function setTab(tabName) {
    var nextTab = tabName;
    if (TASKS[tabName]) {
      state.activeTaskMode = tabName;
      nextTab = "task";
    }
    if (nextTab !== "task" && nextTab !== "chat" && nextTab !== "settings") {
      nextTab = "task";
    }
    state.activeTab = nextTab;

    els.sideTabs.forEach(function (tab) {
      tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
    });
    els.taskView.classList.toggle("is-active", state.activeTab === "task");
    els.chatView.classList.toggle("is-active", state.activeTab === "chat");
    els.settingsView.classList.toggle("is-active", state.activeTab === "settings");
    renderTaskModeButtons();
    updateViewTitle();
    renderTaskModelSelect();
    renderChatModelSelect();
    renderChatRunControls();
    renderChatSidebarState();
  }

  function toggleChatSidebar() {
    state.chatSidebarCollapsed = !state.chatSidebarCollapsed;
    renderChatSidebarState();
  }

  function renderChatSidebarState() {
    if (!els.chatView || !els.chatSidebarToggleBtn) {
      return;
    }

    var collapsed = Boolean(state.chatSidebarCollapsed);
    els.chatView.classList.toggle("is-sidebar-collapsed", collapsed);
    els.chatSidebarToggleBtn.title = collapsed ? "显示侧边栏" : "隐藏侧边栏";
    els.chatSidebarToggleBtn.setAttribute("aria-label", collapsed ? "显示侧边栏" : "隐藏侧边栏");
    els.chatSidebarToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setTaskMode(mode) {
    if (!TASKS[mode]) {
      return;
    }
    state.activeTaskMode = mode;
    if (state.activeTab !== "task") {
      state.activeTab = "task";
    }
    renderTaskModeButtons();
    updateViewTitle();
    renderTaskModelSelect();
    updateTaskFileAccept();
  }

  function renderTaskModeButtons() {
    els.taskModeBtns.forEach(function (button) {
      var active = button.dataset.taskMode === state.activeTaskMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    updateTaskInputPlaceholder();
  }

  function updateTaskInputPlaceholder() {
    var task = TASKS[state.activeTaskMode] || TASKS.translate;
    els.inputText.placeholder = task.placeholder;
  }

  function updateTaskFileAccept() {
    if (els.taskFileInput) {
      els.taskFileInput.accept = isOcrTaskMode() ? "image/*" : "";
    }
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
    if (els.chatSearchBtn) {
      els.chatSearchBtn.hidden = state.activeTab !== "chat";
    }
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
      showToast(mode === "ocr" ? "先配置一个多模态模型" : "先配置一个模型");
      setTab("settings");
      return;
    }

    if (mode === "ocr" && !hasImageAttachments(state.taskAttachments)) {
      showToast("先贴一张图片给 OCR");
      return;
    }

    state.running = true;
    state.currentResult = "";
    renderTaskPlaceholder(PROCESSING_PLACEHOLDER, true);
    els.sendTaskBtn.disabled = true;
    els.stopTaskBtn.disabled = false;
    els.copyTaskBtn.disabled = true;
    updateContinueChatButton();

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
      updateContinueChatButton();
    }
  }

  function handleTaskEvent(event, provider) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "status") {
      return;
    }

    if (event.type === "delta") {
      state.currentResult += event.text || "";
      renderTaskResult(state.currentResult);
      els.resultText.scrollTop = els.resultText.scrollHeight;
      updateContinueChatButton();
      return;
    }

    if (event.type === "done") {
      if (event.text && !state.currentResult) {
        state.currentResult = event.text;
        renderTaskResult(state.currentResult);
      }
      els.copyTaskBtn.disabled = !state.currentResult;
      updateContinueChatButton();
      return;
    }

    if (event.type === "error") {
      handleTaskError(new Error(event.message || "请求失败"));
    }
  }

  function handleTaskError(error) {
    var message = getErrorMessage(error);
    renderTaskResult("这次没有成功：\n" + message);
    showToast(message);
  }

  function stopActiveRequest() {
    if (api.abortActive) {
      api.abortActive();
    }
    state.running = false;
    els.sendTaskBtn.disabled = false;
    els.stopTaskBtn.disabled = true;
    renderChatRunControls();
    if (!state.currentResult && els.resultText.classList.contains("is-processing")) {
      renderTaskPlaceholder(EMPTY_RESULT_PLACEHOLDER);
    }
    updateContinueChatButton();
  }

  function stopActiveChatRequest() {
    var session = getActiveSession();
    var run = session ? getChatRunForSession(session.id) : null;
    if (!run) {
      renderChatRunControls();
      return;
    }
    abortChatRun(run.requestId);
  }

  function clearTask() {
    if (getChatRunForSession(session.id)) {
      stopActiveChatRequest();
    }
    els.inputText.value = "";
    state.taskAttachments = [];
    state.currentResult = "";
    renderTaskPlaceholder(EMPTY_RESULT_PLACEHOLDER);
    els.copyTaskBtn.disabled = true;
    updateContinueChatButton();
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

  function renderTaskResult(text) {
    els.resultText.classList.remove("is-placeholder", "is-processing");
    els.resultText.innerHTML = renderMarkdown(text);
  }

  function renderTaskPlaceholder(text, processing) {
    els.resultText.classList.add("is-placeholder");
    els.resultText.classList.toggle("is-processing", processing === true);
    els.resultText.innerHTML = processing
      ? '<span class="task-waiting">' +
        '<span class="task-loader" aria-hidden="true"><span></span><span></span><span></span></span>' +
        '<span class="result-placeholder">' +
        escapeHtml(text) +
        "</span></span>"
      : '<span class="result-placeholder">' + escapeHtml(text) + "</span>";
  }

  function updateContinueChatButton() {
    var hasInput = Boolean(els.inputText.value.trim() || state.taskAttachments.length);
    els.continueChatBtn.hidden = state.running || !state.currentResult || !hasInput;
  }

  async function continueTaskInChat() {
    var text = els.inputText.value.trim();
    var result = state.currentResult.trim();
    var attachments = cloneAttachmentsForRequest(state.taskAttachments);
    var provider = getActiveProvider();

    if (!result || (!text && !attachments.length)) {
      updateContinueChatButton();
      return;
    }

    ensureActiveAssistantAndSession();
    var assistant = getActiveAssistant();
    if (!assistant) {
      showToast("没有可用对话");
      return;
    }

    var session = getReusableContinuationSession(assistant);
    session.providerId = provider ? provider.id : session.providerId;
    session.modelId = provider ? provider.modelId : session.modelId;
    session.title = createSessionTitle(text, attachments);
    session.messages = [
      createMessage("user", text, sanitizeAttachmentsForStorage(attachments)),
      createMessage("assistant", result, [])
    ];
    session.updatedAt = Date.now();
    assistant.activeSessionId = session.id;

    state.taskAttachments = [];
    state.currentResult = "";
    els.inputText.value = "";
    renderAttachments("task");
    renderTaskPlaceholder(EMPTY_RESULT_PLACEHOLDER);
    els.copyTaskBtn.disabled = true;
    updateContinueChatButton();
    await saveChatStoreQuietly({ showError: true });
    setTab("chat");
    renderChat();
    window.setTimeout(function () {
      els.chatInput.focus();
    }, 0);
  }

  function getReusableContinuationSession(assistant) {
    var session = getActiveSession();
    if (session && session.messages && !session.messages.length) {
      return session;
    }

    session = createSession();
    assistant.sessions.unshift(session);
    return session;
  }

  async function chooseAttachmentFiles(target) {
    if (!api.chooseAttachmentFiles) {
      if (target === "chat") {
        els.chatFileInput.click();
      } else {
        els.taskFileInput.accept = isOcrTaskMode() ? "image/*" : "";
        els.taskFileInput.click();
      }
      return;
    }

    try {
      var result = await api.chooseAttachmentFiles({ imagesOnly: target === "task" && isOcrTaskMode() });
      showAttachmentErrors((result && result.errors) || []);
      addPreparedAttachments(target, (result && result.attachments) || []);
    } catch (error) {
      showToast("选择附件失败：" + getErrorMessage(error));
    }
  }

  function showAttachmentErrors(errors) {
    if (!errors.length) {
      return;
    }
    showToast(errors[0] + (errors.length > 1 ? " 等 " + errors.length + " 个文件未读取" : ""));
  }

  function addPreparedAttachments(target, attachments) {
    var prepared = (attachments || []).map(normalizePreparedAttachment).filter(Boolean);
    if (!prepared.length) {
      return 0;
    }

    var provider = target === "chat" ? getChatProvider(getActiveAssistant()) : getActiveProvider();
    var existingAttachments = target === "chat" ? state.chatAttachments : state.taskAttachments;
    var attachmentSlots = getRemainingAttachmentSlots(existingAttachments);
    var nextAttachments = [];

    prepared.forEach(function (attachment) {
      if (attachmentSlots <= 0) {
        showToast("最多附加 " + MAX_ATTACHMENTS + " 个附件");
        return;
      }
      if (target === "task" && isOcrTaskMode() && attachment.kind !== "image") {
        showToast("OCR 只能添加图片");
        return;
      }
      if (attachment.kind === "image") {
        if (!provider || provider.multimodal !== true) {
          showToast(target === "task" && state.activeTaskMode === "ocr"
            ? "先配置一个多模态模型"
            : "这个模型未开启多模态，图片先不发送");
          return;
        }
      }
      nextAttachments.push(attachment);
      attachmentSlots -= 1;
    });

    appendAttachments(target, nextAttachments);
    return nextAttachments.length;
  }

  function normalizePreparedAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") {
      return null;
    }
    var kind = attachment.kind === "image" ? "image" : "document";
    return {
      id: attachment.id || createId("file"),
      kind: kind,
      name: attachment.name || "附件",
      mime: attachment.mime || (kind === "image" ? "image/png" : "text/plain"),
      size: Number(attachment.size) || 0,
      text: kind === "document" ? String(attachment.text || "") : "",
      dataUrl: kind === "image" ? String(attachment.dataUrl || "") : ""
    };
  }

  function appendAttachments(target, nextAttachments) {
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
    updateContinueChatButton();
  }

  async function addFiles(target, fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }

    var provider = target === "chat" ? getChatProvider(getActiveAssistant()) : getActiveProvider();
    var existingAttachments = target === "chat" ? state.chatAttachments : state.taskAttachments;
    var attachmentSlots = getRemainingAttachmentSlots(existingAttachments);
    var nextAttachments = [];

    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      if (attachmentSlots <= 0) {
        showToast("最多附加 " + MAX_ATTACHMENTS + " 个附件");
        continue;
      }
      if (target === "task" && isOcrTaskMode() && !/^image\//i.test(file.type || "")) {
        showToast("OCR 只能添加图片");
        continue;
      }
      try {
        var attachment = await prepareAttachment(file, provider);
        if (attachment) {
          nextAttachments.push(attachment);
          attachmentSlots -= 1;
        }
      } catch (error) {
        showToast(file.name + "：" + getErrorMessage(error));
      }
    }

    appendAttachments(target, nextAttachments);
  }

  function getRemainingAttachmentSlots(attachments) {
    return Math.max(0, MAX_ATTACHMENTS - attachments.length);
  }

  function hasImageAttachments(attachments) {
    return (attachments || []).some(function (attachment) {
      return attachment.kind === "image" && attachment.dataUrl;
    });
  }

  function isOcrTaskMode() {
    return state.activeTaskMode === "ocr";
  }

  function handleChatPaste(event) {
    var imageFiles = getClipboardImageFiles(event);
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    addFiles("chat", imageFiles);
  }

  function handleTaskPaste(event) {
    var imageFiles = getClipboardImageFiles(event);
    if (!imageFiles.length) {
      return;
    }

    var provider = getActiveProvider();
    if (!provider || provider.multimodal !== true) {
      return;
    }

    event.preventDefault();
    addFiles("task", imageFiles);
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
        if (file && !isClipboardFilePath(file)) {
          files.push(normalizeClipboardImageFile(file, index));
        }
      });
    }

    return files;
  }

  function isClipboardFilePath(file) {
    return Boolean(file && typeof file.path === "string" && file.path);
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
    if (button) {
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
      updateContinueChatButton();
      return;
    }

    var preview = event.target.closest("[data-preview-image-id]");
    if (preview) {
      openImagePreview(preview.dataset.target, preview.dataset.previewImageId);
    }
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
          '<span class="attachment-file-icon" aria-hidden="true"></span>' +
          '<span title="' +
          escapeAttr(attachment.name) +
          '">' +
          escapeHtml(attachment.name) +
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
      '<span class="attachment-preview" role="button" tabindex="0" data-target="' +
      escapeAttr(target) +
      '" data-preview-image-id="' +
      escapeAttr(attachment.id) +
      '">' +
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

  function openImagePreview(target, attachmentId) {
    var attachments = target === "chat" ? state.chatAttachments : state.taskAttachments;
    var attachment = attachments.find(function (item) {
      return item.id === attachmentId && item.kind === "image" && item.dataUrl;
    });
    if (!attachment) {
      return;
    }
    els.imagePreviewImg.src = attachment.dataUrl;
    els.imagePreviewImg.alt = attachment.name || "图片";
    els.imagePreviewOverlay.hidden = false;
  }

  function closeImagePreview() {
    els.imagePreviewOverlay.hidden = true;
    els.imagePreviewImg.removeAttribute("src");
    els.imagePreviewImg.alt = "";
  }

  function renderChat() {
    ensureActiveAssistantAndSession();
    renderAssistantPanelState();
    renderAssistants();
    renderAssistantEditor();
    renderChatModelSelect();
    renderSessions();
    renderMessages();
    renderChatRunControls();
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
      els.currentAssistantName.textContent = getAssistantDisplayName(activeAssistant);
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
          escapeHtml(getAssistantDisplayName(assistant)) +
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

    if (!countModels(providers, mode)) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = modeRequiresMultimodal(mode) ? "未配置多模态模型" : "未配置模型";
      selectEl.appendChild(emptyOption);
      selectEl.disabled = true;
      return;
    }

    selectEl.disabled = false;
    providers.forEach(function (provider) {
      provider.models.forEach(function (model) {
        if (!modelAllowedForMode(model, mode)) {
          return;
        }
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
    if (!selected || !getProviderModel(selected.providerId, selected.modelId, providers, mode)) {
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
    if (!getProviderModel(selection.providerId, selection.modelId, providers, mode)) {
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
    saveConfigQuietly();
  }

  function renderSessions() {
    var assistant = getActiveAssistant();
    var sessions = assistant ? assistant.sessions : [];
    els.sessionsList.innerHTML = sessions
      .map(function (session) {
        var activeClass = assistant && session.id === assistant.activeSessionId ? " is-active" : "";
        var unreadClass = session.unreadCompleted ? " has-unread" : "";
        var runningClass = getChatRunForSession(session.id) ? " is-running" : "";
        return (
          '<div class="session-item' +
          activeClass +
          unreadClass +
          runningClass +
          '" data-session-id="' +
          escapeAttr(session.id) +
          '">' +
          '<button class="session-title" type="button" data-action="select-session">' +
          '<span class="session-unread-dot" aria-hidden="true"></span>' +
          '<span class="session-title-text">' +
          escapeHtml(session.title || "新会话") +
          "</span>" +
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

  function openChatSearch() {
    state.chatSearchPreviousFocus = document.activeElement;
    if (!state.chatSearchIndex) {
      state.chatSearchIndex = buildChatSearchIndex();
    }
    state.chatSearchVisibleLimit = SEARCH_RESULT_LIMIT;
    els.chatSearchInput.value = "";
    els.chatSearchOverlay.hidden = false;
    renderChatSearchResults();
    window.setTimeout(function () {
      els.chatSearchInput.focus();
    }, 0);
  }

  function closeChatSearch(restoreFocus) {
    if (els.chatSearchOverlay.hidden) {
      return;
    }

    window.clearTimeout(state.chatSearchTimer);
    els.chatSearchOverlay.hidden = true;
    els.chatSearchInput.value = "";
    els.chatSearchResults.innerHTML = "";
    els.chatSearchMeta.textContent = "";
    state.chatSearchVisibleLimit = SEARCH_RESULT_LIMIT;

    var previousFocus = state.chatSearchPreviousFocus;
    state.chatSearchPreviousFocus = null;
    if (restoreFocus && previousFocus && previousFocus.focus) {
      try {
        previousFocus.focus();
      } catch (error) {
        // The previous element may have been removed while jumping to a result.
      }
    }
  }

  function scheduleChatSearch() {
    window.clearTimeout(state.chatSearchTimer);
    state.chatSearchVisibleLimit = SEARCH_RESULT_LIMIT;
    state.chatSearchTimer = window.setTimeout(renderChatSearchResults, SEARCH_DEBOUNCE_MS);
  }

  function handleChatSearchKeydown(event) {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }

    var firstResult = els.chatSearchResults.querySelector("[data-chat-search-result]");
    if (!firstResult) {
      return;
    }

    event.preventDefault();
    jumpToChatSearchResult(firstResult);
  }

  function handleChatSearchClick(event) {
    if (event.target === els.chatSearchOverlay) {
      closeChatSearch(true);
      return;
    }

    var loadMore = event.target.closest("[data-action='load-more-search']");
    if (loadMore) {
      var previousScrollTop = els.chatSearchResults.scrollTop;
      state.chatSearchVisibleLimit += SEARCH_RESULT_LIMIT;
      renderChatSearchResults();
      els.chatSearchResults.scrollTop = previousScrollTop;
      return;
    }

    var result = event.target.closest("[data-chat-search-result]");
    if (result) {
      jumpToChatSearchResult(result);
    }
  }

  function renderChatSearchResults() {
    if (els.chatSearchOverlay.hidden) {
      return;
    }

    var query = els.chatSearchInput.value.trim();
    var index = state.chatSearchIndex || buildChatSearchIndex();
    state.chatSearchIndex = index;

    if (!query) {
      els.chatSearchMeta.textContent = index.length ? index.length + " 条消息" : "";
      els.chatSearchResults.innerHTML =
        '<div class="chat-search-empty">想找哪段小记忆？</div>';
      return;
    }

    var terms = getSearchTerms(query);
    var results = [];
    var total = 0;
    var visibleLimit = Math.max(SEARCH_RESULT_LIMIT, state.chatSearchVisibleLimit || SEARCH_RESULT_LIMIT);

    for (var i = 0; i < index.length; i += 1) {
      var item = index[i];
      if (!searchItemMatches(item, terms)) {
        continue;
      }
      total += 1;
      if (results.length < visibleLimit) {
        results.push(item);
      }
    }

    els.chatSearchMeta.textContent = total
      ? "找到 " + total + " 条" + (total > results.length ? "，已显示 " + results.length + " 条" : "")
      : "没有找到";
    els.chatSearchResults.innerHTML = results.length
      ? results.map(function (item) {
          return renderChatSearchResult(item, terms);
        }).join("") +
        renderChatSearchLoadMore(total, results.length)
      : '<div class="chat-search-empty">没有匹配内容</div>';
  }

  function renderChatSearchLoadMore(total, shown) {
    if (shown >= total) {
      return "";
    }
    var nextCount = Math.min(SEARCH_RESULT_LIMIT, total - shown);
    return (
      '<button class="chat-search-load-more" type="button" data-action="load-more-search">' +
      "继续加载 " +
      escapeHtml(String(nextCount)) +
      " 条" +
      "</button>"
    );
  }

  function renderChatSearchResult(item, terms) {
    return (
      '<button class="chat-search-result" type="button" data-chat-search-result data-assistant-id="' +
      escapeAttr(item.assistantId) +
      '" data-session-id="' +
      escapeAttr(item.sessionId) +
      '" data-message-id="' +
      escapeAttr(item.messageId) +
      '">' +
      '<span class="chat-search-result-head">' +
      '<strong>' +
      escapeHtml(item.assistantName) +
      " / " +
      escapeHtml(item.sessionTitle) +
      "</strong>" +
      '<span>' +
      escapeHtml(getSearchRoleLabel(item.role)) +
      "</span>" +
      "</span>" +
      '<span class="chat-search-snippet">' +
      renderSearchSnippet(item.text, terms) +
      "</span>" +
      "</button>"
    );
  }

  function jumpToChatSearchResult(result) {
    var assistantId = result.dataset.assistantId || "";
    var sessionId = result.dataset.sessionId || "";
    var messageId = result.dataset.messageId || "";
    var assistant = state.chatStore.assistants.find(function (item) {
      return item.id === assistantId;
    });

    if (!assistant) {
      showToast("没有找到对应助手");
      return;
    }
    if (!(assistant.sessions || []).some(function (session) { return session.id === sessionId; })) {
      showToast("没有找到对应会话");
      return;
    }

    state.chatStore.activeAssistantId = assistantId;
    assistant.activeSessionId = sessionId;
    var session = findSessionById(assistant, sessionId);
    if (session) {
      session.unreadCompleted = false;
    }
    setTab("chat");
    renderChat();
    saveChatStoreQuietly();
    closeChatSearch(false);
    window.setTimeout(function () {
      scrollToMessage(messageId);
    }, 0);
  }

  function scrollToMessage(messageId) {
    if (!messageId) {
      return;
    }

    var node = els.messagesList.querySelector('[data-message-id="' + cssEscape(messageId) + '"]');
    if (!node) {
      return;
    }

    window.clearTimeout(state.searchHighlightTimer);
    els.messagesList.querySelectorAll(".is-search-hit").forEach(function (item) {
      item.classList.remove("is-search-hit");
    });
    node.scrollIntoView({ block: "center" });
    node.classList.add("is-search-hit");
    state.searchHighlightTimer = window.setTimeout(function () {
      node.classList.remove("is-search-hit");
    }, 1800);
  }

  function buildChatSearchIndex() {
    var rows = [];
    (state.chatStore.assistants || []).forEach(function (assistant) {
      var assistantName = getAssistantDisplayName(assistant);
      (assistant.sessions || []).forEach(function (session) {
        var sessionTitle = session.title || "新会话";
        (session.messages || []).forEach(function (message) {
          var text = getMessageSearchText(message);
          if (!text) {
            return;
          }
          rows.push({
            assistantId: assistant.id,
            sessionId: session.id,
            messageId: message.id,
            assistantName: assistantName,
            sessionTitle: sessionTitle,
            role: message.role || "",
            text: text,
            haystack: normalizeSearchText(text)
          });
        });
      });
    });
    return rows;
  }

  function invalidateChatSearchIndex() {
    state.chatSearchIndex = null;
  }

  function getMessageSearchText(message) {
    if (!message || message.type === "clear") {
      return "";
    }
    return String([message.content || "", message.reasoning || ""].join("\n")).trim();
  }

  function normalizeSearchText(value) {
    return String(value || "").toLowerCase();
  }

  function getSearchTerms(query) {
    return normalizeSearchText(query)
      .split(/\s+/)
      .filter(Boolean);
  }

  function searchItemMatches(item, terms) {
    if (!terms.length) {
      return false;
    }
    for (var i = 0; i < terms.length; i += 1) {
      if (item.haystack.indexOf(terms[i]) < 0) {
        return false;
      }
    }
    return true;
  }

  function getSearchRoleLabel(role) {
    return role === "assistant" ? "助手" : "用户";
  }

  function renderSearchSnippet(text, terms) {
    var source = String(text || "").replace(/\s+/g, " ").trim();
    if (!source) {
      return "";
    }

    var lower = normalizeSearchText(source);
    var firstIndex = -1;
    terms.forEach(function (term) {
      var index = lower.indexOf(term);
      if (index >= 0 && (firstIndex < 0 || index < firstIndex)) {
        firstIndex = index;
      }
    });

    var start = firstIndex < 0 ? 0 : Math.max(0, firstIndex - 48);
    var end = Math.min(source.length, start + 180);
    var snippet = (start > 0 ? "..." : "") + source.slice(start, end) + (end < source.length ? "..." : "");
    return highlightSearchTerms(snippet, terms);
  }

  function highlightSearchTerms(text, terms) {
    var source = String(text || "");
    var lower = normalizeSearchText(source);
    var output = "";
    var position = 0;

    while (position < source.length) {
      var matchIndex = -1;
      var matchTerm = "";
      terms.forEach(function (term) {
        var index = lower.indexOf(term, position);
        if (index >= 0 && (matchIndex < 0 || index < matchIndex || (index === matchIndex && term.length > matchTerm.length))) {
          matchIndex = index;
          matchTerm = term;
        }
      });

      if (matchIndex < 0) {
        output += escapeHtml(source.slice(position));
        break;
      }

      output += escapeHtml(source.slice(position, matchIndex));
      output += "<mark>" + escapeHtml(source.slice(matchIndex, matchIndex + matchTerm.length)) + "</mark>";
      position = matchIndex + matchTerm.length;
    }

    return output;
  }

  function renderMessage(message) {
    if (message && message.type === "clear") {
      return renderContextClearMessage(message);
    }

    var attachments = Array.isArray(message.attachments) ? message.attachments : [];
    var isAssistant = message.role === "assistant";
    var contentHtml = isAssistant
      ? renderMarkdown(message.content || "")
      : renderPlainText(message.content || "");
    var contentClass = isAssistant ? "message-content markdown-body" : "message-content";
    var reasoningHtml = isAssistant ? renderReasoningBlock(message) : "";
    var loadingHtml = isAssistant && message.loading ? renderMessageLoader() : "";
    var statsHtml = isAssistant ? renderMessageStats(message) : "";
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
      (message.loading ? " is-loading" : "") +
      '" data-message-id="' +
      escapeAttr(message.id) +
      '">' +
      reasoningHtml +
      '<div class="' +
      contentClass +
      '">' +
      contentHtml +
      "</div>" +
      loadingHtml +
      attachmentHtml +
      statsHtml +
      "</div>"
    );
  }

  async function handleCodeCopyClick(event) {
    var button = event.target.closest("[data-copy-code]");
    if (!button) {
      return;
    }

    var pre = button.closest("pre");
    var code = pre ? pre.querySelector("code") : null;
    var text = code ? code.textContent || "" : "";
    if (!text) {
      return;
    }

    try {
      if (api.copyText) {
        await api.copyText(text);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      showCodeCopyState(button, "copied");
    } catch (error) {
      showCodeCopyState(button, "failed");
      showToast("复制没成功：" + getErrorMessage(error));
    }
  }

  function showCodeCopyState(button, stateName) {
    setCodeCopyButtonContent(button, stateName);
    window.clearTimeout(button._copyTimer);
    button._copyTimer = window.setTimeout(function () {
      setCodeCopyButtonContent(button, "copy");
    }, 1200);
  }

  function setCodeCopyButtonContent(button, stateName) {
    var title = stateName === "copied" ? "已复制" : stateName === "failed" ? "复制失败" : "复制代码";
    button.innerHTML = getCodeCopyIcon(stateName);
    button.classList.toggle("is-copied", stateName === "copied");
    button.classList.toggle("is-failed", stateName === "failed");
    button.setAttribute("title", title);
    button.setAttribute("aria-label", title);
  }

  function renderContextClearMessage(message) {
    return (
      '<div class="context-clear-divider" data-message-id="' +
      escapeAttr(message.id) +
      '">' +
      "<span></span>" +
      "<strong>上下文已清除</strong>" +
      "<span></span>" +
      "</div>"
    );
  }

  function renderReasoningBlock(message) {
    var reasoning = String(message.reasoning || "").trim();
    if (!reasoning) {
      return "";
    }

    var thinkingText = formatThinkingDuration(
      getMessageThinkingMs(message),
      Boolean(message.loading || message._reasoningStartedAt || message.metrics)
    );
    var label = message.loading
      ? "思考中" + (thinkingText ? " " + thinkingText : "")
      : thinkingText
        ? "已思考 " + thinkingText
        : "思考过程";
    return (
      '<details class="reasoning-block">' +
      "<summary>" +
      '<span class="reasoning-title">' +
      (message.loading ? '<span class="reasoning-pulse" aria-hidden="true"></span>' : "") +
      escapeHtml(label) +
      "</span>" +
      '<span class="reasoning-preview" data-reasoning-preview>' +
      escapeHtml(createReasoningPreview(reasoning)) +
      "</span>" +
      "</summary>" +
      '<div class="reasoning-content markdown-body">' +
      renderMarkdown(reasoning) +
      "</div>" +
      "</details>"
    );
  }

  function renderMessageStats(message) {
    if (!message || message.loading || message._failed) {
      return "";
    }

    var usage = normalizeMessageUsage(message.usage);
    if (!usage) {
      return "";
    }

    var metrics = normalizeMessageMetrics(message.metrics);
    var tooltip = createMessageStatsTooltip(message, metrics, usage);
    var tooltipAttrs = tooltip
      ? ' data-tooltip="' + escapeAttr(tooltip) + '" title="' + escapeAttr(tooltip) + '"'
      : "";

    return (
      '<div class="message-stats"' +
      tooltipAttrs +
      ">" +
      '<span>Tokens: ' +
      escapeHtml(String(usage.total_tokens)) +
      "</span>" +
      '<span>↑' +
      escapeHtml(String(usage.prompt_tokens)) +
      "</span>" +
      '<span>↓' +
      escapeHtml(String(usage.completion_tokens)) +
      "</span>" +
      "</div>"
    );
  }

  function createMessageStatsTooltip(message, metrics, usage) {
    if (!metrics) {
      return usage && usage.estimated ? "Token 为本地估算" : "";
    }

    var parts = [];
    if (metrics.time_first_token_millsec) {
      parts.push("首字延迟 " + Math.round(metrics.time_first_token_millsec) + " ms");
    }

    var speed = calculateCharsPerSecond(message, metrics);
    if (speed) {
      parts.push("每秒 " + speed + " 字");
    }

    if (usage && usage.estimated) {
      parts.push("Token 为本地估算");
    }

    return parts.join(" | ");
  }

  function calculateCharsPerSecond(message, metrics) {
    var duration = metrics && Number(metrics.time_completion_millsec);
    if (!duration || duration <= 0) {
      return 0;
    }

    var chars = countDisplayChars((message.content || "") + (message.reasoning || ""));
    if (!chars) {
      return 0;
    }
    return Math.max(1, Math.round(chars / (duration / 1000)));
  }

  function countDisplayChars(value) {
    return String(value || "").replace(/\s+/g, "").length;
  }

  function getMessageThinkingMs(message) {
    var metrics = normalizeMessageMetrics(message && message.metrics);
    var stored = metrics ? metrics.time_thinking_millsec : 0;
    if (message && message.loading && message._reasoningStartedAt && message._reasoningActive) {
      return Math.max(nowMs() - message._reasoningStartedAt, stored || 0);
    }
    return stored || 0;
  }

  function formatThinkingDuration(milliseconds, allowZero) {
    var value = Number(milliseconds) || 0;
    if (!value && !allowZero) {
      return "";
    }
    if (allowZero || value > 0) {
      value = Math.max(value, 100);
    }
    return (value / 1000).toFixed(1) + " 秒";
  }

  function renderMessageLoader() {
    return (
      '<div class="message-loader" aria-label="正在生成">' +
      "<span></span><span></span><span></span>" +
      "</div>"
    );
  }

  function createReasoningPreview(value) {
    var text = stripMarkdownMarkers(value)
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) {
      return "正在整理思路...";
    }
    return text;
  }

  function stripMarkdownMarkers(value) {
    return String(value || "")
      .replace(/```[\s\S]*?```/g, "代码片段")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-+*]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "");
  }

  async function handleAssistantClick(event) {
    var item = event.target.closest(".assistant-item");
    if (!item) {
      return;
    }

    if (event.target.dataset.action === "delete-assistant") {
      event.preventDefault();
      event.stopPropagation();
      var assistantId = item.dataset.assistantId;
      if (
        !(await showConfirmDialog({
          title: "删除助手",
          message: "这个助手下的话题会一起删除。",
          confirmText: "删除"
        }))
      ) {
        return;
      }
      deleteAssistant(assistantId);
      return;
    }

    state.chatStore.activeAssistantId = item.dataset.assistantId;
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
    abortChatRunsForAssistant(assistantId);
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

    assistant.name = els.assistantNameInput.value.trim();
    assistant.prompt = els.assistantPromptInput.value;
    assistant.updatedAt = Date.now();
    saveChatStoreQuietly();
    renderAssistants();
  }

  async function handleSessionClick(event) {
    var item = event.target.closest(".session-item");
    if (!item) {
      return;
    }

    if (event.target.dataset.action === "delete-session") {
      event.preventDefault();
      event.stopPropagation();
      var sessionId = item.dataset.sessionId;
      if (
        !(await showConfirmDialog({
          title: "删除话题",
          message: "这条对话记录会被删除。",
          confirmText: "删除"
        }))
      ) {
        return;
      }
      deleteSession(sessionId);
      return;
    }

    var assistant = getActiveAssistant();
    if (assistant) {
      var session = findSessionById(assistant, item.dataset.sessionId);
      assistant.activeSessionId = item.dataset.sessionId;
      if (session && session.unreadCompleted) {
        session.unreadCompleted = false;
      }
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

    abortChatRunsForSession(sessionId);
    assistant.sessions = assistant.sessions.filter(function (session) {
      return session.id !== sessionId;
    });
    ensureActiveAssistantAndSession();
    saveChatStoreQuietly();
    renderChat();
  }

  function clearChatContext() {
    var session = getActiveSession();
    if (!session || !session.messages.length) {
      showToast("还没有可清除的上下文");
      return;
    }

    if (state.running) {
      stopActiveRequest();
    }

    var lastMessage = session.messages[session.messages.length - 1];
    if (lastMessage && lastMessage.type === "clear") {
      session.messages.pop();
      session.updatedAt = Date.now();
      saveChatStoreQuietly();
      renderChat();
      showToast("已恢复上文");
      return;
    }

    session.messages.push(createContextClearMessage());
    session.updatedAt = Date.now();
    saveChatStoreQuietly();
    renderChat();
    showToast("已清除上下文");
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

    if (getChatRunForSession(session.id)) {
      showToast("这个对话正在回复中");
      return;
    }

    if (countActiveChatRuns() >= MAX_CHAT_RUNS) {
      showToast("最多同时进行 " + MAX_CHAT_RUNS + " 个对话");
      return;
    }

    var userMessageForApi = createMessage("user", text, attachments);
    var userMessageForStorage = createMessage("user", text, sanitizeAttachmentsForStorage(attachments));
    session.messages.push(userMessageForStorage);
    if (!session.title || session.title === "新会话") {
      session.title = createSessionTitle(text, attachments);
    }

    var apiMessages = getMessagesAfterLastContextClear(session.messages).map(cloneMessage);
    apiMessages[apiMessages.length - 1] = userMessageForApi;
    var assistantMessage = createMessage("assistant", "", []);
    assistantMessage.loading = true;
    initializeAssistantTelemetry(assistantMessage);
    session.messages.push(assistantMessage);
    session.updatedAt = Date.now();
    state.chatAttachments = [];
    els.chatInput.value = "";
    renderAttachments("chat");
    renderChat();
    saveChatStoreQuietly();

    var requestId = createId("chat-run");
    var run = {
      requestId: requestId,
      assistantId: assistant ? assistant.id : "",
      sessionId: session.id,
      messageId: assistantMessage.id
    };
    state.chatRuns[requestId] = run;
    renderChatRunControls();

    var errorHandled = false;
    var telemetryTimer = window.setInterval(function () {
      if (!assistantMessage.loading) {
        return;
      }
      updateLiveAssistantTelemetry(assistantMessage);
      if (assistantMessage.reasoning) {
        updateRenderedChatMessage(assistantMessage, run);
      }
    }, 200);
    try {
      await api.sendChat(
        {
          requestId: requestId,
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
          handleChatEvent(event, assistantMessage, provider, run);
        }
      );
    } catch (error) {
      if (!errorHandled && getErrorMessage(error) !== "请求已取消") {
        assistantMessage.loading = false;
        assistantMessage._failed = true;
        assistantMessage.content = "这次没有成功：\n" + getErrorMessage(error);
        showToast(getErrorMessage(error));
      }
    } finally {
      window.clearInterval(telemetryTimer);
      flushAssistantThinkState(assistantMessage);
      finalizeAssistantTelemetry(assistantMessage, apiMessages);
      assistantMessage.loading = false;
      delete state.chatRuns[requestId];
      markChatRunCompletedUnread(run, assistantMessage);
      session.updatedAt = Date.now();
      saveChatStoreQuietly();
      renderChatAfterRunChange(run);
    }
  }

  function handleChatEvent(event, assistantMessage, provider, run) {
    if (!event || !event.type) {
      return;
    }

    if (event.type === "status") {
      return;
    }

    if (event.type === "reasoning_delta") {
      markAssistantReasoningDelta(assistantMessage);
      assistantMessage.reasoning += event.text || "";
      updateRenderedChatMessage(assistantMessage, run);
      return;
    }

    if (event.type === "delta") {
      markAssistantFirstToken(assistantMessage);
      var changes = appendAssistantContentDelta(assistantMessage, event.text || "");
      updateAssistantTelemetryForDelta(assistantMessage, changes);
      updateRenderedChatMessage(assistantMessage, run);
      return;
    }

    if (event.type === "usage") {
      assistantMessage.usage = normalizeMessageUsage(event.usage);
      syncMetricsWithUsage(assistantMessage);
      updateRenderedChatMessage(assistantMessage, run);
      return;
    }

    if (event.type === "done") {
      flushAssistantThinkState(assistantMessage);
      if (event.usage) {
        assistantMessage.usage = normalizeMessageUsage(event.usage);
      }
      finalizeAssistantTelemetry(assistantMessage);
      assistantMessage.loading = false;
      updateRenderedChatMessage(assistantMessage, run);
      return;
    }

    if (event.type === "error") {
      assistantMessage.loading = false;
      assistantMessage._failed = true;
      assistantMessage.content = "这次没有成功：\n" + (event.message || "请求失败");
      updateRenderedChatMessage(assistantMessage, run);
      showToast(event.message || "这次没有成功");
    }
  }

  function updateRenderedChatMessage(message, run) {
    if (!isChatRunVisible(run)) {
      return;
    }
    updateRenderedMessage(message);
  }

  function renderChatAfterRunChange(run) {
    if (isChatRunVisible(run)) {
      renderChat();
      return;
    }
    if (run && getActiveAssistant() && getActiveAssistant().id === run.assistantId) {
      renderSessions();
    }
    renderChatRunControls();
  }

  function markChatRunCompletedUnread(run, message) {
    if (!run || isChatRunVisible(run)) {
      return;
    }
    if (!message || (!message.content && !message.reasoning && !message._failed)) {
      return;
    }
    var assistant = findAssistantById(run.assistantId);
    var session = findSessionById(assistant, run.sessionId);
    if (session) {
      session.unreadCompleted = true;
    }
  }

  function isChatRunVisible(run) {
    var assistant = getActiveAssistant();
    return Boolean(
      run &&
        state.activeTab === "chat" &&
        assistant &&
        assistant.id === run.assistantId &&
        assistant.activeSessionId === run.sessionId
    );
  }

  function renderChatRunControls() {
    var session = getActiveSession();
    var running = Boolean(session && getChatRunForSession(session.id));
    els.sendChatBtn.disabled = running;
    els.stopChatBtn.disabled = !running;
  }

  function getChatRunForSession(sessionId) {
    var runs = state.chatRuns || {};
    var keys = Object.keys(runs);
    for (var index = 0; index < keys.length; index += 1) {
      var run = runs[keys[index]];
      if (run && run.sessionId === sessionId) {
        return run;
      }
    }
    return null;
  }

  function countActiveChatRuns() {
    return Object.keys(state.chatRuns || {}).length;
  }

  function abortChatRun(requestId) {
    var run = state.chatRuns && state.chatRuns[requestId];
    if (!run) {
      return;
    }
    if (api.abortChat) {
      api.abortChat(requestId);
    }
    delete state.chatRuns[requestId];
    var assistant = findAssistantById(run.assistantId);
    var session = findSessionById(assistant, run.sessionId);
    if (session) {
      var message = findMessageById(session, run.messageId);
      if (message && message.loading) {
        flushAssistantThinkState(message);
        message.loading = false;
      }
      session.updatedAt = Date.now();
      saveChatStoreQuietly();
    }
    renderChatAfterRunChange(run);
  }

  function abortChatRunsForSession(sessionId) {
    Object.keys(state.chatRuns || {}).forEach(function (requestId) {
      var run = state.chatRuns[requestId];
      if (run && run.sessionId === sessionId) {
        abortChatRun(requestId);
      }
    });
  }

  function abortChatRunsForAssistant(assistantId) {
    Object.keys(state.chatRuns || {}).forEach(function (requestId) {
      var run = state.chatRuns[requestId];
      if (run && run.assistantId === assistantId) {
        abortChatRun(requestId);
      }
    });
  }

  function initializeAssistantTelemetry(message) {
    message.usage = null;
    message.metrics = createEmptyMessageMetrics();
    message._requestStartedAt = nowMs();
    message._firstTokenAt = 0;
    message._reasoningStartedAt = 0;
    message._reasoningFinishedAt = 0;
    message._reasoningActive = false;
    message._completedAt = 0;
    message._failed = false;
  }

  function createEmptyMessageMetrics() {
    return {
      completion_tokens: 0,
      time_completion_millsec: 0,
      time_first_token_millsec: 0,
      time_thinking_millsec: 0
    };
  }

  function markAssistantFirstToken(message) {
    if (!message || message._firstTokenAt) {
      return;
    }

    var now = nowMs();
    var metrics = ensureMessageMetrics(message);
    message._firstTokenAt = now;
    metrics.time_first_token_millsec = Math.max(0, now - (message._requestStartedAt || now));
  }

  function markAssistantReasoningDelta(message) {
    if (!message) {
      return;
    }

    markAssistantFirstToken(message);
    var now = nowMs();
    var metrics = ensureMessageMetrics(message);
    if (!message._reasoningStartedAt) {
      message._reasoningStartedAt = now;
    }
    message._reasoningFinishedAt = now;
    message._reasoningActive = true;
    metrics.time_thinking_millsec = Math.max(0, now - message._reasoningStartedAt);
  }

  function updateAssistantTelemetryForDelta(message, changes) {
    var deltaChanges = changes || {};
    if (deltaChanges.reasoningChanged) {
      markAssistantReasoningDelta(message);
    }
    if (deltaChanges.contentChanged && message._reasoningStartedAt && !message._thinkingTagOpen) {
      message._reasoningActive = false;
    }
    updateLiveAssistantTelemetry(message);
  }

  function updateLiveAssistantTelemetry(message) {
    if (!message) {
      return;
    }

    var metrics = ensureMessageMetrics(message);
    var now = nowMs();
    if (message._firstTokenAt) {
      metrics.time_completion_millsec = Math.max(1, now - message._firstTokenAt);
    }
    if (message._reasoningStartedAt && message._reasoningActive) {
      message._reasoningFinishedAt = now;
      metrics.time_thinking_millsec = Math.max(0, now - message._reasoningStartedAt);
    }
  }

  function finalizeAssistantTelemetry(message, apiMessages) {
    if (!message || message._failed || (!message.content && !message.reasoning)) {
      return;
    }

    var metrics = ensureMessageMetrics(message);
    var now = nowMs();
    message._completedAt = message._completedAt || now;
    message._reasoningActive = false;

    if (message._firstTokenAt) {
      metrics.time_completion_millsec = Math.max(1, message._completedAt - message._firstTokenAt);
    }
    if (message._reasoningStartedAt) {
      var thinkingEnd = message._reasoningFinishedAt || message._completedAt;
      metrics.time_thinking_millsec = Math.max(0, thinkingEnd - message._reasoningStartedAt);
    }

    var usage = normalizeMessageUsage(message.usage);
    if (!usage && apiMessages) {
      usage = estimateMessageUsage(apiMessages, message);
    }
    if (usage) {
      message.usage = usage;
    }
    syncMetricsWithUsage(message);
  }

  function syncMetricsWithUsage(message) {
    var usage = normalizeMessageUsage(message && message.usage);
    if (!usage) {
      return;
    }

    message.usage = usage;
    var metrics = ensureMessageMetrics(message);
    if (!metrics.completion_tokens && usage.completion_tokens) {
      metrics.completion_tokens = usage.completion_tokens;
    }
  }

  function ensureMessageMetrics(message) {
    var metrics = normalizeMessageMetrics(message && message.metrics);
    if (!metrics) {
      metrics = createEmptyMessageMetrics();
    }
    message.metrics = metrics;
    return metrics;
  }

  function appendAssistantContentDelta(message, text) {
    var value = String(text || "");
    var changes = {
      contentChanged: false,
      reasoningChanged: false
    };
    if (!value) {
      return changes;
    }

    value = String(message._pendingThinkTag || "") + value;
    message._pendingThinkTag = "";

    function appendContent(part) {
      if (!part) {
        return;
      }
      message.content += part;
      changes.contentChanged = true;
    }

    function appendReasoning(part) {
      if (!part) {
        return;
      }
      message.reasoning += part;
      changes.reasoningChanged = true;
    }

    while (value) {
      if (message._thinkingTagOpen) {
        var closeIndex = value.toLowerCase().indexOf("</think>");
        if (closeIndex >= 0) {
          appendReasoning(value.slice(0, closeIndex));
          value = value.slice(closeIndex + 8);
          message._thinkingTagOpen = false;
          continue;
        }
        var closePartial = getTrailingTagPartial(value, "</think>");
        if (closePartial) {
          appendReasoning(value.slice(0, -closePartial.length));
          message._pendingThinkTag = closePartial;
          return changes;
        }
        appendReasoning(value);
        return changes;
      }

      var openIndex = value.toLowerCase().indexOf("<think>");
      if (openIndex >= 0) {
        appendContent(value.slice(0, openIndex));
        value = value.slice(openIndex + 7);
        message._thinkingTagOpen = true;
        continue;
      }

      var openPartial = getTrailingTagPartial(value, "<think>");
      if (openPartial) {
        appendContent(value.slice(0, -openPartial.length));
        message._pendingThinkTag = openPartial;
        return changes;
      }
      appendContent(value);
      return changes;
    }
    return changes;
  }

  function flushAssistantThinkState(message) {
    if (!message) {
      return;
    }
    if (message._pendingThinkTag) {
      if (message._thinkingTagOpen) {
        message.reasoning += message._pendingThinkTag;
      } else {
        message.content += message._pendingThinkTag;
      }
    }
    message._pendingThinkTag = "";
    message._thinkingTagOpen = false;
  }

  function getTrailingTagPartial(value, tag) {
    var lower = String(value || "").toLowerCase();
    var maxLength = Math.min(lower.length, tag.length - 1);
    for (var length = maxLength; length > 0; length -= 1) {
      var suffix = lower.slice(-length);
      if (tag.indexOf(suffix) === 0) {
        return String(value).slice(-length);
      }
    }
    return "";
  }

  function updateRenderedMessage(message) {
    var node = els.messagesList.querySelector('[data-message-id="' + cssEscape(message.id) + '"]');
    if (!node) {
      renderMessages();
      return;
    }
    var wasReasoningOpen = Boolean(node.querySelector(".reasoning-block[open]"));
    node.outerHTML = renderMessage(message);
    var nextNode = els.messagesList.querySelector('[data-message-id="' + cssEscape(message.id) + '"]');
    if (nextNode) {
      if (wasReasoningOpen) {
        var reasoningBlock = nextNode.querySelector(".reasoning-block");
        if (reasoningBlock) {
          reasoningBlock.open = true;
        }
      }
      scrollReasoningToLatest(nextNode);
    }
    els.messagesList.scrollTop = els.messagesList.scrollHeight;
  }

  function scrollReasoningToLatest(node) {
    var preview = node.querySelector("[data-reasoning-preview]");
    if (preview) {
      preview.scrollTop = preview.scrollHeight;
    }
    var content = node.querySelector(".reasoning-content");
    if (content) {
      content.scrollTop = content.scrollHeight;
    }
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
      unreadCompleted: false,
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
      name: "",
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
      type: "",
      content: content || "",
      reasoning: "",
      usage: null,
      metrics: null,
      attachments: attachments || [],
      createdAt: Date.now()
    };
  }

  function createContextClearMessage() {
    return {
      id: createId("message"),
      role: "user",
      type: "clear",
      content: "",
      reasoning: "",
      usage: null,
      metrics: null,
      attachments: [],
      createdAt: Date.now()
    };
  }

  function getMessagesAfterLastContextClear(messages) {
    var source = Array.isArray(messages) ? messages : [];
    var lastClearIndex = -1;
    source.forEach(function (message, index) {
      if (message && message.type === "clear") {
        lastClearIndex = index;
      }
    });
    return source.slice(lastClearIndex + 1);
  }

  function normalizeMessageUsage(usage) {
    if (!usage || typeof usage !== "object") {
      return null;
    }

    var promptTokens = normalizeTokenCount(
      usage.prompt_tokens,
      usage.promptTokens,
      usage.input_tokens,
      usage.inputTokens
    );
    var completionTokens = normalizeTokenCount(
      usage.completion_tokens,
      usage.completionTokens,
      usage.output_tokens,
      usage.outputTokens
    );
    var totalTokens = normalizeTokenCount(usage.total_tokens, usage.totalTokens);

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
      total_tokens: totalTokens || 0,
      estimated: usage.estimated === true
    };
  }

  function normalizeMessageMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      return null;
    }

    var normalized = {
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

  function normalizeTokenCount() {
    for (var index = 0; index < arguments.length; index += 1) {
      var value = arguments[index];
      var number = Number(value);
      if (Number.isFinite(number) && number >= 0) {
        return Math.round(number);
      }
    }
    return null;
  }

  function normalizeMilliseconds() {
    for (var index = 0; index < arguments.length; index += 1) {
      var value = arguments[index];
      var number = Number(value);
      if (Number.isFinite(number) && number >= 0) {
        return Math.round(number);
      }
    }
    return 0;
  }

  function estimateMessageUsage(apiMessages, assistantMessage) {
    var promptTokens = estimateMessagesTokens(apiMessages || []);
    var completionTokens = estimateTokens(
      String((assistantMessage && assistantMessage.content) || "") +
        "\n" +
        String((assistantMessage && assistantMessage.reasoning) || "")
    );
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated: true
    };
  }

  function estimateMessagesTokens(messages) {
    return (messages || []).reduce(function (total, message) {
      return total + estimateTokens(getMessageTokenText(message));
    }, 0);
  }

  function getMessageTokenText(message) {
    var parts = [message && message.content ? message.content : ""];
    var attachments = Array.isArray(message && message.attachments) ? message.attachments : [];
    attachments.forEach(function (attachment) {
      parts.push(attachment.name || "");
      if (attachment.kind === "document") {
        parts.push(attachment.text || "");
      }
      if (attachment.kind === "image") {
        parts.push("[image]");
      }
    });
    return parts.join("\n");
  }

  function estimateTokens(value) {
    var text = String(value || "");
    if (!text.trim()) {
      return 0;
    }

    var cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
    var cjkCount = cjk ? cjk.length : 0;
    var asciiText = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "");
    var asciiCount = asciiText.replace(/\s+/g, "").length;
    return cjkCount + Math.ceil(asciiCount / 4);
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

  function findAssistantById(assistantId) {
    return (
      state.chatStore.assistants.find(function (assistant) {
        return assistant.id === assistantId;
      }) || null
    );
  }

  function findSessionById(assistant, sessionId) {
    if (!assistant) {
      return null;
    }
    return (
      assistant.sessions.find(function (session) {
        return session.id === sessionId;
      }) || null
    );
  }

  function findMessageById(session, messageId) {
    if (!session) {
      return null;
    }
    return (
      session.messages.find(function (message) {
        return message.id === messageId;
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

  async function saveChatStoreQuietly(options) {
    var settings = options || {};
    invalidateChatSearchIndex();
    try {
      if (api.saveChatStore) {
        await api.saveChatStore(state.chatStore);
      }
    } catch (error) {
      if (settings.showError) {
        showToast("保存会话失败：" + getErrorMessage(error));
      }
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
    renderDataSettings();
    renderProviders();
    renderAssistantEditor();
  }

  function renderDataSettings() {
    if (document.activeElement !== els.dataDirInput) {
      els.dataDirInput.value = normalizeDataDir(state.config.dataDir);
    }
    if (document.activeElement !== els.clipboardWindowInput) {
      els.clipboardWindowInput.value = formatClipboardWindowSeconds(
        state.config.recentClipboardMs
      );
    }
    if (document.activeElement !== els.clipboardPollingInput) {
      els.clipboardPollingInput.value = formatClipboardPollingMs(
        state.config.clipboardPollingMs
      );
    }
  }

  async function saveDataDirSetting() {
    var previousDir = normalizeDataDir(state.config.dataDir);
    var nextDir = normalizeDataDir(els.dataDirInput.value);
    els.dataDirInput.value = nextDir;
    if (previousDir === nextDir) {
      state.config.dataDir = nextDir;
      return;
    }
    state.config.dataDir = nextDir;

    var saved = await saveDraftSettings({ showSuccess: true });
    if (saved) {
      await saveChatStoreQuietly({ showError: true });
    }
  }

  async function chooseDataDir() {
    if (!api.chooseDataDirectory) {
      showToast("当前环境不支持选择目录");
      return;
    }

    var selected = await api.chooseDataDirectory(els.dataDirInput.value || state.config.dataDir);
    if (!selected) {
      return;
    }

    els.dataDirInput.value = selected;
    await saveDataDirSetting();
  }

  async function saveClipboardWindowSetting() {
    var previousMs = normalizeRecentClipboardMs(state.config.recentClipboardMs);
    var nextMs = normalizeClipboardWindowInput(els.clipboardWindowInput.value);
    els.clipboardWindowInput.value = formatClipboardWindowSeconds(nextMs);
    if (previousMs === nextMs) {
      state.config.recentClipboardMs = nextMs;
      return;
    }
    state.config.recentClipboardMs = nextMs;
    await saveDraftSettings({ showSuccess: true });
  }

  async function saveClipboardPollingSetting() {
    var previousMs = normalizeClipboardPollingMs(state.config.clipboardPollingMs);
    var nextMs = normalizeClipboardPollingInput(els.clipboardPollingInput.value);
    els.clipboardPollingInput.value = formatClipboardPollingMs(nextMs);
    if (previousMs === nextMs) {
      state.config.clipboardPollingMs = nextMs;
      return;
    }
    state.config.clipboardPollingMs = nextMs;
    await saveDraftSettings({ showSuccess: true });
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
    updateProviderFromTarget(event.target);
  }

  function handleProviderCommit(event) {
    var target = event.target;
    if (!target || (!target.dataset.field && !target.dataset.modelField)) {
      return;
    }

    var immediateControl = target.tagName === "SELECT" || target.type === "checkbox";
    if (event.type === "change" && !immediateControl) {
      return;
    }
    if (event.type === "focusout" && immediateControl) {
      return;
    }

    var result = updateProviderFromTarget(target);
    if (!result) {
      return;
    }

    saveDraftSettings({ showSuccess: true });
  }

  function updateProviderFromTarget(target) {
    var field = target.dataset.field;
    var modelField = target.dataset.modelField;
    var card = target.closest(".provider-card");
    if ((!field && !modelField) || !card) {
      return null;
    }

    var provider = state.draftProviders.find(function (item) {
      return item.id === card.dataset.providerId;
    });
    if (!provider) {
      return null;
    }

    if (modelField) {
      var modelRow = target.closest(".model-row");
      var model = modelRow
        ? provider.models.find(function (item) {
            return item.id === modelRow.dataset.modelId;
          })
        : null;
      if (!model) {
        return null;
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

    return { provider: provider, field: field, modelField: modelField };
  }

  async function handleProviderClick(event) {
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
      event.preventDefault();
      event.stopPropagation();
      var providerId = card.dataset.providerId;
      if (
        !(await showConfirmDialog({
          title: "删除 Provider",
          confirmText: "删除"
        }))
      ) {
        return;
      }
      deleteProvider(providerId);
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
    saveDraftSettings({ showSuccess: true });
  }

  function addProvider() {
    openProviderDialog();
  }

  function openProviderDialog() {
    state.providerDialogPreviousFocus = document.activeElement;
    state.providerDialogDraft = createProvider();
    els.providerDialogName.value = "";
    els.providerDialogEndpoint.value = "";
    els.providerDialogApiKey.value = "";
    renderProviderDialogModels();
    els.providerDialogOverlay.hidden = false;

    window.setTimeout(function () {
      els.providerDialogName.focus();
    }, 0);
  }

  function closeProviderDialog() {
    if (els.providerDialogOverlay.hidden) {
      return;
    }

    var previousFocus = state.providerDialogPreviousFocus;
    state.providerDialogDraft = null;
    state.providerDialogPreviousFocus = null;
    els.providerDialogOverlay.hidden = true;

    if (previousFocus && previousFocus.focus) {
      try {
        previousFocus.focus();
      } catch (error) {
        // The previous element may have been removed while the dialog was open.
      }
    }
  }

  function handleProviderDialogKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitProviderDialog();
    }
  }

  async function submitProviderDialog() {
    var name = els.providerDialogName.value.trim();
    var endpoint = els.providerDialogEndpoint.value.trim();
    var apiKey = els.providerDialogApiKey.value.trim();
    var models = trimProviderDialogModels();

    if (!name) {
      showToast("先填写 Provider 名称");
      els.providerDialogName.focus();
      return;
    }
    if (!endpoint) {
      showToast("先填写 API 地址");
      els.providerDialogEndpoint.focus();
      return;
    }

    var endpointError = validateEndpoint(endpoint);
    if (endpointError) {
      showToast(endpointError);
      els.providerDialogEndpoint.focus();
      return;
    }

    var provider = createProvider({
      name: name,
      endpoint: endpoint,
      apiKey: apiKey,
      models: models
    });
    state.draftProviders.push(provider);
    state.expandedProviderIds[provider.id] = true;
    ensureModeModels(state.config, state.draftProviders);
    closeProviderDialog();
    renderSettings();
    renderTaskModelSelect();
    renderChatModelSelect();
    await saveDraftSettings({ showSuccess: true, syncDraft: true });
  }

  function renderProviderDialogModels() {
    els.providerDialogModelsList.innerHTML = state.providerDialogDraft
      ? renderModelRows(state.providerDialogDraft)
      : "";
  }

  async function fetchProviderDialogModels() {
    if (!state.providerDialogDraft || !api.fetchModels) {
      return;
    }

    var endpoint = els.providerDialogEndpoint.value.trim();
    if (!endpoint) {
      showToast("先填写 API 地址");
      els.providerDialogEndpoint.focus();
      return;
    }

    var endpointError = validateEndpoint(endpoint);
    if (endpointError) {
      showToast(endpointError);
      els.providerDialogEndpoint.focus();
      return;
    }

    var payload = trimProvider(
      createProvider({
        name: els.providerDialogName.value.trim(),
        endpoint: endpoint,
        apiKey: els.providerDialogApiKey.value.trim(),
        models: trimProviderDialogModels()
      })
    );

    els.providerDialogFetchModelsBtn.disabled = true;
    showToast("拉取模型中");

    try {
      var result = await api.fetchModels(payload);
      var fetchedModels = result && Array.isArray(result.models) ? result.models : [];
      openModelPicker("", fetchedModels, {
        target: "provider-dialog",
        provider: state.providerDialogDraft
      });
    } catch (error) {
      showToast("拉取没成功：" + getErrorMessage(error));
    } finally {
      els.providerDialogFetchModelsBtn.disabled = false;
    }
  }

  function addProviderDialogModel() {
    if (!state.providerDialogDraft) {
      return;
    }
    state.providerDialogDraft.models.push(createModel());
    renderProviderDialogModels();
  }

  function deleteProviderDialogModel(row) {
    if (!state.providerDialogDraft || !row) {
      return;
    }
    state.providerDialogDraft.models = state.providerDialogDraft.models.filter(function (model) {
      return model.id !== row.dataset.modelId;
    });
    renderProviderDialogModels();
  }

  function handleProviderDialogModelInput(event) {
    if (!state.providerDialogDraft || !event.target.dataset.modelField) {
      return;
    }

    var row = event.target.closest(".model-row");
    var model = row
      ? state.providerDialogDraft.models.find(function (item) {
          return item.id === row.dataset.modelId;
        })
      : null;
    if (!model) {
      return;
    }
    model[event.target.dataset.modelField] =
      event.target.type === "checkbox" ? event.target.checked : event.target.value;
  }

  function trimProviderDialogModels() {
    return ((state.providerDialogDraft && state.providerDialogDraft.models) || [])
      .map(trimModel)
      .filter(function (model) {
        return model.model;
      });
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
      openModelPicker(providerId, fetchedModels);
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
    saveDraftSettings({ showSuccess: true });
  }

  function deleteModel(providerId, modelId) {
    var provider = state.draftProviders.find(function (item) {
      return item.id === providerId;
    });
    if (!provider) {
      return;
    }

    provider.models = provider.models.filter(function (model) {
      return model.id !== modelId;
    });

    ensureModeModels(state.config, state.draftProviders);
    clearSessionModelRefs(providerId, modelId);
    renderSettings();
    saveDraftSettings({ showSuccess: true });
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

  function buildDraftConfig() {
    var nextConfig = {
      dataDir: normalizeDataDir(state.config.dataDir),
      recentClipboardMs: normalizeRecentClipboardMs(state.config.recentClipboardMs),
      clipboardPollingMs: normalizeClipboardPollingMs(state.config.clipboardPollingMs),
      providers: state.draftProviders.map(trimProvider),
      modeModels: cloneModeModels(state.config.modeModels)
    };
    ensureModeModels(nextConfig, nextConfig.providers);
    return nextConfig;
  }

  async function saveDraftSettings(options) {
    var settings = Object.assign(
      {
        showSuccess: false,
        syncDraft: false,
        render: false
      },
      options || {}
    );
    var nextConfig = buildDraftConfig();
    var validationMessage = validateConfig(nextConfig);
    if (validationMessage) {
      showToast(validationMessage);
      return false;
    }

    var saveToken = state.settingsSaveToken + 1;
    state.settingsSaveToken = saveToken;

    try {
      var savedConfig = normalizeConfig(await api.saveConfig(nextConfig));
      if (saveToken === state.settingsSaveToken) {
        state.config = savedConfig;
        if (settings.syncDraft) {
          state.draftProviders = cloneProviders(state.config.providers);
        }
        if (settings.render) {
          renderSettings();
        }
        renderTaskModelSelect();
        renderChatModelSelect();
      }
      if (settings.showSuccess && saveToken === state.settingsSaveToken) {
        showToast("保存成功");
      }
      return true;
    } catch (error) {
      showToast("保存没成功：" + getErrorMessage(error));
      return false;
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
    return getProviderModel(selection.providerId, selection.modelId, providers, mode) ||
      getFirstResolvedProviderModel(providers, mode);
  }

  function createProvider(values) {
    var source = values && typeof values === "object" ? values : {};
    return {
      id: createId("provider"),
      name: typeof source.name === "string" ? source.name : "",
      endpoint: typeof source.endpoint === "string" ? source.endpoint : "",
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      sslVerify: false,
      proxyMode: "system",
      proxyUrl: "",
      models: Array.isArray(source.models) ? source.models : []
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
      dataDir: normalizeDataDir(source.dataDir),
      recentClipboardMs: normalizeRecentClipboardMs(source.recentClipboardMs),
      clipboardPollingMs: normalizeClipboardPollingMs(source.clipboardPollingMs),
      providers: providers,
      modeModels: modeModels
    };
  }

  function normalizeDataDir(value) {
    var dataDir = String(value || "").trim();
    return dataDir || DEFAULT_DATA_DIR;
  }

  function normalizeRecentClipboardMs(value) {
    var milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) {
      return DEFAULT_RECENT_CLIPBOARD_MS;
    }
    return Math.max(0, Math.min(60000, Math.round(milliseconds)));
  }

  function normalizeClipboardWindowInput(value) {
    var seconds = Number(value);
    if (!Number.isFinite(seconds)) {
      return DEFAULT_RECENT_CLIPBOARD_MS;
    }
    return normalizeRecentClipboardMs(seconds * 1000);
  }

  function formatClipboardWindowSeconds(value) {
    var seconds = normalizeRecentClipboardMs(value) / 1000;
    return String(Number(seconds.toFixed(1)));
  }

  function normalizeClipboardPollingMs(value) {
    var milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) {
      return DEFAULT_CLIPBOARD_POLL_MS;
    }
    return Math.max(100, Math.min(60000, Math.round(milliseconds)));
  }

  function normalizeClipboardPollingInput(value) {
    return normalizeClipboardPollingMs(value);
  }

  function formatClipboardPollingMs(value) {
    return String(normalizeClipboardPollingMs(value));
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
    if (Array.isArray(source.models)) {
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
      name: typeof assistant.name === "string" ? assistant.name : "",
      prompt: typeof assistant.prompt === "string" ? assistant.prompt : "",
      providerId: typeof assistant.providerId === "string" ? assistant.providerId : "",
      modelId: typeof assistant.modelId === "string" ? assistant.modelId : "",
      createdAt: Number(assistant.createdAt) || Date.now(),
      updatedAt: Number(assistant.updatedAt) || Date.now(),
      activeSessionId: sessions.length ? activeSessionId : "",
      sessions: sessions
    };
  }

  function getAssistantDisplayName(assistant) {
    if (!assistant) {
      return "未命名助手";
    }
    return assistant.name || "未命名助手";
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
      unreadCompleted: session.unreadCompleted === true,
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
      type: message.type === "clear" ? "clear" : "",
      content: typeof message.content === "string" ? message.content : "",
      reasoning: typeof message.reasoning === "string" ? message.reasoning : "",
      usage: normalizeMessageUsage(message.usage),
      metrics: normalizeMessageMetrics(message.metrics),
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
      if (!getProviderModel(selection.providerId, selection.modelId, providers, mode)) {
        selection = fallbackSelection || { providerId: "", modelId: "" };
      }
      if (!getProviderModel(selection.providerId, selection.modelId, providers, mode)) {
        var first = getFirstProviderModel(providers, mode);
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
    if (getProviderModel(selection.providerId, selection.modelId, providers, mode)) {
      return;
    }
    var first = getFirstProviderModel(providers, mode);
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

  function modelSelectionExists(providers, value, mode) {
    var selection = parseModelValue(value);
    return !!getProviderModel(selection.providerId, selection.modelId, providers, mode);
  }

  function getFirstProviderModel(providers, mode) {
    for (var index = 0; index < providers.length; index += 1) {
      var provider = providers[index];
      var models = provider.models || [];
      for (var modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
        if (modelAllowedForMode(models[modelIndex], mode)) {
          return { provider: provider, model: models[modelIndex] };
        }
      }
    }
    return null;
  }

  function getFirstResolvedProviderModel(providers, mode) {
    var first = getFirstProviderModel(providers || [], mode);
    return first
      ? getProviderModel(first.provider.id, first.model.id, providers, mode)
      : null;
  }

  function countModels(providers, mode) {
    return providers.reduce(function (total, provider) {
      return total + (provider.models || []).filter(function (model) {
        return modelAllowedForMode(model, mode);
      }).length;
    }, 0);
  }

  function getProviderModel(providerId, modelId, providers, mode) {
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
      : (provider.models || []).find(function (item) {
          return modelAllowedForMode(item, mode);
        });
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

  function modeRequiresMultimodal(mode) {
    var task = TASKS[mode];
    return Boolean(task && task.requiresMultimodal);
  }

  function modelAllowedForMode(model, mode) {
    return !modeRequiresMultimodal(mode) || (model && model.multimodal === true);
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

  function openModelPicker(providerId, names, options) {
    var settings = options || {};
    var provider = settings.provider || state.draftProviders.find(function (item) {
      return item.id === providerId;
    });
    if (!provider) {
      return;
    }

    var fetchedModels = normalizeFetchedModelNames(names);
    var existingModels = normalizeFetchedModelNames(
      (provider.models || []).map(function (model) {
        return model.model;
      })
    );
    var existing = {};
    existingModels.forEach(function (model) {
      existing[model] = true;
    });

    var selected = {};
    fetchedModels.forEach(function (model) {
      selected[model] = Boolean(existing[model]);
    });

    state.modelPickerPreviousFocus = document.activeElement;
    state.modelPicker = {
      providerId: providerId,
      target: settings.target || "settings",
      models: fetchedModels,
      selected: selected,
      existing: existing,
      query: ""
    };

    renderModelPicker();
    window.setTimeout(function () {
      var searchInput = document.getElementById("modelPickerSearch");
      if (searchInput) {
        searchInput.focus();
      }
    }, 0);
  }

  function closeModelPicker() {
    if (!state.modelPicker) {
      return;
    }

    var previousFocus = state.modelPickerPreviousFocus;
    state.modelPicker = null;
    state.modelPickerPreviousFocus = null;
    renderModelPicker();

    if (previousFocus && previousFocus.focus) {
      try {
        previousFocus.focus();
      } catch (error) {
        // The previous element may have been removed while the picker was open.
      }
    }
  }

  function renderModelPicker() {
    var picker = state.modelPicker;
    if (!picker) {
      els.modelPickerOverlay.hidden = true;
      els.modelPickerOverlay.innerHTML = "";
      return;
    }

    var query = String(picker.query || "").toLocaleLowerCase();
    var visibleModels = picker.models.filter(function (model) {
      return model.toLocaleLowerCase().indexOf(query) >= 0;
    });
    var selectedCount = picker.models.filter(function (model) {
      return picker.selected[model];
    }).length;
    var existingCount = picker.models.filter(function (model) {
      return picker.existing[model];
    }).length;
    var allVisibleSelected =
      visibleModels.length > 0 &&
      visibleModels.every(function (model) {
        return picker.selected[model];
      });

    els.modelPickerOverlay.hidden = false;
    els.modelPickerOverlay.innerHTML =
      '<section class="model-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="modelPickerTitle">' +
      '<header class="model-picker-head">' +
      '<h2 id="modelPickerTitle">选择拉取模型</h2>' +
      '<button class="ghost-btn icon-btn" type="button" title="关闭" aria-label="关闭" data-action="model-picker-close">×</button>' +
      "</header>" +
      '<div class="model-picker-body">' +
      '<input id="modelPickerSearch" class="model-picker-search" value="' +
      escapeAttr(picker.query || "") +
      '" placeholder="搜索模型" autocomplete="off" spellcheck="false" />' +
      '<div id="modelPickerMeta" class="model-picker-meta">' +
      escapeHtml(renderModelPickerMeta(picker.models.length, selectedCount, existingCount)) +
      "</div>" +
      '<div class="model-picker-list">' +
      '<div class="fetched-model-row">' +
      '<input id="modelPickerSelectAll" type="checkbox" ' +
      (allVisibleSelected ? "checked" : "") +
      (visibleModels.length === 0 ? " disabled" : "") +
      " />" +
      "<strong>模型名称</strong><span></span>" +
      "</div>" +
      (picker.models.length
        ? picker.models
            .map(function (model) {
              var visible = model.toLocaleLowerCase().indexOf(query) >= 0;
              return (
                '<div class="fetched-model-row" data-fetched-model-row="1" data-model-name="' +
                escapeAttr(model) +
                '" ' +
                (visible ? "" : "hidden") +
                ">" +
                '<input type="checkbox" data-model-picker-model="' +
                escapeAttr(model) +
                '" ' +
                (picker.selected[model] ? "checked" : "") +
                " />" +
                '<span class="fetched-model-name">' +
                escapeHtml(model) +
                "</span>" +
                (picker.existing[model]
                  ? '<span class="fetched-model-badge">已在清单</span>'
                  : "<span></span>") +
                "</div>"
              );
            })
            .join("")
        : '<div class="fetched-model-empty">没有拉取到模型。</div>') +
      "</div>" +
      "</div>" +
      '<footer class="model-picker-foot">' +
      '<button class="secondary-btn" type="button" data-action="model-picker-close">取消</button>' +
      '<button class="primary-btn" type="button" data-action="model-picker-apply">确认</button>' +
      "</footer>" +
      "</section>";
  }

  function handleModelPickerClick(event) {
    if (!state.modelPicker) {
      return;
    }

    if (event.target === els.modelPickerOverlay) {
      closeModelPicker();
      return;
    }

    var button = event.target.closest("button[data-action]");
    if (button && els.modelPickerOverlay.contains(button)) {
      if (button.dataset.action === "model-picker-close") {
        closeModelPicker();
        return;
      }
      if (button.dataset.action === "model-picker-apply") {
        applyModelPickerSelection();
        return;
      }
    }

    var row = event.target.closest("[data-fetched-model-row]");
    if (!row || !els.modelPickerOverlay.contains(row)) {
      return;
    }

    var model = row.dataset.modelName || "";
    if (!model) {
      return;
    }

    state.modelPicker.selected[model] = !state.modelPicker.selected[model];
    updateModelPickerDom();
  }

  function handleModelPickerInput(event) {
    if (!state.modelPicker || event.target.id !== "modelPickerSearch") {
      return;
    }
    updateModelPickerDom();
  }

  function handleModelPickerChange(event) {
    if (!state.modelPicker) {
      return;
    }

    if (event.target.id === "modelPickerSelectAll") {
      setVisibleModelPickerSelection(event.target.checked);
      return;
    }

    var model = event.target.dataset ? event.target.dataset.modelPickerModel : "";
    if (model) {
      state.modelPicker.selected[model] = event.target.checked;
      updateModelPickerDom();
    }
  }

  function setVisibleModelPickerSelection(checked) {
    if (!state.modelPicker) {
      return;
    }

    var queryInput = document.getElementById("modelPickerSearch");
    var query = String(queryInput ? queryInput.value : "").trim().toLocaleLowerCase();
    state.modelPicker.models.forEach(function (model) {
      if (model.toLocaleLowerCase().indexOf(query) >= 0) {
        state.modelPicker.selected[model] = checked;
      }
    });
    updateModelPickerDom();
  }

  function updateModelPickerDom() {
    if (!state.modelPicker) {
      return;
    }

    var queryInput = document.getElementById("modelPickerSearch");
    var query = String(queryInput ? queryInput.value : "").trim().toLocaleLowerCase();
    var visibleCount = 0;
    var visibleSelectedCount = 0;
    state.modelPicker.query = query;

    Array.from(els.modelPickerOverlay.querySelectorAll("[data-fetched-model-row]")).forEach(
      function (row) {
        var model = row.dataset.modelName || "";
        var visible = model.toLocaleLowerCase().indexOf(query) >= 0;
        row.hidden = !visible;
        var checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = Boolean(state.modelPicker.selected[model]);
        }
        if (visible) {
          visibleCount += 1;
          if (state.modelPicker.selected[model]) {
            visibleSelectedCount += 1;
          }
        }
      }
    );

    var selectedCount = state.modelPicker.models.filter(function (model) {
      return state.modelPicker.selected[model];
    }).length;
    var existingCount = state.modelPicker.models.filter(function (model) {
      return state.modelPicker.existing[model];
    }).length;
    var meta = document.getElementById("modelPickerMeta");
    if (meta) {
      meta.textContent = renderModelPickerMeta(
        state.modelPicker.models.length,
        selectedCount,
        existingCount
      );
    }

    var selectAll = document.getElementById("modelPickerSelectAll");
    if (selectAll) {
      selectAll.disabled = visibleCount === 0;
      selectAll.checked = visibleCount > 0 && visibleSelectedCount === visibleCount;
      selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleCount;
    }
  }

  function applyModelPickerSelection() {
    var picker = state.modelPicker;
    if (!picker) {
      return;
    }

    var provider = picker.target === "provider-dialog"
      ? state.providerDialogDraft
      : state.draftProviders.find(function (item) {
          return item.id === picker.providerId;
        });
    if (!provider) {
      closeModelPicker();
      return;
    }

    var previousModels = provider.models || [];
    var fetched = {};
    picker.models.forEach(function (model) {
      fetched[model] = true;
    });

    var existingByName = {};
    var retainedNames = [];
    previousModels.forEach(function (model) {
      var name = String(model.model || "").trim();
      if (!name || existingByName[name]) {
        return;
      }
      model.model = name;
      existingByName[name] = model;
      if (!fetched[name]) {
        retainedNames.push(name);
      }
    });

    var selectedNames = picker.models.filter(function (model) {
      return picker.selected[model];
    });
    var nextNames = normalizeFetchedModelNames(retainedNames.concat(selectedNames)).sort(
      function (left, right) {
        return left.localeCompare(right);
      }
    );
    var nextModels = nextNames.map(function (name) {
      if (existingByName[name]) {
        return existingByName[name];
      }
      var model = createModel();
      model.model = name;
      return model;
    });

    provider.models = nextModels;
    if (picker.target === "provider-dialog") {
      state.modelPicker = null;
      state.modelPickerPreviousFocus = null;
      renderModelPicker();
      renderProviderDialogModels();
      return;
    }

    var nextIds = {};
    nextModels.forEach(function (model) {
      nextIds[model.id] = true;
    });
    previousModels.forEach(function (model) {
      if (model.id && !nextIds[model.id]) {
        clearSessionModelRefs(provider.id, model.id);
      }
    });

    ensureModeModels(state.config, state.draftProviders);
    state.modelPicker = null;
    state.modelPickerPreviousFocus = null;
    renderModelPicker();
    renderSettings();
    renderTaskModelSelect();
    renderChatModelSelect();
    saveDraftSettings({ showSuccess: true });
  }

  function renderModelPickerMeta(total, selected, existing) {
    return "共拉取 " + total + " 个模型，已选 " + selected + " 个，其中 " + existing + " 个已在当前清单";
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
      type: message.type || "",
      content: message.content,
      attachments: cloneAttachmentsForRequest(message.attachments || []),
      createdAt: message.createdAt
    };
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function showConfirmDialog(options) {
    if (state.confirmResolver) {
      closeConfirmDialog(false);
    }

    state.confirmPreviousFocus = document.activeElement;
    els.confirmTitle.textContent = options.title || "确认操作";
    els.confirmMessage.textContent = options.message || "";
    els.confirmCancelBtn.textContent = options.cancelText || "取消";
    els.confirmOkBtn.textContent = options.confirmText || "确认";
    els.confirmOverlay.hidden = false;

    return new Promise(function (resolve) {
      state.confirmResolver = resolve;
      window.setTimeout(function () {
        els.confirmCancelBtn.focus();
      }, 0);
    });
  }

  function closeConfirmDialog(confirmed) {
    if (!state.confirmResolver) {
      return;
    }

    var resolve = state.confirmResolver;
    var previousFocus = state.confirmPreviousFocus;
    state.confirmResolver = null;
    state.confirmPreviousFocus = null;
    els.confirmOverlay.hidden = true;

    if (previousFocus && previousFocus.focus) {
      try {
        previousFocus.focus();
      } catch (error) {
        // The previous element may have been removed after a confirmed delete.
      }
    }

    resolve(confirmed === true);
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

  function nowMs() {
    if (window.performance && typeof window.performance.now === "function") {
      return window.performance.now();
    }
    return Date.now();
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

  function renderPlainText(value) {
    return escapeHtml(value).replace(/\r\n?/g, "\n");
  }

  function createMarkdownRenderer() {
    if (typeof window.markdownit !== "function") {
      return null;
    }

    var renderer = window.markdownit({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false
    });
    var defaultLinkOpen =
      renderer.renderer.rules.link_open ||
      function (tokens, index, options, env, self) {
        return self.renderToken(tokens, index, options);
      };

    renderer.renderer.rules.link_open = function (tokens, index, options, env, self) {
      setMarkdownTokenAttr(tokens[index], "target", "_blank");
      setMarkdownTokenAttr(tokens[index], "rel", "noopener noreferrer");
      return defaultLinkOpen(tokens, index, options, env, self);
    };

    renderer.renderer.rules.fence = renderMarkdownCodeBlock;
    renderer.renderer.rules.code_block = renderMarkdownCodeBlock;

    return renderer;
  }

  function setMarkdownTokenAttr(token, name, value) {
    var index = token.attrIndex(name);
    if (index < 0) {
      token.attrPush([name, value]);
      return;
    }
    token.attrs[index][1] = value;
  }

  function renderMarkdownCodeBlock(tokens, index) {
    var token = tokens[index];
    var info = token.info ? token.info.trim().split(/\s+/)[0] : "";
    var langClass = info ? ' class="language-' + escapeAttr(info) + '"' : "";
    return (
      '<pre class="code-block">' +
      '<button class="code-copy-btn" type="button" data-copy-code title="复制代码" aria-label="复制代码">' +
      getCodeCopyIcon("copy") +
      "</button>" +
      "<code" +
      langClass +
      ">" +
      escapeHtml(token.content) +
      "</code></pre>\n"
    );
  }

  function getCodeCopyIcon(stateName) {
    if (stateName === "copied") {
      return (
        '<svg class="tool-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M20 6 9 17l-5-5" />' +
        "</svg>" +
        '<span class="sr-only">已复制</span>'
      );
    }
    if (stateName === "failed") {
      return (
        '<svg class="tool-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M18 6 6 18" />' +
        '<path d="m6 6 12 12" />' +
        "</svg>" +
        '<span class="sr-only">复制失败</span>'
      );
    }
    return (
      '<svg class="tool-icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect width="14" height="14" x="8" y="8" rx="2" />' +
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />' +
      "</svg>" +
      '<span class="sr-only">复制代码</span>'
    );
  }

  function renderMarkdown(value) {
    var text = String(value || "");
    if (!text.trim()) {
      return "";
    }

    if (markdownRenderer) {
      return markdownRenderer.render(text);
    }
    return "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>";
  }

  function createBrowserFallbackApi() {
    return {
      getConfig: function () {
        try {
          return JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "{}");
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
      chooseDataDirectory: function () {
        return "";
      },
      getRecentClipboardText: function () {
        return "";
      },
      getRecentClipboardImage: function () {
        return null;
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
      abortChat: function () {},
      copyText: function (text) {
        return navigator.clipboard.writeText(text);
      },
      getClipboardText: function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
          return navigator.clipboard.readText();
        }
        return "";
      }
    };
  }
})();
