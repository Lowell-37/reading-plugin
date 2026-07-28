<template>
  <aside id="settings-panel" class="settings-panel" aria-label="阅读设置">
    <div class="panel-header">
      <div><p class="eyebrow">READING</p><h2>阅读设置</h2></div>
      <button id="close-settings" class="icon-button" aria-label="关闭设置">×</button>
    </div>
    <div class="setting-group ebook-setting">
      <label>阅读方式</label>
      <div class="segmented"><button data-flow="paginated" class="active">分页</button><button data-flow="scrolled">滚动</button></div>
    </div>
    <div class="setting-group ebook-setting"><label for="font-select">正文字体</label><select id="font-select"><option value="serif">宋体 / 衬线</option><option value="sans">黑体 / 无衬线</option><option value="system">系统字体</option></select></div>
    <div class="setting-group ebook-setting"><label for="font-size">字号 <output id="font-size-value">20</output></label><input id="font-size" type="range" min="14" max="32" value="20"></div>
    <div class="setting-group ebook-setting"><label for="line-height">行距 <output id="line-height-value">1.75</output></label><input id="line-height" type="range" min="1.3" max="2.2" step="0.05" value="1.75"></div>
    <div class="setting-group ebook-setting"><label for="page-width">栏宽 <output id="page-width-value">760</output></label><input id="page-width" type="range" min="520" max="1000" step="20" value="760"></div>
    <div class="setting-group">
      <label>页面主题</label>
      <div class="theme-options"><button data-theme="paper" title="纸张" class="paper active" /><button data-theme="light" title="明亮" class="light" /><button data-theme="sepia" title="暖黄" class="sepia" /><button data-theme="dark" title="深色" class="dark" /></div>
    </div>
    <p id="panel-tip" class="panel-tip">方向键翻页，Esc 收起面板</p>
  </aside>
</template>
