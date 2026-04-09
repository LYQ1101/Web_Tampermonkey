// ==UserScript==
// @name         高教社数据加工平台-自动纠错工具 (API版+无损视频锁)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  基于 v2.2，通过劫持 play 方法彻底解决 DOMException 报错
// @author       Gemini
// @match        https://data.hep.com.cn/mark/taskInfo/*
// @grant        GM_xmlhttpRequest
// @connect      ark.cn-beijing.volces.com
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        apiKey: '你的API',
        apiUrl: '你的API URL',
        model: '模型',
        prompt: '你是一名文本识别专家，我将发给你语音转文字后的内容。请直接输出修正后的纯文本，不要有任何多余的解释。'
    };

    // --- 视频控制逻辑 ---
    let originalPlay = null;

    function lockVideo() {
        const video = document.getElementById('myVideo');
        if (video) {
            video.pause();
            if (!originalPlay) {
                // 备份原始播放方法
                originalPlay = video.play;
                // 用空函数替换，并返回一个空的 Promise 以防止浏览器报错
                video.play = function() {
                    return new Promise((resolve) => resolve());
                };
            }
        }
    }

    function unlockVideo() {
        const video = document.getElementById('myVideo');
        if (video && originalPlay) {
            video.play = originalPlay; // 还原方法
            originalPlay = null;
        }
    }

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
    btn.innerHTML = '🐱开始全自动识别喵~';
    btn.style.cssText = 'position:fixed;bottom:50px;right:50px;z-index:9999;padding:12px 20px;background:#1890ff;color:#fff;border:none;border-radius:4px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-weight:bold;';
    document.body.appendChild(btn);

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
                        } else { reject('接口错误'); }
                    } catch (e) { reject('解析失败'); }
                },
                onerror: () => reject('网络失败')
            });
        });
    }

    btn.onclick = async () => {
        const targets = Array.from(document.querySelectorAll('div[class*="textBox__"]'));
        if (targets.length === 0) return alert('未找到字幕块');

        btn.disabled = true;
        let count = 0;

        // 1. 开始前锁定视频播放功能
        lockVideo();

        for (let i = 0; i < targets.length; i++) {
            const container = targets[i];
            const textNode = container.querySelector('div[class*="text__"]');
            if (!textNode) continue;

            const originalText = textNode.innerText.trim();
            if (originalText.length < 2) continue;

            try {
                btn.innerHTML = `🐱正在识别喵~(${i+1}/${targets.length})`;
                const corrected = await fetchAICorrection(originalText);

                // 2. 在操作前确保视频依然被锁定
                lockVideo();

                container.scrollIntoView({ block: 'center', behavior: 'smooth' });
                const events = ['mousedown', 'mouseup', 'click', 'dblclick'];
                events.forEach(name => {
                    container.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }));
                });

                let input = null;
                for(let t = 0; t < 10; t++) {
                    await new Promise(r => setTimeout(r, 150));
                    input = container.querySelector('textarea, input') ||
                            (document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null);
                    if (input) break;
                }

                if (input) {
                    setNativeValue(input, corrected);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));

                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    await new Promise(r => setTimeout(r, 100));
                    input.blur();

                    container.style.backgroundColor = '#f6ffed';
                    count++;
                }
                await new Promise(r => setTimeout(r, 400));
            } catch (e) { console.error(e); }
        }

        // 3. 全部完成后恢复视频播放功能
        unlockVideo();
        btn.innerHTML = `处理完成了喵！！ (成功 ${count} 条)`;
        btn.disabled = false;
        setTimeout(() => { btn.innerHTML = '🐱 开始全自动纠错喵~'; }, 3000);
    };
})();