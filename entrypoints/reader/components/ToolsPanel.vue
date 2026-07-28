<template>
  <aside id="tools-panel" class="tools-panel" aria-label="搜索、AI与批注">
    <div class="panel-header"><div><p class="eyebrow">TOOLS</p><h2>搜索、AI与批注</h2></div><button id="close-tools" class="icon-button" aria-label="关闭工具">×</button></div>
    <form id="search-form" class="search-form"><input id="search-input" type="search" placeholder="搜索书中内容" autocomplete="off"><button type="submit">搜索</button></form>
    <div id="search-status" class="search-status">输入关键词搜索整本书</div>
    <div id="search-results" class="search-results" />
    <div class="tool-divider" />
    <section class="ai-section" aria-labelledby="ai-heading">
      <div class="annotation-heading"><strong id="ai-heading">AI 阅读助手</strong><button id="ai-settings-toggle" class="text-button" type="button">接口设置</button></div>
      <p id="ai-selection-preview" class="selection-hint">选中文字后，可以解释、翻译或补充背景。</p>
      <div class="ai-actions" aria-label="划词 AI">
        <button type="button" data-ai-scope="selection" data-ai-action="explain">解释这段话</button><button type="button" data-ai-scope="selection" data-ai-action="translate">翻译</button><button type="button" data-ai-scope="selection" data-ai-action="simplify">简化表达</button><button type="button" data-ai-scope="selection" data-ai-action="terms">分析术语</button><button type="button" data-ai-scope="selection" data-ai-action="background">补充背景</button>
      </div>
      <div class="ai-subheading">当前章节</div>
      <div class="ai-actions" aria-label="章节助手">
        <button type="button" data-ai-scope="chapter" data-ai-action="summary">章节摘要</button><button type="button" data-ai-scope="chapter" data-ai-action="keyPoints">核心观点</button><button type="button" data-ai-scope="chapter" data-ai-action="characters">人物和事件</button><button type="button" data-ai-scope="chapter" data-ai-action="timeline">时间线</button><button type="button" data-ai-scope="chapter" data-ai-action="concepts">重要概念</button>
      </div>
      <div id="ai-result" class="ai-result" hidden>
        <div class="ai-result-heading"><strong id="ai-result-title">AI 回答</strong><button id="ai-stop" class="text-button" type="button" hidden>停止</button></div>
        <div id="ai-result-status" class="ai-result-status" /><div id="ai-result-content" class="ai-result-content" />
      </div>
      <div id="ai-settings" class="ai-settings" hidden>
        <label for="ai-endpoint">OpenAI 兼容接口地址</label><input id="ai-endpoint" type="url" placeholder="https://api.openai.com/v1" spellcheck="false">
        <label for="ai-model">模型名称</label><input id="ai-model" type="text" placeholder="填写接口支持的模型" spellcheck="false">
        <label for="ai-api-key">API 密钥</label><input id="ai-api-key" type="password" placeholder="仅保存在当前浏览器" autocomplete="off" spellcheck="false">
        <button id="save-ai-settings" class="soft-button ai-save-button" type="button">保存设置</button>
        <p>默认不会发送图书内容。点击某项 AI 功能时，仅发送选中文字或当前章节；密钥保存在本机扩展数据中。</p>
      </div>
    </section>
    <div class="tool-divider" />
    <div class="annotation-heading"><strong>高亮与批注</strong><span id="annotation-count">0 条</span></div>
    <p class="selection-hint">在正文中选中文字，然后高亮或添加批注。</p>
    <div class="selection-actions"><button id="highlight-selection" type="button">高亮选中</button><button id="note-selection" type="button">添加批注</button></div>
    <div id="annotation-list" class="annotation-list" />
  </aside>
</template>
