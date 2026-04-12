// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 Pro
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  
// @author       Lyq
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = JSON.parse(localStorage.getItem('AI_CONFIG')) || {
        apiKey: '', apiUrl: '', model: '',
        prompt: ''
    };

    let stats = {
        success: 0, noChange: 0, fail: 0, tokens: 0, startTime: null,
        apiTotalTime: 0, apiAvgTime: 0, apiCount: 0,
        pausedTime: 0, lastPauseTime: null
    };

    let noChangeList = [];
    let failList = [];

    let isPaused = false;
    let isStopped = false;
    let currentIndex = 0;
    let targets = [];

    let originalPlay = null;
    function lockVideo() {
        const video = document.getElementById('myVideo');
        if (video) {
            video.pause();
            if (!originalPlay) {
                originalPlay = video.play;
                video.play = function() { return new Promise(resolve => resolve()); };
            }
        }
    }
    function unlockVideo() {
        const video = document.getElementById('myVideo');
        if (video && originalPlay) {
            video.play = originalPlay; originalPlay = null;
        }
    }

    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) prototypeValueSetter.call(element, value);
        else if (valueSetter) valueSetter.call(element, value);
        else element.value = value;
    }

    function makeDraggableOnlyHeader(header, panel) {
        let isDragging = false, startX, startY, left, top;
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            left = parseInt(window.getComputedStyle(panel).left) || 0;
            top = parseInt(window.getComputedStyle(panel).top) || 0;
            panel.style.transition = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = left + dx + 'px';
            panel.style.top = top + dy + 'px';
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            panel.style.transition = 'all 0.2s ease';
        });
    }

    function addResizer(panel) {
        const resizer = document.createElement('div');
        resizer.style.cssText = `
            position: absolute;
            right: 0;
            bottom: 0;
            width: 16px;
            height: 16px;
            background: transparent;
            cursor: se-resize;
        `;
        panel.appendChild(resizer);
        panel.style.position = 'fixed';
        panel.style.overflow = 'hidden';

        let startX, startY, startW, startH;
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;

            const onMove = (e) => {
                const w = startW + (e.clientX - startX);
                const h = startH + (e.clientY - startY);
                panel.style.width = Math.max(240, w) + 'px';
                panel.style.height = Math.max(320, h) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    const panel = document.createElement('div');
    panel.style.cssText = `
position: fixed;
bottom: 50px;
right: 50px;
z-index: 9999;
width: 240px;
background: #fff;
border-radius: 16px;
box-shadow: 0 8px 30px rgba(0,0,0,0.12);
font-size: 14px;
line-height: 1.6;
font-family: Google Sans, Roboto, sans-serif;
user-select: none;
transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
opacity: 0;
transform: translateY(12px) scale(0.98);
border: 1px solid #e8eaed;
overflow: hidden;
`;

    panel.innerHTML = `
<div id="panel-header" style="background:#1967d2; color:white; padding:12px 16px; font-weight:500; cursor:move; display:flex; align-items:center; justify-content:space-between;">
  <span>📊 自动纠错面板</span>
</div>

<div style="padding:16px;">
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>✅ 成功</span><span id="st-success" style="font-weight:500;">0</span></div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>📝 未修改</span><span id="st-nochange" style="font-weight:500;">0</span></div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>❌ 失败</span><span id="st-fail" style="font-weight:500;">0</span></div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>🪙 Token</span><span id="st-tokens" style="font-weight:500;">0</span></div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>⏱️ 总耗时</span><span id="st-time" style="font-weight:500;">0</span>s</div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>⚡ API 总耗时</span><span id="st-api-total" style="font-weight:500;">0</span>s</div>
  <div style="display:flex; justify-content:space-between; color:#5f6368; margin-bottom:4px;"><span>📊 平均响应</span><span id="st-api-avg" style="font-weight:500;">0</span>ms</div>

  <div style="margin-top:10px; padding-top:10px; border-top:1px solid #f0f0f0; font-size:12px; color:#5f6368;">
    <div>📝 未修改项：<span id="show-nochange" style="color:#1967d2; font-weight:500;">无</span></div>
    <div style="margin-top:4px;">❌ 失败项：<span id="show-fail" style="color:#ef4444; font-weight:500;">无</span></div>
  </div>

  <style>
  .google-btn {
    width: 100%;
    height: 40px;
    border: none;
    border-radius: 10px;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.18s ease;
    font-family: Google Sans, Roboto, sans-serif;
    margin-top: 8px;
    display: inline-flex; align-items:center; justify-content:center;
  }
  .google-btn:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .google-btn:active { transform: scale(0.97); }
  .google-config-btn {
    width:100%; height:36px; background:#f1f3f4; color:#1967d2; border:none; border-radius:8px; font-size:13px; cursor:pointer; margin-top:8px;
  }
  .google-config-btn:hover { background:#e8f0fe; }
  </style>

  <button id="start-btn" class="google-btn" style="background:#1967d2; color:white;">🐱 开始全自动识别</button>
  <button id="toggle-pause" class="google-btn" style="background:#f59e0b; color:white;">⏸ 暂停</button>
  <button id="stop-btn" class="google-btn" style="background:#ef4444; color:white;">⏹ 停止识别</button>
  <button id="open-config" class="google-config-btn">⚙️ 编辑 API 配置</button>
</div>
`;

    document.body.appendChild(panel);
    const header = document.getElementById('panel-header');
    makeDraggableOnlyHeader(header, panel);
    addResizer(panel);

    setTimeout(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0) scale(1)'; }, 200);

    const startBtn = document.getElementById('start-btn');
    const togglePauseBtn = document.getElementById('toggle-pause');
    const stopBtn = document.getElementById('stop-btn');

    function updateStatsDisplay() {
        document.getElementById('st-success').innerText = stats.success;
        document.getElementById('st-nochange').innerText = stats.noChange;
        document.getElementById('st-fail').innerText = stats.fail;
        document.getElementById('st-tokens').innerText = Math.round(stats.tokens);
        document.getElementById('st-api-total').innerText = (stats.apiTotalTime / 1000).toFixed(1);
        document.getElementById('st-api-avg').innerText = stats.apiCount ? Math.round(stats.apiAvgTime) : 0;

        document.getElementById('show-nochange').innerText = noChangeList.length ? noChangeList.join(', ') : '无';
        document.getElementById('show-fail').innerText = failList.length ? failList.join(', ') : '无';

        let elapsed = 0;
        if (stats.startTime) {
            const now = Date.now();
            elapsed = (now - stats.startTime - stats.pausedTime) / 1000;
            if (isPaused && stats.lastPauseTime) elapsed -= (now - stats.lastPauseTime) / 1000;
        }
        document.getElementById('st-time').innerText = elapsed.toFixed(1);
    }

    const configPanel = document.createElement('div');
    configPanel.style.cssText = `
position: fixed;
bottom: 50px;
right: 290px;
z-index: 9998;
width: 320px;
background: #fff;
border-radius: 16px;
box-shadow: 0 8px 30px rgba(0,0,0,0.12);
padding: 20px;
font-family: Google Sans, Roboto, sans-serif;
transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
opacity: 0;
transform: translateY(12px) scale(0.97);
pointer-events: none;
visibility: hidden;
border: 1px solid #e8eaed;
`;

    configPanel.innerHTML = `
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
  <div style="font-weight:500; font-size:16px; color:#202124;">⚙️ API 配置</div>
  <button id="close-config" style="background:none; border:none; font-size:18px; color:#5f6368; cursor:pointer; width:32px; height:32px; border-radius:50%; display:grid; place-items:center;">✕</button>
</div>
<div style="margin-bottom:12px;"><label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">API Key</label><input id="cfg-key" type="password" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:12px; font-size:14px; outline:none;" value="${CONFIG.apiKey}"></div>
<div style="margin-bottom:12px;"><label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">API 地址</label><input id="cfg-url" type="text" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:12px; font-size:14px; outline:none;" value="${CONFIG.apiUrl}"></div>
<div style="margin-bottom:12px;"><label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">模型名称</label><input id="cfg-model" type="text" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:12px; font-size:14px; outline:none;" value="${CONFIG.model}"></div>
<div style="margin-bottom:12px;"><label style="display:block; font-size:13px; color:#5f6368; margin-bottom:6px;">系统提示词</label><textarea id="cfg-prompt" rows="3" style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dadce0; border-radius:12px; font-size:14px; outline:none; resize:vertical; min-height:60px;">${CONFIG.prompt}</textarea></div>
<button id="test-api" class="google-btn" style="background:#34a853; color:white;">🟢 测试 API</button>
<button id="cfg-save" class="google-btn" style="background:#1967d2; color:white;">💾 保存并关闭</button>`;

    document.body.appendChild(configPanel);

    const closeBtn = document.getElementById('close-config');
    closeBtn.onmouseover = () => closeBtn.style.background = '#f1f3f4';
    closeBtn.onmouseout = () => closeBtn.style.background = 'transparent';

    function showConfig() { configPanel.style.opacity = 1; configPanel.style.transform = 'translateY(0) scale(1)'; configPanel.style.pointerEvents = 'auto'; configPanel.style.visibility = 'visible'; }
    function hideConfig() { configPanel.style.opacity = 0; configPanel.style.transform = 'translateY(12px) scale(0.97)'; configPanel.style.pointerEvents = 'none'; setTimeout(()=>configPanel.style.visibility='hidden',300); }
    document.getElementById('open-config').onclick = showConfig;
    document.getElementById('close-config').onclick = hideConfig;

    document.getElementById('cfg-save').onclick = () => {
        CONFIG.apiKey = document.getElementById('cfg-key').value.trim();
        CONFIG.apiUrl = document.getElementById('cfg-url').value.trim();
        CONFIG.model = document.getElementById('cfg-model').value.trim();
        CONFIG.prompt = document.getElementById('cfg-prompt').value.trim();
        localStorage.setItem('AI_CONFIG', JSON.stringify(CONFIG));
        hideConfig();
    };

    // ====================== 完全恢复：读取页面提示词优先 ======================
    function getPagePrompt() {
        const pagePromptEl = document.querySelector('textarea[placeholder*="提示词"]') || document.querySelector('textarea#prompt') || document.querySelector('textarea');
        return (pagePromptEl?.value || '').trim() || CONFIG.prompt;
    }

    document.getElementById('test-api').onclick = async () => {
        const key = document.getElementById('cfg-key').value.trim();
        const url = document.getElementById('cfg-url').value.trim();
        const model = document.getElementById('cfg-model').value.trim();
        if (!key || !url || !model) return alert('⚠️ 请填写完整API信息');
        const btn = document.getElementById('test-api');
        btn.disabled = true; btn.innerHTML = '🔄 测试中...';
        try {
            await new Promise((resolve,reject)=>{
                GM_xmlhttpRequest({
                    method:'POST', url,
                    headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
                    data:JSON.stringify({model,messages:[{role:'system',content:getPagePrompt()},{role:'user',content:'你好'}],temperature:0}),
                    onload:r=>r.status>=200&&r.status<300?resolve():reject()
                });
            });
            alert('🟢 API 测试成功！');
        } catch {
            alert('🔴 测试失败');
        } finally {
            btn.disabled = false; btn.innerHTML = '🟢 测试 API';
        }
    };

    async function fetchAICorrection(text) {
        const prompt = getPagePrompt();
        stats.tokens += (text.match(/[\u4e00-\u9fa5]/g)||[]).length*2 + text.length*0.5 + 100;
        const start = Date.now();
        const isVolcNewFormat = CONFIG.apiUrl.includes('/responses');
        return new Promise((resolve,reject)=>{
            let postData = isVolcNewFormat
              ? JSON.stringify({ model:CONFIG.model, input:[{role:"system",content:[{type:"input_text",text:prompt}]},{role:"user",content:[{type:"input_text",text:text}]}] })
              : JSON.stringify({ model:CONFIG.model, messages:[{role:"system",content:prompt},{role:"user",content:text}], temperature:0 });

            GM_xmlhttpRequest({
                method:"POST", url:CONFIG.apiUrl,
                headers:{"Content-Type":"application/json","Authorization":`Bearer ${CONFIG.apiKey}`},
                data:postData,
                onload:res=>{
                    try{
                        const data=JSON.parse(res.responseText);
                        const r = isVolcNewFormat ? (data.output?.text || '') : (data.choices?.[0]?.message?.content || '');
                        r ? resolve(r.trim()) : reject();
                    }catch{reject();}
                },
                onerror:()=>reject()
            });
        }).finally(()=>{
            const c=Date.now()-start;
            stats.apiTotalTime += c;
            stats.apiCount++;
            stats.apiAvgTime = stats.apiTotalTime / stats.apiCount;
        });
    }

    togglePauseBtn.onclick = function() {
        isPaused = !isPaused;
        if (isPaused) {
            stats.lastPauseTime = Date.now();
            togglePauseBtn.textContent = '▶ 继续';
            startBtn.innerHTML = "⏸ 暂停中";
        } else {
            if (stats.lastPauseTime) stats.pausedTime += Date.now() - stats.lastPauseTime;
            stats.lastPauseTime = null;
            togglePauseBtn.textContent = '⏸ 暂停';
            if(targets.length) startBtn.innerHTML = `🐱 处理中 ${currentIndex+1}/${targets.length}`;
        }
    };

    stopBtn.onclick = function() {
        isStopped = true;
        isPaused = false;
        stopBtn.textContent = "正在停止识别...";
        stopBtn.style.background = "#999";
        stopBtn.disabled = true;
    };

    async function runStep() {
        if (isStopped || currentIndex >= targets.length) {
            unlockVideo();
            clearInterval(window.statsTimer);

            stopBtn.textContent = "⏹ 停止识别";
            stopBtn.style.background = "#ef4444";
            stopBtn.disabled = false;

            startBtn.disabled = false;
            startBtn.style.background = '#1967d2';
            startBtn.innerHTML = isStopped ? '⏹ 已停止' : '🎉 处理完成';
            setTimeout(()=>{ startBtn.innerHTML = '🐱 开始全自动识别'; }, 2500);
            if(isStopped) { currentIndex = 0; noChangeList = []; failList = []; }
            return;
        }

        if(isPaused) { await new Promise(r=>setTimeout(r,100)); runStep(); return; }

        startBtn.innerHTML = `🐱 处理中 ${currentIndex+1}/${targets.length}`;
        const container = targets[currentIndex];
        const textNode = container.querySelector('div[class*="text__"]');
        if (!textNode || textNode.innerText.trim().length < 2) { currentIndex++; setTimeout(runStep,0); return; }

        const seq = currentIndex + 1;

        try {
            const originalText = textNode.innerText.trim();
            const corrected = await fetchAICorrection(originalText);
            container.scrollIntoView({block:'center',behavior:'smooth'});
            ['mousedown','mouseup','click'].forEach(e=>container.dispatchEvent(new MouseEvent(e,{bubbles:true})));

            let input = null;
            for(let t=0;t<10;t++) { await new Promise(r=>setTimeout(r,150)); input=container.querySelector('textarea')||document.activeElement; if(input) break; }

            if(input) {
                if(corrected === originalText) { stats.noChange++; noChangeList.push(seq); }
                else { stats.success++; }

                setNativeValue(input, corrected);
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
                await new Promise(r=>setTimeout(r,100));
                input.blur();
                container.style.backgroundColor = '#f6ffed';
            } else {
                stats.fail++; failList.push(seq);
            }
            updateStatsDisplay();
        } catch(e) {
            stats.fail++; failList.push(seq);
            console.error(e);
        }

        currentIndex++;
        await new Promise(r=>setTimeout(r,300));
        runStep();
    }

    startBtn.onclick = async function() {
        if (!CONFIG.apiKey||!CONFIG.apiUrl||!CONFIG.model) { alert('⚠️ 请先配置API'); showConfig(); return; }
        targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));
        if(!targets.length) { alert('未找到字幕块'); return; }

        stats = {
            success:0, noChange:0, fail:0, tokens:0, startTime:Date.now(),
            apiTotalTime:0, apiAvgTime:0, apiCount:0, pausedTime:0, lastPauseTime:null
        };
        noChangeList = [];
        failList = [];
        isPaused = false; isStopped = false; currentIndex = 0;

        togglePauseBtn.textContent = '⏸ 暂停';
        startBtn.disabled = true;
        startBtn.style.background = '#8ab4f8';
        lockVideo();
        window.statsTimer = setInterval(updateStatsDisplay,500);
        updateStatsDisplay();
        runStep();
    };
})();