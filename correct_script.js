// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 (稳定优化版)
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  彻底拦截视频干扰，优化 ant-input 注入逻辑
// @author       Gemini
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      ark.cn-beijing.volces.com
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        apiKey: '你的API_KEY',
        apiUrl: '你的API_URL',
        model: '你的模型名称',
        prompt: '你是一名文本识别专家，我将发给你语音转文字后的内容。请直接输出修正后的纯文本，不要有任何多余的解释。'
    };

    /**
     * 强力同步 React 内部状态
     */
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
    }

    // 创建悬浮按钮
    const btn = document.createElement('button');
    btn.innerHTML = '🚀 开始全自动纠错';
    btn.style.cssText = 'position:fixed;bottom:50px;right:50px;z-index:9999;padding:12px 20px;background:#1890ff;color:#fff;border:none;border-radius:4px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-weight:bold;transition: all 0.3s;';
    document.body.appendChild(btn);

    /**
     * 调用 AI 接口
     */
    async function fetchAICorrection(text) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: CONFIG.apiUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${CONFIG.apiKey}`
                },
                data: JSON.stringify({
                    model: CONFIG.model,
                    messages: [{ role: "system", content: CONFIG.prompt }, { role: "user", content: text }],
                    temperature: 0
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.choices && data.choices[0]) {
                            resolve(data.choices[0].message.content.trim());
                        } else { reject('接口未返回有效内容'); }
                    } catch (e) { reject('JSON解析失败'); }
                },
                onerror: () => reject('网络请求失败')
            });
        });
    }

    btn.onclick = async () => {
        // 1. 获取所有字幕容器
        const targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));
        if (targets.length === 0) {
            alert('未找到字幕块，请确认页面已加载');
            return;
        }

        // --- 核心优化：锁定视频功能，防止联动报错 ---
        const originalPlay = HTMLMediaElement.prototype.play;
        // 劫持 play 方法：让它什么都不做，直接返回成功的 Promise
        HTMLMediaElement.prototype.play = function() { return Promise.resolve(); };
        
        const videoElement = document.querySelector('video');
        if (videoElement) {
            videoElement.pause();
            videoElement.muted = true;
        }

        btn.disabled = true;
        btn.style.background = '#bfbfbf';
        let count = 0;

        for (let i = 0; i < targets.length; i++) {
            const container = targets[i];
            const textNode = container.querySelector('div[class*="text__"]');
            if (!textNode) continue;

            const originalText = textNode.innerText.trim();
            if (originalText.length < 2) continue;

            try {
                btn.innerHTML = `🐱正在处理 (${i+1}/${targets.length})`;

                // A. 请求 AI
                const corrected = await fetchAICorrection(originalText);

                // B. 激活编辑态
                // 使用 instant 滚动，避免 smooth 动画导致位置计算偏移
                container.scrollIntoView({ block: 'center', behavior: 'instant' });
                
                const events = ['mousedown', 'mouseup', 'click', 'dblclick'];
                events.forEach(name => {
                    container.dispatchEvent(new MouseEvent(name, {
                        bubbles: true,
                        cancelable: true
                    }));
                });

                // C. 轮询查找出现的输入框 (针对 ant-input textArea__LeaEI)
                let input = null;
                for(let t = 0; t < 15; t++) {
                    await new Promise(r => setTimeout(r, 100)); // 100ms 采样一次
                    // 优先级：当前容器内的 textarea -> 全局具有特定类名的 textarea
                    input = container.querySelector('textarea.ant-input, .textArea__LeaEI') || 
                            document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null;
                    if (input) break;
                }

                if (input) {
                    // D. 注入并触发 React 更新
                    setNativeValue(input, corrected);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    // 等待一瞬让 React 处理 State
                    await new Promise(r => setTimeout(r, 200));
                    
                    // E. 模拟失去焦点以触发自动保存逻辑
                    input.blur(); 

                    // UI 反馈
                    container.style.backgroundColor = '#f6ffed';
                    container.style.borderLeft = '5px solid #52c41a';
                    count++;
                } else {
                    console.warn(`第 ${i+1} 条激活失败，未捕捉到输入框`);
                }

                // 适当延时，防止请求过快和 UI 渲染堵塞
                await new Promise(r => setTimeout(r, 350));

            } catch (e) {
                console.error('处理过程异常:', e);
            }
        }

        // --- 恢复视频原始功能 ---
        HTMLMediaElement.prototype.play = originalPlay;

        btn.innerHTML = `✅ 处理完成 (成功 ${count} 条)`;
        btn.disabled = false;
        btn.style.background = '#1890ff';
        setTimeout(() => { btn.innerHTML = '🚀 开始全自动纠错'; }, 3000);
    };
})();